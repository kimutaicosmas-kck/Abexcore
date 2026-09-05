import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import {
  getMonthlySalesRevenue,
  getNetAccountsReceivable,
  getNetAccountsPayable,
  getInvoicePaymentsReceived,
  getDueCohortCollectionRate,
  getCollectionRateTrend,
  getMonthStart,
  getMonthEnd,
} from '../utils/finance-metrics';
import { InvoiceMaintenanceService } from './invoice-maintenance.service';
import { tenantEmployeeScope } from '../utils/tenant';

export class FinanceService {
  static async getStats(opts?: { type?: string; status?: string; search?: string }) {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const monthStart = getMonthStart();
    const monthEnd = getMonthEnd();

    const invScope: Prisma.InvoiceWhereInput = {};
    if (opts?.type) {
      invScope.type = opts.type as Prisma.EnumInvoiceTypeFilter['equals'];
    }
    if (opts?.status) {
      invScope.status = opts.status as Prisma.EnumPaymentStatusFilter['equals'];
    }
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      invScope.OR = [
        { invoiceNumber: { contains: q } },
        { customer: { name: { contains: q } } },
        { supplier: { name: { contains: q } } },
      ];
    }
    const hasScope = Object.keys(invScope).length > 0;

    const salesWhere: Prisma.InvoiceWhereInput = {
      ...invScope,
      ...(opts?.type ? {} : { type: 'SALES' }),
    };
    const purchaseWhere: Prisma.InvoiceWhereInput = {
      ...invScope,
      ...(opts?.type ? {} : { type: 'PURCHASE' }),
    };

    const includeSales = !opts?.type || opts.type === 'SALES';
    const includePurchases = !opts?.type || opts.type === 'PURCHASE';
    const includeOverdue = !opts?.status || opts.status === 'OVERDUE';

    const openStatuses = (
      opts?.status ? [opts.status] : ['UNPAID', 'PARTIAL', 'OVERDUE']
    ) as Prisma.EnumPaymentStatusFilter['in'];

    const [
      salesAgg,
      purchaseAgg,
      overdueCount,
      monthlySales,
      journalCount,
      accountsReceivable,
      accountsPayable,
      paymentsReceived,
      collectionRate,
    ] = await Promise.all([
      includeSales
        ? prisma.invoice.aggregate({ where: salesWhere, _sum: { totalAmount: true } })
        : Promise.resolve({ _sum: { totalAmount: null } }),
      includePurchases
        ? prisma.invoice.aggregate({ where: purchaseWhere, _sum: { totalAmount: true } })
        : Promise.resolve({ _sum: { totalAmount: null } }),
      includeSales && includeOverdue
        ? prisma.invoice.count({ where: { ...salesWhere, status: 'OVERDUE' } })
        : Promise.resolve(0),
      hasScope
        ? includeSales
          ? prisma.invoice
              .aggregate({
                where: {
                  ...salesWhere,
                  invoiceDate: { gte: monthStart, lte: monthEnd },
                  status: { not: 'REFUNDED' },
                },
                _sum: { totalAmount: true },
              })
              .then((a) => Number(a._sum.totalAmount || 0))
          : Promise.resolve(0)
        : getMonthlySalesRevenue(monthStart),
      prisma.journalEntry.count(),
      hasScope
        ? includeSales
          ? prisma.invoice
              .findMany({
                where: { ...salesWhere, status: { in: openStatuses } },
                select: { totalAmount: true, paidAmount: true },
              })
              .then((rows) =>
                rows.reduce(
                  (sum, inv) => sum + Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount)),
                  0
                )
              )
          : Promise.resolve(0)
        : getNetAccountsReceivable(),
      hasScope
        ? includePurchases
          ? prisma.invoice
              .findMany({
                where: { ...purchaseWhere, status: { in: openStatuses } },
                select: { totalAmount: true, paidAmount: true },
              })
              .then((rows) =>
                rows.reduce(
                  (sum, inv) => sum + Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount)),
                  0
                )
              )
          : Promise.resolve(0)
        : getNetAccountsPayable(),
      hasScope
        ? includeSales
          ? prisma.invoice
              .aggregate({
                where: { ...salesWhere, status: { not: 'REFUNDED' } },
                _sum: { paidAmount: true },
              })
              .then((a) => Number(a._sum.paidAmount || 0))
          : Promise.resolve(0)
        : getInvoicePaymentsReceived(),
      getDueCohortCollectionRate(monthStart, monthEnd),
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
      collectionRate,
    };
  }

  static async getOverview(days = 30) {
    await InvoiceMaintenanceService.markOverdueInvoices();

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today);
    start.setDate(start.getDate() - days + 1);

    const [openSalesInvoices, collectionRate, collectionTrend] = await Promise.all([
      prisma.invoice.findMany({
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
      }),
      getDueCohortCollectionRate(getMonthStart(), getMonthEnd()),
      getCollectionRateTrend(6),
    ]);

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
      collectionRate,
      collectionTrend,
    };
  }
}

