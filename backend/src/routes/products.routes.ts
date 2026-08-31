import { Router, Response } from 'express';
import { authenticate, authorize, authorizeProductPicker, AuthRequest, requireSuperAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import { createProductSchema, updateProductSchema, productListQuerySchema, createProductCategorySchema, updateCatalogItemSchema, reorderCatalogSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import { ProductService } from '../services/catalog.service';
import prisma from '../config/database';
import { productImageUpload } from '../middleware/upload';
import { acceptExcelUpload } from '../middleware/excelImport';
import { compressProductImage } from '../utils/image';
import { AccountingService } from '../services/accounting.service';
import { injectTenantData } from '../utils/tenant';
import { StockMovementService } from '../services/inventory.service';
import { ExcelImportService } from '../services/excel-import.service';

const router = Router();
router.use(authenticate);

const productService = createCrudService('product', ['name', 'sku', 'barcode'], {
  category: { select: { id: true, name: true } },
  stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
});

router.get(
  '/stats',
  authorize('products:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await ProductService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/import/template',
  authorize('products:create'),
  requireSuperAdmin,
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const buffer = await ExcelImportService.buildTemplate('products');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products-import-template.xlsx"');
    res.send(buffer);
  })
);

router.post(
  '/import',
  authorize('products:create'),
  requireSuperAdmin,
  acceptExcelUpload,
  auditLog('products', 'import', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) throw new AppError('Spreadsheet file is required', 400);
    const data = await ExcelImportService.import('products', req.file.buffer, req.user!.id, req.user!.companyId);
    res.json({ success: true, data });
  })
);

router.get(
  '/',
  authorizeProductPicker,
  validate(productListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, sortBy, sortOrder, category, isActive } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      category?: string;
      isActive?: boolean;
    }>(req.query);

    const where: Record<string, unknown> = {};
    if (category) where.categoryId = category;
    if (isActive !== undefined) where.isActive = isActive;

    const result = await productService.list({ page, limit, search, sortBy, sortOrder, where });
    res.json({ success: true, ...result });
  })
);

const listProductCategories = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const categories = await prisma.productCategory.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json({ success: true, data: categories });
});

router.get('/categories/list', authorizeProductPicker, listProductCategories);
/** Compatibility alias — GET /categories (POST remains create). */
router.get('/categories', authorizeProductPicker, listProductCategories);

router.post(
  '/categories',
  authorize('products:create'),
  requireSuperAdmin,
  validate(createProductCategorySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const name = req.body.name.trim();
    const existing = await prisma.productCategory.findFirst({ where: { name } });
    if (existing) throw new AppError('A category with this name already exists', 409);

    const maxSort = await prisma.productCategory.aggregate({ _max: { sortOrder: true } });
    const category = await prisma.productCategory.create({
      data: injectTenantData({ name, sortOrder: (maxSort._max.sortOrder ?? -1) + 1 }),
      select: { id: true, name: true, sortOrder: true, isActive: true },
    });
    res.status(201).json({ success: true, data: category });
  })
);

router.get(
  '/categories/manage',
  authorize('products:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const categories = await prisma.productCategory.findMany({
      select: {
        id: true,
        name: true,
        sortOrder: true,
        isActive: true,
        _count: { select: { products: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json({
      success: true,
      data: categories.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        isActive: c.isActive,
        usageCount: c._count.products,
      })),
    });
  })
);

router.put(
  '/categories/reorder',
  authorize('products:update'),
  requireSuperAdmin,
  validate(reorderCatalogSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ids } = req.body as { ids: string[] };
    const existing = await prisma.productCategory.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new AppError('One or more categories were not found', 400);
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.productCategory.update({ where: { id }, data: { sortOrder: index } })
      )
    );

    res.json({ success: true, message: 'Categories reordered' });
  })
);

