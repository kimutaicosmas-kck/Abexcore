import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { dayRangeFromInput } from '../utils/date';
import type { StatementAging, StatementLine, StatementMode } from './customerStatement.service';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  MPESA: 'M-Pesa',
  COOP_PAYBILL: 'Co-op Paybill',
  CARD: 'Card',
  CREDIT: 'Credit',
};

function formatPaymentMethod(method?: string | null): string {
  if (!method) return 'Payment';
  return PAYMENT_METHOD_LABELS[method] || method.replace(/_/g, ' ');
}

export type VendorStatementResult = {
  mode: StatementMode;
  supplier: {
    id: string;
    code: string;
    name: string;
    taxPin: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    paymentTerms: number;
  };
  period: { from: string | null; to: string };
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  closingBalance: number;
  totalDue: number;
  aging: StatementAging;
  lines: StatementLine[];
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

async function loadSupplier(supplierId: string, companyId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      taxPin: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      paymentTerms: true,
    },
  });
  if (!supplier) throw new AppError('Supplier not found', 404);
  return supplier;
}

async function computeVendorAging(
  companyId: string,
  supplierId: string,
  asOf: Date
): Promise<StatementAging> {
  const asOfDay = startOfDay(asOf);
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      supplierId,
      type: 'PURCHASE',
      status: { notIn: ['PAID', 'REFUNDED'] },
      invoiceDate: { lte: endOfDay(asOf) },
    },
    select: {
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      paidAmount: true,
    },
  });

  const aging: StatementAging = {
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    days90Plus: 0,
    amountDue: 0,
  };

  for (const inv of invoices) {
    const balance = Math.round((Number(inv.totalAmount) - Number(inv.paidAmount)) * 100) / 100;
    if (balance <= 0.001) continue;

    const dueBase = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate);
    dueBase.setHours(0, 0, 0, 0);
    const daysPastDue = Math.floor((asOfDay.getTime() - dueBase.getTime()) / 86400000);

    if (daysPastDue <= 0) aging.current += balance;
    else if (daysPastDue <= 30) aging.days1_30 += balance;
    else if (daysPastDue <= 60) aging.days31_60 += balance;
    else if (daysPastDue <= 90) aging.days61_90 += balance;
    else aging.days90Plus += balance;

    aging.amountDue += balance;
  }

  return aging;
}

export class VendorStatementService {
  /**
   * FULL — purchase invoices + payments (running AP balance owed to vendor).
   * OUTSTANDING — open purchase invoices still unpaid.
   */
  static async getStatement(
    supplierId: string,
    from?: string,
    to?: string,
    mode: StatementMode = 'FULL'
  ): Promise<VendorStatementResult> {
    if (mode === 'OUTSTANDING') {
      return this.getOutstandingStatement(supplierId, from, to);
    }
    return this.getFullStatement(supplierId, from, to);
  }

  private static async getFullStatement(
    supplierId: string,
    from?: string,
    to?: string
  ): Promise<VendorStatementResult> {
    const companyId = requireTenantId();
    const supplier = await loadSupplier(supplierId, companyId);

    const fromRange = from ? dayRangeFromInput(from) : null;
    const toRange = to ? dayRangeFromInput(to) : null;
    const fromDate = fromRange?.gte ? startOfDay(fromRange.gte) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      companyId,
      supplierId,
      type: 'PURCHASE',
    };
    const paymentWhere: Prisma.PaymentWhereInput = {
      companyId,
      invoice: { supplierId, type: 'PURCHASE' },
    };

