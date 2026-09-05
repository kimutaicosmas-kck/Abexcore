import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createSalesOrderSchema,
  updateSalesOrderItemsSchema,
  createProductionOrderSchema,
  cancelProductionOrderSchema,
  completeProductionSchema,
  updateSalesOrderAssignmentSchema,
  createQuotationSchema,
  saveQuotationDraftSchema,
  salesListQuerySchema,
  salesStatsQuerySchema,
  paginationSchema,
  productionListQuerySchema,
  posCheckoutSchema,
} from '../validators/schemas';
import prisma from '../config/database';
import {
  dayRangeFromInput,
  generateNumber,
  nextQualityInspectionNumber,
  parseLocalDateInput,
  startOfDay,
} from '../utils/date';
import { getParam, getQuery } from '../utils/request';
import { SalesService, ProductionStatsService, QualityService } from '../services/operations.service';
import { getCustomerVatRate, roundMoney, splitInclusiveAmount } from '../utils/company';
import { assertCreditLimit, assertOrderStatusTransition, syncCustomerCreditUsed } from '../utils/credit';
import { StockMovementService } from '../services/inventory.service';
import { SalesOrderService, StockShortage } from '../services/sales-order.service';
import { ProductionService } from '../services/production.service';
import { PosCheckoutService } from '../services/pos-checkout.service';
import { AccountingService } from '../services/accounting.service';
import { isSalesOrderReassignableToday } from '../utils/salesDate';
import { salesPersonOrderFilter } from '../services/my-sales.service';
import { NotificationService } from '../services/notification.service';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import {
  isSalesBookOwner,
  isSalesPersonRole,
  SALES_PERSON_ROLE_NAMES,
  SALES_TARGET_MANAGER_ROLES,
} from '../config/rolePermissions';
import { buildSalesOrdersWhere } from '../utils/sales-list-where';
import { Prisma } from '@prisma/client';

const router = Router();
router.use(authenticate);

type PersonName = { firstName: string; lastName: string };

/** Parse optional order date; allows past days, rejects future and >365 days ago. */
function resolveSalesOrderDate(orderDate?: string): Date {
  if (!orderDate) return new Date();
  const parsed = parseLocalDateInput(orderDate);
  if (!parsed) throw new AppError('Invalid order date. Use YYYY-MM-DD.', 400);
  const day = startOfDay(parsed);
  const today = startOfDay(new Date());
  if (day.getTime() > today.getTime()) {
    throw new AppError('Order date cannot be in the future', 400);
  }
  const earliest = new Date(today);
  earliest.setDate(earliest.getDate() - 365);
  if (day.getTime() < earliest.getTime()) {
    throw new AppError('Order date cannot be more than 365 days in the past', 400);
  }
  return day;
}

type QuotationDraftItem = {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
};

async function computeQuotationDraftTotals(
  customerId: string | undefined,
  items: QuotationDraftItem[] | undefined
) {
  const lineItems = (items || []).filter(
    (item): item is Required<Pick<QuotationDraftItem, 'productId'>> & QuotationDraftItem =>
      Boolean(item.productId)
  );
  if (!customerId || lineItems.length === 0) {
    return { subtotal: 0, taxAmount: 0, totalAmount: 0, vatRate: 0 };
  }
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: { id: true, vatStatus: true },
  });
  if (!customer) throw new AppError('Customer not found', 404);
  const vatRate = await getCustomerVatRate(customer);
  const gross = lineItems.reduce(
    (sum, item) =>
      sum +
      (item.quantity || 1) * (item.unitPrice || 0) * (1 - (item.discount || 0) / 100),
    0
  );
  const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);
  return { subtotal, taxAmount, totalAmount, vatRate };
}

function mapQuotationDraftItems(items: QuotationDraftItem[] | undefined) {
  return (items || [])
    .filter((item) => item.productId)
    .map((item) => ({
      productId: item.productId!,
      quantity: item.quantity || 1,
      unitPrice: roundMoney(item.unitPrice || 0),
      discount: item.discount || 0,
      totalPrice: roundMoney(
        (item.quantity || 1) * (item.unitPrice || 0) * (1 - (item.discount || 0) / 100)
      ),
    }));
}

function salesPersonLabel(order: {
  salesPerson?: PersonName | null;
  createdBy?: PersonName | null;
}) {
  const person = order.salesPerson || order.createdBy;
  if (!person) return 'Unassigned';
  return `${person.firstName} ${person.lastName}`.trim();
}

/** Alert managers who can confirm / adjust when a front-line sales officer places a PENDING order. */
async function notifyPendingSalesOrderForConfirm(opts: {
  order: {
    id: string;
    orderNumber: string;
    totalAmount: unknown;
    customer?: { name?: string | null } | null;
    salesPerson?: PersonName | null;
  };
  actorUserId: string;
  actorRoleName: string | null | undefined;
}) {
  if (!isSalesBookOwner(opts.actorRoleName)) return;

  const total = Number(opts.order.totalAmount).toLocaleString('en-KE');
  const salesperson = salesPersonLabel(opts.order);
  const customerName = opts.order.customer?.name || 'Customer';

  await NotificationService.notifyRolesExcept(
    [...SALES_TARGET_MANAGER_ROLES],
    'APPROVAL',
    `New sales order ${opts.order.orderNumber} pending confirm — ${salesperson}`,
    `${customerName} · Sales: ${salesperson} — KES ${total}. Confirm or adjust quantities in Sales.`,
    `/sales?orderId=${opts.order.id}`,
    opts.actorUserId
  );
}

