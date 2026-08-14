/**
 * Rolling API latency sampler for the Server metrics panel.
 * Shared per process (each cluster worker has its own window).
 */

const MAX_SAMPLES = 500;
const samples: number[] = [];
let requestCount = 0;
let errorCount = 0;

export function recordApiDuration(ms: number, statusCode: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  samples.push(ms);
  if (samples.length > MAX_SAMPLES) samples.shift();
  requestCount += 1;
  if (statusCode >= 500) errorCount += 1;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export interface ApiLatencyStats {
  sampleCount: number;
  requestCount: number;
  errorCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export function getApiLatencyStats(): ApiLatencyStats {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      requestCount,
      errorCount,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((s, n) => s + n, 0);

  return {
    sampleCount: sorted.length,
    requestCount,
    errorCount,
    avgMs: Math.round((sum / sorted.length) * 10) / 10,
    p50Ms: Math.round(percentile(sorted, 50) * 10) / 10,
    p95Ms: Math.round(percentile(sorted, 95) * 10) / 10,
    p99Ms: Math.round(percentile(sorted, 99) * 10) / 10,
    maxMs: Math.round(sorted[sorted.length - 1] * 10) / 10,
  };
}

/** Test helper */
export function resetApiLatencyForTests(): void {
  samples.length = 0;
  requestCount = 0;
  errorCount = 0;
}
