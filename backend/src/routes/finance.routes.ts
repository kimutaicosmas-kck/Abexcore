import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest, authorizeAny, requireSalesTargetManager } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  companySettingsSchema,
  financeListQuerySchema,
  paymentListQuerySchema,
  paginationSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createJournalEntrySchema,
  salesByPersonQuerySchema,
  productsSoldQuerySchema,
  mySalesQuerySchema,
  salesPerformanceQuerySchema,
  upsertSalesTargetSchema,
  grnIdParamSchema,
  orderIdParamSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import {
  dayRangeFromInput,
  generateNumber,
  isSameLocalMonth,
  isSameLocalWeek,
  paymentPeriodRange,
  type PaymentInvoiceTimingPreset,
  type PaymentPeriodPreset,
} from '../utils/date';
import { nextInvoiceNumber } from '../utils/numbering';
import { getParam, getQuery } from '../utils/request';
import { FinanceService, ReportsService } from '../services/admin.service';
import { AccountingService } from '../services/accounting.service';
import { FinanceInvoiceService, FinancePaymentService } from '../services/finance.service';
import { SalesOrderService } from '../services/sales-order.service';
import { getCompanySettings, getVatRate, getCustomerVatRate, calcTax, roundMoney, splitInclusiveAmount } from '../utils/company';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import { syncCustomerCreditUsed } from '../utils/credit';
import { InvoiceMaintenanceService } from '../services/invoice-maintenance.service';
import { BankReconciliationService } from '../services/bank-reconciliation.service';
import { KraEtimsService } from '../services/kra-etims.service';
import { Prisma } from '@prisma/client';

const DATE_PERIODS = new Set<PaymentPeriodPreset>([
  'this_week',
  'last_week',
  'this_month',
  'last_month',
]);

const INVOICE_TIMING_PERIODS = new Set<PaymentInvoiceTimingPreset>([
  'same_week_as_invoice',
  'same_month_as_invoice',
  'this_week_taken_and_paid',
  'this_month_taken_and_paid',
]);

/** Payment IDs where payment date aligns with invoice issue date (MySQL YEARWEEK mode 1 = Monday). */
async function paymentIdsByInvoiceTiming(
  companyId: string,
  timing: PaymentInvoiceTimingPreset
): Promise<string[]> {
  let rows: { id: string }[] = [];
  if (timing === 'same_week_as_invoice') {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id AS id
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.company_id = ${companyId}
        AND i.company_id = ${companyId}
        AND p.invoice_id IS NOT NULL
        AND YEARWEEK(p.payment_date, 1) = YEARWEEK(i.invoice_date, 1)
    `;
  } else if (timing === 'same_month_as_invoice') {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id AS id
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.company_id = ${companyId}
        AND i.company_id = ${companyId}
        AND p.invoice_id IS NOT NULL
        AND YEAR(p.payment_date) = YEAR(i.invoice_date)
        AND MONTH(p.payment_date) = MONTH(i.invoice_date)
    `;
  } else if (timing === 'this_week_taken_and_paid') {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id AS id
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.company_id = ${companyId}
        AND i.company_id = ${companyId}
        AND p.invoice_id IS NOT NULL
        AND YEARWEEK(p.payment_date, 1) = YEARWEEK(CURDATE(), 1)
        AND YEARWEEK(i.invoice_date, 1) = YEARWEEK(CURDATE(), 1)
    `;
  } else {
    rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT p.id AS id
      FROM payments p
      INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE p.company_id = ${companyId}
        AND i.company_id = ${companyId}
        AND p.invoice_id IS NOT NULL
        AND YEAR(p.payment_date) = YEAR(CURDATE())
        AND MONTH(p.payment_date) = MONTH(CURDATE())
        AND YEAR(i.invoice_date) = YEAR(CURDATE())
        AND MONTH(i.invoice_date) = MONTH(CURDATE())
    `;
  }
  return rows.map((r) => r.id);
}

