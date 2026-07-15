import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { createUserSchema, updateUserSchema, userListQuerySchema } from '../src/validators/schemas';

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

describe('User schema validation', () => {
  it('validates user creation payload', () => {
    const result = createUserSchema.safeParse({
      email: 'new.user@example.com',
      password: 'SecurePass1',
      firstName: 'New',
      lastName: 'User',
      roleId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects weak passwords on create', () => {
    const result = createUserSchema.safeParse({
      email: 'new.user@example.com',
      password: 'short',
      firstName: 'New',
      lastName: 'User',
      roleId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('allows partial updates with status', () => {
    const result = updateUserSchema.safeParse({ status: 'SUSPENDED' });
    expect(result.success).toBe(true);
  });

  it('validates user list query filters', () => {
    const result = userListQuerySchema.safeParse({
      page: 1,
      limit: 15,
      search: 'admin',
      status: 'ACTIVE',
    });
    expect(result.success).toBe(true);
  });
});

describe('Users API', () => {
  it('rejects unauthenticated user list', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  it.skipIf(() => !dbConnected)('returns user stats', async () => {
    const res = await authReq(authToken).get('/api/v1/users/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('byRole');
  });

  it.skipIf(() => !dbConnected)('lists users with pagination', async () => {
    const res = await authReq(authToken).get('/api/v1/users?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
  });

  it.skipIf(() => !dbConnected)('returns roles with permissions', async () => {
    const res = await authReq(authToken).get('/api/v1/users/roles');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('permissions');
  });

  it.skipIf(() => !dbConnected)('returns branches and departments', async () => {
    const [branches, departments] = await Promise.all([
      authReq(authToken).get('/api/v1/users/branches'),
      authReq(authToken).get('/api/v1/users/departments'),
    ]);
    expect(branches.status).toBe(200);
    expect(departments.status).toBe(200);
  });

  it.skipIf(() => !dbConnected)('returns audit logs', async () => {
    const res = await authReq(authToken).get('/api/v1/users/audit-logs?page=1&limit=10');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it.skipIf(() => !dbConnected)('prevents self-deactivation', async () => {
    const me = await authReq(authToken).get('/api/v1/auth/me');
    const userId = me.body.data.id;
    const res = await authReq(authToken).delete(`/api/v1/users/${userId}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot deactivate/i);
  });
});
