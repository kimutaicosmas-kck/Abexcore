import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { AccountingService } from './accounting.service';
import { FinancialReportsService } from './financial-reports.service';
import { endOfDay, startOfMonth, subMonths } from '../utils/date';

function subYears(date: Date, years: number) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() - years);
  return d;
}
import { requireTenantId } from '../utils/tenant';

export type FinanceModuleReportResult = {
  reportId: string;
  title: string;
  period?: { start?: string; end?: string; asOf?: string };
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
  notice?: string;
};

type ReportOpts = {
  start?: Date;
  end?: Date;
  asOf?: Date;
  accountCode?: string;
  limit?: number;
};

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function table(
  reportId: string,
  title: string,
  columns: FinanceModuleReportResult['columns'],
  rows: Record<string, unknown>[],
  extra?: Partial<FinanceModuleReportResult>
): FinanceModuleReportResult {
  return { reportId, title, columns, rows, ...extra };
}

function stub(reportId: string, title: string, notice: string): FinanceModuleReportResult {
  return table(reportId, title, [], [], { notice });
}

function defaultRange(opts: ReportOpts) {
  const end = opts.end || endOfDay(new Date());
  const start = opts.start || startOfMonth(end);
  return { start, end };
}

export class FinanceModuleReportsService {
  static async run(reportId: string, opts: ReportOpts = {}): Promise<FinanceModuleReportResult> {
    switch (reportId) {
      case 'profit-loss-standard':
        return this.profitLossStandard(opts);
      case 'profit-loss-detail':
        return this.profitLossDetail(opts);
      case 'profit-loss-ytd-comparison':
        return this.profitLossYtd(opts);
      case 'profit-loss-prev-year-comparison':
        return this.profitLossPrevYear(opts);
      case 'profit-loss-by-job':
        return this.profitLossByJob(opts);
      case 'profit-loss-by-class':
        return this.profitLossByClass(opts);
      case 'profit-loss-unclassified':
        return stub(
          reportId,
          'Profit & Loss Unclassified',
          'Class tracking is not configured. Use Profit & Loss by Class (customer type) instead.'
        );
      case 'income-by-customer-summary':
        return this.incomeByCustomerSummary(opts);
      case 'income-by-customer-detail':
        return this.incomeByCustomerDetail(opts);
      case 'expenses-by-vendor-summary':
        return this.expensesByVendorSummary(opts);
      case 'expenses-by-vendor-detail':
        return this.expensesByVendorDetail(opts);
      case 'income-expense-graph':
        return this.incomeExpenseGraph(opts);
      case 'realized-gains-losses':
      case 'unrealized-gains-losses':
        return stub(reportId, reportId.replace(/-/g, ' '), 'Foreign exchange gains and losses are not tracked in ABEXCORE.');
      case 'balance-sheet-standard':
        return this.balanceSheetStandard(opts);
      case 'balance-sheet-detail':
        return this.balanceSheetDetail(opts);
      case 'balance-sheet-summary':
        return this.balanceSheetSummary(opts);
      case 'balance-sheet-prev-year-comparison':
        return this.balanceSheetPrevYear(opts);
      case 'balance-sheet-by-class':
        return stub(reportId, 'Balance Sheet by Class', 'Class dimensions are not configured on the chart of accounts.');
      case 'net-worth-graph':
        return this.netWorthGraph(opts);
      case 'statement-of-cash-flows':
        return this.statementOfCashFlows(opts);
      case 'cash-flow-forecast':
        return stub(reportId, 'Cash Flow Forecast', 'Forecasting uses historical cash flow only — configure budgets for full forecast.');
      case 'adjusted-trial-balance':
      case 'trial-balance':
        return this.trialBalance(opts);
      case 'general-ledger':
        return this.generalLedger(opts);
      case 'transaction-detail-by-account':
        return this.transactionDetailByAccount(opts);
      case 'adjusting-journal-entries':
        return this.adjustingJournalEntries(opts);
      case 'journal':
        return this.journalReport(opts);
      case 'audit-trail':
        return this.auditTrail(opts);
      case 'closing-date-exception-report':
        return stub(reportId, 'Closing Date Exception Report', 'Accounting period locks are not enabled.');
      case 'customer-credit-card-audit-trail':
        return stub(reportId, 'Customer Credit Card Audit Trail', 'Card payments are recorded as standard receipts; no separate card audit trail.');
      case 'voided-deleted-transactions-summary':
        return this.voidedDeletedSummary(opts);
      case 'voided-deleted-transactions-detail':
        return this.voidedDeletedDetail(opts);
      case 'transaction-list-by-date':
        return this.transactionListByDate(opts);
      case 'account-listing':
        return this.accountListing(opts);
      case 'fixed-asset-listing':
        return stub(reportId, 'Fixed Asset Listing', 'Fixed asset register is not configured. Track assets under Accounts with type ASSET.');
      case 'income-tax-preparation':
      case 'income-tax-summary':
        return this.incomeTaxSummary(opts);
      case 'income-tax-detail':
        return this.incomeTaxDetail(opts);
      default:
        throw new AppError(`Unknown finance report: ${reportId}`, 404);
    }
  }

