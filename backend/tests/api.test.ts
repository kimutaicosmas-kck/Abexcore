import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateNumber, startOfMonth, subMonths } from '../src/utils/date';

describe('Health endpoint', () => {
  it('returns v2.1 health payload', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.version).toBe('2.1.0');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Auth validation', () => {
  it('rejects login without credentials', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('Date utilities', () => {
  it('generates numbered document codes', () => {
    const num = generateNumber('RFQ', 42);
    expect(num).toMatch(/^RFQ-\d{4}-00042$/);
  });

  it('computes month boundaries', () => {
    const date = new Date('2026-07-15');
    const start = startOfMonth(date);
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(6);
  });

  it('subtracts months correctly', () => {
    const date = new Date('2026-07-15');
    const prev = subMonths(date, 2);
    expect(prev.getMonth()).toBe(4);
  });
});
