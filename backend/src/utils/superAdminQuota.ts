import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

/** Maximum Super Admin users allowed per company (override with MAX_SUPER_ADMINS_PER_COMPANY). */
export const MAX_SUPER_ADMINS_PER_COMPANY = Math.max(
  1,
  parseInt(process.env.MAX_SUPER_ADMINS_PER_COMPANY || '2', 10) || 2
);

export async function countCompanySuperAdmins(
  companyId: string,
  excludeUserId?: string
): Promise<number> {
  return prisma.user.count({
    where: {
      companyId,
      deletedAt: null,
      role: { name: 'Super Admin' },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
  });
}

export async function getSuperAdminQuota(companyId: string, excludeUserId?: string) {
  const used = await countCompanySuperAdmins(companyId, excludeUserId);
  return {
    used,
    max: MAX_SUPER_ADMINS_PER_COMPANY,
    remaining: Math.max(0, MAX_SUPER_ADMINS_PER_COMPANY - used),
  };
}

/** Throws if assigning Super Admin would exceed the per-company limit. */
export async function assertCanAssignSuperAdmin(
  companyId: string,
  excludeUserId?: string
): Promise<void> {
  const { used, max } = await getSuperAdminQuota(companyId, excludeUserId);
  if (used >= max) {
    throw new AppError(
      `This company already has the maximum of ${max} Super Admin users. Demote one before assigning another.`,
      409
    );
  }
}