router.patch(
  '/categories/:id',
  authorize('products:update'),
  requireSuperAdmin,
  validate(updateCatalogItemSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const category = await prisma.productCategory.findFirst({ where: { id } });
    if (!category) throw new AppError('Category not found', 404);

    const { name, isActive } = req.body as { name?: string; isActive?: boolean };
    if (name && name !== category.name) {
      const duplicate = await prisma.productCategory.findFirst({ where: { name } });
      if (duplicate) throw new AppError('A category with this name already exists', 409);
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      },
      select: { id: true, name: true, sortOrder: true, isActive: true },
    });
    res.json({ success: true, data: updated });
  })
);

router.delete(
  '/categories/:id',
  requireSuperAdmin,
  auditLog('products', 'update', 'product_category'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const category = await prisma.productCategory.findFirst({
      where: { id },
      select: { id: true, name: true, isActive: true },
    });
    if (!category) throw new AppError('Category not found', 404);
    if (!category.isActive) {
      throw new AppError(`Category "${category.name}" is already inactive`, 400);
    }

    const updated = await prisma.productCategory.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, sortOrder: true, isActive: true },
    });
    res.json({ success: true, data: updated, message: `Category "${category.name}" deactivated.` });
  })
);

router.get(
  '/warehouses/stock',
  authorize('products:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const warehouses = await prisma.warehouse.findMany({
      where: { isActive: true, deletedAt: null, type: 'finished_goods' },
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: warehouses });
  })
);

