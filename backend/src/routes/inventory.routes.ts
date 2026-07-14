import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { createRawMaterialSchema, createSupplierSchema, createRequisitionSchema, createGoodsReceiptSchema, createPurchaseOrderSchema, stockAdjustSchema, stockTransferSchema, updateSupplierQuotationSchema, paginationSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { NotificationService } from '../services/notification.service';

const router = Router();
router.use(authenticate);

// Raw Materials
const materialService = createCrudService('rawMaterial', ['name', 'code'], {
  supplier: true,
  stockLevels: { include: { warehouse: true } },
});

router.get('/materials', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await materialService.list(getQuery(req.query));
  res.json({ success: true, ...result });
}));

router.get('/materials/low-stock', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const materials = await prisma.rawMaterial.findMany({
    where: { isActive: true, deletedAt: null },
    include: { stockLevels: true, supplier: true },
  });
  const lowStock = materials.filter((m) => {
    const total = m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
    return total <= Number(m.minStockLevel);
  });
  res.json({ success: true, data: lowStock });
}));

router.post('/materials', validate(createRawMaterialSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await materialService.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put('/materials/:id', validate(createRawMaterialSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await materialService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

// Suppliers
const supplierService = createCrudService('supplier', ['name', 'code', 'email'], {
  _count: { select: { purchaseOrders: true, rawMaterials: true } },
});

router.get('/suppliers', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await supplierService.list(getQuery(req.query));
  res.json({ success: true, ...result });
}));

router.post('/suppliers', validate(createSupplierSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await supplierService.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put('/suppliers/:id', validate(createSupplierSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await supplierService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

// Warehouses
router.get('/warehouses', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { deletedAt: null, isActive: true },
    include: { branch: true, locations: true, stockLevels: true },
  });
  res.json({ success: true, data: warehouses });
}));

router.get('/stock-levels', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.stockLevel.findMany({
      skip,
      take: limit,
      include: { warehouse: true, product: true, rawMaterial: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.stockLevel.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/adjust', validate(stockAdjustSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { warehouseId, productId, rawMaterialId, quantity, type, notes, batchNumber } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    const existing = await tx.stockLevel.findFirst({
      where: {
        warehouseId,
        productId: productId || null,
        rawMaterialId: rawMaterialId || null,
        batchNumber: batchNumber || null,
      },
    });

    const newQty = type === 'add'
      ? Number(existing?.quantity || 0) + Number(quantity)
      : Number(existing?.quantity || 0) - Number(quantity);

    if (newQty < 0) throw new AppError('Insufficient stock', 400);

    const stockLevel = existing
      ? await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: newQty },
        })
      : await tx.stockLevel.create({
          data: {
            warehouseId,
            productId,
            rawMaterialId,
            batchNumber,
            quantity: newQty,
          },
        });

    await tx.inventoryTransaction.create({
      data: {
        warehouseId,
        type: type === 'add' ? 'RECEIPT' : 'ISSUE',
        productId,
        rawMaterialId,
        batchNumber,
        quantity: Math.abs(Number(quantity)),
        notes,
        createdById: req.user!.id,
      },
    });

    return stockLevel;
  });

  res.json({ success: true, data: transaction });
}));

router.get('/transfers', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.inventoryTransaction.findMany({
    where: { type: 'TRANSFER', quantity: { gt: 0 } },
    include: { warehouse: { select: { name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data });
}));

router.post('/transfers', validate(stockTransferSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fromWarehouseId, toWarehouseId, productId, rawMaterialId, quantity, notes, batchNumber } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const source = await tx.stockLevel.findFirst({
      where: {
        warehouseId: fromWarehouseId,
        productId: productId || null,
        rawMaterialId: rawMaterialId || null,
        batchNumber: batchNumber || null,
      },
    });

    if (!source || Number(source.quantity) < Number(quantity)) {
      throw new AppError('Insufficient stock at source warehouse', 400);
    }

    await tx.stockLevel.update({
      where: { id: source.id },
      data: { quantity: { decrement: quantity } },
    });

    const dest = await tx.stockLevel.findFirst({
      where: {
        warehouseId: toWarehouseId,
        productId: productId || null,
        rawMaterialId: rawMaterialId || null,
        batchNumber: batchNumber || null,
      },
    });

    if (dest) {
      await tx.stockLevel.update({
        where: { id: dest.id },
        data: { quantity: { increment: quantity } },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          warehouseId: toWarehouseId,
          productId,
          rawMaterialId,
          batchNumber,
          quantity,
          unitCost: source.unitCost,
        },
      });
    }

    const transferOut = await tx.inventoryTransaction.create({
      data: {
        warehouseId: fromWarehouseId,
        type: 'TRANSFER',
        productId,
        rawMaterialId,
        batchNumber,
        quantity: -Math.abs(Number(quantity)),
        notes: notes ? `Transfer out: ${notes}` : 'Transfer out',
        referenceType: 'transfer',
        referenceId: toWarehouseId,
        createdById: req.user!.id,
      },
    });

    await tx.inventoryTransaction.create({
      data: {
        warehouseId: toWarehouseId,
        type: 'TRANSFER',
        productId,
        rawMaterialId,
        batchNumber,
        quantity: Math.abs(Number(quantity)),
        notes: notes ? `Transfer in: ${notes}` : 'Transfer in',
        referenceType: 'transfer',
        referenceId: fromWarehouseId,
        createdById: req.user!.id,
      },
    });

    return transferOut;
  });

  res.status(201).json({ success: true, data: result });
}));

