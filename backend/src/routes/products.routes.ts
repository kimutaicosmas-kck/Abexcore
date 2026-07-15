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
    const existing = await prisma.product.findUnique({ where: { sku: req.body.sku } });
    if (existing) throw new AppError('SKU already exists', 409);

    const data = await productService.create(req.body);
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

    const imageUrl = `/uploads/products/${req.file.filename}`;
    const data = await prisma.product.update({
      where: { id: getParam(req.params.id) },
      data: { imageUrl },
    });

    res.json({ success: true, data });
  })
);

export default router;
