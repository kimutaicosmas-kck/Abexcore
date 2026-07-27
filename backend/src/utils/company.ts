import prisma from '../config/database';
import { getTenantId } from './tenant';

export async function getCompanySettings(companyId?: string) {
  const tenantId = companyId ?? getTenantId();
  if (tenantId) {
    return prisma.company.findUnique({
      where: { id: tenantId },
      include: { branches: true, taxRates: true },
    });
  }
  return prisma.company.findFirst({
    include: { branches: true, taxRates: true },
  });
}

export async function getVatRate(companyId?: string): Promise<number> {
  const company = await getCompanySettings(companyId);
  return company ? Number(company.vatRate) : 16;
}

export async function getVatMultiplier(companyId?: string): Promise<number> {
  return (await getVatRate(companyId)) / 100;
}

export function calcTax(subtotal: number, vatRate: number): number {
  return subtotal * (vatRate / 100);
}
