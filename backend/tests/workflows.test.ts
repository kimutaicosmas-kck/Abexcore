import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { generateNumber } from '../src/utils/date';
import {
  createSalesOrderSchema,
  createRequisitionSchema,
  createOpportunitySchema,
} from '../src/validators/schemas';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

async function confirmSalesOrder(orderId: string) {
  const res = await authReq(testCtx.app, testCtx.authToken)
    .patch(`/api/v1/operations/orders/${orderId}/status`)
    .send({ status: 'CONFIRMED' });
  expect(res.status).toBe(200);
  return res.body.data.status as string;
}

/** Confirm may auto-advance to READY when finished goods are in stock. */
async function ensureSalesOrderReady(orderId: string) {
  const current = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/operations/orders/${orderId}`);
  expect(current.status).toBe(200);
  if (current.body.data.status === 'READY') return;

  const readyRes = await authReq(testCtx.app, testCtx.authToken)
    .patch(`/api/v1/operations/orders/${orderId}/status`)
    .send({ status: 'READY' });
  expect(readyRes.status).toBe(200);
  expect(readyRes.body.data.status).toBe('READY');
}

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
  itWithDb('creates a sales order with a plain date and advances status', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    expect(customersRes.status).toBe(200);
    const customerId = customersRes.body.data[0]?.id;
    expect(customerId).toBeTruthy();

    const productsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?limit=1');
    expect(productsRes.status).toBe(200);
    const productId = productsRes.body.data[0]?.id;
    expect(productId).toBeTruthy();

    const createRes = await authReq(testCtx.app, testCtx.authToken)
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
    const statusAfterConfirm = await confirmSalesOrder(orderId);
    expect(['CONFIRMED', 'READY']).toContain(statusAfterConfirm);
  });
});

describe('RFQ workflow (integration)', () => {
  itWithDb('runs requisition → approve → RFQ → quote → award → PO', async () => {
    const materialsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/materials?limit=1');
    expect(materialsRes.status).toBe(200);
    const rawMaterialId = materialsRes.body.data[0]?.id;
    expect(rawMaterialId).toBeTruthy();

    const suppliersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/suppliers?limit=1');
    expect(suppliersRes.status).toBe(200);
    const supplierId = suppliersRes.body.data[0]?.id;
    expect(supplierId).toBeTruthy();

    const reqRes = await authReq(testCtx.app, testCtx.authToken)
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

    const approveRes = await authReq(testCtx.app, testCtx.authToken)
      .patch(`/api/v1/inventory/requisitions/${requisitionId}/approve`)
      .send({ status: 'APPROVED' });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('APPROVED');

    const rfqRes = await authReq(testCtx.app, testCtx.authToken)
      .post(`/api/v1/inventory/requisitions/${requisitionId}/rfq`)
      .send({ supplierIds: [supplierId], notes: 'Workflow test RFQ' });
    expect(rfqRes.status).toBe(201);
    expect(rfqRes.body.data.rfqNo).toMatch(/^RFQ-/);

    const rfqId = rfqRes.body.data.id;
    const quotationId = rfqRes.body.data.quotations[0]?.id;
    expect(quotationId).toBeTruthy();

    const quoteRes = await authReq(testCtx.app, testCtx.authToken)
      .patch(`/api/v1/inventory/quotations/${quotationId}`)
      .send({ totalAmount: 2400, notes: 'Test quote' });
    expect(quoteRes.status).toBe(200);

    const awardRes = await authReq(testCtx.app, testCtx.authToken)
      .patch(`/api/v1/inventory/rfqs/${rfqId}/award`)
      .send({ quotationId });
    expect(awardRes.status).toBe(200);
    expect(awardRes.body.message).toContain('purchase order');
    expect(awardRes.body.data.status).toBe('APPROVED');
  });
});

describe('Order-to-cash workflow (integration)', () => {
  itWithDb('runs order → confirm → ready → delivery → auto invoice → credit sync', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    const productsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?limit=1');
    expect(customersRes.status).toBe(200);
    expect(productsRes.status).toBe(200);

    const customerId = customersRes.body.data[0]?.id;
    const productId = productsRes.body.data[0]?.id;
    expect(customerId).toBeTruthy();
    expect(productId).toBeTruthy();

    const createRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/operations/orders')
      .send({
        customerId,
        notes: 'Order-to-cash E2E',
        items: [{ productId, quantity: 1, unitPrice: 150 }],
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.id;

    await confirmSalesOrder(orderId);
    await ensureSalesOrderReady(orderId);

    const deliveryRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/delivery')
      .send({
        salesOrderId: orderId,
        notes: 'E2E dispatch',
        items: [{ productId, quantity: 1 }],
      });
    expect(deliveryRes.status).toBe(201);
    expect(deliveryRes.body.invoice?.invoiceNumber).toMatch(/^INV-/);
    expect(deliveryRes.body.data.status).toMatch(/PENDING|ASSIGNED/);

    const orderRes = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/operations/orders/${orderId}`);
    expect(orderRes.status).toBe(200);
    expect(orderRes.body.data.status).toBe('DISPATCHED');
    expect(orderRes.body.data.invoices?.length).toBeGreaterThan(0);

    const customerRes = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/customers/${customerId}`);
    expect(customerRes.status).toBe(200);
    expect(Number(customerRes.body.data.creditUsed)).toBeGreaterThan(0);

    const deliveryNo = deliveryRes.body.data.deliveryNo as string;
    const journalsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/journal-entries?limit=50');
    expect(journalsRes.status).toBe(200);
    const cogsEntry = (journalsRes.body.data as {
      reference?: string;
      description?: string;
      lines?: { account?: { code?: string }; debit?: number }[];
    }[]).find(
      (entry) =>
        entry.reference === deliveryNo &&
        entry.description?.includes('Cost of goods sold')
    );
    if (cogsEntry) {
      const cogsLine = cogsEntry.lines?.find((line) => line.account?.code === '5100');
      expect(Number(cogsLine?.debit)).toBeGreaterThan(0);
    }
  });
});

describe('Procure-to-pay workflow (integration)', () => {
  itWithDb('runs GRN → QC pass → post to stock → GL entry', async () => {
    const [suppliersRes, warehousesRes, materialsRes] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/suppliers?limit=1'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/warehouses'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/materials?limit=1'),
    ]);

    expect(suppliersRes.status).toBe(200);
    expect(warehousesRes.status).toBe(200);
    expect(materialsRes.status).toBe(200);

    const supplierId = suppliersRes.body.data[0]?.id;
    const warehouseId = warehousesRes.body.data[0]?.id;
    const rawMaterialId = materialsRes.body.data[0]?.id;
    expect(supplierId).toBeTruthy();
    expect(warehouseId).toBeTruthy();
    expect(rawMaterialId).toBeTruthy();

    const grnRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/inventory/goods-receipts')
      .send({
        supplierId,
        warehouseId,
        notes: 'Procure-to-pay E2E',
        items: [{ rawMaterialId, quantity: 10, unit: 'pcs', unitCost: 45 }],
      });
    expect(grnRes.status).toBe(201);
    expect(grnRes.body.data.status).toBe('PENDING');
    const grnId = grnRes.body.data.id;
    const grnNumber = grnRes.body.data.grnNumber;

    const qcRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/quality')
      .send({
        type: 'incoming',
        goodsReceiptId: grnId,
        status: 'PASSED',
        result: 'E2E inspection passed',
      });
    expect(qcRes.status).toBe(201);

    const postRes = await authReq(testCtx.app, testCtx.authToken)
      .post(`/api/v1/inventory/goods-receipts/${grnId}/post-to-stock`);
    expect(postRes.status).toBe(200);
    expect(postRes.body.data.status).toBe('APPROVED');

    const journalsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/journal-entries?limit=20');
    expect(journalsRes.status).toBe(200);
    const posted = (journalsRes.body.data as { reference?: string; description?: string }[]).some(
      (entry) => entry.reference === grnNumber || entry.description?.includes(grnNumber)
    );
    expect(posted).toBe(true);
  });
});

describe('Decoupled production workflow (integration)', () => {
  itWithDb('admin marks sales order READY after independent production adds stock', async () => {
    const [customersRes, productsRes, machinesRes, warehousesRes] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?limit=1'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/operations/machines'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/warehouses'),
    ]);

    const customerId = customersRes.body.data[0]?.id;
    const productId = productsRes.body.data[0]?.id;
    const machineId = machinesRes.body.data[0]?.id;
    const warehouseId = warehousesRes.body.data[0]?.id;
    expect(customerId && productId && machineId && warehouseId).toBeTruthy();

    const orderRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/operations/orders')
      .send({
        customerId,
        items: [{ productId, quantity: 1, unitPrice: 150 }],
      });
    expect(orderRes.status).toBe(201);
    const salesOrderId = orderRes.body.data.id;

    await confirmSalesOrder(salesOrderId);

    const productionRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/operations/production')
      .send({
        productId,
        machineId,
        quantity: 1,
        scheduledStart: new Date().toISOString(),
      });
    expect(productionRes.status).toBe(201);
    const productionId = productionRes.body.data.id;

    await authReq(testCtx.app, testCtx.authToken).post(`/api/v1/operations/production/${productionId}/start`);

    const qcRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/quality')
      .send({
        type: 'production',
        productionOrderId: productionId,
        status: 'PASSED',
        result: 'Production QC passed',
      });
    expect(qcRes.status).toBe(201);

    const completeRes = await authReq(testCtx.app, testCtx.authToken)
      .post(`/api/v1/operations/production/${productionId}/complete`)
      .send({ completedQty: 1, rejectedQty: 0 });
    expect(completeRes.status).toBe(200);

    await ensureSalesOrderReady(salesOrderId);

    const salesRes = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/operations/orders/${salesOrderId}`);
    expect(salesRes.status).toBe(200);
    expect(salesRes.body.data.status).toBe('READY');

    const productionOrderNo = completeRes.body.data.orderNumber as string;
    const journalsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/journal-entries?limit=50');
    expect(journalsRes.status).toBe(200);
    const costingEntry = (journalsRes.body.data as {
      reference?: string;
      description?: string;
    }[]).find(
      (entry) =>
        entry.reference === productionOrderNo &&
        entry.description?.includes('Production costing')
    );
    if (costingEntry) {
      expect(costingEntry.reference).toBe(productionOrderNo);
    }
  });

  itWithDb('completes surplus production using standalone product inspection', async () => {
    const [productsRes, machinesRes, warehousesRes] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?limit=1'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/operations/machines'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/inventory/warehouses'),
    ]);

    const productId = productsRes.body.data[0]?.id;
    const machineId = machinesRes.body.data[0]?.id;
    const warehouseId = warehousesRes.body.data[0]?.id;
    expect(productId && machineId && warehouseId).toBeTruthy();

    const productionRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/operations/production')
      .send({
        productId,
        machineId,
        quantity: 2,
        notes: 'Surplus stock run',
      });
    expect(productionRes.status).toBe(201);
    const productionId = productionRes.body.data.id;

    await authReq(testCtx.app, testCtx.authToken).post(`/api/v1/operations/production/${productionId}/start`);

    const qcRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/quality')
      .send({
        type: 'production',
        productId,
        status: 'PASSED',
        result: 'Surplus batch approved',
      });
    expect(qcRes.status).toBe(201);

    const completeRes = await authReq(testCtx.app, testCtx.authToken)
      .post(`/api/v1/operations/production/${productionId}/complete`)
      .send({ completedQty: 2, rejectedQty: 0 });
    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.status).toBe('COMPLETED');
  });
});

