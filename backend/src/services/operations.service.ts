import prisma from '../config/database';
import { DeliveryStatus } from '@prisma/client';
import { endOfDay, startOfDay } from '../utils/date';
import { mergeTenantWhere, requireTenantId } from '../utils/tenant';
import { getMonthlySalesRevenue } from '../utils/finance-metrics';
import { salesPersonOrderFilter } from './my-sales.service';
import { Prisma } from '@prisma/client';

export class QualityService {
  static async getStats() {
    const companyId = requireTenantId();

    const [total, pending, passed, failed, conditional] = await Promise.all([
      prisma.qualityInspection.count({ where: { companyId } }),
      prisma.qualityInspection.count({ where: { companyId, status: 'PENDING' } }),
      prisma.qualityInspection.count({ where: { companyId, status: 'PASSED' } }),
      prisma.qualityInspection.count({ where: { companyId, status: 'FAILED' } }),
      prisma.qualityInspection.count({ where: { companyId, status: 'CONDITIONAL' } }),
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
    salesPersonId?: string,
    opts?: { date?: string }
  ) {
    const { salesOrderInDateRange } = await import('../utils/salesDate');
    const { parseLocalDateInput, toLocalDateKey } = await import('../utils/date');
    const personFilter = salesPersonId ? salesPersonOrderFilter(salesPersonId) : {};
    const openWhere: Prisma.SalesOrderWhereInput = {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      ...personFilter,
    };
    const quoteWhere = { status: { in: ['DRAFT', 'PENDING'] as ('DRAFT' | 'PENDING')[] } };

    const focusDay = opts?.date ? parseLocalDateInput(opts.date) : null;
    const now = focusDay || new Date();
    const monthStart = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const monthEnd = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const dayWhere: Prisma.SalesOrderWhereInput = {
      ...personFilter,
      AND: [salesOrderInDateRange({ gte: dayStart, lte: dayEnd })],
    };
    const monthWhere: Prisma.SalesOrderWhereInput = {
      ...personFilter,
      AND: [salesOrderInDateRange({ gte: monthStart, lte: monthEnd })],
    };
    const pendingWhere: Prisma.SalesOrderWhereInput = {
      ...personFilter,
      status: 'PENDING',
    };
    const successfulMonthWhere: Prisma.SalesOrderWhereInput = {
      ...personFilter,
      status: { in: ['COMPLETED', 'DELIVERED'] },
      AND: [salesOrderInDateRange({ gte: monthStart, lte: monthEnd })],
    };
    const allTimeWhere: Prisma.SalesOrderWhereInput = { ...personFilter };

    const [
      todayOrders,
      todayAgg,
      pendingOrders,
      ordersThisMonth,
      successfulOrders,
      successfulMonthAgg,
      monthOrderAgg,
      allTimeOrders,
      openOrders,
      pipelineAgg,
      pendingQuotations,
      quoteAgg,
      monthlyRevenue,
    ] = await Promise.all([
      prisma.salesOrder.count({ where: dayWhere }),
      prisma.salesOrder.aggregate({ where: dayWhere, _sum: { totalAmount: true } }),
      prisma.salesOrder.count({ where: pendingWhere }),
      prisma.salesOrder.count({ where: monthWhere }),
      prisma.salesOrder.count({ where: successfulMonthWhere }),
      prisma.salesOrder.aggregate({
        where: successfulMonthWhere,
        _sum: { totalAmount: true },
      }),
      prisma.salesOrder.aggregate({ where: monthWhere, _sum: { totalAmount: true } }),
      prisma.salesOrder.count({ where: allTimeWhere }),
      prisma.salesOrder.count({ where: openWhere }),
      prisma.salesOrder.aggregate({ where: openWhere, _sum: { totalAmount: true } }),
      salesPersonId ? Promise.resolve(0) : prisma.salesQuotation.count({ where: quoteWhere }),
      salesPersonId
        ? Promise.resolve({ _sum: { totalAmount: null } })
        : prisma.salesQuotation.aggregate({ where: quoteWhere, _sum: { totalAmount: true } }),
      salesPersonId
        ? prisma.invoice
            .aggregate({
              where: {
                type: 'SALES',
                status: { not: 'REFUNDED' },
                invoiceDate: { gte: monthStart, lte: monthEnd },
                salesOrder: salesPersonOrderFilter(salesPersonId),
              },
              _sum: { totalAmount: true },
            })
            .then((r) => Number(r._sum.totalAmount || 0))
        : getMonthlySalesRevenue(monthStart),
    ]);

    return {
      todayOrders,
      pendingOrders,
      ordersThisMonth,
      successfulOrders,
      successfulMonthSales: Number(successfulMonthAgg._sum?.totalAmount || 0),
      monthlyOrderValue: Number(monthOrderAgg._sum?.totalAmount || 0),
      allTimeOrders,
      openOrders,
      pipelineValue: Number(pipelineAgg._sum?.totalAmount || 0),
      pendingQuotations,
      quotationValue: Number(quoteAgg._sum?.totalAmount || 0),
      monthlyRevenue,
      todaySales: Number(todayAgg._sum?.totalAmount || 0),
      focusDate: toLocalDateKey(now),
    };
  }
}

export class DeliveryService {
  static async getStats() {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

    const [pending, inTransit, deliveredToday, deliveredMonth, activeVehicles, motorcycles, trucks, lorries] =
      await Promise.all([
        prisma.deliveryNote.count({
          where: mergeTenantWhere({ status: { in: ['PENDING', 'ASSIGNED'] as DeliveryStatus[] } }),
        }),
        prisma.deliveryNote.count({
          where: mergeTenantWhere({ status: 'IN_TRANSIT' as DeliveryStatus }),
        }),
        prisma.deliveryNote.count({
          where: mergeTenantWhere({
            status: 'DELIVERED' as DeliveryStatus,
            deliveredAt: { gte: todayStart },
          }),
        }),
        prisma.deliveryNote.count({
          where: mergeTenantWhere({
            status: 'DELIVERED' as DeliveryStatus,
            deliveredAt: { gte: monthStart },
          }),
        }),
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
  static async getStats() {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [activeOrders, inProgress, scheduled, completedInPeriod, awaitingProduction] = await Promise.all([
      prisma.productionOrder.count({
        where: { status: { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] } },
      }),
      prisma.productionOrder.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.productionOrder.count({ where: { status: 'SCHEDULED' } }),
      prisma.productionOrder.count({
        where: {
          status: 'COMPLETED',
          actualEnd: { gte: monthStart },
        },
      }),
      prisma.salesOrder.count({ where: { status: 'CONFIRMED' } }),
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
