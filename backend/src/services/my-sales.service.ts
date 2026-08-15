import prisma from '../config/database';
import { isSalesPersonRole, SALES_PERSON_ROLE_NAMES } from '../config/rolePermissions';
import { AppError } from '../middleware/errorHandler';
import { endOfDay, startOfDay } from '../utils/date';
import { injectTenantData } from '../utils/tenant';
import { Prisma } from '@prisma/client';

export function salesPersonOrderFilter(salesPersonId: string): Prisma.SalesOrderWhereInput {
  return {
    OR: [
      { salesPersonId },
      { salesPersonId: null, createdById: salesPersonId },
    ],
  };
}

function resolveMySalesPeriod(from?: string, to?: string) {
  const now = new Date();
  const fromDate = from ?? now.toISOString().slice(0, 10);
  const toDate = to ?? fromDate;
  return {
    from: startOfDay(new Date(fromDate)),
    to: endOfDay(new Date(toDate)),
  };
}

function startOfWeekMonday(date: Date) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  return startOfDay(start);
}

type PeriodMetrics = {
  sales: number;
  invoiced: number;
  paid: number;
  outstanding: number;
  orderCount: number;
  invoicedOrderCount: number;
};

async function getPeriodMetrics(
  salesPersonId: string,
  from: Date,
  to: Date
): Promise<PeriodMetrics> {
  const { salesOrderInDateRange } = await import('../utils/salesDate');
  const orderWhere: Prisma.SalesOrderWhereInput = {
    ...salesPersonOrderFilter(salesPersonId),
    AND: [salesOrderInDateRange({ gte: from, lte: to })],
  };
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    type: 'SALES',
    status: { not: 'REFUNDED' },
    salesOrder: salesPersonOrderFilter(salesPersonId),
    invoiceDate: { gte: from, lte: to },
  };
  const invoicedOrderWhere: Prisma.SalesOrderWhereInput = {
    ...salesPersonOrderFilter(salesPersonId),
    invoices: {
      some: {
        type: 'SALES',
        status: { not: 'REFUNDED' },
        invoiceDate: { gte: from, lte: to },
      },
    },
  };

  const [orderAgg, orderCount, invoiceAgg, invoicedOrderCount] = await Promise.all([
    prisma.salesOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true } }),
    prisma.salesOrder.count({ where: orderWhere }),
    prisma.invoice.aggregate({
      where: invoiceWhere,
      _sum: { totalAmount: true, paidAmount: true },
    }),
    prisma.salesOrder.count({ where: invoicedOrderWhere }),
  ]);

  const invoiced = Number(invoiceAgg._sum.totalAmount || 0);
  const paid = Number(invoiceAgg._sum.paidAmount || 0);

  return {
    sales: Number(orderAgg._sum.totalAmount || 0),
    invoiced,
    paid,
    outstanding: invoiced - paid,
    orderCount,
    invoicedOrderCount,
  };
}

