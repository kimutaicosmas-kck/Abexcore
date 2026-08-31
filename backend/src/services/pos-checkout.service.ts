import { AppError } from '../middleware/errorHandler';
import prisma from '../config/database';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import { generateNumber } from '../utils/date';
import { getCustomerVatRate, roundMoney, splitInclusiveAmount } from '../utils/company';
import { assertCreditLimit, assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';
import { SalesOrderService } from './sales-order.service';
import { StockMovementService } from './inventory.service';
import { applyDeliveryNoteStatus, createDeliveryStop } from './delivery-trip.service';
import { isSalesPersonRole } from '../config/rolePermissions';

type PosLine = { productId: string; quantity: number; unitPrice: number; discount?: number };

/**
 * Counter / walk-in checkout: create sales order, reserve stock when available,
 * dispatch a customer-collection delivery note (invoice created on dispatch).
 */
export class PosCheckoutService {
  static async checkout(opts: {
    customerId: string;
    items: PosLine[];
    userId: string;
    roleName?: string | null;
    notes?: string;
  }) {
    const companyId = requireTenantId();
    if (!opts.items.length) throw new AppError('Add at least one product', 400);

    const customer = await prisma.customer.findFirst({
      where: { id: opts.customerId, isActive: true, deletedAt: null },
      select: { id: true, name: true, salesPersonId: true, vatStatus: true },
    });
    if (!customer) throw new AppError('Customer not found', 404);

    const isSalesOfficer = isSalesPersonRole(opts.roleName);
    if (isSalesOfficer && customer.salesPersonId && customer.salesPersonId !== opts.userId) {
      throw new AppError('You can only sell to customers assigned to you.', 400);
    }

    const vatRate = await getCustomerVatRate(customer);
    const gross = opts.items.reduce((sum, item) => {
      const discount = item.discount || 0;
      return sum + item.quantity * item.unitPrice * (1 - discount / 100);
    }, 0);
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);
    await assertCreditLimit(opts.customerId, totalAmount);

    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);
    const assignedSalesPersonId = opts.userId;
    const now = new Date();

    return prisma.$transaction(async (tx) => {
      await SalesOrderService.assertUniqueSalesOrder(tx, {
        customerId: opts.customerId,
        businessDate: now,
        items: opts.items,
      });

      const order = await tx.salesOrder.create({
        data: injectTenantData({
          orderNumber,
          customerId: opts.customerId,
          createdById: opts.userId,
          salesPersonId: assignedSalesPersonId,
          orderDate: now,
          requiredDate: now,
          notes: opts.notes || 'POS counter sale — customer collection',
          subtotal,
          taxAmount,
          totalAmount,
          status: 'PENDING',
          items: {
            create: opts.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: roundMoney(item.unitPrice),
              discount: item.discount || 0,
              totalPrice: roundMoney(
                item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100)
              ),
            })),
          },
        }),
        include: {
          customer: true,
          items: { include: { product: true } },
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      const stockCheck = await SalesOrderService.checkStockAvailability(tx, order.items);
      if (!stockCheck.canFulfill) {
        const summary = stockCheck.shortages
          .slice(0, 3)
          .map((s) => `${s.productName} (need ${s.required}, have ${s.available})`)
          .join('; ');
        throw new AppError(`Insufficient stock for POS sale: ${summary}`, 400);
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

      const delivery = await createDeliveryStop(tx, {
        salesOrderId: order.id,
        items: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        notes: 'POS customer collection',
        userId: opts.userId,
      });

      await applyDeliveryNoteStatus(tx, delivery.dn.id, 'DELIVERED', {
        userId: opts.userId,
        proofOfDelivery: 'Collected at counter (POS)',
        actualItems: order.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
      });

      await syncCustomerCreditUsed(opts.customerId, tx);

      const refreshed = await tx.salesOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          customer: true,
          items: { include: { product: true } },
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
          deliveries: { select: { id: true, deliveryNo: true, status: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
        },
      });

      return {
        order: refreshed,
        deliveryNote: delivery.dn,
        invoice: delivery.invoice,
        companyId,
        fulfillment: 'collected' as const,
      };
    });
  }
}
