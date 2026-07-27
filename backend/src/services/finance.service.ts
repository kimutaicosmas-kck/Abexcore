import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { getVatRate, calcTax } from '../utils/company';
import { AccountingService } from './accounting.service';
import { syncCustomerCreditUsed } from '../utils/credit';
import { nextInvoiceNumber, nextPaymentNumber } from '../utils/numbering';
import { SalesOrderService } from './sales-order.service';

type TxClient = Prisma.TransactionClient;

function capInvoiceAmounts(
  subtotal: number,
  vatRate: number,
  remainingToInvoice: number,
  invoiceLines: {
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
    totalPrice: number;
  }[]
) {
  const taxAmount = calcTax(subtotal, vatRate);
  const totalAmount = subtotal + taxAmount;

  if (totalAmount <= remainingToInvoice + 0.01) {
    return { subtotal, taxAmount, totalAmount, invoiceLines };
  }

  const cappedTotal = Math.max(0, remainingToInvoice);
  const cappedSubtotal = cappedTotal / (1 + vatRate / 100);
  const cappedTax = cappedTotal - cappedSubtotal;
  const ratio = subtotal > 0 ? cappedSubtotal / subtotal : 0;

  return {
    subtotal: cappedSubtotal,
    taxAmount: cappedTax,
    totalAmount: cappedTotal,
    invoiceLines: invoiceLines.map((line) => ({
      ...line,
      totalPrice: line.totalPrice * ratio,
    })),
  };
}

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
            invoices: { where: { type: 'SALES' }, select: { id: true, totalAmount: true, deliveryNoteId: true } },
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

    await SalesOrderService.validateOrderLinesForInvoicing(
      tx,
      delivery.items.map((deliveryItem) => {
        const orderItem = order.items.find((item) => item.productId === deliveryItem.productId);
        if (!orderItem) {
          throw new AppError('Delivery product not found on sales order', 400);
        }
        return {
          productId: deliveryItem.productId,
          quantity: deliveryItem.quantity,
          product: orderItem.product,
        };
      }),
      { requireStock: false }
    );

    const orderTotal = Number(order.totalAmount);
    const alreadyInvoiced = order.invoices
      .filter((inv) => inv.deliveryNoteId !== deliveryNoteId)
      .reduce((sum, inv) => sum + Number(inv.totalAmount), 0);
    const remainingToInvoice = orderTotal - alreadyInvoiced;

    if (remainingToInvoice <= 0.01) {
      const priorInvoice =
        order.invoices.find((inv) => !inv.deliveryNoteId) ||
        order.invoices.find((inv) => inv.deliveryNoteId && inv.deliveryNoteId !== delivery.id);
      if (priorInvoice) {
        if (!priorInvoice.deliveryNoteId) {
          await tx.invoice.update({
            where: { id: priorInvoice.id },
            data: { deliveryNoteId: delivery.id },
          });
        }
        return tx.invoice.findUniqueOrThrow({
          where: { id: priorInvoice.id },
          include: { customer: true, items: true },
        });
      }
      return null;
    }

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

    const capped = capInvoiceAmounts(subtotal, vatRate, remainingToInvoice, invoiceLines);

    const invoiceNumber = await nextInvoiceNumber(tx, 'INV');
    const paymentTerms = Number(order.customer?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        companyId: order.companyId,
        invoiceNumber,
        type: 'SALES',
        customerId: order.customerId,
        salesOrderId: order.id,
        deliveryNoteId: delivery.id,
        subtotal: capped.subtotal,
        taxAmount: capped.taxAmount,
        totalAmount: capped.totalAmount,
        dueDate: new Date(Date.now() + paymentTerms * 24 * 60 * 60 * 1000),
        fiscalStatus: 'PENDING',
        items: { create: capped.invoiceLines },
      },
      include: { customer: true, items: true },
    });

    await AccountingService.postSalesInvoice(tx, {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      subtotal: Number(inv.subtotal),
      taxAmount: Number(inv.taxAmount),
      totalAmount: Number(inv.totalAmount),
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    return inv;
  }

  static async recalculateDeliveryInvoice(tx: TxClient, deliveryNoteId: string) {
    const delivery = await tx.deliveryNote.findUnique({
      where: { id: deliveryNoteId },
      include: {
        items: true,
        salesOrder: {
          include: {
            items: { include: { product: true } },
            customer: true,
            invoices: { where: { type: 'SALES' }, select: { id: true, totalAmount: true, deliveryNoteId: true } },
          },
        },
      },
    });
    if (!delivery) throw new AppError('Delivery note not found', 404);

    const invoice = await tx.invoice.findFirst({
      where: { deliveryNoteId, type: 'SALES' },
      include: { items: true, payments: true },
    });
    if (!invoice) return null;
    if (Number(invoice.paidAmount) > 0 || invoice.payments.length > 0) {
      throw new AppError('Cannot adjust invoice after payments have been recorded', 400);
    }

    const order = delivery.salesOrder;
    const vatRate = await getVatRate();
    let subtotal = 0;
    const invoiceLines = delivery.items.map((deliveryItem) => {
      const orderItem = order.items.find((item) => item.productId === deliveryItem.productId);
      if (!orderItem) throw new AppError('Delivery product not found on sales order', 400);
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

    await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        subtotal,
        taxAmount,
        totalAmount,
        items: { create: invoiceLines },
      },
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    return tx.invoice.findUnique({ where: { id: invoice.id }, include: { items: true } });
  }

  static async createSalesInvoiceFromOrder(tx: TxClient, orderId: string) {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { product: true } },
        customer: true,
        deliveries: true,
        invoices: { where: { type: 'SALES' }, select: { id: true } },
      },
    });
    if (!order) throw new AppError('Sales order not found', 404);

    if (order.invoices.length > 0) {
      throw new AppError('This order already has a sales invoice', 409);
    }

    if (order.deliveries.length > 0) {
      throw new AppError('Order has deliveries — invoice is created automatically when you dispatch goods', 400);
    }

    if (order.items.length === 0) {
      throw new AppError('Cannot create invoice: order has no products', 400);
    }

    await SalesOrderService.validateOrderLinesForInvoicing(
      tx,
      order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        product: item.product,
      }))
    );

    const vatRate = await getVatRate();
    const invoiceNumber = await nextInvoiceNumber(tx, 'INV');
    const paymentTerms = Number(order.customer?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        companyId: order.companyId,
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
      id: inv.id,
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
    const invoiceNumber = await nextInvoiceNumber(tx, 'PINV');
    const paymentTerms = Number(grn.supplier?.paymentTerms || 30);

    const inv = await tx.invoice.create({
      data: {
        companyId: grn.companyId,
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
      id: inv.id,
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
    const paymentNumber = await nextPaymentNumber(tx);

    const invoice = await tx.invoice.findUnique({ where: { id: opts.invoiceId } });
    if (!invoice) throw new AppError('Invoice not found', 404);

    const p = await tx.payment.create({
      data: {
        companyId: invoice.companyId,
        paymentNumber,
        invoiceId: opts.invoiceId,
        amount: opts.amount,
        method: opts.method,
        reference: opts.reference,
        notes: opts.notes,
      },
    });

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
        { id: p.id, paymentNumber: p.paymentNumber, amount: Number(p.amount), method: p.method },
        invoice.invoiceNumber
      );
      if (invoice.customerId) {
        await syncCustomerCreditUsed(invoice.customerId, tx);
      }
    }

    if (invoice.type === 'PURCHASE') {
      await AccountingService.postSupplierPayment(
        tx,
        { id: p.id, paymentNumber: p.paymentNumber, amount: Number(p.amount), method: p.method },
        invoice.invoiceNumber
      );
    }

    return p;
  }
}
