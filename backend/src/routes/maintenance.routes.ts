import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createMaintenanceSchema } from '../validators/schemas';
import prisma from '../config/database';
import { getParam } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get('/machines', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.machine.findMany({
    include: { maintenanceRequests: { take: 3, orderBy: { createdAt: 'desc' } } },
  });
  res.json({ success: true, data });
}));

router.post('/machines', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.machine.create({ data: req.body });
  res.status(201).json({ success: true, data });
}));

router.get('/requests', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.maintenanceRequest.findMany({
    include: { machine: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/requests', validate(createMaintenanceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { scheduledDate, ...rest } = req.body;
  const data = await prisma.maintenanceRequest.create({
    data: {
      ...rest,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
    },
    include: { machine: true },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/requests/:id/complete', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { cost, notes } = req.body;
  const data = await prisma.maintenanceRequest.update({
    where: { id: getParam(req.params.id) },
    data: { status: 'COMPLETED', completedDate: new Date(), cost, notes },
    include: { machine: true },
  });
  res.json({ success: true, data });
}));

export default router;