/** Front-line officers may only touch orders in their own sales book. */
function assertSalesBookOrderAccess(
  roleName: string | null | undefined,
  userId: string,
  order: { salesPersonId: string | null; createdById: string }
) {
  if (!isSalesBookOwner(roleName)) return;
  const owns =
    order.salesPersonId === userId ||
    (!order.salesPersonId && order.createdById === userId);
  if (!owns) {
    throw new AppError('You can only access sales orders in your own book', 403);
  }
}

/**
 * Order-adjustment / cancel alerts go only to a real sales-book owner on the order —
 * never to admins on house sales (avoids noisy or cross-book alerts).
 */
async function resolveSalesOrderNotifyUserId(order: {
  salesPersonId: string | null;
  createdById: string;
}): Promise<string | null> {
  const candidates = [order.salesPersonId, order.createdById].filter(
    (id): id is string => !!id
  );
  for (const id of candidates) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: { select: { name: true } } },
    });
    if (user && isSalesBookOwner(user.role?.name)) return user.id;
  }
  return null;
}

router.get(
  '/stats',
  authorize('sales:read'),
  validate(salesStatsQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const bookOwnerId = isSalesBookOwner(req.user!.roleName) ? req.user!.id : undefined;
    const { date, salesPersonId, status, search } = getQuery<{
      date?: string;
      salesPersonId?: string;
      status?: string;
      search?: string;
    }>(req.query);
    const data = await SalesService.getStats(bookOwnerId, {
      date,
      salesPersonId: bookOwnerId ? undefined : salesPersonId,
      status,
      search,
    });
    res.json({ success: true, data });
  })
);

router.get(
  '/production-stats',
  authorize('production:read'),
  validate(productionListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { search, status } = getQuery<{ search?: string; status?: string }>(req.query);
    const data = await ProductionStatsService.getStats({ search, status });
    res.json({ success: true, data });
  })
);

