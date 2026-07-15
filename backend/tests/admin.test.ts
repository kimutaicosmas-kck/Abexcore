import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
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
  if (dbConnected) authToken = await login();
});

describe('Finance schema validation', () => {
  it('validates company settings', () => {
    expect(companySettingsSchema.safeParse({ name: 'ApexCore Ltd', vatRate: 16 }).success).toBe(true);
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
    expect((await request(app).get('/api/v1/finance/stats')).status).toBe(401);
  });
  it.skipIf(() => !dbConnected)('returns finance stats and invoices', async () => {
    const [stats, invoices] = await Promise.all([
      authReq(authToken).get('/api/v1/finance/stats'),
      authReq(authToken).get('/api/v1/finance/invoices?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(stats.body.data).toHaveProperty('monthlyRevenue');
    expect(invoices.status).toBe(200);
  });
});

describe('HR API', () => {
  it.skipIf(() => !dbConnected)('returns HR stats and employees', async () => {
    const [stats, employees] = await Promise.all([
      authReq(authToken).get('/api/v1/hr/stats'),
      authReq(authToken).get('/api/v1/hr/employees?page=1&limit=5'),
    ]);
    expect(stats.status).toBe(200);
    expect(employees.status).toBe(200);
  });
});

describe('Maintenance API', () => {
  it.skipIf(() => !dbConnected)('returns maintenance stats', async () => {
    const res = await authReq(authToken).get('/api/v1/maintenance/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalMachines');
  });
});

describe('Reports & Settings API', () => {
  it.skipIf(() => !dbConnected)('returns reports summary and company settings', async () => {
    const [summary, company] = await Promise.all([
      authReq(authToken).get('/api/v1/finance/reports/summary'),
      authReq(authToken).get('/api/v1/finance/company'),
    ]);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toHaveProperty('topCustomers');
    expect(company.status).toBe(200);
  });
});