    if (toDate) {
      invoiceWhere.invoiceDate = { ...(invoiceWhere.invoiceDate as object), lte: toDate };
      paymentWhere.paymentDate = { ...(paymentWhere.paymentDate as object), lte: toDate };
    }

    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({
        where: invoiceWhere,
        select: {
          id: true,
          invoiceNumber: true,
          type: true,
          invoiceDate: true,
          totalAmount: true,
          paidAmount: true,
          status: true,
          purchaseOrder: { select: { poNumber: true } },
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      prisma.payment.findMany({
        where: paymentWhere,
        select: {
          id: true,
          paymentNumber: true,
          paymentDate: true,
          amount: true,
          method: true,
          reference: true,
          bankReference: true,
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { paymentDate: 'asc' },
      }),
    ]);

    type Raw = {
      date: Date;
      type: StatementLine['type'];
      reference: string;
      description: string;
      debit: number;
      credit: number;
      paymentMethod?: string | null;
    };

    const raw: Raw[] = [];

    for (const inv of invoices) {
      const amount = Number(inv.totalAmount);
      const poPart = inv.purchaseOrder?.poNumber ? ` · PO ${inv.purchaseOrder.poNumber}` : '';
      raw.push({
        date: inv.invoiceDate,
        type: 'INVOICE',
        reference: inv.invoiceNumber,
        description: `Purchase invoice ${inv.invoiceNumber}${poPart}`,
        debit: amount,
        credit: 0,
      });
    }

    for (const pay of payments) {
      const methodLabel = formatPaymentMethod(pay.method);
      const txnRef = (pay.reference || pay.bankReference || '').trim();
      const reference = txnRef ? `${methodLabel} · ${txnRef}` : methodLabel;
      const invoicePart = pay.invoice?.invoiceNumber ? ` for ${pay.invoice.invoiceNumber}` : '';
      raw.push({
        date: pay.paymentDate,
        type: 'PAYMENT',
        reference,
        description: `Payment via ${methodLabel}${invoicePart} (${pay.paymentNumber})`,
        debit: 0,
        credit: Number(pay.amount),
        paymentMethod: methodLabel,
      });
    }

    raw.sort((a, b) => a.date.getTime() - b.date.getTime() || a.reference.localeCompare(b.reference));

    let openingBalance = 0;
    const periodLines: Raw[] = [];
    for (const row of raw) {
      if (fromDate && row.date < fromDate) {
        openingBalance += row.debit - row.credit;
      } else {
        periodLines.push(row);
      }
    }

    let running = openingBalance;
    const lines: StatementLine[] = periodLines.map((row) => {
      running += row.debit - row.credit;
      return {
        date: row.date.toISOString(),
        type: row.type,
        reference: row.reference,
        description: row.description,
        debit: row.debit,
        credit: row.credit,
        balance: running,
        paymentMethod: row.paymentMethod || null,
      };
    });

    const periodDebits = lines.reduce((s, l) => s + l.debit, 0);
    const periodCredits = lines.reduce((s, l) => s + l.credit, 0);
    const aging = await computeVendorAging(companyId, supplierId, toDate);

    return {
      mode: 'FULL',
      supplier,
      period: {
        from: fromDate?.toISOString() || null,
        to: toDate.toISOString(),
      },
      openingBalance,
      periodDebits,
      periodCredits,
      closingBalance: running,
      totalDue: aging.amountDue,
      aging,
      lines,
    };
  }

  private static async getOutstandingStatement(
    supplierId: string,
    from?: string,
    to?: string
  ): Promise<VendorStatementResult> {
    const companyId = requireTenantId();
    const supplier = await loadSupplier(supplierId, companyId);

    const fromRange = from ? dayRangeFromInput(from) : null;
    const toRange = to ? dayRangeFromInput(to) : null;
    const fromDate = fromRange?.gte ? startOfDay(fromRange.gte) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());

    const invoiceDateFilter: Prisma.DateTimeFilter = { lte: toDate };
    if (fromDate) invoiceDateFilter.gte = fromDate;

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        supplierId,
        type: 'PURCHASE',
        status: { notIn: ['PAID', 'REFUNDED'] },
        invoiceDate: invoiceDateFilter,
      },
      select: {
        invoiceNumber: true,
        type: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        paidAmount: true,
        status: true,
        purchaseOrder: { select: { poNumber: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { invoiceDate: 'asc' }],
    });

    const open = invoices
      .map((inv) => {
        const invoiceTotal = Number(inv.totalAmount);
        const paidAmount = Number(inv.paidAmount);
        const balanceDue = Math.round((invoiceTotal - paidAmount) * 100) / 100;
        return { inv, invoiceTotal, paidAmount, balanceDue };
      })
      .filter((row) => row.balanceDue > 0.001);

    let running = 0;
    const lines: StatementLine[] = open.map(({ inv, invoiceTotal, paidAmount, balanceDue }) => {
      running += balanceDue;
      const poPart = inv.purchaseOrder?.poNumber ? ` · PO ${inv.purchaseOrder.poNumber}` : '';
      return {
        date: inv.invoiceDate.toISOString(),
        type: 'INVOICE',
        reference: inv.invoiceNumber,
        description: `Purchase invoice ${inv.invoiceNumber}${poPart} — amount due`,
        debit: balanceDue,
        credit: 0,
        balance: running,
        invoiceTotal,
        paidAmount,
        balanceDue,
        dueDate: inv.dueDate?.toISOString() || null,
        status: inv.status,
      };
    });

    const totalDue = lines.reduce((s, l) => s + (l.balanceDue || 0), 0);
    const invoiced = lines.reduce((s, l) => s + (l.invoiceTotal || 0), 0);
    const paid = lines.reduce((s, l) => s + (l.paidAmount || 0), 0);
    const aging = await computeVendorAging(companyId, supplierId, toDate);

    return {
      mode: 'OUTSTANDING',
      supplier,
      period: {
        from: fromDate?.toISOString() || null,
        to: toDate.toISOString(),
      },
      openingBalance: 0,
      periodDebits: invoiced,
      periodCredits: paid,
      closingBalance: totalDue,
      totalDue: aging.amountDue || totalDue,
      aging,
      lines,
    };
  }
}