// Sales Orders
router.get(
  '/orders',
  authorizeAny('sales:read', 'finance:read', 'finance:create', 'delivery:read', 'delivery:create'),
  validate(salesListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status, salesPersonId, date } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
      salesPersonId?: string;
      date?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where = await buildSalesOrdersWhere({
      status,
      salesPersonId,
      date,
      search,
      bookOwnerId: isSalesBookOwner(req.user!.roleName) ? req.user!.id : undefined,
      includeDate: true,
    });

    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({
        where,
        skip,
        take: limit,
        include: {
          customer: true,
          items: { include: { product: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
          deliveries: { select: { id: true, deliveryNo: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.salesOrder.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/sales-officers',
  authorizeAny('sales:read', 'sales:create'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const officers = await prisma.user.findMany({
      where: {
        companyId: requireTenantId(),
        deletedAt: null,
        status: 'ACTIVE',
        role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    res.json({
      success: true,
      data: officers.map((o) => ({
        id: o.id,
        name: `${o.firstName} ${o.lastName}`.trim(),
        email: o.email,
      })),
    });
  })
);

router.get(
  '/orders/:id',
  authorizeAny('sales:read', 'finance:read', 'finance:create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.salesOrder.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        customer: true,
        quotation: { select: { quotationNo: true, status: true } },
        items: { include: { product: true }, orderBy: { id: 'asc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        deliveries: { include: { vehicle: true, items: true }, orderBy: { createdAt: 'asc' } },
        productionOrders: { select: { id: true, orderNumber: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, deliveryNoteId: true } },
      },
    });
    if (!data) throw new AppError('Sales order not found', 404);
    assertSalesBookOrderAccess(req.user!.roleName, req.user!.id, data);
    res.json({ success: true, data });
  })
);

router.get(
  '/orders/:id/pdf',
  authorizeAny('sales:read', 'finance:read', 'finance:create'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const order = await ExportService.getSalesOrder(getParam(req.params.id));
    assertSalesBookOrderAccess(req.user!.roleName, req.user!.id, order);
    const pdf = await ExportService.generateSalesOrderPDF(order);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${order.orderNumber}.pdf"`);
    res.send(pdf);
  })
);

router.post(
  '/pos/checkout',
  authorizeAny('pos:create', 'pos:update'),
  validate(posCheckoutSchema),
  auditLog('sales', 'create', 'pos_checkout'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const result = await PosCheckoutService.checkout({
      customerId: req.body.customerId,
      items: req.body.items,
      notes: req.body.notes,
      userId: req.user!.id,
      roleName: req.user!.roleName,
    });
    res.status(201).json({
      success: true,
      data: result,
      message: `Sale ${result.order.orderNumber} completed — stock issued and invoice created.`,
    });
  })
);

router.post(
  '/orders',
  authorize('sales:create'),
  validate(createSalesOrderSchema),
  auditLog('sales', 'create', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const {
      customerId,
      quotationId,
      salesPersonId,
      orderDate,
      requiredDate,
      customerPoNumber,
      notes,
      items,
    } = req.body;
    const resolvedOrderDate = resolveSalesOrderDate(
      typeof orderDate === 'string' ? orderDate : undefined
    );
    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);
    const isSalesOfficer = isSalesPersonRole(req.user!.roleName);

    // Sales roles always own their orders.
    // Admins may assign a sales person, or leave blank to record the sale under themselves (accountability).
    let assignedSalesPersonId: string;
    let attributingToCreator = false;

    if (isSalesOfficer) {
      assignedSalesPersonId = req.user!.id;
    } else if (salesPersonId) {
      const officer = await prisma.user.findFirst({
        where: {
          id: salesPersonId,
          companyId: requireTenantId(),
          deletedAt: null,
          status: 'ACTIVE',
          role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
        },
        select: { id: true },
      });
      if (!officer) {
        throw new AppError('Selected sales person is not a valid sales role', 400);
      }
      assignedSalesPersonId = officer.id;
    } else {
      assignedSalesPersonId = req.user!.id;
      attributingToCreator = true;
    }

    const customer = await prisma.customer.findFirst({
      where: { id: customerId, isActive: true, deletedAt: null },
      select: { id: true, salesPersonId: true, name: true, vatStatus: true },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    const vatRate = await getCustomerVatRate(customer);

    if (attributingToCreator) {
      // House-account order: only unassigned customers (or already owned by this admin).
      if (customer.salesPersonId && customer.salesPersonId !== req.user!.id) {
        throw new AppError(
          'This customer is assigned to a sales person. Choose that sales person, or reassign the customer first.',
          400
        );
      }
    } else if (isSalesOfficer) {
      if (customer.salesPersonId !== assignedSalesPersonId) {
        throw new AppError('You can only sell to customers assigned to you.', 400);
      }
    } else if (customer.salesPersonId && customer.salesPersonId !== assignedSalesPersonId) {
      throw new AppError('Select a customer assigned to this sales person (or an unassigned customer).', 400);
    }

    // Keyed unit prices are VAT-inclusive for VAT customers — do not add VAT on top.
    const gross = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) => {
        const discount = item.discount || 0;
        return sum + item.quantity * item.unitPrice * (1 - discount / 100);
      },
      0
    );
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);

    await assertCreditLimit(customerId, totalAmount);

    const businessDate = requiredDate ? new Date(requiredDate) : resolvedOrderDate;

    const order = await prisma.$transaction(async (tx) => {
      await SalesOrderService.assertUniqueSalesOrder(tx, {
        customerId,
        businessDate,
        customerPoNumber,
        items,
      });

      // Only an admin explicitly choosing an officer claims a free customer.
      if (!isSalesOfficer && !attributingToCreator && salesPersonId && !customer.salesPersonId) {
        await tx.customer.update({
          where: { id: customerId },
          data: { salesPersonId: assignedSalesPersonId },
        });
      }

      const created = await tx.salesOrder.create({
        data: injectTenantData({
          orderNumber,
          customerId,
          quotationId,
          createdById: req.user!.id,
          salesPersonId: assignedSalesPersonId,
          orderDate: resolvedOrderDate,
          // Persist business/sale date so day filters and invoices use requiredDate.
          requiredDate: requiredDate ? new Date(requiredDate) : resolvedOrderDate,
          customerPoNumber: customerPoNumber || undefined,
          notes,
          subtotal,
          taxAmount,
          totalAmount,
          items: {
            create: items.map((item: { productId: string; quantity: number; unitPrice: number; discount?: number }) => ({
              ...item,
              unitPrice: roundMoney(item.unitPrice),
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

      await syncCustomerCreditUsed(customerId, tx);
      return created;
    });

    await notifyPendingSalesOrderForConfirm({
      order,
      actorUserId: req.user!.id,
      actorRoleName: req.user!.roleName,
    });

    res.status(201).json({ success: true, data: order });
  })
);

router.patch(
  '/orders/:id/assignment',
  authorize('sales:update'),
  validate(updateSalesOrderAssignmentSchema),
  auditLog('sales', 'update', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const orderId = getParam(req.params.id);
    const { salesPersonId, reason } = req.body as { salesPersonId: string | null; reason: string };

    if (isSalesPersonRole(req.user!.roleName)) {
      throw new AppError('Only managers can reassign sales orders to another salesperson', 403);
    }

    const existing = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        salesPersonId: true,
        createdById: true,
        customerId: true,
        orderDate: true,
        requiredDate: true,
      },
    });
    if (!existing) throw new AppError('Sales order not found', 404);
    assertSalesBookOrderAccess(req.user!.roleName, req.user!.id, existing);

    if (existing.status === 'CANCELLED') {
      throw new AppError('Cannot reassign a cancelled sales order', 400);
    }

    if (!isSalesOrderReassignableToday(existing)) {
      throw new AppError(
        'Sales person can only be reassigned on the order sale date (before midnight). Yesterday and older orders are locked.',
        400
      );
    }

    if (salesPersonId) {
      const officer = await prisma.user.findFirst({
        where: {
          id: salesPersonId,
          companyId: requireTenantId(),
          deletedAt: null,
          status: 'ACTIVE',
          role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
        },
        select: { id: true },
      });
      if (!officer) {
        throw new AppError('Selected sales person is not a valid sales role', 400);
      }
    }

    const prior = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { notes: true },
    });

    const refreshed = await prisma.salesOrder.update({
      where: { id: orderId },
      data: {
        salesPersonId,
        notes: prior?.notes
          ? `${prior.notes}\n[Reassigned] ${reason}`
          : `[Reassigned] ${reason}`,
      },
      include: {
        customer: true,
        items: { include: { product: true } },
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        deliveries: { select: { id: true, deliveryNo: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
      },
    });

    const notifyUserId = salesPersonId
      ? await resolveSalesOrderNotifyUserId({
          salesPersonId,
          createdById: existing.createdById,
        })
      : null;
    if (notifyUserId && notifyUserId !== req.user!.id) {
      await NotificationService.notifyUser(
        notifyUserId,
        'SYSTEM',
        `Sales order ${existing.orderNumber} assigned to you`,
        reason,
        '/sales'
      );
    }

    res.json({ success: true, data: refreshed });
  })
);

router.patch(
  '/orders/:id/items',
  authorize('sales:update'),
  validate(updateSalesOrderItemsSchema),
  auditLog('sales', 'update', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const orderId = getParam(req.params.id);
    const { items, adjustmentReason, notes } = req.body;

    const existing = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderNumber: true, salesPersonId: true, createdById: true },
    });
    if (!existing) throw new AppError('Sales order not found', 404);
    assertSalesBookOrderAccess(req.user!.roleName, req.user!.id, existing);

    const isSalesOfficer = isSalesPersonRole(req.user!.roleName);
    if (isSalesOfficer && existing.status !== 'PENDING') {
      throw new AppError(
        'Only administrators can adjust confirmed orders. Contact your manager to revise quantities.',
        403
      );
    }

    const order = await prisma.$transaction(async (tx) => {
      const updated = await SalesOrderService.updateOrderItems(
        tx,
        orderId,
        items,
        adjustmentReason,
        req.user!.id
      );
      if (notes?.trim()) {
        return tx.salesOrder.update({
          where: { id: orderId },
          data: { notes: updated.notes ? `${updated.notes}\n${notes.trim()}` : notes.trim() },
          include: {
            customer: true,
            items: { include: { product: true } },
            salesPerson: { select: { id: true, firstName: true, lastName: true } },
            createdBy: { select: { firstName: true, lastName: true } },
            deliveries: { select: { id: true, deliveryNo: true, status: true } },
            invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
          },
        });
      }
      return tx.salesOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          customer: true,
          items: { include: { product: true } },
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          deliveries: { select: { id: true, deliveryNo: true, status: true } },
          invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
        },
      });
    });

    const notifyUserId = await resolveSalesOrderNotifyUserId({
      salesPersonId: order.salesPersonId,
      createdById: existing.createdById,
    });
    if (notifyUserId && notifyUserId !== req.user!.id) {
      await NotificationService.notifyUser(
        notifyUserId,
        'SYSTEM',
        `Sales order ${order.orderNumber} adjusted`,
        `${adjustmentReason}. Open the order to see updated quantities and totals.`,
        `/sales?orderId=${orderId}`
      );
    }

    res.json({ success: true, data: order });
  })
);

