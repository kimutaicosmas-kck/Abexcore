import prisma from '../config/database';
import { startOfMonth, endOfDay, subMonths } from '../utils/date';

export class FinancialReportsService {
  static async getProfitAndLoss(startDate?: Date, endDate?: Date) {
    const start = startDate || startOfMonth(new Date());
    const end = endDate || endOfDay(new Date());

    const [salesInvoices, purchaseInvoices, incomeAccounts, expenseAccounts] = await Promise.all([
      prisma.invoice.aggregate({
        where: { type: 'SALES', invoiceDate: { gte: start, lte: end }, status: { not: 'REFUNDED' } },
        _sum: { totalAmount: true, taxAmount: true, subtotal: true },
      }),
      prisma.invoice.aggregate({
        where: { type: 'PURCHASE', invoiceDate: { gte: start, lte: end } },
        _sum: { totalAmount: true, taxAmount: true, subtotal: true },
      }),
      prisma.account.findMany({ where: { type: 'INCOME', isActive: true } }),
      prisma.account.findMany({ where: { type: 'EXPENSE', isActive: true } }),
    ]);

    const revenue = Number(salesInvoices._sum.subtotal || 0);
    const cogs = Number(purchaseInvoices._sum.subtotal || 0);
    const grossProfit = revenue - cogs;
    const operatingExpenses = expenseAccounts.reduce((s, a) => s + Number(a.balance), 0);
    const otherIncome = incomeAccounts
      .filter((a) => !a.code.startsWith('4100'))
      .reduce((s, a) => s + Number(a.balance), 0);
    const netProfit = grossProfit - operatingExpenses + otherIncome;

    return {
      period: { start, end },
      revenue,
      costOfGoodsSold: cogs,
      grossProfit,
      operatingExpenses,
      otherIncome,
      netProfit,
      vatCollected: Number(salesInvoices._sum.taxAmount || 0),
      vatPaid: Number(purchaseInvoices._sum.taxAmount || 0),
    };
  }

  static async getBalanceSheet(asOfDate?: Date) {
    const asOf = asOfDate || new Date();

    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const grouped = {
      assets: accounts.filter((a) => a.type === 'ASSET'),
      liabilities: accounts.filter((a) => a.type === 'LIABILITY'),
      equity: accounts.filter((a) => a.type === 'EQUITY'),
    };

    const sum = (items: typeof accounts) =>
      items.reduce((s, a) => s + Number(a.balance), 0);

    const totalAssets = sum(grouped.assets);
    const totalLiabilities = sum(grouped.liabilities);
    const totalEquity = sum(grouped.equity);

    const [receivables, payables] = await Promise.all([
      prisma.invoice.aggregate({
        where: { type: 'SALES', status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.aggregate({
        where: { type: 'PURCHASE', status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      asOf,
      assets: grouped.assets.map((a) => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
      liabilities: grouped.liabilities.map((a) => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
      equity: grouped.equity.map((a) => ({ code: a.code, name: a.name, balance: Number(a.balance) })),
      totalAssets,
      totalLiabilities,
      totalEquity,
      accountsReceivable: Number(receivables._sum.totalAmount || 0),
      accountsPayable: Number(payables._sum.totalAmount || 0),
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  }

  static async getCashFlow(months = 6) {
    const flows: { month: string; inflow: number; outflow: number; net: number }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const date = subMonths(new Date(), i);
      const start = startOfMonth(date);
      const end = endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));

      const [inflows, outflows] = await Promise.all([
        prisma.payment.aggregate({
          where: { paymentDate: { gte: start, lte: end } },
          _sum: { amount: true },
        }),
        prisma.invoice.aggregate({
          where: { type: 'PURCHASE', invoiceDate: { gte: start, lte: end }, paidAmount: { gt: 0 } },
          _sum: { paidAmount: true },
        }),
      ]);

      const inflow = Number(inflows._sum.amount || 0);
      const outflow = Number(outflows._sum.paidAmount || 0);

      flows.push({
        month: start.toISOString().slice(0, 7),
        inflow,
        outflow,
        net: inflow - outflow,
      });
    }

    return {
      months: flows,
      totalInflow: flows.reduce((s, f) => s + f.inflow, 0),
      totalOutflow: flows.reduce((s, f) => s + f.outflow, 0),
      netCashFlow: flows.reduce((s, f) => s + f.net, 0),
    };
  }

  static async getVatReport(startDate?: Date, endDate?: Date) {
    const start = startDate || startOfMonth(new Date());
    const end = endDate || endOfDay(new Date());

    const [output, input] = await Promise.all([
      prisma.invoice.aggregate({
        where: { type: 'SALES', invoiceDate: { gte: start, lte: end } },
        _sum: { taxAmount: true, subtotal: true },
      }),
      prisma.invoice.aggregate({
        where: { type: 'PURCHASE', invoiceDate: { gte: start, lte: end } },
        _sum: { taxAmount: true, subtotal: true },
      }),
    ]);

    const outputVat = Number(output._sum.taxAmount || 0);
    const inputVat = Number(input._sum.taxAmount || 0);

    return {
      period: { start, end },
      taxableSales: Number(output._sum.subtotal || 0),
      outputVat,
      taxablePurchases: Number(input._sum.subtotal || 0),
      inputVat,
      netVatPayable: outputVat - inputVat,
    };
  }
}
