/**
 * Sync role permissions on an existing database without re-seeding demo data.
 * Adds missing permissions, assigns expected modules per role, removes stale grants.
 *
 * Usage: npm run db:refresh-roles
 */
import prisma from '../src/config/database';
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  SYSTEM_ROLES,
  permissionsForRole,
} from '../src/config/rolePermissions';

async function main() {
  console.log('Refreshing role permissions...\n');

  const permissions = [];
  for (const module of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      const perm = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action, description: `${action} ${module}` },
      });
      permissions.push(perm);
    }
  }
  console.log(`Permissions: ${permissions.length} ensured`);

  for (const roleName of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: {
        name: roleName,
        description: `${roleName} role`,
        isSystem: roleName === 'Super Admin',
      },
    });

    const desired = permissionsForRole(roleName, permissions);
    const desiredIds = new Set(desired.map((p) => p.id));

    const current = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const currentIds = new Set(current.map((rp) => rp.permissionId));

    const removeIds = [...currentIds].filter((id) => !desiredIds.has(id));
    if (removeIds.length > 0) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: removeIds } },
      });
    }

    let added = 0;
    for (const perm of desired) {
      if (!currentIds.has(perm.id)) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: perm.id },
        });
        added += 1;
      }
    }

    const modules = roleName === 'Super Admin'
      ? 'all modules'
      : (permissionsForRole(roleName, permissions).map((p) => p.module).filter((m, i, arr) => arr.indexOf(m) === i).join(', '));

    console.log(
      `  ${roleName}: ${desired.length} permissions (${added} added, ${removeIds.length} removed) — ${modules}`
    );
  }

  console.log('\nDone. Users must log out and back in to pick up permission changes.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
