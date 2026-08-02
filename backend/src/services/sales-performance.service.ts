import prisma from '../config/database';
import { SALES_PERSON_ROLE_NAMES } from '../config/rolePermissions';
import { endOfDay, startOfDay } from '../utils/date';
import { salesPersonOrderFilter, MySalesService } from './my-sales.service';

function resolvePeriod(from?: string, to?: string) {
  const now = new Date();
  const fromDate = from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const toDate = to ?? now.toISOString().slice(0, 10);
  return {
    from: startOfDay(new Date(fromDate)),
    to: endOfDay(new Date(toDate)),
    fromDate,
    toDate,
  };
}

export class SalesPerformanceService {
  static async getTeamPerformance(from?: string, to?: string) {
    const period = resolvePeriod(from, to);
    const monthStart = startOfDay(new Date(period.to.getFullYear(), period.to.getMonth(), 1));
    const targetYear = period.to.getFullYear();
    const targetMonth = period.to.getMonth() + 1;

    const officers = await prisma.user.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        role: { name: { in: [...SALES_PERSON_ROLE_NAMES] } },
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const performers = await Promise.all(
      officers.map(async (officer) => {
        const personFilter = salesPersonOrderFilter(officer.id);
        const orderWhere = {
          ...personFilter,
          orderDate: { gte: period.from, lte: period.to },
        };
        const invoiceWhere = {
          type: 'SALES' as const,
          status: { not: 'REFUNDED' as const },
          salesOrder: personFilter,
          invoiceDate: { gte: period.from, lte: period.to },
        };
        const monthInvoiceWhere = {
          type: 'SALES' as const,
          status: { not: 'REFUNDED' as const },
          salesOrder: personFilter,
          invoiceDate: { gte: monthStart, lte: period.to },
        };

        const [orderAgg, orderCount, invoiceAgg, monthInvoiceAgg, targetAmount] =
          await Promise.all([
            prisma.salesOrder.aggregate({ where: orderWhere, _sum: { totalAmount: true } }),
            prisma.salesOrder.count({ where: orderWhere }),
            prisma.invoice.aggregate({
              where: invoiceWhere,
              _sum: { totalAmount: true, paidAmount: true },
              _count: true,
            }),
            prisma.invoice.aggregate({
              where: monthInvoiceWhere,
              _sum: { totalAmount: true },
            }),
            MySalesService.getMonthlyTarget(officer.id, targetYear, targetMonth),
          ]);

        const orderValue = Number(orderAgg._sum.totalAmount || 0);
        const invoiced = Number(invoiceAgg._sum.totalAmount || 0);
        const collected = Number(invoiceAgg._sum.paidAmount || 0);
        const monthInvoiced = Number(monthInvoiceAgg._sum.totalAmount || 0);
        const achievementPercent =
          targetAmount > 0 ? Math.min(100, Math.round((monthInvoiced / targetAmount) * 100)) : null;

        return {
          salesPersonId: officer.id,
          name: `${officer.firstName} ${officer.lastName}`.trim(),
          email: officer.email,
          orderCount,
          orderValue,
          invoiceCount: invoiceAgg._count,
          invoiced,
          collected,
          outstanding: invoiced - collected,
          monthlyTarget: targetAmount,
          monthInvoiced,
          achievementPercent,
        };
      })
    );

    performers.sort((a, b) => b.invoiced - a.invoiced || b.orderValue - a.orderValue);

    const ranked = performers.map((row, index) => ({ ...row, rank: index + 1 }));

    const summary = ranked.reduce(
      (acc, row) => ({
        orderCount: acc.orderCount + row.orderCount,
        orderValue: acc.orderValue + row.orderValue,
        invoiceCount: acc.invoiceCount + row.invoiceCount,
        invoiced: acc.invoiced + row.invoiced,
        collected: acc.collected + row.collected,
        outstanding: acc.outstanding + row.outstanding,
        withTarget: acc.withTarget + (row.monthlyTarget > 0 ? 1 : 0),
        achievementTotal:
          acc.achievementTotal + (row.achievementPercent != null ? row.achievementPercent : 0),
      }),
      {
        orderCount: 0,
        orderValue: 0,
        invoiceCount: 0,
        invoiced: 0,
        collected: 0,
        outstanding: 0,
        withTarget: 0,
        achievementTotal: 0,
      }
    );

    return {
      period: { from: period.fromDate, to: period.toDate },
      summary: {
        ...summary,
        salesPeople: ranked.length,
        avgAchievement:
          summary.withTarget > 0
            ? Math.round(summary.achievementTotal / summary.withTarget)
            : null,
      },
      performers: ranked,
    };
  }
}
