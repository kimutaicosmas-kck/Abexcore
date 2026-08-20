import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import { assertOrderStatusTransition } from '../utils/credit';
import { SalesOrderService } from './sales-order.service';
import { StockMovementService } from './inventory.service';
import { createDeliveryStop } from './delivery-trip.service';
import { FinancePaymentService } from './finance.service';

type PaymentMethod = 'CASH' | 'MPESA' | 'CARD' | 'BANK_TRANSFER';

export class PosService {
  static async ensureWalkInCustomer(companyId: string) {
    const existing = await prisma.customer.findFirst({
      where: {
        companyId,
        deletedAt: null,
        OR: [{ code: 'WALKIN' }, { name: 'Walk-in Customer' }],
      },
    });
    if (existing) return existing;

    return prisma.customer.create({
      data: injectTenantData({
        code: 'WALKIN',
        name: 'Walk-in Customer',
        type: 'RETAIL_SHOP',
        vatStatus: 'NON_VAT',
        paymentTerms: 0,
        isActive: true,
      }),
    });
  }

  /**
   * Cash-and-carry: create order → READY → dispatch (invoice + stock) → payment.
   */
  static async checkout(input: {
    userId: string;
    customerId?: string;
    items: Array<{ productId: string; quantity: number; unitPrice: number; discount?: number }>;
    paymentMethod: PaymentMethod;
    paymentReference?: string;
    mpesaPhone?: string;
    notes?: string;
  }) {
    if (!input.items.length) throw new AppError('Add at least one product', 400);

    const companyId = requireTenantId();
    const customerId = input.customerId || (await this.ensureWalkInCustomer(companyId)).id;

    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new AppError('One or more products were not found or inactive', 400);
    }

    return prisma.$transaction(async (tx) => {
      const count = await tx.salesOrder.count();
      const orderNumber = generateNumber('SO', count + 1);

      let subtotal = 0;
      const lineCreates = input.items.map((item) => {
        const discount = item.discount || 0;
        const totalPrice = item.quantity * item.unitPrice * (1 - discount / 100);
        subtotal += totalPrice;
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount,
          totalPrice,
        };
      });

      const order = await tx.salesOrder.create({
        data: injectTenantData({
          orderNumber,
          customerId,
          createdById: input.userId,
          orderDate: new Date(),
          status: 'PENDING',
          subtotal,
          taxAmount: 0,
          totalAmount: subtotal,
          notes: input.notes ? `POS: ${input.notes}` : 'POS sale',
          items: { create: lineCreates },
        }),
        include: { items: { include: { product: true } }, customer: true },
      });

      const stockCheck = await SalesOrderService.checkStockAvailability(tx, order.items);
      if (!stockCheck.canFulfill) {
        const summary = stockCheck.shortages
          .slice(0, 3)
          .map((s) => `${s.productName} (need ${s.required}, have ${s.available})`)
          .join('; ');
        throw new AppError(`Insufficient stock for POS: ${summary}`, 400);
      }

      for (const item of order.items) {
        await StockMovementService.reserveProductStock(tx, {
          productId: item.productId,
          quantity: item.quantity,
        });
      }
      assertOrderStatusTransition('PENDING', 'READY', { system: true });
      await tx.salesOrder.update({
        where: { id: order.id },
        data: { status: 'READY' },
      });

      const { dn, invoice } = await createDeliveryStop(tx, {
        salesOrderId: order.id,
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        userId: input.userId,
        notes: 'POS counter sale',
      });

      if (!invoice) {
        throw new AppError('POS sale created but invoice failed', 500);
      }

      let payment: Prisma.PaymentGetPayload<object> | null = null;
      const deferMpesa = input.paymentMethod === 'MPESA' && Boolean(input.mpesaPhone);
      if (!deferMpesa) {
        payment = await FinancePaymentService.recordPayment(tx, {
          invoiceId: invoice.id,
          amount: Number(invoice.totalAmount),
          method: input.paymentMethod,
          reference: input.paymentReference || `POS-${order.orderNumber}`,
          notes: 'Point of sale',
        });
      }

      return {
        order: await tx.salesOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: { items: { include: { product: true } }, customer: true },
        }),
        deliveryNote: dn,
        invoice,
        payment,
        awaitingMpesa: deferMpesa,
      };
    });
  }
}
