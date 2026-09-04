import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { mutationAudit } from '../middleware/mutationAudit';
import { auditLog } from '../middleware/auditLog';
import { createRawMaterialSchema, createSupplierSchema, createRequisitionSchema, createGoodsReceiptSchema, createPurchaseOrderSchema, stockAdjustSchema, stockTransferSchema, cycleCountSchema, updateSupplierQuotationSchema, paginationSchema, stockLevelListQuerySchema, materialListQuerySchema, procurementListQuerySchema, createMaterialTypeSchema, updateCatalogItemSchema, reorderCatalogSchema, customerStatementQuerySchema } from '../validators/schemas';
import { VendorStatementService } from '../services/vendorStatement.service';
import { createCrudService } from '../utils/crud';
import prisma from '../config/database';
import { generateNumber, parseLocalDateInput } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { mergeTenantWarehouseWhere, injectTenantData, requireTenantId } from '../utils/tenant';
import { NotificationService } from '../services/notification.service';
import { InventoryService } from '../services/catalog.service';
import { StockMovementService } from '../services/inventory.service';
import { AccountingService } from '../services/accounting.service';
import { ProcurementService } from '../services/procurement.service';
import { Prisma, TransactionType } from '@prisma/client';
import { isLowStock, sumStockQuantities, toStockQty, weightedStockUnitCost } from '../utils/stock';
import { ExcelImportService } from '../services/excel-import.service';
import { acceptExcelUpload } from '../middleware/excelImport';

const router = Router();
router.use(authenticate);
router.use(mutationAudit('inventory'));

function checkLowStockAlerts() {
  NotificationService.runLowStockCheckForAllCompanies().catch(() => undefined);
}

router.get(
  '/materials/import/template',
  authorize('inventory:create'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const buffer = await ExcelImportService.buildTemplate('materials');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="materials-import-template.xlsx"');
    res.send(buffer);
  })
);

router.post(
  '/materials/import',
  authorize('inventory:create'),
  acceptExcelUpload,
  auditLog('inventory', 'import', 'raw_material'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) throw new AppError('Spreadsheet file is required', 400);
    const data = await ExcelImportService.import('materials', req.file.buffer, req.user!.id, req.user!.companyId);
    checkLowStockAlerts();
    res.json({ success: true, data });
  })
);

router.get(
  '/suppliers/import/template',
  authorize('procurement:create'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const buffer = await ExcelImportService.buildTemplate('suppliers');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="suppliers-import-template.xlsx"');
    res.send(buffer);
  })
);

router.post(
  '/suppliers/import',
  authorize('procurement:create'),
  acceptExcelUpload,
  auditLog('procurement', 'import', 'supplier'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) throw new AppError('Spreadsheet file is required', 400);
    const data = await ExcelImportService.import('suppliers', req.file.buffer, req.user!.id, req.user!.companyId);
    res.json({ success: true, data });
  })
);

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
  const data = (result.data as Array<{
    unitCost?: unknown;
    stockLevels?: { quantity: unknown; unitCost?: unknown }[];
    [key: string]: unknown;
  }>).map((material) => {
    const levels = material.stockLevels;
    const onHand = sumStockQuantities(levels);
    const catalogCost = Number(material.unitCost || 0);
    const effectiveUnitCost = weightedStockUnitCost(levels, catalogCost);
    return {
      ...material,
      onHandTotal: onHand,
      effectiveUnitCost,
      stockValue: onHand * effectiveUnitCost,
    };
  });
  res.json({ success: true, data, pagination: result.pagination });
}));

