import prisma from '../config/database';
import { modulesForRoleName, PERMISSION_MODULES } from '../config/rolePermissions';

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

export async function resolveUserPermissionStrings(user: {
  role: { name: string; permissions: RolePermissionRow[] };
  allowedModules?: unknown;
}): Promise<string[]> {
  if (user.role.name === 'Super Admin') {
    return user.role.permissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`);
  }

  const modules = normalizeAllowedModules(user.allowedModules);
  if (modules?.length) {
    return permissionStringsForModules(modules);
  }

  const rolePerms = user.role.permissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`);
  if (rolePerms.length) return rolePerms;

  // Production seed may create roles without role_permissions — fall back to role matrix.
  return permissionStringsForModules(modulesForRoleName(user.role.name));
}
