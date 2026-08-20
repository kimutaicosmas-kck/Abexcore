import { Prisma } from '@prisma/client';
import { generateNumber } from './date';

type TxClient = Prisma.TransactionClient;

function maxSequenceFromNumbers(numbers: string[], prefix: string): number {
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
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

export async function nextInvoiceNumber(
  tx: TxClient,
  prefix: 'INV' | 'PINV'
): Promise<string> {
  const year = new Date().getFullYear();
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: `${prefix}-${year}-` } },
    select: { invoiceNumber: true },
  });
  return generateNumber(prefix, maxSequenceFromNumbers(rows.map((r) => r.invoiceNumber), prefix) + 1);
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
