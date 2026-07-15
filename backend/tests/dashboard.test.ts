import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
let dbConnected = false;
let authToken = '';

async function login(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@filtererp.co.ke', password: 'Admin@123' });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  return res.body.data.accessToken as string;
}

function authReq(token: string) {
  return request(app).set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  const health = await request(app).get('/api/health');
  dbConnected = health.body.database === 'connected';
  if (dbConnected) {
    authToken = await login();
  }
});

describe('Dashboard API', () => {
  it('rejects unauthenticated KPI requests', async () => {
    const res = await request(app).get('/api/v1/dashboard/kpis');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated chart requests', async () => {
    const res = await request(app).get('/api/v1/dashboard/charts');
    expect(res.status).toBe(401);
  });

  it.skipIf(() => !dbConnected)('returns KPI payload with required dashboard fields', async () => {
    const res = await authReq(authToken).get('/api/v1/dashboard/kpis');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data).toHaveProperty('salesToday');
    expect(data).toHaveProperty('monthlyRevenue');
    expect(data).toHaveProperty('topSellingFilters');
    expect(data).toHaveProperty('productionStatus');
    expect(data).toHaveProperty('pendingActions');
    expect(data).toHaveProperty('moduleSnapshots');
    expect(data).toHaveProperty('lastUpdated');
    expect(Array.isArray(data.recentOrders)).toBe(true);
    expect(data.moduleSnapshots).toHaveProperty('hr');
    expect(data.moduleSnapshots).toHaveProperty('crm');
    expect(data.moduleSnapshots).toHaveProperty('procurement');
    expect(data.moduleSnapshots).toHaveProperty('finance');
  });

  it.skipIf(() => !dbConnected)('returns chart data with configurable day range', async () => {
    const res = await authReq(authToken).get('/api/v1/dashboard/charts?days=7');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.days).toBe(7);
    expect(Array.isArray(data.salesTrend)).toBe(true);
    expect(data.salesTrend).toHaveLength(7);
    expect(Array.isArray(data.productCategories)).toBe(true);
  });

  it.skipIf(() => !dbConnected)('clamps chart day range to valid bounds', async () => {
    const res = await authReq(authToken).get('/api/v1/dashboard/charts?days=365');
    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(90);
  });
});

describe('DashboardService chart optimization', () => {
  it.skipIf(() => !dbConnected)('returns consistent trend totals for 30-day range', async () => {
    const res = await authReq(authToken).get('/api/v1/dashboard/charts?days=30');
    expect(res.status).toBe(200);
    expect(res.body.data.salesTrend).toHaveLength(30);

    for (const point of res.body.data.salesTrend) {
      expect(point).toHaveProperty('date');
      expect(typeof point.amount).toBe('number');
      expect(point.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
