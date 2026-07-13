import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { createCustomerSchema, paginationSchema } from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import prisma from '../config/database';

const router = Router();
router.use(authenticate);

const customerService = createCrudService('customer', ['name', 'code', 'email'], {
  contacts: true,
  _count: { select: { salesOrders: true, invoices: true } },
});

router.get('/', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await customerService.list(getQuery(req.query));
  res.json({ success: true, ...result });
}));

router.get('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await customerService.getById(getParam(req.params.id));
  res.json({ success: true, data });
}));

router.post('/', validate(createCustomerSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await customerService.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put('/:id', validate(createCustomerSchema.partial()), asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await customerService.update(getParam(req.params.id), req.body);
  res.json({ success: true, data });
}));

router.delete('/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  await customerService.softDelete(getParam(req.params.id));
  res.json({ success: true, message: 'Customer deleted' });
}));

router.get('/:id/orders', asyncHandler(async (req: AuthRequest, res: Response) => {
  const orders = await prisma.salesOrder.findMany({
    where: { customerId: getParam(req.params.id) },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { product: true } } },
  });
  res.json({ success: true, data: orders });
}));

export default router;
