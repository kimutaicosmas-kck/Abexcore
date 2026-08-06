/** Mirrors backend canManageSalesTargets / SALES_TARGET_MANAGER_ROLES. */
const SALES_TARGET_MANAGER_ROLES = [
  'Super Admin',
  'Managing Director',
  'General Manager',
  'Sales Manager',
] as const;

export function canManageSalesTargets(
  roleName: string | null | undefined,
  hasPermission: (permission: string) => boolean
): boolean {
  if (roleName && (SALES_TARGET_MANAGER_ROLES as readonly string[]).includes(roleName)) {
    return true;
  }
  return hasPermission('settings:update');
}
