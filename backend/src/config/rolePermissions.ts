/** Canonical module/action matrix used by seed and db:refresh-roles. */
export const PERMISSION_MODULES = [
  'dashboard',
  'users',
  'customers',
  'products',
  'inventory',
  'procurement',
  'production',
  'sales',
  'delivery',
  'finance',
  'hr',
  'maintenance',
  'quality',
  'reports',
  'settings',
] as const;

export const PERMISSION_ACTIONS = ['create', 'read', 'update', 'delete', 'approve'] as const;

export const SYSTEM_ROLES = [
  'Super Admin',
  'Managing Director',
  'General Manager',
  'Operations Manager',
  'Production Manager',
  'Sales Manager',
  'Procurement Manager',
  'Warehouse Manager',
  'Quality Manager',
  'Finance Manager',
  'HR Manager',
  'Procurement Officer',
  'Warehouse Officer',
  'Sales Officer',
  'Sales Executive',
  'Storekeeper',
  'Machine Operator',
  'Finance Officer',
  'Accountant',
  'HR',
  'Customer Service',
  'Logistics & Delivery',
  'Auditor',
] as const;

/**
 * Default module access per role.
 * Includes both demo seed names and production seed names (aliases).
 * Legacy role names are kept so unmigrated DBs keep working until rename migration runs.
 */
export const ROLE_MODULE_ACCESS: Record<string, readonly string[]> = {
  'Managing Director': PERMISSION_MODULES,
  'General Manager': PERMISSION_MODULES,
  'Operations Manager': ['dashboard', 'production', 'inventory', 'procurement', 'quality', 'delivery'],
  'Production Manager': ['dashboard', 'production', 'inventory', 'quality'],
  'Sales Manager': ['dashboard', 'customers', 'sales', 'delivery', 'reports'],
  'Procurement Manager': ['dashboard', 'procurement', 'inventory', 'reports'],
  'Warehouse Manager': ['dashboard', 'inventory', 'delivery'],
  'Quality Manager': ['dashboard', 'quality', 'production'],
  'Finance Manager': ['dashboard', 'finance', 'reports', 'sales'],
  'HR Manager': ['dashboard', 'hr'],
  'Procurement Officer': ['dashboard', 'procurement', 'inventory'],
  'Warehouse Officer': ['dashboard', 'inventory'],
  Storekeeper: ['dashboard', 'inventory'],
  'Sales Officer': ['dashboard', 'customers', 'sales'],
  'Sales Executive': ['dashboard', 'customers', 'sales'],
  'Sales Representative': ['dashboard', 'customers', 'sales'], // legacy
  'Machine Operator': ['dashboard', 'production'],
  'Finance Officer': ['dashboard', 'finance', 'reports'],
  Accountant: ['dashboard', 'finance', 'reports'],
  HR: ['dashboard', 'hr'],
  'Customer Service': ['dashboard', 'customers'],
  'Logistics & Delivery': ['dashboard', 'delivery'],
  Driver: ['dashboard', 'delivery'], // legacy
  Auditor: ['dashboard', 'reports', 'finance'],
};

export function modulesForRoleName(roleName: string): string[] {
  if (roleName === 'Super Admin') return [...PERMISSION_MODULES];
  return [...(ROLE_MODULE_ACCESS[roleName] || ['dashboard'])];
}

/** Roles that own a personal sales book (My Sales, targets, customer assignment). */
export const SALES_PERSON_ROLE_NAMES = [
  'Sales Officer',
  'Sales Executive',
  'Sales Representative', // legacy
  'Sales Manager',
] as const;

export function isSalesPersonRole(roleName: string | null | undefined): boolean {
  return !!roleName && (SALES_PERSON_ROLE_NAMES as readonly string[]).includes(roleName);
}

/**
 * Front-line sales book owners (personal CRM / My Sales).
 * Sales Manager is excluded so they keep company/team-wide CRM visibility.
 */
export const SALES_BOOK_OWNER_ROLE_NAMES = [
  'Sales Officer',
  'Sales Executive',
  'Sales Representative', // legacy
] as const;

export function isSalesBookOwner(roleName: string | null | undefined): boolean {
  return !!roleName && (SALES_BOOK_OWNER_ROLE_NAMES as readonly string[]).includes(roleName);
}

/** Logistics / delivery field roles (formerly Driver). */
export const LOGISTICS_DELIVERY_ROLE_NAMES = ['Logistics & Delivery', 'Driver'] as const;

export function isLogisticsDeliveryRole(roleName: string | null | undefined): boolean {
  return !!roleName && (LOGISTICS_DELIVERY_ROLE_NAMES as readonly string[]).includes(roleName);
}

/** Roles that may assign monthly sales targets for sales persons. */
export const SALES_TARGET_MANAGER_ROLES = [
  'Super Admin',
  'Managing Director',
  'General Manager',
  'Sales Manager',
] as const;

export function canManageSalesTargets(
  roleName: string | null | undefined,
  permissions: string[] = []
): boolean {
  if (roleName && (SALES_TARGET_MANAGER_ROLES as readonly string[]).includes(roleName)) {
    return true;
  }
  return permissions.includes('settings:update');
}

/**
 * Company leadership that may promote users to Super Admin within that tenant only.
 * Limit is per company (e.g. Amazon and Company X each get up to 2), not system-wide.
 */
export const COMPANY_SUPER_ADMIN_ASSIGNER_ROLES = [
  'Super Admin',
  'Managing Director',
  'General Manager',
] as const;

export function canAssignCompanySuperAdmin(roleName: string | null | undefined): boolean {
  return (
    !!roleName &&
    (COMPANY_SUPER_ADMIN_ASSIGNER_ROLES as readonly string[]).includes(roleName)
  );
}

type PermissionRecord = { id: string; module: string; action: string };

export function permissionsForRole(roleName: string, allPermissions: PermissionRecord[]): PermissionRecord[] {
  if (roleName === 'Super Admin') {
    return allPermissions;
  }

  const modules = modulesForRoleName(roleName);
  return allPermissions.filter((p) => modules.includes(p.module));
}
