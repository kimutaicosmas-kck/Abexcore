import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { createSalesOrderSchema, createProductionOrderSchema, paginationSchema } from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

// Sales Orders
router.get('/orders', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.salesOrder.findMany({
      skip,
      take: limit,
      include: { customer: true, items: { include: { product: true } }, createdBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.salesOrder.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/orders', validate(createSalesOrderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, quotationId, requiredDate, notes, items } = req.body;
  const count = await prisma.salesOrder.count();
  const orderNumber = generateNumber('SO', count + 1);

  const subtotal = items.reduce(
    (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) => {
      const discount = item.discount || 0;
      return sum + item.quantity * item.unitPrice * (1 - discount / 100);
    },
    0
  );
  const taxAmount = subtotal * 0.16;
  const totalAmount = subtotal + taxAmount;

  const order = await prisma.salesOrder.create({
    data: {
      orderNumber,
      customerId,
      quotationId,
      createdById: req.user!.id,
      requiredDate: requiredDate ? new Date(requiredDate) : undefined,
      notes,
      subtotal,
      taxAmount,
      totalAmount,
      items: {
        create: items.map((item: { productId: string; quantity: number; unitPrice: number; discount?: number }) => ({
          ...item,
          totalPrice: item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
        })),
      },
    },
    include: { customer: true, items: { include: { product: true } } },
  });

  res.status(201).json({ success: true, data: order });
}));

router.patch('/orders/:id/status', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const order = await prisma.salesOrder.update({
    where: { id: getParam(req.params.id) },
    data: { status },
    include: { customer: true, items: { include: { product: true } } },
  });
  res.json({ success: true, data: order });
}));

// Quotations
router.get('/quotations', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.salesQuotation.findMany({
      skip,
      take: limit,
      include: { customer: true, items: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.salesQuotation.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

// Production Orders
router.get('/production', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.productionOrder.findMany({
      skip,
      take: limit,
      include: {
        product: true,
        machine: true,
        assignedTo: { select: { firstName: true, lastName: true } },
        consumption: { include: { rawMaterial: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.productionOrder.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/production', validate(createProductionOrderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { productId, salesOrderId, machineId, quantity, priority, scheduledStart, scheduledEnd, notes } = req.body;
  const count = await prisma.productionOrder.count();
  const orderNumber = generateNumber('PRO', count + 1);

  const bom = await prisma.billOfMaterial.findUnique({
    where: { productId },
    include: { items: true },
  });

  const productionOrder = await prisma.productionOrder.create({
    data: {
      orderNumber,
      productId,
      salesOrderId,
      machineId,
      assignedToId: req.user!.id,
      quantity,
      priority,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
      scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : undefined,
      notes,
      consumption: bom
        ? {
            create: bom.items.map((item) => ({
              rawMaterialId: item.rawMaterialId,
              plannedQty: Number(item.quantity) * quantity,
              unit: item.unit,
            })),
          }
        : undefined,
    },
    include: {
      product: true,
      consumption: { include: { rawMaterial: true } },
    },
  });

  res.status(201).json({ success: true, data: productionOrder });
}));

router.post('/production/:id/start', asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.productionOrder.update({
    where: { id: getParam(req.params.id) },
    data: { status: 'IN_PROGRESS', actualStart: new Date() },
  });
  res.json({ success: true, data: order });
}));

router.post('/production/:id/complete', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { completedQty, rejectedQty, warehouseId } = req.body;

  const order = await prisma.productionOrder.findUnique({
    where: { id: getParam(req.params.id) },
    include: { consumption: true, product: true },
  });

  if (!order) throw new AppError('Production order not found', 404);

  const result = await prisma.$transaction(async (tx) => {
    for (const consumption of order.consumption) {
      const stockLevel = await tx.stockLevel.findFirst({
        where: { rawMaterialId: consumption.rawMaterialId, warehouseId },
      });

      if (stockLevel) {
        const newQty = Number(stockLevel.quantity) - Number(consumption.plannedQty);
        if (newQty < 0) throw new AppError(`Insufficient ${consumption.rawMaterialId} stock`, 400);

        await tx.stockLevel.update({
          where: { id: stockLevel.id },
          data: { quantity: newQty },
        });

        await tx.inventoryTransaction.create({
          data: {
            warehouseId,
            type: 'PRODUCTION_CONSUMPTION',
            rawMaterialId: consumption.rawMaterialId,
            quantity: Number(consumption.plannedQty),
            referenceType: 'production_order',
            referenceId: order.id,
            createdById: req.user!.id,
          },
        });
      }
    }

    const batchNumber = generateNumber('BATCH', await tx.productionBatch.count() + 1);

    await tx.productionBatch.create({
      data: {
        productionOrderId: order.id,
        batchNumber,
        quantity: completedQty,
      },
    });

    const fgStock = await tx.stockLevel.findFirst({
      where: { productId: order.productId, warehouseId },
    });

    if (fgStock) {
      await tx.stockLevel.update({
        where: { id: fgStock.id },
        data: { quantity: { increment: completedQty } },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          warehouseId,
          productId: order.productId,
          batchNumber,
          quantity: completedQty,
          unitCost: order.product.manufacturingCost,
        },
      });
    }

    await tx.inventoryTransaction.create({
      data: {
        warehouseId,
        type: 'PRODUCTION_OUTPUT',
        productId: order.productId,
        batchNumber,
        quantity: completedQty,
        referenceType: 'production_order',
        referenceId: order.id,
        createdById: req.user!.id,
      },
    });

    return tx.productionOrder.update({
      where: { id: order.id },
      data: {
        status: 'COMPLETED',
        actualEnd: new Date(),
        completedQty,
        rejectedQty: rejectedQty || 0,
      },
      include: { product: true, batches: true },
    });
  });

  res.json({ success: true, data: result });
}));

export default router;
