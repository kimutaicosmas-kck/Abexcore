import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  createProductSchema,
  updateProductSchema,
  productListQuerySchema,
  createRawMaterialSchema,
  materialListQuerySchema,
  procurementListQuerySchema,
  stockAdjustSchema,
} from '../src/validators/schemas';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

describe('Products schema validation', () => {
  it('validates product creation', () => {
    const result = createProductSchema.safeParse({
      sku: 'AF-1001',
      name: 'Air Filter 1001',
      categoryId: '550e8400-e29b-41d4-a716-446655440000',
      sellingPrice: 1500,
    });
    expect(result.success).toBe(true);
  });

  it('validates product update with isActive', () => {
    const result = updateProductSchema.safeParse({ isActive: false, sellingPrice: 1200 });
    expect(result.success).toBe(true);
  });

  it('validates product list query', () => {
    const result = productListQuerySchema.safeParse({
      page: 1,
      limit: 15,
      category: '550e8400-e29b-41d4-a716-446655440000',
      isActive: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('Inventory schema validation', () => {
  it('validates raw material creation', () => {
    const result = createRawMaterialSchema.safeParse({
      name: 'Filter Paper Roll',
      typeId: '550e8400-e29b-41d4-a716-446655440000',
      unitCost: 500,
    });
    expect(result.success).toBe(true);
  });

  it('validates material list query with type filter', () => {
    const result = materialListQuerySchema.safeParse({
      page: 1,
      limit: 20,
      type: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('validates stock adjustment', () => {
    const result = stockAdjustSchema.safeParse({
      warehouseId: '550e8400-e29b-41d4-a716-446655440000',
      productId: '550e8400-e29b-41d4-a716-446655440001',
      quantity: 10,
      type: 'add',
    });
    expect(result.success).toBe(true);
  });
});

describe('Procurement schema validation', () => {
  it('validates procurement list query', () => {
    const result = procurementListQuerySchema.safeParse({ page: 1, limit: 15, status: 'PENDING', search: 'PO' });
    expect(result.success).toBe(true);
  });
});

describe('Products API', () => {
  it('rejects unauthenticated product stats', async () => {
    const res = await request(testCtx.app).get('/api/v1/products/stats');
    expect(res.status).toBe(401);
  });

  itWithDb('returns product stats', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('inactive');
  });

  itWithDb('lists products with filters', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?page=1&limit=5&isActive=true');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
  });

  itWithDb('lists product categories', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products/categories/list');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Inventory API', () => {
  it('rejects unauthenticated inventory stats', async () => {
    const res = await request(testCtx.app).get('/api/v1/inventory/stats');
    expect(res.status).toBe(401);
  });

  itWithDb('returns inventory stats', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('materialsCount');
    expect(res.body.data).toHaveProperty('inventoryValue');
  });

  itWithDb('lists materials and stock levels', async () => {
    const [materials, stock] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/materials?page=1&limit=5'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/stock-levels?page=1&limit=5'),
    ]);
    expect(materials.status).toBe(200);
    expect(stock.status).toBe(200);
  });

  itWithDb('lists inventory transactions', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/transactions?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Procurement API', () => {
  it('rejects unauthenticated procurement stats', async () => {
    const res = await request(testCtx.app).get('/api/v1/inventory/procurement-stats');
    expect(res.status).toBe(401);
  });

  itWithDb('returns procurement stats', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/procurement-stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('pendingRequisitions');
    expect(res.body.data).toHaveProperty('activePoValue');
    expect(res.body.data).toHaveProperty('suppliers');
  });

  itWithDb('lists purchase orders, requisitions, and RFQs', async () => {
    const [pos, reqs, rfqs] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/purchase-orders?page=1&limit=5'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/requisitions?page=1&limit=5'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/rfqs?page=1&limit=5'),
    ]);
    expect(pos.status).toBe(200);
    expect(reqs.status).toBe(200);
    expect(rfqs.status).toBe(200);
  });

  itWithDb('lists goods receipts and suppliers', async () => {
    const [grns, suppliers] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/goods-receipts?page=1&limit=5'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/suppliers?page=1&limit=5'),
    ]);
    expect(grns.status).toBe(200);
    expect(suppliers.status).toBe(200);
  });
});
