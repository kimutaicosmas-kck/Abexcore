import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createEmployeeSchema,
  hrListQuerySchema,
  paginationSchema,
  approveLeaveSchema,
  createLeaveSchema,
  createMyLeaveSchema,
  linkEmployeeUserSchema,
  updateLeaveBalanceSchema,
  leaveBalancesQuerySchema,
  salaryAdvanceListQuerySchema,
  createSalaryAdvanceSchema,
  updateSalaryAdvanceSchema,
  approveSalaryAdvanceSchema,
  rejectSalaryAdvanceSchema,
  repaySalaryAdvanceSchema,
  cancelSalaryAdvanceSchema,
  createPayrollSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';
import { HrService } from '../services/admin.service';
import { calculateKenyaPayroll } from '../services/payroll.service';
import { AccountingService } from '../services/accounting.service';
import { LeaveService } from '../services/leave.service';
import { ExportService } from '../services/export.service';
import { SalaryAdvanceService } from '../services/salary-advance.service';
import { Prisma } from '@prisma/client';
import { parseLocalDateInput } from '../utils/date';
import { injectTenantData } from '../utils/tenant';
import { normalizeLeaveType } from '../utils/leaveEntitlements';

const router = Router();
router.use(authenticate);

router.get(
  '/stats',
  authorize('hr:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await HrService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/employees',
  authorize('hr:read'),
  validate(hrListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, isActive } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      isActive?: boolean;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.EmployeeWhereInput = { deletedAt: null };
    if (isActive !== undefined) where.isActive = isActive;
    if (search) {
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { employeeNo: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const employeeUserSelect = {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      status: true,
    } as const;

    const [data, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limit,
        include: {
          department: true,
          branch: true,
          user: { select: employeeUserSelect },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.employee.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

/** Active logins not yet linked to an employee — for HR link picker. */
router.get(
  '/linkable-users',
  authorize('hr:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        employee: null,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 500,
    });
    res.json({ success: true, data: users });
  })
);

router.get(
  '/employees/:id',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.employee.findFirst({
      where: { id: getParam(req.params.id), deletedAt: null },
      include: {
        department: true,
        branch: true,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, status: true },
        },
      },
    });
    if (!data) throw new AppError('Employee not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/employees',
  authorize('hr:create'),
  validate(createEmployeeSchema),
  auditLog('hr', 'create', 'employee'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hireDate, userId, ...rest } = req.body as {
      hireDate: string;
      userId?: string | null;
      employeeNo: string;
      firstName: string;
      lastName: string;
      email?: string;
      phone?: string;
      gender?: 'MALE' | 'FEMALE' | 'UNSPECIFIED';
      departmentId?: string;
      branchId?: string;
      position?: string;
      salary?: number;
    };

    let resolvedUserId = userId ?? null;
    if (resolvedUserId) {
      await LeaveService.assertUserAvailableForLink(resolvedUserId);
    } else if (rest.email) {
      const match = await prisma.user.findFirst({
        where: {
          email: rest.email.toLowerCase(),
          deletedAt: null,
          employee: null,
        },
        select: { id: true },
      });
      if (match) resolvedUserId = match.id;
    }

    const employee = await prisma.employee.create({
      data: injectTenantData({
        ...rest,
        email: rest.email?.toLowerCase(),
        hireDate: new Date(hireDate),
        userId: resolvedUserId,
        gender: rest.gender || 'UNSPECIFIED',
      }),
      include: {
        department: true,
        branch: true,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, status: true },
        },
      },
    });
    await LeaveService.ensureBalancesForEmployee(employee.id, LeaveService.currentLeaveYear(), employee.gender);
    res.status(201).json({ success: true, data: employee });
  })
);