router.patch(
  '/orders/:id/status',
  authorize('sales:update'),
  auditLog('sales', 'update', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { status } = req.body;
    const orderId = getParam(req.params.id);
    const existing = await prisma.salesOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, customer: true },
    });
    if (!existing) throw new AppError('Sales order not found', 404);
    assertSalesBookOrderAccess(req.user!.roleName, req.user!.id, existing);

    const isConfirm = status === 'CONFIRMED' && existing.status === 'PENDING';
    if (!isConfirm) {
      assertOrderStatusTransition(existing.status, status);
    }

    if (status === 'IN_PRODUCTION') {
      throw new AppError(
        'Production is managed independently by the production team. Finished goods are recorded when production completes.',
        400
      );
    }

    if (isSalesPersonRole(req.user!.roleName) && status === 'READY') {
      throw new AppError(
        'Only an administrator can mark orders ready for invoicing and delivery.',
        403
      );
    }

    if (status === 'CANCELLED') {
      if (isSalesPersonRole(req.user!.roleName) && !['PENDING', 'CONFIRMED'].includes(existing.status)) {
        throw new AppError(
          'Only administrators can cancel orders after they are marked ready for delivery.',
          403
        );
      }
    }

    const order = await prisma.$transaction(async (tx) => {
      if (status === 'CANCELLED') {
        const deliveryCount = await tx.deliveryNote.count({ where: { salesOrderId: orderId } });
        if (deliveryCount > 0) {
          throw new AppError('Cannot cancel — a delivery has already been created for this order.', 400);
        }
        if (existing.items.some((item) => item.deliveredQty > 0)) {
          throw new AppError('Cannot cancel — goods have already been dispatched.', 400);
        }
      }

      let finalStatus = status;
      let confirmShortages: StockShortage[] = [];

      if (isConfirm) {
        const stockCheck = await SalesOrderService.checkStockAvailability(tx, existing.items);

        if (stockCheck.canFulfill) {
          for (const item of existing.items) {
            await StockMovementService.reserveProductStock(tx, {
              productId: item.productId,
              quantity: item.quantity,
            });
          }
          assertOrderStatusTransition(existing.status, 'READY', { system: true });
          finalStatus = 'READY';
        } else {
          assertOrderStatusTransition(existing.status, 'CONFIRMED');
          finalStatus = 'CONFIRMED';
          confirmShortages = stockCheck.shortages;
        }
      } else if (finalStatus === 'READY' && existing.status === 'CONFIRMED') {
        const stockCheck = await SalesOrderService.checkStockAvailability(tx, existing.items);
        if (!stockCheck.canFulfill) {
          const summary = stockCheck.shortages
            .slice(0, 5)
            .map((s) => `${s.productName}: need ${s.required}, have ${s.available}`)
            .join('; ');
          const more =
            stockCheck.shortages.length > 5
              ? ` (+${stockCheck.shortages.length - 5} more)`
              : '';
          throw new AppError(
            `Cannot mark order ready — not enough finished goods for: ${summary}${more}.`,
            400
          );
        }
        for (const item of existing.items) {
          await StockMovementService.reserveProductStock(tx, {
            productId: item.productId,
            quantity: item.quantity,
          });
        }
        assertOrderStatusTransition(existing.status, 'READY');
      }

      if (finalStatus === 'READY' && existing.status === 'IN_PRODUCTION') {
        for (const item of existing.items) {
          await StockMovementService.reserveProductStock(tx, {
            productId: item.productId,
            quantity: item.quantity,
          });
        }
        assertOrderStatusTransition(existing.status, 'READY', { system: true });
      }

      if (status === 'CANCELLED' && ['CONFIRMED', 'IN_PRODUCTION', 'READY'].includes(existing.status)) {
        await StockMovementService.releaseSalesOrderReservations(tx, existing.id, existing.items);
      }

      const updated = await tx.salesOrder.update({
        where: { id: orderId },
        data: { status: finalStatus },
        include: {
          customer: true,
          items: { include: { product: true } },
          salesPerson: { select: { firstName: true, lastName: true } },
          createdBy: { select: { firstName: true, lastName: true } },
        },
      });

      await syncCustomerCreditUsed(existing.customerId, tx);
      return { order: updated, confirmShortages };
    });

    if (order.order.status === 'READY' && existing.status !== 'READY') {
      const total = Number(order.order.totalAmount).toLocaleString('en-KE');
      const salesOrderLink = `/sales?orderId=${order.order.id}`;
      const salesperson = salesPersonLabel(order.order);
      await NotificationService.notifyAdmins(
        'APPROVAL',
        `Sales order ${order.order.orderNumber} ready — ${salesperson}`,
        `${order.order.customer.name} · Sales: ${salesperson} — KES ${total}. Assign delivery — invoice is created automatically when goods are dispatched.`,
        salesOrderLink
      );
      await NotificationService.notifyRole(
        'Finance Officer',
        'APPROVAL',
        `Sales order ${order.order.orderNumber} ready — ${salesperson}`,
        `${order.order.customer.name} · Sales: ${salesperson} — KES ${total}. Assign delivery — invoice is created automatically when goods are dispatched.`,
        salesOrderLink
      );
    } else if (isConfirm && order.order.status === 'CONFIRMED') {
      const total = Number(order.order.totalAmount).toLocaleString('en-KE');
      const salesperson = salesPersonLabel(order.order);
      const shortageSummary = order.confirmShortages
        .slice(0, 3)
        .map((s) => `${s.productName} (need ${s.required}, have ${s.available})`)
        .join('; ');
      await NotificationService.notifyRole(
        'Production Manager',
        'LOW_STOCK',
        `Finished goods needed for ${order.order.orderNumber} — ${salesperson}`,
        `Sales: ${salesperson}. Order requires: ${shortageSummary}. Continue independent production to replenish finished goods stock.`,
        '/production'
      );
      await NotificationService.notifyAdmins(
        'APPROVAL',
        `Sales order ${order.order.orderNumber} awaiting stock — ${salesperson}`,
        `${order.order.customer.name} · Sales: ${salesperson} — KES ${total}. Out of stock: ${shortageSummary}. Mark ready in Sales when finished goods are available.`,
        `/sales?orderId=${order.order.id}`
      );
    } else if (status === 'CANCELLED') {
      const notifyUserId = await resolveSalesOrderNotifyUserId({
        salesPersonId: order.order.salesPersonId,
        createdById: existing.createdById,
      });
      if (notifyUserId && notifyUserId !== req.user!.id) {
        await NotificationService.notifyUser(
          notifyUserId,
          'SYSTEM',
          `Sales order ${order.order.orderNumber} cancelled`,
          'This order was cancelled. Open Sales for details.',
          `/sales?orderId=${orderId}`
        );
      }
    }

    res.json({
      success: true,
      data: order.order,
      fulfillment: isConfirm
        ? {
            type: order.order.status === 'READY' ? 'stock' : 'awaiting_stock',
            shortages: order.confirmShortages,
          }
        : undefined,
    });
  })
);

