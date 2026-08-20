import prisma from '../config/database';
import { config } from '../config';
import { logger } from '../config/logger';

const BATCH_SIZE = 2_000;

function retentionCutoff(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Delete audit trail rows older than retention (default 7 days) to save DB space. */
export async function purgeExpiredAuditLogs(
  retentionDays = config.auditLogRetentionDays
): Promise<{ auditLogs: number; loginHistory: number }> {
  const days = Math.max(1, retentionDays);
  const cutoff = retentionCutoff(days);
  let auditLogs = 0;
  let loginHistory = 0;

  // Batch deletes so large tables do not lock for one huge statement.
  for (;;) {
    const ids = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (!ids.length) break;
    const result = await prisma.auditLog.deleteMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    auditLogs += result.count;
    if (result.count < BATCH_SIZE) break;
  }

  for (;;) {
    const ids = await prisma.loginHistory.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      take: BATCH_SIZE,
    });
    if (!ids.length) break;
    const result = await prisma.loginHistory.deleteMany({
      where: { id: { in: ids.map((r) => r.id) } },
    });
    loginHistory += result.count;
    if (result.count < BATCH_SIZE) break;
  }

  if (auditLogs || loginHistory) {
    logger.info(
      `Audit retention: deleted ${auditLogs} audit_logs and ${loginHistory} login_history older than ${days} days`
    );
  }

  return { auditLogs, loginHistory };
}
