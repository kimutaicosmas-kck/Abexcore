import { Prisma, OrderStatus } from '@prisma/client';
import { assertOrderStatusTransition } from '../utils/credit';

type TxClient = Prisma.TransactionClient;

export class SalesOrderService {
  static async maybeAdvanceToReady(tx: TxClient, salesOrderId: string) {
    const salesOrder = await tx.salesOrder.findUnique({ where: { id: salesOrderId } });
    if (!salesOrder || salesOrder.status !== 'IN_PRODUCTION') return null;

    const incomplete = await tx.productionOrder.count({
      where: {
        salesOrderId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
    if (incomplete > 0) return null;

    assertOrderStatusTransition(salesOrder.status, 'READY', { system: true });
    return tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: 'READY' },
    });
  }

  static async maybeSetInProduction(tx: TxClient, salesOrderId: string) {
    const salesOrder = await tx.salesOrder.findUnique({ where: { id: salesOrderId } });
    if (!salesOrder || salesOrder.status !== 'CONFIRMED') return null;

    assertOrderStatusTransition(salesOrder.status, 'IN_PRODUCTION', { system: true });
    return tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: 'IN_PRODUCTION' },
    });
  }

  static async isFullyDelivered(tx: TxClient, salesOrderId: string): Promise<boolean> {
    const items = await tx.salesOrderItem.findMany({ where: { salesOrderId } });
    return items.length > 0 && items.every((item) => item.deliveredQty >= item.quantity);
  }

  static async hasOpenProduction(tx: TxClient, salesOrderId: string): Promise<boolean> {
    const count = await tx.productionOrder.count({
      where: {
        salesOrderId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    });
    return count > 0;
  }

  static resolveStatusAfterDispatch(currentStatus: string, fullyDelivered: boolean): OrderStatus {
    if (fullyDelivered) return 'DISPATCHED';
    if (currentStatus === 'READY' || currentStatus === 'PARTIALLY_DELIVERED') {
      return 'PARTIALLY_DELIVERED';
    }
    return currentStatus as OrderStatus;
  }
}
