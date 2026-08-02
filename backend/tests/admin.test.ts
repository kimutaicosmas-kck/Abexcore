import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  companySettingsSchema,
  financeListQuerySchema,
  createInvoiceSchema,
  createJournalEntrySchema,
  hrListQuerySchema,
  createEmployeeSchema,
  approveLeaveSchema,
  maintenanceListQuerySchema,
  createMachineSchema,
  createMaintenanceSchema,
} from '../src/validators/schemas';
import { authReq } from './helpers/testAuth';
import { testCtx, itWithDb } from './setup';

describe('Finance schema validation', () => {
  it('validates company settings', () => {
    expect(companySettingsSchema.safeParse({ name: 'AbexCore Ltd', vatRate: 16 }).success).toBe(true);
  });
  it('validates invoice list query', () => {
    expect(financeListQuerySchema.safeParse({ page: 1, limit: 15, type: 'SALES' }).success).toBe(true);
  });
  it('validates journal entry', () => {
    expect(createJournalEntrySchema.safeParse({
      description: 'Test entry',
      lines: [
        { accountId: '550e8400-e29b-41d4-a716-446655440000', debit: 1000, credit: 0 },
        { accountId: '550e8400-e29b-41d4-a716-446655440001', debit: 0, credit: 1000 },
      ],
    }).success).toBe(true);
  });
});

describe('HR schema validation', () => {
  it('validates employee creation', () => {
    expect(createEmployeeSchema.safeParse({
      employeeNo: 'EMP-100',
      firstName: 'Jane',
      lastName: 'Doe',
      hireDate: '2024-01-01',
    }).success).toBe(true);
  });
  it('validates leave approval', () => {
    expect(approveLeaveSchema.safeParse({ status: 'APPROVED' }).success).toBe(true);
  });
});

describe('Maintenance schema validation', () => {
  it('validates machine creation', () => {
    expect(createMachineSchema.safeParse({ code: 'MCH-01', name: 'Press A', type: 'Press' }).success).toBe(true);
  });
  it('validates maintenance request', () => {
    expect(createMaintenanceSchema.safeParse({
      machineId: '550e8400-e29b-41d4-a716-446655440000',
      type: 'Preventive',
      description: 'Oil change',
    }).success).toBe(true);
  });
});

describe('Finance API', () => {
  it('rejects unauthenticated finance stats', async () => {
    expect((await request(testCtx.app).get('/api/v1/finance/stats')).status).toBe(401);
  });
  itWithDb('returns finance stats and invoices', async () => {
    const [stats, invoices] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/stats'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/invoices?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toHaveProperty('monthlyRevenue');
    expect(invoices.status).toBe(200);
  });
});

describe('HR API', () => {
  itWithDb('returns HR stats and employees', async () => {
    const [stats, employees] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/hr/stats'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/hr/employees?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(employees.status).toBe(200);
  });
});

describe('Maintenance API', () => {
  itWithDb('returns maintenance stats', async () => {
    const res = await authReq(testCtx.app, testCtx.authToken).get('/api/v1/maintenance/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalMachines');
  });
});

describe('Reports & Settings API', () => {
  itWithDb('returns reports summary and company settings', async () => {
    const [summary, company] = await Promise.all([
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/reports/summary'),
      authReq(testCtx.app, testCtx.authToken).get('/api/v1/finance/company'),
    ]);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toHaveProperty('topCustomers');
    expect(company.status).toBe(200);
  });
});
