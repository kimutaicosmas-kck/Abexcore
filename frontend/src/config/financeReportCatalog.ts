export type FinanceReportCategory = 'company-financial' | 'accountant-taxes';

export type FinanceReportDefinition = {
  id: string;
  name: string;
  category: FinanceReportCategory;
  needsAccountCode?: boolean;
  usesAsOf?: boolean;
};

export const FINANCE_REPORT_CATEGORIES: { id: FinanceReportCategory; label: string }[] = [
  { id: 'company-financial', label: 'Company & Financial' },
  { id: 'accountant-taxes', label: 'Accountant & Taxes' },
];

export const FINANCE_REPORT_CATALOG: FinanceReportDefinition[] = [
  { id: 'profit-loss-standard', name: 'Profit & Loss Standard', category: 'company-financial' },
  { id: 'profit-loss-detail', name: 'Profit & Loss Detail', category: 'company-financial' },
  { id: 'profit-loss-ytd-comparison', name: 'Profit & Loss YTD Comparison', category: 'company-financial' },
  { id: 'profit-loss-prev-year-comparison', name: 'Profit & Loss Prev Year Comparison', category: 'company-financial' },
  { id: 'profit-loss-by-job', name: 'Profit & Loss by Job', category: 'company-financial' },
  { id: 'profit-loss-by-class', name: 'Profit & Loss by Class', category: 'company-financial' },
  { id: 'profit-loss-unclassified', name: 'Profit & Loss Unclassified', category: 'company-financial' },
  { id: 'income-by-customer-summary', name: 'Income by Customer Summary', category: 'company-financial' },
  { id: 'income-by-customer-detail', name: 'Income by Customer Detail', category: 'company-financial' },
  { id: 'expenses-by-vendor-summary', name: 'Expenses by Vendor Summary', category: 'company-financial' },
  { id: 'expenses-by-vendor-detail', name: 'Expenses by Vendor Detail', category: 'company-financial' },
  { id: 'income-expense-graph', name: 'Income & Expense Graph', category: 'company-financial' },
  { id: 'realized-gains-losses', name: 'Realized Gains & Losses', category: 'company-financial' },
  { id: 'unrealized-gains-losses', name: 'Unrealized Gains & Losses', category: 'company-financial' },
  { id: 'balance-sheet-standard', name: 'Balance Sheet Standard', category: 'company-financial', usesAsOf: true },
  { id: 'balance-sheet-detail', name: 'Balance Sheet Detail', category: 'company-financial', usesAsOf: true },
  { id: 'balance-sheet-summary', name: 'Balance Sheet Summary', category: 'company-financial', usesAsOf: true },
  { id: 'balance-sheet-prev-year-comparison', name: 'Balance Sheet Prev Year Comparison', category: 'company-financial', usesAsOf: true },
  { id: 'balance-sheet-by-class', name: 'Balance Sheet by Class', category: 'company-financial', usesAsOf: true },
  { id: 'net-worth-graph', name: 'Net Worth Graph', category: 'company-financial' },
  { id: 'statement-of-cash-flows', name: 'Statement of Cash Flows', category: 'company-financial' },
  { id: 'cash-flow-forecast', name: 'Cash Flow Forecast', category: 'company-financial' },
  { id: 'adjusted-trial-balance', name: 'Adjusted Trial Balance', category: 'accountant-taxes', usesAsOf: true },
  { id: 'trial-balance', name: 'Trial Balance', category: 'accountant-taxes', usesAsOf: true },
  { id: 'general-ledger', name: 'General Ledger', category: 'accountant-taxes' },
  { id: 'transaction-detail-by-account', name: 'Transaction Detail by Account', category: 'accountant-taxes', needsAccountCode: true },
  { id: 'adjusting-journal-entries', name: 'Adjusting Journal Entries', category: 'accountant-taxes' },
  { id: 'journal', name: 'Journal', category: 'accountant-taxes' },
  { id: 'audit-trail', name: 'Audit Trail', category: 'accountant-taxes' },
  { id: 'closing-date-exception-report', name: 'Closing Date Exception Report', category: 'accountant-taxes' },
  { id: 'customer-credit-card-audit-trail', name: 'Customer Credit Card Audit Trail', category: 'accountant-taxes' },
  { id: 'voided-deleted-transactions-summary', name: 'Voided/Deleted Transactions Summary', category: 'accountant-taxes' },
  { id: 'voided-deleted-transactions-detail', name: 'Voided/Deleted Transactions Detail', category: 'accountant-taxes' },
  { id: 'transaction-list-by-date', name: 'Transaction List by Date', category: 'accountant-taxes' },
  { id: 'account-listing', name: 'Account Listing', category: 'accountant-taxes' },
  { id: 'fixed-asset-listing', name: 'Fixed Asset Listing', category: 'accountant-taxes' },
  { id: 'income-tax-preparation', name: 'Income Tax Preparation', category: 'accountant-taxes' },
  { id: 'income-tax-summary', name: 'Income Tax Summary', category: 'accountant-taxes' },
  { id: 'income-tax-detail', name: 'Income Tax Detail', category: 'accountant-taxes' },
];

export function getFinanceReportById(id: string) {
  return FINANCE_REPORT_CATALOG.find((r) => r.id === id);
}
