import { PaymentStatus, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export type InvoiceBalanceFields = {
  id: string;
  type: string;
  totalAmount: unknown;
  paidAmount: unknown;
  status: PaymentStatus | string;
};

/** Credit notes linked to a sales invoice that still reduce balance due.
 * CNs that accompanied an in-place invoice rewrite are excluded ([INVOICE_ADJUSTED]).
 */
export async function creditedAmountForInvoice(
  tx: TxClient,
  invoiceId: string
): Promise<number> {
  const notes = await tx.invoice.findMany({
    where: {
      originalInvoiceId: invoiceId,
      type: 'CREDIT_NOTE',
    },
    select: { totalAmount: true, notes: true },
  });
  return notes.reduce((sum, cn) => {
    if ((cn.notes || '').includes('[INVOICE_ADJUSTED]')) return sum;
    return sum + Number(cn.totalAmount || 0);
  }, 0);
}

export function computeInvoiceBalanceDue(
  invoice: InvoiceBalanceFields,
  creditedAmount: number
): number {
  if (invoice.type === 'CREDIT_NOTE') {
    return Math.max(0, Number(invoice.totalAmount) - Number(invoice.paidAmount));
  }
  return Math.max(
    0,
    Number(invoice.totalAmount) - Number(invoice.paidAmount) - Number(creditedAmount || 0)
  );
}

export function resolveSalesInvoiceStatus(
  invoice: InvoiceBalanceFields,
  creditedAmount: number
): PaymentStatus {
  const paid = Number(invoice.paidAmount);
  const balance = computeInvoiceBalanceDue(invoice, creditedAmount);
  if (balance <= 0.009) return 'PAID';
  if (paid > 0.009 || creditedAmount > 0.009) return 'PARTIAL';
  if (invoice.status === 'OVERDUE') return 'OVERDUE';
  return 'UNPAID';
}

export function withInvoiceBalances<T extends InvoiceBalanceFields>(
  invoice: T,
  creditedAmount: number,
  creditNotes?: { id: string; invoiceNumber: string; totalAmount: unknown; status: string }[]
) {
  const credited = Number(creditedAmount || 0);
  return {
    ...invoice,
    creditedAmount: credited,
    balanceDue: computeInvoiceBalanceDue(invoice, credited),
    ...(creditNotes ? { creditNotes } : {}),
  };
}

export async function enrichInvoicesWithBalances<T extends InvoiceBalanceFields>(
  tx: TxClient,
  invoices: T[]
) {
  const salesIds = invoices.filter((i) => i.type === 'SALES').map((i) => i.id);
  const creditByOriginal = new Map<string, number>();
  if (salesIds.length) {
    const rows = await tx.invoice.findMany({
      where: {
        type: 'CREDIT_NOTE',
        originalInvoiceId: { in: salesIds },
      },
      select: { originalInvoiceId: true, totalAmount: true, notes: true },
    });
    for (const row of rows) {
      if (!row.originalInvoiceId) continue;
      if ((row.notes || '').includes('[INVOICE_ADJUSTED]')) continue;
      creditByOriginal.set(
        row.originalInvoiceId,
        (creditByOriginal.get(row.originalInvoiceId) || 0) + Number(row.totalAmount || 0)
      );
    }
  }

  return invoices.map((inv) =>
    withInvoiceBalances(inv, inv.type === 'SALES' ? creditByOriginal.get(inv.id) || 0 : 0)
  );
}

/**
 * Mark return credit note as applied and refresh original invoice payment status
 * from net balance (total − cash paid − linked credit notes).
 */
export async function applyCreditNoteToOriginalInvoice(
  tx: TxClient,
  opts: { creditNoteId: string; originalInvoiceId: string; creditTotal: number }
) {
  const cn = await tx.invoice.findUnique({
    where: { id: opts.creditNoteId },
    select: { notes: true },
  });
  const appliedNote = 'Applied to original sales invoice';
  const notes =
    cn && !(cn.notes || '').includes(appliedNote)
      ? cn.notes
        ? `${cn.notes}\n${appliedNote}`
        : appliedNote
      : cn?.notes ?? undefined;

  await tx.invoice.update({
    where: { id: opts.creditNoteId },
    data: {
      paidAmount: opts.creditTotal,
      status: 'PAID',
      ...(notes !== undefined ? { notes } : {}),
    },
  });

  const original = await tx.invoice.findUnique({
    where: { id: opts.originalInvoiceId },
  });
  if (!original || original.type !== 'SALES') return;

  const credited = await creditedAmountForInvoice(tx, original.id);
  const nextStatus = resolveSalesInvoiceStatus(original, credited);
  if (nextStatus !== original.status) {
    await tx.invoice.update({
      where: { id: original.id },
      data: { status: nextStatus },
    });
  }
}