router.get('/materials/low-stock', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const companyId = requireTenantId();
  const stockWhere = { warehouse: { companyId } };

  const [materials, products] = await Promise.all([
    prisma.rawMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        stockLevels: { where: stockWhere },
        supplier: true,
        materialType: true,
      },
    }),
    prisma.product.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        stockLevels: { where: stockWhere },
        category: { select: { id: true, name: true } },
      },
    }),
  ]);

  const lowMaterials = materials
    .filter((m) => isLowStock(sumStockQuantities(m.stockLevels), m.minStockLevel))
    .map((m) => {
      const currentStock = sumStockQuantities(m.stockLevels);
      return {
        id: m.id,
        name: m.name,
        code: m.code,
        unit: m.unit,
        itemType: 'RAW_MATERIAL' as const,
        minStockLevel: toStockQty(m.minStockLevel),
        currentStock,
        stockLevels: m.stockLevels,
        materialType: m.materialType,
        supplier: m.supplier,
        category: null as { id: string; name: string } | null,
      };
    });

  const lowProducts = products
    .filter((p) => isLowStock(sumStockQuantities(p.stockLevels), p.minStockLevel))
    .map((p) => {
      const currentStock = sumStockQuantities(p.stockLevels);
      return {
        id: p.id,
        name: p.name,
        code: p.sku,
        unit: 'pcs',
        itemType: 'PRODUCT' as const,
        minStockLevel: toStockQty(p.minStockLevel),
        currentStock,
        stockLevels: p.stockLevels,
        materialType: null as { id: string; name: string } | null,
        supplier: null,
        category: p.category,
      };
    });

  const lowStock = [...lowMaterials, ...lowProducts].sort((a, b) => a.currentStock - b.currentStock);
  res.json({ success: true, data: lowStock });
}));

router.post('/materials', authorize('inventory:create'), validate(createRawMaterialSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { initialQuantity, warehouseId: _warehouseId, ...rest } = req.body;
  const materialType = await prisma.materialType.findFirst({
    where: { id: rest.typeId, isActive: true },
  });
  if (!materialType) throw new AppError('Invalid material type', 400);

  let unit = String(rest.unit || 'pcs').trim() || 'pcs';
  let openingQty = Number(initialQuantity || 0);
  const unitQtyMatch = unit.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/i);
  if (unitQtyMatch && (!openingQty || openingQty === 0)) {
    const qty = Number(unitQtyMatch[1]);
    const suffix = (unitQtyMatch[2] || 'pcs').toLowerCase() || 'pcs';
    if (Number.isFinite(qty) && qty > 0) {
      openingQty = qty;
      unit = suffix;
    }
  }

  const code = rest.code?.trim()
    ? String(rest.code).trim()
    : generateNumber('RM', (await prisma.rawMaterial.count()) + 1);

  const createData = {
    code,
    name: String(rest.name).trim(),
    typeId: rest.typeId as string,
    description: rest.description,
    unit,
    unitCost: Number(rest.unitCost ?? 0),
    weight:
      rest.weight === undefined || rest.weight === null || rest.weight === ''
        ? null
        : Number(rest.weight),
    supplierId: rest.supplierId || null,
    minStockLevel: Number(rest.minStockLevel ?? 0),
    reorderQty: Number(rest.reorderQty ?? 0),
    shelfLifeDays: rest.shelfLifeDays,
  };

  const data = await prisma.$transaction(async (tx) => {
    const material = await tx.rawMaterial.create({
      data: injectTenantData(createData),
      include: {
        materialType: true,
        supplier: { select: { id: true, name: true, code: true } },
      },
    });

    if (openingQty > 0) {
      await StockMovementService.setRawMaterialOnHand(tx, {
        rawMaterialId: material.id,
        quantity: openingQty,
        unitCost: Number(material.unitCost || 0),
        userId: req.user!.id,
        notes: 'Opening stock on raw material creation',
      });

      return tx.rawMaterial.findUniqueOrThrow({
        where: { id: material.id },
        include: {
          materialType: true,
          supplier: { select: { id: true, name: true, code: true } },
          stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true, type: true } } } },
        },
      });
    }

    return material;
  });

  if (openingQty > 0) checkLowStockAlerts();
  res.status(201).json({ success: true, data });
}));

