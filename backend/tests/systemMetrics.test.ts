import { describe, expect, it } from 'vitest';
import { getSystemMetrics, resetCpuBaselineForTests } from '../src/services/systemMetrics.service';

describe('getSystemMetrics', () => {
  it('returns host and process metrics with new monitors', async () => {
    resetCpuBaselineForTests();
    const first = await getSystemMetrics();
    const second = await getSystemMetrics();

    expect(first.process.clusterWorkers).toBeGreaterThanOrEqual(1);
    expect(first.mysql.poolLimit).toBeGreaterThan(0);
    expect(first.redis).toHaveProperty('configured');
    expect(first.queue).toHaveProperty('waiting');
    expect(first.api).toHaveProperty('p95Ms');
    expect(second.host.cpuCount).toBe(first.host.cpuCount);
  });
});
