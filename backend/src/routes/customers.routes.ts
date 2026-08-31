import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createCustomerSchema,
  updateCustomerSchema,
  customerListQuerySchema,
  customerStatementQuerySchema,
  createContactSchema,
} from '../validators/schemas';
import { createCrudService } from '../utils/crud';
import { getParam, getQuery } from '../utils/request';
import prisma from '../config/database';
import { requireTenantId } from '../utils/tenant';
import { isSalesBookOwner, SALES_PERSON_ROLE_NAMES } from '../config/rolePermissions';
import { CustomerStatementService } from '../services/customerStatement.service';
import { ExcelImportService } from '../services/excel-import.service';
import { acceptExcelUpload } from '../middleware/excelImport';
import { z } from 'zod';

const router = Router();
router.use(authenticate);

router.get(
  '/import/template',
  authorize('customers:create'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const buffer = await ExcelImportService.buildTemplate('customers');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="customers-import-template.xlsx"');
    res.send(buffer);
  })
);

router.post(
  '/import',
  authorize('customers:create'),
  acceptExcelUpload,
  auditLog('customers', 'import', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.file?.buffer) throw new AppError('Spreadsheet file is required', 400);
    const data = await ExcelImportService.import('customers', req.file.buffer, req.user!.id, req.user!.companyId);
    res.json({ success: true, data });
  })
);

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
      role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
    },
    select: { id: true },
  });
  if (!officer) {
    throw new AppError('Selected sales person is not a valid sales role', 400);
  }
}

router.get(
  '/',
  authorize('customers:read'),
  validate(customerListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      page,
      limit,
      search,
      sortBy,
      sortOrder,
      type,
      vatStatus,
      isActive,
      salesPersonId,
      includeUnassigned,
    } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      type?: string;
      vatStatus?: 'VAT' | 'NON_VAT';
      isActive?: boolean;
      salesPersonId?: string;
      includeUnassigned?: boolean;
    }>(req.query);

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (vatStatus) where.vatStatus = vatStatus;
    if (isActive !== undefined) where.isActive = isActive;

    // Sales officers/reps see only customers assigned to them — not the free pool
    // and never other officers' books.
    if (isSalesBookOwner(req.user!.roleName)) {
      where.salesPersonId = req.user!.id;
    } else if (salesPersonId === 'none') {
      where.salesPersonId = null;
    } else if (salesPersonId) {
      where.OR = includeUnassigned
        ? [{ salesPersonId }, { salesPersonId: null }]
        : [{ salesPersonId }];
    }

    // Soft-deleted customers live in Recycle Bin only.
    const visibility =
      isActive === false
        ? { deletedAt: null, isActive: false }
        : isActive === true
          ? { deletedAt: null, isActive: true }
          : { deletedAt: null };

    const searchFilter = search
      ? {
          OR: [
            { name: { contains: search } },
            { code: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : {};

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.customer.findMany({
        where: { AND: [where, visibility, searchFilter] },
        skip,
        take: limit,
        orderBy: { [sortBy || 'createdAt']: sortOrder || 'desc' },
        include: {
          contacts: true,
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
          _count: {
            select: { salesOrders: true, invoices: true, complaints: true, opportunities: true },
          },
        },
      }),
      prisma.customer.count({ where: { AND: [where, visibility, searchFilter] } }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

const vatStatusReportQuery = z.object({
  vatStatus: z.enum(['VAT', 'NON_VAT', 'ALL']).default('ALL'),
});

router.get(
  '/reports/vat-status',
  authorizeAny('customers:read', 'reports:read', 'finance:read'),
  validate(vatStatusReportQuery, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { vatStatus } = getQuery<{ vatStatus: 'VAT' | 'NON_VAT' | 'ALL' }>(req.query);
    const data = await CustomerStatementService.getVatCustomerReport(vatStatus);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/vat-status/pdf',
  authorizeAny('customers:read', 'reports:read', 'finance:read'),
  validate(vatStatusReportQuery, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { vatStatus } = getQuery<{ vatStatus: 'VAT' | 'NON_VAT' | 'ALL' }>(req.query);
    const report = await CustomerStatementService.getVatCustomerReport(vatStatus);
    const { ExportService } = await import('../services/export.service');
    const pdf = await ExportService.generateVatCustomerReportPDF(report);
    const slug =
      vatStatus === 'ALL' ? 'vat-and-non-vat-customers' : vatStatus === 'VAT' ? 'vat-customers' : 'non-vat-customers';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.pdf"`);
    res.send(pdf);
  })
);

router.get(
  '/reports/vat-status/excel',
  authorizeAny('customers:read', 'reports:read', 'finance:read'),
  validate(vatStatusReportQuery, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { vatStatus } = getQuery<{ vatStatus: 'VAT' | 'NON_VAT' | 'ALL' }>(req.query);
    const report = await CustomerStatementService.getVatCustomerReport(vatStatus);
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateVatCustomerReportExcel(report);
    const slug =
      vatStatus === 'ALL' ? 'vat-and-non-vat-customers' : vatStatus === 'VAT' ? 'vat-customers' : 'non-vat-customers';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${slug}.xlsx"`);
    res.send(excel);
  })
);

router.get(
  '/:id/statement',
  authorizeAny('customers:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const data = await CustomerStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    res.json({ success: true, data });
  })
);

router.get(
  '/:id/statement/pdf',
  authorizeAny('customers:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const statement = await CustomerStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    const { ExportService } = await import('../services/export.service');
    const pdf = await ExportService.generateCustomerStatementPDF(statement);
    const suffix = statement.mode === 'OUTSTANDING' ? 'outstanding' : 'statement';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${statement.customer.code}-${suffix}.pdf"`
    );
    res.send(pdf);
  })
);

