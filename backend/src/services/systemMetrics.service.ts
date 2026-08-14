import fs from 'fs';
import os from 'os';
import { statfsSync } from 'fs';
import { config } from '../config';
import { resolveClusterWorkers } from '../cluster';

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

export function getSystemMetrics(): SystemMetricsSnapshot {
  const scope: MetricsScope = fs.existsSync('/host/proc/meminfo') ? 'host' : 'container';
  const hostLoad = scope === 'host' ? readHostLoadAverage() : null;
  const [load1, load5, load15] = os.loadavg();
  const mem = buildMemory(scope);
  const procMem = process.memoryUsage();

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
    },
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
