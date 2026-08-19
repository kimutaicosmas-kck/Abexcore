import prisma from '../config/database';
import {
  getMonthlySalesRevenue,
  getNetAccountsReceivable,
  getNetAccountsPayable,
  getInvoicePaymentsReceived,
} from '../utils/finance-metrics';
import { InvoiceMaintenanceService } from './invoice-maintenance.service';

export class FinanceService {
  static async getStats() {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      salesAgg,
      purchaseAgg,
      overdueCount,
      monthlySales,
      journalCount,
      accountsReceivable,
      accountsPayable,
      paymentsReceived,
    ] = await Promise.all([
      prisma.invoice.aggregate({ where: { type: 'SALES' }, _sum: { totalAmount: true } }),
      prisma.invoice.aggregate({ where: { type: 'PURCHASE' }, _sum: { totalAmount: true } }),
      prisma.invoice.count({
        where: {
          type: 'SALES',
          status: 'OVERDUE',
        },
      }),
      getMonthlySalesRevenue(monthStart),
      prisma.journalEntry.count(),
      getNetAccountsReceivable(),
      getNetAccountsPayable(),
      getInvoicePaymentsReceived(),
    ]);

    return {
      totalSales: Number(salesAgg._sum?.totalAmount || 0),
      totalPurchases: Number(purchaseAgg._sum?.totalAmount || 0),
      accountsReceivable,
      accountsPayable,
      paymentsReceived,
      overdueInvoices: overdueCount,
      monthlyRevenue: monthlySales,
      journalEntries: journalCount,
    };
  }

  static async getOverview(days = 30) {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);

    const openSalesInvoices = await prisma.invoice.findMany({
      where: {
        type: 'SALES',
        status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] },
      },
      select: {
        id: true,
        invoiceNumber: true,
        totalAmount: true,
        paidAmount: true,
        dueDate: true,
        invoiceDate: true,
        customer: { select: { name: true } },
      },
    });

    type AgingBucket = { amount: number; count: number };
    const aging: Record<string, AgingBucket> = {
      current: { amount: 0, count: 0 },
      days1_30: { amount: 0, count: 0 },
      days31_60: { amount: 0, count: 0 },
      days61_90: { amount: 0, count: 0 },
      days90Plus: { amount: 0, count: 0 },
    };

    const agingInvoices: {
      id: string;
      invoiceNumber: string;
      customerName: string;
      balance: number;
      daysPastDue: number;
      bucket: string;
    }[] = [];

    for (const inv of openSalesInvoices) {
      const balance = Number(inv.totalAmount) - Number(inv.paidAmount);
      if (balance <= 0.01) continue;

      const dueBase = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.invoiceDate);
      dueBase.setHours(0, 0, 0, 0);
      const daysPastDue = Math.floor((today.getTime() - dueBase.getTime()) / 86400000);

      let bucket: keyof typeof aging;
      if (daysPastDue <= 0) bucket = 'current';
      else if (daysPastDue <= 30) bucket = 'days1_30';
      else if (daysPastDue <= 60) bucket = 'days31_60';
      else if (daysPastDue <= 90) bucket = 'days61_90';
      else bucket = 'days90Plus';

      aging[bucket].amount += balance;
      aging[bucket].count += 1;
      agingInvoices.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerName: inv.customer?.name || '—',
        balance,
        daysPastDue: Math.max(0, daysPastDue),
        bucket,
      });
    }

    const totalOutstanding = Object.values(aging).reduce((s, b) => s + b.amount, 0);

    const payments = await prisma.payment.findMany({
      where: { paymentDate: { gte: start } },
      include: { invoice: { select: { type: true } } },
      orderBy: { paymentDate: 'asc' },
    });

    const dayMap = new Map<string, { inflow: number; outflow: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dayMap.set(d.toISOString().slice(0, 10), { inflow: 0, outflow: 0 });
    }

    let totalInflow = 0;
    let totalOutflow = 0;

    for (const p of payments) {
      const key = new Date(p.paymentDate).toISOString().slice(0, 10);
      const amt = Number(p.amount);
      const entry = dayMap.get(key) || { inflow: 0, outflow: 0 };

      if (p.invoice?.type === 'PURCHASE') {
        entry.outflow += amt;
        totalOutflow += amt;
      } else {
        entry.inflow += amt;
        totalInflow += amt;
      }
      dayMap.set(key, entry);
    }

    const cashFlowTrend = Array.from(dayMap.entries()).map(([date, v]) => ({
      date,
      inflow: v.inflow,
      outflow: v.outflow,
      net: v.inflow - v.outflow,
    }));

    agingInvoices.sort((a, b) => b.daysPastDue - a.daysPastDue);

    return {
      arAging: {
        buckets: aging,
        totalOutstanding,
        topOverdue: agingInvoices.filter((i) => i.bucket !== 'current').slice(0, 8),
      },
      cashFlow: {
        days,
        trend: cashFlowTrend,
        totalInflow,
        totalOutflow,
        net: totalInflow - totalOutflow,
      },
    };
  }
}

