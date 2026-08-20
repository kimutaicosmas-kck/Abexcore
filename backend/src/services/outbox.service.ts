import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../config/logger';
import { ensureRedisConnected } from './redis.service';
import { requireTenantId } from '../utils/tenant';

type TxClient = Prisma.TransactionClient | typeof prisma;

export type DomainEventInput = {
  companyId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

/**
 * Transactional outbox — write events in the same DB transaction as business changes,
 * then drain asynchronously to Redis pub/sub (and future consumers).
 */
export class OutboxService {
  static async publish(tx: TxClient, event: DomainEventInput) {
    return tx.outboxEvent.create({
      data: {
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload as Prisma.InputJsonValue,
        status: 'PENDING',
      },
    });
  }

  static async publishForTenant(
    event: Omit<DomainEventInput, 'companyId'> & { companyId?: string },
    tx: TxClient = prisma
  ) {
    const companyId = event.companyId || requireTenantId();
    return this.publish(tx, { ...event, companyId });
  }

  static async drain(limit = 25): Promise<number> {
    const batch = await prisma.outboxEvent.findMany({
      where: {
        status: 'PENDING',
        availableAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let published = 0;
    for (const event of batch) {
      try {
        await this.dispatch(event);
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
            attempts: event.attempts + 1,
            lastError: null,
          },
        });
        published += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Outbox publish failed ${event.eventType}`, err);
        const attempts = event.attempts + 1;
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts,
            lastError: message.slice(0, 1000),
            status: attempts >= 8 ? 'FAILED' : 'PENDING',
            availableAt: new Date(Date.now() + Math.min(300_000, 2 ** attempts * 1000)),
          },
        });
      }
    }
    return published;
  }

  private static async dispatch(event: {
    id: string;
    companyId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
  }) {
    const redis = await ensureRedisConnected();
    const message = JSON.stringify({
      id: event.id,
      companyId: event.companyId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      publishedAt: new Date().toISOString(),
    });

    if (redis) {
      await redis.publish('abexcore:domain-events', message);
      await redis.lpush('abexcore:domain-events:log', message);
      await redis.ltrim('abexcore:domain-events:log', 0, 499);
      return;
    }

    logger.info(`Outbox event (no Redis): ${event.eventType} ${event.aggregateId}`);
  }

  static async recent(limit = 20) {
    return prisma.outboxEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        status: true,
        attempts: true,
        publishedAt: true,
        createdAt: true,
        lastError: true,
      },
    });
  }
}
