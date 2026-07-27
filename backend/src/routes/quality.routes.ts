import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createQualityInspectionSchema,
  updateQualityInspectionSchema,
  qualityListQuerySchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { nextQualityInspectionNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { QualityService } from '../services/operations.service';
import { Prisma } from '@prisma/client';
import { requireTenantId } from '../utils/tenant';

const router = Router();
router.use(authenticate);

router.get(
  '/stats',
  authorize('quality:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await QualityService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/',
  authorize('quality:read'),
  validate(qualityListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status, type, productionOrderId, productId } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      type?: string;
      productionOrderId?: string;
      productId?: string;
    }>(req.query);
    const companyId = requireTenantId();
    const skip = (page - 1) * limit;

    const where: Prisma.QualityInspectionWhereInput = { companyId };
    if (status) where.status = status as Prisma.EnumQualityStatusFilter['equals'];
    if (type) where.type = type;
    if (productionOrderId) where.productionOrderId = productionOrderId;
    if (productId) where.productId = productId;
    if (search) {
      where.OR = [
        { inspectionNo: { contains: search } },
        { type: { contains: search } },
        { result: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.qualityInspection.findMany({
        where,
        skip,
        take: limit,
        include: {
          goodsReceipt: { select: { grnNumber: true } },
          productionOrder: {
            select: { orderNumber: true, product: { select: { name: true, sku: true } } },
          },
          product: { select: { name: true, sku: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.qualityInspection.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/:id',
  authorize('quality:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const data = await prisma.qualityInspection.findFirst({
      where: { id: getParam(req.params.id), companyId },
      include: {
        goodsReceipt: { include: { supplier: { select: { name: true } } } },
        productionOrder: {
          include: { product: { select: { name: true, sku: true } }, machine: true },
        },
        product: { select: { name: true, sku: true } },
      },
    });
    if (!data) throw new AppError('Inspection not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authorize('quality:create'),
  validate(createQualityInspectionSchema),
  auditLog('quality', 'create', 'quality_inspection'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body;
    const data = await prisma.$transaction(async (tx) => {
      const inspection = await tx.qualityInspection.create({
        data: {
          inspectionNo: await nextQualityInspectionNumber(tx),
          ...body,
          inspectorId: req.user!.id,
          inspectedAt: body.status && body.status !== 'PENDING' ? new Date() : undefined,
        },
        include: {
          goodsReceipt: { select: { grnNumber: true, id: true } },
          productionOrder: { select: { orderNumber: true } },
          product: { select: { name: true, sku: true } },
        },
      });

      if (body.goodsReceiptId && body.status && body.status !== 'PENDING') {
        await tx.goodsReceipt.update({
          where: { id: body.goodsReceiptId },
          data: { inspectionStatus: body.status },
        });
      }

      return inspection;
    });

    res.status(201).json({ success: true, data });
  })
);

router.patch(
  '/:id',
  authorize('quality:update'),
  validate(updateQualityInspectionSchema),
  auditLog('quality', 'update', 'quality_inspection'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.$transaction(async (tx) => {
      const inspection = await tx.qualityInspection.update({
        where: { id: getParam(req.params.id) },
        data: {
          ...req.body,
          inspectedAt: req.body.status && req.body.status !== 'PENDING' ? new Date() : undefined,
        },
        include: {
          goodsReceipt: { select: { grnNumber: true, id: true } },
          productionOrder: { select: { orderNumber: true, product: { select: { name: true } } } },
        },
      });

      if (inspection.goodsReceiptId && req.body.status && req.body.status !== 'PENDING') {
        await tx.goodsReceipt.update({
          where: { id: inspection.goodsReceiptId },
          data: { inspectionStatus: req.body.status },
        });
      }

      return inspection;
    });
    res.json({ success: true, data });
  })
);

export default router;