router.put('/materials/:id', authorize('inventory:update'), validate(createRawMaterialSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (req.body.typeId) {
    const materialType = await prisma.materialType.findFirst({
      where: { id: req.body.typeId, isActive: true },
    });
    if (!materialType) throw new AppError('Invalid material type', 400);
  }

  const materialId = getParam(req.params.id);
  const { initialQuantity, warehouseId: _wh, code: _code, ...rest } = req.body;
  const setStock = initialQuantity !== undefined && initialQuantity !== null && initialQuantity !== '';

  const data = await prisma.$transaction(async (tx) => {
    const existing = await tx.rawMaterial.findFirst({
      where: { id: materialId, deletedAt: null },
    });
    if (!existing) throw new AppError('Raw material not found', 404);

    const updateData: Record<string, unknown> = {};
    if (rest.name !== undefined) updateData.name = String(rest.name).trim();
    if (rest.typeId !== undefined) updateData.typeId = rest.typeId;
    if (rest.description !== undefined) updateData.description = rest.description;
    if (rest.unit !== undefined) updateData.unit = String(rest.unit).trim() || 'pcs';
    if (rest.unitCost !== undefined) updateData.unitCost = Number(rest.unitCost);
    if (rest.weight !== undefined) {
      updateData.weight = rest.weight === null || rest.weight === '' ? null : Number(rest.weight);
    }
    if (rest.supplierId !== undefined) {
      updateData.supplierId = rest.supplierId || null;
    }
    if (rest.minStockLevel !== undefined) updateData.minStockLevel = Number(rest.minStockLevel);
    if (rest.reorderQty !== undefined) updateData.reorderQty = Number(rest.reorderQty);
    if (rest.shelfLifeDays !== undefined) updateData.shelfLifeDays = rest.shelfLifeDays;

    // If unit looks like "35pcs" and stock wasn't provided, recover qty into on-hand.
    let stockQty =
      setStock ? Number(initialQuantity) : undefined;
    if (typeof updateData.unit === 'string') {
      const matched = updateData.unit.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/i);
      if (matched) {
        const qty = Number(matched[1]);
        const suffix = (matched[2] || 'pcs').toLowerCase() || 'pcs';
        updateData.unit = suffix;
        if (stockQty === undefined || stockQty === 0) {
          stockQty = qty;
        }
      }
    }

    const updated = await tx.rawMaterial.update({
      where: { id: materialId },
      data: updateData,
      include: {
        materialType: true,
        supplier: { select: { id: true, name: true, code: true } },
      },
    });

    if (stockQty !== undefined && !Number.isNaN(stockQty)) {
      await StockMovementService.setRawMaterialOnHand(tx, {
        rawMaterialId: materialId,
        quantity: stockQty,
        unitCost: Number(updated.unitCost || 0),
        userId: req.user!.id,
        notes: 'Stock on hand updated from material edit',
      });
    }

    return tx.rawMaterial.findFirst({
      where: { id: materialId },
      include: {
        materialType: true,
        supplier: { select: { id: true, name: true, code: true } },
        stockLevels: { include: { warehouse: true } },
      },
    });
  });

  checkLowStockAlerts();
  res.json({ success: true, data });
}));

router.delete(
  '/materials/:id',
  authorize('inventory:delete'),
  auditLog('inventory', 'delete', 'raw_material'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await materialService.update(getParam(req.params.id), { isActive: false });
    const data = await materialService.softDelete(getParam(req.params.id));
    res.json({ success: true, message: 'Raw material moved to trash', data });
  })
);

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

router.delete(
  '/suppliers/:id',
  authorize('procurement:delete'),
  auditLog('procurement', 'delete', 'supplier'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await supplierService.update(getParam(req.params.id), { isActive: false });
    const data = await supplierService.softDelete(getParam(req.params.id));
    res.json({ success: true, message: 'Supplier moved to trash', data });
  })
);

router.get(
  '/suppliers/:id/statement',
  authorizeAny('procurement:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const data = await VendorStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/suppliers/:id/statement/pdf',
  authorizeAny('procurement:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const statement = await VendorStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    const { ExportService } = await import('../services/export.service');
    const pdf = await ExportService.generateVendorStatementPDF(statement);
    const suffix = statement.mode === 'OUTSTANDING' ? 'outstanding' : 'statement';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${statement.supplier.code}-${suffix}.pdf"`
    );
    res.send(pdf);
  })
);

router.get(
  '/suppliers/:id/statement/excel',
  authorizeAny('procurement:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const statement = await VendorStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateVendorStatementExcel(statement);
    const suffix = statement.mode === 'OUTSTANDING' ? 'outstanding' : 'statement';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${statement.supplier.code}-${suffix}.xlsx"`
    );
    res.send(excel);
  })
);

