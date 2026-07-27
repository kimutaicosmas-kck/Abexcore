import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createMaintenanceSchema,
  createMachineSchema,
  maintenanceListQuerySchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';
import { requireTenantId } from '../utils/tenant';
import { MaintenanceService } from '../services/admin.service';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

router.get(
  '/stats',
  authorize('maintenance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await MaintenanceService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/machines',
  authorize('maintenance:read'),
  validate(maintenanceListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.MachineWhereInput = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
        { type: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.machine.findMany({
        where,
        skip,
        take: limit,
        include: { maintenanceRequests: { take: 3, orderBy: { createdAt: 'desc' } } },
        orderBy: { name: 'asc' },
      }),
      prisma.machine.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/machines',
  authorize('maintenance:create'),
  validate(createMachineSchema),
  auditLog('maintenance', 'create', 'machine'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const existing = await prisma.machine.findUnique({
      where: { companyId_code: { companyId: requireTenantId(), code: req.body.code } },
    });
    if (existing) throw new AppError('Machine code already exists', 409);

    const data = await prisma.machine.create({ data: req.body });
    res.status(201).json({ success: true, data });
  })
);

router.get(
  '/requests',
  authorize('maintenance:read'),
  validate(maintenanceListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.MaintenanceRequestWhereInput = {};
    if (status) where.status = status as Prisma.EnumMaintenanceStatusFilter['equals'];
    if (search) {
      where.OR = [
        { description: { contains: search } },
        { type: { contains: search } },
        { machine: { name: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        include: { machine: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.maintenanceRequest.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/requests/:id',
  authorize('maintenance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.maintenanceRequest.findUnique({
      where: { id: getParam(req.params.id) },
      include: { machine: true },
    });
    if (!data) throw new AppError('Maintenance request not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/requests',
  authorize('maintenance:create'),
  validate(createMaintenanceSchema),
  auditLog('maintenance', 'create', 'maintenance_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { scheduledDate, ...rest } = req.body;
    const data = await prisma.maintenanceRequest.create({
      data: {
        ...rest,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      },
      include: { machine: true },
    });
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  '/requests/:id/complete',
  authorize('maintenance:update'),
  auditLog('maintenance', 'update', 'maintenance_request'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { cost, notes } = req.body;
    const data = await prisma.maintenanceRequest.update({
      where: { id: getParam(req.params.id) },
      data: { status: 'COMPLETED', completedDate: new Date(), cost, notes },
      include: { machine: true },
    });
    res.json({ success: true, data });
  })
);

export default router;
