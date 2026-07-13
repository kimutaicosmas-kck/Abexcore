import prisma from '../config/database';
import { startOfDay, startOfMonth, endOfDay, subDays } from '../utils/date';

export class DashboardService {
  static async getKPIs() {
    const today = startOfDay(new Date());
    const monthStart = startOfMonth(new Date());
    const monthEnd = endOfDay(new Date());

    const [
      salesToday,
      salesMonth,
      purchaseOrders,
      productionOrders,
      awaitingProduction,
      lowStockMaterials,
      finishedGoods,
      recentOrders,
      productionStatus,
      topProducts,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { type: 'SALES', invoiceDate: { gte: today }, status: { not: 'REFUNDED' } },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: {
          type: 'SALES',
          invoiceDate: { gte: monthStart, lte: monthEnd },
          status: { not: 'REFUNDED' },
        },
        _sum: { totalAmount: true },
      }),
      prisma.purchaseOrder.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
      prisma.productionOrder.count({ where: { status: { in: ['PLANNED', 'SCHEDULED', 'IN_PROGRESS'] } } }),
      prisma.salesOrder.count({ where: { status: 'IN_PRODUCTION' } }),
      prisma.rawMaterial.findMany({
        where: { isActive: true, deletedAt: null },
        include: { stockLevels: true },
      }),
      prisma.stockLevel.aggregate({
        where: { productId: { not: null } },
        _sum: { quantity: true },
      }),
      prisma.salesOrder.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { name: true } } },
      }),
      prisma.productionOrder.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      prisma.salesOrderItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
    ]);

    const inventoryValue = await prisma.stockLevel.findMany({
      include: { product: true, rawMaterial: true },
    });

    const totalInventoryValue = inventoryValue.reduce((sum, sl) => {
      return sum + Number(sl.quantity) * Number(sl.unitCost);
    }, 0);

    const lowStock = lowStockMaterials.filter((m) => {
      const totalQty = m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      return totalQty <= Number(m.minStockLevel);
    });

    const productIds = topProducts.map((p) => p.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true },
    });

    const topSelling = topProducts.map((tp) => ({
      ...products.find((p) => p.id === tp.productId),
      quantitySold: tp._sum.quantity,
    }));

    const monthExpenses = await prisma.invoice.aggregate({
      where: {
        type: 'PURCHASE',
        invoiceDate: { gte: monthStart, lte: monthEnd },
      },
      _sum: { totalAmount: true },
    });

    const revenue = Number(salesMonth._sum.totalAmount || 0);
    const expenses = Number(monthExpenses._sum.totalAmount || 0);

    return {
      salesToday: Number(salesToday._sum.totalAmount || 0),
      salesThisMonth: revenue,
      purchaseOrders,
      productionOrders,
      ordersAwaitingProduction: awaitingProduction,
      inventoryValue: totalInventoryValue,
      rawMaterialsLow: lowStock.length,
      lowStockItems: lowStock.slice(0, 5).map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        currentStock: m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0),
        minLevel: Number(m.minStockLevel),
      })),
      finishedGoods: Number(finishedGoods._sum.quantity || 0),
      monthlyRevenue: revenue,
      monthlyProfit: revenue - expenses,
      monthlyExpenses: expenses,
      topSellingFilters: topSelling,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customer: o.customer.name,
        total: Number(o.totalAmount),
        status: o.status,
        date: o.orderDate,
      })),
      productionStatus: productionStatus.map((ps) => ({
        status: ps.status,
        count: ps._count.id,
      })),
    };
  }

  static async getChartData() {
    const days = 30;
    const salesByDay: { date: string; amount: number }[] = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dayStart = startOfDay(date);
      const dayEnd = endOfDay(date);

      const sales = await prisma.invoice.aggregate({
        where: {
          type: 'SALES',
          invoiceDate: { gte: dayStart, lte: dayEnd },
        },
        _sum: { totalAmount: true },
      });

      salesByDay.push({
        date: dayStart.toISOString().split('T')[0],
        amount: Number(sales._sum.totalAmount || 0),
      });
    }

    const productionByCategory = await prisma.product.groupBy({
      by: ['category'],
      _count: { id: true },
    });

    return {
      salesTrend: salesByDay,
      productCategories: productionByCategory.map((p) => ({
        category: p.category,
        count: p._count.id,
      })),
    };
  }
}
