import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export async function computeCustomerCreditExposure(
  customerId: string,
  tx: TxClient = prisma,
  extraOrderAmount = 0
): Promise<number> {
  const [invoiceAgg, openOrdersList] = await Promise.all([
    tx.invoice.aggregate({
      where: {
        customerId,
        type: 'SALES',
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
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

  const outstanding =
    Number(invoiceAgg._sum.totalAmount || 0) - Number(invoiceAgg._sum.paidAmount || 0);
  const openOrders = openOrdersList.reduce((sum, order) => {
    const invoicedTotal = order.invoices.reduce((line, inv) => line + Number(inv.totalAmount), 0);
    return sum + Math.max(0, Number(order.totalAmount) - invoicedTotal);
  }, 0);
  return outstanding + openOrders + extraOrderAmount;
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

export async function assertCreditLimit(
  customerId: string,
  orderAmount: number,
  tx: TxClient = prisma
): Promise<void> {
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const creditLimit = Number(customer.creditLimit);
  if (creditLimit <= 0) return;

  const exposure = await computeCustomerCreditExposure(customerId, tx, orderAmount);

  if (exposure > creditLimit) {
    throw new AppError(
      `Credit limit exceeded. Limit: KES ${creditLimit.toLocaleString()}, exposure after order: KES ${exposure.toLocaleString()}`,
      400,
      'CREDIT_LIMIT_EXCEEDED'
    );
  }
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
    if (current === 'READY' && next === 'DISPATCHED') return;
    if (current === 'READY' && next === 'PARTIALLY_DELIVERED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'PARTIALLY_DELIVERED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'DISPATCHED') return;
    if (current === 'PARTIALLY_DELIVERED' && next === 'DELIVERED') return;
    if (current === 'DISPATCHED' && next === 'DELIVERED') return;
    if (current === 'READY' && next === 'DELIVERED') return;
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
