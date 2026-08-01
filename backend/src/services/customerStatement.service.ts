import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { dayRangeFromInput } from '../utils/date';

export type StatementMode = 'FULL' | 'OUTSTANDING';

export type StatementLine = {
  date: string;
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  /** Human-readable payment method (Cash, M-Pesa, Cheque, Bank transfer, …) */
  paymentMethod?: string | null;
  /** Present on OUTSTANDING invoice lines */
  invoiceTotal?: number;
  paidAmount?: number;
  balanceDue?: number;
  dueDate?: string | null;
  status?: string;
};

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

/** Open AR aging as at statement date (balance due by invoice due date). */
export type StatementAging = {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  /** Included in amountDue; folded into 61+ display when needed */
  days90Plus: number;
  amountDue: number;
};

export type CustomerStatementResult = {
  mode: StatementMode;
  customer: {
    id: string;
    code: string;
    name: string;
    vatStatus: string;
    taxPin: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    creditLimit: unknown;
    creditUsed: unknown;
  };
  period: { from: string | null; to: string };
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  closingBalance: number;
  /** For OUTSTANDING: sum of open balances due */
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

async function loadCustomer(customerId: string, companyId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, companyId, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      vatStatus: true,
      taxPin: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      creditLimit: true,
      creditUsed: true,
    },
  });
  if (!customer) throw new AppError('Customer not found', 404);
  return customer;
}

