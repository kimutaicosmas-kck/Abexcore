import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../config/logger';

let client: Redis | null = null;

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

export async function ensureRedisConnected(): Promise<Redis | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    await redis.ping();
    return redis;
  } catch (err) {
    logger.warn('Redis unavailable', err);
    return null;
  }
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
}
