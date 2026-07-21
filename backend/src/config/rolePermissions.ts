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
  'Operations Manager',
  'Production Manager',
  'Procurement Officer',
  'Warehouse Officer',
  'Sales Officer',
  'Finance Officer',
  'Accountant',
  'HR',
  'Customer Service',
  'Driver',
  'Auditor',
] as const;

/** Module access per role (Super Admin gets all permissions separately). */
export const ROLE_MODULE_ACCESS: Record<string, readonly string[]> = {
  'Managing Director': PERMISSION_MODULES,
  'Operations Manager': ['dashboard', 'production', 'inventory', 'procurement', 'quality'],
  'Production Manager': ['dashboard', 'production', 'inventory', 'quality'],
  'Procurement Officer': ['dashboard', 'procurement', 'inventory'],
  'Warehouse Officer': ['dashboard', 'inventory'],
  'Sales Officer': ['dashboard', 'customers', 'sales'],
  'Finance Officer': ['dashboard', 'finance', 'reports'],
  Accountant: ['dashboard', 'finance', 'reports'],
  HR: ['dashboard', 'hr'],
  'Customer Service': ['dashboard', 'customers'],
  Driver: ['dashboard', 'delivery'],
  Auditor: ['dashboard', 'reports', 'finance'],
};

type PermissionRecord = { id: string; module: string; action: string };

export function permissionsForRole(roleName: string, allPermissions: PermissionRecord[]): PermissionRecord[] {
  if (roleName === 'Super Admin') {
    return allPermissions;
  }

  const modules = ROLE_MODULE_ACCESS[roleName] || ['dashboard'];
  return allPermissions.filter((p) => modules.includes(p.module));
}