// Warehouses
router.get('/warehouses', authorize('inventory:read'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const relocated = await StockMovementService.relocateMisplacedRawMaterialStock();

  const [warehouses, materialsCount] = await Promise.all([
    prisma.warehouse.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        branch: true,
        locations: true,
        stockLevels: { where: { quantity: { not: 0 } } },
      },
    }),
    prisma.rawMaterial.count({ where: { deletedAt: null, isActive: true } }),
  ]);

  res.json({
    success: true,
    data: warehouses.map((wh) => ({
      ...wh,
      // Catalog size for RM warehouse cards (stock lines alone stay 0 until qty is received).
      materialsCount: wh.type === 'raw_materials' ? materialsCount : undefined,
    })),
    meta: { relocated, materialsCount },
  });
}));

const listStockLevels = asyncHandler(async (req: AuthRequest, res: Response) => {
  await StockMovementService.relocateMisplacedRawMaterialStock();

  const { page, limit, search, warehouseId, itemType } = getQuery<{
    page: number;
    limit: number;
    search?: string;
    warehouseId?: string;
    itemType?: 'RAW_MATERIAL' | 'PRODUCT';
  }>(req.query);
  const skip = (page - 1) * limit;

  // Raw-materials warehouse: show the materials catalog with on-hand qty in that warehouse
  // (including 0), so users can open materials from the warehouse card — not only from Materials.
  if (warehouseId) {
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, deletedAt: null, isActive: true },
    });
    if (!warehouse) throw new AppError('Warehouse not found', 404);

    if (warehouse.type === 'raw_materials') {
      if (itemType === 'PRODUCT') {
        res.json({
          success: true,
          data: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        });
        return;
      }
      const materialWhere: Prisma.RawMaterialWhereInput = {
        isActive: true,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { code: { contains: search } },
              ],
            }
          : {}),
      };

      const [materials, total] = await Promise.all([
        prisma.rawMaterial.findMany({
          where: materialWhere,
          skip,
          take: limit,
          orderBy: { name: 'asc' },
          include: {
            stockLevels: {
              where: { warehouseId },
              orderBy: { updatedAt: 'desc' },
            },
          },
        }),
        prisma.rawMaterial.count({ where: materialWhere }),
      ]);

      const data = materials.map((m) => {
        const levels = m.stockLevels;
        const quantity = levels.reduce((s, l) => s + Number(l.quantity), 0);
        const reservedQty = levels.reduce((s, l) => s + Number(l.reservedQty || 0), 0);
        const primary = levels[0];
        const unitCost =
          quantity > 0
            ? levels.reduce((s, l) => s + Number(l.unitCost) * Number(l.quantity), 0) / quantity
            : Number(m.unitCost || 0);

        return {
          id: primary?.id || `material-${m.id}`,
          warehouseId: warehouse.id,
          warehouse,
          productId: null,
          product: null,
          rawMaterialId: m.id,
          rawMaterial: m,
          batchNumber: levels.length === 1 ? primary?.batchNumber : levels.length > 1 ? `${levels.length} batches` : null,
          quantity,
          reservedQty,
          unitCost,
          expiryDate: primary?.expiryDate ?? null,
          updatedAt: primary?.updatedAt ?? m.updatedAt,
        };
      });

      res.json({
        success: true,
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
      });
      return;
    }
  }

  const where: Prisma.StockLevelWhereInput = mergeTenantWarehouseWhere({
    ...(warehouseId ? { warehouseId } : {}),
    ...(itemType === 'RAW_MATERIAL' ? { rawMaterialId: { not: null } } : {}),
    ...(itemType === 'PRODUCT' ? { productId: { not: null } } : {}),
    ...(search
      ? {
          OR: [
            { product: { name: { contains: search } } },
            { rawMaterial: { name: { contains: search } } },
            { warehouse: { name: { contains: search } } },
            { batchNumber: { contains: search } },
          ],
        }
      : {}),
  });

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
});

router.get('/stock-levels', authorize('inventory:read'), validate(stockLevelListQuerySchema, 'query'), listStockLevels);
/** Compatibility alias — validation probes used /stock. */
router.get('/stock', authorize('inventory:read'), validate(stockLevelListQuerySchema, 'query'), listStockLevels);

