import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { getVatRate, calcTax } from '../utils/company';
import { AccountingService } from './accounting.service';
import { syncCustomerCreditUsed } from '../utils/credit';

type TxClient = Prisma.TransactionClient;

export class FinanceInvoiceService {
  static async createSalesInvoiceFromDelivery(tx: TxClient, deliveryNoteId: string) {
    const delivery = await tx.deliveryNote.findUnique({
      where: { id: deliveryNoteId },
      include: {
        items: true,
        salesOrder: {
          include: {
            items: { include: { product: true } },
            customer: true,
          },
        },
      },
    });
    if (!delivery) throw new AppError('Delivery note not found', 404);

    const existing = await tx.invoice.findFirst({
      where: { deliveryNoteId, type: 'SALES' },
    });
    if (existing) return existing;

    const order = delivery.salesOrder;
    const vatRate = await getVatRate();
    let subtotal = 0;

    const invoiceLines = delivery.items.map((deliveryItem) => {
      const orderItem = order.items.find((item) => item.productId === deliveryItem.productId);
      if (!orderItem) {
        throw new AppError('Delivery product not found on sales order', 400);
      }

      const unitPrice = Number(orderItem.unitPrice);
      const discount = Number(orderItem.discount || 0);
      const lineSubtotal = deliveryItem.quantity * unitPrice * (1 - discount / 100);
      subtotal += lineSubtotal;

      return {
        description: orderItem.product.name,
        quantity: deliveryItem.quantity,
        unitPrice,
        taxRate: vatRate,
        totalPrice: lineSubtotal,
      };
    });

    const taxAmount = calcTax(subtotal, vatRate);
    const totalAmount = subtotal + taxAmount;
    const count = await tx.invoice.count();
    const invoiceNumber = generateNumber('INV', count + 1);
    const paymentTerms = Number(order.customer?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        invoiceNumber,
        type: 'SALES',
        customerId: order.customerId,
        salesOrderId: order.id,
        deliveryNoteId: delivery.id,
        subtotal,
        taxAmount,
        totalAmount,
        dueDate: new Date(Date.now() + paymentTerms * 24 * 60 * 60 * 1000),
        fiscalStatus: 'PENDING',
        items: { create: invoiceLines },
      },
      include: { customer: true, items: true },
    });

    await AccountingService.postSalesInvoice(tx, {
      invoiceNumber: inv.invoiceNumber,
      subtotal: Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    return inv;
  }

  static async createSalesInvoiceFromOrder(tx: TxClient, orderId: string) {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, customer: true, deliveries: true },
    });
    if (!order) throw new AppError('Sales order not found', 404);

    const existing = await tx.invoice.findFirst({
      where: { salesOrderId: orderId, type: 'SALES', deliveryNoteId: null },
    });
    if (existing) return existing;

    if (order.deliveries.length > 0) {
      throw new AppError('Order has deliveries — invoice per delivery note instead', 400);
    }

    const vatRate = await getVatRate();
    const count = await tx.invoice.count();
    const invoiceNumber = generateNumber('INV', count + 1);
    const paymentTerms = Number(order.customer?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        invoiceNumber,
        type: 'SALES',
        customerId: order.customerId,
        salesOrderId: order.id,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        dueDate: new Date(Date.now() + paymentTerms * 24 * 60 * 60 * 1000),
        fiscalStatus: 'PENDING',
        items: {
          create: order.items.map((item) => ({
            description: item.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            taxRate: vatRate,
            totalPrice: item.totalPrice,
          })),
        },
      },
      include: { customer: true, items: true },
    });

    await AccountingService.postSalesInvoice(tx, {
      invoiceNumber: inv.invoiceNumber,
      subtotal: Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    return inv;
  }

  static async createPurchaseInvoiceFromGrn(tx: TxClient, grnId: string) {
    const grn = await tx.goodsReceipt.findUnique({
      where: { id: grnId },
      include: { items: true, supplier: true, purchaseOrder: true },
    });
    if (!grn) throw new AppError('Goods receipt not found', 404);
    if (grn.status !== 'APPROVED') {
      throw new AppError('Goods receipt must be posted to stock before invoicing', 400);
    }

    const existing = await tx.invoice.findFirst({
      where: { goodsReceiptId: grnId, type: 'PURCHASE' },
    });
    if (existing) return existing;

    const vatRate = await getVatRate();
    const subtotal = grn.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitCost),
      0
    );
    const taxAmount = calcTax(subtotal, vatRate);
    const totalAmount = subtotal + taxAmount;
    const count = await tx.invoice.count();
    const invoiceNumber = generateNumber('PINV', count + 1);
    const paymentTerms = Number(grn.supplier?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        invoiceNumber,
        type: 'PURCHASE',
        supplierId: grn.supplierId,
        purchaseOrderId: grn.purchaseOrderId,
        goodsReceiptId: grn.id,
        subtotal,
        taxAmount,
        totalAmount,
        dueDate: new Date(Date.now() + paymentTerms * 24 * 60 * 60 * 1000),
        items: {
          create: grn.items.map((item) => ({
            description: `GRN ${grn.grnNumber} receipt`,
            quantity: item.quantity,
            unitPrice: item.unitCost,
            taxRate: vatRate,
            totalPrice: Number(item.quantity) * Number(item.unitCost),
          })),
        },
      },
      include: { supplier: true, items: true },
    });

    await AccountingService.postPurchaseInvoice(tx, {
      invoiceNumber: inv.invoiceNumber,
      subtotal: Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
    });

    return inv;
  }
}

export class FinancePaymentService {
  static async recordPayment(
    tx: TxClient,
    opts: {
      invoiceId: string;
      amount: number;
      method: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'MPESA' | 'CARD' | 'CREDIT';
      reference?: string;
      notes?: string;
      reconciledById?: string;
    }
  ) {
    const count = await tx.payment.count();
    const paymentNumber = generateNumber('PAY', count + 1);

    const p = await tx.payment.create({
      data: {
        paymentNumber,
        invoiceId: opts.invoiceId,
        amount: opts.amount,
        method: opts.method,
        reference: opts.reference,
        notes: opts.notes,
      },
    });

    const invoice = await tx.invoice.findUnique({ where: { id: opts.invoiceId } });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);
    if (Number(opts.amount) > balance + 0.01) {
      throw new AppError(`Payment exceeds invoice balance (KES ${balance.toFixed(2)})`, 400);
    }

    const paidAmount = Number(invoice.paidAmount) + Number(opts.amount);
    const invStatus = paidAmount >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL';
    await tx.invoice.update({
      where: { id: opts.invoiceId },
      data: { paidAmount, status: invStatus },
    });

    if (invoice.type === 'SALES') {
      await AccountingService.postPayment(
        tx,
        { paymentNumber: p.paymentNumber, amount: Number(p.amount), method: p.method },
        invoice.invoiceNumber
      );
      if (invoice.customerId) {
        await syncCustomerCreditUsed(invoice.customerId, tx);
      }
    }

    if (invoice.type === 'PURCHASE') {
      await AccountingService.postSupplierPayment(
        tx,
        { paymentNumber: p.paymentNumber, amount: Number(p.amount), method: p.method },
        invoice.invoiceNumber
      );
    }

    return p;
  }
}
