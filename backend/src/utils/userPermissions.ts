import prisma from '../config/database';
import { modulesForRoleName, PERMISSION_MODULES, isSalesBookOwner } from '../config/rolePermissions';

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

export async function resolveUserPermissionStrings(user: {
  role: { name: string; permissions: RolePermissionRow[] };
  allowedModules?: unknown;
}): Promise<string[]> {
  if (user.role.name === 'Super Admin') {
    return user.role.permissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`);
  }

  const modules = normalizeAllowedModules(user.allowedModules);
  let permissions: string[];
  if (modules?.length) {
    permissions = await permissionStringsForModules(modules);
  } else {
    const rolePerms = user.role.permissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`);
    permissions = rolePerms.length
      ? rolePerms
      : await permissionStringsForModules(modulesForRoleName(user.role.name));
  }

  return applySalesBookOwnerPermissionGuards(user.role.name, permissions);
}
