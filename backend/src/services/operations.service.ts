import prisma from '../config/database';
import { DeliveryStatus } from '@prisma/client';
import { endOfDay, startOfDay } from '../utils/date';
import { mergeTenantWhere, requireTenantId } from '../utils/tenant';
import { Prisma } from '@prisma/client';

export class QualityService {
  static async getStats(opts?: { search?: string; status?: string; type?: string }) {
    const companyId = requireTenantId();
    const base: Prisma.QualityInspectionWhereInput = { companyId };
    if (opts?.type) base.type = opts.type;
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      base.OR = [
        { inspectionNo: { contains: q } },
        { type: { contains: q } },
        { result: { contains: q } },
      ];
    }

    const statusOk = (bucket: string) => !opts?.status || opts.status === bucket;

    const [total, pending, passed, failed, conditional] = await Promise.all([
      prisma.qualityInspection.count({
        where: opts?.status ? { ...base, status: opts.status as Prisma.EnumQualityStatusFilter['equals'] } : base,
      }),
      statusOk('PENDING')
        ? prisma.qualityInspection.count({ where: { ...base, status: 'PENDING' } })
        : Promise.resolve(0),
      statusOk('PASSED')
        ? prisma.qualityInspection.count({ where: { ...base, status: 'PASSED' } })
        : Promise.resolve(0),
      statusOk('FAILED')
        ? prisma.qualityInspection.count({ where: { ...base, status: 'FAILED' } })
        : Promise.resolve(0),
      statusOk('CONDITIONAL')
        ? prisma.qualityInspection.count({ where: { ...base, status: 'CONDITIONAL' } })
        : Promise.resolve(0),
    ]);

