import fs from 'fs';
import os from 'os';
import { statfsSync } from 'fs';
import { config } from '../config';
import { resolveClusterWorkers } from '../cluster';
import prisma from '../config/database';
import { getApiLatencyStats } from '../utils/apiLatency';
import { getRedisMemoryStats } from './redis.service';
import { getQueueStats, getWorkerCrashCount } from './jobQueue.service';

export type MetricsScope = 'host' | 'container';

export interface SystemMetricsSnapshot {
  capturedAt: string;
  scope: MetricsScope;
  host: {
    hostname: string;
    platform: string;
    uptimeSeconds: number;
    cpuCount: number;
    cpuModel: string;
    cpuUsagePercent: number | null;
    loadAverage: { load1: number; load5: number; load15: number };
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    usedPercent: number;
  };
  disk: {
    mount: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  } | null;
  process: {
    pid: number;
    uptimeSeconds: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
    };
    clusterWorkers: number;
    workerCrashes: number | null;
  };
  mysql: {
    threadsConnected: number | null;
    maxConnections: number | null;
    threadsRunning: number | null;
    poolLimit: number;
  };
  redis: {
    configured: boolean;
    connected: boolean;
    usedMemoryBytes: number | null;
    usedMemoryPeakBytes: number | null;
    maxMemoryBytes: number | null;
    usedMemoryHuman: string | null;
  };
  queue: {
    configured: boolean;
    connected: boolean;
    waiting: number;
    active: number;
    failed: number;
    recentFailed: {
      id: string;
      name: string;
      failedAt: string;
      error: string;
    }[];
  };
  api: {
    sampleCount: number;
    requestCount: number;
    errorCount: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
  };
  runtime: {
    nodeVersion: string;
    environment: string;
  };
}

let prevCpuSample: os.CpuInfo[] | null = null;

function readHostMemInfo(): { totalBytes: number; freeBytes: number } | null {
  const memPath = '/host/proc/meminfo';
  if (!fs.existsSync(memPath)) return null;

  const text = fs.readFileSync(memPath, 'utf8');
  const readKb = (key: string) => {
    const match = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return match ? Number(match[1]) * 1024 : 0;
  };

  const totalBytes = readKb('MemTotal');
  const availableBytes = readKb('MemAvailable') || readKb('MemFree');
  if (!totalBytes) return null;

  return { totalBytes, freeBytes: availableBytes };
}

function readHostLoadAverage(): { load1: number; load5: number; load15: number } | null {
  const loadPath = '/host/proc/loadavg';
  if (!fs.existsSync(loadPath)) return null;

  const [load1, load5, load15] = fs.readFileSync(loadPath, 'utf8')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map(Number);

  return { load1, load5, load15 };
}

function computeCpuUsagePercent(): number | null {
  const cpus = os.cpus();
  if (!prevCpuSample) {
    prevCpuSample = cpus;
    return null;
  }

  let idleDiff = 0;
  let totalDiff = 0;

  for (let i = 0; i < cpus.length; i += 1) {
    const prev = prevCpuSample[i]?.times;
    const cur = cpus[i]?.times;
    if (!prev || !cur) continue;

    const idle = cur.idle - prev.idle;
    const total =
      cur.user -
      prev.user +
      (cur.nice - prev.nice) +
      (cur.sys - prev.sys) +
      (cur.idle - prev.idle) +
      (cur.irq - prev.irq);

    idleDiff += idle;
    totalDiff += total;
  }

  prevCpuSample = cpus;
  if (totalDiff <= 0) return 0;

  return Math.round((1 - idleDiff / totalDiff) * 1000) / 10;
}

function readDiskUsage(mount: string): SystemMetricsSnapshot['disk'] {
  try {
    const stats = statfsSync(mount);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

    return { mount, totalBytes, freeBytes, usedBytes, usedPercent };
  } catch {
    return null;
  }
}

function buildMemory(scope: MetricsScope) {
  const hostMem = scope === 'host' ? readHostMemInfo() : null;
  const totalBytes = hostMem?.totalBytes ?? os.totalmem();
  const freeBytes = hostMem?.freeBytes ?? os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;

  return { totalBytes, usedBytes, freeBytes, usedPercent };
}

async function getMysqlStats(): Promise<SystemMetricsSnapshot['mysql']> {
  const poolLimit = config.dbPool.connectionLimit;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ Variable_name: string; Value: string }>>(
      "SHOW STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running')"
    );
    const vars = await prisma.$queryRawUnsafe<Array<{ Variable_name: string; Value: string }>>(
      "SHOW VARIABLES WHERE Variable_name = 'max_connections'"
    );
    const read = (list: Array<{ Variable_name: string; Value: string }>, name: string) => {
      const row = list.find((r) => r.Variable_name === name);
      return row ? Number(row.Value) : null;
    };

    return {
      threadsConnected: read(rows, 'Threads_connected'),
      threadsRunning: read(rows, 'Threads_running'),
      maxConnections: read(vars, 'max_connections'),
      poolLimit,
    };
  } catch {
    return {
      threadsConnected: null,
      threadsRunning: null,
      maxConnections: null,
      poolLimit,
    };
  }
}

export async function getSystemMetrics(): Promise<SystemMetricsSnapshot> {
  const scope: MetricsScope = fs.existsSync('/host/proc/meminfo') ? 'host' : 'container';
  const hostLoad = scope === 'host' ? readHostLoadAverage() : null;
  const [load1, load5, load15] = os.loadavg();
  const mem = buildMemory(scope);
  const procMem = process.memoryUsage();

  const [mysql, redis, queue, workerCrashes] = await Promise.all([
    getMysqlStats(),
    getRedisMemoryStats(),
    getQueueStats(),
    getWorkerCrashCount(),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    scope,
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptimeSeconds: Math.floor(os.uptime()),
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model?.trim() || 'Unknown CPU',
      cpuUsagePercent: computeCpuUsagePercent(),
      loadAverage: hostLoad ?? { load1, load5, load15 },
    },
    memory: mem,
    disk: readDiskUsage('/'),
    process: {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: {
        rssBytes: procMem.rss,
        heapUsedBytes: procMem.heapUsed,
        heapTotalBytes: procMem.heapTotal,
        externalBytes: procMem.external,
      },
      clusterWorkers: resolveClusterWorkers(),
      workerCrashes,
    },
    mysql,
    redis,
    queue: {
      configured: queue.configured,
      connected: queue.connected,
      waiting: queue.waiting,
      active: queue.active,
      failed: queue.failed,
      recentFailed: queue.recentFailed.map((j) => ({
        id: j.id,
        name: j.name,
        failedAt: j.failedAt,
        error: j.error,
      })),
    },
    api: getApiLatencyStats(),
    runtime: {
      nodeVersion: process.version,
      environment: config.nodeEnv,
    },
  };
}

/** Reset CPU baseline — used in tests. */
export function resetCpuBaselineForTests(): void {
  prevCpuSample = null;
}
