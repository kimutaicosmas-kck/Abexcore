import prisma from '../config/database';

export async function getCompanySettings() {
  const company = await prisma.company.findFirst({
    include: { branches: true, taxRates: true },
  });
  return company;
}

export async function getVatRate(): Promise<number> {
  const company = await getCompanySettings();
  return company ? Number(company.vatRate) : 16;
}

export async function getVatMultiplier(): Promise<number> {
  return (await getVatRate()) / 100;
}

export function calcTax(subtotal: number, vatRate: number): number {
  return subtotal * (vatRate / 100);
}
