import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { mutationAudit } from '../middleware/mutationAudit';
import { auditLog } from '../middleware/auditLog';
import { createRawMaterialSchema, createSupplierSchema, createRequisitionSchema, createGoodsReceiptSchema, createPurchaseOrderSchema, stockAdjustSchema, stockTransferSchema, cycleCountSchema, updateSupplierQuotationSchema, paginationSchema, materialListQuerySchema, procurementListQuerySchema, createMaterialTypeSchema, updateCatalogItemSchema, reorderCatalogSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { mergeTenantWarehouseWhere, injectTenantData, requireTenantId } from '../utils/tenant';
import { NotificationService } from '../services/notification.service';
import { InventoryService } from '../services/catalog.service';
import { StockMovementService } from '../services/inventory.service';
import { AccountingService } from '../services/accounting.service';
import { ProcurementService } from '../services/procurement.service';
import { Prisma, TransactionType } from '@prisma/client';

const router = Router();
router.use(authenticate);
router.use(mutationAudit('inventory'));

function checkLowStockAlerts() {
  NotificationService.runLowStockCheckForAllCompanies().catch(() => undefined);
}

router.get(
  '/stats',
  authorize('inventory:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await InventoryService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/procurement-stats',
  authorize('procurement:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await InventoryService.getProcurementStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/transactions',
  authorize('inventory:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryTransactionWhereInput = mergeTenantWarehouseWhere(
      search
        ? {
            OR: [
              { notes: { contains: search } },
              { referenceType: { contains: search } },
              { batchNumber: { contains: search } },
            ],
          }
        : {}
    );

    const [data, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          warehouse: { select: { name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  })
);

// Raw Materials
const materialService = createCrudService('rawMaterial', ['name', 'code'], {
  materialType: { select: { id: true, name: true } },
  supplier: true,
  stockLevels: { include: { warehouse: true } },
});

router.get('/materials/types/list', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const types = await prisma.materialType.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({ success: true, data: types });
}));

router.post('/materials/types', authorize('inventory:create'), validate(createMaterialTypeSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const name = req.body.name.trim();
  const existing = await prisma.materialType.findFirst({ where: { name } });
  if (existing) throw new AppError('A material type with this name already exists', 409);

  const maxSort = await prisma.materialType.aggregate({ _max: { sortOrder: true } });
  const materialType = await prisma.materialType.create({
    data: injectTenantData({ name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 }),
    select: { id: true, name: true, sortOrder: true, isActive: true },
  });
  res.status(201).json({ success: true, data: materialType });
}));

router.get('/materials/types/manage', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const types = await prisma.materialType.findMany({
    select: {
      id: true,
      name: true,
      sortOrder: true,
      isActive: true,
      _count: { select: { materials: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({
    success: true,
    data: types.map((t) => ({
      id: t.id,
      name: t.name,
      sortOrder: t.sortOrder,
      isActive: t.isActive,
      usageCount: t._count.materials,
    })),
  });
}));

router.put('/materials/types/reorder', authorize('inventory:update'), validate(reorderCatalogSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ids } = req.body as { ids: string[] };
  const existing = await prisma.materialType.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (existing.length !== ids.length) {
    throw new AppError('One or more material types were not found', 400);
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.materialType.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  res.json({ success: true, message: 'Material types reordered' });
}));

router.patch('/materials/types/:id', authorize('inventory:update'), validate(updateCatalogItemSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = getParam(req.params.id);
  const materialType = await prisma.materialType.findFirst({ where: { id } });
  if (!materialType) throw new AppError('Material type not found', 404);

  const { name, isActive } = req.body as { name?: string; isActive?: boolean };
  if (name && name !== materialType.name) {
    const duplicate = await prisma.materialType.findFirst({ where: { name } });
    if (duplicate) throw new AppError('A material type with this name already exists', 409);
  }

  const updated = await prisma.materialType.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    select: { id: true, name: true, sortOrder: true, isActive: true },
  });
  res.json({ success: true, data: updated });
}));

router.get('/materials', authorize('inventory:read'), validate(materialListQuerySchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, sortBy, sortOrder, type } = getQuery<{
    page: number; limit: number; search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; type?: string;
  }>(req.query);
  const where: Record<string, unknown> = {};
  if (type) where.typeId = type;
  const result = await materialService.list({ page, limit, search, sortBy, sortOrder, where });
  res.json({ success: true, ...result });
}));

router.get('/materials/low-stock', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const companyId = requireTenantId();
  const materials = await prisma.rawMaterial.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      stockLevels: { where: { warehouse: { companyId } } },
      supplier: true,
      materialType: true,
    },
  });
  const lowStock = materials.filter((m) => {
    const total = m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
    return total <= Number(m.minStockLevel);
  });
  res.json({ success: true, data: lowStock });
}));

