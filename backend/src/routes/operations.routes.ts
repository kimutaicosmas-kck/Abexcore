import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createSalesOrderSchema,
  createProductionOrderSchema,
  createQuotationSchema,
  salesListQuerySchema,
  paginationSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { SalesService } from '../services/operations.service';
import { getVatRate, calcTax } from '../utils/company';
import { assertCreditLimit, assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';
import { StockMovementService } from '../services/inventory.service';
import { SalesOrderService } from '../services/sales-order.service';
import { AccountingService } from '../services/accounting.service';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

router.get(
  '/stats',
  authorize('sales:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await SalesService.getStats();
    res.json({ success: true, data });
  })
);

// Sales Orders
router.get(
  '/orders',
  authorize('sales:read'),
  validate(salesListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.SalesOrderWhereInput = {};
    if (status) where.status = status as Prisma.EnumOrderStatusFilter['equals'];
    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { code: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: true,
          items: { include: { product: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          deliveries: { select: { id: true, deliveryNo: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.salesOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/orders/:id',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.salesOrder.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        customer: true,
        quotation: { select: { quotationNo: true, status: true } },
        items: { include: { product: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        deliveries: { include: { vehicle: true } },
        productionOrders: { select: { id: true, orderNumber: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, deliveryNoteId: true } },
      },
    });
    if (!data) throw new AppError('Sales order not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/orders',
  authorize('sales:create'),
  validate(createSalesOrderSchema),
  auditLog('sales', 'create', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { customerId, quotationId, requiredDate, notes, items } = req.body;
    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);
    const vatRate = await getVatRate();

    const subtotal = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) => {
        const discount = item.discount || 0;
        return sum + item.quantity * item.unitPrice * (1 - discount / 100);
      },
      0
    );
    const taxAmount = calcTax(subtotal, vatRate);
    const totalAmount = subtotal + taxAmount;

    await assertCreditLimit(customerId, totalAmount);

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
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

      await syncCustomerCreditUsed(customerId, tx);
      return created;
    });

    res.status(201).json({ success: true, data: order });
  })
);

router.patch(
  '/orders/:id/status',
  authorize('sales:update'),
  auditLog('sales', 'update', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status } = req.body;
    const orderId = getParam(req.params.id);
    const existing = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existing) throw new AppError('Sales order not found', 404);
    assertOrderStatusTransition(existing.status, status);

    const order = await prisma.$transaction(async (tx) => {
      if (status === 'CONFIRMED' && existing.status === 'PENDING') {
        for (const item of existing.items) {
          await StockMovementService.reserveProductStock(tx, {
            productId: item.productId,
            quantity: item.quantity,
          });
        }
      }

      if (status === 'READY' && existing.status === 'IN_PRODUCTION') {
        const hasOpenProduction = await SalesOrderService.hasOpenProduction(tx, existing.id);
        if (hasOpenProduction) {
          throw new AppError('Complete all production orders before marking ready', 400);
        }
      }

      if (status === 'CANCELLED' && ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'PARTIALLY_DELIVERED'].includes(existing.status)) {
        await StockMovementService.releaseSalesOrderReservations(tx, existing.id, existing.items);
      }

      const updated = await tx.salesOrder.update({
        where: { id: orderId },
        data: { status },
        include: { customer: true, items: { include: { product: true } } },
      });

      await syncCustomerCreditUsed(existing.customerId, tx);
      return updated;
    });

    res.json({ success: true, data: order });
  })
);

// Quotations
router.get(
  '/quotations',
  authorize('sales:read'),
  validate(salesListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.SalesQuotationWhereInput = {};
    if (status) where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
    if (search) {
      where.OR = [
        { quotationNo: { contains: search } },
        { customer: { name: { contains: search } } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.salesQuotation.findMany({
        where,
        skip,
        take: limit,
        include: { customer: true, items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.salesQuotation.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/quotations/:id',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.salesQuotation.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        customer: true,
        items: { include: { product: true } },
        salesOrders: { select: { id: true, orderNumber: true, status: true } },
      },
    });
    if (!data) throw new AppError('Quotation not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/quotations',
  authorize('sales:create'),
  validate(createQuotationSchema),
  auditLog('sales', 'create', 'sales_quotation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { customerId, validUntil, notes, items } = req.body;
    const count = await prisma.salesQuotation.count();
    const quotationNo = generateNumber('QT', count + 1);
    const vatRate = await getVatRate();

    const subtotal = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) =>
        sum + item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
      0
    );
    const taxAmount = calcTax(subtotal, vatRate);
    const totalAmount = subtotal + taxAmount;

    const quotation = await prisma.salesQuotation.create({
      data: {
        quotationNo,
        customerId,
        validUntil: validUntil ? new Date(validUntil) : undefined,
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

    res.status(201).json({ success: true, data: quotation });
  })
);

router.post(
  '/quotations/:id/convert',
  authorize('sales:create'),
  auditLog('sales', 'create', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const quotation = await prisma.salesQuotation.findUnique({
      where: { id: getParam(req.params.id) },
      include: { items: true, salesOrders: { select: { id: true } } },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);
    if (quotation.status === 'REJECTED' || quotation.status === 'CANCELLED') {
      throw new AppError('Quotation cannot be converted', 400);
    }
    if (quotation.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted', 400);
    }

    await assertCreditLimit(quotation.customerId, Number(quotation.totalAmount));

    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);

    const order = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: {
          orderNumber,
          customerId: quotation.customerId,
          quotationId: quotation.id,
          createdById: req.user!.id,
          subtotal: quotation.subtotal,
          taxAmount: quotation.taxAmount,
          totalAmount: quotation.totalAmount,
          items: {
            create: quotation.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              totalPrice: item.totalPrice,
            })),
          },
        },
        include: { customer: true, items: { include: { product: true } } },
      });

      await tx.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: 'APPROVED' },
      });

      await syncCustomerCreditUsed(quotation.customerId, tx);
      return so;
    });

    res.status(201).json({ success: true, data: order });
  })
);

