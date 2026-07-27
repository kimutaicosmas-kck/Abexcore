import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  createComplaintSchema,
  createOpportunitySchema,
  createCustomerSchema,
  createWarrantySchema,
  resolveComplaintSchema,
  updateOpportunitySchema,
} from '../src/validators/schemas';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

describe('CRM schema validation', () => {
  it('validates customer creation', () => {
    const result = createCustomerSchema.safeParse({ code: 'CUST-999', name: 'Test Customer' });
    expect(result.success).toBe(true);
  });

  it('validates complaint creation', () => {
    const result = createComplaintSchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      subject: 'Late delivery',
      description: 'Order was late',
      priority: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('validates complaint resolution', () => {
    const result = resolveComplaintSchema.safeParse({ resolution: 'Replacement sent' });
    expect(result.success).toBe(true);
  });

  it('validates opportunity update', () => {
    const result = updateOpportunitySchema.safeParse({ stage: 'NEGOTIATION', probability: 70 });
    expect(result.success).toBe(true);
  });

  it('validates warranty registration', () => {
    const result = createWarrantySchema.safeParse({
      customerId: '550e8400-e29b-41d4-a716-446655440000',
      productId: '550e8400-e29b-41d4-a716-446655440001',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
    });
    expect(result.success).toBe(true);
  });
});

describe('CRM API', () => {
  it('rejects unauthenticated CRM stats', async () => {
    const res = await request(testCtx.app).get('/api/v1/crm/stats');
    expect(res.status).toBe(401);
  });

  itWithDb('returns CRM stats', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/crm/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('customers');
    expect(res.body.data).toHaveProperty('complaints');
    expect(res.body.data).toHaveProperty('opportunities');
    expect(res.body.data).toHaveProperty('warranties');
  });

  itWithDb('lists customers with filters', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?page=1&limit=5&isActive=true');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
  });

  itWithDb('lists complaints with open filter', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/crm/complaints?status=open&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  itWithDb('lists opportunities and warranties', async () => {
    const [opps, warranties] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/crm/opportunities?limit=10'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/crm/warranties?limit=10'),
    ]);
    expect(opps.status).toBe(200);
    expect(warranties.status).toBe(200);
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