type PaymentListFilters = {
  search?: string;
  period?: PaymentPeriodPreset | PaymentInvoiceTimingPreset;
  from?: string;
  to?: string;
  method?: string;
};

/** Shared filters for payments list + Excel export. Returns null when filters match nothing. */
async function buildPaymentWhere(
  companyId: string,
  filters: PaymentListFilters
): Promise<Prisma.PaymentWhereInput | null> {
  const { search, period, from, to, method } = filters;
  const where: Prisma.PaymentWhereInput = { companyId };

  if (period && INVOICE_TIMING_PERIODS.has(period as PaymentInvoiceTimingPreset)) {
    const ids = await paymentIdsByInvoiceTiming(companyId, period as PaymentInvoiceTimingPreset);
    if (ids.length === 0) return null;
    where.id = { in: ids };
  } else if (period && DATE_PERIODS.has(period as PaymentPeriodPreset)) {
    where.paymentDate = paymentPeriodRange(period as PaymentPeriodPreset);
  } else if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    if (from) {
      const fromRange = dayRangeFromInput(from);
      if (fromRange) range.gte = fromRange.gte;
    }
    if (to) {
      const toRange = dayRangeFromInput(to);
      if (toRange) range.lte = toRange.lte;
    }
    if (Object.keys(range).length) where.paymentDate = range;
  }

  if (method) {
    where.method = method as Prisma.PaymentWhereInput['method'];
  }

  if (search) {
    where.AND = [
      {
        OR: [
          { paymentNumber: { contains: search } },
          { reference: { contains: search } },
          { bankReference: { contains: search } },
          { invoice: { invoiceNumber: { contains: search } } },
          { invoice: { customer: { name: { contains: search } } } },
        ],
      },
    ];
  }

  return where;
}

const router = Router();
router.use(authenticate);

router.get(
  '/config',
  authorizeAny('finance:read', 'sales:read', 'settings:read', 'customers:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const company = await getCompanySettings(requireTenantId());
    res.json({
      success: true,
      data: company
        ? {
            name: company.name,
            legalName: company.legalName,
            vatRate: Number(company.vatRate),
            currency: company.currency,
            taxPin: company.taxPin,
            email: company.email,
            phone: company.phone,
            address: company.address,
          }
        : { name: 'Company', vatRate: 16, currency: 'KES' },
    });
  })
);

router.get(
  '/stats',
  authorize('finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await FinanceService.getStats();
    res.json({ success: true, data });
  })
);

router.get(
  '/overview',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const days = Math.min(90, Math.max(7, Number(getQuery<{ days?: number }>(req.query).days) || 30));
    const data = await FinanceService.getOverview(days);
    res.json({ success: true, data });
  })
);

router.post(
  '/maintenance/mark-overdue',
  authorize('finance:update'),
  auditLog('finance', 'update', 'invoice'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const marked = await InvoiceMaintenanceService.markOverdueInvoices();
    res.json({ success: true, data: { marked } });
  })
);

// Company Settings
router.get(
  '/company',
  authorize('settings:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const company = await getCompanySettings(requireTenantId());
    if (!company) throw new AppError('Company not found', 404);
    res.json({ success: true, data: company });
  })
);

router.put(
  '/company',
  authorize('settings:update'),
  validate(companySettingsSchema),
  auditLog('settings', 'update', 'company'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const companyId = requireTenantId();
    const company = await prisma.company.update({
      where: { id: companyId },
      data: req.body,
      include: { branches: true, taxRates: true },
    });
    res.json({ success: true, data: company });
  })
);

// Invoices
router.get(
  '/invoices/:id/pdf',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const invoice = await ExportService.getInvoice(getParam(req.params.id));
    const pdf = await ExportService.generateInvoicePDF(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
    res.send(pdf);
  })
);

router.get(
  '/invoices/:id/excel',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const invoice = await ExportService.getInvoice(getParam(req.params.id));
    const excel = await ExportService.generateInvoiceExcel(invoice);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.xlsx"`);
    res.send(excel);
  })
);

