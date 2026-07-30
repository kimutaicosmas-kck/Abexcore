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
import { compressProductImage } from '../utils/image';
import { AccountingService } from '../services/accounting.service';
import { injectTenantData } from '../utils/tenant';

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

router.get('/categories/list', authorize('products:read'), listProductCategories);
/** Compatibility alias — GET /categories (POST remains create). */
router.get('/categories', authorize('products:read'), listProductCategories);

router.post(
  '/categories',
  authorize('products:create'),
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

router.get(
  '/:id',
  authorizeProductPicker,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await productService.getById(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authorize('products:create'),
  validate(createProductSchema),
  auditLog('products', 'create', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { initialQuantity, warehouseId, ...productData } = req.body;
    const existing = await prisma.product.findFirst({ where: { sku: productData.sku } });
    if (existing) throw new AppError('Part number already exists', 409);

    const category = await prisma.productCategory.findFirst({
      where: { id: productData.categoryId, isActive: true },
    });
    if (!category) throw new AppError('Invalid product category', 400);

    const openingQty = Number(initialQuantity || 0);

    const data = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: productData });

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
  validate(updateProductSchema),
  auditLog('products', 'update', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (req.body.categoryId) {
      const category = await prisma.productCategory.findFirst({
        where: { id: req.body.categoryId, isActive: true },
      });
      if (!category) throw new AppError('Invalid product category', 400);
    }
    const data = await productService.update(getParam(req.params.id), req.body);
    res.json({ success: true, data });
  })
);

router.delete(
  '/:id',
  authorize('products:delete'),
  auditLog('products', 'delete', 'product'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await productService.update(getParam(req.params.id), { isActive: false });
    await productService.softDelete(getParam(req.params.id));
    res.json({ success: true, message: 'Product deactivated' });
  })
);

router.post(
  '/:id/image',
  authorize('products:update'),
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
