import { Prisma, OrderStatus } from '@prisma/client';
import { assertOrderStatusTransition } from '../utils/credit';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { StockMovementService } from './inventory.service';

type TxClient = Prisma.TransactionClient;

export type StockShortage = {
  productId: string;
  productName: string;
  required: number;
  available: number;
};

export class SalesOrderService {
  static async checkStockAvailability(
    tx: TxClient,
    items: { productId: string; quantity: number; product?: { name: string } | null }[]
  ): Promise<{ canFulfill: boolean; shortages: StockShortage[] }> {
    const warehouseId = await StockMovementService.getFinishedGoodsWarehouseId(tx);
    const shortages: StockShortage[] = [];

    for (const item of items) {
      const stock = await tx.stockLevel.findFirst({
        where: { warehouseId, productId: item.productId },
      });
      const onHand = stock ? Number(stock.quantity) : 0;
      const reserved = stock ? Number(stock.reservedQty) : 0;
      const available = onHand - reserved;

      if (available < item.quantity) {
        shortages.push({
          productId: item.productId,
          productName: item.product?.name || 'Product',
          required: item.quantity,
          available: Math.max(0, available),
        });
      }
    }

    return { canFulfill: shortages.length === 0, shortages };
  }
  static async createProductionOrdersFromSalesOrder(
    tx: TxClient,
    salesOrderId: string,
    assignedToId: string
  ) {
    const existingCount = await tx.productionOrder.count({
      where: { salesOrderId, status: { notIn: ['CANCELLED'] } },
    });
    if (existingCount > 0) return [];

    const salesOrder = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { items: true },
    });
    if (!salesOrder) throw new AppError('Sales order not found', 404);
    if (salesOrder.items.length === 0) {
      throw new AppError('Sales order has no line items to manufacture', 400);
    }

    const created = [];
    let sequence = await tx.productionOrder.count();

    for (const item of salesOrder.items) {
      const bom = await tx.billOfMaterial.findUnique({
        where: { productId: item.productId },
        include: { items: true },
      });

      sequence += 1;
      const order = await tx.productionOrder.create({
        data: {
          orderNumber: generateNumber('PRO', sequence),
          productId: item.productId,
          salesOrderId,
          assignedToId,
          quantity: item.quantity,
          priority: 'NORMAL',
          notes: `From sales order ${salesOrder.orderNumber}`,
          consumption: bom
            ? {
                create: bom.items.map((bomItem) => ({
                  rawMaterialId: bomItem.rawMaterialId,
                  plannedQty: Number(bomItem.quantity) * item.quantity,
                  unit: bomItem.unit,
                })),
              }
            : undefined,
        },
      });
      created.push(order);
    }

    return created;
  }
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