router.put(
  '/employees/:id',
  authorize('hr:update'),
  validate(createEmployeeSchema.partial()),
  auditLog('hr', 'update', 'employee'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const { hireDate, userId, ...rest } = req.body as {
      hireDate?: string;
      userId?: string | null;
      email?: string;
      [key: string]: unknown;
    };

    const existing = await prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Employee not found', 404);

    if (userId) {
      await LeaveService.assertUserAvailableForLink(userId, id);
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.email !== undefined
          ? { email: typeof rest.email === 'string' ? rest.email.toLowerCase() : rest.email }
          : {}),
        ...(hireDate ? { hireDate: new Date(hireDate) } : {}),
        ...(userId !== undefined ? { userId } : {}),
      },
      include: {
        department: true,
        branch: true,
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, status: true },
        },
      },
    });
    res.json({ success: true, data: employee });
  })
);

router.patch(
  '/employees/:id/link-user',
  authorize('hr:update'),
  validate(linkEmployeeUserSchema),
  auditLog('hr', 'update', 'employee'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const employee = await LeaveService.linkEmployeeToUser(
      getParam(req.params.id),
      req.body.userId as string | null
    );
    res.json({ success: true, data: employee });
  })
);

router.get(
  '/attendance',
  authorize('hr:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = search
      ? {
          OR: [
            { employee: { firstName: { contains: search } } },
            { employee: { lastName: { contains: search } } },
            { employee: { employeeNo: { contains: search } } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.attendance.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/attendance',
  authorize('hr:create'),
  auditLog('hr', 'create', 'attendance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { employeeId, date, checkIn, checkOut, status, notes } = req.body;
    const record = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId, date: new Date(date) } },
      create: {
        employeeId,
        date: new Date(date),
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut ? new Date(checkOut) : undefined,
        status: status || 'present',
        notes,
      },
      update: {
        checkIn: checkIn ? new Date(checkIn) : undefined,
        checkOut: checkOut ? new Date(checkOut) : undefined,
        status,
        notes,
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    res.status(201).json({ success: true, data: record });
  })
);

router.get(
  '/leave/mine',
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
    const skip = (page - 1) * limit;
    const employee = await LeaveService.ensureEmployeeForUser(req.user.id);

    const where: Prisma.LeaveRequestWhereInput = { employeeId: employee.id };
    const [data, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNo: true } },
          approvedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/leave/balances/me',
  validate(leaveBalancesQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const { year } = getQuery<{ year?: number }>(req.query);
    const employee = await LeaveService.ensureEmployeeForUser(req.user.id);
    const data = await LeaveService.getBalances(
      employee.id,
      year || LeaveService.currentLeaveYear()
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/leave/balances',
  authorize('hr:read'),
  validate(leaveBalancesQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year, employeeId } = getQuery<{ year?: number; employeeId?: string }>(req.query);
    if (!employeeId) throw new AppError('employeeId is required', 400);
    const data = await LeaveService.getBalances(
      employeeId,
      year || LeaveService.currentLeaveYear()
    );
    res.json({ success: true, data });
  })
);

router.put(
  '/leave/balances',
  authorizeAny('hr:update'),
  validate(updateLeaveBalanceSchema),
  auditLog('hr', 'update', 'leave_balance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const data = await LeaveService.updateBalance({
      ...req.body,
      updatedById: req.user.id,
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/leave/on-leave',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const data = await LeaveService.listOnLeave(date);
    res.json({ success: true, data });
  })
);

router.get(
  '/leave/report/excel',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : LeaveService.currentLeaveYear();
    const rows = await LeaveService.reportRows(year);
    const excel = await ExportService.generateLeaveBalancesExcel(rows, year);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="leave-balances-${year}.xlsx"`);
    res.send(excel);
  })
);

router.get(
  '/leave/report/pdf',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const year = req.query.year ? Number(req.query.year) : LeaveService.currentLeaveYear();
    const rows = await LeaveService.reportRows(year);
    const pdf = await ExportService.generateLeaveBalancesPdf(rows, year);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="leave-balances-${year}.pdf"`);
    res.send(pdf);
  })
);

