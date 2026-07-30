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
  salesPerson: { select: { id: true, firstName: true, lastName: true } },
  _count: { select: { salesOrders: true, invoices: true, complaints: true, opportunities: true } },
});

async function assertValidSalesPerson(salesPersonId: string | null | undefined) {
  if (!salesPersonId) return;
  const officer = await prisma.user.findFirst({
    where: {
      id: salesPersonId,
      companyId: requireTenantId(),
      deletedAt: null,
      status: 'ACTIVE',
      role: { name: 'Sales Officer' },
    },
    select: { id: true },
  });
  if (!officer) {
    throw new AppError('Selected sales person is not a valid Sales Officer', 400);
  }
}

router.get(
  '/',
  authorize('customers:read'),
  validate(customerListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, sortBy, sortOrder, type, isActive, salesPersonId, includeUnassigned } =
      getQuery<{
        page: number;
        limit: number;
        search?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        type?: string;
        isActive?: boolean;
        salesPersonId?: string;
        includeUnassigned?: boolean;
      }>(req.query);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive;

    // Sales officers see their own customers plus unassigned (free) accounts.
    if (req.user!.roleName === 'Sales Officer') {
      where.OR = [{ salesPersonId: req.user!.id }, { salesPersonId: null }];
    } else if (salesPersonId === 'none') {
      where.salesPersonId = null;
    } else if (salesPersonId) {
      where.OR = includeUnassigned
        ? [{ salesPersonId }, { salesPersonId: null }]
        : [{ salesPersonId }];
    }

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

    const payload = { ...req.body };
    if (req.user!.roleName === 'Sales Officer') {
      payload.salesPersonId = req.user!.id;
    } else {
      await assertValidSalesPerson(payload.salesPersonId);
    }

    const data = await customerService.create(payload);
    res.status(201).json({ success: true, data });
  })
);

router.put(
  '/:id',
  authorize('customers:update'),
  validate(updateCustomerSchema),
  auditLog('customers', 'update', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const payload = { ...req.body };
    if (req.user!.roleName === 'Sales Officer') {
      // Officers may edit their own customers or free (unassigned) ones; cannot reassign ownership.
      const existing = await prisma.customer.findFirst({
        where: {
          id: getParam(req.params.id),
          OR: [{ salesPersonId: req.user!.id }, { salesPersonId: null }],
        },
        select: { id: true },
      });
      if (!existing) throw new AppError('Customer not found', 404);
      delete payload.salesPersonId;
    } else if ('salesPersonId' in payload) {
      await assertValidSalesPerson(payload.salesPersonId);
    }

    const data = await customerService.update(getParam(req.params.id), payload);
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
