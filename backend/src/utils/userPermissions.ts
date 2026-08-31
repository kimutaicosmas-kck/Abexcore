import prisma from '../config/database';
import { modulesForRoleName, PERMISSION_MODULES, isSalesBookOwner } from '../config/rolePermissions';
import { resolveCompanyModules } from '../config/companyModules';

const VALID_MODULES = new Set<string>(PERMISSION_MODULES);

export function normalizeAllowedModules(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const modules = [
    ...new Set(
      raw
        .map((m) => String(m).trim().toLowerCase())
        .filter((m) => VALID_MODULES.has(m))
    ),
  ];
  if (!modules.includes('dashboard')) modules.unshift('dashboard');
  return modules.length ? modules : null;
}

type RolePermissionRow = {
  permission: { module: string; action: string };
};

async function permissionStringsForModules(modules: string[]): Promise<string[]> {
  const permissions = await prisma.permission.findMany({
    where: { module: { in: modules } },
    select: { module: true, action: true },
  });
  return permissions.map((p) => `${p.module}:${p.action}`);
}

/** Sales book owners may browse products but never create/edit/delete the catalog. */
function applySalesBookOwnerPermissionGuards(
  roleName: string,
  permissions: string[]
): string[] {
  if (!isSalesBookOwner(roleName)) return permissions;

  const next = permissions.filter((p) => {
    if (!p.startsWith('products:')) return true;
    return p === 'products:read';
  });

  // Catalog browse via Products nav (also allowed by sales:read on the frontend).
  if (next.includes('sales:read') && !next.includes('products:read')) {
    next.push('products:read');
  }

  return next;
}

function filterByCompanyModules(
  permissions: string[],
  enabledModules: unknown
): string[] {
  const allowed = new Set(resolveCompanyModules(enabledModules));
  return permissions.filter((p) => {
    const module = p.split(':')[0];
    return module ? allowed.has(module) : false;
  });
}

export async function resolveUserPermissionStrings(user: {
  role: { name: string; permissions: RolePermissionRow[] };
  allowedModules?: unknown;
  company?: { enabledModules?: unknown } | null;
}): Promise<string[]> {
  let permissions: string[];

  if (user.role.name === 'Super Admin') {
    // Always derive from canonical modules so new modules (e.g. POS) appear
    // without requiring a RolePermission refresh — still clamped by company package.
    permissions = await permissionStringsForModules([...PERMISSION_MODULES]);
  } else {
    const stored = normalizeAllowedModules(user.allowedModules);
    const roleMods = modulesForRoleName(user.role.name);
    if (stored?.length) {
      // Merge role defaults so enabling a company module (e.g. POS) unlocks it
      // for roles that include it, even if allowedModules was frozen earlier.
      const merged = [...new Set([...roleMods, ...stored])];
      permissions = await permissionStringsForModules(merged);
    } else {
      const rolePerms = user.role.permissions.map(
        (rp) => `${rp.permission.module}:${rp.permission.action}`
      );
      permissions = rolePerms.length
        ? rolePerms
        : await permissionStringsForModules(roleMods);
    }
  }

  permissions = filterByCompanyModules(permissions, user.company?.enabledModules);
  return applySalesBookOwnerPermissionGuards(user.role.name, permissions);
}
