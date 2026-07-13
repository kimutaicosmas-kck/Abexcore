import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createQualityInspectionSchema, paginationSchema } from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

router.get('/', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    prisma.qualityInspection.findMany({
      skip, take: limit,
      include: {
        goodsReceipt: { select: { grnNumber: true } },
        productionOrder: { select: { orderNumber: true, product: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.qualityInspection.count(),
  ]);
  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/', validate(createQualityInspectionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.qualityInspection.count();
  const inspectionNo = generateNumber('QC', count + 1);
  const data = await prisma.qualityInspection.create({
    data: {
      inspectionNo,
      ...req.body,
      inspectorId: req.user!.id,
      inspectedAt: req.body.status && req.body.status !== 'PENDING' ? new Date() : undefined,
    },
  });
  res.status(201).json({ success: true, data });
}));

router.patch('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.qualityInspection.update({
    where: { id: getParam(req.params.id) },
    data: { ...req.body, inspectedAt: new Date() },
  });
  res.json({ success: true, data });
}));

export default router;
