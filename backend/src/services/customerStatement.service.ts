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

function isBookkeepingCreditNote(notes?: string | null) {
  return (notes || '').includes('[INVOICE_ADJUSTED]');
}

/** Payment credits per customer from allocations (primary) and legacy direct invoice payments. */
async function aggregateCustomerPaymentCredits(
  companyId: string,
  customerIds: string[],
  asOf: Date
): Promise<Map<string, number>> {
  const credits = new Map<string, number>();
  for (const id of customerIds) credits.set(id, 0);
  if (customerIds.length === 0) return credits;

  const [allocations, legacyPayments] = await Promise.all([
    prisma.paymentAllocation.findMany({
      where: {
        payment: { companyId, paymentDate: { lte: asOf } },
        invoice: { customerId: { in: customerIds }, type: 'SALES' },
      },
      select: {
        amount: true,
        invoice: { select: { customerId: true } },
      },
    }),
    prisma.payment.findMany({
      where: {
        companyId,
        paymentDate: { lte: asOf },
        invoiceId: { not: null },
        invoice: { customerId: { in: customerIds }, type: 'SALES' },
        allocations: { none: {} },
      },
      select: { amount: true, invoice: { select: { customerId: true } } },
    }),
  ]);

  for (const row of allocations) {
    const customerId = row.invoice?.customerId;
    if (!customerId) continue;
    credits.set(customerId, (credits.get(customerId) || 0) + Number(row.amount));
  }

  for (const pay of legacyPayments) {
    const customerId = pay.invoice?.customerId;
    if (!customerId) continue;
    credits.set(customerId, (credits.get(customerId) || 0) + Number(pay.amount));
  }

  return credits;
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
      id: true,
      type: true,
      invoiceDate: true,
      dueDate: true,
      totalAmount: true,
      paidAmount: true,
    },
  });

  const { creditedAmountForInvoice, computeInvoiceBalanceDue } = await import('../utils/invoiceBalance');
  const aging: StatementAging = {
    current: 0,
    days1_30: 0,
    days31_60: 0,
    days61_90: 0,
    days90Plus: 0,
    amountDue: 0,
  };

  for (const inv of invoices) {
    const credited =
      inv.type === 'SALES' ? await creditedAmountForInvoice(prisma, inv.id) : 0;
    const balance = Math.round(
      computeInvoiceBalanceDue(
        { ...inv, type: 'SALES', status: 'UNPAID' },
        credited
      ) * 100
    ) / 100;
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

export type CustomerBalanceSummaryRow = {
  id: string;
  code: string;
  name: string;
  balance: number;
};

export type CustomerBalanceSummaryResult = {
  asOf: string;
  currency: string;
  customerCount: number;
  totalBalance: number;
  customers: CustomerBalanceSummaryRow[];
  /** Set when filtered by sales person (name) or unassigned pool. */
  salesPersonName?: string | null;
};

export type CustomerAgingReportRow = {
  id: string;
  code: string;
  name: string;
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  days90Plus: number;
  total: number;
};

export type CustomerAgingReportResult = {
  asOf: string;
  currency: string;
  customerCount: number;
  totals: {
    current: number;
    days1_30: number;
    days31_60: number;
    days61_90: number;
    days90Plus: number;
    total: number;
  };
  customers: CustomerAgingReportRow[];
  salesPersonName?: string | null;
};

export class CustomerStatementService {
  /**
   * FULL — ledger of invoices + payments (running balance).
   * OUTSTANDING — open invoices the customer still owes (amount due).
   */
  static async getBalanceSummary(
    asOf?: string,
    opts?: { includeZero?: boolean; salesPersonId?: string | null; includeUnassigned?: boolean }
  ): Promise<CustomerBalanceSummaryResult> {
    const companyId = requireTenantId();
    const toRange = asOf ? dayRangeFromInput(asOf) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());

    const customerWhere: Prisma.CustomerWhereInput = {
      companyId,
      deletedAt: null,
      isActive: true,
    };
    if (opts?.salesPersonId === null) {
      customerWhere.salesPersonId = null;
    } else if (opts?.salesPersonId) {
      customerWhere.salesPersonId = opts.salesPersonId;
    }

    const customers = await prisma.customer.findMany({
      where: customerWhere,
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });

    const customerIds = customers.map((c) => c.id);
    const balances = new Map<string, number>();
    for (const id of customerIds) balances.set(id, 0);

    if (customerIds.length > 0) {
      const [invoices, paymentCredits] = await Promise.all([
        prisma.invoice.findMany({
          where: {
            companyId,
            customerId: { in: customerIds },
            type: { in: ['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE'] },
            invoiceDate: { lte: toDate },
          },
          select: { customerId: true, type: true, totalAmount: true, notes: true },
        }),
        aggregateCustomerPaymentCredits(companyId, customerIds, toDate),
      ]);

      for (const inv of invoices) {
        if (!inv.customerId) continue;
        const amt = Number(inv.totalAmount);
        const current = balances.get(inv.customerId) || 0;
        if (inv.type === 'CREDIT_NOTE') {
          if (isBookkeepingCreditNote(inv.notes)) continue;
          balances.set(inv.customerId, current - amt);
        } else {
          balances.set(inv.customerId, current + amt);
        }
      }

      for (const [customerId, paid] of paymentCredits) {
        balances.set(customerId, (balances.get(customerId) || 0) - paid);
      }
    }

    let rows = customers.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      balance: Math.round((balances.get(c.id) || 0) * 100) / 100,
    }));

    if (!opts?.includeZero) {
      rows = rows.filter((r) => Math.abs(r.balance) > 0.001);
    }

    const totalBalance = Math.round(rows.reduce((sum, r) => sum + r.balance, 0) * 100) / 100;

    let salesPersonName: string | null | undefined;
    if (opts?.salesPersonId === null) {
      salesPersonName = 'Unassigned';
    } else if (opts?.salesPersonId) {
      const salesPerson = await prisma.user.findFirst({
        where: { id: opts.salesPersonId, companyId },
        select: { firstName: true, lastName: true },
      });
      salesPersonName = salesPerson
        ? `${salesPerson.firstName} ${salesPerson.lastName}`.trim()
        : null;
    }

    return {
      asOf: toDate.toISOString(),
      currency: 'KES',
      customerCount: rows.length,
      totalBalance,
      customers: rows,
      ...(salesPersonName !== undefined ? { salesPersonName } : {}),
    };
  }

  /** Accounts receivable aging by customer (Current, 1–30, 31–60, 61–90, >90). */
  static async getAgingReport(
    asOf?: string,
    opts?: { includeZero?: boolean; salesPersonId?: string | null; includeUnassigned?: boolean }
  ): Promise<CustomerAgingReportResult> {
    const companyId = requireTenantId();
    const toRange = asOf ? dayRangeFromInput(asOf) : null;
    const toDate = toRange?.lte ? endOfDay(toRange.lte) : endOfDay(new Date());
    const asOfDay = startOfDay(toDate);

    const customerWhere: Prisma.CustomerWhereInput = {
      companyId,
      deletedAt: null,
      isActive: true,
    };
    if (opts?.salesPersonId === null) {
      customerWhere.salesPersonId = null;
    } else if (opts?.salesPersonId) {
      customerWhere.salesPersonId = opts.salesPersonId;
    }

    const customers = await prisma.customer.findMany({
      where: customerWhere,
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });

    const customerIds = customers.map((c) => c.id);
    const agingByCustomer = new Map<
      string,
      Omit<CustomerAgingReportRow, 'name' | 'code'>
    >();
    for (const c of customers) {
      agingByCustomer.set(c.id, {
        id: c.id,
        current: 0,
        days1_30: 0,
        days31_60: 0,
        days61_90: 0,
        days90Plus: 0,
        total: 0,
      });
    }

    if (customerIds.length > 0) {
      const invoices = await prisma.invoice.findMany({
        where: {
          companyId,
          customerId: { in: customerIds },
          type: { in: ['SALES', 'DEBIT_NOTE'] },
          status: { notIn: ['PAID', 'REFUNDED'] },
          invoiceDate: { lte: toDate },
        },
        select: {
          id: true,
          customerId: true,
          type: true,
          invoiceDate: true,
          dueDate: true,
          totalAmount: true,
          paidAmount: true,
        },
      });

      const salesIds = invoices.filter((inv) => inv.type === 'SALES').map((inv) => inv.id);
      const creditByInvoice = new Map<string, number>();
      if (salesIds.length > 0) {
        const creditNotes = await prisma.invoice.findMany({
          where: {
            type: 'CREDIT_NOTE',
            originalInvoiceId: { in: salesIds },
          },
          select: { originalInvoiceId: true, totalAmount: true, notes: true },
        });
        for (const cn of creditNotes) {
          if (!cn.originalInvoiceId || isBookkeepingCreditNote(cn.notes)) continue;
          creditByInvoice.set(
            cn.originalInvoiceId,
            (creditByInvoice.get(cn.originalInvoiceId) || 0) + Number(cn.totalAmount || 0)
          );
        }
      }

      const { computeInvoiceBalanceDue } = await import('../utils/invoiceBalance');

      for (const inv of invoices) {
        if (!inv.customerId) continue;
        const credited = inv.type === 'SALES' ? creditByInvoice.get(inv.id) || 0 : 0;
        const balance = Math.round(
          computeInvoiceBalanceDue(
            {
              id: inv.id,
              type: inv.type,
              totalAmount: inv.totalAmount,
              paidAmount: inv.paidAmount,
              status: 'UNPAID',
            },
            credited
          ) * 100
        ) / 100;
        if (balance <= 0.001) continue;

        const bucket = agingByCustomer.get(inv.customerId);
        if (!bucket) continue;

        const dueBase = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate);
        dueBase.setHours(0, 0, 0, 0);
        const daysPastDue = Math.floor((asOfDay.getTime() - dueBase.getTime()) / 86400000);

        if (daysPastDue <= 0) bucket.current += balance;
        else if (daysPastDue <= 30) bucket.days1_30 += balance;
        else if (daysPastDue <= 60) bucket.days31_60 += balance;
        else if (daysPastDue <= 90) bucket.days61_90 += balance;
        else bucket.days90Plus += balance;

        bucket.total += balance;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    let rows: CustomerAgingReportRow[] = customers.map((c) => {
      const bucket = agingByCustomer.get(c.id)!;
      return {
        id: c.id,
        code: c.code,
        name: c.name,
        current: round2(bucket.current),
        days1_30: round2(bucket.days1_30),
        days31_60: round2(bucket.days31_60),
        days61_90: round2(bucket.days61_90),
        days90Plus: round2(bucket.days90Plus),
        total: round2(bucket.total),
      };
    });

    if (!opts?.includeZero) {
      rows = rows.filter((r) => r.total > 0.001);
    }

    const totals = rows.reduce(
      (acc, row) => ({
        current: acc.current + row.current,
        days1_30: acc.days1_30 + row.days1_30,
        days31_60: acc.days31_60 + row.days31_60,
        days61_90: acc.days61_90 + row.days61_90,
        days90Plus: acc.days90Plus + row.days90Plus,
        total: acc.total + row.total,
      }),
      { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90Plus: 0, total: 0 }
    );

    let salesPersonName: string | null | undefined;
    if (opts?.salesPersonId === null) {
      salesPersonName = 'Unassigned';
    } else if (opts?.salesPersonId) {
      const salesPerson = await prisma.user.findFirst({
        where: { id: opts.salesPersonId, companyId },
        select: { firstName: true, lastName: true },
      });
      salesPersonName = salesPerson
        ? `${salesPerson.firstName} ${salesPerson.lastName}`.trim()
        : null;
    }

    return {
      asOf: toDate.toISOString(),
      currency: 'KES',
      customerCount: rows.length,
      totals: {
        current: round2(totals.current),
        days1_30: round2(totals.days1_30),
        days31_60: round2(totals.days31_60),
        days61_90: round2(totals.days61_90),
        days90Plus: round2(totals.days90Plus),
        total: round2(totals.total),
      },
      customers: rows,
      ...(salesPersonName !== undefined ? { salesPersonName } : {}),
    };
  }

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
    if (toDate) {
      invoiceWhere.invoiceDate = { ...(invoiceWhere.invoiceDate as object), lte: toDate };
    }

    const paymentDateFilter = toDate ? { lte: toDate } : undefined;

    const [invoices, allocations, legacyPayments] = await Promise.all([
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
          notes: true,
        },
        orderBy: { invoiceDate: 'asc' },
      }),
      prisma.paymentAllocation.findMany({
        where: {
          payment: { companyId, ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}) },
          invoice: { customerId, type: 'SALES' },
        },
        select: {
          amount: true,
          invoice: { select: { invoiceNumber: true } },
          payment: {
            select: {
              paymentNumber: true,
              paymentDate: true,
              method: true,
              reference: true,
              bankReference: true,
            },
          },
        },
        orderBy: { payment: { paymentDate: 'asc' } },
      }),
      prisma.payment.findMany({
        where: {
          companyId,
          ...(paymentDateFilter ? { paymentDate: paymentDateFilter } : {}),
          invoice: { customerId, type: 'SALES' },
          allocations: { none: {} },
        },
        select: {
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
        if (isBookkeepingCreditNote(inv.notes)) continue;
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

    const pushPaymentLine = (pay: {
      paymentNumber: string;
      paymentDate: Date;
      amount: number;
      method?: string | null;
      reference?: string | null;
      bankReference?: string | null;
      invoiceNumber?: string | null;
    }) => {
      const methodLabel = formatPaymentMethod(pay.method);
      const txnRef = (pay.reference || pay.bankReference || '').trim();
      const reference = txnRef ? `${methodLabel} · ${txnRef}` : methodLabel;
      const invoicePart = pay.invoiceNumber ? ` for ${pay.invoiceNumber}` : '';
      raw.push({
        date: pay.paymentDate,
        type: 'PAYMENT',
        reference,
        description: `Payment via ${methodLabel}${invoicePart} (${pay.paymentNumber})`,
        debit: 0,
        credit: Number(pay.amount),
        paymentMethod: methodLabel,
      });
    };

    for (const alloc of allocations) {
      pushPaymentLine({
        ...alloc.payment,
        amount: Number(alloc.amount),
        invoiceNumber: alloc.invoice?.invoiceNumber || null,
      });
    }

    for (const pay of legacyPayments) {
      pushPaymentLine({
        paymentNumber: pay.paymentNumber,
        paymentDate: pay.paymentDate,
        amount: Number(pay.amount),
        method: pay.method,
        reference: pay.reference,
        bankReference: pay.bankReference,
        invoiceNumber: pay.invoice?.invoiceNumber || null,
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
        id: true,
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

    const { creditedAmountForInvoice, computeInvoiceBalanceDue } = await import('../utils/invoiceBalance');

    const open = (
      await Promise.all(
        invoices.map(async (inv) => {
          const invoiceTotal = Number(inv.totalAmount);
          const paidAmount = Number(inv.paidAmount);
          const credited =
            inv.type === 'SALES' ? await creditedAmountForInvoice(prisma, inv.id) : 0;
          const balanceDue = Math.round(
            computeInvoiceBalanceDue(
              { ...inv, type: inv.type, totalAmount: invoiceTotal, paidAmount, status: inv.status },
              credited
            ) * 100
          ) / 100;
          return { inv, invoiceTotal, paidAmount, balanceDue };
        })
      )
    ).filter((row) => row.balanceDue > 0.001);

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
