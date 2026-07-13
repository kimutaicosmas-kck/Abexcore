import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createEmployeeSchema, paginationSchema } from '../validators/schemas';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get('/employees', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      skip, take: limit, where: { deletedAt: null },
      include: { department: true, branch: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.employee.count({ where: { deletedAt: null } }),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/employees', validate(createEmployeeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { hireDate, ...rest } = req.body;
  const employee = await prisma.employee.create({
    data: { ...rest, hireDate: new Date(hireDate) },
    include: { department: true, branch: true },
  });
  res.status(201).json({ success: true, data: employee });
}));

router.put('/employees/:id', validate(createEmployeeSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { hireDate, ...rest } = req.body;
  const employee = await prisma.employee.update({
    where: { id: getParam(req.params.id) },
    data: { ...rest, ...(hireDate ? { hireDate: new Date(hireDate) } : {}) },
    include: { department: true, branch: true },
  });
  res.json({ success: true, data: employee });
}));

router.get('/attendance', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.attendance.findMany({
      skip, take: limit,
      include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.attendance.count(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/attendance', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, date, checkIn, checkOut, status, notes } = req.body;
  const record = await prisma.attendance.upsert({
    where: { employeeId_date: { employeeId, date: new Date(date) } },
    create: {
      employeeId, date: new Date(date),
      checkIn: checkIn ? new Date(checkIn) : undefined,
      checkOut: checkOut ? new Date(checkOut) : undefined,
      status: status || 'present', notes,
    },
    update: {
      checkIn: checkIn ? new Date(checkIn) : undefined,
      checkOut: checkOut ? new Date(checkOut) : undefined,
      status, notes,
    },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  res.status(201).json({ success: true, data: record });
}));

router.get('/leave', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.leaveRequest.findMany({
    include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/leave', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, type, startDate, endDate, reason } = req.body;
  const record = await prisma.leaveRequest.create({
    data: { employeeId, type, startDate: new Date(startDate), endDate: new Date(endDate), reason },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  res.status(201).json({ success: true, data: record });
}));

router.patch('/leave/:id/approve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const record = await prisma.leaveRequest.update({
    where: { id: getParam(req.params.id) },
    data: { status },
  });
  res.json({ success: true, data: record });
}));

router.get('/payroll', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.payrollRecord.findMany({
    include: { employee: { select: { firstName: true, lastName: true, employeeNo: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/payroll', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { employeeId, periodStart, periodEnd, basicSalary, allowances, deductions } = req.body;
  const netPay = Number(basicSalary) + Number(allowances || 0) - Number(deductions || 0);
  const record = await prisma.payrollRecord.create({
    data: {
      employeeId,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      basicSalary, allowances: allowances || 0, deductions: deductions || 0, netPay,
    },
    include: { employee: { select: { firstName: true, lastName: true } } },
  });
  res.status(201).json({ success: true, data: record });
}));

router.patch('/payroll/:id/pay', asyncHandler(async (req: AuthRequest, res: Response) => {
  const record = await prisma.payrollRecord.update({
    where: { id: getParam(req.params.id) },
    data: { isPaid: true, paidAt: new Date() },
  });
  res.json({ success: true, data: record });
}));

export default router;
