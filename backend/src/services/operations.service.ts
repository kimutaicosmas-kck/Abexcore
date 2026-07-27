import prisma from '../config/database';
import { DeliveryStatus } from '@prisma/client';
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
  static async getStats(salesPersonId?: string) {
    const openWhere: Prisma.SalesOrderWhereInput = {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      ...(salesPersonId ? salesPersonOrderFilter(salesPersonId) : {}),
    };
    const quoteWhere = { status: { in: ['DRAFT', 'PENDING'] as ('DRAFT' | 'PENDING')[] } };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthOrderWhere: Prisma.SalesOrderWhereInput = {
      createdAt: { gte: monthStart },
      ...(salesPersonId ? salesPersonOrderFilter(salesPersonId) : {}),
    };

    const [openOrders, pipelineAgg, pendingQuotations, quoteAgg, ordersThisMonth, monthlyRevenue] =
      await Promise.all([
        prisma.salesOrder.count({ where: openWhere }),
        prisma.salesOrder.aggregate({ where: openWhere, _sum: { totalAmount: true } }),
        salesPersonId
          ? Promise.resolve(0)
          : prisma.salesQuotation.count({ where: quoteWhere }),
        salesPersonId
          ? Promise.resolve({ _sum: { totalAmount: null } })
          : prisma.salesQuotation.aggregate({ where: quoteWhere, _sum: { totalAmount: true } }),
        prisma.salesOrder.count({ where: monthOrderWhere }),
        salesPersonId
          ? prisma.invoice.aggregate({
              where: {
                type: 'SALES',
                status: { not: 'REFUNDED' },
                invoiceDate: { gte: monthStart },
                salesOrder: salesPersonOrderFilter(salesPersonId),
              },
              _sum: { totalAmount: true },
            }).then((r) => Number(r._sum.totalAmount || 0))
          : getMonthlySalesRevenue(monthStart),
      ]);

    return {
      openOrders,
      pipelineValue: Number(pipelineAgg._sum?.totalAmount || 0),
      pendingQuotations,
      quotationValue: Number(quoteAgg._sum?.totalAmount || 0),
      ordersThisMonth,
      monthlyRevenue,
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