/** Sales-safe catalog: active products with finished-goods availability (no costs/admin). */
router.get(
  '/available',
  authorize('sales:read'),
  validate(productListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, category } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      category?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    let warehouseId: string | null = null;
    try {
      warehouseId = await StockMovementService.getFinishedGoodsWarehouseId();
    } catch {
      warehouseId = null;
    }

    if (!warehouseId) {
      res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
      return;
    }

    const stockLevels = await prisma.stockLevel.findMany({
      where: { warehouseId, productId: { not: null } },
      select: { productId: true, quantity: true, reservedQty: true },
    });
    const inStockProductIds = stockLevels
      .filter((level) => level.productId && Number(level.quantity) - Number(level.reservedQty) > 0)
      .map((level) => level.productId as string);

    if (inStockProductIds.length === 0) {
      res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      });
      return;
    }

    const where = {
      isActive: true,
      deletedAt: null,
      id: { in: inStockProductIds },
      ...(category ? { categoryId: category } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search } },
              { sku: { contains: search } },
              { barcode: { contains: search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          imageUrl: true,
          sellingPrice: true,
          distributorPrice: true,
          retailPrice: true,
          minStockLevel: true,
          category: { select: { id: true, name: true } },
          stockLevels: {
            where: warehouseId ? { warehouseId } : undefined,
            select: {
              quantity: true,
              reservedQty: true,
              warehouse: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const data = rows.map((p) => {
      const onHand = p.stockLevels.reduce((sum, s) => sum + Number(s.quantity), 0);
      const reserved = p.stockLevels.reduce((sum, s) => sum + Number(s.reservedQty), 0);
      const availableQty = Math.max(0, onHand - reserved);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        description: p.description,
        imageUrl: p.imageUrl,
        sellingPrice: Number(p.sellingPrice),
        distributorPrice: Number(p.distributorPrice),
        retailPrice: Number(p.retailPrice),
        minStockLevel: Number(p.minStockLevel),
        category: p.category,
        onHand,
        reservedQty: reserved,
        availableQty,
        inStock: availableQty > 0,
        warehouses: p.stockLevels.map((s) => ({
          id: s.warehouse.id,
          name: s.warehouse.name,
          code: s.warehouse.code,
          quantity: Number(s.quantity),
          reservedQty: Number(s.reservedQty),
          availableQty: Math.max(0, Number(s.quantity) - Number(s.reservedQty)),
        })),
      };
    });

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/:id',
  authorizeProductPicker,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await productService.getById(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

/** Empty barcode must be NULL — MySQL unique (company_id, barcode) rejects multiple "". */
function normalizeProductBarcode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

router.post(
  '/',
  authorize('products:create'),
  requireSuperAdmin,
  validate(createProductSchema),
  auditLog('products', 'create', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { initialQuantity, warehouseId, ...productData } = req.body;
    const barcode = normalizeProductBarcode(productData.barcode);
    const existing = await prisma.product.findFirst({ where: { sku: productData.sku } });
    if (existing) throw new AppError('Part number already exists', 409);

    if (barcode) {
      const barcodeTaken = await prisma.product.findFirst({ where: { barcode } });
      if (barcodeTaken) throw new AppError('Barcode already exists on another product', 409);
    }

    const category = await prisma.productCategory.findFirst({
      where: { id: productData.categoryId, isActive: true },
    });
    if (!category) throw new AppError('Invalid product category', 400);

    const openingQty = Number(initialQuantity || 0);

    const data = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: { ...productData, barcode },
      });

      if (openingQty > 0) {
        let targetWarehouseId = warehouseId as string | undefined;
        if (!targetWarehouseId) {
          const defaultWarehouse = await tx.warehouse.findFirst({
            where: { isActive: true, deletedAt: null, type: 'finished_goods' },
            orderBy: { createdAt: 'asc' },
          });
          if (!defaultWarehouse) {
            throw new AppError('No finished goods warehouse configured for opening stock', 400);
          }
          targetWarehouseId = defaultWarehouse.id;
        } else {
          const warehouse = await tx.warehouse.findFirst({
            where: { id: targetWarehouseId, isActive: true, deletedAt: null, type: 'finished_goods' },
          });
          if (!warehouse) throw new AppError('Invalid finished goods warehouse', 400);
        }

        const unitCost = Number(product.sellingPrice || 0);
        await tx.stockLevel.create({
          data: {
            warehouseId: targetWarehouseId,
            productId: product.id,
            quantity: openingQty,
            unitCost,
          },
        });

        const invTx = await tx.inventoryTransaction.create({
          data: {
            warehouseId: targetWarehouseId,
            type: 'RECEIPT',
            productId: product.id,
            quantity: openingQty,
            unitCost,
            notes: 'Opening stock on product creation',
            createdById: req.user!.id,
          },
        });

        const glAmount = openingQty * unitCost;
        if (glAmount > 0) {
          try {
            await AccountingService.postInventoryAdjustment(tx, {
              reference: invTx.id,
              amount: glAmount,
              direction: 'increase',
              reason: `Opening stock — ${product.sku}`,
            });
          } catch (err) {
            if (!(err instanceof AppError) || !String(err.message).includes('not found')) {
              throw err;
            }
          }
        }

        return tx.product.findUniqueOrThrow({
          where: { id: product.id },
          include: {
            stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
          },
        });
      }

      return product;
    });

    res.status(201).json({ success: true, data });
  })
);

