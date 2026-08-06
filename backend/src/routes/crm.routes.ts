import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createComplaintSchema,
  createOpportunitySchema,
  updateOpportunitySchema,
  resolveComplaintSchema,
  createWarrantySchema,
  crmListQuerySchema,
  paginationSchema,
} from '../validators/schemas';
import { CrmService } from '../services/crm.service';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';
import { Prisma } from '@prisma/client';
import { isSalesBookOwner } from '../config/rolePermissions';

const router = Router();
router.use(authenticate);

const STAGE_ORDER = ['PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON'];

function bookOwnerId(req: AuthRequest): string | undefined {
  return isSalesBookOwner(req.user?.roleName) ? req.user!.id : undefined;
}

/** Limit CRM rows to customers assigned to the current salesperson. */
function applySalesBookCustomerFilter<T extends { customer?: Prisma.CustomerWhereInput }>(
  where: T,
  salesPersonId: string | undefined
): T {
  if (!salesPersonId) return where;
  const existing =
    where.customer && typeof where.customer === 'object' ? where.customer : {};
  where.customer = { ...existing, salesPersonId };
  return where;
}

router.get(
  '/stats',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await CrmService.getStats(bookOwnerId(req));
    res.json({ success: true, data });
  })
);

router.get(
  '/complaints',
  authorize('customers:read'),
  validate(crmListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status, priority, customerId } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      priority?: string;
      customerId?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.ComplaintWhereInput = {};
    if (status === 'open') {
      where.status = { in: ['PENDING', 'DRAFT'] };
      where.resolvedAt = null;
    } else if (status === 'resolved') {
      where.OR = [{ status: 'APPROVED' }, { resolvedAt: { not: null } }];
    } else if (status) {
      where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
    }
    if (priority) where.priority = priority;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          OR: [
            { subject: { contains: search } },
            { description: { contains: search } },
            { customer: { name: { contains: search } } },
          ],
        },
      ];
    }
    applySalesBookCustomerFilter(where, bookOwnerId(req));

    const [data, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        skip,
        take: limit,
        include: { customer: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.complaint.count({ where }),
    ]);
    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.get(
  '/complaints/:id',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.complaint.findUnique({
      where: { id: getParam(req.params.id) },
      include: { customer: true },
    });
    if (!data) throw new AppError('Complaint not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/complaints',
  authorize('customers:create'),
  validate(createComplaintSchema),
  auditLog('customers', 'create', 'complaint'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.complaint.create({
      data: {
        ...req.body,
        priority: (req.body.priority || 'medium').toLowerCase(),
      },
      include: { customer: true },
    });
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  '/complaints/:id/resolve',
  authorize('customers:update'),
  validate(resolveComplaintSchema),
  auditLog('customers', 'resolve', 'complaint'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { resolution, status } = req.body;
    const data = await prisma.complaint.update({
      where: { id: getParam(req.params.id) },
      data: {
        resolution,
        status: status || 'APPROVED',
        resolvedAt: new Date(),
      },
      include: { customer: true },
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/opportunities',
  authorize('customers:read'),
  validate(crmListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status, stage, customerId } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      stage?: string;
      customerId?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.OpportunityWhereInput = {};
    if (status === 'open') {
      where.status = { in: ['PENDING', 'APPROVED'] };
      where.NOT = { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } };
    } else if (status === 'won') {
      where.stage = { in: ['CLOSED_WON', 'closed_won'] };
    } else if (status === 'lost') {
      where.stage = { in: ['CLOSED_LOST', 'closed_lost'] };
    } else if (status) {
      where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
    }
    if (stage) where.stage = stage;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { notes: { contains: search } },
        { customer: { name: { contains: search } } },
      ];
    }
    applySalesBookCustomerFilter(where, bookOwnerId(req));

    const [data, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        skip,
        take: limit,
        include: { customer: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.opportunity.count({ where }),
    ]);
    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.get(
  '/opportunities/:id',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.opportunity.findUnique({
      where: { id: getParam(req.params.id) },
      include: { customer: true },
    });
    if (!data) throw new AppError('Opportunity not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/opportunities',
  authorize('customers:create'),
  validate(createOpportunitySchema),
  auditLog('customers', 'create', 'opportunity'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { expectedCloseDate, ...rest } = req.body;
    const data = await prisma.opportunity.create({
      data: {
        ...rest,
        stage: rest.stage || 'PROSPECTING',
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : undefined,
      },
      include: { customer: true },
    });
    res.status(201).json({ success: true, data });
  })
);

router.put(
  '/opportunities/:id',
  authorize('customers:update'),
  validate(updateOpportunitySchema),
  auditLog('customers', 'update', 'opportunity'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { expectedCloseDate, ...rest } = req.body;
    const data = await prisma.opportunity.update({
      where: { id: getParam(req.params.id) },
      data: {
        ...rest,
        ...(expectedCloseDate !== undefined
          ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null }
          : {}),
      },
      include: { customer: true },
    });
    res.json({ success: true, data });
  })
);

router.patch(
  '/opportunities/:id/advance',
  authorize('customers:update'),
  auditLog('customers', 'advance', 'opportunity'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const opp = await prisma.opportunity.findUnique({ where: { id: getParam(req.params.id) } });
    if (!opp) throw new AppError('Opportunity not found', 404);

    const currentStage = (opp.stage || 'PROSPECTING').toUpperCase();
    const idx = STAGE_ORDER.indexOf(currentStage);
    const nextStage = idx >= 0 && idx < STAGE_ORDER.length - 1 ? STAGE_ORDER[idx + 1] : currentStage;

    const data = await prisma.opportunity.update({
      where: { id: opp.id },
      data: {
        stage: nextStage,
        status: nextStage === 'CLOSED_WON' ? 'APPROVED' : opp.status,
        probability: nextStage === 'CLOSED_WON' ? 100 : Math.min(Number(opp.probability) + 15, 95),
      },
      include: { customer: true },
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/warranties',
  authorize('customers:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.WarrantyWhereInput = search
      ? {
          OR: [
            { serialNumber: { contains: search } },
            { customer: { name: { contains: search } } },
            { product: { name: { contains: search } } },
          ],
        }
      : {};
    applySalesBookCustomerFilter(where, bookOwnerId(req));

    const [data, total] = await Promise.all([
      prisma.warranty.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true } },
        },
        orderBy: { endDate: 'asc' },
      }),
      prisma.warranty.count({ where }),
    ]);
    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

router.post(
  '/warranties',
  authorize('customers:create'),
  validate(createWarrantySchema),
  auditLog('customers', 'create', 'warranty'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { startDate, endDate, ...rest } = req.body;
    const data = await prisma.warranty.create({
      data: {
        ...rest,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      },
      include: { customer: true, product: true },
    });
    res.status(201).json({ success: true, data });
  })
);

export default router;
