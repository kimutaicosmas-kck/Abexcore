import { Router, Response } from 'express';
import { authenticate, authorize, authorizeAny, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { auditLog } from '../middleware/auditLog';
import {
  createSalesOrderSchema,
  updateSalesOrderItemsSchema,
  createProductionOrderSchema,
  completeProductionSchema,
  createQuotationSchema,
  salesListQuerySchema,
  paginationSchema,
  productionListQuerySchema,
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
import { AccountingService } from '../services/accounting.service';
import { salesPersonOrderFilter } from '../services/my-sales.service';
import { NotificationService } from '../services/notification.service';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import {
  isSalesBookOwner,
  isSalesPersonRole,
  SALES_PERSON_ROLE_NAMES,
} from '../config/rolePermissions';
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

function salesPersonLabel(order: {
  salesPerson?: PersonName | null;
  createdBy?: PersonName | null;
}) {
  const person = order.salesPerson || order.createdBy;
  if (!person) return 'Unassigned';
  return `${person.firstName} ${person.lastName}`.trim();
}

router.get(
  '/stats',
  authorize('sales:read'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const scopedId = isSalesBookOwner(req.user!.roleName) ? req.user!.id : undefined;
    const data = await SalesService.getStats(scopedId);
    res.json({ success: true, data });
  })
);

router.get(
  '/production-stats',
  authorize('production:read'),
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    const data = await ProductionStatsService.getStats();
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

    const where: Prisma.SalesOrderWhereInput = {};
    if (status) where.status = status as Prisma.EnumOrderStatusFilter['equals'];

    if (isSalesBookOwner(req.user!.roleName)) {
      Object.assign(where, salesPersonOrderFilter(req.user!.id));
    } else if (salesPersonId) {
      Object.assign(where, salesPersonOrderFilter(salesPersonId));
    }

    if (date) {
      const range = dayRangeFromInput(date);
      // Filter by required (sale) date; fall back to orderDate when requiredDate is unset.
      if (range) {
        const { salesOrderInDateRange } = await import('../utils/salesDate');
        where.AND = [
          ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
          salesOrderInDateRange(range),
        ];
      }
    }

    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { orderNumber: { contains: search } },
            { customer: { name: { contains: search } } },
            { customer: { code: { contains: search } } },
          ],
        },
      ];
    }

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
        items: { include: { product: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        salesPerson: { select: { id: true, firstName: true, lastName: true } },
        deliveries: { include: { vehicle: true } },
        productionOrders: { select: { id: true, orderNumber: true, status: true } },
        invoices: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true, deliveryNoteId: true } },
      },
    });
    if (!data) throw new AppError('Sales order not found', 404);
    res.json({ success: true, data });
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

    const order = await prisma.$transaction(async (tx) => {
      // Only an admin explicitly choosing an officer claims a free customer.
      // Sales officers may sell to unassigned customers without locking ownership.
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

    res.status(201).json({ success: true, data: order });
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

    const isSalesOfficer = isSalesPersonRole(req.user!.roleName);
    if (isSalesOfficer && existing.status !== 'PENDING') {
      throw new AppError(
        'Only administrators can adjust confirmed orders. Contact your manager to revise quantities.',
        403
      );
    }

    const order = await prisma.$transaction(async (tx) => {
      const updated = await SalesOrderService.updateOrderItems(tx, orderId, items, adjustmentReason);
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

    const notifyUserId = order?.salesPersonId || existing.createdById;
    if (notifyUserId && notifyUserId !== req.user!.id) {
      await NotificationService.notifyUser(
        notifyUserId,
        'SYSTEM',
        `Sales order ${order!.orderNumber} adjusted`,
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
            .slice(0, 3)
            .map((s) => `${s.productName} (need ${s.required}, have ${s.available})`)
            .join('; ');
          throw new AppError(`Insufficient finished goods stock: ${summary}`, 400);
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
      const notifyUserId = order.order.salesPersonId || existing.createdById;
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
    if (search) {
      where.OR = [
        { quotationNo: { contains: search } },
        { customer: { name: { contains: search } } },
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
      where: { id: customerId, deletedAt: null },
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

    await assertCreditLimit(quotation.customerId, Number(quotation.totalAmount));

    const count = await prisma.salesOrder.count();
    const orderNumber = generateNumber('SO', count + 1);
    // Always attribute to the account that converted — never leave unassigned.
    const assignedSalesPersonId = req.user!.id;

    const order = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.create({
        data: injectTenantData({
          orderNumber,
          customerId: quotation.customerId,
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

      await syncCustomerCreditUsed(quotation.customerId, tx);
      return so;
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

      if (salesOrderId) {
        await SalesOrderService.maybeSetInProduction(tx, salesOrderId);
      }

      return created;
    });

    res.status(201).json({ success: true, data: productionOrder });
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
    const { completedQty, rejectedQty, warehouseId } = req.body;

    const order = await prisma.productionOrder.findUnique({
      where: { id: getParam(req.params.id) },
      include: { consumption: true, product: true },
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

    const result = await prisma.$transaction(async (tx) => {
      const fgWarehouseId = await StockMovementService.getFinishedGoodsWarehouseId(tx);
      if (warehouseId && warehouseId !== fgWarehouseId) {
        throw new AppError('Production output must be posted to the finished goods warehouse', 400);
      }

      let rawMaterialsWarehouseId: string | null = null;
      try {
        rawMaterialsWarehouseId = await StockMovementService.getRawMaterialsWarehouseId(tx);
      } catch {
        rawMaterialsWarehouseId = null;
      }

      let totalMaterialCost = 0;

      for (const consumption of order.consumption) {
        const consumeWarehouseId = rawMaterialsWarehouseId ?? fgWarehouseId;
        const stockLevel = await tx.stockLevel.findFirst({
          where: { rawMaterialId: consumption.rawMaterialId, warehouseId: consumeWarehouseId },
        });

        if (stockLevel) {
          const consumeQty = Number(consumption.plannedQty);
          const unitCost = Number(stockLevel.unitCost);
          totalMaterialCost += consumeQty * unitCost;

          const newQty = Number(stockLevel.quantity) - consumeQty;
          if (newQty < 0) throw new AppError(`Insufficient ${consumption.rawMaterialId} stock`, 400);

          await tx.stockLevel.update({
            where: { id: stockLevel.id },
            data: { quantity: newQty },
          });

          await tx.inventoryTransaction.create({
            data: {
              warehouseId: consumeWarehouseId,
              type: 'PRODUCTION_CONSUMPTION',
              rawMaterialId: consumption.rawMaterialId,
              quantity: consumeQty,
              unitCost,
              referenceType: 'production_order',
              referenceId: order.id,
              createdById: req.user!.id,
            },
          });
        }
      }

      const batchNumber = generateNumber('BATCH', (await tx.productionBatch.count()) + 1);

      await tx.productionBatch.create({
        data: {
          productionOrderId: order.id,
          batchNumber,
          quantity: completedQty,
        },
      });

      const fgUnitCost =
        completedQty > 0
          ? totalMaterialCost / completedQty
          : Number(order.product.manufacturingCost);

      const fgStock = await tx.stockLevel.findFirst({
        where: { productId: order.productId, warehouseId: fgWarehouseId },
      });

      if (fgStock) {
        await tx.stockLevel.update({
          where: { id: fgStock.id },
          data: {
            quantity: { increment: completedQty },
            unitCost: fgUnitCost,
          },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            warehouseId: fgWarehouseId,
            productId: order.productId,
            batchNumber,
            quantity: completedQty,
            unitCost: fgUnitCost,
          },
        });
      }

      await tx.inventoryTransaction.create({
        data: {
          warehouseId: fgWarehouseId,
          type: 'PRODUCTION_OUTPUT',
          productId: order.productId,
          batchNumber,
          quantity: completedQty,
          unitCost: fgUnitCost,
          referenceType: 'production_order',
          referenceId: order.id,
          createdById: req.user!.id,
        },
      });

      await AccountingService.postProductionCosting(tx, {
        orderNumber: order.orderNumber,
        materialCost: totalMaterialCost,
        finishedGoodsCost: totalMaterialCost,
      });

      const productionResult = await tx.productionOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          actualEnd: new Date(),
          completedQty,
          rejectedQty: rejectedQty || 0,
        },
        include: { product: true, batches: true },
      });

      // When all linked production is done, advance the sales order so Delivery/Sales see READY.
      if (order.salesOrderId) {
        await SalesOrderService.maybeAdvanceToReady(tx, order.salesOrderId);
      }

      return productionResult;
    });

    res.json({ success: true, data: result });
  })
);

export default router;