export class HrService {
  static async getStats() {
    const [
      totalEmployees,
      activeEmployees,
      pendingLeave,
      unpaidPayroll,
      attendanceToday,
      pendingAdvances,
      activeAdvances,
      advancesOutstanding,
    ] = await Promise.all([
      prisma.employee.count({ where: { deletedAt: null } }),
      prisma.employee.count({ where: { deletedAt: null, isActive: true } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING' } }),
      prisma.payrollRecord.count({ where: { isPaid: false } }),
      prisma.attendance.count({
        where: { date: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
      prisma.salaryAdvance.count({ where: { status: 'PENDING' } }),
      prisma.salaryAdvance.count({ where: { status: 'ACTIVE' } }),
      prisma.salaryAdvance.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { remainingBalance: true },
      }),
    ]);

    const payrollDue = await prisma.payrollRecord.aggregate({
      where: { isPaid: false },
      _sum: { netPay: true },
    });

    return {
      totalEmployees,
      activeEmployees,
      pendingLeave,
      unpaidPayroll,
      payrollDue: Number(payrollDue._sum?.netPay || 0),
      attendanceToday,
      pendingAdvances,
      activeAdvances,
      advancesOutstanding: Number(advancesOutstanding._sum?.remainingBalance || 0),
    };
  }
}

export class MaintenanceService {
  static async getStats() {
    const [totalMachines, operational, openRequests, completedMonth, overdueRequests] =
      await Promise.all([
        prisma.machine.count({ where: { isActive: true } }),
        prisma.machine.count({ where: { isActive: true, status: 'operational' } }),
        prisma.maintenanceRequest.count({
          where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        }),
        prisma.maintenanceRequest.count({
          where: {
            status: 'COMPLETED',
            completedDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
        }),
        prisma.maintenanceRequest.count({
          where: {
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
            scheduledDate: { lt: new Date() },
          },
        }),
      ]);

    return {
      totalMachines,
      operational,
      openRequests,
      completedMonth,
      overdueRequests,
    };
  }
}

export class ReportsService {
  static async getOverview() {
    return this.getSummaryReport({});
  }

  static async getSummaryReport(query: {
    startDate?: string;
    endDate?: string;
    qualityStatus?: 'ALL' | 'PASSED' | 'FAILED';
  }) {
    const { startOfDay, endOfDay } = await import('../utils/date');
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const rangeFilter = (field: 'createdAt' | 'actualEnd' | 'inspectedAt') => {
      if (!query.startDate && !query.endDate) return undefined;
      const filter: { gte?: Date; lte?: Date } = {};
      if (query.startDate) filter.gte = startOfDay(new Date(query.startDate));
      if (query.endDate) filter.lte = endOfDay(new Date(query.endDate));
      return { [field]: filter };
    };

    const purchaseOrderWhere =
      query.startDate || query.endDate
        ? rangeFilter('createdAt')
        : { createdAt: { gte: monthStart } };

    const productionOutputWhere =
      query.startDate || query.endDate
        ? { status: 'COMPLETED' as const, ...rangeFilter('actualEnd') }
        : { status: 'COMPLETED' as const, actualEnd: { gte: monthStart } };

    const [
      salesTotal,
      purchaseTotal,
      productionCount,
      customerCount,
      supplierCount,
      purchaseOrders,
      productionOutput,
      unpaidInvoices,
      qualityPassed,
      qualityFailed,
    ] = await Promise.all([
      prisma.invoice.aggregate({
        where: { type: 'SALES', ...rangeFilter('createdAt') },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { type: 'PURCHASE', ...rangeFilter('createdAt') },
        _sum: { totalAmount: true },
      }),
      prisma.productionOrder.count({
        where: { status: 'COMPLETED', ...rangeFilter('actualEnd') },
      }),
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.supplier.count({ where: { deletedAt: null } }),
      prisma.purchaseOrder.aggregate({
        where: purchaseOrderWhere,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      prisma.productionOrder.aggregate({
        where: productionOutputWhere,
        _sum: { completedQty: true },
      }),
      prisma.invoice.count({ where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } } }),
      prisma.qualityInspection.count({
        where: { status: 'PASSED', ...rangeFilter('inspectedAt') },
      }),
      prisma.qualityInspection.count({
        where: { status: 'FAILED', ...rangeFilter('inspectedAt') },
      }),
    ]);

    const topCustomers = await prisma.customer.findMany({
      where: { deletedAt: null, isActive: true },
      take: 5,
      include: { _count: { select: { salesOrders: true } } },
      orderBy: { salesOrders: { _count: 'desc' } },
    });

    return {
      totalSales: Number(salesTotal._sum?.totalAmount || 0),
      totalPurchases: Number(purchaseTotal._sum?.totalAmount || 0),
      completedProduction: productionCount,
      totalCustomers: customerCount,
      totalSuppliers: supplierCount,
      purchaseOrdersMonth: purchaseOrders._count.id,
      purchaseValueMonth: Number(purchaseOrders._sum?.totalAmount || 0),
      productionOutputMonth: Number(productionOutput._sum?.completedQty || 0),
      unpaidInvoices,
      qualityPassed,
      qualityFailed,
      topCustomers: topCustomers.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        orderCount: c._count.salesOrders,
      })),
    };
  }
}