router.get(
  '/:id/statement/excel',
  authorizeAny('customers:read', 'finance:read', 'reports:read'),
  validate(customerStatementQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to, mode } = getQuery<{ from?: string; to?: string; mode?: 'FULL' | 'OUTSTANDING' }>(
      req.query
    );
    const statement = await CustomerStatementService.getStatement(
      getParam(req.params.id),
      from,
      to,
      mode || 'FULL'
    );
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateCustomerStatementExcel(statement);
    const suffix = statement.mode === 'OUTSTANDING' ? 'outstanding' : 'statement';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${statement.customer.code}-${suffix}.xlsx"`
    );
    res.send(excel);
  })
);

router.get(
  '/:id',
  authorize('customers:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.customer.findFirst({
      where: {
        id: getParam(req.params.id),
        ...(isSalesBookOwner(req.user!.roleName)
          ? { salesPersonId: req.user!.id }
          : {}),
      },
      include: {
        contacts: true,
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: { salesOrders: true, invoices: true, complaints: true, opportunities: true },
        },
      },
    });
    if (!data) throw new AppError('Customer not found', 404);
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
    if (isSalesBookOwner(req.user!.roleName)) {
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
    if (isSalesBookOwner(req.user!.roleName)) {
      // Sales officers/reps may only edit customers assigned to them.
      const existing = await prisma.customer.findFirst({
        where: {
          id: getParam(req.params.id),
          salesPersonId: req.user!.id,
        },
        select: { id: true },
      });
      if (!existing) throw new AppError('Customer not found', 404);
      delete payload.salesPersonId;
    } else if ('salesPersonId' in payload) {
      await assertValidSalesPerson(payload.salesPersonId);
    }

    const id = getParam(req.params.id);
    const existing = await prisma.customer.findFirst({ where: { id } });
    if (!existing) throw new AppError('Customer not found', 404);

    // Reactivating via edit also clears any historical soft-delete flag.
    if (payload.isActive === true) {
      payload.deletedAt = null;
    }

    const data = await prisma.customer.update({
      where: { id },
      data: payload,
      include: {
        contacts: true,
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: { salesOrders: true, invoices: true, complaints: true, opportunities: true },
        },
      },
    });
    res.json({ success: true, data });
  })
);

router.delete(
  '/:id',
  authorize('customers:delete'),
  auditLog('customers', 'delete', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Soft delete — hidden from active lists; restore/purge via Recycle Bin.
    const id = getParam(req.params.id);
    const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new AppError('Customer not found', 404);
    const data = await prisma.customer.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
      include: {
        contacts: true,
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: { salesOrders: true, invoices: true, complaints: true, opportunities: true },
        },
      },
    });
    res.json({ success: true, message: 'Customer moved to trash', data });
  })
);

router.post(
  '/:id/activate',
  authorizeAny('customers:update', 'customers:delete'),
  auditLog('customers', 'update', 'customer'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const existing = await prisma.customer.findFirst({ where: { id } });
    if (!existing) throw new AppError('Customer not found', 404);

    const data = await prisma.customer.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
      include: {
        contacts: true,
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: { salesOrders: true, invoices: true, complaints: true, opportunities: true },
        },
      },
    });
    res.json({ success: true, message: 'Customer activated', data });
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
