import { Prisma } from '@prisma/client';
import { generateNumber } from './date';

type TxClient = Prisma.TransactionClient;

function maxSequenceFromNumbers(numbers: string[], prefix: string): number {
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');
  let max = 0;
  for (const value of numbers) {
    const match = value.match(pattern);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!Number.isNaN(seq) && seq > max) max = seq;
    }
  }
  return max;
}

/** Highest trailing digits on any QT-* number (year-prefixed, demo QT-D*, legacy QT-*). */
function maxQuotationSequence(numbers: string[]): number {
  const year = new Date().getFullYear();
  const yearMax = maxSequenceFromNumbers(numbers, 'QT');
  let legacyMax = 0;
  for (const value of numbers) {
    const match = value.match(/^QT-(?:D)?(\d+)$/i);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (!Number.isNaN(seq) && seq > legacyMax) legacyMax = seq;
    }
  }
  return Math.max(yearMax, legacyMax);
}

export async function nextInvoiceNumber(
  tx: TxClient,
  prefix: 'INV' | 'PINV' | 'CN'
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: `${prefix}-${year}-` } },
    select: { invoiceNumber: true },
  });
  return generateNumber(prefix, maxSequenceFromNumbers(rows.map((r) => r.invoiceNumber), prefix) + 1);
}

export async function nextSalesReturnNumber(tx: TxClient, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.salesReturn.findMany({
    where: { companyId, returnNo: { startsWith: `RET-${year}-` } },
    select: { returnNo: true },
  });
  return generateNumber('RET', maxSequenceFromNumbers(rows.map((r) => r.returnNo), 'RET') + 1);
}

export async function nextPaymentNumber(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.payment.findMany({
    where: { paymentNumber: { startsWith: `PAY-${year}-` } },
    select: { paymentNumber: true },
  });
  return generateNumber('PAY', maxSequenceFromNumbers(rows.map((r) => r.paymentNumber), 'PAY') + 1);
}

export async function nextDeliveryNoteNumber(tx: TxClient): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.deliveryNote.findMany({
    where: { deliveryNo: { startsWith: `DN-${year}-` } },
    select: { deliveryNo: true },
  });
  return generateNumber('DN', maxSequenceFromNumbers(rows.map((r) => r.deliveryNo), 'DN') + 1);
}

export async function nextDeliveryTripNumber(tx: TxClient, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.deliveryTrip.findMany({
    where: { companyId, tripNo: { startsWith: `TR-${year}-` } },
    select: { tripNo: true },
  });
  return generateNumber('TR', maxSequenceFromNumbers(rows.map((r) => r.tripNo), 'TR') + 1);
}

export async function nextSalaryAdvanceNumber(tx: TxClient, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.salaryAdvance.findMany({
    where: { companyId, advanceNo: { startsWith: `ADV-${year}-` } },
    select: { advanceNo: true },
  });
  return generateNumber('ADV', maxSequenceFromNumbers(rows.map((r) => r.advanceNo), 'ADV') + 1);
}

export async function nextExpenseNumber(tx: TxClient, companyId: string): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.expense.findMany({
    where: { companyId, expenseNumber: { startsWith: `EXP-${year}-` } },
    select: { expenseNumber: true },
  });
  return generateNumber('EXP', maxSequenceFromNumbers(rows.map((r) => r.expenseNumber), 'EXP') + 1);
}

export async function nextQuotationNumber(tx: TxClient, companyId: string): Promise<string> {
  const rows = await tx.salesQuotation.findMany({
    where: { companyId },
    select: { quotationNo: true },
  });
  return generateNumber('QT', maxQuotationSequence(rows.map((r) => r.quotationNo)) + 1);
}

function isQuotationNoConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: string | string[]; modelName?: string } };
  if (e.code !== 'P2002') return false;
  if (e.meta?.modelName === 'SalesQuotation') return true;
  const target = Array.isArray(e.meta?.target)
    ? e.meta.target.join(',')
    : String(e.meta?.target || '');
  return target.includes('quotation_no') || target.includes('sales_quotations');
}

/** Retries quotation creation when concurrent requests collide on quotationNo. */
export async function withQuotationNumberRetry<T>(
  run: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (!isQuotationNoConflict(err) || attempt >= maxAttempts - 1) throw err;
    }
  }
  throw new Error('Failed to allocate quotation number');
}
