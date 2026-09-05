import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export async function computeCustomerCreditExposure(
  customerId: string,
  tx: TxClient = prisma,
  extraOrderAmount = 0
): Promise<number> {
  const [openSales, unallocatedCredits, openOrdersList] = await Promise.all([
    tx.invoice.findMany({
      where: {
        customerId,
        type: 'SALES',
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      },
      select: { id: true, totalAmount: true, paidAmount: true, type: true, status: true },
    }),
    tx.invoice.aggregate({
      where: {
        customerId,
        type: 'CREDIT_NOTE',
        status: { in: ['UNPAID', 'PARTIAL'] },
        originalInvoiceId: null,
      },
      _sum: { totalAmount: true, paidAmount: true },
    }),
    tx.salesOrder.findMany({
      where: {
        customerId,
        status: { notIn: ['CANCELLED', 'COMPLETED', 'DELIVERED'] },
      },
      include: {
        invoices: {
          where: { type: 'SALES' },
          select: { totalAmount: true },
        },
      },
    }),
  ]);

  const { enrichInvoicesWithBalances } = await import('./invoiceBalance');
  const enriched = await enrichInvoicesWithBalances(tx, openSales);
  const outstanding = enriched.reduce((sum, inv) => sum + Number(inv.balanceDue || 0), 0);
  const openCredit =
    Number(unallocatedCredits._sum.totalAmount || 0) -
    Number(unallocatedCredits._sum.paidAmount || 0);
  const openOrders = openOrdersList.reduce((sum, order) => {
    const invoicedTotal = order.invoices.reduce((line, inv) => line + Number(inv.totalAmount), 0);
    return sum + Math.max(0, Number(order.totalAmount) - invoicedTotal);
  }, 0);
  return Math.max(0, outstanding - openCredit) + openOrders + extraOrderAmount;
}

export async function syncCustomerCreditUsed(
  customerId: string,
  tx: TxClient = prisma
): Promise<number> {
  const exposure = await computeCustomerCreditExposure(customerId, tx, 0);
  await tx.customer.update({
    where: { id: customerId },
    data: { creditUsed: exposure },
  });
  return exposure;
}

/**
 * Credit limit is optional and advisory only — never blocks a sale.
 * Kept as a no-op so existing call sites stay valid; exposure is still tracked via creditUsed.
 */
export async function assertCreditLimit(
  customerId: string,
  _orderAmount: number,
  tx: TxClient = prisma
): Promise<void> {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);
}

const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['READY', 'CANCELLED'],
  IN_PRODUCTION: ['READY', 'CANCELLED'],
  READY: ['CANCELLED'],
  PARTIALLY_DELIVERED: [],
  DISPATCHED: ['COMPLETED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function assertOrderStatusTransition(
  current: string,
  next: string,
  options?: { system?: boolean }
): void {
  if (options?.system) {
    if (current === 'PENDING' && next === 'READY') return;
    if (current === 'CONFIRMED' && next === 'IN_PRODUCTION') return;
    if (current === 'CONFIRMED' && next === 'READY') return;
    if (current === 'IN_PRODUCTION' && next === 'READY') return;
    if (current === 'IN_PRODUCTION' && next === 'CONFIRMED') return;
    if (current === 'READY' && next === 'DISPATCHED') return;
    if (current === 'READY' && next === 'PARTIALLY_DELIVERED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'PARTIALLY_DELIVERED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'DISPATCHED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'DELIVERED') return;
    if (current === 'DISPATCHED' && next === 'DELIVERED') return;
    if (current === 'READY' && next === 'DELIVERED') return;
    // Post-delivery returns reopen the order for adjust / cancel.
    if (current === 'DELIVERED' && (next === 'PARTIALLY_DELIVERED' || next === 'READY' || next === 'DISPATCHED')) {
      return;
    }
    if (current === 'PARTIALLY_DELIVERED' && next === 'READY') return;
    // Physical delivery completion may race ahead of order status bookkeeping.
    if (next === 'DELIVERED' && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(current)) {
      return;
    }
  }

  const allowed = ORDER_TRANSITIONS[current];
  if (!allowed || !allowed.includes(next)) {
    throw new AppError(`Invalid order status transition from ${current} to ${next}`, 400);
  }
}
