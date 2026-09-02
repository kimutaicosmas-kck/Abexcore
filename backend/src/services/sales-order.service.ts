import { Prisma, OrderStatus } from '@prisma/client';
import { assertOrderStatusTransition, assertCreditLimit, syncCustomerCreditUsed } from '../utils/credit';
import { AppError } from '../middleware/errorHandler';
import { generateNumber, startOfDay, endOfDay } from '../utils/date';
import { getCustomerVatRate, roundMoney, splitInclusiveAmount } from '../utils/company';
import { StockMovementService } from './inventory.service';

type TxClient = Prisma.TransactionClient;

export type SalesOrderLineInput = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
};

export type StockShortage = {
  productId: string;
  productName: string;
  required: number;
  available: number;
};

export class SalesOrderService {
  /** Stable key for comparing order line items (duplicate detection). */
  static buildLineFingerprint(items: SalesOrderLineInput[]): string {
    const lines = items
      .map((item) => ({
        p: item.productId,
        q: item.quantity,
        u: roundMoney(item.unitPrice),
        d: item.discount ?? 0,
      }))
      .sort((a, b) => a.p.localeCompare(b.p) || a.q - b.q || a.u - b.u);
    return JSON.stringify(lines);
  }

  /** Reject duplicate sales orders (same LPO, or accidental double-submit of identical lines). */
  static async assertUniqueSalesOrder(
    tx: TxClient,
    input: {
      customerId: string;
      businessDate: Date;
      customerPoNumber?: string | null;
      items: SalesOrderLineInput[];
    }
  ): Promise<void> {
    const po = input.customerPoNumber?.trim();
    if (po) {
      const byPo = await tx.salesOrder.findFirst({
        where: {
          customerId: input.customerId,
          customerPoNumber: po,
          status: { not: 'CANCELLED' },
        },
        select: { orderNumber: true },
      });
      if (byPo) {
        throw new AppError(
          `A sales order already exists for this customer with LPO / PO "${po}" (${byPo.orderNumber}).`,
          409,
          'DUPLICATE_SALES_ORDER'
        );
      }
    }

    // Same customer may buy the same products/qty many times in a day (esp. Trading).
    // Only block near-identical re-submits (double-click / retry) within a short window.
    const DOUBLE_SUBMIT_WINDOW_MS = 5 * 60 * 1000;
    const fingerprint = this.buildLineFingerprint(input.items);
    const recentSince = new Date(Date.now() - DOUBLE_SUBMIT_WINDOW_MS);
    const candidates = await tx.salesOrder.findMany({
      where: {
        customerId: input.customerId,
        status: { not: 'CANCELLED' },
        createdAt: { gte: recentSince },
      },
      include: {
        items: { select: { productId: true, quantity: true, unitPrice: true, discount: true } },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    for (const order of candidates) {
      const existingFp = this.buildLineFingerprint(
        order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount || 0),
        }))
      );
      if (existingFp === fingerprint) {
        throw new AppError(
          `This looks like a duplicate submit of ${order.orderNumber} (same customer and lines just now). Open that order, or wait a moment and try again if this is a new sale.`,
          409,
          'DUPLICATE_SALES_ORDER'
        );
      }
    }
  }

  /**
   * Sellable qty = on-hand minus reserved in finished goods.
   * Minimum stock level is an alert only — never reduces sellable quantity.
   */
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
      // Sell everything on hand that is not already reserved — ignore minStockLevel.
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

  /**
   * Qty locked by customer-confirmed deliveries (DN status DELIVERED).
   * Open dispatches (PENDING/ASSIGNED/IN_TRANSIT) are still adjustable.
   */
  static async confirmedDeliveredByProduct(
    tx: TxClient,
    salesOrderId: string
  ): Promise<Map<string, number>> {
    const rows = await tx.deliveryItem.findMany({
      where: {
        deliveryNote: { salesOrderId, status: 'DELIVERED' },
      },
      select: { productId: true, quantity: true },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productId, (map.get(row.productId) || 0) + row.quantity);
    }
    return map;
  }

  /**
   * Pull qty back from open (not yet customer-delivered) dispatch notes:
   * restock, reduce deliveredQty, shrink/remove DN lines, drop unpaid invoices if DN emptied.
   */
  static async releaseOpenDispatchQty(
    tx: TxClient,
    opts: { salesOrderId: string; productId: string; quantity: number; userId: string; productName: string }
  ) {
    let left = opts.quantity;
    if (left <= 0) return;

    const notes = await tx.deliveryNote.findMany({
      where: {
        salesOrderId: opts.salesOrderId,
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
        items: { some: { productId: opts.productId } },
      },
      include: {
        items: true,
        invoices: { include: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    for (const dn of notes) {
      if (left <= 0) break;

      const paid = dn.invoices.some(
        (inv) => Number(inv.paidAmount) > 0 || inv.payments.length > 0
      );
      if (paid) {
        throw new AppError(
          `Cannot adjust ${opts.productName} — delivery ${dn.deliveryNo} already has a payment. Reverse the payment first.`,
          400
        );
      }

      const di = dn.items.find((i) => i.productId === opts.productId);
      if (!di) continue;
      const take = Math.min(left, di.quantity);

      await StockMovementService.addProductStock(tx, {
        productId: opts.productId,
        quantity: take,
        referenceType: 'order_adjustment',
        referenceId: opts.salesOrderId,
        userId: opts.userId,
        notes: `Order adjust — reverse open dispatch ${dn.deliveryNo}`,
      });

      if (take >= di.quantity) {
        await tx.deliveryItem.delete({ where: { id: di.id } });
      } else {
        await tx.deliveryItem.update({
          where: { id: di.id },
          data: { quantity: di.quantity - take },
        });
      }

      await tx.salesOrderItem.updateMany({
        where: { salesOrderId: opts.salesOrderId, productId: opts.productId },
        data: { deliveredQty: { decrement: take } },
      });

      left -= take;

      const remainingItems = await tx.deliveryItem.count({ where: { deliveryNoteId: dn.id } });
      if (remainingItems === 0) {
        for (const inv of dn.invoices) {
          await tx.invoiceItem.deleteMany({ where: { invoiceId: inv.id } });
          await tx.invoice.delete({ where: { id: inv.id } });
        }
        await tx.deliveryNote.delete({ where: { id: dn.id } });
      } else {
        const { FinanceInvoiceService } = await import('./finance.service');
        await FinanceInvoiceService.recalculateDeliveryInvoice(tx, dn.id);
      }
    }

    if (left > 0) {
      throw new AppError(
        `Cannot fully reverse open dispatches for ${opts.productName} (${left} unit(s) still locked).`,
        400
      );
    }
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
    adjustmentReason: string,
    userId: string
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

    const confirmedByProduct = await this.confirmedDeliveredByProduct(tx, orderId);
    const reservesStock = ['READY', 'PARTIALLY_DELIVERED', 'DISPATCHED'].includes(order.status);
    const existingById = new Map(order.items.map((item) => [item.id, item]));
    const keptIds = new Set<string>();

    for (const input of itemsInput) {
      const existing = input.id
        ? existingById.get(input.id)
        : order.items.find((i) => i.productId === input.productId && !keptIds.has(i.id));

      if (existing) {
        keptIds.add(existing.id);
        const confirmed = confirmedByProduct.get(existing.productId) || 0;
        if (input.quantity < confirmed) {
          throw new AppError(
            `Cannot set quantity below customer-delivered amount (${confirmed} delivered for ${existing.product.name})`,
            400
          );
        }

        // Refresh deliveredQty after any prior reverse in this loop
        const live = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: existing.id } });
        const dispatched = Number(live.deliveredQty);
        if (input.quantity < dispatched) {
          await this.releaseOpenDispatchQty(tx, {
            salesOrderId: orderId,
            productId: existing.productId,
            quantity: dispatched - input.quantity,
            userId,
            productName: existing.product.name,
          });
        }

        const afterReverse = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: existing.id } });
        const undeliveredBeforeAdj = Math.max(0, existing.quantity - Number(afterReverse.deliveredQty));
        const undeliveredAfter = Math.max(0, input.quantity - Number(afterReverse.deliveredQty));
        const reserveDelta = undeliveredAfter - undeliveredBeforeAdj;

        if (reservesStock && reserveDelta !== 0) {
          if (reserveDelta < 0) {
            await StockMovementService.releaseProductReservation(tx, {
              productId: existing.productId,
              quantity: -reserveDelta,
            });
          } else {
            const check = await this.checkStockAvailability(tx, [
              { productId: existing.productId, quantity: reserveDelta, product: existing.product },
            ]);
            if (!check.canFulfill) {
              const s = check.shortages[0];
              throw new AppError(
                `Insufficient stock to increase quantity (${s.productName}: need ${reserveDelta} more, only ${s.available} available)`,
                400
              );
            }
            await StockMovementService.reserveProductStock(tx, {
              productId: existing.productId,
              quantity: reserveDelta,
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

      // New line — allowed until the order itself is delivered/completed.
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
      const confirmed = confirmedByProduct.get(existing.productId) || 0;
      if (confirmed > 0) {
        throw new AppError(
          `Cannot remove ${existing.product.name} — ${confirmed} unit(s) already customer-delivered`,
          400
        );
      }

      const live = await tx.salesOrderItem.findUniqueOrThrow({ where: { id: existing.id } });
      if (Number(live.deliveredQty) > 0) {
        await this.releaseOpenDispatchQty(tx, {
          salesOrderId: orderId,
          productId: existing.productId,
          quantity: Number(live.deliveredQty),
          userId,
          productName: existing.product.name,
        });
      }

      const undelivered = Math.max(
        0,
        existing.quantity -
          Number(
            (
              await tx.salesOrderItem.findUnique({
                where: { id: existing.id },
                select: { deliveredQty: true },
              })
            )?.deliveredQty || 0
          )
      );
      if (reservesStock && undelivered > 0) {
        await StockMovementService.releaseProductReservation(tx, {
          productId: existing.productId,
          quantity: undelivered,
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
