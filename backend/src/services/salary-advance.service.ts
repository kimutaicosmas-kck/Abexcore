import { Prisma, SalaryAdvanceRepaymentMethod, SalaryAdvanceStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AccountingService } from './accounting.service';
import { nextSalaryAdvanceNumber } from '../utils/numbering';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import { parseLocalDateInput } from '../utils/date';

type TxClient = Prisma.TransactionClient;

const employeeSelect = {
  id: true,
  employeeNo: true,
  firstName: true,
  lastName: true,
  salary: true,
  isActive: true,
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

export type AdvanceAllocation = { advanceId: string; amount: number; advanceNo: string };

export class SalaryAdvanceService {
  static computeInstallments(amount: number, monthlyDeduction: number): number {
    if (monthlyDeduction <= 0) return 1;
    return Math.max(1, Math.ceil(round2(amount) / round2(monthlyDeduction)));
  }

  static buildSchedule(
    remainingBalance: number,
    monthlyDeduction: number,
    fromDate: Date
  ): { dueDate: string; amount: number }[] {
    const schedule: { dueDate: string; amount: number }[] = [];
    let remaining = round2(remainingBalance);
    let cursor = monthStart(fromDate);
    let guard = 0;
    while (remaining > 0.009 && guard < 120) {
      const amount = round2(Math.min(remaining, monthlyDeduction));
      schedule.push({
        dueDate: cursor.toISOString().slice(0, 10),
        amount,
      });
      remaining = round2(remaining - amount);
      cursor = addMonths(cursor, 1);
      guard += 1;
    }
    return schedule;
  }

  static async planDeductionsForEmployee(
    employeeId: string,
    periodEnd: Date,
    availableNet: number,
    tx: TxClient | typeof prisma = prisma
  ): Promise<{ allocations: AdvanceAllocation[]; total: number }> {
    if (availableNet <= 0) return { allocations: [], total: 0 };

    const advances = await tx.salaryAdvance.findMany({
      where: {
        employeeId,
        status: 'ACTIVE',
        disbursedAt: { not: null },
        remainingBalance: { gt: 0 },
        deductionStartDate: { lte: periodEnd },
      },
      orderBy: [{ disbursedAt: 'asc' }, { createdAt: 'asc' }],
    });

    let remainingNet = round2(availableNet);
    const allocations: AdvanceAllocation[] = [];

    for (const advance of advances) {
      if (remainingNet <= 0) break;
      const due = round2(Number(advance.monthlyDeduction));
      const balance = round2(Number(advance.remainingBalance));
      // Subtract any already-scheduled (unapplied) payroll repayments
      const scheduled = await tx.salaryAdvanceRepayment.aggregate({
        where: { advanceId: advance.id, isApplied: false },
        _sum: { amount: true },
      });
      const reserved = round2(Number(scheduled._sum.amount || 0));
      const openBalance = round2(Math.max(0, balance - reserved));
      if (openBalance <= 0) continue;

      const amount = round2(Math.min(due, openBalance, remainingNet));
      if (amount <= 0) continue;
      allocations.push({ advanceId: advance.id, amount, advanceNo: advance.advanceNo });
      remainingNet = round2(remainingNet - amount);
    }

    const total = round2(allocations.reduce((s, a) => s + a.amount, 0));
    return { allocations, total };
  }

  static async list(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    employeeId?: string;
  }) {
    const { page, limit, search, status, employeeId } = params;
    const skip = (page - 1) * limit;
    const where: Prisma.SalaryAdvanceWhereInput = {};

    if (status) where.status = status as SalaryAdvanceStatus;
    if (employeeId) where.employeeId = employeeId;
    if (search) {
      where.OR = [
        { advanceNo: { contains: search } },
        { reason: { contains: search } },
        { employee: { firstName: { contains: search } } },
        { employee: { lastName: { contains: search } } },
        { employee: { employeeNo: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.salaryAdvance.findMany({
        where,
        skip,
        take: limit,
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
          repayments: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.salaryAdvance.count({ where }),
    ]);

    return {
      data: data.map((row) => this.serialize(row)),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  static async getById(id: string) {
    const row = await prisma.salaryAdvance.findUnique({
      where: { id },
      include: {
        employee: { select: employeeSelect },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
        repayments: {
          orderBy: { createdAt: 'desc' },
          include: {
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
            payrollRecord: {
              select: { id: true, periodStart: true, periodEnd: true, isPaid: true },
            },
          },
        },
      },
    });
    if (!row) throw new AppError('Salary advance not found', 404);

    const scheduleFrom =
      row.status === 'ACTIVE' || row.status === 'PENDING'
        ? monthStart(new Date())
        : monthStart(row.deductionStartDate);

    return {
      ...this.serialize(row),
      schedule: this.buildSchedule(
        Number(row.remainingBalance),
        Number(row.monthlyDeduction),
        scheduleFrom
      ),
    };
  }

  static async create(
    input: {
      employeeId: string;
      amount: number;
      monthlyDeduction: number;
      deductionStartDate: string;
      reason?: string;
      notes?: string;
      entryMode?: 'ISSUE' | 'RECORD_EXISTING';
      disburseNow?: boolean;
      approveNow?: boolean;
      disbursedAt?: string;
      remainingBalance?: number;
      alreadyRepaid?: number;
    },
    userId?: string
  ) {
    const companyId = requireTenantId();
    const amount = round2(Number(input.amount));
    const monthlyDeduction = round2(Number(input.monthlyDeduction));
    const recordExisting = input.entryMode === 'RECORD_EXISTING';

    if (amount <= 0) throw new AppError('Advance amount must be greater than zero', 400);
    if (monthlyDeduction <= 0) throw new AppError('Monthly deduction must be greater than zero', 400);

    let remainingBalance = amount;
    let totalRepaid = 0;
    if (recordExisting) {
      if (input.remainingBalance !== undefined && input.remainingBalance !== null) {
        remainingBalance = round2(Number(input.remainingBalance));
        totalRepaid = round2(amount - remainingBalance);
      } else if (input.alreadyRepaid !== undefined && input.alreadyRepaid !== null) {
        totalRepaid = round2(Number(input.alreadyRepaid));
        remainingBalance = round2(amount - totalRepaid);
      }
      if (remainingBalance < 0 || remainingBalance > amount) {
        throw new AppError('Remaining balance must be between 0 and the original amount', 400);
      }
      if (totalRepaid < 0 || totalRepaid > amount) {
        throw new AppError('Already repaid must be between 0 and the original amount', 400);
      }
    }

    const balanceForCap = recordExisting ? remainingBalance : amount;
    if (monthlyDeduction > balanceForCap && balanceForCap > 0) {
      throw new AppError(
        recordExisting
          ? 'Monthly deduction cannot exceed the remaining balance'
          : 'Monthly deduction cannot exceed the advance amount',
        400
      );
    }
    if (recordExisting && remainingBalance <= 0) {
      throw new AppError('Use a remaining balance greater than zero, or skip recording a fully repaid advance', 400);
    }

    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, deletedAt: null, isActive: true },
    });
    if (!employee) throw new AppError('Active employee not found', 404);

    const salary = Number(employee.salary);
    if (salary > 0 && monthlyDeduction > salary * 0.5) {
      throw new AppError(
        'Monthly deduction cannot exceed 50% of the employee basic salary',
        400
      );
    }

    const deductionStartDate = parseLocalDateInput(input.deductionStartDate);
    if (!deductionStartDate) throw new AppError('Valid deduction start date is required', 400);

    let givenAt: Date | null = null;
    if (recordExisting) {
      givenAt =
        (input.disbursedAt && parseLocalDateInput(input.disbursedAt)) ||
        (input.disbursedAt ? new Date(input.disbursedAt) : null);
      if (!givenAt || Number.isNaN(givenAt.getTime())) {
        throw new AppError('Valid date given is required when recording an existing advance', 400);
      }
    }

    const disburseNow = recordExisting ? false : Boolean(input.disburseNow);
    const approveNow = recordExisting || Boolean(input.approveNow) || disburseNow;

    return prisma.$transaction(async (tx) => {
      const advanceNo = await nextSalaryAdvanceNumber(tx, companyId);
      const installments = this.computeInstallments(
        recordExisting ? remainingBalance : amount,
        monthlyDeduction
      );

      let status: SalaryAdvanceStatus = 'PENDING';
      let approvedAt: Date | null = null;
      let approvedById: string | null = null;
      let disbursedAt: Date | null = null;

      if (recordExisting) {
        status = 'ACTIVE';
        approvedAt = givenAt;
        approvedById = userId || null;
        disbursedAt = givenAt;
      } else if (approveNow || disburseNow) {
        status = 'ACTIVE';
        approvedAt = new Date();
        approvedById = userId || null;
      }

      const noteParts = [
        input.notes || null,
        recordExisting
          ? `Recorded existing advance (given ${givenAt!.toISOString().slice(0, 10)}; already repaid ${totalRepaid.toFixed(2)}). No cash disbursement posted.`
          : null,
      ].filter(Boolean);

      const created = await tx.salaryAdvance.create({
        data: injectTenantData({
          employeeId: input.employeeId,
          advanceNo,
          amount,
          monthlyDeduction,
          remainingBalance: recordExisting ? remainingBalance : amount,
          totalRepaid: recordExisting ? totalRepaid : 0,
          installments,
          reason: input.reason || null,
          notes: noteParts.length ? noteParts.join('\n') : null,
          status,
          deductionStartDate,
          approvedAt,
          approvedById,
          disbursedAt,
          createdById: userId || null,
        }),
        include: { employee: { select: employeeSelect } },
      });

      if (recordExisting && totalRepaid > 0) {
        await tx.salaryAdvanceRepayment.create({
          data: injectTenantData(
            {
              advanceId: created.id,
              amount: totalRepaid,
              method: 'MANUAL',
              isApplied: true,
              paidAt: givenAt,
              notes: 'Opening balance — recovered before recording in system',
              recordedById: userId || null,
            },
            companyId
          ),
        });
      }

      if (disburseNow) {
        await AccountingService.postSalaryAdvanceDisbursement(tx, {
          id: created.id,
          advanceNo: created.advanceNo,
          amount,
          employeeName: `${created.employee.firstName} ${created.employee.lastName}`,
          method: 'CASH',
        });
        return tx.salaryAdvance.update({
          where: { id: created.id },
          data: { disbursedAt: new Date(), status: 'ACTIVE' },
          include: {
            employee: { select: employeeSelect },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
            approvedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        });
      }

      return tx.salaryAdvance.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
          repayments: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
    }).then((row) => this.serialize(row));
  }

  static async approve(id: string, userId: string, disburseNow = true) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.salaryAdvance.findUnique({
        where: { id },
        include: { employee: { select: employeeSelect } },
      });
      if (!existing) throw new AppError('Salary advance not found', 404);
      if (existing.status !== 'PENDING') {
        throw new AppError('Only pending advances can be approved', 400);
      }

      let disbursedAt = existing.disbursedAt;
      if (disburseNow && !disbursedAt) {
        await AccountingService.postSalaryAdvanceDisbursement(tx, {
          id: existing.id,
          advanceNo: existing.advanceNo,
          amount: Number(existing.amount),
          employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
          method: 'CASH',
        });
        disbursedAt = new Date();
      }

      const updated = await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          approvedAt: new Date(),
          approvedById: userId,
          disbursedAt,
        },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return this.serialize(updated);
    });
  }

  static async reject(id: string, userId: string, reason?: string) {
    const existing = await prisma.salaryAdvance.findUnique({ where: { id } });
    if (!existing) throw new AppError('Salary advance not found', 404);
    if (existing.status !== 'PENDING') {
      throw new AppError('Only pending advances can be rejected', 400);
    }

    const updated = await prisma.salaryAdvance.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        rejectedAt: new Date(),
        rejectionReason: reason || null,
        approvedById: userId,
        cancelledAt: new Date(),
        cancelReason: reason || 'Rejected',
      },
      include: {
        employee: { select: employeeSelect },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return this.serialize(updated);
  }

  static async disburse(id: string, method = 'CASH') {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.salaryAdvance.findUnique({
        where: { id },
        include: { employee: { select: employeeSelect } },
      });
      if (!existing) throw new AppError('Salary advance not found', 404);
      if (existing.status !== 'ACTIVE' && existing.status !== 'PENDING') {
        throw new AppError('Advance cannot be disbursed in its current status', 400);
      }
      if (existing.disbursedAt) throw new AppError('Advance already disbursed', 400);

      await AccountingService.postSalaryAdvanceDisbursement(tx, {
        id: existing.id,
        advanceNo: existing.advanceNo,
        amount: Number(existing.amount),
        employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
        method,
      });

      const updated = await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          disbursedAt: new Date(),
          approvedAt: existing.approvedAt || new Date(),
        },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return this.serialize(updated);
    });
  }

  static async update(
    id: string,
    input: { monthlyDeduction?: number; reason?: string | null; notes?: string | null; deductionStartDate?: string }
  ) {
    const existing = await prisma.salaryAdvance.findUnique({ where: { id } });
    if (!existing) throw new AppError('Salary advance not found', 404);
    if (!['PENDING', 'ACTIVE'].includes(existing.status)) {
      throw new AppError('Only pending or active advances can be updated', 400);
    }

    const data: Prisma.SalaryAdvanceUpdateInput = {};
    if (input.monthlyDeduction !== undefined) {
      const monthlyDeduction = round2(Number(input.monthlyDeduction));
      if (monthlyDeduction <= 0) throw new AppError('Monthly deduction must be greater than zero', 400);
      if (monthlyDeduction > Number(existing.remainingBalance)) {
        throw new AppError('Monthly deduction cannot exceed the remaining balance', 400);
      }
      data.monthlyDeduction = monthlyDeduction;
      data.installments = this.computeInstallments(Number(existing.remainingBalance), monthlyDeduction);
    }
    if (input.reason !== undefined) data.reason = input.reason;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.deductionStartDate) {
      const date = parseLocalDateInput(input.deductionStartDate);
      if (!date) throw new AppError('Valid deduction start date is required', 400);
      data.deductionStartDate = date;
    }

    const updated = await prisma.salaryAdvance.update({
      where: { id },
      data,
      include: {
        employee: { select: employeeSelect },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        approvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return this.serialize(updated);
  }

  static async recordManualRepayment(
    id: string,
    input: { amount: number; method?: SalaryAdvanceRepaymentMethod; notes?: string; paidAt?: string },
    userId?: string
  ) {
    const companyId = requireTenantId();
    const amount = round2(Number(input.amount));
    if (amount <= 0) throw new AppError('Repayment amount must be greater than zero', 400);

    return prisma.$transaction(async (tx) => {
      const existing = await tx.salaryAdvance.findUnique({
        where: { id },
        include: { employee: { select: employeeSelect } },
      });
      if (!existing) throw new AppError('Salary advance not found', 404);
      if (existing.status !== 'ACTIVE') throw new AppError('Only active advances can be repaid', 400);
      if (!existing.disbursedAt) throw new AppError('Disburse the advance before recording repayments', 400);

      const balance = round2(Number(existing.remainingBalance));
      if (amount > balance) throw new AppError('Repayment exceeds remaining balance', 400);

      const method = (input.method || 'CASH') as SalaryAdvanceRepaymentMethod;
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();

      await AccountingService.postSalaryAdvanceRepayment(tx, {
        id: existing.id,
        advanceNo: existing.advanceNo,
        amount,
        employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
        method,
      });

      await tx.salaryAdvanceRepayment.create({
        data: injectTenantData({
          advanceId: existing.id,
          amount,
          method,
          isApplied: true,
          paidAt,
          notes: input.notes || null,
          recordedById: userId || null,
        }, companyId),
      });

      const remainingBalance = round2(balance - amount);
      const totalRepaid = round2(Number(existing.totalRepaid) + amount);
      const updated = await tx.salaryAdvance.update({
        where: { id },
        data: {
          remainingBalance,
          totalRepaid,
          status: remainingBalance <= 0.009 ? 'COMPLETED' : 'ACTIVE',
        },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
          repayments: { orderBy: { createdAt: 'desc' }, take: 10 },
        },
      });
      return this.serialize(updated);
    });
  }

  static async cancel(id: string, reason?: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.salaryAdvance.findUnique({
        where: { id },
        include: { employee: { select: employeeSelect } },
      });
      if (!existing) throw new AppError('Salary advance not found', 404);
      if (!['PENDING', 'ACTIVE'].includes(existing.status)) {
        throw new AppError('Advance cannot be cancelled in its current status', 400);
      }

      const scheduled = await tx.salaryAdvanceRepayment.count({
        where: { advanceId: id, isApplied: false },
      });
      if (scheduled > 0) {
        throw new AppError(
          'Cancel or mark paid any unpaid payroll that has scheduled advance deductions first',
          400
        );
      }

      const remaining = round2(Number(existing.remainingBalance));
      const totalRepaid = round2(Number(existing.totalRepaid));

      if (existing.disbursedAt && remaining > 0.009) {
        if (totalRepaid > 0.009) {
          throw new AppError(
            'This advance has partial repayments. Use Write off for the remaining balance',
            400
          );
        }
        // Full outstanding with no repayments — reverse the original disbursement.
        await AccountingService.reverseSalaryAdvanceDisbursement(tx, {
          id: existing.id,
          advanceNo: existing.advanceNo,
          amount: remaining,
          employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
          method: 'CASH',
        });
      }

      const updated = await tx.salaryAdvance.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          remainingBalance: 0,
          cancelledAt: new Date(),
          cancelReason: reason || null,
        },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return this.serialize(updated);
    });
  }

  static async writeOff(id: string, reason?: string, userId?: string) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.salaryAdvance.findUnique({
        where: { id },
        include: { employee: { select: employeeSelect } },
      });
      if (!existing) throw new AppError('Salary advance not found', 404);
      if (existing.status !== 'ACTIVE') throw new AppError('Only active advances can be written off', 400);

      const remaining = round2(Number(existing.remainingBalance));
      if (remaining <= 0) throw new AppError('Nothing left to write off', 400);

      await AccountingService.postSalaryAdvanceWriteOff(tx, {
        id: existing.id,
        advanceNo: existing.advanceNo,
        amount: remaining,
        employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
      });

      await tx.salaryAdvanceRepayment.create({
        data: injectTenantData({
          advanceId: existing.id,
          amount: remaining,
          method: 'MANUAL',
          isApplied: true,
          paidAt: new Date(),
          notes: reason || 'Written off',
          recordedById: userId || null,
        }),
      });

      const updated = await tx.salaryAdvance.update({
        where: { id },
        data: {
          remainingBalance: 0,
          status: 'WRITTEN_OFF',
          notes: [existing.notes, reason ? `Write-off: ${reason}` : 'Written off']
            .filter(Boolean)
            .join('\n'),
        },
        include: {
          employee: { select: employeeSelect },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          approvedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      return this.serialize(updated);
    });
  }

  /** Schedule payroll recoveries when creating a payroll record. */
  static async schedulePayrollDeductions(
    tx: TxClient,
    payrollRecordId: string,
    employeeId: string,
    periodEnd: Date,
    availableNet: number,
    recordedById?: string
  ) {
    const companyId = requireTenantId();
    const { allocations, total } = await this.planDeductionsForEmployee(
      employeeId,
      periodEnd,
      availableNet,
      tx
    );

    for (const alloc of allocations) {
      await tx.salaryAdvanceRepayment.create({
        data: injectTenantData({
          advanceId: alloc.advanceId,
          payrollRecordId,
          amount: alloc.amount,
          method: 'PAYROLL',
          isApplied: false,
          notes: `Scheduled for payroll ${payrollRecordId.slice(0, 8)}`,
          recordedById: recordedById || null,
        }, companyId),
      });
    }

    return { allocations, total };
  }

  /** Apply scheduled payroll recoveries when payroll is marked paid. */
  static async applyPayrollDeductions(tx: TxClient, payrollRecordId: string) {
    const repayments = await tx.salaryAdvanceRepayment.findMany({
      where: { payrollRecordId, isApplied: false, method: 'PAYROLL' },
      include: {
        advance: { include: { employee: { select: employeeSelect } } },
      },
    });

    let total = 0;
    for (const repayment of repayments) {
      const amount = round2(Number(repayment.amount));
      const advance = repayment.advance;
      const balance = round2(Number(advance.remainingBalance));
      const applied = round2(Math.min(amount, balance));
      if (applied <= 0) {
        await tx.salaryAdvanceRepayment.delete({ where: { id: repayment.id } });
        continue;
      }

      await AccountingService.postSalaryAdvanceRepayment(tx, {
        id: advance.id,
        advanceNo: advance.advanceNo,
        amount: applied,
        employeeName: `${advance.employee.firstName} ${advance.employee.lastName}`,
        method: 'PAYROLL',
        sourceId: payrollRecordId,
      });

      const remainingBalance = round2(balance - applied);
      await tx.salaryAdvance.update({
        where: { id: advance.id },
        data: {
          remainingBalance,
          totalRepaid: round2(Number(advance.totalRepaid) + applied),
          status: remainingBalance <= 0.009 ? 'COMPLETED' : 'ACTIVE',
        },
      });

      await tx.salaryAdvanceRepayment.update({
        where: { id: repayment.id },
        data: {
          amount: applied,
          isApplied: true,
          paidAt: new Date(),
        },
      });
      total = round2(total + applied);
    }

    return total;
  }

  static async getStats() {
    const [pendingApproval, activeCount, completedCount, outstandingAgg, recoveredMonth] =
      await Promise.all([
        prisma.salaryAdvance.count({ where: { status: 'PENDING' } }),
        prisma.salaryAdvance.count({ where: { status: 'ACTIVE' } }),
        prisma.salaryAdvance.count({ where: { status: 'COMPLETED' } }),
        prisma.salaryAdvance.aggregate({
          where: { status: 'ACTIVE' },
          _sum: { remainingBalance: true },
        }),
        prisma.salaryAdvanceRepayment.aggregate({
          where: {
            isApplied: true,
            paidAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
          _sum: { amount: true },
        }),
      ]);

    return {
      pendingApproval,
      activeAdvances: activeCount,
      completedAdvances: completedCount,
      outstandingBalance: Number(outstandingAgg._sum.remainingBalance || 0),
      recoveredThisMonth: Number(recoveredMonth._sum.amount || 0),
    };
  }

  private static serialize(row: Record<string, unknown> & {
    amount: Prisma.Decimal | number;
    monthlyDeduction: Prisma.Decimal | number;
    remainingBalance: Prisma.Decimal | number;
    totalRepaid: Prisma.Decimal | number;
    employee?: { salary?: Prisma.Decimal | number | null } | null;
  }) {
    return {
      ...row,
      amount: Number(row.amount),
      monthlyDeduction: Number(row.monthlyDeduction),
      remainingBalance: Number(row.remainingBalance),
      totalRepaid: Number(row.totalRepaid),
      employee: row.employee
        ? {
            ...row.employee,
            salary: Number(row.employee.salary || 0),
          }
        : row.employee,
      repayments: Array.isArray(row.repayments)
        ? (row.repayments as Array<Record<string, unknown> & { amount: Prisma.Decimal | number }>).map((r) => ({
            ...r,
            amount: Number(r.amount),
          }))
        : row.repayments,
    };
  }
}
