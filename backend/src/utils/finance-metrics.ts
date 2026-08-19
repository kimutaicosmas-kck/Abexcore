import prisma from '../config/database';

export function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export async function getMonthlySalesRevenue(from = getMonthStart()): Promise<number> {
  const agg = await prisma.invoice.aggregate({
    where: {
      type: 'SALES',
      invoiceDate: { gte: from },
      status: { not: 'REFUNDED' },
    },
    _sum: { totalAmount: true },
  });
  return Number(agg._sum.totalAmount || 0);
}

export async function getNetAccountsReceivable(): Promise<number> {
  const openInvoices = await prisma.invoice.findMany({
    where: {
      type: 'SALES',
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
    },
    select: { totalAmount: true, paidAmount: true },
  });

  return openInvoices.reduce(
    (sum, inv) => sum + Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount)),
    0
  );
}

export async function getNetAccountsPayable(): Promise<number> {
  const openInvoices = await prisma.invoice.findMany({
    where: {
      type: 'PURCHASE',
      status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
    },
    select: { totalAmount: true, paidAmount: true },
  });

  return openInvoices.reduce(
    (sum, inv) => sum + Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount)),
    0
  );
}

/** Total amounts paid/received on sales invoices (customer collections). */
export async function getInvoicePaymentsReceived(): Promise<number> {
  const agg = await prisma.invoice.aggregate({
    where: {
      type: 'SALES',
      status: { not: 'REFUNDED' },
    },
    _sum: { paidAmount: true },
  });
  return Number(agg._sum.paidAmount || 0);
}