router.post('/materials', authorize('inventory:create'), validate(createRawMaterialSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const payload = { ...req.body };
  const materialType = await prisma.materialType.findFirst({
    where: { id: payload.typeId, isActive: true },
  });
  if (!materialType) throw new AppError('Invalid material type', 400);

  if (!payload.code?.trim()) {
    const count = await prisma.rawMaterial.count();
    payload.code = generateNumber('RM', count + 1);
  }
  const data = await materialService.create(payload);
  res.status(201).json({ success: true, data });
}));

router.put('/materials/:id', authorize('inventory:update'), validate(createRawMaterialSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (req.body.typeId) {
    const materialType = await prisma.materialType.findFirst({
      where: { id: req.body.typeId, isActive: true },
    });
    if (!materialType) throw new AppError('Invalid material type', 400);
  }
  const data = await materialService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

// Suppliers
const supplierService = createCrudService('supplier', ['name', 'code', 'email'], {
  _count: { select: { purchaseOrders: true, rawMaterials: true } },
});

router.get('/suppliers', authorize('procurement:read'), validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await supplierService.list(getQuery(req.query));
  res.json({ success: true, ...result });
}));

router.post('/suppliers', authorize('procurement:create'), validate(createSupplierSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await supplierService.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put('/suppliers/:id', authorize('procurement:update'), validate(createSupplierSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await supplierService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

// Warehouses
router.get('/warehouses', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const warehouses = await prisma.warehouse.findMany({
    where: { deletedAt: null, isActive: true },
    include: { branch: true, locations: true, stockLevels: true },
  });
  res.json({ success: true, data: warehouses });
}));

router.get('/stock-levels', authorize('inventory:read'), validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.StockLevelWhereInput = mergeTenantWarehouseWhere(
    search
      ? {
          OR: [
            { product: { name: { contains: search } } },
            { rawMaterial: { name: { contains: search } } },
            { warehouse: { name: { contains: search } } },
            { batchNumber: { contains: search } },
          ],
        }
      : {}
  );

  const [data, total] = await Promise.all([
    prisma.stockLevel.findMany({
      where,
      skip,
      take: limit,
      include: { warehouse: true, product: true, rawMaterial: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.stockLevel.count({ where }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/adjust', authorize('inventory:update'), validate(stockAdjustSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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

    const unitCost = Number(existing?.unitCost || 0);
    const adjustQty = Math.abs(Number(quantity));
    const newQty = type === 'add'
      ? Number(existing?.quantity || 0) + adjustQty
      : Number(existing?.quantity || 0) - adjustQty;

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

    const invTx = await tx.inventoryTransaction.create({
      data: {
        warehouseId,
        type: type === 'add' ? 'RECEIPT' : 'ISSUE',
        productId,
        rawMaterialId,
        batchNumber,
        quantity: adjustQty,
        unitCost,
        notes,
        createdById: req.user!.id,
      },
    });

    const glAmount = adjustQty * unitCost;
    if (glAmount > 0) {
      await AccountingService.postInventoryAdjustment(tx, {
        reference: invTx.id,
        amount: glAmount,
        direction: type === 'add' ? 'increase' : 'decrease',
        reason: notes || `Stock adjustment ${type}`,
      });
    }

    return stockLevel;
  });

  checkLowStockAlerts();
  res.json({ success: true, data: transaction });
}));

router.post('/cycle-counts', authorize('inventory:update'), validate(cycleCountSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { warehouseId, counts, notes } = req.body;

  const adjustments = await prisma.$transaction(async (tx) => {
    const results = [];
    for (const count of counts) {
      const existing = await tx.stockLevel.findFirst({
        where: {
          warehouseId,
          productId: count.productId || null,
          rawMaterialId: count.rawMaterialId || null,
          batchNumber: count.batchNumber || null,
        },
      });
      const systemQty = Number(existing?.quantity || 0);
      const variance = Number(count.physicalQty) - systemQty;
      if (variance === 0) {
        results.push({ ...count, systemQty, variance: 0, adjusted: false });
        continue;
      }

      const unitCost = Number(existing?.unitCost || 0);
      const newQty = Number(count.physicalQty);
      if (existing) {
        await tx.stockLevel.update({ where: { id: existing.id }, data: { quantity: newQty } });
      } else if (newQty > 0) {
        await tx.stockLevel.create({
          data: {
            warehouseId,
            productId: count.productId,
            rawMaterialId: count.rawMaterialId,
            batchNumber: count.batchNumber,
            quantity: newQty,
          },
        });
      }

      const invTx = await tx.inventoryTransaction.create({
        data: {
          warehouseId,
          type: 'ADJUSTMENT',
          productId: count.productId,
          rawMaterialId: count.rawMaterialId,
          batchNumber: count.batchNumber,
          quantity: Math.abs(variance),
          unitCost,
          notes: notes || `Cycle count variance: ${variance > 0 ? '+' : ''}${variance}`,
          createdById: req.user!.id,
        },
      });

      const glAmount = Math.abs(variance) * unitCost;
      if (glAmount > 0) {
        await AccountingService.postInventoryAdjustment(tx, {
          reference: invTx.id,
          amount: glAmount,
          direction: variance > 0 ? 'increase' : 'decrease',
          reason: notes || 'Cycle count adjustment',
        });
      }
      results.push({ ...count, systemQty, variance, adjusted: true });
    }
    return results;
  });

  res.status(201).json({ success: true, data: adjustments });
  checkLowStockAlerts();
}));

router.get('/transfers', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.inventoryTransaction.findMany({
    where: mergeTenantWarehouseWhere({ type: TransactionType.TRANSFER, quantity: { gt: 0 } }),
    include: { warehouse: { select: { name: true, code: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data });
}));

router.post('/transfers', authorize('inventory:update'), validate(stockTransferSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fromWarehouseId, toWarehouseId, productId, rawMaterialId, quantity, notes, batchNumber } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const [source, fromWarehouse, toWarehouse] = await Promise.all([
      tx.stockLevel.findFirst({
        where: {
          warehouseId: fromWarehouseId,
          productId: productId || null,
          rawMaterialId: rawMaterialId || null,
          batchNumber: batchNumber || null,
        },
      }),
      tx.warehouse.findUnique({ where: { id: fromWarehouseId }, select: { code: true } }),
      tx.warehouse.findUnique({ where: { id: toWarehouseId }, select: { code: true } }),
    ]);

    if (!source || Number(source.quantity) < Number(quantity)) {
      throw new AppError('Insufficient stock at source warehouse', 400);
    }

    const unitCost = Number(source.unitCost || 0);

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
        unitCost,
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
        unitCost,
        notes: notes ? `Transfer in: ${notes}` : 'Transfer in',
        referenceType: 'transfer',
        referenceId: fromWarehouseId,
        createdById: req.user!.id,
      },
    });

    const transferAmount = Math.abs(Number(quantity)) * unitCost;
    if (transferAmount > 0) {
      await AccountingService.postInventoryTransfer(tx, {
        reference: transferOut.id,
        amount: transferAmount,
        fromWarehouseCode: fromWarehouse?.code || fromWarehouseId.slice(0, 8),
        toWarehouseCode: toWarehouse?.code || toWarehouseId.slice(0, 8),
        notes,
      });
    }

    return transferOut;
  });

  res.status(201).json({ success: true, data: result });
  checkLowStockAlerts();
}));

