import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './index';
import { isTenantScopedModel } from './tenantModels';
import { getTenantId } from '../utils/tenant';
import { applyDatabasePoolParams } from '../utils/databaseUrl';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const databaseUrl = applyDatabasePoolParams(process.env.DATABASE_URL || '', config.dbPool);

const basePrisma = new PrismaClient({
  datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

function scopeArgs(model: string, operation: string, args: Record<string, unknown>, companyId: string) {
  const next = { ...args };

  if (operation === 'create') {
    next.data = { ...(next.data as object), companyId };
    return next;
  }

  if (operation === 'createMany') {
    const data = next.data;
    if (Array.isArray(data)) {
      next.data = data.map((row) => ({ ...(row as object), companyId }));
    } else if (data && typeof data === 'object') {
      next.data = { ...(data as object), companyId };
    }
    return next;
  }

  if (operation === 'upsert') {
    next.create = { ...(next.create as object), companyId };
    next.update = { ...(next.update as object) };
    next.where = { ...(next.where as object), companyId };
    return next;
  }

  if (['findMany', 'findFirst', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany'].includes(operation)) {
    next.where = { ...((next.where as object) || {}), companyId };
    return next;
  }

  if (['findUnique', 'update', 'delete'].includes(operation)) {
    next.where = { ...((next.where as object) || {}), companyId };
    return next;
  }

  return next;
}

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const companyId = getTenantId();
        if (!companyId || !isTenantScopedModel(model)) {
          return query(args);
        }

        const scoped = scopeArgs(model, operation, args as Record<string, unknown>, companyId);
        return query(scoped);
      },
    },
  },
}) as unknown as PrismaClient;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;

export type ExtendedPrismaClient = typeof prisma;