router.post(
  '/orders/:id/generate-production',
  authorize('sales:update'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    throw new AppError(
      'Production is managed independently in the Production module. Sales orders no longer generate production orders.',
      410
    );
  })
);

// Quotations
router.get(
  '/quotations',
  authorize('sales:read'),
  validate(salesListQuerySchema, 'query'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { page, limit, search, status } = getQuery<{
      page: number;
      limit: number;
      search?: string;
      status?: string;
    }>(req.query);
    const skip = (page - 1) * limit;

    const where: Prisma.SalesQuotationWhereInput = {};
    if (status) where.status = status as Prisma.EnumApprovalStatusFilter['equals'];
    if (isSalesBookOwner(req.user!.roleName)) {
      where.customer = { salesPersonId: req.user!.id };
    }
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { quotationNo: { contains: search } },
            { customer: { name: { contains: search } } },
          ],
        },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.salesQuotation.findMany({
        where,
        skip,
        take: limit,
        include: { customer: true, items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.salesQuotation.count({ where }),
    ]);

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  })
);

router.get(
  '/quotations/:id',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.salesQuotation.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        customer: true,
        items: { include: { product: true } },
        salesOrders: { select: { id: true, orderNumber: true, status: true } },
      },
    });
    if (!data) throw new AppError('Quotation not found', 404);
    res.json({ success: true, data });
  })
);

