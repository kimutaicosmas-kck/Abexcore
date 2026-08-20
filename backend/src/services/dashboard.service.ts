import prisma from '../config/database';
import { startOfDay, startOfMonth, endOfDay, subDays, toLocalDateKey } from '../utils/date';
import { getNetAccountsReceivable } from '../utils/finance-metrics';
import { InvoiceMaintenanceService } from './invoice-maintenance.service';
import { mergeTenantWarehouseWhere, requireTenantId } from '../utils/tenant';
import { isLowStock, sumStockQuantities, toStockQty } from '../utils/stock';

export class DashboardService {
  static async getKPIs(userId: string) {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const companyId = requireTenantId();
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
      lowStockProducts,
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
        include: { stockLevels: { where: { warehouse: { companyId } } } },
      }),
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        include: { stockLevels: { where: { warehouse: { companyId } } } },
      }),
      prisma.stockLevel.aggregate({
        where: mergeTenantWarehouseWhere({ productId: { not: null } }),
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
      prisma.leaveRequest.count({ where: { status: 'PENDING', employee: { companyId } } }),
      prisma.complaint.count({ where: { status: { in: ['PENDING', 'DRAFT'] }, customer: { companyId } } }),
      prisma.requestForQuotation.count({ where: { status: 'PENDING' } }),
      prisma.invoice.count({
        where: { type: 'SALES', status: 'OVERDUE' },
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      prisma.attendance.count({ where: { date: today, employee: { companyId } } }),
      prisma.employee.count({ where: { isActive: true, deletedAt: null } }),
      prisma.opportunity.count({ where: { status: { in: ['PENDING', 'APPROVED'] }, customer: { companyId } } }),
      prisma.opportunity.aggregate({
        where: { status: { in: ['PENDING', 'APPROVED'] }, customer: { companyId } },
        _sum: { value: true },
      }),
      getNetAccountsReceivable(),
    ]);

    const inventoryValue = await prisma.stockLevel.findMany({
      where: mergeTenantWarehouseWhere(),
      include: { product: true, rawMaterial: true },
    });

    const totalInventoryValue = inventoryValue.reduce((sum, sl) => {
      return sum + Number(sl.quantity) * Number(sl.unitCost);
    }, 0);

    const lowMaterials = lowStockMaterials.filter((m) =>
      isLowStock(sumStockQuantities(m.stockLevels), m.minStockLevel)
    );
    const lowProducts = lowStockProducts.filter((p) =>
      isLowStock(sumStockQuantities(p.stockLevels), p.minStockLevel)
    );
    const lowStock = [
      ...lowMaterials.map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        currentStock: sumStockQuantities(m.stockLevels),
        minLevel: toStockQty(m.minStockLevel),
        itemType: 'RAW_MATERIAL' as const,
      })),
      ...lowProducts.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.sku,
        currentStock: sumStockQuantities(p.stockLevels),
        minLevel: toStockQty(p.minStockLevel),
        itemType: 'PRODUCT' as const,
      })),
    ].sort((a, b) => a.currentStock - b.currentStock);

    const deliveryItems = await prisma.deliveryItem.findMany({
      where: {
        deliveryNote: {
          createdAt: { gte: monthStart, lte: monthEnd },
          salesOrder: { companyId },
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
      select: { id: true, name: true, sku: true, category: { select: { name: true } } },
    });

    const topSelling = topProductIds
      .map((productId) => {
        const product = products.find((p) => p.id === productId);
        if (!product) return null;
        return {
          id: product.id,
          name: product.name,
          sku: product.sku,
          quantitySold: productQtyMap.get(productId) || 0,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const categoryQtyMap = new Map<string, number>();
    for (const item of deliveryItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      const categoryName = product.category?.name || 'Uncategorized';
      categoryQtyMap.set(categoryName, (categoryQtyMap.get(categoryName) || 0) + item.quantity);
    }

    const productCategories = [...categoryQtyMap.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    const [monthPurchaseExpenses, monthOperatingExpenses, pendingExpenses] = await Promise.all([
      prisma.invoice.aggregate({
        where: {
          type: 'PURCHASE',
          invoiceDate: { gte: monthStart, lte: monthEnd },
        },
        _sum: { totalAmount: true },
      }),
      prisma.expense.aggregate({
        where: {
          status: 'POSTED',
          deletedAt: null,
          expenseDate: { gte: monthStart, lte: monthEnd },
        },
        _sum: { totalAmount: true },
      }),
      prisma.expense.count({
        where: { status: 'PENDING_APPROVAL', deletedAt: null },
      }),
    ]);

    const revenue = Number(salesMonth._sum.totalAmount || 0);
    const expenses =
      Number(monthPurchaseExpenses._sum.totalAmount || 0) +
      Number(monthOperatingExpenses._sum.totalAmount || 0);

    const pendingActions = [
      { type: 'requisition', label: 'Purchase requisitions awaiting approval', count: pendingRequisitions, path: '/procurement' },
      { type: 'leave', label: 'Leave requests pending approval', count: pendingLeave, path: '/hr' },
      { type: 'complaint', label: 'Open customer complaints', count: openComplaints, path: '/customers' },
      { type: 'rfq', label: 'RFQs awaiting quotes', count: openRfqs, path: '/procurement' },
      { type: 'expense', label: 'Expenses awaiting approval', count: pendingExpenses, path: '/finance' },
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
      lowStockItems: lowStock.slice(0, 5),
      finishedGoods: Number(finishedGoods._sum.quantity || 0),
      monthlyRevenue: revenue,
      monthlyProfit: revenue - expenses,
      monthlyExpenses: expenses,
      topSellingProducts: topSelling,
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
    const companyId = requireTenantId();
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
          deliveryNote: {
            createdAt: { gte: start, lte: end },
            salesOrder: { companyId },
          },
        },
        select: { productId: true, quantity: true },
      }),
    ]);

    const productIds = [...new Set(deliveryItems.map((item) => item.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, categoryId: true, category: { select: { name: true } } },
    });

    const categoryQtyMap = new Map<string, number>();
    for (const item of deliveryItems) {
      const product = products.find((p) => p.id === item.productId);
      if (!product) continue;
      const categoryName = product.category?.name || 'Uncategorized';
      categoryQtyMap.set(categoryName, (categoryQtyMap.get(categoryName) || 0) + item.quantity);
    }

    const productionByCategory = [...categoryQtyMap.entries()].map(([category, count]) => ({
      category,
      _count: { id: count },
    }));

    const salesByDayMap = new Map<string, number>();
    for (let i = safeDays - 1; i >= 0; i--) {
      const dateKey = toLocalDateKey(startOfDay(subDays(new Date(), i)));
      salesByDayMap.set(dateKey, 0);
    }

    for (const inv of invoices) {
      const key = toLocalDateKey(inv.invoiceDate);
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