router.post(
  '/leave/me',
  validate(createMyLeaveSchema),
  auditLog('hr', 'create', 'leave_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const { type, startDate, endDate, reason } = req.body as {
      type: string;
      startDate: string;
      endDate: string;
      reason?: string;
    };
    const start = parseLocalDateInput(startDate) || new Date(startDate);
    const end = parseLocalDateInput(endDate) || new Date(endDate);
    if (end < start) throw new AppError('End date must be on or after start date', 400);

    const employee = await LeaveService.ensureEmployeeForUser(req.user.id);
    const normalizedType = normalizeLeaveType(type);
    await LeaveService.assertCanTakeLeave({
      employeeId: employee.id,
      type: normalizedType,
      startDate: start,
      endDate: end,
    });

    const record = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        requestedByUserId: req.user.id,
        type: normalizedType,
        startDate: start,
        endDate: end,
        reason,
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
    });

    await LeaveService.notifyApproversOfRequest({
      employeeName: `${employee.firstName} ${employee.lastName}`,
      type: normalizedType,
      startDate: start,
      endDate: end,
    });

    res.status(201).json({ success: true, data: record });
  })
);

router.get(
  '/leave',
  authorize('hr:read'),
  validate(hrListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.LeaveRequestWhereInput = {};
    if (status) where.status = status as Prisma.EnumLeaveStatusFilter['equals'];
    if (search) {
      where.OR = [
        { employee: { firstName: { contains: search } } },
        { employee: { lastName: { contains: search } } },
        { type: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNo: true } },
          requestedBy: { select: { firstName: true, lastName: true } },
          approvedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/leave',
  authorize('hr:create'),
  validate(createLeaveSchema),
  auditLog('hr', 'create', 'leave_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { employeeId, type, startDate, endDate, reason } = req.body as {
      employeeId: string;
      type: string;
      startDate: string;
      endDate: string;
      reason?: string;
    };
    const start = parseLocalDateInput(startDate) || new Date(startDate);
    const end = parseLocalDateInput(endDate) || new Date(endDate);
    if (end < start) throw new AppError('End date must be on or after start date', 400);

    const employee = await prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
    });
    if (!employee) throw new AppError('Employee not found', 404);

    const normalizedType = normalizeLeaveType(type);
    await LeaveService.assertCanTakeLeave({
      employeeId,
      type: normalizedType,
      startDate: start,
      endDate: end,
    });

    const record = await prisma.leaveRequest.create({
      data: {
        employeeId,
        requestedByUserId: req.user?.id,
        type: normalizedType,
        startDate: start,
        endDate: end,
        reason,
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
    });

    await LeaveService.notifyApproversOfRequest({
      employeeName: `${employee.firstName} ${employee.lastName}`,
      type: normalizedType,
      startDate: start,
      endDate: end,
    });

    res.status(201).json({ success: true, data: record });
  })
);

router.patch(
  '/leave/:id/approve',
  authorize('hr:update'),
  validate(approveLeaveSchema),
  auditLog('hr', 'update', 'leave_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const id = getParam(req.params.id);
    const { status, decisionNote } = req.body as {
      status: 'APPROVED' | 'REJECTED' | 'CANCELLED';
      decisionNote?: string;
    };

    const existing = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        employee: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!existing) throw new AppError('Leave request not found', 404);

    if (status === 'APPROVED' && existing.status !== 'APPROVED') {
      await LeaveService.assertCanTakeLeave({
        employeeId: existing.employeeId,
        type: existing.type,
        startDate: existing.startDate,
        endDate: existing.endDate,
      });
    }

    const record = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status,
        approvedById: req.user.id,
        approvedAt: new Date(),
        decisionNote: decisionNote || null,
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeNo: true, email: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
      },
    });

    if (status === 'APPROVED' && existing.status !== 'APPROVED') {
      await LeaveService.applyUsage(
        existing.employeeId,
        existing.type,
        existing.startDate,
        existing.endDate,
        1
      );
    } else if (
      existing.status === 'APPROVED' &&
      (status === 'CANCELLED' || status === 'REJECTED')
    ) {
      await LeaveService.applyUsage(
        existing.employeeId,
        existing.type,
        existing.startDate,
        existing.endDate,
        -1
      );
    }

    await LeaveService.notifyRequesterOfDecision({
      requestedByUserId: existing.requestedByUserId,
      employeeEmail: existing.employee.email,
      status,
      type: existing.type,
      startDate: existing.startDate,
      endDate: existing.endDate,
      decisionNote,
    });

    res.json({ success: true, data: record });
  })
);