    const inspected = passed + failed + conditional;
    return {
      total,
      pending,
      passed,
      failed,
      conditional,
      passRate: inspected > 0 ? Math.round((passed / inspected) * 100) : 0,
    };
  }

  /** Passed QC linked to the order, or standalone surplus-stock QC for the same product. */
  static findPassedProductionInspection(
    client: Prisma.TransactionClient | typeof prisma,
    order: { id: string; productId: string; actualStart: Date | null }
  ) {
    return client.qualityInspection.findFirst({
      where: {
        status: 'PASSED',
        OR: [
          { productionOrderId: order.id },
          {
            productionOrderId: null,
            productId: order.productId,
            type: { in: ['production', 'finished'] },
            ...(order.actualStart
              ? {
                  OR: [
                    { inspectedAt: { gte: order.actualStart } },
                    { inspectedAt: null, createdAt: { gte: order.actualStart } },
                  ],
                }
              : {}),
          },
        ],
      },
      orderBy: [{ inspectedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }
}

export class SalesService {
  static async getStats(
    bookOwnerId?: string,
    opts?: {
      date?: string;
      salesPersonId?: string;
      status?: string;
      search?: string;
    }
  ) {
    const { salesOrderInDateRange } = await import('../utils/salesDate');
    const { parseLocalDateInput, toLocalDateKey } = await import('../utils/date');
    const { sumInvoicedSales } = await import('../utils/finance-metrics');
    const { buildSalesOrdersWhere } = await import('../utils/sales-list-where');

    const scope = await buildSalesOrdersWhere({
      bookOwnerId,
      salesPersonId: bookOwnerId ? undefined : opts?.salesPersonId,
      status: opts?.status,
      search: opts?.search,
      includeDate: false,
    });
    const hasScope = Object.keys(scope).length > 0;
    const invoiceOrderWhere = hasScope ? scope : undefined;

    const focusDay = opts?.date ? parseLocalDateInput(opts.date) : null;
    const now = focusDay || new Date();
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const withScope = (...extra: Prisma.SalesOrderWhereInput[]): Prisma.SalesOrderWhereInput =>
      hasScope || extra.length > 0 ? { AND: [scope, ...extra] } : { AND: extra };

    const dayWhere = withScope(salesOrderInDateRange({ gte: dayStart, lte: dayEnd }));
    const monthWhere = withScope(salesOrderInDateRange({ gte: monthStart, lte: monthEnd }));
    const pendingWhere = opts?.status
      ? withScope()
      : withScope({ status: 'PENDING' });
    const successfulMonthWhere = opts?.status
      ? withScope(salesOrderInDateRange({ gte: monthStart, lte: monthEnd }))
      : withScope(
          { status: { in: ['COMPLETED', 'DELIVERED'] } },
          salesOrderInDateRange({ gte: monthStart, lte: monthEnd })
        );
    const allTimeWhere = withScope();
    const openWhere = opts?.status
      ? withScope()
      : withScope({ status: { notIn: ['COMPLETED', 'CANCELLED'] } });

    const quoteWhere = { status: { in: ['DRAFT', 'PENDING'] as ('DRAFT' | 'PENDING')[] } };
    const skipQuotes = !!(bookOwnerId || opts?.salesPersonId || opts?.status || opts?.search);

    const [
      todayOrders,
      pendingOrders,
      ordersThisMonth,
      successfulOrders,
      monthOrderAgg,
      allTimeOrderCount,
      openOrders,
      pipelineAgg,
      pendingQuotations,
      quoteAgg,
      todaySales,
      successfulMonthSales,
      allTimeSales,
      monthlyRevenue,
    ] = await Promise.all([
      prisma.salesOrder.count({ where: dayWhere }),
      prisma.salesOrder.count({ where: pendingWhere }),
      prisma.salesOrder.count({ where: monthWhere }),
      prisma.salesOrder.count({ where: successfulMonthWhere }),
      prisma.salesOrder.aggregate({ where: monthWhere, _sum: { totalAmount: true } }),
      prisma.salesOrder.count({ where: allTimeWhere }),
      prisma.salesOrder.count({ where: openWhere }),
      prisma.salesOrder.aggregate({ where: openWhere, _sum: { totalAmount: true } }),
      skipQuotes ? Promise.resolve(0) : prisma.salesQuotation.count({ where: quoteWhere }),
      skipQuotes
        ? Promise.resolve({ _sum: { totalAmount: null } })
        : prisma.salesQuotation.aggregate({ where: quoteWhere, _sum: { totalAmount: true } }),
      sumInvoicedSales({ from: dayStart, to: dayEnd, salesOrderWhere: invoiceOrderWhere }),
      sumInvoicedSales({ from: monthStart, to: monthEnd, salesOrderWhere: invoiceOrderWhere }),
      sumInvoicedSales({ salesOrderWhere: invoiceOrderWhere }),
      sumInvoicedSales({ from: monthStart, to: monthEnd, salesOrderWhere: invoiceOrderWhere }),
    ]);

    return {
      todayOrders,
      pendingOrders,
      ordersThisMonth,
      successfulOrders,
      successfulMonthSales,
      monthlyOrderValue: Number(monthOrderAgg._sum?.totalAmount || 0),
      allTimeOrders: allTimeOrderCount,
      allTimeSales,
      openOrders,
      pipelineValue: Number(pipelineAgg._sum?.totalAmount || 0),
      pendingQuotations,
      quotationValue: Number(quoteAgg._sum?.totalAmount || 0),
      monthlyRevenue,
      todaySales,
      focusDate: toLocalDateKey(now),
    };
  }
}

export class DeliveryService {
  static async getStats(opts?: { search?: string; date?: string; status?: string }) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const { dayRangeFromInput } = await import('../utils/date');

    const scope: Prisma.DeliveryNoteWhereInput = {};
    if (opts?.status) {
      scope.status = opts.status as Prisma.EnumDeliveryStatusFilter['equals'];
    }
    if (opts?.date) {
      const range = dayRangeFromInput(opts.date);
      if (range) {
        scope.AND = [
          {
            OR: [
              { scheduledDate: range },
              { AND: [{ scheduledDate: null }, { createdAt: range }] },
              { deliveredAt: range },
            ],
          },
        ];
      }
    }
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      scope.OR = [
        { deliveryNo: { contains: q } },
        { salesOrder: { orderNumber: { contains: q } } },
        { salesOrder: { customer: { name: { contains: q } } } },
      ];
    }

    const statusOk = (bucket: string | string[]) => {
      if (!opts?.status) return true;
      return Array.isArray(bucket) ? bucket.includes(opts.status) : opts.status === bucket;
    };

    const [pending, inTransit, deliveredToday, deliveredMonth, activeVehicles, motorcycles, trucks, lorries] =
      await Promise.all([
        statusOk(['PENDING', 'ASSIGNED'])
          ? prisma.deliveryNote.count({
              where: mergeTenantWhere({
                ...scope,
                status: opts?.status
                  ? (opts.status as Prisma.EnumDeliveryStatusFilter['equals'])
                  : { in: ['PENDING', 'ASSIGNED'] as DeliveryStatus[] },
              }),
            })
          : Promise.resolve(0),
        statusOk('IN_TRANSIT')
          ? prisma.deliveryNote.count({
              where: mergeTenantWhere({ ...scope, status: 'IN_TRANSIT' as DeliveryStatus }),
            })
          : Promise.resolve(0),
        statusOk('DELIVERED')
          ? prisma.deliveryNote.count({
              where: mergeTenantWhere({
                ...scope,
                status: 'DELIVERED' as DeliveryStatus,
                deliveredAt: { gte: todayStart },
              }),
            })
          : Promise.resolve(0),
        statusOk('DELIVERED')
          ? prisma.deliveryNote.count({
              where: mergeTenantWhere({
                ...scope,
                status: 'DELIVERED' as DeliveryStatus,
                deliveredAt: { gte: monthStart },
              }),
            })
          : Promise.resolve(0),
        prisma.vehicle.count({ where: { isActive: true } }),
        prisma.vehicle.count({ where: { isActive: true, type: 'MOTORCYCLE' } }),
        prisma.vehicle.count({ where: { isActive: true, type: 'TRUCK' } }),
        prisma.vehicle.count({ where: { isActive: true, type: 'LORRY' } }),
      ]);

    return {
      pending,
      inTransit,
      deliveredToday,
      deliveredMonth,
      activeVehicles,
      motorcycles,
      trucks,
      lorries,
    };
  }
}

export class ProductionStatsService {
  static async getStats(opts?: { search?: string; status?: string }) {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const scope: Prisma.ProductionOrderWhereInput = {};
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      scope.OR = [
        { orderNumber: { contains: q } },
        { product: { name: { contains: q } } },
      ];
    }
    if (opts?.status) {
      scope.status = opts.status as Prisma.EnumProductionStatusFilter['equals'];
    }

    const statusOk = (bucket: string | string[]) => {
      if (!opts?.status) return true;
      return Array.isArray(bucket) ? bucket.includes(opts.status) : opts.status === bucket;
    };

    const [activeOrders, inProgress, scheduled, completedInPeriod, awaitingProduction] = await Promise.all([
      statusOk(['PLANNED', 'SCHEDULED', 'IN_PROGRESS'])
        ? prisma.productionOrder.count({
            where: {
              ...scope,
              status: opts?.status
                ? (opts.status as Prisma.EnumProductionStatusFilter['equals'])
                : { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] },
            },
          })
        : Promise.resolve(0),
      statusOk('IN_PROGRESS')
        ? prisma.productionOrder.count({ where: { ...scope, status: 'IN_PROGRESS' } })
        : Promise.resolve(0),
      statusOk('SCHEDULED')
        ? prisma.productionOrder.count({ where: { ...scope, status: 'SCHEDULED' } })
        : Promise.resolve(0),
      statusOk('COMPLETED')
        ? prisma.productionOrder.count({
            where: {
              ...scope,
              status: 'COMPLETED',
              actualEnd: { gte: monthStart },
            },
          })
        : Promise.resolve(0),
      // Awaiting production is sales-side; only respect search via order number/customer loosely — keep global when no status filter
      !opts?.status
        ? prisma.salesOrder.count({ where: { status: 'CONFIRMED' } })
        : Promise.resolve(0),
    ]);

    return {
      activeOrders,
      inProgress,
      scheduled,
      completedInPeriod,
      awaitingProduction,
    };
  }
}