router.get(
  '/invoices',
  authorize('finance:read'),
  validate(financeListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const { page, limit, search, type, status, cursor } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      type?: string;
      status?: string;
      cursor?: string;
    }>(req.query);

    const where: Prisma.InvoiceWhereInput = {};
    if (type) where.type = type as Prisma.EnumInvoiceTypeFilter['equals'];
    if (status) where.status = status as Prisma.EnumPaymentStatusFilter['equals'];
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { supplier: { name: { contains: search } } },
      ];
    }

    const invoiceInclude = {
      customer: true,
      supplier: true,
      items: true,
      payments: true,
      salesOrder: {
        select: {
          id: true,
          orderNumber: true,
          salesPersonId: true,
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    } as const;

    if (cursor) {
      const { buildCursorResult } = await import('../utils/cursorPagination');
      const rows = await prisma.invoice.findMany({
        where,
        take: limit + 1,
        cursor: { id: cursor },
        skip: 1,
        include: invoiceInclude,
        orderBy: { createdAt: 'desc' },
      });
      const pageResult = buildCursorResult(rows, limit);
      res.json({
        success: true,
        data: pageResult.data,
        pagination: {
          limit: pageResult.limit,
          nextCursor: pageResult.nextCursor,
          prevCursor: pageResult.prevCursor,
          hasMore: pageResult.hasMore,
        },
      });
      return;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        include: invoiceInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/invoices/:id',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.invoice.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        customer: true,
        supplier: true,
        items: true,
        payments: true,
        salesOrder: {
          select: {
            id: true,
            orderNumber: true,
            salesPersonId: true,
            salesPerson: { select: { id: true, firstName: true, lastName: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!data) throw new AppError('Invoice not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/invoices',
  authorize('finance:create'),
  validate(createInvoiceSchema),
  auditLog('finance', 'create', 'invoice'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      type,
      customerId,
      supplierId,
      salesOrderId,
      purchaseOrderId,
      dueDate,
      customerPoNumber,
      items,
      notes,
    } = req.body;

    let vatRate = await getVatRate();
    if ((type === 'SALES' || type === 'CREDIT_NOTE') && customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, companyId: requireTenantId(), deletedAt: null },
        select: { vatStatus: true },
      });
      if (!customer) throw new AppError('Customer not found', 404);
      vatRate = await getCustomerVatRate(customer);
    }

    const keyedTotal = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number }) =>
        sum + item.quantity * item.unitPrice,
      0
    );
    // Sales/credit notes: keyed prices include VAT. Purchases: VAT added on top of cost.
    const isSalesSide = type === 'SALES' || type === 'CREDIT_NOTE';
    const purchaseTax = calcTax(keyedTotal, vatRate);
    const { subtotal, taxAmount, totalAmount } = isSalesSide
      ? splitInclusiveAmount(keyedTotal, vatRate)
      : {
          subtotal: keyedTotal,
          taxAmount: purchaseTax,
          totalAmount: keyedTotal + purchaseTax,
        };

    const invoice = await prisma.$transaction(async (tx) => {
      let resolvedCustomerPo = customerPoNumber as string | undefined;
      if (type === 'SALES' && salesOrderId) {
        const order = await tx.salesOrder.findUnique({
          where: { id: salesOrderId },
          include: { items: { include: { product: true } } },
        });
        if (!order) throw new AppError('Sales order not found', 404);
        if (!resolvedCustomerPo && order.customerPoNumber) {
          resolvedCustomerPo = order.customerPoNumber;
        }
        await SalesOrderService.validateOrderLinesForInvoicing(
          tx,
          order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            product: item.product,
          }))
        );
      }

      const invoiceNumber = await nextInvoiceNumber(tx, type === 'SALES' ? 'INV' : 'PINV');
      const inv = await tx.invoice.create({
        data: injectTenantData({
          invoiceNumber,
          type,
          customerId,
          supplierId,
          salesOrderId,
          purchaseOrderId,
          customerPoNumber: type === 'SALES' ? resolvedCustomerPo : undefined,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          fiscalStatus: type === 'SALES' ? 'PENDING' : 'NOT_REQUIRED',
          subtotal,
          taxAmount,
          totalAmount,
          notes,
          items: {
            create: items.map((item: { description: string; quantity: number; unitPrice: number }) => ({
              ...item,
              unitPrice: roundMoney(item.unitPrice),
              taxRate: vatRate,
              totalPrice: roundMoney(item.quantity * item.unitPrice),
            })),
          },
        }),
        include: { customer: true, supplier: true, items: true },
      });

      if (type === 'SALES') {
        await AccountingService.postSalesInvoice(tx, {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          subtotal: Number(inv.subtotal),
          taxAmount: Number(inv.taxAmount),
          totalAmount: Number(inv.totalAmount),
        });
        if (customerId) await syncCustomerCreditUsed(customerId, tx);
      }

      if (type === 'PURCHASE') {
        await AccountingService.postPurchaseInvoice(tx, {
          invoiceNumber: inv.invoiceNumber,
          subtotal: Number(inv.subtotal),
          taxAmount: Number(inv.taxAmount),
          totalAmount: Number(inv.totalAmount),
        });
      }

      return inv;
    });

    res.status(201).json({ success: true, data: invoice });
  })
);

