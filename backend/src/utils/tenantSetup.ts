import type { Prisma } from '@prisma/client';
import { seedChartOfAccountsForCompany } from './chartOfAccounts';

type Tx = Prisma.TransactionClient;

export const DEFAULT_DEPARTMENT_NAMES = [
  'Management',
  'Production',
  'Procurement',
  'Warehouse',
  'Sales',
  'Finance',
  'HR',
  'Quality Control',
] as const;

export async function seedDepartmentsForCompany(tx: Tx, companyId: string) {
  for (const name of DEFAULT_DEPARTMENT_NAMES) {
    await tx.department.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name, description: `${name} department` },
    });
  }
}

export async function seedTenantDefaults(tx: Tx, companyId: string) {
  await seedDepartmentsForCompany(tx, companyId);
  await seedChartOfAccountsForCompany(tx, companyId);
}
