import { Prisma, OrderStatus } from '@prisma/client';
import { assertOrderStatusTransition, assertCreditLimit, syncCustomerCreditUsed } from '../utils/credit';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { getCustomerVatRate, roundMoney, splitInclusiveAmount } from '../utils/company';
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

  /** Ensures order lines reference valid products with enough finished-goods stock to invoice. */
  static async validateOrderLinesForInvoicing(
    tx: TxClient,
    lines: { productId: string; quantity: number; product?: { name: string } | null }[],
    options?: { requireStock?: boolean }
  ): Promise<void> {
    const requireStock = options?.requireStock !== false;
    if (lines.length === 0) {
      throw new AppError('Cannot create invoice: order has no products', 400);
    }

    const warehouseId = await StockMovementService.getFinishedGoodsWarehouseId(tx);
    const missing: string[] = [];
    const inactive: string[] = [];
    const shortages: StockShortage[] = [];

    for (const line of lines) {
      if (line.quantity <= 0) continue;

      const product = await tx.product.findFirst({
        where: { id: line.productId, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });

      if (!product) {
        missing.push(line.product?.name || line.productId);
        continue;
      }
      if (!product.isActive) {
        inactive.push(product.name);
        continue;
      }

      if (!requireStock) continue;

      const stock = await tx.stockLevel.findFirst({
        where: { warehouseId, productId: line.productId },
      });
      const onHand = stock ? Number(stock.quantity) : 0;
      if (onHand < line.quantity) {
        shortages.push({
          productId: line.productId,
          productName: product.name,
          required: line.quantity,
          available: Math.max(0, onHand),
        });
      }
    }

    if (missing.length) {
      throw new AppError(
        `Cannot create invoice: product no longer exists (${missing.join(', ')})`,
        400
      );
    }
    if (inactive.length) {
      throw new AppError(
        `Cannot create invoice: inactive product(s) (${inactive.join(', ')})`,
        400
      );
    }
    if (shortages.length) {
      const detail = shortages
        .map((s) => `${s.productName} (need ${s.required}, in stock ${s.available})`)
        .join('; ');
      throw new AppError(`Cannot create invoice: insufficient stock — ${detail}`, 400);
    }
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
      sequence += 1;
      const order = await tx.productionOrder.create({
        data: {
          companyId: salesOrder.companyId,
          orderNumber: generateNumber('PRO', sequence),
          productId: item.productId,
          salesOrderId,
          assignedToId,
          quantity: item.quantity,
          priority: 'NORMAL',
          notes: `From sales order ${salesOrder.orderNumber}`,
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

  /**
   * Keep sales-order status aligned with delivery outcomes system-wide.
   * When every delivery note is closed and at least one was delivered (including shortfalls),
   * the order becomes DELIVERED so admin, driver, and sales all see the same completion.
   */
  static async syncOrderDeliveryStatus(tx: TxClient, salesOrderId: string): Promise<void> {
    const order = await tx.salesOrder.findUnique({ where: { id: salesOrderId } });
    if (!order || ['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status)) return;

    const pendingNotes = await tx.deliveryNote.count({
      where: {
        salesOrderId,
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
      },
    });
    if (pendingNotes > 0) return;

    const deliveredNotes = await tx.deliveryNote.count({
      where: { salesOrderId, status: 'DELIVERED' },
    });
    if (deliveredNotes === 0) return;

    assertOrderStatusTransition(order.status, 'DELIVERED', { system: true });
    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: 'DELIVERED' },
    });
  }

  static async updateOrderItems(
    tx: TxClient,
    orderId: string,
    itemsInput: {
      id?: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      discount?: number;
    }[],
    adjustmentReason: string
  ) {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        customer: true,
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!order) throw new AppError('Sales order not found', 404);

    const editableStatuses = ['PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'PARTIALLY_DELIVERED', 'DISPATCHED'];
    if (!editableStatuses.includes(order.status)) {
      throw new AppError(`Cannot edit order in ${order.status.replace(/_/g, ' ')} status`, 400);
    }

    const reservesStock = ['READY', 'PARTIALLY_DELIVERED', 'DISPATCHED'].includes(order.status);
    const existingById = new Map(order.items.map((item) => [item.id, item]));
    const keptIds = new Set<string>();

    for (const input of itemsInput) {
      const existing = input.id
        ? existingById.get(input.id)
        : order.items.find((i) => i.productId === input.productId && !keptIds.has(i.id));

      if (existing) {
        keptIds.add(existing.id);
        if (input.quantity < existing.deliveredQty) {
          throw new AppError(
            `Cannot set quantity below already delivered amount (${existing.deliveredQty} delivered for ${existing.product.name})`,
            400
          );
        }

        const qtyDelta = input.quantity - existing.quantity;
        if (reservesStock && qtyDelta !== 0) {
          if (qtyDelta < 0) {
            await StockMovementService.releaseProductReservation(tx, {
              productId: existing.productId,
              quantity: -qtyDelta,
            });
          } else {
            const check = await this.checkStockAvailability(tx, [
              { productId: existing.productId, quantity: qtyDelta, product: existing.product },
            ]);
            if (!check.canFulfill) {
              const s = check.shortages[0];
              throw new AppError(
                `Insufficient stock to increase quantity (${s.productName}: need ${qtyDelta} more, only ${s.available} available)`,
                400
              );
            }
            await StockMovementService.reserveProductStock(tx, {
              productId: existing.productId,
              quantity: qtyDelta,
            });
          }
        }

        await tx.salesOrderItem.update({
          where: { id: existing.id },
          data: {
            quantity: input.quantity,
            unitPrice: roundMoney(input.unitPrice),
            discount: input.discount ?? 0,
            totalPrice: roundMoney(
              input.quantity * input.unitPrice * (1 - (input.discount ?? 0) / 100)
            ),
          },
        });
        continue;
      }

      if (order.status !== 'PENDING' && order.status !== 'CONFIRMED' && order.status !== 'READY') {
        throw new AppError('New products can only be added before dispatch starts', 400);
      }

      if (reservesStock) {
        const product = await tx.product.findUnique({ where: { id: input.productId } });
        const check = await this.checkStockAvailability(tx, [
          { productId: input.productId, quantity: input.quantity, product },
        ]);
        if (!check.canFulfill) {
          const s = check.shortages[0];
          throw new AppError(
            `Insufficient stock for new line (${s.productName}: need ${s.required}, have ${s.available})`,
            400
          );
        }
        await StockMovementService.reserveProductStock(tx, {
          productId: input.productId,
          quantity: input.quantity,
        });
      }

      await tx.salesOrderItem.create({
        data: {
          salesOrderId: orderId,
          productId: input.productId,
          quantity: input.quantity,
          unitPrice: roundMoney(input.unitPrice),
          discount: input.discount ?? 0,
          totalPrice: roundMoney(
            input.quantity * input.unitPrice * (1 - (input.discount ?? 0) / 100)
          ),
        },
      });
    }

    for (const existing of order.items) {
      if (keptIds.has(existing.id)) continue;
      if (existing.deliveredQty > 0) {
        throw new AppError(`Cannot remove ${existing.product.name} — ${existing.deliveredQty} units already delivered`, 400);
      }
      if (reservesStock) {
        await StockMovementService.releaseProductReservation(tx, {
          productId: existing.productId,
          quantity: existing.quantity,
        });
      }
      await tx.salesOrderItem.delete({ where: { id: existing.id } });
    }

    const updatedItems = await tx.salesOrderItem.findMany({ where: { salesOrderId: orderId } });
    const customer = await tx.customer.findUnique({
      where: { id: order.customerId },
      select: { vatStatus: true },
    });
    const vatRate = await getCustomerVatRate(customer);
    // Line totalPrice is the keyed (VAT-inclusive) amount.
    const gross = updatedItems.reduce((sum, item) => sum + Number(item.totalPrice), 0);
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);

    await assertCreditLimit(order.customerId, totalAmount, tx);

    const adjustmentNote = `[Adjusted ${new Date().toISOString().slice(0, 10)}] ${adjustmentReason}`;
    const updated = await tx.salesOrder.update({
      where: { id: orderId },
      data: {
        subtotal,
        taxAmount,
        totalAmount,
        notes: order.notes ? `${order.notes}\n${adjustmentNote}` : adjustmentNote,
      },
      include: {
        customer: true,
        items: { include: { product: true } },
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    await this.syncOrderDeliveryStatus(tx, orderId);

    return updated;
  }
}
