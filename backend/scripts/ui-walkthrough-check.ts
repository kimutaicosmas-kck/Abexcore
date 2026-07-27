import 'dotenv/config';
import request from 'supertest';
import { createApp } from '../src/app';
import {
  PLATFORM_OWNER_DEFAULT_PASSWORD,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_SLUG,
} from '../src/config/platformOwner';

const app = createApp();

async function get(path: string, token: string) {
  const res = await request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body };
}

async function main() {
  const login = await request(app)
    .post('/api/v1/auth/login')
    .send({
      companySlug: PLATFORM_OWNER_SLUG,
      email: PLATFORM_OWNER_EMAIL,
      password: PLATFORM_OWNER_DEFAULT_PASSWORD,
    });

  if (login.status !== 200) {
    console.error('Login failed', login.body);
    process.exit(1);
  }

  const token = login.body.data.accessToken as string;
  const user = login.body.data.user;

  console.log('=== UI WALKTHROUGH DATA CHECK ===');
  console.log(`User: ${user.firstName} ${user.lastName} (${user.roleName})`);
  console.log(`Company: ${user.company?.name || PLATFORM_OWNER_SLUG}`);
  console.log('Frontend: http://localhost:5173/login');
  console.log('Backend:  http://localhost:3001/api/health\n');

  const checks: { screen: string; path: string; ok: boolean; detail: string }[] = [];

  const endpoints = [
    { screen: 'Dashboard', path: '/api/v1/dashboard/kpis' },
    { screen: 'Dashboard Charts', path: '/api/v1/dashboard/charts?days=30' },
    { screen: 'Users', path: '/api/v1/users?limit=5' },
    { screen: 'Customers', path: '/api/v1/customers?limit=5' },
    { screen: 'Products', path: '/api/v1/products?limit=5' },
    { screen: 'Inventory', path: '/api/v1/inventory/stock-levels?limit=5' },
    { screen: 'Procurement POs', path: '/api/v1/inventory/purchase-orders?limit=5' },
    { screen: 'Production', path: '/api/v1/operations/production?limit=5' },
    { screen: 'Quality', path: '/api/v1/quality?limit=5' },
    { screen: 'Sales Orders', path: '/api/v1/operations/orders?limit=5' },
    { screen: 'Delivery', path: '/api/v1/delivery?limit=5' },
    { screen: 'Finance Invoices', path: '/api/v1/finance/invoices?limit=5' },
    { screen: 'Finance Accounts', path: '/api/v1/finance/accounts?limit=5' },
    { screen: 'HR Employees', path: '/api/v1/hr/employees?limit=5' },
    { screen: 'Maintenance', path: '/api/v1/maintenance/machines?limit=5' },
    { screen: 'CRM Stats', path: '/api/v1/crm/stats' },
    { screen: 'Reports', path: '/api/v1/finance/reports/summary' },
    { screen: 'Settings', path: '/api/v1/tenant/workspace' },
  ];

  for (const ep of endpoints) {
    const res = await get(ep.path, token);
    let detail = `HTTP ${res.status}`;
    if (res.status === 200 && res.body?.data) {
      const data = res.body.data;
      if (Array.isArray(data)) detail += ` — ${data.length} rows (page)`;
      else if (data.total !== undefined) detail += ` — total ${data.total}`;
      else if (typeof data === 'object') {
        const keys = Object.keys(data).slice(0, 4).join(', ');
        detail += ` — keys: ${keys}`;
      }
    } else if (res.body?.message) {
      detail += ` — ${res.body.message}`;
    }
    checks.push({ screen: ep.screen, path: ep.path, ok: res.status === 200, detail });
  }

  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.screen.padEnd(20)} ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} screens have live API data`);
  if (failed.length) {
    console.log('Failed:', failed.map((f) => f.screen).join(', '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