async function computeCustomerAging(
  companyId: string,
  customerId: string,
  asOf: Date
): Promise<StatementAging> {
  const asOfDay = startOfDay(asOf);
  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      customerId,
      type: { in: ['SALES', 'DEBIT_NOTE'] },
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

export class CustomerStatementService {
  /**
   * FULL — ledger of invoices + payments (running balance).
   * OUTSTANDING — open invoices the customer still owes (amount due).
   */
  static async getStatement(
    customerId: string,
    from?: string,
    to?: string,
    mode: StatementMode = 'FULL'
  ): Promise<CustomerStatementResult> {
    if (mode === 'OUTSTANDING') {
      return this.getOutstandingStatement(customerId, from, to);
    }
    return this.getFullStatement(customerId, from, to);
  }

  private static async getFullStatement(
    customerId: string,
    from?: string,
    to?: string
  ): Promise<CustomerStatementResult> {
    const companyId = requireTenantId();
    const customer = await loadCustomer(customerId, companyId);

    const fromRange = from ? dayRangeFromInput(from) : null;
    const toRange = to ? dayRangeFromInput(to) : null;
    const fromDate = fromRange?.gte ? startOfDay(fromRange.gte) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      companyId,
      customerId,
      type: { in: ['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
    };
    const paymentWhere: Prisma.PaymentWhereInput = {
      companyId,
      invoice: { customerId, type: 'SALES' },
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
      if (inv.type === 'CREDIT_NOTE') {
        raw.push({
          date: inv.invoiceDate,
          type: 'CREDIT_NOTE',
          reference: inv.invoiceNumber,
          description: `Credit note ${inv.invoiceNumber}`,
          debit: 0,
          credit: amount,
        });
      } else {
        raw.push({
          date: inv.invoiceDate,
          type: inv.type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE',
          reference: inv.invoiceNumber,
          description:
            inv.type === 'DEBIT_NOTE'
              ? `Debit note ${inv.invoiceNumber}`
              : `Sales invoice ${inv.invoiceNumber}`,
          debit: amount,
          credit: 0,
        });
      }
    }

    for (const pay of payments) {
      const methodLabel = formatPaymentMethod(pay.method);
      const txnRef = (pay.reference || pay.bankReference || '').trim();
      // Reference column: method (+ txn ref when present), e.g. "M-Pesa · THX…" / "Cash"
      const reference = txnRef ? `${methodLabel} · ${txnRef}` : methodLabel;
      const invoicePart = pay.invoice?.invoiceNumber
        ? ` for ${pay.invoice.invoiceNumber}`
        : '';
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
    const aging = await computeCustomerAging(companyId, customerId, toDate);

    return {
      mode: 'FULL',
      customer,
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

  /** Invoices still owed by the customer (balance due > 0). */
  private static async getOutstandingStatement(
    customerId: string,
    from?: string,
    to?: string
  ): Promise<CustomerStatementResult> {
    const companyId = requireTenantId();
    const customer = await loadCustomer(customerId, companyId);

    const fromRange = from ? dayRangeFromInput(from) : null;
    const toRange = to ? dayRangeFromInput(to) : null;
    const fromDate = fromRange?.gte ? startOfDay(fromRange.gte) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());

    const invoiceDateFilter: Prisma.DateTimeFilter = { lte: toDate };
    if (fromDate) invoiceDateFilter.gte = fromDate;

    const invoices = await prisma.invoice.findMany({
      where: {
        companyId,
        customerId,
        type: { in: ['SALES', 'DEBIT_NOTE'] },
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
      return {
        date: inv.invoiceDate.toISOString(),
        type: inv.type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'INVOICE',
        reference: inv.invoiceNumber,
        description:
          inv.type === 'DEBIT_NOTE'
            ? `Debit note ${inv.invoiceNumber} — amount due`
            : `Invoice ${inv.invoiceNumber} — amount due`,
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
    const aging = await computeCustomerAging(companyId, customerId, toDate);

    return {
      mode: 'OUTSTANDING',
      customer,
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

  /** Full VAT / Non-VAT / combined customer report with invoice totals. */
  static async getVatCustomerReport(vatStatus: 'VAT' | 'NON_VAT' | 'ALL' = 'ALL') {
    const companyId = requireTenantId();
    const customers = await prisma.customer.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        ...(vatStatus === 'ALL' ? {} : { vatStatus }),
      },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        vatStatus: true,
        taxPin: true,
        city: true,
        phone: true,
        email: true,
        creditLimit: true,
        creditUsed: true,
        salesPerson: { select: { firstName: true, lastName: true } },
        _count: { select: { invoices: true, salesOrders: true } },
      },
      orderBy: [{ vatStatus: 'asc' }, { name: 'asc' }],
    });

    const ids = customers.map((c) => c.id);
    const invoiceAgg = ids.length
      ? await prisma.invoice.groupBy({
          by: ['customerId'],
          where: {
            companyId,
            customerId: { in: ids },
            type: 'SALES',
          },
          _sum: { totalAmount: true, taxAmount: true, paidAmount: true },
          _count: { _all: true },
        })
      : [];
    const byCustomer = new Map(
      invoiceAgg.map((row) => [
        row.customerId!,
        {
          invoiceCount: row._count._all,
          invoicedTotal: Number(row._sum.totalAmount || 0),
          vatTotal: Number(row._sum.taxAmount || 0),
          paidTotal: Number(row._sum.paidAmount || 0),
          outstanding: Number(row._sum.totalAmount || 0) - Number(row._sum.paidAmount || 0),
        },
      ])
    );

    const rows = customers.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      type: c.type,
      vatStatus: c.vatStatus as 'VAT' | 'NON_VAT',
      taxPin: c.taxPin,
      city: c.city,
      phone: c.phone,
      email: c.email,
      salesPersonName: c.salesPerson
        ? `${c.salesPerson.firstName} ${c.salesPerson.lastName}`.trim()
        : null,
      ...(byCustomer.get(c.id) || {
        invoiceCount: 0,
        invoicedTotal: 0,
        vatTotal: 0,
        paidTotal: 0,
        outstanding: Number(c.creditUsed) || 0,
      }),
    }));

    const vatRows = rows.filter((r) => r.vatStatus === 'VAT');
    const nonVatRows = rows.filter((r) => r.vatStatus === 'NON_VAT');
    const sumTotals = (list: typeof rows) => ({
      invoicedTotal: list.reduce((s, r) => s + r.invoicedTotal, 0),
      vatTotal: list.reduce((s, r) => s + r.vatTotal, 0),
      paidTotal: list.reduce((s, r) => s + r.paidTotal, 0),
      outstanding: list.reduce((s, r) => s + r.outstanding, 0),
    });

    return {
      vatStatus,
      count: rows.length,
      totals: sumTotals(rows),
      sections:
        vatStatus === 'ALL'
          ? {
              VAT: { count: vatRows.length, totals: sumTotals(vatRows) },
              NON_VAT: { count: nonVatRows.length, totals: sumTotals(nonVatRows) },
            }
          : undefined,
      customers: rows,
    };
  }
}

export type VatCustomerReportResult = Awaited<
  ReturnType<typeof CustomerStatementService.getVatCustomerReport>
>;