router.put(
  '/:id',
  authorize('products:update'),
  requireSuperAdmin,
  validate(updateProductSchema),
  auditLog('products', 'update', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (req.body.categoryId) {
      const category = await prisma.productCategory.findFirst({
        where: { id: req.body.categoryId, isActive: true },
      });
      if (!category) throw new AppError('Invalid product category', 400);
    }

    const id = getParam(req.params.id);
    const {
      initialQuantity,
      warehouseId,
      ...productFields
    } = req.body as Record<string, unknown>;
    const patch = { ...productFields };
    if ('barcode' in patch) {
      const barcode = normalizeProductBarcode(patch.barcode);
      patch.barcode = barcode;
      if (barcode) {
        const barcodeTaken = await prisma.product.findFirst({
          where: { barcode, id: { not: id } },
        });
        if (barcodeTaken) throw new AppError('Barcode already exists on another product', 409);
      }
    }

    const setStock = initialQuantity !== undefined && initialQuantity !== null && initialQuantity !== '';
    const desiredQty = setStock ? Math.max(0, Number(initialQuantity)) : null;

    const data = await prisma.$transaction(async (tx) => {
      await productService.getById(id);
      const updated = await tx.product.update({
        where: { id },
        data: patch,
        include: {
          category: { select: { id: true, name: true } },
          stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
        },
      });

      if (desiredQty == null || Number.isNaN(desiredQty)) {
        return updated;
      }

      let targetWarehouseId = typeof warehouseId === 'string' && warehouseId ? warehouseId : undefined;
      if (!targetWarehouseId) {
        const existingLevel = await tx.stockLevel.findFirst({
          where: { productId: id },
          orderBy: { quantity: 'desc' },
        });
        if (existingLevel) {
          targetWarehouseId = existingLevel.warehouseId;
        } else {
          const defaultWarehouse = await tx.warehouse.findFirst({
            where: { isActive: true, deletedAt: null, type: 'finished_goods' },
            orderBy: { createdAt: 'asc' },
          });
          if (!defaultWarehouse) {
            throw new AppError('No finished goods warehouse configured for opening stock', 400);
          }
          targetWarehouseId = defaultWarehouse.id;
        }
      } else {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: targetWarehouseId, isActive: true, deletedAt: null, type: 'finished_goods' },
        });
        if (!warehouse) throw new AppError('Invalid finished goods warehouse', 400);
      }

      const existing = await tx.stockLevel.findFirst({
        where: { warehouseId: targetWarehouseId, productId: id },
        orderBy: { updatedAt: 'asc' },
      });
      const currentQty = Number(existing?.quantity || 0);
      const diff = desiredQty - currentQty;
      if (diff === 0) {
        return tx.product.findUniqueOrThrow({
          where: { id },
          include: {
            category: { select: { id: true, name: true } },
            stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
          },
        });
      }

      const unitCost = Number(existing?.unitCost || updated.sellingPrice || updated.distributorPrice || 0);
      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: desiredQty, unitCost },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            warehouseId: targetWarehouseId,
            productId: id,
            quantity: desiredQty,
            unitCost,
          },
        });
      }

      const invTx = await tx.inventoryTransaction.create({
        data: {
          warehouseId: targetWarehouseId,
          type: diff > 0 ? 'RECEIPT' : 'ISSUE',
          productId: id,
          quantity: Math.abs(diff),
          unitCost,
          notes: 'Opening / on-hand stock set from product edit',
          createdById: req.user!.id,
        },
      });

      const glAmount = Math.abs(diff) * unitCost;
      if (glAmount > 0) {
        try {
          await AccountingService.postInventoryAdjustment(tx, {
            reference: invTx.id,
            amount: glAmount,
            direction: diff > 0 ? 'increase' : 'decrease',
            reason: `Stock set on product edit — ${updated.sku}`,
          });
        } catch (err) {
          if (!(err instanceof AppError) || !String(err.message).includes('not found')) {
            throw err;
          }
        }
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          category: { select: { id: true, name: true } },
          stockLevels: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
        },
      });
    });

    res.json({ success: true, data });
  })
);

router.delete(
  '/:id',
  authorize('products:delete'),
  requireSuperAdmin,
  auditLog('products', 'delete', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await productService.update(getParam(req.params.id), { isActive: false });
    await productService.softDelete(getParam(req.params.id));
    res.json({ success: true, message: 'Product moved to trash' });
  })
);

router.post(
  '/:id/image',
  authorize('products:update'),
  requireSuperAdmin,
  productImageUpload.single('image'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No image uploaded' });
      return;
    }

    const filename = await compressProductImage(req.file.path);
    const imageUrl = `/uploads/products/${filename}`;
    const data = await prisma.product.update({
      where: { id: getParam(req.params.id) },
      data: { imageUrl },
    });

    res.json({ success: true, data });
  })
);

export default router;
