import { Gender, LeaveStatus } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { generateNumber, parseLocalDateInput, startOfDay } from '../utils/date';
import { NotificationService } from './notification.service';
import {
  countLeaveDays,
  defaultEntitlementFor,
  isTrackedLeaveType,
  leaveTypesForGender,
  normalizeLeaveType,
} from '../utils/leaveEntitlements';

function formatLeaveRange(start: Date, end: Date) {
  return `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`;
}

export class LeaveService {
  /** Ensure a system user is not already linked to a different employee. */
  static async assertUserAvailableForLink(userId: string, excludeEmployeeId?: string) {
    const companyId = requireTenantId();
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) throw new AppError('User account not found', 404);

    const linked = await prisma.employee.findFirst({
      where: {
        companyId,
        userId,
        deletedAt: null,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
      },
      select: { id: true, employeeNo: true, firstName: true, lastName: true },
    });
    if (linked) {
      throw new AppError(
        `That login is already linked to employee ${linked.employeeNo} (${linked.firstName} ${linked.lastName})`,
        409
      );
    }
    return user;
  }

  /** Link or unlink a system login to an HR employee (one user ↔ one employee). */
  static async linkEmployeeToUser(employeeId: string, userId: string | null) {
    const companyId = requireTenantId();
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
    });
    if (!employee) throw new AppError('Employee not found', 404);

    if (!userId) {
      return prisma.employee.update({
        where: { id: employeeId },
        data: { userId: null },
        include: {
          department: true,
          branch: true,
          user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
        },
      });
    }

    const user = await this.assertUserAvailableForLink(userId, employeeId);
    return prisma.employee.update({
      where: { id: employeeId },
      data: {
        userId: user.id,
        email: employee.email || user.email,
      },
      include: {
        department: true,
        branch: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
      },
    });
  }

  /** Resolve or create an Employee row for a logged-in user (self-service leave). */
  static async ensureEmployeeForUser(userId: string) {
    const companyId = requireTenantId();
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        departmentId: true,
        branchId: true,
        role: { select: { name: true } },
      },
    });
    if (!user) throw new AppError('User not found', 404);

    const byUser = await prisma.employee.findFirst({
      where: { companyId, userId: user.id, deletedAt: null },
    });
    if (byUser) return byUser;

    if (user.email) {
      const byEmail = await prisma.employee.findFirst({
        where: {
          companyId,
          deletedAt: null,
          email: user.email,
          OR: [{ userId: null }, { userId: user.id }],
        },
      });
      if (byEmail) {
        if (!byEmail.userId) {
          return prisma.employee.update({
            where: { id: byEmail.id },
            data: { userId: user.id },
          });
        }
        return byEmail;
      }
    }

    const count = await prisma.employee.count({ where: { companyId } });
    return prisma.employee.create({
      data: {
        companyId,
        userId: user.id,
        employeeNo: generateNumber('EMP', count + 1),
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        departmentId: user.departmentId,
        branchId: user.branchId,
        position: user.role?.name || null,
        hireDate: new Date(),
        salary: 0,
        isActive: true,
      },
    });
  }

  static async notifyApproversOfRequest(input: {
    employeeName: string;
    type: string;
    startDate: Date;
    endDate: Date;
  }) {
    const title = `Leave request: ${input.employeeName}`;
    const message = `${input.employeeName} requested ${input.type} leave (${formatLeaveRange(input.startDate, input.endDate)}). Open HR to approve or reject.`;
    await NotificationService.notifyRole('HR', 'APPROVAL', title, message, '/hr');
    await NotificationService.notifyRole('Managing Director', 'APPROVAL', title, message, '/hr');
    await NotificationService.notifyAdmins('APPROVAL', title, message, '/hr');
  }

  static async notifyRequesterOfDecision(input: {
    requestedByUserId?: string | null;
    employeeEmail?: string | null;
    status: LeaveStatus;
    type: string;
    startDate: Date;
    endDate: Date;
    decisionNote?: string | null;
  }) {
    let userId = input.requestedByUserId || null;
    if (!userId && input.employeeEmail) {
      const companyId = requireTenantId();
      const match = await prisma.user.findFirst({
        where: {
          companyId,
          email: input.employeeEmail,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      userId = match?.id || null;
    }
    if (!userId) return;

    const decided = input.status === 'APPROVED' ? 'approved' : input.status === 'REJECTED' ? 'rejected' : 'updated';
    const title = `Leave request ${decided}`;
    const note = input.decisionNote ? ` Note: ${input.decisionNote}` : '';
    const message = `Your ${input.type} leave (${formatLeaveRange(input.startDate, input.endDate)}) was ${decided}.${note}`;
    await NotificationService.notifyUser(userId, 'APPROVAL', title, message, '/my-leave');
  }

  static currentLeaveYear(date = new Date()) {
    return date.getFullYear();
  }

  /** Ensure yearly balance rows exist (new year = fresh entitled days, used = 0). */
  static async ensureBalancesForEmployee(
    employeeId: string,
    year = this.currentLeaveYear(),
    gender?: Gender | null
  ) {
    const companyId = requireTenantId();
    let empGender = gender;
    if (empGender === undefined) {
      const emp = await prisma.employee.findFirst({
        where: { id: employeeId, companyId, deletedAt: null },
        select: { gender: true },
      });
      if (!emp) throw new AppError('Employee not found', 404);
      empGender = emp.gender;
    }

    const types = leaveTypesForGender(empGender).filter((t) => t !== 'UNPAID');
    for (const type of types) {
      const entitled = defaultEntitlementFor(type, empGender);
      if (entitled <= 0 && (type === 'PATERNITY' || type === 'MATERNITY')) continue;
      await prisma.leaveBalance.upsert({
        where: { employeeId_year_type: { employeeId, year, type } },
        create: {
          companyId,
          employeeId,
          year,
          type,
          entitledDays: entitled,
          usedDays: 0,
        },
        update: {},
      });
    }
  }

  static async getBalances(employeeId: string, year = this.currentLeaveYear()) {
    const companyId = requireTenantId();
    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, companyId, deletedAt: null },
      select: { id: true, gender: true, firstName: true, lastName: true, employeeNo: true },
    });
    if (!employee) throw new AppError('Employee not found', 404);

    await this.ensureBalancesForEmployee(employeeId, year, employee.gender);

    const rows = await prisma.leaveBalance.findMany({
      where: { companyId, employeeId, year },
      orderBy: { type: 'asc' },
    });

    const balances = rows.map((row) => {
      const entitled = Number(row.entitledDays);
      const used = Number(row.usedDays);
      return {
        id: row.id,
        type: row.type,
        year: row.year,
        entitledDays: entitled,
        usedDays: used,
        remainingDays: Math.max(0, entitled - used),
        notes: row.notes,
      };
    });

    return {
      year,
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        gender: employee.gender,
      },
      balances,
    };
  }

  static async assertCanTakeLeave(input: {
    employeeId: string;
    type: string;
    startDate: Date;
    endDate: Date;
  }) {
    const type = normalizeLeaveType(input.type);
    const days = countLeaveDays(input.startDate, input.endDate);
    if (days <= 0) throw new AppError('Invalid leave date range', 400);

    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, deletedAt: null },
      select: { gender: true },
    });
    if (!employee) throw new AppError('Employee not found', 404);

    if (type === 'PATERNITY' && employee.gender === 'FEMALE') {
      throw new AppError('Paternity leave is only available for male employees', 400);
    }
    if (type === 'MATERNITY' && employee.gender === 'MALE') {
      throw new AppError('Maternity leave is only available for female employees', 400);
    }

    if (!isTrackedLeaveType(type)) {
      return { type, days };
    }

    const year = input.startDate.getFullYear();
    const balances = await this.getBalances(input.employeeId, year);
    const balance = balances.balances.find((b) => b.type === type);
    if (!balance) {
      throw new AppError(`No ${type} leave entitlement for ${year}`, 400);
    }
    if (days > balance.remainingDays) {
      throw new AppError(
        `Insufficient ${type.replace(/_/g, ' ').toLowerCase()} leave balance. Requested ${days} day(s), remaining ${balance.remainingDays}.`,
        400
      );
    }
    return { type, days, year };
  }

  static async applyUsage(employeeId: string, type: string, startDate: Date, endDate: Date, direction: 1 | -1) {
    const normalized = normalizeLeaveType(type);
    if (!isTrackedLeaveType(normalized)) return;
    const days = countLeaveDays(startDate, endDate);
    if (days <= 0) return;
    const year = startDate.getFullYear();
    await this.ensureBalancesForEmployee(employeeId, year);
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_year_type: { employeeId, year, type: normalized } },
    });
    if (!balance) return;
    const nextUsed = Math.max(0, Number(balance.usedDays) + direction * days);
    await prisma.leaveBalance.update({
      where: { id: balance.id },
      data: { usedDays: nextUsed },
    });
  }

  static async updateBalance(input: {
    employeeId: string;
    type: string;
    year?: number;
    entitledDays: number;
    usedDays?: number;
    notes?: string;
    updatedById?: string;
  }) {
    const companyId = requireTenantId();
    const type = normalizeLeaveType(input.type);
    if (!isTrackedLeaveType(type)) {
      throw new AppError('Only tracked leave types can have balances (not unpaid)', 400);
    }
    if (input.entitledDays < 0) throw new AppError('Entitled days cannot be negative', 400);
    const year = input.year ?? this.currentLeaveYear();
    await this.ensureBalancesForEmployee(input.employeeId, year);

    const usedDays = input.usedDays !== undefined ? input.usedDays : undefined;
    if (usedDays !== undefined && usedDays < 0) {
      throw new AppError('Used days cannot be negative', 400);
    }

    const updated = await prisma.leaveBalance.update({
      where: { employeeId_year_type: { employeeId: input.employeeId, year, type } },
      data: {
        entitledDays: input.entitledDays,
        ...(usedDays !== undefined ? { usedDays } : {}),
        notes: input.notes ?? undefined,
        updatedById: input.updatedById,
        companyId,
      },
    });

    return {
      id: updated.id,
      type: updated.type,
      year: updated.year,
      entitledDays: Number(updated.entitledDays),
      usedDays: Number(updated.usedDays),
      remainingDays: Math.max(0, Number(updated.entitledDays) - Number(updated.usedDays)),
      notes: updated.notes,
    };
  }

  /** Staff with APPROVED leave covering the given date (default today). */
  static async listOnLeave(dateInput?: string) {
    const companyId = requireTenantId();
    const day =
      (dateInput ? parseLocalDateInput(dateInput) : null) || startOfDay(new Date());
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const rows = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: dayEnd },
        endDate: { gte: day },
        employee: { companyId, deletedAt: null, isActive: true },
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeNo: true,
            firstName: true,
            lastName: true,
            department: { select: { name: true } },
            position: true,
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { employee: { firstName: 'asc' } }],
    });

    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      startDate: r.startDate,
      endDate: r.endDate,
      days: countLeaveDays(r.startDate, r.endDate),
      reason: r.reason,
      employee: {
        id: r.employee.id,
        employeeNo: r.employee.employeeNo,
        name: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
        department: r.employee.department?.name || null,
        position: r.employee.position,
      },
    }));
  }

  static async reportRows(year = this.currentLeaveYear()) {
    const companyId = requireTenantId();
    const employees = await prisma.employee.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: {
        id: true,
        employeeNo: true,
        firstName: true,
        lastName: true,
        gender: true,
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const rows: Array<{
      employeeNo: string;
      name: string;
      department: string;
      gender: string;
      type: string;
      year: number;
      entitled: number;
      used: number;
      remaining: number;
    }> = [];

    for (const emp of employees) {
      const balances = await this.getBalances(emp.id, year);
      for (const b of balances.balances) {
        rows.push({
          employeeNo: emp.employeeNo,
          name: `${emp.firstName} ${emp.lastName}`.trim(),
          department: emp.department?.name || '—',
          gender: emp.gender,
          type: b.type,
          year,
          entitled: b.entitledDays,
          used: b.usedDays,
          remaining: b.remainingDays,
        });
      }
    }
    return rows;
  }
}