  private static async profitLossStandard(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const pl = await FinancialReportsService.getProfitAndLoss(start, end);
    const rows = [
      { line: 'Revenue', amount: pl.revenue },
      { line: 'Cost of Goods Sold', amount: -pl.costOfGoodsSold },
      { line: 'Gross Profit', amount: pl.grossProfit },
      { line: 'Operating Expenses', amount: -pl.operatingExpenses },
      { line: 'Other Income', amount: pl.otherIncome },
      { line: 'Net Profit', amount: pl.netProfit },
    ];
    return table('profit-loss-standard', 'Profit & Loss Standard', [
      { key: 'line', label: 'Line' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) }, summary: { netProfit: pl.netProfit } });
  }

  private static async profitLossDetail(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const accounts = await prisma.account.findMany({
      where: { isActive: true, type: { in: ['INCOME', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });
    const rows: Record<string, unknown>[] = [];
    for (const account of accounts) {
      const amount = await AccountingService.getAccountActivityInPeriod(account.code, start, end);
      if (Math.abs(amount) < 0.009) continue;
      rows.push({
        code: account.code,
        account: account.name,
        type: account.type,
        amount,
      });
    }
    return table('profit-loss-detail', 'Profit & Loss Detail', [
      { key: 'code', label: 'Code' },
      { key: 'account', label: 'Account' },
      { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async profitLossYtd(opts: ReportOpts) {
    const end = opts.end || endOfDay(new Date());
    const start = new Date(end.getFullYear(), 0, 1);
    return this.profitLossStandard({ ...opts, start, end });
  }

  private static async profitLossPrevYear(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const current = await FinancialReportsService.getProfitAndLoss(start, end);
    const prevStart = subYears(start, 1);
    const prevEnd = subYears(end, 1);
    const previous = await FinancialReportsService.getProfitAndLoss(prevStart, prevEnd);
    const rows = [
      { line: 'Revenue', current: current.revenue, previous: previous.revenue },
      { line: 'Net Profit', current: current.netProfit, previous: previous.netProfit },
    ];
    return table('profit-loss-prev-year-comparison', 'Profit & Loss Prev Year Comparison', [
      { key: 'line', label: 'Line' },
      { key: 'current', label: 'Current (KES)', align: 'right' },
      { key: 'previous', label: 'Previous year (KES)', align: 'right' },
    ], rows, {
      period: { start: fmtDate(start), end: fmtDate(end) },
      notice: `Previous year period: ${fmtDate(prevStart)} to ${fmtDate(prevEnd)}`,
    });
  }

  private static async profitLossByJob(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const invoices = await prisma.invoice.findMany({
      where: {
        type: 'SALES',
        invoiceDate: { gte: start, lte: end },
        status: { not: 'REFUNDED' },
      },
      include: {
        salesOrder: { select: { orderNumber: true } },
      },
    });
    const byJob = new Map<string, number>();
    for (const inv of invoices) {
      const key = inv.salesOrder?.orderNumber || 'No job / direct invoice';
      byJob.set(key, (byJob.get(key) || 0) + Number(inv.totalAmount));
    }
    const rows = [...byJob.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([job, revenue]) => ({ job, revenue }));
    return table('profit-loss-by-job', 'Profit & Loss by Job', [
      { key: 'job', label: 'Job / Order' },
      { key: 'revenue', label: 'Revenue (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async profitLossByClass(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const grouped = await prisma.invoice.groupBy({
      by: ['customerId'],
      where: {
        type: 'SALES',
        invoiceDate: { gte: start, lte: end },
        status: { not: 'REFUNDED' },
        customerId: { not: null },
      },
      _sum: { totalAmount: true },
    });
    const customerIds = grouped.map((g) => g.customerId!).filter(Boolean);
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, type: true },
    });
    const typeById = new Map(customers.map((c) => [c.id, c.type]));
    const byClass = new Map<string, number>();
    for (const row of grouped) {
      if (!row.customerId) continue;
      const cls = typeById.get(row.customerId) || 'UNCLASSIFIED';
      byClass.set(cls, (byClass.get(cls) || 0) + Number(row._sum.totalAmount || 0));
    }
    const rows = [...byClass.entries()].map(([customerClass, revenue]) => ({
      customerClass: customerClass.replace(/_/g, ' '),
      revenue,
    }));
    return table('profit-loss-by-class', 'Profit & Loss by Class', [
      { key: 'customerClass', label: 'Customer class' },
      { key: 'revenue', label: 'Revenue (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async incomeByCustomerSummary(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const rows = await prisma.invoice.groupBy({
      by: ['customerId'],
      where: {
        type: 'SALES',
        invoiceDate: { gte: start, lte: end },
        status: { not: 'REFUNDED' },
        customerId: { not: null },
      },
      _sum: { totalAmount: true, paidAmount: true },
      _count: { _all: true },
    });
    const customers = await prisma.customer.findMany({
      where: { id: { in: rows.map((r) => r.customerId!).filter(Boolean) } },
      select: { id: true, name: true, code: true },
    });
    const nameById = new Map(customers.map((c) => [c.id, c]));
    const out = rows
      .map((r) => {
        const c = nameById.get(r.customerId!);
        return {
          customer: c?.name || '—',
          code: c?.code || '—',
          invoices: r._count._all,
          total: Number(r._sum.totalAmount || 0),
          paid: Number(r._sum.paidAmount || 0),
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
    return table('income-by-customer-summary', 'Income by Customer Summary', [
      { key: 'customer', label: 'Customer' },
      { key: 'code', label: 'Code' },
      { key: 'invoices', label: 'Invoices', align: 'right' },
      { key: 'total', label: 'Total (KES)', align: 'right' },
      { key: 'paid', label: 'Paid (KES)', align: 'right' },
    ], out, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async incomeByCustomerDetail(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const invoices = await prisma.invoice.findMany({
      where: {
        type: 'SALES',
        invoiceDate: { gte: start, lte: end },
        status: { not: 'REFUNDED' },
      },
      include: {
        customer: { select: { name: true, code: true } },
        items: true,
      },
      orderBy: { invoiceDate: 'desc' },
      take: opts.limit || 500,
    });
    const rows = invoices.flatMap((inv) =>
      inv.items.map((item) => ({
        date: fmtDate(inv.invoiceDate),
        invoice: inv.invoiceNumber,
        customer: inv.customer?.name || '—',
        description: item.description,
        quantity: Number(item.quantity),
        amount: Number(item.totalPrice),
      }))
    );
    return table('income-by-customer-detail', 'Income by Customer Detail', [
      { key: 'date', label: 'Date' },
      { key: 'invoice', label: 'Invoice' },
      { key: 'customer', label: 'Customer' },
      { key: 'description', label: 'Description' },
      { key: 'quantity', label: 'Qty', align: 'right' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async expensesByVendorSummary(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const purchaseRows = await prisma.invoice.groupBy({
      by: ['supplierId'],
      where: {
        type: 'PURCHASE',
        invoiceDate: { gte: start, lte: end },
        supplierId: { not: null },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    const supplierIds = purchaseRows.map((r) => r.supplierId!).filter(Boolean);
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const rows = purchaseRows.map((r) => ({
      vendor: nameById.get(r.supplierId!) || '—',
      bills: r._count._all,
      amount: Number(r._sum.totalAmount || 0),
    }));
    const expenses = await prisma.expense.aggregate({
      where: { expenseDate: { gte: start, lte: end }, status: { in: ['APPROVED', 'POSTED'] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    });
    if (Number(expenses._sum.totalAmount || 0) > 0) {
      rows.push({
        vendor: 'Operating expenses (approved)',
        bills: expenses._count._all,
        amount: Number(expenses._sum.totalAmount || 0),
      });
    }
    return table('expenses-by-vendor-summary', 'Expenses by Vendor Summary', [
      { key: 'vendor', label: 'Vendor / Payee' },
      { key: 'bills', label: 'Count', align: 'right' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows.sort((a, b) => Number(b.amount) - Number(a.amount)), {
      period: { start: fmtDate(start), end: fmtDate(end) },
    });
  }

  private static async expensesByVendorDetail(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const invoices = await prisma.invoice.findMany({
      where: { type: 'PURCHASE', invoiceDate: { gte: start, lte: end } },
      include: { supplier: { select: { name: true } }, items: true },
      take: opts.limit || 300,
    });
    const rows = invoices.flatMap((inv) =>
      inv.items.map((item) => ({
        date: fmtDate(inv.invoiceDate),
        bill: inv.invoiceNumber,
        vendor: inv.supplier?.name || '—',
        description: item.description,
        amount: Number(item.totalPrice),
      }))
    );
    return table('expenses-by-vendor-detail', 'Expenses by Vendor Detail', [
      { key: 'date', label: 'Date' },
      { key: 'bill', label: 'Bill' },
      { key: 'vendor', label: 'Vendor' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async incomeExpenseGraph(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const pl = await FinancialReportsService.getProfitAndLoss(start, end);
    return table(
      'income-expense-graph',
      'Income & Expense Graph',
      [
        { key: 'category', label: 'Category' },
        { key: 'amount', label: 'Amount (KES)', align: 'right' },
      ],
      [
        { category: 'Income', amount: pl.revenue + pl.otherIncome },
        { category: 'COGS', amount: pl.costOfGoodsSold },
        { category: 'Operating expenses', amount: pl.operatingExpenses },
        { category: 'Net profit', amount: pl.netProfit },
      ],
      { period: { start: fmtDate(start), end: fmtDate(end) } }
    );
  }

  private static async balanceSheetStandard(opts: ReportOpts) {
    const asOf = opts.asOf || new Date();
    const bs = await FinancialReportsService.getBalanceSheet(asOf);
    const rows = [
      { section: 'Assets', total: bs.totalAssets },
      { section: 'Liabilities', total: bs.totalLiabilities },
      { section: 'Equity', total: bs.totalEquity },
    ];
    return table('balance-sheet-standard', 'Balance Sheet Standard', [
      { key: 'section', label: 'Section' },
      { key: 'total', label: 'Total (KES)', align: 'right' },
    ], rows, { period: { asOf: fmtDate(asOf) }, summary: { balanced: bs.balanced } });
  }

  private static async balanceSheetDetail(opts: ReportOpts) {
    const asOf = opts.asOf || new Date();
    const bs = await FinancialReportsService.getBalanceSheet(asOf);
    const rows = [
      ...bs.assets.map((a) => ({ type: 'ASSET', code: a.code, name: a.name, balance: a.balance })),
      ...bs.liabilities.map((a) => ({ type: 'LIABILITY', code: a.code, name: a.name, balance: a.balance })),
      ...bs.equity.map((a) => ({ type: 'EQUITY', code: a.code, name: a.name, balance: a.balance })),
    ];
    return table('balance-sheet-detail', 'Balance Sheet Detail', [
      { key: 'type', label: 'Type' },
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Account' },
      { key: 'balance', label: 'Balance (KES)', align: 'right' },
    ], rows, { period: { asOf: fmtDate(asOf) } });
  }

  private static async balanceSheetSummary(opts: ReportOpts) {
    return this.balanceSheetStandard(opts);
  }

  private static async balanceSheetPrevYear(opts: ReportOpts) {
    const asOf = opts.asOf || new Date();
    const current = await FinancialReportsService.getBalanceSheet(asOf);
    const prev = await FinancialReportsService.getBalanceSheet(subYears(asOf, 1));
    const rows = [
      { line: 'Total assets', current: current.totalAssets, previous: prev.totalAssets },
      { line: 'Total liabilities', current: current.totalLiabilities, previous: prev.totalLiabilities },
      { line: 'Total equity', current: current.totalEquity, previous: prev.totalEquity },
    ];
    return table('balance-sheet-prev-year-comparison', 'Balance Sheet Prev Year Comparison', [
      { key: 'line', label: 'Line' },
      { key: 'current', label: 'Current (KES)', align: 'right' },
      { key: 'previous', label: 'Previous year (KES)', align: 'right' },
    ], rows, { period: { asOf: fmtDate(asOf) } });
  }

  private static async netWorthGraph(opts: ReportOpts) {
    const months = 6;
    const rows: Record<string, unknown>[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = subMonths(new Date(), i);
      const bs = await FinancialReportsService.getBalanceSheet(endOfDay(d));
      rows.push({ month: fmtDate(startOfMonth(d)).slice(0, 7), netWorth: bs.totalEquity });
    }
    return table('net-worth-graph', 'Net Worth Graph', [
      { key: 'month', label: 'Month' },
      { key: 'netWorth', label: 'Equity (KES)', align: 'right' },
    ], rows);
  }

  private static async statementOfCashFlows(opts: ReportOpts) {
    const cf = await FinancialReportsService.getCashFlow(6);
    const rows = cf.months.map((m) => ({
      month: m.month,
      inflow: m.inflow,
      outflow: m.outflow,
      net: m.net,
    }));
    return table('statement-of-cash-flows', 'Statement of Cash Flows', [
      { key: 'month', label: 'Month' },
      { key: 'inflow', label: 'Inflow (KES)', align: 'right' },
      { key: 'outflow', label: 'Outflow (KES)', align: 'right' },
      { key: 'net', label: 'Net (KES)', align: 'right' },
    ], rows, { summary: { totalInflow: cf.totalInflow, totalOutflow: cf.totalOutflow, net: cf.netCashFlow } });
  }

  private static async trialBalance(opts: ReportOpts) {
    const asOf = opts.asOf || new Date();
    const tb = await AccountingService.getTrialBalance(asOf);
    const rows = tb.accounts.map((a) => ({
      code: a.code,
      name: a.name,
      debit: a.debit,
      credit: a.credit,
    }));
    return table('trial-balance', 'Trial Balance', [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Account' },
      { key: 'debit', label: 'Debit (KES)', align: 'right' },
      { key: 'credit', label: 'Credit (KES)', align: 'right' },
    ], rows, {
      period: { asOf: fmtDate(asOf) },
      summary: { totalDebit: tb.totalDebit, totalCredit: tb.totalCredit, balanced: tb.balanced },
    });
  }

  private static async generalLedger(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    if (opts.accountCode) {
      const gl = await AccountingService.getGeneralLedger(opts.accountCode, start, end);
      return table('general-ledger', `General Ledger — ${opts.accountCode}`, [
        { key: 'date', label: 'Date' },
        { key: 'entry', label: 'Entry' },
        { key: 'description', label: 'Description' },
        { key: 'debit', label: 'Debit', align: 'right' },
        { key: 'credit', label: 'Credit', align: 'right' },
        { key: 'balance', label: 'Balance', align: 'right' },
      ], gl.entries.map((e) => ({
        date: fmtDate(e.date),
        entry: e.entryNumber,
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        balance: e.runningBalance,
      })), { period: { start: fmtDate(start), end: fmtDate(end) } });
    }
    const accounts = await prisma.account.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
    const rows = await Promise.all(
      accounts.map(async (a) => ({
        code: a.code,
        name: a.name,
        activity: await AccountingService.getAccountActivityInPeriod(a.code, start, end),
        balance: Number(a.balance),
      }))
    );
    return table('general-ledger', 'General Ledger (all accounts)', [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Account' },
      { key: 'activity', label: 'Period activity (KES)', align: 'right' },
      { key: 'balance', label: 'Balance (KES)', align: 'right' },
    ], rows.filter((r) => Math.abs(Number(r.activity)) > 0.009 || Math.abs(Number(r.balance)) > 0.009), {
      period: { start: fmtDate(start), end: fmtDate(end) },
      notice: 'Pass accountCode to drill into a single account.',
    });
  }

  private static async transactionDetailByAccount(opts: ReportOpts) {
    if (!opts.accountCode) {
      throw new AppError('accountCode is required for Transaction Detail by Account', 400);
    }
    return this.generalLedger({ ...opts, accountCode: opts.accountCode });
  }

  private static async adjustingJournalEntries(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const entries = await prisma.journalEntry.findMany({
      where: {
        date: { gte: start, lte: end },
        OR: [{ sourceType: null }, { sourceType: 'MANUAL' }, { sourceType: 'ADJUSTMENT' }],
      },
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      take: opts.limit || 200,
    });
    const rows = entries.flatMap((e) =>
      e.lines.map((line) => ({
        date: fmtDate(e.date),
        entry: e.entryNumber,
        description: e.description,
        account: `${line.account.code} ${line.account.name}`,
        debit: Number(line.debit),
        credit: Number(line.credit),
      }))
    );
    return table('adjusting-journal-entries', 'Adjusting Journal Entries', [
      { key: 'date', label: 'Date' },
      { key: 'entry', label: 'Entry' },
      { key: 'description', label: 'Description' },
      { key: 'account', label: 'Account' },
      { key: 'debit', label: 'Debit', align: 'right' },
      { key: 'credit', label: 'Credit', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async journalReport(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const entries = await prisma.journalEntry.findMany({
      where: { date: { gte: start, lte: end }, isPosted: true },
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      take: opts.limit || 200,
    });
    const rows = entries.map((e) => ({
      date: fmtDate(e.date),
      entry: e.entryNumber,
      description: e.description,
      reference: e.reference || '—',
      source: e.sourceType || 'MANUAL',
      debit: e.lines.reduce((s, l) => s + Number(l.debit), 0),
      credit: e.lines.reduce((s, l) => s + Number(l.credit), 0),
    }));
    return table('journal', 'Journal', [
      { key: 'date', label: 'Date' },
      { key: 'entry', label: 'Entry #' },
      { key: 'description', label: 'Description' },
      { key: 'reference', label: 'Reference' },
      { key: 'source', label: 'Source' },
      { key: 'debit', label: 'Debit', align: 'right' },
      { key: 'credit', label: 'Credit', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async auditTrail(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const companyId = requireTenantId();
    const logs = await prisma.auditLog.findMany({
      where: {
        companyId,
        module: { in: ['finance', 'customers'] },
        createdAt: { gte: start, lte: end },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit || 300,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    });
    const rows = logs.map((l) => ({
      when: l.createdAt.toISOString(),
      user: l.user ? `${l.user.firstName} ${l.user.lastName}`.trim() : '—',
      action: l.action,
      entity: `${l.entityType}${l.entityId ? ` (${l.entityId.slice(0, 8)}…)` : ''}`,
    }));
    return table('audit-trail', 'Audit Trail', [
      { key: 'when', label: 'When' },
      { key: 'user', label: 'User' },
      { key: 'action', label: 'Action' },
      { key: 'entity', label: 'Entity' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async voidedDeletedSummary(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const companyId = requireTenantId();
    const logs = await prisma.auditLog.groupBy({
      by: ['entityType'],
      where: {
        companyId,
        module: 'finance',
        action: { in: ['delete', 'update'] },
        createdAt: { gte: start, lte: end },
      },
      _count: { _all: true },
    });
    const rows = logs.map((l) => ({ entityType: l.entityType, events: l._count._all }));
    return table('voided-deleted-transactions-summary', 'Voided/Deleted Transactions Summary', [
      { key: 'entityType', label: 'Entity type' },
      { key: 'events', label: 'Events', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async voidedDeletedDetail(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const companyId = requireTenantId();
    const logs = await prisma.auditLog.findMany({
      where: {
        companyId,
        module: 'finance',
        action: { in: ['delete', 'update'] },
        createdAt: { gte: start, lte: end },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit || 300,
    });
    const rows = logs.map((l) => ({
      when: l.createdAt.toISOString(),
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId || '—',
    }));
    return table('voided-deleted-transactions-detail', 'Voided/Deleted Transactions Detail', [
      { key: 'when', label: 'When' },
      { key: 'action', label: 'Action' },
      { key: 'entityType', label: 'Type' },
      { key: 'entityId', label: 'Entity ID' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async transactionListByDate(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const [payments, invoices] = await Promise.all([
      prisma.payment.findMany({
        where: { paymentDate: { gte: start, lte: end } },
        orderBy: { paymentDate: 'desc' },
        take: opts.limit || 200,
      }),
      prisma.invoice.findMany({
        where: { invoiceDate: { gte: start, lte: end }, type: { in: ['SALES', 'PURCHASE'] } },
        orderBy: { invoiceDate: 'desc' },
        take: opts.limit || 200,
      }),
    ]);
    const rows = [
      ...payments.map((p) => ({
        date: fmtDate(p.paymentDate),
        type: 'Payment',
        number: p.paymentNumber,
        amount: Number(p.amount),
      })),
      ...invoices.map((i) => ({
        date: fmtDate(i.invoiceDate),
        type: i.type,
        number: i.invoiceNumber,
        amount: Number(i.totalAmount),
      })),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return table('transaction-list-by-date', 'Transaction List by Date', [
      { key: 'date', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'number', label: 'Number' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async accountListing(_opts: ReportOpts) {
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    const rows = accounts.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.type,
      balance: Number(a.balance),
    }));
    return table('account-listing', 'Account Listing', [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'balance', label: 'Balance (KES)', align: 'right' },
    ], rows);
  }

  private static async incomeTaxSummary(opts: ReportOpts) {
    const { start, end } = defaultRange(opts);
    const vat = await FinancialReportsService.getVatReport(start, end);
    const pl = await FinancialReportsService.getProfitAndLoss(start, end);
    const rows = [
      { line: 'Taxable sales', amount: vat.taxableSales },
      { line: 'Output VAT', amount: vat.outputVat },
      { line: 'Taxable purchases', amount: vat.taxablePurchases },
      { line: 'Input VAT', amount: vat.inputVat },
      { line: 'Net VAT payable', amount: vat.netVatPayable },
      { line: 'Net profit (reference)', amount: pl.netProfit },
    ];
    return table('income-tax-summary', 'Income Tax Summary', [
      { key: 'line', label: 'Line' },
      { key: 'amount', label: 'Amount (KES)', align: 'right' },
    ], rows, { period: { start: fmtDate(start), end: fmtDate(end) } });
  }

  private static async incomeTaxDetail(opts: ReportOpts) {
    return this.incomeTaxSummary(opts);
  }
}

export const FINANCE_MODULE_REPORT_IDS = [
  'profit-loss-standard',
  'profit-loss-detail',
  'profit-loss-ytd-comparison',
  'profit-loss-prev-year-comparison',
  'profit-loss-by-job',
  'profit-loss-by-class',
  'profit-loss-unclassified',
  'income-by-customer-summary',
  'income-by-customer-detail',
  'expenses-by-vendor-summary',
  'expenses-by-vendor-detail',
  'income-expense-graph',
  'realized-gains-losses',
  'unrealized-gains-losses',
  'balance-sheet-standard',
  'balance-sheet-detail',
  'balance-sheet-summary',
  'balance-sheet-prev-year-comparison',
  'balance-sheet-by-class',
  'net-worth-graph',
  'statement-of-cash-flows',
  'cash-flow-forecast',
  'adjusted-trial-balance',
  'trial-balance',
  'general-ledger',
  'transaction-detail-by-account',
  'adjusting-journal-entries',
  'journal',
  'audit-trail',
  'closing-date-exception-report',
  'customer-credit-card-audit-trail',
  'voided-deleted-transactions-summary',
  'voided-deleted-transactions-detail',
  'transaction-list-by-date',
  'account-listing',
  'fixed-asset-listing',
  'income-tax-preparation',
  'income-tax-summary',
  'income-tax-detail',
] as const;
