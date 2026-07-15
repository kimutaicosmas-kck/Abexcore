import prisma from '../config/database';
import { startOfDay, startOfMonth, endOfDay, subDays } from '../utils/date';
import { getNetAccountsReceivable } from '../utils/finance-metrics';
import { InvoiceMaintenanceService } from './invoice-maintenance.service';

export class DashboardService {
  static async getKPIs(userId: string) {
    await InvoiceMaintenanceService.markOverdueInvoices();

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
      pendingRequisitions,
      pendingLeave,
      openComplaints,
      openRfqs,
      overdueInvoices,
      unreadNotifications,
      attendanceToday,
      activeEmployees,
      openOpportunities,
      pipelineAgg,
      netAccountsReceivable,
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
      prisma.salesOrder.count({ where: { status: 'CONFIRMED' } }),
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
      prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.complaint.count({ where: { status: { in: ['PENDING', 'DRAFT'] } } }),
      prisma.requestForQuotation.count({ where: { status: 'PENDING' } }),
      prisma.invoice.count({
        where: { type: 'SALES', status: 'OVERDUE' },
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.attendance.count({ where: { date: today } }),
      prisma.employee.count({ where: { isActive: true, deletedAt: null } }),
      prisma.opportunity.count({ where: { status: { in: ['PENDING', 'APPROVED'] } } }),
      prisma.opportunity.aggregate({
        where: { status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { value: true },
      }),
      getNetAccountsReceivable(),
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

    const deliveryItems = await prisma.deliveryItem.findMany({
      where: {
        deliveryNote: {
          createdAt: { gte: monthStart, lte: monthEnd },
        },
      },
      select: { productId: true, quantity: true },
    });

    const productQtyMap = new Map<string, number>();
    for (const item of deliveryItems) {
      productQtyMap.set(item.productId, (productQtyMap.get(item.productId) || 0) + item.quantity);
    }

    const topProductIds = [...productQtyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([productId]) => productId);

    const products = await prisma.product.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true, sku: true, category: true },
    });

    const topSelling = topProductIds.map((productId) => ({
      ...products.find((p) => p.id === productId),
      quantitySold: productQtyMap.get(productId) || 0,
    }));

    const categoryQtyMap = new Map<string, number>();
    for (const item of deliveryItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      categoryQtyMap.set(product.category, (categoryQtyMap.get(product.category) || 0) + item.quantity);
    }

    const productCategories = [...categoryQtyMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const monthExpenses = await prisma.invoice.aggregate({
      where: {
        type: 'PURCHASE',
        invoiceDate: { gte: monthStart, lte: monthEnd },
      },
      _sum: { totalAmount: true },
    });

    const revenue = Number(salesMonth._sum.totalAmount || 0);
    const expenses = Number(monthExpenses._sum.totalAmount || 0);

    const pendingActions = [
      { type: 'requisition', label: 'Purchase requisitions awaiting approval', count: pendingRequisitions, path: '/procurement' },
      { type: 'leave', label: 'Leave requests pending approval', count: pendingLeave, path: '/hr' },
      { type: 'complaint', label: 'Open customer complaints', count: openComplaints, path: '/customers' },
      { type: 'rfq', label: 'RFQs awaiting quotes', count: openRfqs, path: '/procurement' },
      { type: 'invoice', label: 'Overdue sales invoices', count: overdueInvoices, path: '/finance' },
      { type: 'notification', label: 'Unread notifications', count: unreadNotifications, path: '/finance' },
    ].filter((a) => a.count > 0);

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
      productCategories,
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
      pendingActions,
      moduleSnapshots: {
        hr: {
          attendanceToday,
          pendingLeave,
          activeEmployees,
        },
        crm: {
          openComplaints,
          openOpportunities,
          pipelineValue: Number(pipelineAgg._sum.value || 0),
        },
        procurement: {
          pendingRequisitions,
          openRfqs,
          activePurchaseOrders: purchaseOrders,
        },
        finance: {
          overdueInvoices,
          accountsReceivable: netAccountsReceivable,
          monthlyProfit: revenue - expenses,
        },
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  static async getChartData(days = 30) {
    const safeDays = Math.min(Math.max(days, 7), 90);
    const start = startOfDay(subDays(new Date(), safeDays - 1));
    const end = endOfDay(new Date());

    const [invoices, deliveryItems] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          type: 'SALES',
          invoiceDate: { gte: start, lte: end },
          status: { not: 'REFUNDED' },
        },
        select: { invoiceDate: true, totalAmount: true },
      }),
      prisma.deliveryItem.findMany({
        where: {
          deliveryNote: { createdAt: { gte: start, lte: end } },
        },
        select: { productId: true, quantity: true },
      }),
    ]);

    const productIds = [...new Set(deliveryItems.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, category: true },
    });

    const categoryQtyMap = new Map<string, number>();
    for (const item of deliveryItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      categoryQtyMap.set(product.category, (categoryQtyMap.get(product.category) || 0) + item.quantity);
    }

    const productionByCategory = [...categoryQtyMap.entries()].map(([category, count]) => ({
      category,
      _count: { id: count },
    }));

    const salesByDayMap = new Map<string, number>();
    for (let i = safeDays - 1; i >= 0; i--) {
      const dateKey = startOfDay(subDays(new Date(), i)).toISOString().split('T')[0];
      salesByDayMap.set(dateKey, 0);
    }

    for (const inv of invoices) {
      const key = startOfDay(inv.invoiceDate).toISOString().split('T')[0];
      if (salesByDayMap.has(key)) {
        salesByDayMap.set(key, (salesByDayMap.get(key) || 0) + Number(inv.totalAmount));
      }
    }

    return {
      days: safeDays,
      salesTrend: Array.from(salesByDayMap.entries()).map(([date, amount]) => ({ date, amount })),
      productCategories: productionByCategory.map((p) => ({
        category: p.category,
        count: p._count.id,
      })),
    };
  }
}