router.get(
  '/payroll',
  authorize('hr:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.PayrollRecordWhereInput = search
      ? {
          OR: [
            { employee: { firstName: { contains: search } } },
            { employee: { lastName: { contains: search } } },
            { employee: { employeeNo: { contains: search } } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.payrollRecord.findMany({
        where,
        skip,
        take: limit,
        include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payrollRecord.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/payroll',
  authorize('hr:create'),
  validate(createPayrollSchema),
  auditLog('hr', 'create', 'payroll_record'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { employeeId, periodStart, periodEnd, basicSalary, allowances } = req.body;
    const start = parseLocalDateInput(periodStart) || new Date(periodStart);
    const end = parseLocalDateInput(periodEnd) || new Date(periodEnd);
    const breakdown = calculateKenyaPayroll(Number(basicSalary), Number(allowances || 0));
    const availableForAdvance = Math.max(0, breakdown.netPay);

    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRecord.create({
        data: {
          employeeId,
          periodStart: start,
          periodEnd: end,
          basicSalary,
          allowances: allowances || 0,
          paye: breakdown.paye,
          nssf: breakdown.nssf,
          shif: breakdown.shif,
          housingLevy: breakdown.housingLevy,
          advanceDeduction: 0,
          deductions: breakdown.totalDeductions,
          netPay: breakdown.netPay,
        },
      });

      const { total: advanceDeduction, allocations } =
        await SalaryAdvanceService.schedulePayrollDeductions(
          tx,
          created.id,
          employeeId,
          end,
          availableForAdvance,
          req.user?.id
        );

      const netPay = Math.round((breakdown.netPay - advanceDeduction) * 100) / 100;
      return tx.payrollRecord.update({
        where: { id: created.id },
        data: {
          advanceDeduction,
          deductions: Math.round((breakdown.totalDeductions + advanceDeduction) * 100) / 100,
          netPay,
        },
        include: {
          employee: { select: { firstName: true, lastName: true, employeeNo: true } },
          advanceRepayments: {
            where: { isApplied: false },
            include: { advance: { select: { advanceNo: true } } },
          },
        },
      }).then((row) => ({ ...row, advanceAllocations: allocations }));
    });

    res.status(201).json({ success: true, data: record });
  })
);

router.post(
  '/payroll/calculate',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { basicSalary, allowances, employeeId, periodEnd } = req.body;
    const breakdown = calculateKenyaPayroll(Number(basicSalary), Number(allowances || 0));
    let advanceDeduction = 0;
    let advanceAllocations: { advanceId: string; amount: number; advanceNo: string }[] = [];

    if (employeeId) {
      const end = periodEnd
        ? parseLocalDateInput(String(periodEnd)) || new Date(periodEnd)
        : new Date();
      const planned = await SalaryAdvanceService.planDeductionsForEmployee(
        employeeId,
        end,
        Math.max(0, breakdown.netPay)
      );
      advanceDeduction = planned.total;
      advanceAllocations = planned.allocations;
    }

    const netPay = Math.round((breakdown.netPay - advanceDeduction) * 100) / 100;
    res.json({
      success: true,
      data: {
        ...breakdown,
        advanceDeduction,
        advanceAllocations,
        netPay,
        totalDeductions: Math.round((breakdown.totalDeductions + advanceDeduction) * 100) / 100,
      },
    });
  })
);

router.patch(
  '/payroll/:id/pay',
  authorize('hr:update'),
  auditLog('hr', 'update', 'payroll_record'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const payrollId = getParam(req.params.id);

    const record = await prisma.$transaction(async (tx) => {
      const existing = await tx.payrollRecord.findUnique({
        where: { id: payrollId },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
      if (!existing) throw new AppError('Payroll record not found', 404);
      if (existing.isPaid) throw new AppError('Payroll record already paid', 400);

      await SalaryAdvanceService.applyPayrollDeductions(tx, payrollId);

      await AccountingService.postPayrollPayment(tx, {
        id: existing.id,
        employeeName: `${existing.employee.firstName} ${existing.employee.lastName}`,
        periodLabel: `${existing.periodStart.toISOString().slice(0, 10)} to ${existing.periodEnd.toISOString().slice(0, 10)}`,
        basicSalary: Number(existing.basicSalary),
        allowances: Number(existing.allowances),
        paye: Number(existing.paye),
        nssf: Number(existing.nssf),
        shif: Number(existing.shif),
        housingLevy: Number(existing.housingLevy),
        netPay: Number(existing.netPay),
        advanceDeduction: Number(existing.advanceDeduction),
      });

      return tx.payrollRecord.update({
        where: { id: payrollId },
        data: { isPaid: true, paidAt: new Date() },
        include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
      });
    });

    res.json({ success: true, data: record });
  })
);

// ==================== Salary Advances ====================

router.get(
  '/advances/stats',
  authorize('hr:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/advances',
  authorize('hr:read'),
  validate(salaryAdvanceListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      employeeId?: string;
    }>(req.query);
    const result = await SalaryAdvanceService.list(query);
    res.json({ success: true, ...result });
  })
);

router.get(
  '/advances/:id',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.getById(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

router.post(
  '/advances',
  authorize('hr:create'),
  validate(createSalaryAdvanceSchema),
  auditLog('hr', 'create', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.create(req.body, req.user?.id);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  '/advances/:id',
  authorize('hr:update'),
  validate(updateSalaryAdvanceSchema),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.update(getParam(req.params.id), req.body);
    res.json({ success: true, data });
  })
);

router.patch(
  '/advances/:id/approve',
  authorize('hr:update'),
  validate(approveSalaryAdvanceSchema),
  auditLog('hr', 'approve', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) throw new AppError('Authentication required', 401);
    const data = await SalaryAdvanceService.approve(
      getParam(req.params.id),
      req.user.id,
      req.body.disburseNow !== false
    );
    res.json({ success: true, data });
  })
);

