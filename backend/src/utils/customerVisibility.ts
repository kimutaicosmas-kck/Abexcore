import type { Prisma } from '@prisma/client';
import { isSalesBookOwner } from '../config/rolePermissions';

/** Shared pool — visible to every user with customers module access. */
export function unassignedCustomerWhere(): Prisma.CustomerWhereInput {
  return { salesPersonId: null };
}

/** Sales officer personal book plus the shared unassigned pool. */
export function salesBookCustomerFilter(salesPersonId: string): Prisma.CustomerWhereInput {
  return {
    OR: [{ salesPersonId }, unassignedCustomerWhere()],
  };
}

/**
 * Customer list visibility for users with customers:read.
 * Unassigned customers are always included for every role.
 */
export function customerModuleListFilter(
  roleName: string | null | undefined,
  userId: string,
  opts?: { salesPersonId?: string }
): Prisma.CustomerWhereInput {
  if (opts?.salesPersonId === 'none') {
    return unassignedCustomerWhere();
  }

  if (isSalesBookOwner(roleName)) {
    return salesBookCustomerFilter(userId);
  }

  if (opts?.salesPersonId) {
    return {
      OR: [{ salesPersonId: opts.salesPersonId }, unassignedCustomerWhere()],
    };
  }

  return {};
}

/** Limit customer queries for sales book owners; no-op for other roles. */
export function salesBookCustomerVisibility(
  roleName: string | null | undefined,
  userId: string
): Prisma.CustomerWhereInput {
  return customerModuleListFilter(roleName, userId);
}

export function canAccessCustomerRecord(
  customer: { salesPersonId: string | null },
  roleName: string | null | undefined,
  userId: string
): boolean {
  if (customer.salesPersonId === null) return true;
  if (!isSalesBookOwner(roleName)) return true;
  return customer.salesPersonId === userId;
}
