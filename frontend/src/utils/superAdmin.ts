/** Mirrors backend canAssignCompanySuperAdmin — per-tenant Super Admin seats. */
const COMPANY_SUPER_ADMIN_ASSIGNER_ROLES = [
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
