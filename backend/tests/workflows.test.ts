import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { generateNumber } from '../src/utils/date';
import {
  createSalesOrderSchema,
  createRequisitionSchema,
  createOpportunitySchema,
} from '../src/validators/schemas';

const app = createApp();
let dbConnected = false;
let authToken = '';

async function login(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@filtererp.co.ke', password: 'Admin@123' });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status}`);
  return res.body.data.token as string;
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

describe('Sales order schema validation', () => {
  it('accepts plain date strings for requiredDate', () => {
    const result = createSalesOrderSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      requiredDate: '2026-07-20',
      items: [{ productId: '550e8400-e29b-41d4-a716-446655440001', quantity: 5, unitPrice: 150 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects orders without items', () => {
    const result = createSalesOrderSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('RFQ schema validation', () => {
  it('validates requisition payload for RFQ workflow', () => {
    const result = createRequisitionSchema.safeParse({
      department: 'Procurement',
      items: [{ description: 'Steel Shell', quantity: 100, unit: 'pcs', estimatedCost: 4500 }],
    });
    expect(result.success).toBe(true);
  });

  it('generates RFQ document numbers', () => {
    const year = new Date().getFullYear();
    expect(generateNumber('RFQ', 7)).toBe(`RFQ-${year}-00007`);
  });
});

describe('CRM opportunity schema', () => {
  it('validates opportunity creation payload', () => {
    const result = createOpportunitySchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      title: 'Bulk filter supply',
      value: 250000,
      stage: 'PROPOSAL',
      probability: 60,
    });
    expect(result.success).toBe(true);
  });
});

describe('Sales order workflow (integration)', () => {
  it.skipIf(() => !dbConnected)('creates a sales order with a plain date and advances status', async () => {
    const customersRes = await authReq(authToken).get('/api/v1/customers?limit=1');
    expect(customersRes.status).toBe(200);
    const customerId = customersRes.body.data[0]?.id;
    expect(customerId).toBeTruthy();

    const productsRes = await authReq(authToken).get('/api/v1/products?limit=1');
    expect(productsRes.status).toBe(200);
    const productId = productsRes.body.data[0]?.id;
    expect(productId).toBeTruthy();

    const createRes = await authReq(authToken)
      .post('/api/v1/operations/orders')
      .send({
        customerId,
        requiredDate: '2026-08-01',
        notes: 'Workflow test order',
        items: [{ productId, quantity: 2, unitPrice: 150 }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.orderNumber).toMatch(/^SO-/);
    expect(createRes.body.data.status).toBeTruthy();

    const orderId = createRes.body.data.id;
    const statusRes = await authReq(authToken)
      .patch(`/api/v1/operations/orders/${orderId}/status`)
      .send({ status: 'CONFIRMED' });

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.status).toBe('CONFIRMED');
  });
});

describe('RFQ workflow (integration)', () => {
  it.skipIf(() => !dbConnected)('runs requisition → approve → RFQ → quote → award → PO', async () => {
    const materialsRes = await authReq(authToken).get('/api/v1/inventory/materials?limit=1');
    expect(materialsRes.status).toBe(200);
    const rawMaterialId = materialsRes.body.data[0]?.id;
    expect(rawMaterialId).toBeTruthy();

    const suppliersRes = await authReq(authToken).get('/api/v1/inventory/suppliers?limit=1');
    expect(suppliersRes.status).toBe(200);
    const supplierId = suppliersRes.body.data[0]?.id;
    expect(supplierId).toBeTruthy();

    const reqRes = await authReq(authToken)
      .post('/api/v1/inventory/requisitions')
      .send({
        department: 'Test Procurement',
        items: [{
          rawMaterialId,
          description: 'Workflow test requisition',
          quantity: 50,
          unit: 'pcs',
          estimatedCost: 2250,
        }],
      });
    expect(reqRes.status).toBe(201);
    const requisitionId = reqRes.body.data.id;

    const approveRes = await authReq(authToken)
      .patch(`/api/v1/inventory/requisitions/${requisitionId}/approve`)
      .send({ status: 'APPROVED' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    const rfqRes = await authReq(authToken)
      .post(`/api/v1/inventory/requisitions/${requisitionId}/rfq`)
      .send({ supplierIds: [supplierId], notes: 'Workflow test RFQ' });
    expect(rfqRes.status).toBe(201);
    expect(rfqRes.body.data.rfqNo).toMatch(/^RFQ-/);

    const rfqId = rfqRes.body.data.id;
    const quotationId = rfqRes.body.data.quotations[0]?.id;
    expect(quotationId).toBeTruthy();

    const quoteRes = await authReq(authToken)
      .patch(`/api/v1/inventory/quotations/${quotationId}`)
      .send({ totalAmount: 2400, notes: 'Test quote' });
    expect(quoteRes.status).toBe(200);

    const awardRes = await authReq(authToken)
      .patch(`/api/v1/inventory/rfqs/${rfqId}/award`)
      .send({ quotationId });
    expect(awardRes.status).toBe(200);
    expect(awardRes.body.message).toContain('purchase order');
    expect(awardRes.body.data.status).toBe('APPROVED');
  });
});

describe('Protected workflow endpoints', () => {
  it('rejects unauthenticated sales order creation', async () => {
    const res = await request(app)
      .post('/api/v1/operations/orders')
      .send({ customerId: 'x', items: [] });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated RFQ listing', async () => {
    const res = await request(app).get('/api/v1/inventory/rfqs');
    expect(res.status).toBe(401);
  });
});