router.post(
  '/invoices/from-grn/:grnId',
  authorize('finance:create'),
  validate(grnIdParamSchema, 'params'),
  auditLog('finance', 'create', 'invoice'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const grnId = getParam(req.params.grnId);
    const existing = await prisma.invoice.findFirst({
      where: { goodsReceiptId: grnId, type: 'PURCHASE' },
    });
    if (existing) throw new AppError('Purchase invoice already exists for this goods receipt', 409);

    const invoice = await prisma.$transaction(async (tx) =>
      FinanceInvoiceService.createPurchaseInvoiceFromGrn(tx, grnId)
    );

    res.status(201).json({ success: true, data: invoice });
  })
);

router.post(
  '/invoices/from-order/:orderId',
  authorize('finance:create'),
  validate(orderIdParamSchema, 'params'),
  auditLog('finance', 'create', 'invoice'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const orderId = getParam(req.params.orderId);
    const existing = await prisma.invoice.findFirst({
      where: { salesOrderId: orderId, type: 'SALES', deliveryNoteId: null },
    });
    if (existing) throw new AppError('Invoice already exists for this order', 409);

    const invoice = await prisma.$transaction(async (tx) =>
      FinanceInvoiceService.createSalesInvoiceFromOrder(tx, orderId)
    );

    res.status(201).json({ success: true, data: invoice });
  })
);

router.post(
  '/payments',
  authorize('finance:create'),
  validate(createPaymentSchema),
  auditLog('finance', 'create', 'payment'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { invoiceId, amount, method, reference, notes } = req.body;

    const payment = await prisma.$transaction(async (tx) =>
      FinancePaymentService.recordPayment(tx, {
        invoiceId,
        amount: Number(amount),
        method,
        reference,
        notes,
      })
    );

    res.status(201).json({ success: true, data: payment });
  })
);

router.get(
  '/payments',
  authorize('finance:read'),
  validate(paymentListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, period, from, to, method } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      period?: PaymentPeriodPreset | PaymentInvoiceTimingPreset;
      from?: string;
      to?: string;
      method?: string;
    }>(req.query);
    const skip = (page - 1) * limit;
    const companyId = requireTenantId();
    const where = await buildPaymentWhere(companyId, { search, period, from, to, method });

    if (!where) {
      res.json({
        success: true,
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        filters: { period: period || null, from: from || null, to: to || null, method: method || null },
      });
      return;
    }

    const [rows, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              invoiceDate: true,
              customer: { select: { name: true } },
              supplier: { select: { name: true } },
              salesOrder: {
                select: { id: true, orderNumber: true, orderDate: true },
              },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.payment.count({ where }),
    ]);

    const data = rows.map((p) => {
      const invoiceDate = p.invoice?.invoiceDate ? new Date(p.invoice.invoiceDate) : null;
      const paidOn = new Date(p.paymentDate);
      const paidSameWeekAsInvoice = !!(invoiceDate && isSameLocalWeek(paidOn, invoiceDate));
      const paidSameMonthAsInvoice = !!(invoiceDate && isSameLocalMonth(paidOn, invoiceDate));
      return {
        ...p,
        paidSameWeekAsInvoice,
        paidSameMonthAsInvoice,
      };
    });

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: { period: period || null, from: from || null, to: to || null, method: method || null },
    });
  })
);

