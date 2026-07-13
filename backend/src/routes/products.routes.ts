import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createProductSchema, paginationSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);

const productService = createCrudService('product', ['name', 'sku', 'barcode'], {
  bom: { include: { items: { include: { rawMaterial: true } } } },
});

router.get('/', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await productService.list(getQuery(req.query));
  res.json({ success: true, ...result });
}));

router.get('/categories/list', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const categories = [
    'OIL_FILTER', 'FUEL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
    'HYDRAULIC_FILTER', 'WATER_FILTER', 'INDUSTRIAL_FILTER', 'CUSTOM_FILTER',
  ];
  res.json({ success: true, data: categories });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await productService.getById(getParam(req.params.id));
  res.json({ success: true, data });
}));

router.post('/', validate(createProductSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await productService.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put('/:id', validate(createProductSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await productService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await productService.softDelete(getParam(req.params.id));
  res.json({ success: true, message: 'Product deleted' });
}));

router.post('/:id/bom', asyncHandler(async (req: AuthRequest, res: Response) => {
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
      items: {
        deleteMany: {},
        create: items,
      },
    },
    include: { items: { include: { rawMaterial: true } } },
  });

  res.json({ success: true, data: bom });
}));

export default router;
