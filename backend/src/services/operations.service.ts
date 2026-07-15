import prisma from '../config/database';
import { getMonthlySalesRevenue } from '../utils/finance-metrics';

export class QualityService {
  static async getStats() {
    const [total, pending, passed, failed, conditional] = await Promise.all([
      prisma.qualityInspection.count(),
      prisma.qualityInspection.count({ where: { status: 'PENDING' } }),
      prisma.qualityInspection.count({ where: { status: 'PASSED' } }),
      prisma.qualityInspection.count({ where: { status: 'FAILED' } }),
      prisma.qualityInspection.count({ where: { status: 'CONDITIONAL' } }),
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
}

export class SalesService {
  static async getStats() {
    const openWhere = { status: { notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] } };
    const quoteWhere = { status: { in: ['DRAFT', 'PENDING'] as ('DRAFT' | 'PENDING')[] } };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [openOrders, pipelineAgg, pendingQuotations, quoteAgg, ordersThisMonth, monthlyRevenue] =
      await Promise.all([
        prisma.salesOrder.count({ where: openWhere }),
        prisma.salesOrder.aggregate({ where: openWhere, _sum: { totalAmount: true } }),
        prisma.salesQuotation.count({ where: quoteWhere }),
        prisma.salesQuotation.aggregate({ where: quoteWhere, _sum: { totalAmount: true } }),
        prisma.salesOrder.count({ where: { createdAt: { gte: monthStart } } }),
        getMonthlySalesRevenue(monthStart),
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
        prisma.deliveryNote.count({ where: { status: { in: ['PENDING', 'ASSIGNED'] } } }),
        prisma.deliveryNote.count({ where: { status: 'IN_TRANSIT' } }),
        prisma.deliveryNote.count({
          where: { status: 'DELIVERED', deliveredAt: { gte: todayStart } },
        }),
        prisma.deliveryNote.count({
          where: { status: 'DELIVERED', deliveredAt: { gte: monthStart } },
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