router.get(
  '/quotations/:id/pdf',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { ExportService } = await import('../services/export.service');
    const quotation = await ExportService.getSalesQuotation(getParam(req.params.id));
    const pdf = await ExportService.generateQuotationPDF(quotation);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${quotation.quotationNo}.pdf"`);
    res.send(pdf);
  })
);

router.post(
  '/quotations/draft',
  authorize('sales:create'),
  validate(saveQuotationDraftSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { customerId, validUntil, notes, items } = req.body as {
      customerId?: string;
      validUntil?: string;
      notes?: string;
      items?: QuotationDraftItem[];
    };

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          deletedAt: null,
          ...(isSalesBookOwner(req.user!.roleName)
            ? { salesPersonId: req.user!.id }
            : {}),
        },
        select: { id: true },
      });
      if (!customer) throw new AppError('Customer not found', 404);
    }

    const totals = await computeQuotationDraftTotals(customerId, items);
    const count = await prisma.salesQuotation.count();
    const quotationNo = generateNumber('QT', count + 1);
    const mappedItems = mapQuotationDraftItems(items);

    const quotation = await prisma.salesQuotation.create({
      data: injectTenantData({
        quotationNo,
        customerId: customerId || null,
        validUntil: validUntil ? new Date(validUntil) : undefined,
        notes,
        status: 'DRAFT',
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        createdById: req.user!.id,
        ...(mappedItems.length > 0
          ? { items: { create: mappedItems } }
          : {}),
      }),
      include: { customer: true, items: { include: { product: true } } },
    });

    res.status(201).json({ success: true, data: quotation });
  })
);

router.patch(
  '/quotations/:id/draft',
  authorize('sales:create'),
  validate(saveQuotationDraftSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const existing = await prisma.salesQuotation.findUnique({
      where: { id },
      include: { salesOrders: { select: { id: true } } },
    });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') {
      throw new AppError('Only draft quotations can be updated this way', 400);
    }
    if (existing.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted', 400);
    }

    const { customerId, validUntil, notes, items } = req.body as {
      customerId?: string;
      validUntil?: string;
      notes?: string;
      items?: QuotationDraftItem[];
    };

    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: {
          id: customerId,
          deletedAt: null,
          ...(isSalesBookOwner(req.user!.roleName)
            ? { salesPersonId: req.user!.id }
            : {}),
        },
        select: { id: true },
      });
      if (!customer) throw new AppError('Customer not found', 404);
    }

    const totals = await computeQuotationDraftTotals(customerId, items);
    const mappedItems = mapQuotationDraftItems(items);

    const quotation = await prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.salesQuotation.update({
        where: { id },
        data: {
          customerId: customerId ?? null,
          validUntil: validUntil ? new Date(validUntil) : null,
          notes,
          subtotal: totals.subtotal,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          ...(mappedItems.length > 0
            ? { items: { create: mappedItems } }
            : {}),
        },
        include: { customer: true, items: { include: { product: true } } },
      });
    });

    res.json({ success: true, data: quotation });
  })
);

router.delete(
  '/quotations/:id/draft',
  authorize('sales:create'),
  auditLog('sales', 'delete', 'sales_quotation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const existing = await prisma.salesQuotation.findUnique({
      where: { id },
      include: { salesOrders: { select: { id: true } } },
    });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') {
      throw new AppError('Only draft quotations can be discarded', 400);
    }
    if (existing.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted', 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      await tx.salesQuotation.delete({ where: { id } });
    });

    res.json({ success: true });
  })
);

router.post(
  '/quotations/:id/finalize',
  authorize('sales:create'),
  validate(createQuotationSchema),
  auditLog('sales', 'create', 'sales_quotation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const existing = await prisma.salesQuotation.findUnique({
      where: { id },
      include: { salesOrders: { select: { id: true } } },
    });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') {
      throw new AppError('Only draft quotations can be finalized', 400);
    }
    if (existing.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted', 400);
    }

    const { customerId, validUntil, notes, items } = req.body;
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        deletedAt: null,
        ...(isSalesBookOwner(req.user!.roleName)
          ? { salesPersonId: req.user!.id }
          : {}),
      },
      select: { id: true, vatStatus: true },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    const vatRate = await getCustomerVatRate(customer);

    const gross = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) =>
        sum + item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
      0
    );
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);
    const mappedItems = items.map(
      (item: { productId: string; quantity: number; unitPrice: number; discount?: number }) => ({
        ...item,
        unitPrice: roundMoney(item.unitPrice),
        totalPrice: roundMoney(
          item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100)
        ),
      })
    );

    const quotation = await prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.salesQuotation.update({
        where: { id },
        data: {
          customerId,
          validUntil: validUntil ? new Date(validUntil) : null,
          notes,
          subtotal,
          taxAmount,
          totalAmount,
          status: 'PENDING',
          createdById: existing.createdById ?? req.user!.id,
          items: { create: mappedItems },
        },
        include: { customer: true, items: { include: { product: true } } },
      });
    });

    res.json({ success: true, data: quotation });
  })
);