describe('Partial delivery workflow (integration)', () => {
  itWithDb('allows multiple delivery notes and partial invoices', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    const productsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/products?limit=1');
    const customerId = customersRes.body.data[0]?.id;
    const productId = productsRes.body.data[0]?.id;

    const createRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/operations/orders')
      .send({
        customerId,
        items: [{ productId, quantity: 4, unitPrice: 150 }],
      });
    expect(createRes.status).toBe(201);
    const orderId = createRes.body.data.id;

    await confirmSalesOrder(orderId);
    await ensureSalesOrderReady(orderId);

    const firstDelivery = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/delivery').send({
      salesOrderId: orderId,
      items: [{ productId, quantity: 2 }],
    });
    expect(firstDelivery.status).toBe(201);
    expect(firstDelivery.body.invoice?.totalAmount).toBeTruthy();

    const partialOrder = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/operations/orders/${orderId}`);
    expect(partialOrder.body.data.status).toBe('PARTIALLY_DELIVERED');

    const secondDelivery = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/delivery').send({
      salesOrderId: orderId,
      items: [{ productId, quantity: 2 }],
    });
    expect(secondDelivery.status).toBe(201);

    const finalOrder = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/operations/orders/${orderId}`);
    expect(finalOrder.body.data.status).toBe('DISPATCHED');
    expect(finalOrder.body.data.invoices.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Overdue invoice automation (integration)', () => {
  itWithDb('marks past-due invoices as OVERDUE via maintenance endpoint', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    expect(customersRes.status).toBe(200);
    const customerId = customersRes.body.data[0]?.id;
    expect(customerId).toBeTruthy();

    const createRes = await authReq(testCtx.app, testCtx.authToken)
      .post('/api/v1/finance/invoices')
      .send({
        type: 'SALES',
        customerId,
        dueDate: '2020-01-01',
        notes: 'Overdue automation E2E',
        items: [{ description: 'Test overdue item', quantity: 1, unitPrice: 100 }],
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('UNPAID');
    const invoiceId = createRes.body.data.id;

    const markRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/maintenance/mark-overdue');
    expect(markRes.status).toBe(200);
    expect(markRes.body.data.marked).toBeGreaterThanOrEqual(1);

    const invoiceRes = await authReq(testCtx.app, testCtx.authToken).get(`/api/v1/finance/invoices/${invoiceId}`);
    expect(invoiceRes.status).toBe(200);
    expect(invoiceRes.body.data.status).toBe('OVERDUE');

    const statsRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/stats');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.overdueInvoices).toBeGreaterThanOrEqual(1);
  });
});

describe('Protected workflow endpoints', () => {
  it('rejects unauthenticated sales order creation', async () => {
    const res = await request(testCtx.app)
      .post('/api/v1/operations/orders')
      .send({ customerId: 'x', items: [] });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated RFQ listing', async () => {
    const res = await request(testCtx.app).get('/api/v1/inventory/rfqs');
    expect(res.status).toBe(401);
  });
});
