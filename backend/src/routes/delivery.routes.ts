import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createDeliverySchema, paginationSchema } from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get('/vehicles', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.vehicle.findMany({ where: { isActive: true } });
  res.json({ success: true, data });
}));

router.post('/vehicles', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.vehicle.create({ data: req.body });
  res.status(201).json({ success: true, data });
}));

router.get('/', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.deliveryNote.findMany({
      skip, take: limit,
      include: {
        salesOrder: { include: { customer: true } },
        vehicle: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.deliveryNote.count(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/', validate(createDeliverySchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { salesOrderId, vehicleId, scheduledDate, notes, items } = req.body;
  const count = await prisma.deliveryNote.count();
  const deliveryNo = generateNumber('DN', count + 1);

  const delivery = await prisma.deliveryNote.create({
    data: {
      deliveryNo,
      salesOrderId,
      vehicleId,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      notes,
      items: { create: items },
    },
    include: { salesOrder: { include: { customer: true } }, vehicle: true, items: true },
  });

  await prisma.salesOrder.update({
    where: { id: salesOrderId },
    data: { status: 'DISPATCHED' },
  });

  res.status(201).json({ success: true, data: delivery });
}));

router.patch('/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, proofOfDelivery } = req.body;
  const delivery = await prisma.deliveryNote.update({
    where: { id: getParam(req.params.id) },
    data: {
      status,
      proofOfDelivery,
      deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
    },
    include: { salesOrder: { include: { customer: true } } },
  });

  if (status === 'DELIVERED') {
    await prisma.salesOrder.update({
      where: { id: delivery.salesOrderId },
      data: { status: 'DELIVERED' },
    });
  }

  res.json({ success: true, data: delivery });
}));

export default router;
