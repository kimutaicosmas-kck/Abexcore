import type { Prisma } from '@prisma/client';

export const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: '1000', name: 'Assets', type: 'ASSET' as const },
  { code: '1100', name: 'Cash & Bank', type: 'ASSET' as const },
  { code: '1110', name: 'M-Pesa Float', type: 'ASSET' as const },
  { code: '1120', name: 'Bank Accounts', type: 'ASSET' as const },
  { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
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
