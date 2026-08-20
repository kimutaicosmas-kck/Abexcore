import type { Prisma } from '@prisma/client';

export const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Assets', type: 'ASSET' as const },
  { code: '1100', name: 'Cash & Bank', type: 'ASSET' as const },
  { code: '1110', name: 'M-Pesa Float', type: 'ASSET' as const },
  { code: '1120', name: 'Bank Accounts', type: 'ASSET' as const },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
  { code: '1210', name: 'Staff Salary Advances', type: 'ASSET' as const },
  { code: '1250', name: 'VAT Input Recoverable', type: 'ASSET' as const },
  { code: '1300', name: 'Inventory', type: 'ASSET' as const },
  { code: '2000', name: 'Liabilities', type: 'LIABILITY' as const },
  { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' as const },
  { code: '2150', name: 'Goods Received Not Invoiced', type: 'LIABILITY' as const },
  { code: '2200', name: 'VAT Payable', type: 'LIABILITY' as const },
  { code: '3000', name: 'Equity', type: 'EQUITY' as const },
  { code: '4000', name: 'Revenue', type: 'INCOME' as const },
  { code: '4100', name: 'Sales Revenue', type: 'INCOME' as const },
  { code: '5000', name: 'Expenses', type: 'EXPENSE' as const },
  { code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE' as const },
  { code: '5200', name: 'Operating Expenses', type: 'EXPENSE' as const },
  { code: '5210', name: 'Rent & Rates', type: 'EXPENSE' as const },
  { code: '5220', name: 'Utilities', type: 'EXPENSE' as const },
  { code: '5230', name: 'Fuel & Transport', type: 'EXPENSE' as const },
  { code: '5240', name: 'Office & Admin', type: 'EXPENSE' as const },
  { code: '5250', name: 'Communications', type: 'EXPENSE' as const },
  { code: '5260', name: 'Repairs & Maintenance', type: 'EXPENSE' as const },
  { code: '5270', name: 'Staff Welfare & Meals', type: 'EXPENSE' as const },
  { code: '5280', name: 'Professional Fees', type: 'EXPENSE' as const },
  { code: '5290', name: 'Other Operating Expenses', type: 'EXPENSE' as const },
] as const;

type Tx = Prisma.TransactionClient;

export async function seedChartOfAccountsForCompany(tx: Tx, companyId: string) {
  for (const acc of DEFAULT_CHART_OF_ACCOUNTS) {
    await tx.account.upsert({
      where: { companyId_code: { companyId, code: acc.code } },
      update: { name: acc.name, type: acc.type, isActive: true, balance: 0 },
      create: { companyId, code: acc.code, name: acc.name, type: acc.type },
    });
  }
}
