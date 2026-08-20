import prisma from '../config/database';
import { startOfDay, endOfDay, startOfMonth } from '../utils/date';
import { isLowStock, sumStockQuantities, toStockQty } from '../utils/stock';

/**
 * Semantic BI layer — KPI aggregates for dashboards and Reports → Business Intelligence.
 */
export class AnalyticsService {
  static async executiveSummary(params?: { from?: Date; to?: Date }) {
    const to = params?.to ? endOfDay(params.to) : endOfDay(new Date());
    const from = params?.from ? startOfDay(params.from) : startOfMonth(to);
    const todayStart = startOfDay(new Date());

    const [
      salesOrdersMonth,
      salesAmountMonth,
      openInvoices,
      paymentsMonth,
      products,
      pendingApprovals,
      fiscalPending,
      salesToday,
    ] = await Promise.all([
      prisma.salesOrder.count({
        where: { createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      }),
      prisma.salesOrder.aggregate({
        where: { createdAt: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.findMany({
        where: { type: 'SALES', status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
        select: { totalAmount: true, paidAmount: true, status: true, dueDate: true, invoiceDate: true },
      }),
      prisma.payment.aggregate({
        where: { paymentDate: { gte: from, lte: to } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        select: {
          minStockLevel: true,
          stockLevels: { select: { quantity: true } },
        },
        take: 5000,
      }),
      prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
      prisma.invoice.count({
        where: {
          type: 'SALES',
          fiscalStatus: { in: ['PENDING', 'FAILED'] },
        },
      }),
      prisma.salesOrder.aggregate({
        where: { createdAt: { gte: todayStart }, status: { not: 'CANCELLED' } },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    const arOutstanding = openInvoices.reduce(
      (sum, inv) => sum + Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount || 0)),
      0
    );
    const overdueInvoiceCount = openInvoices.filter((inv) => inv.status === 'OVERDUE').length;
    const lowStockSkuCount = products.filter((p) =>
      isLowStock(sumStockQuantities(p.stockLevels), toStockQty(p.minStockLevel))
    ).length;

    return {
      period: { from, to },
      kpis: {
        salesOrdersMonth,
        salesAmountMonth: Number(salesAmountMonth._sum.totalAmount || 0),
        salesTodayAmount: Number(salesToday._sum.totalAmount || 0),
        salesTodayCount: salesToday._count,
        arOutstanding,
        openInvoiceCount: openInvoices.length,
        overdueInvoiceCount,
        collectionsMonth: Number(paymentsMonth._sum.amount || 0),
        paymentCountMonth: paymentsMonth._count,
        lowStockSkuCount,
        pendingApprovals,
        fiscalPendingInvoices: fiscalPending,
      },
    };
  }

  static async salesTrend(days = 30) {
    const end = endOfDay(new Date());
    const start = startOfDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
    const orders = await prisma.salesOrder.findMany({
      where: { createdAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
      select: { createdAt: true, totalAmount: true },
    });

    const buckets = new Map<string, { date: string; amount: number; count: number }>();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { date: key, amount: 0, count: 0 });
    }
    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const row = buckets.get(key);
      if (!row) continue;
      row.amount += Number(order.totalAmount);
      row.count += 1;
    }

    return { days, series: [...buckets.values()] };
  }

  static async arAging() {
    const now = new Date();
    const open = await prisma.invoice.findMany({
      where: { type: 'SALES', status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
      select: { totalAmount: true, paidAmount: true, dueDate: true, invoiceDate: true },
    });

    const buckets = {
      current: 0,
      days1to30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0,
    };

    for (const inv of open) {
      const due = inv.dueDate || inv.invoiceDate;
      const ageDays = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
      const amount = Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount || 0));
      if (ageDays <= 0) buckets.current += amount;
      else if (ageDays <= 30) buckets.days1to30 += amount;
      else if (ageDays <= 60) buckets.days31to60 += amount;
      else if (ageDays <= 90) buckets.days61to90 += amount;
      else buckets.over90 += amount;
    }

    return buckets;
  }
}
