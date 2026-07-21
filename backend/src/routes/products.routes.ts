import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import { createProductSchema, updateProductSchema, productListQuerySchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import { ProductService } from '../services/catalog.service';
import prisma from '../config/database';
import { productImageUpload } from '../middleware/upload';
import { compressProductImage } from '../utils/image';
import { AccountingService } from '../services/accounting.service';

const router = Router();
router.use(authenticate);

const productService = createCrudService('product', ['name', 'sku', 'barcode'], {
  bom: { include: { items: { include: { rawMaterial: true } } } },
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
  authorize('products:read'),
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
    if (category) where.category = category;
    if (isActive !== undefined) where.isActive = isActive;

    const result = await productService.list({ page, limit, search, sortBy, sortOrder, where });
    res.json({ success: true, ...result });
  })
);

router.get(
  '/categories/list',
  authorize('products:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const categories = [
      'OIL_FILTER', 'FUEL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
      'HYDRAULIC_FILTER', 'WATER_FILTER', 'INDUSTRIAL_FILTER', 'CUSTOM_FILTER',
    ];
    res.json({ success: true, data: categories });
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
  authorize('products:read'),
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
    const existing = await prisma.product.findUnique({ where: { sku: productData.sku } });
    if (existing) throw new AppError('Part number already exists', 409);

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
          await AccountingService.postInventoryAdjustment(tx, {
            reference: invTx.id,
            amount: glAmount,
            direction: 'increase',
            reason: `Opening stock — ${product.sku}`,
          });
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
  '/:id/bom',
  authorize('products:update'),
  auditLog('products', 'update', 'bom'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { items, version, notes } = req.body as {
      items: { rawMaterialId: string; quantity: number; unit?: string; wastePercent?: number }[];
      version?: string;
      notes?: string;
    };

    const bom = await prisma.billOfMaterial.upsert({
      where: { productId: getParam(req.params.id) },
      create: {
        productId: getParam(req.params.id),
        version: version || '1.0',
        notes,
        items: { create: items },
      },
      update: {
        version: version || '1.0',
        notes,
        items: { deleteMany: {}, create: items },
      },
      include: { items: { include: { rawMaterial: true } } },
    });

    res.json({ success: true, data: bom });
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