router.get(
  '/payments/excel',
  authorize('finance:read'),
  validate(paymentListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search, period, from, to, method } = getQuery<{
      search?: string;
      period?: PaymentPeriodPreset | PaymentInvoiceTimingPreset;
      from?: string;
      to?: string;
      method?: string;
    }>(req.query);
    const companyId = requireTenantId();
    const where = await buildPaymentWhere(companyId, { search, period, from, to, method });

    const rows = where
      ? await prisma.payment.findMany({
          where,
          take: 5000,
          include: {
            invoice: {
              select: {
                invoiceNumber: true,
                invoiceDate: true,
                customer: { select: { name: true } },
                supplier: { select: { name: true } },
                salesOrder: { select: { orderNumber: true } },
              },
            },
          },
          orderBy: { paymentDate: 'desc' },
        })
      : [];

    const exportRows = rows.map((p) => {
      const invoiceDate = p.invoice?.invoiceDate ? new Date(p.invoice.invoiceDate) : null;
      const paidOn = new Date(p.paymentDate);
      return {
        paymentNumber: p.paymentNumber,
        paymentDate: p.paymentDate,
        amount: Number(p.amount),
        method: p.method,
        reference: p.reference,
        bankReference: p.bankReference,
        invoiceNumber: p.invoice?.invoiceNumber || null,
        partyName: p.invoice?.customer?.name || p.invoice?.supplier?.name || null,
        orderNumber: p.invoice?.salesOrder?.orderNumber || null,
        paidSameWeekAsInvoice: !!(invoiceDate && isSameLocalWeek(paidOn, invoiceDate)),
        paidSameMonthAsInvoice: !!(invoiceDate && isSameLocalMonth(paidOn, invoiceDate)),
      };
    });

    const filterParts = [
      period ? `Period: ${period}` : null,
      from || to ? `Dates: ${from || '…'} to ${to || '…'}` : null,
      method ? `Method: ${method}` : null,
      search ? `Search: ${search}` : null,
      `Rows: ${exportRows.length}`,
    ].filter(Boolean);

    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generatePaymentsExcel(exportRows, filterParts.join(' · ') || undefined);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="payments.xlsx"');
    res.send(excel);
  })
);

router.get(
  '/accounts',
  authorize('finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      include: { children: true },
      orderBy: { code: 'asc' },
    });
    res.json({ success: true, data: accounts });
  })
);

router.get(
  '/notifications',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id, isRead: false },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifications });
  })
);

router.patch(
  '/notifications/read-all',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, isRead: false },
      data: { isRead: true },
    });
    res.json({ success: true, data: { marked: result.count } });
  })
);

router.patch(
  '/notifications/:id/read',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await prisma.notification.updateMany({
      where: { id: getParam(req.params.id), userId: req.user!.id },
      data: { isRead: true },
    });
    if (result.count === 0) {
      throw new AppError('Notification not found', 404);
    }
    res.json({ success: true });
  })
);

router.get(
  '/reports/summary',
  authorize('reports:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await ReportsService.getOverview();
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/sales/excel',
  authorize('reports:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateSalesReportExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
    res.send(excel);
  })
);