// Purchase Orders
router.get('/purchase-orders', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      skip,
      take: limit,
      include: { supplier: true, items: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseOrder.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/purchase-orders', validate(createPurchaseOrderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { supplierId, expectedDate, notes, items } = req.body;
  const count = await prisma.purchaseOrder.count();
  const poNumber = generateNumber('PO', count + 1);

  const subtotal = items.reduce(
    (sum: number, item: { quantity: number; unitPrice: number }) =>
      sum + item.quantity * item.unitPrice,
    0
  );
  const taxAmount = subtotal * 0.16;
  const totalAmount = subtotal + taxAmount;

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber,
      supplierId,
      expectedDate: expectedDate ? new Date(expectedDate) : undefined,
      notes,
      subtotal,
      taxAmount,
      totalAmount,
      items: {
        create: items.map((item: { rawMaterialId?: string; description: string; quantity: number; unit?: string; unitPrice: number }) => ({
          ...item,
          totalPrice: item.quantity * item.unitPrice,
        })),
      },
    },
    include: { supplier: true, items: true },
  });

  res.status(201).json({ success: true, data: po });
}));

// Purchase Requisitions
router.get('/requisitions', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.purchaseRequisition.findMany({
    include: {
      requestedBy: { select: { firstName: true, lastName: true } },
      approvedBy: { select: { firstName: true, lastName: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/requisitions', validate(createRequisitionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { department, priority, requiredDate, notes, items } = req.body;
  const count = await prisma.purchaseRequisition.count();
  const requisitionNo = generateNumber('PR', count + 1);

  const req_ = await prisma.purchaseRequisition.create({
    data: {
      requisitionNo,
      requestedById: req.user!.id,
      department,
      priority,
      requiredDate: requiredDate ? new Date(requiredDate) : undefined,
      notes,
      status: 'PENDING',
      items: { create: items },
    },
    include: { items: true, requestedBy: { select: { firstName: true, lastName: true } } },
  });

  await NotificationService.notifyApprovalNeeded(
    'purchase requisition',
    req_.id,
    `Requisition ${requisitionNo} pending approval`
  );

  res.status(201).json({ success: true, data: req_ });
}));

router.patch('/requisitions/:id/approve', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  const data = await prisma.purchaseRequisition.update({
    where: { id: getParam(req.params.id) },
    data: {
      status: status || 'APPROVED',
      approvedById: req.user!.id,
      approvedAt: new Date(),
    },
  });

  if (data.status === 'APPROVED') {
    await NotificationService.notifyRole(
      'Procurement Officer',
      'APPROVAL',
      `Requisition ${data.requisitionNo} approved`,
      'You can now create an RFQ or purchase order.',
      '/procurement'
    );
  }

  res.json({ success: true, data });
}));

// Request for Quotations (v2.0)
router.get('/rfqs', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.requestForQuotation.findMany({
    include: {
      requisition: { select: { requisitionNo: true, department: true } },
      quotations: { include: { supplier: { select: { name: true, code: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/requisitions/:id/rfq', asyncHandler(async (req: AuthRequest, res: Response) => {
  const requisitionId = getParam(req.params.id);
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: { items: true },
  });

  if (!requisition) throw new AppError('Requisition not found', 404);
  if (requisition.status !== 'APPROVED') {
    throw new AppError('Only approved requisitions can generate RFQs', 400);
  }

  const count = await prisma.requestForQuotation.count();
  const rfqNo = generateNumber('RFQ', count + 1);
  const { dueDate, notes, supplierIds } = req.body as {
    dueDate?: string;
    notes?: string;
    supplierIds?: string[];
  };

  const rfq = await prisma.requestForQuotation.create({
    data: {
      rfqNo,
      requisitionId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes,
      status: 'PENDING',
      quotations: supplierIds?.length
        ? {
            create: supplierIds.map((supplierId) => ({
              supplierId,
              status: 'PENDING',
            })),
          }
        : undefined,
    },
    include: {
      requisition: true,
      quotations: { include: { supplier: true } },
    },
  });

  await NotificationService.notifyRole(
    'Procurement Officer',
    'APPROVAL',
    `RFQ ${rfqNo} created`,
    `RFQ from requisition ${requisition.requisitionNo} is ready for supplier quotes.`,
    '/procurement'
  );

  res.status(201).json({ success: true, data: rfq });
}));

router.patch('/rfqs/:id/award', asyncHandler(async (req: AuthRequest, res: Response) => {
  const rfqId = getParam(req.params.id);
  const { quotationId } = req.body;

  if (!quotationId) throw new AppError('quotationId is required', 400);

  const winningQuote = await prisma.supplierQuotation.findUnique({
    where: { id: quotationId },
    include: { supplier: true, rfq: { include: { requisition: { include: { items: true } } } } },
  });

  if (!winningQuote || winningQuote.rfqId !== rfqId) {
    throw new AppError('Quotation not found for this RFQ', 404);
  }

  const rfq = await prisma.$transaction(async (tx) => {
    await tx.supplierQuotation.updateMany({
      where: { rfqId },
      data: { status: 'REJECTED' },
    });
    await tx.supplierQuotation.update({
      where: { id: quotationId },
      data: { status: 'APPROVED' },
    });
    const updatedRfq = await tx.requestForQuotation.update({
      where: { id: rfqId },
      data: { status: 'APPROVED' },
      include: { quotations: { include: { supplier: true } }, requisition: { include: { items: true } } },
    });

    const reqItems = updatedRfq.requisition?.items || [];
    if (reqItems.length > 0) {
      const count = await tx.purchaseOrder.count();
      const poNumber = generateNumber('PO', count + 1);
      const subtotal = Number(winningQuote.totalAmount) || reqItems.reduce(
        (s, i) => s + Number(i.estimatedCost), 0
      );
      const taxAmount = subtotal * 0.16;
      const totalAmount = subtotal + taxAmount;

      await tx.purchaseOrder.create({
        data: {
          poNumber,
          supplierId: winningQuote.supplierId,
          quotationId,
          subtotal,
          taxAmount,
          totalAmount,
          status: 'CONFIRMED',
          notes: `Auto-created from RFQ ${updatedRfq.rfqNo}`,
          items: {
            create: reqItems.map((item) => ({
              rawMaterialId: item.rawMaterialId,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: reqItems.length && Number(winningQuote.totalAmount)
                ? Number(winningQuote.totalAmount) / reqItems.length / Number(item.quantity)
                : Number(item.estimatedCost) / Number(item.quantity) || 0,
            })),
          },
        },
      });
    }

    return updatedRfq;
  });

  res.json({ success: true, data: rfq, message: 'RFQ awarded and purchase order created' });
}));

router.patch('/quotations/:id', validate(updateSupplierQuotationSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { totalAmount, notes, validUntil } = req.body;
  const data = await prisma.supplierQuotation.update({
    where: { id: getParam(req.params.id) },
    data: {
      totalAmount,
      notes,
      validUntil: validUntil ? new Date(validUntil) : undefined,
    },
    include: { supplier: { select: { name: true, code: true } } },
  });
  res.json({ success: true, data });
}));

// Goods Receipts
router.get('/goods-receipts', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.goodsReceipt.findMany({
    include: { supplier: true, items: true, purchaseOrder: { select: { poNumber: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data });
}));

router.post('/goods-receipts', validate(createGoodsReceiptSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { purchaseOrderId, supplierId, warehouseId, notes, items } = req.body;
  const count = await prisma.goodsReceipt.count();
  const grnNumber = generateNumber('GRN', count + 1);

  const receipt = await prisma.$transaction(async (tx) => {
    const gr = await tx.goodsReceipt.create({
      data: {
        grnNumber,
        purchaseOrderId,
        supplierId,
        warehouseId,
        notes,
        status: 'APPROVED',
        inspectionStatus: 'PASSED',
        items: { create: items },
      },
      include: { items: true, supplier: true },
    });

    for (const item of items) {
      const existing = await tx.stockLevel.findFirst({
        where: {
          warehouseId,
          rawMaterialId: item.rawMaterialId || null,
          batchNumber: item.batchNumber || null,
        },
      });

      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: item.quantity }, unitCost: item.unitCost },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            warehouseId,
            rawMaterialId: item.rawMaterialId,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            unitCost: item.unitCost,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
          },
        });
      }

      await tx.inventoryTransaction.create({
        data: {
          warehouseId,
          type: 'RECEIPT',
          rawMaterialId: item.rawMaterialId,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'goods_receipt',
          referenceId: gr.id,
          createdById: req.user!.id,
        },
      });
    }

    if (purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: 'COMPLETED' },
      });
    }

    return gr;
  });

  NotificationService.runLowStockCheck().catch(() => undefined);

  res.status(201).json({ success: true, data: receipt });
}));

export default router;