export class MySalesService {
  static async assertSalesOfficer(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, role: { select: { name: true } } },
    });
    if (!user) throw new AppError('Sales person not found', 404);
    if (!isSalesPersonRole(user.role.name)) {
      throw new AppError('My Sales is only available for sales roles', 400);
    }
    return user;
  }

  static async getMonthlyTarget(salesPersonId: string, year: number, month: number) {
    const target = await prisma.salesTarget.findUnique({
      where: { salesPersonId_year_month: { salesPersonId, year, month } },
    });
    return target ? Number(target.targetAmount) : 0;
  }

  static async getDashboard(opts: {
    salesPersonId: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const user = await this.assertSalesOfficer(opts.salesPersonId);
    const { from, to } = resolveMySalesPeriod(opts.from, opts.to);
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 15;
    const skip = (page - 1) * limit;

    const { salesOrderInDateRange } = await import('../utils/salesDate');
    const orderWhere: Prisma.SalesOrderWhereInput = {
      ...salesPersonOrderFilter(opts.salesPersonId),
      AND: [salesOrderInDateRange({ gte: from, lte: to })],
    };

    const invoiceWhere: Prisma.InvoiceWhereInput = {
      type: 'SALES',
      status: { not: 'REFUNDED' },
      salesOrder: salesPersonOrderFilter(opts.salesPersonId),
      invoiceDate: { gte: from, lte: to },
    };

    const monthStart = startOfDay(new Date(to.getFullYear(), to.getMonth(), 1));
    const monthInvoiceWhere: Prisma.InvoiceWhereInput = {
      type: 'SALES',
      status: { not: 'REFUNDED' },
      salesOrder: salesPersonOrderFilter(opts.salesPersonId),
      invoiceDate: { gte: monthStart, lte: endOfDay(to) },
    };

    const todayEnd = endOfDay(to);
    const weekStart = startOfWeekMonday(to);

    const [
      orders,
      orderTotal,
      orderAgg,
      invoiceAgg,
      monthInvoiceAgg,
      statusGroups,
      targetAmount,
      todayMetrics,
      weekMetrics,
      monthMetrics,
    ] = await Promise.all([
      prisma.salesOrder.findMany({
        where: orderWhere,
        skip,
        take: limit,
        orderBy: [{ requiredDate: 'desc' }, { orderDate: 'desc' }],
        include: {
          customer: { select: { id: true, name: true, code: true } },
          invoices: {
            where: { type: 'SALES' },
            select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, status: true },
          },
        },
      }),
      prisma.salesOrder.count({ where: orderWhere }),
      prisma.salesOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true } }),
      prisma.invoice.aggregate({
        where: invoiceWhere,
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: monthInvoiceWhere,
        _sum: { totalAmount: true },
      }),
      prisma.salesOrder.groupBy({
        by: ['status'],
        where: orderWhere,
        _count: true,
        _sum: { totalAmount: true },
      }),
      this.getMonthlyTarget(opts.salesPersonId, to.getFullYear(), to.getMonth() + 1),
      getPeriodMetrics(opts.salesPersonId, startOfDay(to), todayEnd),
      getPeriodMetrics(opts.salesPersonId, weekStart, todayEnd),
      getPeriodMetrics(opts.salesPersonId, monthStart, todayEnd),
    ]);

    const totalSales = Number(orderAgg._sum.totalAmount || 0);
    const totalInvoiced = Number(invoiceAgg._sum.totalAmount || 0);
    const totalPaid = Number(invoiceAgg._sum.paidAmount || 0);
    const monthInvoiced = Number(monthInvoiceAgg._sum.totalAmount || 0);
    const achievementPercent =
      targetAmount > 0 ? Math.min(100, Math.round((monthInvoiced / targetAmount) * 100)) : null;

    return {
      salesPerson: {
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
      },
      period: { from: from.toISOString(), to: to.toISOString() },
      overview: {
        today: todayMetrics,
        week: weekMetrics,
        month: monthMetrics,
        monthlyTarget: targetAmount,
        monthAchievementPercent: achievementPercent,
      },
      summary: {
        totalSales,
        totalInvoiced,
        totalPaid,
        outstanding: totalInvoiced - totalPaid,
        invoiceCount: invoiceAgg._count,
        monthlyTarget: targetAmount,
        monthInvoiced,
        achievementPercent,
        ordersByStatus: statusGroups.map((group) => ({
          status: group.status,
          count: group._count,
          value: Number(group._sum.totalAmount || 0),
        })),
      },
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        customerCode: order.customer.code,
        orderDate: (order.requiredDate ?? order.orderDate).toISOString(),
        requiredDate: order.requiredDate?.toISOString() ?? null,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        invoicedAmount: order.invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0),
        paidAmount: order.invoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0),
        invoiceCount: order.invoices.length,
        isOverInvoiced:
          order.invoices.reduce((sum, inv) => sum + Number(inv.totalAmount), 0) >
          Number(order.totalAmount) + 0.01,
        invoices: order.invoices.map((inv) => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          totalAmount: Number(inv.totalAmount),
          paidAmount: Number(inv.paidAmount),
          status: inv.status,
        })),
      })),
      pagination: {
        page,
        limit,
        total: orderTotal,
        totalPages: Math.ceil(orderTotal / limit) || 1,
      },
    };
  }

  static async listTargets(year?: number, month?: number) {
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;

    const officers = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        salesTargets: { where: { year: y, month: m } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return officers.map((officer) => ({
      salesPersonId: officer.id,
      name: `${officer.firstName} ${officer.lastName}`.trim(),
      email: officer.email,
      year: y,
      month: m,
      targetAmount: officer.salesTargets[0] ? Number(officer.salesTargets[0].targetAmount) : 0,
    }));
  }

  static async upsertTarget(salesPersonId: string, year: number, month: number, targetAmount: number) {
    await this.assertSalesOfficer(salesPersonId);
    if (targetAmount < 0) throw new AppError('Target amount cannot be negative', 400);

    const target = await prisma.salesTarget.upsert({
      where: { salesPersonId_year_month: { salesPersonId, year, month } },
      create: injectTenantData({ salesPersonId, year, month, targetAmount }),
      update: { targetAmount },
    });

    return {
      salesPersonId,
      year,
      month,
      targetAmount: Number(target.targetAmount),
    };
  }
}
