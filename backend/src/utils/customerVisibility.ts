import type { Prisma } from '@prisma/client';
import { isSalesBookOwner } from '../config/rolePermissions';

/** Customers with no assigned sales officer (managers only). */
export function unassignedCustomerWhere(): Prisma.CustomerWhereInput {
  return { salesPersonId: null };
}

/** Customers owned by one sales officer only — no shared unassigned pool. */
export function salesBookCustomerFilter(salesPersonId: string): Prisma.CustomerWhereInput {
  return { salesPersonId };
}

/**
 * Customer list visibility for users with customers:read.
 * Sales officers see only customers assigned to them; managers see all or filter.
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
    return { salesPersonId: opts.salesPersonId };
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
  if (!isSalesBookOwner(roleName)) return true;
  return customer.salesPersonId === userId;
}
