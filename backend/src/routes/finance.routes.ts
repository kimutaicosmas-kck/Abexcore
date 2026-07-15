import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  companySettingsSchema,
  financeListQuerySchema,
  paginationSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createJournalEntrySchema,
} from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { FinanceService, ReportsService } from '../services/admin.service';
import { AccountingService } from '../services/accounting.service';
import { FinanceInvoiceService, FinancePaymentService } from '../services/finance.service';
import { getVatRate, calcTax } from '../utils/company';
import { syncCustomerCreditUsed } from '../utils/credit';
import { InvoiceMaintenanceService } from '../services/invoice-maintenance.service';
import { BankReconciliationService } from '../services/bank-reconciliation.service';
import { KraEtimsService } from '../services/kra-etims.service';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

router.get(
  '/config',
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const company = await prisma.company.findFirst({
      select: { name: true, legalName: true, vatRate: true, currency: true, taxPin: true, email: true, phone: true, address: true },
    });
    res.json({
      success: true,
      data: company ?? { name: 'Company', vatRate: 16, currency: 'KES' },
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
    const company = await prisma.company.findFirst({
      include: { branches: true, taxRates: true },
    });
    res.json({ success: true, data: company });
  })
);

router.put(
  '/company',
  authorize('settings:update'),
  validate(companySettingsSchema),
  auditLog('settings', 'update', 'company'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const existing = await prisma.company.findFirst();
    const company = existing
      ? await prisma.company.update({ where: { id: existing.id }, data: req.body })
      : await prisma.company.create({ data: req.body });
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

    const { page, limit, search, type, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      type?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

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

    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: limit,
        include: { customer: true, supplier: true, items: true, payments: true },
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
      include: { customer: true, supplier: true, items: true, payments: true },
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
    const { type, customerId, supplierId, salesOrderId, purchaseOrderId, dueDate, items, notes } =
      req.body;
    const count = await prisma.invoice.count();
    const invoiceNumber = generateNumber(type === 'SALES' ? 'INV' : 'PINV', count + 1);
    const vatRate = await getVatRate();

    const subtotal = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number }) =>
        sum + item.quantity * item.unitPrice,
      0
    );
    const taxAmount = calcTax(subtotal, vatRate);
    const totalAmount = subtotal + taxAmount;

    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber,
          type,
          customerId,
          supplierId,
          salesOrderId,
          purchaseOrderId,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          fiscalStatus: type === 'SALES' ? 'PENDING' : 'NOT_REQUIRED',
          subtotal,
          taxAmount,
          totalAmount,
          notes,
          items: {
            create: items.map((item: { description: string; quantity: number; unitPrice: number }) => ({
              ...item,
              taxRate: vatRate,
              totalPrice: item.quantity * item.unitPrice,
            })),
          },
        },
        include: { customer: true, supplier: true, items: true },
      });

      if (type === 'SALES') {
        await AccountingService.postSalesInvoice(tx, {
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
  validate(paginationSchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search } = getQuery<{ page: number; limit: number; search?: string }>(
      req.query
    );
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = search
      ? {
          OR: [
            { paymentNumber: { contains: search } },
            { reference: { contains: search } },
            { invoice: { invoiceNumber: { contains: search } } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              customer: { select: { name: true } },
              supplier: { select: { name: true } },
            },
          },
        },
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.payment.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
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
  authorize('finance:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ success: true, data: notifications });
  })
);

router.patch(
  '/notifications/:id/read',
  authorize('finance:update'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await prisma.notification.update({
      where: { id: getParam(req.params.id) },
      data: { isRead: true },
    });
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

    const [data, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: limit,
        include: { lines: { include: { account: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.journalEntry.count({ where }),
    ]);

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
    const { date, description, reference, lines } = req.body;
    const count = await prisma.journalEntry.count();
    const entryNumber = generateNumber('JE', count + 1);

    const entry = await prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.create({
        data: {
          entryNumber,
          date: date ? new Date(date) : new Date(),
          description,
          reference,
          isPosted: true,
          lines: { create: lines },
        },
        include: { lines: { include: { account: true } } },
      });

      for (const line of lines) {
        const account = await tx.account.findUnique({ where: { id: line.accountId } });
        if (account) {
          const change = Number(line.debit) - Number(line.credit);
          await tx.account.update({
            where: { id: line.accountId },
            data: { balance: { increment: change } },
          });
        }
      }

      return je;
    });

    res.status(201).json({ success: true, data: entry });
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
    const { csvText, periodStart, periodEnd, openingBalance, closingBalance, bankAccountCode, notes } =
      req.body as {
        csvText: string;
        periodStart: string;
        periodEnd: string;
        openingBalance?: number;
        closingBalance?: number;
        bankAccountCode?: string;
        notes?: string;
      };

    if (!csvText || !periodStart || !periodEnd) {
      throw new AppError('csvText, periodStart, and periodEnd are required', 400);
    }

    const statement = await BankReconciliationService.importStatement({
      csvText,
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
