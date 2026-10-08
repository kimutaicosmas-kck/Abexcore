/** Payments may be corrected once within this window after recording. */
export const PAYMENT_EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;

export type PaymentEditFields = {
  createdAt: Date | string;
  adjustedAt?: Date | string | null;
  isReconciled?: boolean;
};

export function paymentEditBlockedReason(payment: PaymentEditFields): string | null {
  if (payment.isReconciled) {
    return 'This payment is bank-reconciled. Unreconcile it before editing.';
  }
  if (payment.adjustedAt) {
    return 'This payment has already been adjusted and cannot be edited again.';
  }
  const created = new Date(payment.createdAt).getTime();
  if (Number.isNaN(created)) {
    return 'Invalid payment record date.';
  }
  if (Date.now() - created > PAYMENT_EDIT_WINDOW_MS) {
    return 'Payments can only be edited within 48 hours of recording.';
  }
  return null;
}

export function isPaymentEditable(payment: PaymentEditFields): boolean {
  return paymentEditBlockedReason(payment) === null;
}
