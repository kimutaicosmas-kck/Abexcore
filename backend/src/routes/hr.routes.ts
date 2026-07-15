import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createEmployeeSchema,
  hrListQuerySchema,
  paginationSchema,
  approveLeaveSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';
import { HrService } from '../services/admin.service';
import { calculateKenyaPayroll } from '../services/payroll.service';
import { AccountingService } from '../services/accounting.service';
import { Prisma } from '@prisma/client';

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

    const [data, total] = await Promise.all([
      prisma.employee.findMany({
        where,
        skip,
        take: limit,
        include: { department: true, branch: true },
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

router.get(
  '/employees/:id',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.employee.findFirst({
      where: { id: getParam(req.params.id), deletedAt: null },
      include: { department: true, branch: true },
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
    const { hireDate, ...rest } = req.body;
    const employee = await prisma.employee.create({
      data: { ...rest, hireDate: new Date(hireDate) },
      include: { department: true, branch: true },
    });
    res.status(201).json({ success: true, data: employee });
  })
);

router.put(
  '/employees/:id',
  authorize('hr:update'),
  validate(createEmployeeSchema.partial()),
  auditLog('hr', 'update', 'employee'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { hireDate, ...rest } = req.body;
    const employee = await prisma.employee.update({
      where: { id: getParam(req.params.id) },
      data: { ...rest, ...(hireDate ? { hireDate: new Date(hireDate) } : {}) },
      include: { department: true, branch: true },
    });
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
        include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
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
  auditLog('hr', 'create', 'leave_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { employeeId, type, startDate, endDate, reason } = req.body;
    const record = await prisma.leaveRequest.create({
      data: {
        employeeId,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
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
    const record = await prisma.leaveRequest.update({
      where: { id: getParam(req.params.id) },
      data: { status: req.body.status },
      include: { employee: { select: { firstName: true, lastName: true } } },
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
  auditLog('hr', 'create', 'payroll_record'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { employeeId, periodStart, periodEnd, basicSalary, allowances } = req.body;
    const breakdown = calculateKenyaPayroll(Number(basicSalary), Number(allowances || 0));

    const record = await prisma.payrollRecord.create({
      data: {
        employeeId,
        periodStart: new Date(periodStart),
        periodEnd: new Date(periodEnd),
        basicSalary,
        allowances: allowances || 0,
        paye: breakdown.paye,
        nssf: breakdown.nssf,
        shif: breakdown.shif,
        housingLevy: breakdown.housingLevy,
        deductions: breakdown.totalDeductions,
        netPay: breakdown.netPay,
      },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    res.status(201).json({ success: true, data: record });
  })
);

router.post(
  '/payroll/calculate',
  authorize('hr:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { basicSalary, allowances } = req.body;
    const breakdown = calculateKenyaPayroll(Number(basicSalary), Number(allowances || 0));
    res.json({ success: true, data: breakdown });
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
      });

      return tx.payrollRecord.update({
        where: { id: payrollId },
        data: { isPaid: true, paidAt: new Date() },
        include: { employee: { select: { firstName: true, lastName: true } } },
      });
    });

    res.json({ success: true, data: record });
  })
);

export default router;