router.get(
  '/machines',
  authorize('production:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await prisma.machine.findMany({ where: { isActive: true } });
    res.json({ success: true, data });
  })
);

// Production Orders
router.get(
  '/production',
  authorize('production:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.ProductionOrderWhereInput = search
      ? {
          OR: [
            { orderNumber: { contains: search } },
            { product: { name: { contains: search } } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.productionOrder.findMany({
        where,
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
      prisma.productionOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/production',
  authorize('production:create'),
  validate(createProductionOrderSchema),
  auditLog('production', 'create', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { productId, salesOrderId, machineId, quantity, priority, scheduledStart, scheduledEnd, notes } = req.body;
    const count = await prisma.productionOrder.count();
    const orderNumber = generateNumber('PRO', count + 1);

    const bom = await prisma.billOfMaterial.findUnique({
      where: { productId },
      include: { items: true },
    });

    const productionOrder = await prisma.$transaction(async (tx) => {
      const created = await tx.productionOrder.create({
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

      if (salesOrderId) {
        await SalesOrderService.maybeSetInProduction(tx, salesOrderId);
      }

      return created;
    });

    res.status(201).json({ success: true, data: productionOrder });
  })
);

router.post(
  '/production/:id/start',
  authorize('production:update'),
  auditLog('production', 'update', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const order = await prisma.productionOrder.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!order) throw new AppError('Production order not found', 404);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'IN_PROGRESS', actualStart: new Date() },
      });

      if (order.salesOrderId) {
        await SalesOrderService.maybeSetInProduction(tx, order.salesOrderId);
      }

      return updated;
    });

    res.json({ success: true, data: result });
  })
);

router.post(
  '/production/:id/complete',
  authorize('production:update'),
  auditLog('production', 'update', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { completedQty, rejectedQty, warehouseId } = req.body;

    const order = await prisma.productionOrder.findUnique({
      where: { id: getParam(req.params.id) },
      include: { consumption: true, product: true },
    });

    if (!order) throw new AppError('Production order not found', 404);

    const passedInspection = await prisma.qualityInspection.findFirst({
      where: { productionOrderId: order.id, status: 'PASSED' },
    });
    if (!passedInspection) {
      throw new AppError('A passed quality inspection is required before completing production', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      let totalMaterialCost = 0;

      for (const consumption of order.consumption) {
        const stockLevel = await tx.stockLevel.findFirst({
          where: { rawMaterialId: consumption.rawMaterialId, warehouseId },
        });

        if (stockLevel) {
          const consumeQty = Number(consumption.plannedQty);
          const unitCost = Number(stockLevel.unitCost);
          totalMaterialCost += consumeQty * unitCost;

          const newQty = Number(stockLevel.quantity) - consumeQty;
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
              quantity: consumeQty,
              unitCost,
              referenceType: 'production_order',
              referenceId: order.id,
              createdById: req.user!.id,
            },
          });
        }
      }

      const batchNumber = generateNumber('BATCH', (await tx.productionBatch.count()) + 1);

      await tx.productionBatch.create({
        data: {
          productionOrderId: order.id,
          batchNumber,
          quantity: completedQty,
        },
      });

      const fgUnitCost =
        completedQty > 0
          ? totalMaterialCost / completedQty
          : Number(order.product.manufacturingCost);

      const fgStock = await tx.stockLevel.findFirst({
        where: { productId: order.productId, warehouseId },
      });

      if (fgStock) {
        await tx.stockLevel.update({
          where: { id: fgStock.id },
          data: {
            quantity: { increment: completedQty },
            unitCost: fgUnitCost,
          },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            warehouseId,
            productId: order.productId,
            batchNumber,
            quantity: completedQty,
            unitCost: fgUnitCost,
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
          unitCost: fgUnitCost,
          referenceType: 'production_order',
          referenceId: order.id,
          createdById: req.user!.id,
        },
      });

      await AccountingService.postProductionCosting(tx, {
        orderNumber: order.orderNumber,
        materialCost: totalMaterialCost,
        finishedGoodsCost: totalMaterialCost,
      });

      const productionResult = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          actualEnd: new Date(),
          completedQty,
          rejectedQty: rejectedQty || 0,
        },
        include: { product: true, batches: true },
      });

      if (order.salesOrderId) {
        await SalesOrderService.maybeAdvanceToReady(tx, order.salesOrderId);
      }

      return productionResult;
    });

    res.json({ success: true, data: result });
  })
);

export default router;
