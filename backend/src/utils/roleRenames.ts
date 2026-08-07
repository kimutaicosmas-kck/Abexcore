import prisma from '../config/database';
import { logger } from '../config/logger';

/**
 * Idempotent display-name updates for legacy roles.
 * Safe when Contabo uses USE_DB_PUSH (schema sync) without running SQL migrations.
 */
export async function ensureLegacyRoleRenames() {
  const renames: Array<{ from: string; to: string }> = [
    { from: 'Sales Representative', to: 'Sales Executive' },
    { from: 'Driver', to: 'Logistics & Delivery' },
  ];

  for (const { from, to } of renames) {
    const legacy = await prisma.role.findUnique({ where: { name: from } });
    if (!legacy) continue;

    const target = await prisma.role.findUnique({ where: { name: to } });
    if (target) {
      // Both exist (seed created the new name) — move users onto the target role, drop legacy.
      const moved = await prisma.user.updateMany({
        where: { roleId: legacy.id },
        data: { roleId: target.id },
      });
      await prisma.rolePermission.deleteMany({ where: { roleId: legacy.id } });
      await prisma.role.delete({ where: { id: legacy.id } });
      logger.info(
        `Merged legacy role "${from}" into "${to}" (${moved.count} user(s) reassigned)`
      );
      continue;
    }

    await prisma.role.update({
      where: { id: legacy.id },
      data: { name: to, description: `${to} role` },
    });
    logger.info(`Renamed role "${from}" → "${to}"`);
  }
}
