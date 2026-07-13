import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/errorHandler';
import { companySettingsSchema, paginationSchema, createInvoiceSchema, createPaymentSchema } from '../validators/schemas';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { getParam, getQuery } from '../utils/request';

const router = Router();
router.use(authenticate);

// Company Settings
router.get('/company', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const company = await prisma.company.findFirst({
    include: { branches: true, taxRates: true },
  });
  res.json({ success: true, data: company });
}));

router.put('/company', validate(companySettingsSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.company.findFirst();
  const company = existing
    ? await prisma.company.update({ where: { id: existing.id }, data: req.body })
    : await prisma.company.create({ data: req.body });
  res.json({ success: true, data: company });
}));

// Invoices
router.get('/invoices/:id/pdf', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ExportService } = await import('../services/export.service');
  const invoice = await ExportService.getInvoice(getParam(req.params.id));
  const pdf = await ExportService.generateInvoicePDF(invoice);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  res.send(pdf);
}));

router.get('/invoices/:id/excel', asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ExportService } = await import('../services/export.service');
  const invoice = await ExportService.getInvoice(getParam(req.params.id));
  const excel = await ExportService.generateInvoiceExcel(invoice);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNumber}.xlsx"`);
  res.send(excel);
}));

router.get('/reports/sales/excel', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { ExportService } = await import('../services/export.service');
  const excel = await ExportService.generateSalesReportExcel();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="sales-report.xlsx"');
  res.send(excel);
}));

router.get('/reports/inventory/excel', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const { ExportService } = await import('../services/export.service');
  const excel = await ExportService.generateInventoryReportExcel();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory-report.xlsx"');
  res.send(excel);
}));

router.get('/invoices', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      skip,
      take: limit,
      include: { customer: true, supplier: true, items: true, payments: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.invoice.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

router.post('/invoices', validate(createInvoiceSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { type, customerId, supplierId, salesOrderId, purchaseOrderId, dueDate, items, notes } = req.body;
  const count = await prisma.invoice.count();
  const invoiceNumber = generateNumber(type === 'SALES' ? 'INV' : 'PINV', count + 1);

  const subtotal = items.reduce(
    (sum: number, item: { quantity: number; unitPrice: number }) => sum + item.quantity * item.unitPrice,
    0
  );
  const taxAmount = subtotal * 0.16;
  const totalAmount = subtotal + taxAmount;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber,
      type,
      customerId,
      supplierId,
      salesOrderId,
      purchaseOrderId,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      subtotal,
      taxAmount,
      totalAmount,
      notes,
      items: { create: items },
    },
    include: { customer: true, supplier: true, items: true },
  });

  res.status(201).json({ success: true, data: invoice });
}));

router.post('/payments', validate(createPaymentSchema), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { invoiceId, amount, method, reference, notes } = req.body;
  const count = await prisma.payment.count();
  const paymentNumber = generateNumber('PAY', count + 1);

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: { paymentNumber, invoiceId, amount, method, reference, notes },
    });

    if (invoiceId) {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (invoice) {
        const paidAmount = Number(invoice.paidAmount) + Number(amount);
        const status = paidAmount >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL';
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paidAmount, status },
        });
      }
    }

    return p;
  });

  res.status(201).json({ success: true, data: payment });
}));

// Accounts
router.get('/accounts', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    include: { children: true },
    orderBy: { code: 'asc' },
  });
  res.json({ success: true, data: accounts });
}));

// Employees
router.get('/employees', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.employee.findMany({
      skip,
      take: limit,
      where: { deletedAt: null },
      include: { department: true, branch: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.employee.count({ where: { deletedAt: null } }),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

// Machines & Maintenance
router.get('/machines', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const machines = await prisma.machine.findMany({
    include: { maintenanceRequests: { take: 5, orderBy: { createdAt: 'desc' } } },
  });
  res.json({ success: true, data: machines });
}));

router.get('/maintenance', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const requests = await prisma.maintenanceRequest.findMany({
    include: { machine: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, data: requests });
}));

// Quality Inspections
router.get('/quality', validate(paginationSchema, 'query'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit } = getQuery<{ page: number; limit: number }>(req.query);
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.qualityInspection.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.qualityInspection.count(),
  ]);

  res.json({ success: true, data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}));

// Notifications
router.get('/notifications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ success: true, data: notifications });
}));

router.patch('/notifications/:id/read', asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.notification.update({
    where: { id: getParam(req.params.id) },
    data: { isRead: true },
  });
  res.json({ success: true });
}));

// Reports summary
router.get('/reports/summary', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const [salesTotal, purchaseTotal, productionCount, customerCount, supplierCount] = await Promise.all([
    prisma.invoice.aggregate({ where: { type: 'SALES' }, _sum: { totalAmount: true } }),
    prisma.invoice.aggregate({ where: { type: 'PURCHASE' }, _sum: { totalAmount: true } }),
    prisma.productionOrder.count({ where: { status: 'COMPLETED' } }),
    prisma.customer.count({ where: { deletedAt: null } }),
    prisma.supplier.count({ where: { deletedAt: null } }),
  ]);

  res.json({
    success: true,
    data: {
      totalSales: Number(salesTotal._sum.totalAmount || 0),
      totalPurchases: Number(purchaseTotal._sum.totalAmount || 0),
      completedProduction: productionCount,
      totalCustomers: customerCount,
      totalSuppliers: supplierCount,
    },
  });
}));

router.get('/journal-entries', asyncHandler(async (_req: AuthRequest, res: Response) => {
  const data = await prisma.journalEntry.findMany({
    include: { lines: { include: { account: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({ success: true, data });
}));

router.post('/journal-entries', asyncHandler(async (req: AuthRequest, res: Response) => {
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
}));

export default router;