router.patch(
  '/quotations/:id',
  authorizeAny('sales:create', 'sales:update'),
  validate(createQuotationSchema),
  auditLog('sales', 'update', 'sales_quotation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = getParam(req.params.id);
    const existing = await prisma.salesQuotation.findUnique({
      where: { id },
      include: { salesOrders: { select: { id: true } } },
    });
    if (!existing) throw new AppError('Quotation not found', 404);
    if (existing.status === 'DRAFT') {
      throw new AppError('Use the draft endpoint to update draft quotations', 400);
    }
    if (!['PENDING', 'APPROVED'].includes(existing.status)) {
      throw new AppError('This quotation cannot be edited', 400);
    }
    if (existing.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted to a sales order', 400);
    }

    const { customerId, validUntil, notes, items } = req.body;
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        deletedAt: null,
        ...(isSalesBookOwner(req.user!.roleName)
          ? { salesPersonId: req.user!.id }
          : {}),
      },
      select: { id: true, vatStatus: true },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    const vatRate = await getCustomerVatRate(customer);

    const gross = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) =>
        sum + item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
      0
    );
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);
    const mappedItems = items.map(
      (item: { productId: string; quantity: number; unitPrice: number; discount?: number }) => ({
        ...item,
        unitPrice: roundMoney(item.unitPrice),
        totalPrice: roundMoney(
          item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100)
        ),
      })
    );

    const quotation = await prisma.$transaction(async (tx) => {
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.salesQuotation.update({
        where: { id },
        data: {
          customerId,
          validUntil: validUntil ? new Date(validUntil) : null,
          notes,
          subtotal,
          taxAmount,
          totalAmount,
          status: existing.status,
          items: { create: mappedItems },
        },
        include: { customer: true, items: { include: { product: true } } },
      });
    });

    res.json({ success: true, data: quotation });
  })
);

router.post(
  '/quotations',
  authorize('sales:create'),
  validate(createQuotationSchema),
  auditLog('sales', 'create', 'sales_quotation'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { customerId, validUntil, notes, items } = req.body;
    const count = await prisma.salesQuotation.count();
    const quotationNo = generateNumber('QT', count + 1);
    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        deletedAt: null,
        ...(isSalesBookOwner(req.user!.roleName)
          ? { salesPersonId: req.user!.id }
          : {}),
      },
      select: { id: true, vatStatus: true },
    });
    if (!customer) throw new AppError('Customer not found', 404);
    const vatRate = await getCustomerVatRate(customer);

    // Keyed unit prices are VAT-inclusive for VAT customers — do not add VAT on top.
    const gross = items.reduce(
      (sum: number, item: { quantity: number; unitPrice: number; discount?: number }) =>
        sum + item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100),
      0
    );
    const { subtotal, taxAmount, totalAmount } = splitInclusiveAmount(gross, vatRate);

    const quotation = await prisma.salesQuotation.create({
      data: injectTenantData({
        quotationNo,
        customerId,
        validUntil: validUntil ? new Date(validUntil) : undefined,
        notes,
        status: 'PENDING',
        subtotal,
        taxAmount,
        totalAmount,
        createdById: req.user!.id,
        items: {
          create: items.map((item: { productId: string; quantity: number; unitPrice: number; discount?: number }) => ({
            ...item,
            unitPrice: roundMoney(item.unitPrice),
            totalPrice: roundMoney(
              item.quantity * item.unitPrice * (1 - (item.discount || 0) / 100)
            ),
          })),
        },
      }),
      include: { customer: true, items: { include: { product: true } } },
    });

    res.status(201).json({ success: true, data: quotation });
  })
);

router.post(
  '/quotations/:id/convert',
  authorize('sales:create'),
  auditLog('sales', 'create', 'sales_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const quotation = await prisma.salesQuotation.findUnique({
      where: { id: getParam(req.params.id) },
      include: { items: true, salesOrders: { select: { id: true } } },
    });
    if (!quotation) throw new AppError('Quotation not found', 404);
    if (quotation.status === 'REJECTED' || quotation.status === 'CANCELLED') {
      throw new AppError('Quotation cannot be converted', 400);
    }
    if (quotation.salesOrders.length > 0) {
      throw new AppError('Quotation has already been converted', 400);
    }

    if (quotation.status === 'DRAFT') {
      throw new AppError('Complete the quotation before converting it to a sales order', 400);
    }
    if (!quotation.customerId) {
      throw new AppError('Quotation must have a customer before conversion', 400);
    }
    const quotationCustomerId = quotation.customerId;

    await assertCreditLimit(quotationCustomerId, Number(quotation.totalAmount));

    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);
    // Always attribute to the account that converted — never leave unassigned.
    const assignedSalesPersonId = req.user!.id;

    const order = await prisma.$transaction(async (tx) => {
      await SalesOrderService.assertUniqueSalesOrder(tx, {
        customerId: quotationCustomerId,
        businessDate: new Date(),
        items: quotation.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount || 0),
        })),
      });

      const so = await tx.salesOrder.create({
        data: injectTenantData({
          orderNumber,
          customerId: quotationCustomerId,
          quotationId: quotation.id,
          createdById: req.user!.id,
          salesPersonId: assignedSalesPersonId,
          subtotal: quotation.subtotal,
          taxAmount: quotation.taxAmount,
          totalAmount: quotation.totalAmount,
          items: {
            create: quotation.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              totalPrice: item.totalPrice,
            })),
          },
        }),
        include: {
          customer: true,
          items: { include: { product: true } },
          salesPerson: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      await tx.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: 'APPROVED' },
      });

      await syncCustomerCreditUsed(quotationCustomerId, tx);
      return so;
    });

    await notifyPendingSalesOrderForConfirm({
      order,
      actorUserId: req.user!.id,
      actorRoleName: req.user!.roleName,
    });

    res.status(201).json({ success: true, data: order });
  })
);

router.get(
  '/machines',
  authorize('production:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await prisma.machine.findMany({ where: { isActive: true } });
    res.json({ success: true, data });
  })
);