router.get(
  '/reports/sales-by-person/sales-officers',
  authorize('reports:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const { SalespersonReportService } = await import('../services/salesperson-report.service');
    const data = await SalespersonReportService.listSalesOfficers();
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/sales-by-person',
  authorize('reports:read'),
  validate(salesByPersonQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      page: number;
      limit: number;
      salesPersonId?: string;
      startDate?: string;
      endDate?: string;
    }>(req.query);
    const { SalespersonReportService } = await import('../services/salesperson-report.service');
    const data = await SalespersonReportService.getReport(query);
    res.json({ success: true, data, pagination: data.pagination });
  })
);

router.get(
  '/reports/sales-by-person/excel',
  authorize('reports:read'),
  validate(salesByPersonQuerySchema.omit({ page: true, limit: true }), 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      salesPersonId?: string;
      startDate?: string;
      endDate?: string;
    }>(req.query);
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateSalesByPersonExcel(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sales-by-salesperson.xlsx"'
    );
    res.send(excel);
  })
);

router.get(
  '/reports/products-sold',
  authorize('reports:read'),
  validate(productsSoldQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      page: number;
      limit: number;
      startDate?: string;
      endDate?: string;
      search?: string;
      productId?: string;
      needsRestockOnly?: boolean;
    }>(req.query);
    const { ProductsSoldReportService } = await import('../services/products-sold-report.service');
    const data = await ProductsSoldReportService.getReport(query);
    res.json({ success: true, data, pagination: data.pagination });
  })
);

router.get(
  '/reports/products-sold/excel',
  authorize('reports:read'),
  validate(productsSoldQuerySchema.omit({ page: true, limit: true }), 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      startDate?: string;
      endDate?: string;
      search?: string;
      productId?: string;
      needsRestockOnly?: boolean;
    }>(req.query);
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateProductsSoldExcel(query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="products-sold-statement.xlsx"');
    res.send(excel);
  })
);

router.get(
  '/my-sales',
  authorizeAny('sales:read', 'reports:read', 'finance:read'),
  validate(mySalesQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const query = getQuery<{
      page: number;
      limit: number;
      salesPersonId?: string;
      from?: string;
      to?: string;
    }>(req.query);

    let salesPersonId = query.salesPersonId || req.user!.id;
    const canViewOthers =
      req.user!.roleName === 'Super Admin' ||
      req.user!.permissions.includes('reports:read') ||
      req.user!.permissions.includes('finance:read');
    if (salesPersonId !== req.user!.id && !canViewOthers) {
      throw new AppError('You can only view your own sales performance', 403);
    }

    const { MySalesService } = await import('../services/my-sales.service');
    const data = await MySalesService.getDashboard({ ...query, salesPersonId });
    res.json({ success: true, data, pagination: data.pagination });
  })
);

router.get(
  '/sales-performance',
  authorizeAny('reports:read', 'finance:read'),
  validate(salesPerformanceQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { from, to } = getQuery<{ from?: string; to?: string }>(req.query);
    const { SalesPerformanceService } = await import('../services/sales-performance.service');
    const data = await SalesPerformanceService.getTeamPerformance(from, to);
    res.json({ success: true, data });
  })
);

router.get(
  '/sales-targets',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { year, month } = getQuery<{ year?: number; month?: number }>(req.query);
    const { MySalesService } = await import('../services/my-sales.service');
    const { canManageSalesTargets } = await import('../config/rolePermissions');

    if (
      canManageSalesTargets(req.user!.roleName, req.user!.permissions) ||
      req.user!.permissions.includes('reports:read')
    ) {
      const data = await MySalesService.listTargets(
        year ? Number(year) : undefined,
        month ? Number(month) : undefined
      );
      res.json({ success: true, data });
      return;
    }

    const { isSalesPersonRole } = await import('../config/rolePermissions');
    if (!isSalesPersonRole(req.user!.roleName)) {
      throw new AppError('Sales targets are only available for sales roles', 403);
    }

    const now = new Date();
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const y = year ? Number(year) : now.getFullYear();
    const m = month ? Number(month) : now.getMonth() + 1;
    const targetAmount = await MySalesService.getMonthlyTarget(req.user!.id, y, m);
    res.json({
      success: true,
      data: [{
        salesPersonId: req.user!.id,
        name: user ? `${user.firstName} ${user.lastName}`.trim() : req.user!.email,
        email: user?.email || req.user!.email,
        year: y,
        month: m,
        targetAmount,
      }],
    });
  })
);

