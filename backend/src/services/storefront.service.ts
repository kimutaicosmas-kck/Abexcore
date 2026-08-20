import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { injectTenantData, requireTenantId, runWithTenant } from '../utils/tenant';
import { generateNumber } from '../utils/date';
import { assertOrderStatusTransition } from '../utils/credit';
import { SalesOrderService } from './sales-order.service';
import { StockMovementService } from './inventory.service';
import { createDeliveryStop } from './delivery-trip.service';
import { FinancePaymentService } from './finance.service';
import { MpesaService } from './mpesa.service';

async function resolveSystemUserId(companyId: string) {
  const admin = await prisma.user.findFirst({
    where: {
      companyId,
      isActive: true,
      deletedAt: null,
      role: { name: { in: ['Super Admin', 'Managing Director', 'Sales Manager', 'Sales Officer'] } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (admin) return admin.id;
  const any = await prisma.user.findFirst({
    where: { companyId, isActive: true, deletedAt: null },
  });
  if (!any) throw new AppError('Store has no active users to own web orders', 500);
  return any.id;
}

export class StorefrontService {
  static async getStore(slug: string) {
    const company = await prisma.company.findFirst({
      where: { slug, isActive: true, storefrontEnabled: true },
      select: {
        id: true,
        slug: true,
        name: true,
        logo: true,
        phone: true,
        email: true,
        currency: true,
        city: true,
        country: true,
      },
    });
    if (!company) throw new AppError('Online store not found or not enabled', 404);
    return company;
  }

  static async listProducts(slug: string, params?: { search?: string; page?: number; limit?: number }) {
    const company = await this.getStore(slug);
    const page = params?.page || 1;
    const limit = Math.min(params?.limit || 24, 60);
    const search = params?.search?.trim();

    return runWithTenant({ companyId: company.id }, async () => {
      const where = {
        isActive: true,
        deletedAt: null as null,
        ...(search
          ? {
              OR: [
                { name: { contains: search } },
                { sku: { contains: search } },
              ],
            }
          : {}),
      };

      const [total, products] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({
          where,
          select: {
            id: true,
            name: true,
            sku: true,
            description: true,
            unit: true,
            sellingPrice: true,
            imageUrl: true,
            stockLevels: { select: { quantity: true } },
          },
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      return {
        store: company,
        data: products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          description: p.description,
          unit: p.unit,
          price: Number(p.sellingPrice),
          imageUrl: p.imageUrl,
          inStock: p.stockLevels.reduce((s, l) => s + Number(l.quantity), 0) > 0,
        })),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      };
    });
  }

  static async checkout(
    slug: string,
    input: {
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      customerAddress?: string;
      items: Array<{ productId: string; quantity: number }>;
      paymentMethod: 'CASH_ON_DELIVERY' | 'MPESA';
      mpesaPhone?: string;
      notes?: string;
    }
  ) {
    if (!input.items.length) throw new AppError('Cart is empty', 400);
    const company = await this.getStore(slug);

    return runWithTenant({ companyId: company.id }, async () => {
      const userId = await resolveSystemUserId(company.id);
      const phone = input.customerPhone.replace(/\s+/g, '');

      let customer = await prisma.customer.findFirst({
        where: {
          companyId: company.id,
          deletedAt: null,
          OR: [{ phone }, ...(input.customerEmail ? [{ email: input.customerEmail }] : [])],
        },
      });

      if (!customer) {
        const count = await prisma.customer.count({ where: { companyId: company.id } });
        customer = await prisma.customer.create({
          data: injectTenantData({
            code: `WEB${String(count + 1).padStart(4, '0')}`,
            name: input.customerName.trim(),
            phone,
            email: input.customerEmail || undefined,
            address: input.customerAddress || undefined,
            type: 'RETAIL_SHOP',
            vatStatus: 'NON_VAT',
            paymentTerms: 0,
            isActive: true,
          }),
        });
      }

      const productIds = input.items.map((i) => i.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null, isActive: true },
      });
      if (products.length !== productIds.length) {
        throw new AppError('One or more products are unavailable', 400);
      }
      const priceById = new Map(products.map((p) => [p.id, Number(p.sellingPrice)]));

      const sale = await prisma.$transaction(async (tx) => {
        const count = await tx.salesOrder.count();
        const orderNumber = generateNumber('SO', count + 1);

        let subtotal = 0;
        const lineCreates = input.items.map((item) => {
          const unitPrice = priceById.get(item.productId) || 0;
          const totalPrice = item.quantity * unitPrice;
          subtotal += totalPrice;
          return {
            productId: item.productId,
            quantity: item.quantity,
            unitPrice,
            discount: 0,
            totalPrice,
          };
        });

        const order = await tx.salesOrder.create({
          data: injectTenantData({
            orderNumber,
            customerId: customer!.id,
            createdById: userId,
            orderDate: new Date(),
            status: 'PENDING',
            subtotal,
            taxAmount: 0,
            totalAmount: subtotal,
            notes: [
              'E-commerce storefront order',
              input.notes,
              input.customerAddress ? `Ship to: ${input.customerAddress}` : null,
            ]
              .filter(Boolean)
              .join(' | '),
            items: { create: lineCreates },
          }),
          include: { items: { include: { product: true } }, customer: true },
        });

        const stockCheck = await SalesOrderService.checkStockAvailability(tx, order.items);
        if (!stockCheck.canFulfill) {
          assertOrderStatusTransition('PENDING', 'CONFIRMED');
          await tx.salesOrder.update({
            where: { id: order.id },
            data: { status: 'CONFIRMED' },
          });
          return {
            order,
            invoice: null as null,
            payment: null as null,
            deliveryNote: null as null,
            status: 'CONFIRMED' as const,
            message: 'Order placed. We will contact you when stock is ready.',
          };
        }

        for (const item of order.items) {
          await StockMovementService.reserveProductStock(tx, {
            productId: item.productId,
            quantity: item.quantity,
          });
        }
        assertOrderStatusTransition('PENDING', 'READY', { system: true });
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: 'READY' } });

        const { dn, invoice } = await createDeliveryStop(tx, {
          salesOrderId: order.id,
          items: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          userId,
          notes: 'E-commerce fulfilment',
        });

        let payment = null;
        if (invoice && input.paymentMethod === 'MPESA' && !input.mpesaPhone) {
          payment = await FinancePaymentService.recordPayment(tx, {
            invoiceId: invoice.id,
            amount: Number(invoice.totalAmount),
            method: 'MPESA',
            reference: `WEB-${order.orderNumber}`,
            notes: 'Storefront M-Pesa (manual)',
          });
        }

        return {
          order: await tx.salesOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { items: { include: { product: true } }, customer: true },
          }),
          invoice,
          payment,
          deliveryNote: dn,
          status: 'READY' as const,
          message: 'Order confirmed',
        };
      });

      let mpesaCheckoutRequestId: string | undefined;
      if (sale.invoice && input.paymentMethod === 'MPESA' && input.mpesaPhone && !sale.payment) {
        try {
          const normalizedPhone = MpesaService.normalizePhone(input.mpesaPhone);
          const stk = await MpesaService.initiateStkPush({
            phone: normalizedPhone,
            amount: Number(sale.invoice.totalAmount),
            accountReference: sale.invoice.invoiceNumber,
            description: `Web order ${sale.order.orderNumber}`,
          });
          await prisma.mpesaTransaction.create({
            data: {
              companyId: company.id,
              invoiceId: sale.invoice.id,
              phone: normalizedPhone,
              amount: Number(sale.invoice.totalAmount),
              checkoutRequestId: stk.checkoutRequestId,
              merchantRequestId: stk.merchantRequestId,
              status: 'PENDING',
            },
          });
          mpesaCheckoutRequestId = stk.checkoutRequestId;
        } catch {
          // Order stands; buyer can pay later
        }
      }

      return {
        store: { slug: company.slug, name: company.name },
        orderNumber: sale.order.orderNumber,
        orderId: sale.order.id,
        totalAmount: Number(sale.order.totalAmount),
        status: sale.status,
        message: sale.message,
        invoiceNumber: sale.invoice?.invoiceNumber ?? null,
        mpesaCheckoutRequestId,
      };
    });
  }

  static async setEnabled(enabled: boolean) {
    const companyId = requireTenantId();
    return prisma.company.update({
      where: { id: companyId },
      data: { storefrontEnabled: enabled },
      select: { id: true, slug: true, name: true, storefrontEnabled: true },
    });
  }
}
