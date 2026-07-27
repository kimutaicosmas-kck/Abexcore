import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

describe('Dashboard API', () => {
  it('rejects unauthenticated KPI requests', async () => {
    const res = await request(testCtx.app).get('/api/v1/dashboard/kpis');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated chart requests', async () => {
    const res = await request(testCtx.app).get('/api/v1/dashboard/charts');
    expect(res.status).toBe(401);
  });

  itWithDb('returns KPI payload with required dashboard fields', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/dashboard/kpis');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data).toHaveProperty('salesToday');
    expect(data).toHaveProperty('monthlyRevenue');
    expect(data).toHaveProperty('topSellingProducts');
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

itWithDb('returns chart data with configurable day range', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/dashboard/charts?days=7');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const data = res.body.data;
    expect(data.days).toBe(7);
    expect(Array.isArray(data.salesTrend)).toBe(true);
    expect(data.salesTrend).toHaveLength(7);
    expect(Array.isArray(data.productCategories)).toBe(true);
  });

itWithDb('clamps chart day range to valid bounds', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/dashboard/charts?days=365');
    expect(res.status).toBe(200);
    expect(res.body.data.days).toBe(90);
  });
});

describe('DashboardService chart optimization', () => {
itWithDb('returns consistent trend totals for 30-day range', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/dashboard/charts?days=30');
    expect(res.status).toBe(200);
    expect(res.body.data.salesTrend).toHaveLength(30);

    for (const point of res.body.data.salesTrend) {
      expect(point).toHaveProperty('date');
      expect(typeof point.amount).toBe('number');
      expect(point.amount).toBeGreaterThanOrEqual(0);
    }
  });
});
