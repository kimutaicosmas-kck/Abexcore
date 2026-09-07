import type { Prisma } from '@prisma/client';
import { isSalesBookOwner } from '../config/rolePermissions';

/** Sales book + unassigned pool — shared CRM customer visibility for sales roles. */
export function salesBookCustomerFilter(salesPersonId: string): Prisma.CustomerWhereInput {
  return {
    OR: [{ salesPersonId }, { salesPersonId: null }],
  };
}

/** Limit customer queries for sales book owners; no-op for other roles. */
export function salesBookCustomerVisibility(
  roleName: string | null | undefined,
  userId: string
): Prisma.CustomerWhereInput {
  if (!isSalesBookOwner(roleName)) return {};
  return salesBookCustomerFilter(userId);
}

export function canAccessCustomerRecord(
  customer: { salesPersonId: string | null },
  roleName: string | null | undefined,
  userId: string
): boolean {
  if (!isSalesBookOwner(roleName)) return true;
  return customer.salesPersonId === userId || customer.salesPersonId === null;
}