// Purchase Orders
router.get('/purchase-orders', authorize('procurement:read'), validate(procurementListQuerySchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status } = getQuery<{ page: number; limit: number; search?: string; status?: string }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.PurchaseOrderWhereInput = {};
  if (status) where.status = status as Prisma.EnumOrderStatusFilter['equals'];
  if (search) {
    where.OR = [
      { poNumber: { contains: search } },
      { supplier: { name: { contains: search } } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip,
      take: limit,
      include: { supplier: true, items: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/purchase-orders', authorize('procurement:create'), validate(createPurchaseOrderSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    data: injectTenantData({
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
    }),
    include: { supplier: true, items: true },
  });

  res.status(201).json({ success: true, data: po });
}));

// Purchase Requisitions
router.get('/requisitions', authorize('procurement:read'), validate(procurementListQuerySchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status } = getQuery<{ page: number; limit: number; search?: string; status?: string }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.PurchaseRequisitionWhereInput = {};
  if (status) where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
  if (search) {
    where.OR = [
      { requisitionNo: { contains: search } },
      { department: { contains: search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({
      where,
      skip,
      take: limit,
      include: {
        requestedBy: { select: { firstName: true, lastName: true } },
        approvedBy: { select: { firstName: true, lastName: true } },
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.purchaseRequisition.count({ where }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/requisitions', authorize('procurement:create'), validate(createRequisitionSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { department, priority, requiredDate, notes, items } = req.body;
  const count = await prisma.purchaseRequisition.count();
  const requisitionNo = generateNumber('PR', count + 1);

  const req_ = await prisma.purchaseRequisition.create({
    data: injectTenantData({
      requisitionNo,
      requestedById: req.user!.id,
      department,
      priority,
      requiredDate: requiredDate ? new Date(requiredDate) : undefined,
      notes,
      status: 'PENDING',
      items: { create: items },
    }),
    include: { items: true, requestedBy: { select: { firstName: true, lastName: true } } },
  });

  await NotificationService.notifyApprovalNeeded(
    'purchase requisition',
    req_.id,
    `Requisition ${requisitionNo} pending approval`
  );

  res.status(201).json({ success: true, data: req_ });
}));

router.patch('/requisitions/:id/approve', authorize('procurement:update'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.get('/rfqs', authorize('procurement:read'), validate(procurementListQuerySchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status } = getQuery<{ page: number; limit: number; search?: string; status?: string }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.RequestForQuotationWhereInput = {};
  if (status) where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
  if (search) {
    where.OR = [{ rfqNo: { contains: search } }, { notes: { contains: search } }];
  }

  const [data, total] = await Promise.all([
    prisma.requestForQuotation.findMany({
      where,
      skip,
      take: limit,
      include: {
        requisition: { select: { requisitionNo: true, department: true } },
        quotations: { include: { supplier: { select: { name: true, code: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.requestForQuotation.count({ where }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/requisitions/:id/rfq', authorize('procurement:create'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    data: injectTenantData({
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
    }),
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

router.patch('/rfqs/:id/award', authorize('procurement:update'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
        data: injectTenantData({
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
        }),
      });
    }

    return updatedRfq;
  });

  res.json({ success: true, data: rfq, message: 'RFQ awarded and purchase order created' });
}));

router.patch('/quotations/:id', authorize('procurement:update'), validate(updateSupplierQuotationSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
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
router.get('/goods-receipts', authorize('procurement:read'), validate(procurementListQuerySchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status } = getQuery<{ page: number; limit: number; search?: string; status?: string }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.GoodsReceiptWhereInput = {};
  if (status) where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
  if (search) {
    where.OR = [
      { grnNumber: { contains: search } },
      { supplier: { name: { contains: search } } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      skip,
      take: limit,
      include: {
        supplier: true,
        items: true,
        purchaseOrder: { select: { poNumber: true } },
        inspections: { select: { id: true, inspectionNo: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.goodsReceipt.count({ where }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/goods-receipts', authorize('procurement:create'), validate(createGoodsReceiptSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { purchaseOrderId, supplierId, warehouseId, notes, items } = req.body;
  const count = await prisma.goodsReceipt.count();
  const grnNumber = generateNumber('GRN', count + 1);

  const receipt = await prisma.$transaction(async (tx) => {
    const gr = await tx.goodsReceipt.create({
      data: injectTenantData({
        grnNumber,
        purchaseOrderId,
        supplierId,
        warehouseId,
        notes,
        status: 'PENDING',
        inspectionStatus: 'PENDING',
        items: { create: items },
      }),
      include: { items: true, supplier: true },
    });

    return gr;
  });

  res.status(201).json({ success: true, data: receipt });
}));

router.post('/goods-receipts/:id/post-to-stock', authorize('procurement:update'), auditLog('procurement', 'update', 'goods_receipt'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const grnId = getParam(req.params.id);

  const receipt = await prisma.$transaction(async (tx) => {
    const gr = await tx.goodsReceipt.findUnique({
      where: { id: grnId },
      include: { items: true },
    });
    if (!gr) throw new AppError('Goods receipt not found', 404);
    if (gr.status === 'APPROVED') throw new AppError('Goods receipt already posted to stock', 400);

    const passedInspection = await tx.qualityInspection.findFirst({
      where: { goodsReceiptId: gr.id, status: 'PASSED' },
    });
    if (!passedInspection) {
      throw new AppError('Quality inspection must pass before posting goods to stock', 400);
    }

    await StockMovementService.postGoodsReceiptToStock(tx, {
      goodsReceiptId: gr.id,
      warehouseId: gr.warehouseId,
      items: gr.items.map((item) => ({
        rawMaterialId: item.rawMaterialId,
        batchNumber: item.batchNumber,
        quantity: Number(item.quantity),
        unitCost: Number(item.unitCost),
        expiryDate: item.expiryDate,
      })),
      userId: req.user!.id,
    });

    await AccountingService.postGoodsReceipt(tx, {
      grnNumber: gr.grnNumber,
      items: gr.items.map((item) => ({
        quantity: Number(item.quantity),
        unitCost: Number(item.unitCost),
      })),
    });

    if (gr.purchaseOrderId) {
      await ProcurementService.applyGoodsReceiptToPurchaseOrder(
        tx,
        gr.purchaseOrderId,
        gr.items.map((item) => ({
          rawMaterialId: item.rawMaterialId,
          quantity: Number(item.quantity),
        }))
      );
    }

    const updated = await tx.goodsReceipt.update({
      where: { id: gr.id },
      data: { status: 'APPROVED', inspectionStatus: 'PASSED' },
      include: { items: true, supplier: true, purchaseOrder: { select: { poNumber: true } } },
    });

    return updated;
  });

  checkLowStockAlerts();

  res.json({ success: true, data: receipt });
}));

export default router;
