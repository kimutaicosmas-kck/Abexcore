import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../config/logger';

let client: Redis | null = null;
let connectPromise: Promise<Redis | null> | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(config.redis.url);
}

export function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
  if (client) return client;

  client = new Redis(config.redis.url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 5_000,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
  });
  client.on('error', (err) => {
    logger.warn('Redis connection error', { message: err.message });
  });
  return client;
}

async function waitUntilReady(redis: Redis, timeoutMs = 5_000): Promise<void> {
  if (redis.status === 'ready') return;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis connect timeout'));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('error', onError);
    };

    redis.once('ready', onReady);
    redis.once('error', onError);

    if (redis.status === 'ready') {
      cleanup();
      resolve();
    }
  });
}

export async function ensureRedisConnected(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;

  if (redis.status === 'ready') {
    try {
      await redis.ping();
      return redis;
    } catch (err) {
      logger.warn('Redis ping failed', err);
      return null;
    }
  }

  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      // Only start connect from idle states — avoid "already connecting/connected".
      if (redis.status === 'wait' || redis.status === 'end') {
        await redis.connect();
      } else if (redis.status === 'connecting' || redis.status === 'connect' || redis.status === 'reconnecting') {
        await waitUntilReady(redis);
      }

      if (redis.status !== 'ready') {
        await waitUntilReady(redis);
      }

      await redis.ping();
      return redis;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Benign race when another caller already started connect.
      if (/already connecting|already connected/i.test(message)) {
        try {
          await waitUntilReady(redis);
          await redis.ping();
          return redis;
        } catch (waitErr) {
          logger.warn('Redis unavailable', waitErr);
          return null;
        }
      }
      logger.warn('Redis unavailable', err);
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

export interface RedisMemoryStats {
  configured: boolean;
  connected: boolean;
  usedMemoryBytes: number | null;
  usedMemoryPeakBytes: number | null;
  maxMemoryBytes: number | null;
  usedMemoryHuman: string | null;
}

export async function getRedisMemoryStats(): Promise<RedisMemoryStats> {
  if (!isRedisConfigured()) {
    return {
      configured: false,
      connected: false,
      usedMemoryBytes: null,
      usedMemoryPeakBytes: null,
      maxMemoryBytes: null,
      usedMemoryHuman: null,
    };
  }

  const redis = await ensureRedisConnected();
  if (!redis) {
    return {
      configured: true,
      connected: false,
      usedMemoryBytes: null,
      usedMemoryPeakBytes: null,
      maxMemoryBytes: null,
      usedMemoryHuman: null,
    };
  }

  try {
    const info = await redis.info('memory');
    const read = (key: string) => {
      const match = info.match(new RegExp(`^${key}:(.+)$`, 'm'));
      return match ? match[1].trim() : null;
    };
    const used = Number(read('used_memory') || 0);
    const peak = Number(read('used_memory_peak') || 0);
    const max = Number(read('maxmemory') || 0);

    return {
      configured: true,
      connected: true,
      usedMemoryBytes: used,
      usedMemoryPeakBytes: peak,
      maxMemoryBytes: max > 0 ? max : null,
      usedMemoryHuman: read('used_memory_human'),
    };
  } catch {
    return {
      configured: true,
      connected: false,
      usedMemoryBytes: null,
      usedMemoryPeakBytes: null,
      maxMemoryBytes: null,
      usedMemoryHuman: null,
    };
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
  client = null;
  connectPromise = null;
}
