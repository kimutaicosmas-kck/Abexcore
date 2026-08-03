import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { BankReconciliationService } from '../src/services/bank-reconciliation.service';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

describe('BankReconciliationService.parseCsv', () => {
  it('parses CSV with header row', () => {
    const csv = `date,description,reference,amount
2026-07-01,Customer payment,REF123,1500.00
2026-07-02,Supplier refund,REF456,-200`;
    const lines = BankReconciliationService.parseCsv(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0].amount).toBe(1500);
    expect(lines[0].reference).toBe('REF123');
  });
});

describe('Bank reconciliation API (integration)', () => {
  itWithDb('imports statement, auto-matches payment, and returns report', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    const customerId = customersRes.body.data[0]?.id;
    expect(customerId).toBeTruthy();

    const invoiceRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/invoices').send({
      type: 'SALES',
      customerId,
      dueDate: '2026-08-01',
      items: [{ description: 'Reconciliation test item', quantity: 1, unitPrice: 1000 }],
    });
    expect(invoiceRes.status).toBe(201);
    const invoiceId = invoiceRes.body.data.id;
    const invoiceTotal = Number(invoiceRes.body.data.totalAmount);

    const payDate = new Date().toISOString().slice(0, 10);
    const paymentRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/payments').send({
      invoiceId,
      amount: invoiceTotal,
      method: 'BANK_TRANSFER',
      reference: 'BNK-RECON-001',
    });
    expect(paymentRes.status).toBe(201);
    const paymentId = paymentRes.body.data.id;

    const csv = `date,description,reference,amount
${payDate},Bank deposit,BNK-RECON-001,${invoiceTotal}`;

    const importRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/bank-statements/import').send({
      csvText: csv,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      closingBalance: invoiceTotal,
    });
    expect(importRes.status).toBe(201);
    const statementId = importRes.body.data.id;

    const matchRes = await authReq(testCtx.app, testCtx.authToken).post(
      `/api/v1/finance/bank-reconciliation/auto-match/${statementId}`
    );
    expect(matchRes.status).toBe(200);
    expect(matchRes.body.data.matched).toBeGreaterThanOrEqual(1);

    const reportRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/bank-reconciliation');
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data).toHaveProperty('variance');
    expect(reportRes.body.data).toHaveProperty('latestStatement');

    const paymentCheck = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/payments?limit=5');
    const reconciled = (paymentCheck.body.data as { id: string; isReconciled: boolean }[]).find(
      (p) => p.id === paymentId
    );
    expect(reconciled?.isReconciled).toBe(true);
  });
});

describe('KRA eTIMS API (integration)', () => {
  itWithDb('submits sales invoice to eTIMS stub and exports VAT report', async () => {
    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    const customerId = customersRes.body.data[0]?.id;

    const invoiceRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/invoices').send({
      type: 'SALES',
      customerId,
      items: [{ description: 'eTIMS test', quantity: 1, unitPrice: 500 }],
    });
    expect(invoiceRes.status).toBe(201);
    expect(invoiceRes.body.data.fiscalStatus).toBe('PENDING');

    const submitRes = await authReq(testCtx.app, testCtx.authToken).post(
      `/api/v1/finance/invoices/${invoiceRes.body.data.id}/submit-etims`
    );
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.data.fiscalStatus).toBe('SUBMITTED');
    expect(submitRes.body.data.etimsControlCode).toBeTruthy();

    const exportRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/reports/vat-itax-export');
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.data.lineCount).toBeGreaterThan(0);
  });
});

describe('M-Pesa API (integration)', () => {
  itWithDb('initiates STK push in stub mode', async () => {
    process.env.MPESA_ENV = 'stub';

    const customersRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/customers?limit=1');
    const customerId = customersRes.body.data[0]?.id;

    const invoiceRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/invoices').send({
      type: 'SALES',
      customerId,
      items: [{ description: 'M-Pesa test', quantity: 1, unitPrice: 200 }],
    });
    expect(invoiceRes.status).toBe(201);
    const invoiceTotal = Number(invoiceRes.body.data.totalAmount);

    const statusRes = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/mpesa/status');
    expect(statusRes.status).toBe(200);

    if (!statusRes.body.data.configured) return;

    const stkRes = await authReq(testCtx.app, testCtx.authToken).post('/api/v1/finance/mpesa/stk-push').send({
      invoiceId: invoiceRes.body.data.id,
      phone: '0712345678',
      amount: invoiceTotal,
    });
    expect(stkRes.status).toBe(201);
    expect(stkRes.body.data.checkoutRequestId).toBeTruthy();
  });
});
