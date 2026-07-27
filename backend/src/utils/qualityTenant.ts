import { Prisma } from '@prisma/client';

/** Scope quality inspections to a tenant via linked production orders, GRNs, or products. */
export function qualityInspectionTenantWhere(companyId: string): Prisma.QualityInspectionWhereInput {
  return {
    OR: [
      { productionOrder: { companyId } },
      { goodsReceipt: { companyId } },
      { product: { companyId } },
    ],
  };
}