// Production Orders
const listProductionOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page, limit, search, status } = getQuery<{
    page: number;
    limit: number;
    search?: string;
    status?: string;
  }>(req.query);
  const skip = (page - 1) * limit;

  const where: Prisma.ProductionOrderWhereInput = {};
  if (search) {
    where.OR = [
      { orderNumber: { contains: search } },
      { product: { name: { contains: search } } },
    ];
  }
  if (status) {
    where.status = status as Prisma.EnumProductionStatusFilter['equals'];
  }

  const [data, total] = await Promise.all([
    prisma.productionOrder.findMany({
      where,
      skip,
      take: limit,
      include: {
        product: true,
        machine: true,
        assignedTo: { select: { firstName: true, lastName: true } },
        consumption: { include: { rawMaterial: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.productionOrder.count({ where }),
  ]);

  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

router.get(
  '/production',
  authorize('production:read'),
  validate(productionListQuerySchema, 'query'),
  listProductionOrders
);
/** Compatibility alias — some clients probe /work-orders. */
router.get(
  '/work-orders',
  authorize('production:read'),
  validate(productionListQuerySchema, 'query'),
  listProductionOrders
);

router.post(
  '/production',
  authorize('production:create'),
  validate(createProductionOrderSchema),
  auditLog('production', 'create', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { productId, salesOrderId, machineId, quantity, priority, scheduledStart, scheduledEnd, notes } = req.body;
    const count = await prisma.productionOrder.count();
    const orderNumber = generateNumber('PRO', count + 1);

    const productionOrder = await prisma.$transaction(async (tx) => {
      const created = await tx.productionOrder.create({
        data: injectTenantData({
          orderNumber,
          productId,
          salesOrderId,
          machineId,
          assignedToId: req.user!.id,
          quantity,
          priority,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : undefined,
          notes,
        }),
        include: {
          product: true,
          consumption: { include: { rawMaterial: true } },
        },
      });

      await ProductionService.attachBomConsumption(tx, created.id, productId, quantity);

      if (salesOrderId) {
        await SalesOrderService.maybeSetInProduction(tx, salesOrderId);
      }

      return tx.productionOrder.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          product: true,
          consumption: { include: { rawMaterial: true } },
        },
      });
    });

    res.status(201).json({ success: true, data: productionOrder });
  })
);

router.get(
  '/production/:id',
  authorize('production:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const data = await prisma.productionOrder.findFirst({
      where: { id: getParam(req.params.id), companyId: requireTenantId() },
      include: {
        product: true,
        machine: true,
        salesOrder: { select: { id: true, orderNumber: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
        consumption: { include: { rawMaterial: true } },
        batches: true,
      },
    });
    if (!data) throw new AppError('Production order not found', 404);
    res.json({ success: true, data });
  })
);

router.post(
  '/production/:id/start',
  authorize('production:update'),
  auditLog('production', 'update', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const order = await prisma.productionOrder.findUnique({
      where: { id: getParam(req.params.id) },
    });
    if (!order) throw new AppError('Production order not found', 404);

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.productionOrder.update({
        where: { id: order.id },
        data: { status: 'IN_PROGRESS', actualStart: new Date() },
      });

      const existingQc = await tx.qualityInspection.findFirst({
        where: { productionOrderId: order.id },
      });
      if (!existingQc) {
        await tx.qualityInspection.create({
          data: {
            companyId: order.companyId,
            inspectionNo: await nextQualityInspectionNumber(tx),
            type: 'production',
            productionOrderId: order.id,
            inspectorId: req.user!.id,
            status: 'PENDING',
          },
        });
      }

      if (order.salesOrderId) {
        await SalesOrderService.maybeSetInProduction(tx, order.salesOrderId);
      }

      return updated;
    });

    res.json({ success: true, data: result });
  })
);

router.post(
  '/production/:id/complete',
  authorize('production:update'),
  validate(completeProductionSchema),
  auditLog('production', 'update', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { completedQty, rejectedQty, warehouseId, consumption } = req.body;

    const order = await prisma.productionOrder.findUnique({
      where: { id: getParam(req.params.id) },
      include: {
        consumption: { include: { rawMaterial: true } },
        product: true,
      },
    });

    if (!order) throw new AppError('Production order not found', 404);
    if (order.status !== 'IN_PROGRESS') {
      throw new AppError('Start production before completing it', 400);
    }

    const passedInspection = await QualityService.findPassedProductionInspection(prisma, {
      id: order.id,
      productId: order.productId,
      actualStart: order.actualStart,
    });
    if (!passedInspection) {
      throw new AppError(
        'A passed quality inspection is required before completing production. Link an inspection to this order, or pass a product inspection for surplus stock.',
        400
      );
    }

    const result = await prisma.$transaction(async (tx) =>
      ProductionService.completeProduction(tx, order, {
        completedQty,
        rejectedQty,
        warehouseId,
        consumptionOverrides: consumption,
        userId: req.user!.id,
      })
    );

    res.json({ success: true, data: result });
  })
);

router.post(
  '/production/:id/cancel',
  authorize('production:update'),
  validate(cancelProductionOrderSchema),
  auditLog('production', 'update', 'production_order'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { reason } = req.body as { reason?: string };
    const result = await prisma.$transaction(async (tx) =>
      ProductionService.cancelProductionOrder(tx, getParam(req.params.id), { reason })
    );
    res.json({ success: true, data: result });
  })
);

export default router;
