import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { createRawMaterialSchema, createSupplierSchema, paginationSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';

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

router.post('/adjust', asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/purchase-orders', asyncHandler(async (req: AuthRequest, res: Response) => {
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

export default router;
