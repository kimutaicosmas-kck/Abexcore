import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import {
  createComplaintSchema,
  createOpportunitySchema,
  paginationSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get('/complaints', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.complaint.findMany({
      skip, take: limit,
      include: { customer: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.complaint.count(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/complaints', validate(createComplaintSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.complaint.create({
    data: req.body,
    include: { customer: true },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/complaints/:id/resolve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { resolution, status } = req.body;
  const data = await prisma.complaint.update({
    where: { id: getParam(req.params.id) },
    data: {
      resolution,
      status: status || 'APPROVED',
      resolvedAt: new Date(),
    },
  });
  res.json({ success: true, data });
}));

router.get('/opportunities', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.opportunity.findMany({
      skip, take: limit,
      include: { customer: { select: { name: true, code: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.opportunity.count(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/opportunities', validate(createOpportunitySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { expectedCloseDate, ...rest } = req.body;
  const data = await prisma.opportunity.create({
    data: {
      ...rest,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : undefined,
    },
    include: { customer: true },
  });
  res.status(201).json({ success: true, data });
}));

router.get('/warranties', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.warranty.findMany({
    include: { customer: true, product: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/warranties', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, productId, serialNumber, startDate, endDate, notes } = req.body;
  const data = await prisma.warranty.create({
    data: {
      customerId, productId, serialNumber,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      notes,
    },
    include: { customer: true, product: true },
  });
  res.status(201).json({ success: true, data });
}));

export default router;
