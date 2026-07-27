import { AsyncLocalStorage } from 'async_hooks';
import { AppError } from '../middleware/errorHandler';

export type TenantStore = {
  companyId: string;
  isPlatformAdmin?: boolean;
};

const tenantStorage = new AsyncLocalStorage<TenantStore>();

export function runWithTenant<T>(store: TenantStore, fn: () => T): T {
  return tenantStorage.run(store, fn);
}

export function getTenantStore(): TenantStore | undefined {
  return tenantStorage.getStore();
}

export function getTenantId(): string | undefined {
  return tenantStorage.getStore()?.companyId;
}

export function requireTenantId(): string {
  const companyId = getTenantId();
  if (!companyId) {
    throw new AppError('Tenant context is required for this operation', 500);
  }
  return companyId;
}

export function mergeTenantWhere<T extends Record<string, unknown>>(
  where: T = {} as T,
  companyId?: string
): T & { companyId?: string } {
  const tenantId = companyId ?? getTenantId();
  if (!tenantId) return where;
  return { ...where, companyId: tenantId };
}

/** Scope stock/inventory queries to warehouses owned by the current tenant. */
export function mergeTenantWarehouseWhere<T extends Record<string, unknown>>(
  where: T = {} as T,
  companyId?: string
): T & { warehouse: { companyId: string } } {
  const tenantId = companyId ?? requireTenantId();
  const existingWarehouse =
    where.warehouse && typeof where.warehouse === 'object'
      ? (where.warehouse as Record<string, unknown>)
      : {};
  return {
    ...where,
    warehouse: { ...existingWarehouse, companyId: tenantId },
  };
}

/** Scope delivery-note queries to the current tenant via linked sales orders. */
export function mergeTenantSalesOrderWhere<T extends Record<string, unknown>>(
  where: T = {} as T,
  companyId?: string
): T & { salesOrder: { companyId: string } } {
  const tenantId = companyId ?? requireTenantId();
  const existingSalesOrder =
    where.salesOrder && typeof where.salesOrder === 'object'
      ? (where.salesOrder as Record<string, unknown>)
      : {};
  return {
    ...where,
    salesOrder: { ...existingSalesOrder, companyId: tenantId },
  };
}

export function injectTenantData<T extends Record<string, unknown>>(
  data: T,
  companyId?: string
): T & { companyId: string } {
  const tenantId = companyId ?? requireTenantId();
  return { ...data, companyId: tenantId };
}

export function runWithoutTenant<T>(fn: () => T): T {
  return tenantStorage.run(undefined as unknown as TenantStore, fn);
}

export function slugifyCompany(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
