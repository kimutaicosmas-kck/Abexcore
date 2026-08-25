import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { endOfDay, startOfDay, toLocalDateKey } from './date';

export function getMonthStart(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getMonthEnd(date = new Date()): Date {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/**
 * Source-of-truth sales: sales invoices that are not refunded and not tied to a cancelled order.
 */
export function buildInvoicedSalesWhere(opts?: {
  from?: Date;
  to?: Date;
  salesPersonId?: string;
}): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {
    type: 'SALES',
    status: { not: 'REFUNDED' },
  };

  if (opts?.from || opts?.to) {
    where.invoiceDate = {};
    if (opts.from) where.invoiceDate.gte = opts.from;
    if (opts.to) where.invoiceDate.lte = opts.to;
  }

  if (opts?.salesPersonId) {
    const salesPersonId = opts.salesPersonId;
    where.salesOrder = {
      AND: [
        {
          OR: [
            { salesPersonId },
            { salesPersonId: null, createdById: salesPersonId },
          ],
        },
        { status: { not: 'CANCELLED' } },
      ],
    };
  } else {
    where.OR = [
      { salesOrderId: null },
      { salesOrder: { status: { not: 'CANCELLED' } } },
    ];
  }

  return where;
}

export async function sumInvoicedSales(opts?: {
  from?: Date;
  to?: Date;
  salesPersonId?: string;
}): Promise<number> {
  const agg = await prisma.invoice.aggregate({
    where: buildInvoicedSalesWhere(opts),
    _sum: { totalAmount: true },
  });
  return Number(agg._sum.totalAmount || 0);
}

export async function getMonthlySalesRevenue(from = getMonthStart()): Promise<number> {
  return sumInvoicedSales({ from, to: getMonthEnd(from) });
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

export type CollectionRateSnapshot = {
  /** Cleared amount ÷ billed for invoices due in the period (0–100). */
  rate: number;
  collected: number;
  billed: number;
  outstanding: number;
  invoiceCount: number;
  /** Cash applied on or before each invoice due date ÷ billed (0–100). */
  onTimeRate: number;
  onTimeCollected: number;
  periodStart: string;
  periodEnd: string;
  label: string;
};

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-KE', { month: 'short', year: 'numeric' });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0.009) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Due-cohort collection rate: of sales invoices that fell due in [from, to],
 * how much of their face value is cleared (paid + eligible credit notes).
 */
export async function getDueCohortCollectionRate(
  from: Date,
  to: Date
): Promise<CollectionRateSnapshot> {
  const rangeStart = startOfDay(from);
  const rangeEnd = endOfDay(to);

  const invoices = await prisma.invoice.findMany({
    where: {
      type: 'SALES',
      status: { not: 'REFUNDED' },
      OR: [
        { dueDate: { gte: rangeStart, lte: rangeEnd } },
        { AND: [{ dueDate: null }, { invoiceDate: { gte: rangeStart, lte: rangeEnd } }] },
      ],
    },
    select: {
      id: true,
      totalAmount: true,
      paidAmount: true,
      dueDate: true,
      invoiceDate: true,
    },
  });

  const empty: CollectionRateSnapshot = {
    rate: 0,
    collected: 0,
    billed: 0,
    outstanding: 0,
    invoiceCount: 0,
    onTimeRate: 0,
    onTimeCollected: 0,
    periodStart: toLocalDateKey(rangeStart),
    periodEnd: toLocalDateKey(rangeEnd),
    label: monthLabel(rangeStart),
  };

  if (invoices.length === 0) return empty;

  const ids = invoices.map((inv) => inv.id);

  const creditNotes = await prisma.invoice.findMany({
    where: {
      type: 'CREDIT_NOTE',
      originalInvoiceId: { in: ids },
    },
    select: { originalInvoiceId: true, totalAmount: true, notes: true },
  });

  const creditById = new Map<string, number>();
  for (const cn of creditNotes) {
    if (!cn.originalInvoiceId) continue;
    if ((cn.notes || '').includes('[INVOICE_ADJUSTED]')) continue;
    creditById.set(
      cn.originalInvoiceId,
      (creditById.get(cn.originalInvoiceId) || 0) + Number(cn.totalAmount || 0)
    );
  }

  const allocations = await prisma.paymentAllocation.findMany({
    where: { invoiceId: { in: ids } },
    select: {
      invoiceId: true,
      amount: true,
      payment: { select: { paymentDate: true } },
    },
  });

  const invoicesWithAllocations = new Set(allocations.map((a) => a.invoiceId));
  const onTimeCash = new Map<string, number>();

  for (const row of allocations) {
    const inv = invoices.find((i) => i.id === row.invoiceId);
    if (!inv) continue;
    const due = endOfDay(inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate));
    if (new Date(row.payment.paymentDate) <= due) {
      onTimeCash.set(row.invoiceId, (onTimeCash.get(row.invoiceId) || 0) + Number(row.amount));
    }
  }

  const legacyPayments = await prisma.payment.findMany({
    where: {
      invoiceId: { in: ids },
      allocations: { none: {} },
    },
    select: { invoiceId: true, amount: true, paymentDate: true },
  });

  for (const p of legacyPayments) {
    if (!p.invoiceId || invoicesWithAllocations.has(p.invoiceId)) continue;
    const inv = invoices.find((i) => i.id === p.invoiceId);
    if (!inv) continue;
    const due = endOfDay(inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate));
    if (new Date(p.paymentDate) <= due) {
      onTimeCash.set(p.invoiceId, (onTimeCash.get(p.invoiceId) || 0) + Number(p.amount));
    }
  }

  let billed = 0;
  let collected = 0;
  let onTimeCollected = 0;

  for (const inv of invoices) {
    const total = Number(inv.totalAmount);
    const paid = Number(inv.paidAmount);
    const credited = creditById.get(inv.id) || 0;
    const cleared = Math.min(total, Math.max(0, paid + credited));
    const timely = Math.min(total, Math.max(0, onTimeCash.get(inv.id) || 0));

    billed += total;
    collected += cleared;
    onTimeCollected += timely;
  }

  billed = round2(billed);
  collected = round2(collected);
  onTimeCollected = round2(onTimeCollected);
  const outstanding = round2(Math.max(0, billed - collected));

  return {
    rate: pct(collected, billed),
    collected,
    billed,
    outstanding,
    invoiceCount: invoices.length,
    onTimeRate: pct(onTimeCollected, billed),
    onTimeCollected,
    periodStart: toLocalDateKey(rangeStart),
    periodEnd: toLocalDateKey(rangeEnd),
    label: monthLabel(rangeStart),
  };
}

/** Last N calendar months of due-cohort collection rate (oldest → newest). */
export async function getCollectionRateTrend(months = 6): Promise<CollectionRateSnapshot[]> {
  const now = new Date();
  const snapshots: CollectionRateSnapshot[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    snapshots.push(await getDueCohortCollectionRate(getMonthStart(cursor), getMonthEnd(cursor)));
  }
  return snapshots;
}