router.put(
  '/sales-targets',
  requireSalesTargetManager,
  validate(upsertSalesTargetSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { salesPersonId, year, month, targetAmount } = req.body;
    const { MySalesService } = await import('../services/my-sales.service');
    const data = await MySalesService.upsertTarget(salesPersonId, year, month, targetAmount);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/inventory/excel',
  authorize('reports:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const excel = await ExportService.generateInventoryReportExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.xlsx"');
    res.send(excel);
  })
);

router.get(
  '/journal-entries',
  authorize('finance:read'),
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.JournalEntryWhereInput = search
      ? {
          OR: [
            { entryNumber: { contains: search } },
            { description: { contains: search } },
            { reference: { contains: search } },
          ],
        }
      : {};

    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: limit,
        include: { lines: { include: { account: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.journalEntry.count({ where }),
    ]);

    const invoiceIds = [
      ...new Set(
        rows
          .filter((row) => row.sourceType === 'INVOICE' && row.sourceId)
          .map((row) => row.sourceId as string)
      ),
    ];
    const invoices = invoiceIds.length
      ? await prisma.invoice.findMany({
          where: { id: { in: invoiceIds }, companyId: requireTenantId() },
          select: {
            id: true,
            invoiceNumber: true,
            type: true,
            totalAmount: true,
            status: true,
            customer: { select: { name: true } },
            supplier: { select: { name: true } },
          },
        })
      : [];
    const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));

    const data = rows.map((row) => ({
      ...row,
      invoice:
        row.sourceType === 'INVOICE' && row.sourceId
          ? invoiceById.get(row.sourceId) || null
          : null,
    }));

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.post(
  '/journal-entries',
  authorize('finance:create'),
  validate(createJournalEntrySchema),
  auditLog('finance', 'create', 'journal_entry'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { date, description, reference, invoiceId, lines } = req.body;
    const { AccountingService } = await import('../services/accounting.service');
    const companyId = requireTenantId();

    let sourceType = 'MANUAL';
    let sourceId: string | undefined;
    let resolvedReference = reference as string | undefined;

    if (invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, companyId },
        select: { id: true, invoiceNumber: true },
      });
      if (!invoice) throw new AppError('Invoice not found', 404);
      sourceType = 'INVOICE';
      sourceId = invoice.id;
      if (!resolvedReference?.trim()) {
        resolvedReference = invoice.invoiceNumber;
      }
    }

    const entry = await prisma.$transaction(async (tx) =>
      AccountingService.createJournalEntry(tx, {
        date: date ? new Date(date) : new Date(),
        description,
        reference: resolvedReference,
        sourceType,
        sourceId,
        lines: lines.map(
          (line: { accountId: string; debit: number; credit: number; description?: string }) => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            description: line.description,
          })
        ),
      })
    );

    res.status(201).json({ success: true, data: entry });
  })
);

router.get(
  '/reports/trial-balance',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { AccountingService } = await import('../services/accounting.service');
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : undefined;
    const data = await AccountingService.getTrialBalance(asOf);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/general-ledger/:accountCode',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { AccountingService } = await import('../services/accounting.service');
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const end = req.query.end ? new Date(String(req.query.end)) : undefined;
    const data = await AccountingService.getGeneralLedger(getParam(req.params.accountCode), start, end);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/profit-loss',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { FinancialReportsService } = await import('../services/financial-reports.service');
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const end = req.query.end ? new Date(String(req.query.end)) : undefined;
    const data = await FinancialReportsService.getProfitAndLoss(start, end);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/balance-sheet',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { FinancialReportsService } = await import('../services/financial-reports.service');
    const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : undefined;
    const data = await FinancialReportsService.getBalanceSheet(asOf);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/cash-flow',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { FinancialReportsService } = await import('../services/financial-reports.service');
    const months = req.query.months ? parseInt(String(req.query.months), 10) : 6;
    const data = await FinancialReportsService.getCashFlow(months);
    res.json({ success: true, data });
  })
);

