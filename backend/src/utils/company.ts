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

/** VAT on a net (exclusive) amount — used for purchases / supplier invoices. */
export function calcTax(subtotal: number, vatRate: number): number {
  return subtotal * (vatRate / 100);
}

/**
 * Sales prices are VAT-inclusive: the salesperson's keyed total is the customer total.
 * Split into net + VAT for accounting (do not add VAT on top).
 * NON_VAT (rate 0) leaves the amount unchanged.
 */
export function splitInclusiveAmount(inclusive: number, vatRate: number) {
  if (vatRate <= 0 || inclusive <= 0) {
    return { subtotal: inclusive, taxAmount: 0, totalAmount: inclusive };
  }
  const taxAmount = inclusive * (vatRate / (100 + vatRate));
  const subtotal = inclusive - taxAmount;
  return { subtotal, taxAmount, totalAmount: inclusive };
}

/** Effective VAT % for a customer: Non-VAT customers are invoiced at 0%. */
export async function getCustomerVatRate(
  customer?: { vatStatus?: string | null } | null,
  companyId?: string
): Promise<number> {
  if (customer?.vatStatus === 'NON_VAT') return 0;
  return getVatRate(companyId);
}
