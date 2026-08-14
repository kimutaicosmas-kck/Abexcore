import { describe, expect, it } from 'vitest';
import { getSystemMetrics, resetCpuBaselineForTests } from '../src/services/systemMetrics.service';

describe('getSystemMetrics', () => {
  it('returns structured host and process metrics', () => {
    resetCpuBaselineForTests();
    const first = getSystemMetrics();
    const second = getSystemMetrics();

    expect(first.capturedAt).toBeTruthy();
    expect(['host', 'container']).toContain(first.scope);
    expect(first.host.cpuCount).toBeGreaterThan(0);
    expect(first.memory.totalBytes).toBeGreaterThan(0);
    expect(first.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(first.process.pid).toBeGreaterThan(0);
    expect(first.runtime.nodeVersion).toMatch(/^v\d+/);

    expect(first.host.cpuUsagePercent).toBeNull();
    expect(typeof second.host.cpuUsagePercent).toBe('number');
  });
});
