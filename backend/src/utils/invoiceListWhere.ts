import type { Prisma } from '@prisma/client';
import { dayRangeFromInput, paymentPeriodRange, type PaymentPeriodPreset } from './date';

export type InvoiceListFilters = {
  search?: string;
  type?: string;
  status?: string;
  vatStatus?: 'VAT' | 'NON_VAT';
  period?: PaymentPeriodPreset;
  from?: string;
  to?: string;
};

function invoiceVatStatusWhere(vatStatus: 'VAT' | 'NON_VAT'): Prisma.InvoiceWhereInput {
  if (vatStatus === 'VAT') {
    return {
      OR: [
        { customer: { vatStatus: 'VAT' } },
        { type: { in: ['PURCHASE', 'DEBIT_NOTE'] }, taxAmount: { gt: 0 } },
      ],
    };
  }

  return {
    OR: [
      { customer: { vatStatus: 'NON_VAT' } },
      { type: { in: ['PURCHASE', 'DEBIT_NOTE'] }, taxAmount: { lte: 0 } },
    ],
  };
}

function invoiceDateWhere(filters: InvoiceListFilters): Prisma.InvoiceWhereInput | undefined {
  if (filters.period) {
    return { invoiceDate: paymentPeriodRange(filters.period) };
  }

  if (!filters.from && !filters.to) return undefined;

  const invoiceDate: Prisma.DateTimeFilter = {};
  if (filters.from) {
    const fromRange = dayRangeFromInput(filters.from);
    if (fromRange) invoiceDate.gte = fromRange.gte;
  }
  if (filters.to) {
    const toRange = dayRangeFromInput(filters.to);
    if (toRange) invoiceDate.lte = toRange.lte;
  }

  return Object.keys(invoiceDate).length > 0 ? { invoiceDate } : undefined;
}

/** Shared invoice list filters for Finance invoices tab and stats. */
export function buildInvoiceListWhere(filters: InvoiceListFilters = {}): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];

  if (filters.type) {
    and.push({ type: filters.type as Prisma.EnumInvoiceTypeFilter['equals'] });
  }
  if (filters.status) {
    and.push({ status: filters.status as Prisma.EnumPaymentStatusFilter['equals'] });
  }
  if (filters.vatStatus) {
    and.push(invoiceVatStatusWhere(filters.vatStatus));
  }

  const dateWhere = invoiceDateWhere(filters);
  if (dateWhere) and.push(dateWhere);

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    and.push({
      OR: [
        { invoiceNumber: { contains: q } },
        { customer: { name: { contains: q } } },
        { supplier: { name: { contains: q } } },
        { creditNotes: { some: { invoiceNumber: { contains: q } } } },
        { originalInvoice: { is: { invoiceNumber: { contains: q } } } },
      ],
    });
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

/** Human-readable summary for invoice list exports. */
export function describeInvoiceListFilters(filters: InvoiceListFilters = {}): string {
  const parts: string[] = [];
  if (filters.type) parts.push(`Type: ${filters.type.replace(/_/g, ' ')}`);
  if (filters.status) parts.push(`Status: ${filters.status}`);
  if (filters.vatStatus) {
    parts.push(filters.vatStatus === 'VAT' ? 'VAT customers' : 'Non-VAT customers');
  }
  if (filters.period) {
    parts.push(`Period: ${filters.period.replace(/_/g, ' ')}`);
  } else if (filters.from || filters.to) {
    parts.push(`Dates: ${filters.from || '…'} to ${filters.to || '…'}`);
  }
  if (filters.search?.trim()) parts.push(`Search: ${filters.search.trim()}`);
  return parts.join(' · ');
}