export class HrService {
  static async getStats() {
    const employeeScope = tenantEmployeeScope();
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

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
      prisma.employee.count({ where: employeeScope }),
      prisma.employee.count({ where: { ...employeeScope, isActive: true } }),
      prisma.leaveRequest.count({ where: { status: 'PENDING', employee: employeeScope } }),
      prisma.payrollRecord.count({ where: { isPaid: false, employee: employeeScope } }),
      prisma.attendance.count({
        where: { date: { gte: todayStart }, employee: employeeScope },
      }),
      prisma.salaryAdvance.count({ where: { status: 'PENDING' } }),
      prisma.salaryAdvance.count({ where: { status: 'ACTIVE' } }),
      prisma.salaryAdvance.aggregate({
        where: { status: 'ACTIVE' },
        _sum: { remainingBalance: true },
      }),
    ]);

    const payrollDue = await prisma.payrollRecord.aggregate({
      where: { isPaid: false, employee: employeeScope },
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
  static async getStats(opts?: { search?: string; status?: string }) {
    const reqScope: Prisma.MaintenanceRequestWhereInput = {};
    if (opts?.search?.trim()) {
      const q = opts.search.trim();
      reqScope.OR = [
        { description: { contains: q } },
        { type: { contains: q } },
        { machine: { name: { contains: q } } },
        { machine: { code: { contains: q } } },
      ];
    }
    if (opts?.status) {
      reqScope.status = opts.status as Prisma.EnumMaintenanceStatusFilter['equals'];
    }

    const statusOk = (bucket: string | string[]) => {
      if (!opts?.status) return true;
      return Array.isArray(bucket) ? bucket.includes(opts.status) : opts.status === bucket;
    };

    const [totalMachines, operational, openRequests, completedMonth, overdueRequests] =
      await Promise.all([
        prisma.machine.count({ where: { isActive: true } }),
        prisma.machine.count({ where: { isActive: true, status: 'operational' } }),
        statusOk(['SCHEDULED', 'IN_PROGRESS'])
          ? prisma.maintenanceRequest.count({
              where: {
                ...reqScope,
                status: opts?.status
                  ? (opts.status as Prisma.EnumMaintenanceStatusFilter['equals'])
                  : { in: ['SCHEDULED', 'IN_PROGRESS'] },
              },
            })
          : Promise.resolve(0),
        statusOk('COMPLETED')
          ? prisma.maintenanceRequest.count({
              where: {
                ...reqScope,
                status: 'COMPLETED',
                completedDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
              },
            })
          : Promise.resolve(0),
        statusOk(['SCHEDULED', 'IN_PROGRESS', 'OVERDUE'])
          ? prisma.maintenanceRequest.count({
              where: {
                ...reqScope,
                status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
                scheduledDate: { lt: new Date() },
              },
            })
          : Promise.resolve(0),
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
