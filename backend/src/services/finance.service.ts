import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { getVatRate, getCustomerVatRate, calcTax, roundMoney, splitInclusiveAmount } from '../utils/company';
import { AccountingService } from './accounting.service';
import { syncCustomerCreditUsed } from '../utils/credit';
import { nextInvoiceNumber, nextPaymentNumber } from '../utils/numbering';
import { resolveSalesBusinessDate } from '../utils/salesDate';
import { SalesOrderService } from './sales-order.service';

type TxClient = Prisma.TransactionClient;

/** Cap a VAT-inclusive sales invoice total, then extract net + VAT. */
function capInvoiceAmounts(
  gross: number,
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
  const split = splitInclusiveAmount(gross, vatRate);

  if (split.totalAmount <= remainingToInvoice + 0.01) {
    return { ...split, invoiceLines };
  }

  const cappedTotal = Math.max(0, remainingToInvoice);
  const capped = splitInclusiveAmount(cappedTotal, vatRate);
  const ratio = gross > 0 ? cappedTotal / gross : 0;

  return {
    subtotal: capped.subtotal,
    taxAmount: capped.taxAmount,
    totalAmount: cappedTotal,
    invoiceLines: invoiceLines.map((line) => ({
      ...line,
      totalPrice: roundMoney(line.totalPrice * ratio),
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

    // Non-VAT customers still get a company invoice — at 0% VAT.
    // Order unit prices are VAT-inclusive; extract VAT from the keyed gross.
    const vatRate = await getCustomerVatRate(order.customer);
    let gross = 0;

    const invoiceLines = delivery.items.map((deliveryItem) => {
      const orderItem = order.items.find((item) => item.productId === deliveryItem.productId);
      if (!orderItem) {
        throw new AppError('Delivery product not found on sales order', 400);
      }

      const unitPrice = roundMoney(Number(orderItem.unitPrice));
      const discount = Number(orderItem.discount || 0);
      const lineGross = roundMoney(deliveryItem.quantity * unitPrice * (1 - discount / 100));
      gross += lineGross;

      return {
        description: orderItem.product.name,
        quantity: deliveryItem.quantity,
        unitPrice,
        taxRate: vatRate,
        totalPrice: lineGross,
      };
    });

    const capped = capInvoiceAmounts(gross, vatRate, remainingToInvoice, invoiceLines);

    const invoiceNumber = await nextInvoiceNumber(tx, 'INV');
    const paymentTerms = Number(order.customer?.paymentTerms || 30);
    // Backdate invoice to the order's required/sale date (not dispatch time).
    const invoiceDate = resolveSalesBusinessDate(order);
    const dueDate = new Date(invoiceDate.getTime() + paymentTerms * 24 * 60 * 60 * 1000);

    const inv = await tx.invoice.create({
      data: {
        companyId: order.companyId,
        invoiceNumber,
        type: 'SALES',
        customerId: order.customerId,
        salesOrderId: order.id,
        deliveryNoteId: delivery.id,
        customerPoNumber: order.customerPoNumber || undefined,
        invoiceDate,
        subtotal: capped.subtotal,
        taxAmount: capped.taxAmount,
        totalAmount: capped.totalAmount,
        dueDate,
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
    const vatRate = await getCustomerVatRate(order.customer);
    let gross = 0;
    const invoiceLines = delivery.items.map((deliveryItem) => {
      const orderItem = order.items.find((item) => item.productId === deliveryItem.productId);
      if (!orderItem) throw new AppError('Delivery product not found on sales order', 400);
      const unitPrice = roundMoney(Number(orderItem.unitPrice));
      const discount = Number(orderItem.discount || 0);
      const lineGross = roundMoney(deliveryItem.quantity * unitPrice * (1 - discount / 100));
      gross += lineGross;
      return {
        description: orderItem.product.name,
        quantity: deliveryItem.quantity,
        unitPrice,
        taxRate: vatRate,
        totalPrice: lineGross,
      };
    });

    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);

    await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        subtotal,
        taxAmount,
        totalAmount,
        customerPoNumber: order.customerPoNumber || undefined,
        items: { create: invoiceLines },
      },
    });

    await syncCustomerCreditUsed(order.customerId, tx);
    return tx.invoice.findUnique({ where: { id: invoice.id }, include: { items: true } });
  }

  /**
   * Goods are always delivered with a delivery note. Sales invoices are created
   * from delivery dispatch (`createSalesInvoiceFromDelivery`), not from the order alone.
   */
  static async createSalesInvoiceFromOrder(tx: TxClient, orderId: string): Promise<never> {
    const order = await tx.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true },
    });
    if (!order) throw new AppError('Sales order not found', 404);

    throw new AppError(
      'Goods must be delivered with a delivery note. Create a delivery from the Delivery module — the sales invoice is created automatically on dispatch.',
      400
    );
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
      invoiceId?: string;
      amount?: number;
      method?: 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'MPESA' | 'CARD' | 'CREDIT';
      reference?: string;
      notes?: string;
      paymentDate?: Date | string | null;
      allocations?: { invoiceId: string; amount: number }[];
      reconciledById?: string;
    }
  ) {
    const allocations =
      opts.allocations && opts.allocations.length > 0
        ? opts.allocations.map((a) => ({
            invoiceId: a.invoiceId,
            amount: Number(a.amount),
          }))
        : opts.invoiceId && opts.amount != null
          ? [{ invoiceId: opts.invoiceId, amount: Number(opts.amount) }]
          : [];

    if (allocations.length === 0) {
      throw new AppError('Select at least one invoice and amount', 400);
    }

    const invoiceIds = allocations.map((a) => a.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      throw new AppError('Each invoice can only appear once in a payment', 400);
    }

    const invoices = await tx.invoice.findMany({ where: { id: { in: invoiceIds } } });
    if (invoices.length !== invoiceIds.length) {
      throw new AppError('One or more invoices were not found', 404);
    }

    const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
    const companyId = invoices[0]!.companyId;
    if (invoices.some((inv) => inv.companyId !== companyId)) {
      throw new AppError('All invoices in a payment must belong to the same company', 400);
    }

    const types = new Set(invoices.map((inv) => inv.type));
    if (types.size > 1) {
      throw new AppError('Cannot mix sales and purchase invoices in one payment', 400);
    }

    const customerIds = new Set(
      invoices.map((inv) => inv.customerId).filter((id): id is string => Boolean(id))
    );
    if (customerIds.size > 1) {
      throw new AppError('Select invoices for one customer only', 400);
    }
    const supplierIds = new Set(
      invoices.map((inv) => inv.supplierId).filter((id): id is string => Boolean(id))
    );
    if (supplierIds.size > 1) {
      throw new AppError('Select invoices for one supplier only', 400);
    }

    const { creditedAmountForInvoice, resolveSalesInvoiceStatus } = await import(
      '../utils/invoiceBalance'
    );
    const { parseLocalDateInput } = await import('../utils/date');

    let paymentDate: Date = new Date();
    if (opts.paymentDate) {
      if (opts.paymentDate instanceof Date) {
        paymentDate = opts.paymentDate;
      } else {
        const parsed = parseLocalDateInput(String(opts.paymentDate));
        if (!parsed) throw new AppError('Invalid payment date', 400);
        paymentDate = parsed;
      }
    }

    for (const alloc of allocations) {
      const invoice = invoiceById.get(alloc.invoiceId)!;
      const credited =
        invoice.type === 'SALES' ? await creditedAmountForInvoice(tx, invoice.id) : 0;
      const balance =
        Number(invoice.totalAmount) - Number(invoice.paidAmount) - credited;
      if (alloc.amount > balance + 0.01) {
        throw new AppError(
          `Payment for ${invoice.invoiceNumber} exceeds balance (KES ${balance.toFixed(2)})`,
          400
        );
      }
    }

    const totalAmount = allocations.reduce((sum, a) => sum + a.amount, 0);
    const paymentNumber = await nextPaymentNumber(tx);
    const primaryInvoiceId = allocations.length === 1 ? allocations[0]!.invoiceId : null;
    const method = opts.method || 'BANK_TRANSFER';

    const payment = await tx.payment.create({
      data: {
        companyId,
        paymentNumber,
        invoiceId: primaryInvoiceId,
        amount: totalAmount,
        method,
        reference: opts.reference,
        notes: opts.notes,
        paymentDate,
      },
    });

    const invoiceType = invoices[0]!.type;

    for (const alloc of allocations) {
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: alloc.invoiceId,
          amount: alloc.amount,
        },
      });

      const invoice = invoiceById.get(alloc.invoiceId)!;
      const paidAmount = Number(invoice.paidAmount) + alloc.amount;
      let invStatus: 'PAID' | 'PARTIAL' =
        paidAmount >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL';

      if (invoice.type === 'SALES') {
        const credited = await creditedAmountForInvoice(tx, invoice.id);
        invStatus = resolveSalesInvoiceStatus(
          { ...invoice, paidAmount },
          credited
        ) as 'PAID' | 'PARTIAL';
      }

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount, status: invStatus },
      });
    }

    const invoiceLabels = allocations
      .map((a) => invoiceById.get(a.invoiceId)?.invoiceNumber)
      .filter(Boolean)
      .join(', ');

    if (invoiceType === 'SALES') {
      await AccountingService.postPayment(
        tx,
        {
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          amount: totalAmount,
          method: payment.method,
        },
        invoiceLabels
      );
      const customerId = invoices.find((inv) => inv.customerId)?.customerId;
      if (customerId) {
        await syncCustomerCreditUsed(customerId, tx);
      }
    }

    if (invoiceType === 'PURCHASE') {
      await AccountingService.postSupplierPayment(
        tx,
        {
          id: payment.id,
          paymentNumber: payment.paymentNumber,
          amount: totalAmount,
          method: payment.method,
        },
        invoiceLabels
      );
    }

    return tx.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: {
        allocations: {
          include: {
            invoice: { select: { id: true, invoiceNumber: true } },
          },
        },
      },
    });
  }
}
