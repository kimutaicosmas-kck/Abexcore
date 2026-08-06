/** Mirrors backend canManageSalesTargets / SALES_TARGET_MANAGER_ROLES. */
const SALES_TARGET_MANAGER_ROLES = [
  'Super Admin',
  'Managing Director',
  'General Manager',
  'Sales Manager',
] as const;

/** Front-line sales book (personal CRM / My Sales) — excludes Sales Manager. */
const SALES_BOOK_OWNER_ROLES = ['Sales Officer', 'Sales Representative'] as const;

export function canManageSalesTargets(
  roleName: string | null | undefined,
  hasPermission: (permission: string) => boolean
): boolean {
  if (roleName && (SALES_TARGET_MANAGER_ROLES as readonly string[]).includes(roleName)) {
    return true;
  }
  return hasPermission('settings:update');
}

export function isSalesBookOwner(roleName: string | null | undefined): boolean {
  return !!roleName && (SALES_BOOK_OWNER_ROLES as readonly string[]).includes(roleName);
}