router.get(
  '/reports/vat',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { FinancialReportsService } = await import('../services/financial-reports.service');
    const start = req.query.start ? new Date(String(req.query.start)) : undefined;
    const end = req.query.end ? new Date(String(req.query.end)) : undefined;
    const data = await FinancialReportsService.getVatReport(start, end);
    res.json({ success: true, data });
  })
);

router.get(
  '/bank-reconciliation',
  authorize('finance:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await BankReconciliationService.getReport();
    res.json({ success: true, data });
  })
);

router.post(
  '/bank-statements/import',
  authorize('finance:update'),
  auditLog('finance', 'create', 'bank_statement'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { csvText, pdfBase64, periodStart, periodEnd, openingBalance, closingBalance, bankAccountCode, notes } =
      req.body as {
        csvText?: string;
        pdfBase64?: string;
        periodStart: string;
        periodEnd: string;
        openingBalance?: number;
        closingBalance?: number;
        bankAccountCode?: string;
        notes?: string;
      };

    if ((!csvText && !pdfBase64) || !periodStart || !periodEnd) {
      throw new AppError('Provide csvText or pdfBase64, plus periodStart and periodEnd', 400);
    }

    const statement = await BankReconciliationService.importStatement({
      csvText,
      pdfBase64,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      openingBalance,
      closingBalance,
      bankAccountCode,
      notes,
    });

    res.status(201).json({ success: true, data: statement });
  })
);

router.post(
  '/bank-reconciliation/auto-match/:statementId',
  authorize('finance:update'),
  auditLog('finance', 'update', 'bank_statement'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await BankReconciliationService.autoMatchPayments(getParam(req.params.statementId));
    res.json({ success: true, data: result });
  })
);

router.post(
  '/invoices/:id/submit-etims',
  authorize('finance:update'),
  auditLog('finance', 'update', 'invoice'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const invoice = await prisma.$transaction(async (tx) =>
      KraEtimsService.submitInvoice(getParam(req.params.id), tx)
    );
    res.json({ success: true, data: invoice });
  })
);

router.get(
  '/reports/vat-itax-export',
  authorize('reports:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const start = req.query.start
      ? new Date(String(req.query.start))
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const end = req.query.end ? new Date(String(req.query.end)) : new Date();
    const data = await KraEtimsService.generateVatItaxExport(start, end);
    res.json({ success: true, data });
  })
);

router.post(
  '/kra/validate-pin',
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { taxPin } = req.body as { taxPin?: string };
    if (!taxPin) throw new AppError('taxPin is required', 400);
    const data = await KraEtimsService.validatePin(taxPin);
    res.json({ success: true, data });
  })
);

router.patch(
  '/payments/:id/reconcile',
  authorize('finance:update'),
  auditLog('finance', 'update', 'payment'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { bankReference } = req.body;
    const payment = await prisma.payment.update({
      where: { id: getParam(req.params.id) },
      data: {
        isReconciled: true,
        reconciledAt: new Date(),
        bankReference: bankReference || undefined,
        reconciledById: req.user!.id,
      },
    });
    res.json({ success: true, data: payment });
  })
);

router.patch(
  '/payments/:id/unreconcile',
  authorize('finance:update'),
  auditLog('finance', 'update', 'payment'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const paymentId = getParam(req.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.bankStatementLine.updateMany({
        where: { matchedPaymentId: paymentId },
        data: { matchStatus: 'UNMATCHED', matchedPaymentId: null },
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          isReconciled: false,
          reconciledAt: null,
          reconciledById: null,
        },
      });
    });
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    res.json({ success: true, data: payment });
  })
);

export default router;
