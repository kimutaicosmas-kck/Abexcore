import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  createQualityInspectionSchema,
  updateQualityInspectionSchema,
  qualityListQuerySchema,
  createSalesOrderSchema,
  createQuotationSchema,
  salesListQuerySchema,
  createDeliverySchema,
  updateDeliveryStatusSchema,
  deliveryListQuerySchema,
  createVehicleSchema,
} from '../src/validators/schemas';

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

describe('Quality schema validation', () => {
  it('validates quality inspection creation', () => {
    const result = createQualityInspectionSchema.safeParse({
      type: 'incoming',
      status: 'PENDING',
      defectsFound: 0,
    });
    expect(result.success).toBe(true);
  });

  it('validates quality update', () => {
    const result = updateQualityInspectionSchema.safeParse({ status: 'PASSED', result: 'OK' });
    expect(result.success).toBe(true);
  });

  it('validates quality list query', () => {
    const result = qualityListQuerySchema.safeParse({ page: 1, limit: 15, type: 'incoming', status: 'PENDING' });
    expect(result.success).toBe(true);
  });
});

describe('Sales schema validation', () => {
  it('validates sales order creation', () => {
    const result = createSalesOrderSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      items: [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 10, unitPrice: 1500 }],
    });
    expect(result.success).toBe(true);
  });

  it('validates quotation creation', () => {
    const result = createQuotationSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      items: [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 5, unitPrice: 1200 }],
    });
    expect(result.success).toBe(true);
  });

  it('validates sales list query', () => {
    const result = salesListQuerySchema.safeParse({ page: 1, limit: 15, status: 'CONFIRMED', search: 'SO' });
    expect(result.success).toBe(true);
  });
});

describe('Delivery schema validation', () => {
  it('validates delivery creation', () => {
    const result = createDeliverySchema.safeParse({
      salesOrderId: '550e8400-e29b-41d4-a716-446655440000',
      items: [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 10 }],
    });
    expect(result.success).toBe(true);
  });

  it('validates delivery status update', () => {
    const result = updateDeliveryStatusSchema.safeParse({ status: 'IN_TRANSIT' });
    expect(result.success).toBe(true);
  });

  it('validates vehicle creation', () => {
    const result = createVehicleSchema.safeParse({ registration: 'KCA 999Z', make: 'Isuzu' });
    expect(result.success).toBe(true);
  });

  it('validates delivery list query', () => {
    const result = deliveryListQuerySchema.safeParse({ page: 1, limit: 15, status: 'PENDING' });
    expect(result.success).toBe(true);
  });
});

describe('Quality API', () => {
  it('rejects unauthenticated quality stats', async () => {
    const res = await request(app).get('/api/v1/quality/stats');
    expect(res.status).toBe(401);
  });

  it.skipIf(() => !dbConnected)('returns quality stats and list', async () => {
    const [stats, list] = await Promise.all([
      authReq(authToken).get('/api/v1/quality/stats'),
      authReq(authToken).get('/api/v1/quality?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toHaveProperty('pending');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
  });
});

describe('Sales API', () => {
  it('rejects unauthenticated sales stats', async () => {
    const res = await request(app).get('/api/v1/operations/stats');
    expect(res.status).toBe(401);
  });

  it.skipIf(() => !dbConnected)('returns sales stats', async () => {
    const res = await authReq(authToken).get('/api/v1/operations/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('openOrders');
    expect(res.body.data).toHaveProperty('pipelineValue');
  });

  it.skipIf(() => !dbConnected)('lists orders and quotations', async () => {
    const [orders, quotes] = await Promise.all([
      authReq(authToken).get('/api/v1/operations/orders?page=1&limit=5'),
      authReq(authToken).get('/api/v1/operations/quotations?page=1&limit=5'),
    ]);
    expect(orders.status).toBe(200);
    expect(quotes.status).toBe(200);
  });
});

describe('Delivery API', () => {
  it('rejects unauthenticated delivery stats', async () => {
    const res = await request(app).get('/api/v1/delivery/stats');
    expect(res.status).toBe(401);
  });

  it.skipIf(() => !dbConnected)('returns delivery stats and list', async () => {
    const [stats, list, vehicles] = await Promise.all([
      authReq(authToken).get('/api/v1/delivery/stats'),
      authReq(authToken).get('/api/v1/delivery?page=1&limit=5'),
      authReq(authToken).get('/api/v1/delivery/vehicles?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toHaveProperty('pending');
    expect(list.status).toBe(200);
    expect(vehicles.status).toBe(200);
  });
});
