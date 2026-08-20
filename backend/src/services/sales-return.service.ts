import { OrderStatus, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { getCustomerVatRate, roundMoney, splitInclusiveAmount } from '../utils/company';
import { nextInvoiceNumber, nextSalesReturnNumber } from '../utils/numbering';
import { assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';
import { AccountingService } from './accounting.service';
import { StockMovementService } from './inventory.service';

type TxClient = Prisma.TransactionClient;

export type SalesReturnLineInput = { productId: string; quantity: number };

export class SalesReturnService {
  static async returnedQtyByProduct(
    tx: TxClient,
    deliveryNoteId: string
  ): Promise<Map<string, number>> {
    const rows = await tx.salesReturnItem.findMany({
      where: { salesReturn: { deliveryNoteId } },
      select: { productId: true, quantity: true },
    });
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productId, (map.get(row.productId) || 0) + row.quantity);
    }
    return map;
  }

  /**
   * After a post-delivery return, reopen the sales order so remaining lines can be
   * edited / cancelled, or leave it DELIVERED when everything is still with the customer.
   */
  static async syncOrderStatusAfterReturn(tx: TxClient, salesOrderId: string): Promise<void> {
    const order = await tx.salesOrder.findUnique({
      where: { id: salesOrderId },
      include: { items: true },
    });
    if (!order || order.status === 'CANCELLED' || order.status === 'COMPLETED') return;

    const pendingNotes = await tx.deliveryNote.count({
      where: {
        salesOrderId,
        status: { notIn: ['DELIVERED', 'FAILED', 'RETURNED'] },
      },
    });

    const anyDelivered = order.items.some((i) => i.deliveredQty > 0);
    const fullyDelivered = order.items.every((i) => i.deliveredQty >= i.quantity);

    let next: OrderStatus;
    if (pendingNotes > 0) {
      next = fullyDelivered ? 'DISPATCHED' : 'PARTIALLY_DELIVERED';
    } else if (!anyDelivered) {
      next = 'READY';
    } else if (fullyDelivered) {
      next = 'DELIVERED';
    } else {
      next = 'PARTIALLY_DELIVERED';
    }

    if (next === order.status) return;
    assertOrderStatusTransition(order.status, next, { system: true });
    await tx.salesOrder.update({
      where: { id: salesOrderId },
      data: { status: next },
    });
  }

  static async createFromDelivery(
    tx: TxClient,
    opts: {
      deliveryNoteId: string;
      items: SalesReturnLineInput[];
      reason: string;
      userId: string;
      companyId: string;
    }
  ) {
    const reason = opts.reason.trim();
    if (!reason) throw new AppError('Return reason is required', 400);

    const lines = opts.items.filter((i) => i.quantity > 0);
    if (!lines.length) throw new AppError('Select at least one product quantity to return', 400);

    const delivery = await tx.deliveryNote.findFirst({
      where: { id: opts.deliveryNoteId, companyId: opts.companyId },
      include: {
        items: true,
        salesOrder: {
          include: {
            items: { include: { product: true } },
            customer: true,
          },
        },
        invoices: {
          where: { type: 'SALES' },
          include: { payments: true },
        },
      },
    });
    if (!delivery) throw new AppError('Delivery note not found', 404);
    if (delivery.status !== 'DELIVERED') {
      throw new AppError('Only customer-delivered deliveries can be returned', 400);
    }

    const returnLines: {
      productId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      productName: string;
      manufacturingCost: number;
    }[] = [];

    for (const line of lines) {
      const di = delivery.items.find((i) => i.productId === line.productId);
      if (!di) throw new AppError('Product was not on this delivery', 400);
      // Delivery line qty is already net of prior returns.
      const returnable = di.quantity;
      if (line.quantity > returnable) {
        const orderItem = delivery.salesOrder.items.find((i) => i.productId === line.productId);
        const name = orderItem?.product.name || line.productId;
        throw new AppError(
          `Cannot return ${line.quantity} of ${name} — only ${returnable} returnable`,
          400
        );
      }
      const orderItem = delivery.salesOrder.items.find((i) => i.productId === line.productId);
      if (!orderItem) throw new AppError('Product not found on sales order', 400);
      const unitPrice = roundMoney(Number(orderItem.unitPrice));
      const discount = Number(orderItem.discount || 0);
      const totalPrice = roundMoney(line.quantity * unitPrice * (1 - discount / 100));
      returnLines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitPrice,
        totalPrice,
        productName: orderItem.product.name,
        manufacturingCost: Number(orderItem.product.manufacturingCost || 0),
      });
    }

    const gross = returnLines.reduce((sum, l) => sum + l.totalPrice, 0);
    const vatRate = await getCustomerVatRate(delivery.salesOrder.customer);
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);

    const originalInvoice = delivery.invoices[0] || null;
    const returnNo = await nextSalesReturnNumber(tx, opts.companyId);
    const creditNoteNumber = await nextInvoiceNumber(tx, 'CN');

    const creditNote = await tx.invoice.create({
      data: {
        companyId: opts.companyId,
        invoiceNumber: creditNoteNumber,
        type: 'CREDIT_NOTE',
        customerId: delivery.salesOrder.customerId,
        salesOrderId: delivery.salesOrderId,
        deliveryNoteId: delivery.id,
        originalInvoiceId: originalInvoice?.id,
        subtotal,
        taxAmount,
        totalAmount,
        status: 'UNPAID',
        fiscalStatus: 'NOT_REQUIRED',
        notes: `Sales return ${returnNo} — ${reason}`,
        items: {
          create: returnLines.map((l) => ({
            description: `Return: ${l.productName}`,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            taxRate: vatRate,
            totalPrice: l.totalPrice,
          })),
        },
      },
    });

    await AccountingService.postCreditNote(tx, {
      id: creditNote.id,
      invoiceNumber: creditNote.invoiceNumber,
      subtotal,
      taxAmount,
      totalAmount,
    });

    let cogsReversal = 0;
    for (const line of returnLines) {
      const stock = await tx.stockLevel.findFirst({
        where: { productId: line.productId },
        orderBy: { quantity: 'desc' },
      });
      const unitCost = stock ? Number(stock.unitCost) : line.manufacturingCost;
      cogsReversal += line.quantity * unitCost;

      await StockMovementService.addProductStock(tx, {
        productId: line.productId,
        quantity: line.quantity,
        unitCost,
        referenceType: 'sales_return',
        referenceId: delivery.id,
        userId: opts.userId,
        notes: `Customer return ${returnNo} — ${delivery.deliveryNo}`,
        transactionType: 'RETURN',
      });

      const di = delivery.items.find((i) => i.productId === line.productId)!;
      const newQty = di.quantity - line.quantity;
      if (newQty <= 0) {
        await tx.deliveryItem.delete({ where: { id: di.id } });
      } else {
        await tx.deliveryItem.update({
          where: { id: di.id },
          data: { quantity: newQty },
        });
      }

      await tx.salesOrderItem.updateMany({
        where: { salesOrderId: delivery.salesOrderId, productId: line.productId },
        data: { deliveredQty: { decrement: line.quantity } },
      });
    }

    await AccountingService.postCogsReversal(tx, {
      reference: returnNo,
      amount: cogsReversal,
      sourceId: creditNote.id,
    });

    const remainingItems = await tx.deliveryItem.count({ where: { deliveryNoteId: delivery.id } });
    if (remainingItems === 0) {
      await tx.deliveryNote.update({
        where: { id: delivery.id },
        data: { status: 'RETURNED' },
      });
      if (delivery.deliveryTripId) {
        const { syncDeliveryTripStatus } = await import('./delivery-trip.service');
        await syncDeliveryTripStatus(tx, delivery.deliveryTripId);
      }
    }

    const salesReturn = await tx.salesReturn.create({
      data: {
        companyId: opts.companyId,
        returnNo,
        salesOrderId: delivery.salesOrderId,
        deliveryNoteId: delivery.id,
        originalInvoiceId: originalInvoice?.id,
        creditNoteId: creditNote.id,
        reason,
        status: 'COMPLETED',
        createdById: opts.userId,
        items: {
          create: returnLines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            totalPrice: l.totalPrice,
          })),
        },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        creditNote: { select: { id: true, invoiceNumber: true, totalAmount: true, status: true } },
        deliveryNote: { select: { id: true, deliveryNo: true, status: true } },
        salesOrder: { select: { id: true, orderNumber: true, status: true } },
      },
    });

    await this.syncOrderStatusAfterReturn(tx, delivery.salesOrderId);
    await syncCustomerCreditUsed(delivery.salesOrder.customerId, tx);

    return salesReturn;
  }
}