router.patch(
  '/advances/:id/reject',
  authorize('hr:update'),
  validate(rejectSalaryAdvanceSchema),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user?.id) throw new AppError('Authentication required', 401);
    const data = await SalaryAdvanceService.reject(
      getParam(req.params.id),
      req.user.id,
      req.body.reason
    );
    res.json({ success: true, data });
  })
);

router.patch(
  '/advances/:id/disburse',
  authorize('hr:update'),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.disburse(
      getParam(req.params.id),
      req.body?.method || 'CASH'
    );
    res.json({ success: true, data });
  })
);

router.post(
  '/advances/:id/repay',
  authorize('hr:update'),
  validate(repaySalaryAdvanceSchema),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.recordManualRepayment(
      getParam(req.params.id),
      req.body,
      req.user?.id
    );
    res.json({ success: true, data });
  })
);

router.patch(
  '/advances/:id/cancel',
  authorize('hr:update'),
  validate(cancelSalaryAdvanceSchema),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.cancel(getParam(req.params.id), req.body.reason);
    res.json({ success: true, data });
  })
);

router.patch(
  '/advances/:id/write-off',
  authorize('hr:update'),
  validate(cancelSalaryAdvanceSchema),
  auditLog('hr', 'update', 'salary_advance'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await SalaryAdvanceService.writeOff(
      getParam(req.params.id),
      req.body.reason,
      req.user?.id
    );
    res.json({ success: true, data });
  })
);

export default router;
