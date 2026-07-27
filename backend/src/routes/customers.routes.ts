import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerListQuerySchema,
  createContactSchema,
} from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import prisma from '../config/database';
import { requireTenantId } from '../utils/tenant';

const router = Router();
router.use(authenticate);

const customerService = createCrudService('customer', ['name', 'code', 'email'], {
  contacts: true,
  _count: { select: { salesOrders: true, invoices: true, complaints: true, opportunities: true } },
});

router.get(
  '/',
  authorize('customers:read'),
  validate(customerListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, sortBy, sortOrder, type, isActive } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      type?: string;
      isActive?: boolean;
    }>(req.query);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive;

    const result = await customerService.list({ page, limit, search, sortBy, sortOrder, where });
    res.json({ success: true, ...result });
  })
);

router.get(
  '/:id',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await customerService.getById(getParam(req.params.id));
    res.json({ success: true, data });
  })
);

router.post(
  '/',
  authorize('customers:create'),
  validate(createCustomerSchema),
  auditLog('customers', 'create', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const existing = await prisma.customer.findUnique({
      where: { companyId_code: { companyId: requireTenantId(), code: req.body.code } },
    });
    if (existing) throw new AppError('Customer code already exists', 409);

    const data = await customerService.create(req.body);
    res.status(201).json({ success: true, data });
  })
);

router.put(
  '/:id',
  authorize('customers:update'),
  validate(updateCustomerSchema),
  auditLog('customers', 'update', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await customerService.update(getParam(req.params.id), req.body);
    res.json({ success: true, data });
  })
);

router.delete(
  '/:id',
  authorize('customers:delete'),
  auditLog('customers', 'delete', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await customerService.update(getParam(req.params.id), { isActive: false });
    await customerService.softDelete(getParam(req.params.id));
    res.json({ success: true, message: 'Customer deactivated' });
  })
);

router.get(
  '/:id/orders',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const orders = await prisma.salesOrder.findMany({
      where: { customerId: getParam(req.params.id) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { items: { include: { product: true } } },
    });
    res.json({ success: true, data: orders });
  })
);

router.post(
  '/:id/contacts',
  authorize('customers:update'),
  validate(createContactSchema),
  auditLog('customers', 'create', 'customer_contact'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const customerId = getParam(req.params.id);
    await customerService.getById(customerId);

    const { isPrimary, ...contactData } = req.body;
    if (isPrimary) {
      await prisma.customerContact.updateMany({
        where: { customerId },
        data: { isPrimary: false },
      });
    }

    const contact = await prisma.customerContact.create({
      data: {
        customerId,
        ...contactData,
        email: contactData.email || undefined,
        isPrimary: !!isPrimary,
      },
    });
    res.status(201).json({ success: true, data: contact });
  })
);

router.delete(
  '/:id/contacts/:contactId',
  authorize('customers:update'),
  auditLog('customers', 'delete', 'customer_contact'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const customerId = getParam(req.params.id);
    const contactId = getParam(req.params.contactId);

    const contact = await prisma.customerContact.findFirst({
      where: { id: contactId, customerId },
    });
    if (!contact) throw new AppError('Contact not found', 404);

    await prisma.customerContact.delete({ where: { id: contactId } });
    res.json({ success: true, message: 'Contact removed' });
  })
);

export default router;