router.post('/adjust', authorize('inventory:update'), validate(stockAdjustSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { warehouseId, productId, rawMaterialId, quantity, type, notes, batchNumber } = req.body;

  const transaction = await prisma.$transaction(async (tx) => {
    await StockMovementService.assertWarehouseMatchesItem(tx, {
      warehouseId,
      productId,
      rawMaterialId,
    });

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
      await StockMovementService.assertWarehouseMatchesItem(tx, {
        warehouseId,
        productId: count.productId,
        rawMaterialId: count.rawMaterialId,
      });

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
    await StockMovementService.assertWarehouseMatchesItem(tx, {
      warehouseId: fromWarehouseId,
      productId,
      rawMaterialId,
    });
    await StockMovementService.assertWarehouseMatchesItem(tx, {
      warehouseId: toWarehouseId,
      productId,
      rawMaterialId,
    });

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

router.get(
  '/purchase-orders/:id/pdf',
  authorize('procurement:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const po = await ExportService.getPurchaseOrder(getParam(req.params.id));
    const pdf = await ExportService.generatePurchaseOrderPDF(po);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
    res.send(pdf);
  })
);

router.post(
  '/purchase-orders/:id/send',
  authorizeAny('procurement:create', 'procurement:update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const { EmailService } = await import('../services/email.service');
    const { getCompanySettings } = await import('../utils/company');

    const po = await ExportService.getPurchaseOrder(getParam(req.params.id));
    const to = (po.supplier.email || '').trim();
    if (!to) {
      throw new AppError('Supplier has no email address on file', 400);
    }
    const company = await getCompanySettings();
    const companyId = company?.id;
    if (!(await EmailService.isConfiguredForCompany(companyId))) {
      throw new AppError(
        'Email is not configured. Add SMTP under Settings → Email, or download the PDF and send it manually.',
        400
      );
    }

    const pdf = await ExportService.generatePurchaseOrderPDF(po);
    const companyName = company?.name || 'AbexCore ERP';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
        <p>Dear ${po.supplier.name},</p>
        <p>Please find attached purchase order <strong>${po.poNumber}</strong> from ${companyName}.</p>
        <p>
          Order date: ${po.orderDate.toLocaleDateString('en-KE')}<br/>
          ${po.expectedDate ? `Expected delivery: ${po.expectedDate.toLocaleDateString('en-KE')}<br/>` : ''}
          Total: KES ${Number(po.totalAmount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
        </p>
        <p>Kindly confirm receipt and advise your delivery schedule.</p>
        <p>Regards,<br/>${companyName}</p>
      </div>`;

    const sent = await EmailService.send(
      to,
      `Purchase Order ${po.poNumber} — ${companyName}`,
      html,
      [{ filename: `${po.poNumber}.pdf`, content: pdf, contentType: 'application/pdf' }],
      companyId
    );
    if (!sent) {
      throw new AppError('Failed to send purchase order email', 502);
    }

    res.json({
      success: true,
      data: { sent: true, to, poNumber: po.poNumber },
      message: `Purchase order emailed to ${to}`,
    });
  })
);

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

  await StockMovementService.assertGoodsReceiptWarehouse(prisma, warehouseId);

  const normalizedItems = (
    items as Array<{
      rawMaterialId?: string;
      batchNumber?: string;
      quantity: number;
      unit?: string;
      unitCost: number;
      expiryDate?: string;
    }>
  ).map((item) => {
    const expiryRaw = item.expiryDate?.trim();
    const expiryDate = expiryRaw
      ? parseLocalDateInput(expiryRaw) || new Date(expiryRaw)
      : undefined;
    if (expiryRaw && (!expiryDate || Number.isNaN(expiryDate.getTime()))) {
      throw new AppError('Invalid expiry date on receipt item', 400);
    }
    return {
      rawMaterialId: item.rawMaterialId || undefined,
      batchNumber: item.batchNumber?.trim() || undefined,
      quantity: item.quantity,
      unit: item.unit?.trim() || 'pcs',
      unitCost: item.unitCost,
      expiryDate,
    };
  });

  const receipt = await prisma.$transaction(async (tx) => {
    const gr = await tx.goodsReceipt.create({
      data: injectTenantData({
        grnNumber,
        purchaseOrderId: purchaseOrderId || undefined,
        supplierId,
        warehouseId,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
        status: 'PENDING',
        inspectionStatus: 'PENDING',
        items: { create: normalizedItems },
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
