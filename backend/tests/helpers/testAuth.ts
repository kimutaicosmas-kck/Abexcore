import request from 'supertest';
import type { Express } from 'express';
import {
  PLATFORM_OWNER_DEFAULT_PASSWORD,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_SLUG,
} from '../../src/config/platformOwner';

export async function checkDbConnected(app: Express): Promise<boolean> {
  const health = await request(app).get('/api/health');
  return health.body.database === 'connected';
}

export async function loginAsPlatformOwner(app: Express): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({
      companySlug: PLATFORM_OWNER_SLUG,
      email: PLATFORM_OWNER_EMAIL,
      password: PLATFORM_OWNER_DEFAULT_PASSWORD,
    });

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.status} — ${res.body?.message || 'unknown error'}`);
  }

  return res.body.data.accessToken as string;
}

export function authReq(app: Express, token: string) {
  if (!token) {
    throw new Error('authReq called without a token — ensure test setup completed login');
  }
  const agent = request(app);
  return {
    get: (url: string) => agent.get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => agent.post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => agent.put(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => agent.patch(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => agent.delete(url).set('Authorization', `Bearer ${token}`),
  };
}