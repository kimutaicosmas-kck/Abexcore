import { randomUUID } from 'crypto';
import { logger } from '../config/logger';
import { ensureRedisConnected, isRedisConfigured } from './redis.service';

const PREFIX = 'abexcore:queue';
const WAITING_KEY = `${PREFIX}:waiting`;
const ACTIVE_KEY = `${PREFIX}:active`;
const FAILED_KEY = `${PREFIX}:failed`;
const CRASH_KEY = 'abexcore:metrics:worker_crashes';

export type JobName = 'low-stock-check' | 'health-ping';

export interface QueueJob {
  id: string;
  name: JobName;
  payload?: Record<string, unknown>;
  enqueuedAt: string;
  attempts: number;
}

export interface FailedJobRecord extends QueueJob {
  failedAt: string;
  error: string;
}

export interface QueueStats {
  configured: boolean;
  connected: boolean;
  waiting: number;
  active: number;
  failed: number;
  recentFailed: FailedJobRecord[];
}

type JobHandler = (job: QueueJob) => Promise<void>;

const handlers = new Map<JobName, JobHandler>();
let processing = false;
let processorTimer: NodeJS.Timeout | null = null;

export function registerJobHandler(name: JobName, handler: JobHandler): void {
  handlers.set(name, handler);
}

export async function enqueueJob(
  name: JobName,
  payload?: Record<string, unknown>
): Promise<{ queued: boolean; id: string }> {
  const job: QueueJob = {
    id: randomUUID(),
    name,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  };

  const redis = await ensureRedisConnected();
  if (!redis) {
    // Fallback: run inline when Redis is down so critical jobs still execute.
    const handler = handlers.get(name);
    if (handler) {
      try {
        await handler(job);
      } catch (err) {
        logger.warn(`Inline job ${name} failed`, err);
      }
    }
    return { queued: false, id: job.id };
  }

  await redis.rpush(WAITING_KEY, JSON.stringify(job));
  return { queued: true, id: job.id };
}

async function failJob(job: QueueJob, error: unknown): Promise<void> {
  const redis = await ensureRedisConnected();
  if (!redis) return;

  const record: FailedJobRecord = {
    ...job,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  };
  await redis.lpush(FAILED_KEY, JSON.stringify(record));
  await redis.ltrim(FAILED_KEY, 0, 99);
}

async function processOne(): Promise<boolean> {
  const redis = await ensureRedisConnected();
  if (!redis) return false;

  const raw = await redis.lpop(WAITING_KEY);
  if (!raw) return false;

  let job: QueueJob;
  try {
    job = JSON.parse(raw) as QueueJob;
  } catch {
    return true;
  }

  await redis.hset(ACTIVE_KEY, job.id, raw);
  const handler = handlers.get(job.name);

  try {
    if (!handler) throw new Error(`No handler registered for job ${job.name}`);
    await handler({ ...job, attempts: job.attempts + 1 });
  } catch (err) {
    logger.warn(`Queue job failed: ${job.name}`, err);
    await failJob(job, err);
  } finally {
    await redis.hdel(ACTIVE_KEY, job.id);
  }

  return true;
}

export function startQueueProcessor(intervalMs = 2_000): void {
  if (processorTimer || !isRedisConfigured()) return;

  processorTimer = setInterval(() => {
    if (processing) return;
    processing = true;
    void (async () => {
      try {
        // Drain a small batch per tick
        for (let i = 0; i < 5; i += 1) {
          const worked = await processOne();
          if (!worked) break;
        }
      } catch (err) {
        logger.warn('Queue processor tick failed', err);
      } finally {
        processing = false;
      }
    })();
  }, intervalMs);
  processorTimer.unref();
}

export function stopQueueProcessor(): void {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
}

export async function getQueueStats(): Promise<QueueStats> {
  if (!isRedisConfigured()) {
    return {
      configured: false,
      connected: false,
      waiting: 0,
      active: 0,
      failed: 0,
      recentFailed: [],
    };
  }

  const redis = await ensureRedisConnected();
  if (!redis) {
    return {
      configured: true,
      connected: false,
      waiting: 0,
      active: 0,
      failed: 0,
      recentFailed: [],
    };
  }

  try {
    const [waiting, active, failed, failedRaw] = await Promise.all([
      redis.llen(WAITING_KEY),
      redis.hlen(ACTIVE_KEY),
      redis.llen(FAILED_KEY),
      redis.lrange(FAILED_KEY, 0, 9),
    ]);

    const recentFailed = failedRaw
      .map((row) => {
        try {
          return JSON.parse(row) as FailedJobRecord;
        } catch {
          return null;
        }
      })
      .filter((row): row is FailedJobRecord => row != null);

    return {
      configured: true,
      connected: true,
      waiting,
      active,
      failed,
      recentFailed,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      waiting: 0,
      active: 0,
      failed: 0,
      recentFailed: [],
    };
  }
}

export async function incrementWorkerCrashCount(): Promise<void> {
  const redis = await ensureRedisConnected();
  if (!redis) return;
  await redis.incr(CRASH_KEY);
}

export async function getWorkerCrashCount(): Promise<number | null> {
  const redis = await ensureRedisConnected();
  if (!redis) return null;
  try {
    const value = await redis.get(CRASH_KEY);
    return value ? Number(value) || 0 : 0;
  } catch {
    return null;
  }
}
