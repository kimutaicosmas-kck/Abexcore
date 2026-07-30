/**
 * ApexCore ERP — External Validation Laboratory runner
 * Lives outside application source trees. Does not modify the codebase.
 *
 * Usage: node validation-lab/scripts/run-validation.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAB_ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(LAB_ROOT, 'evidence');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const FE_BASE = process.env.FE_BASE || 'http://localhost:5173';
const COMPANY = process.env.TEST_COMPANY_SLUG || 'owner';
const EMAIL = process.env.TEST_EMAIL || 'kimutaicosmas547@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'Kimutai@44!';

fs.mkdirSync(EVIDENCE, { recursive: true });

function writeJson(name, data) {
  const p = path.join(EVIDENCE, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function stats(samples) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Number(mean.toFixed(3)),
    median: pct(50),
    p95: pct(95),
    p99: pct(99),
    stddev: Number(Math.sqrt(variance).toFixed(3)),
  };
}

async function timedFetch(url, options = {}) {
  const start = performance.now();
  let res;
  let bodyText = '';
  let error = null;
  try {
    res = await fetch(url, options);
    bodyText = await res.text();
  } catch (e) {
    error = String(e?.message || e);
  }
  const ms = performance.now() - start;
  let json = null;
  try {
    json = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    json = null;
  }
  return {
    url,
    method: options.method || 'GET',
    status: res?.status ?? 0,
    ms: Number(ms.toFixed(3)),
    bytes: Buffer.byteLength(bodyText || ''),
    ok: Boolean(res?.ok),
    error,
    json,
    headers: res
      ? {
          'content-type': res.headers.get('content-type'),
          'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining'),
          'content-security-policy': res.headers.get('content-security-policy'),
          'x-content-type-options': res.headers.get('x-content-type-options'),
          'strict-transport-security': res.headers.get('strict-transport-security'),
          'x-frame-options': res.headers.get('x-frame-options'),
        }
      : null,
  };
}

async function login() {
  const r = await timedFetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companySlug: COMPANY, email: EMAIL, password: PASSWORD }),
  });
  const token = r.json?.data?.accessToken || null;
  const user = r.json?.data?.user || null;
  return { ...r, token, user };
}

async function phaseHealth() {
  const paths = ['/api/health', '/api/health/live', '/api/health/ready'];
  const results = [];
  for (const p of paths) {
    results.push(await timedFetch(`${BASE}${p}`));
  }
  return results;
}

async function phaseAuthSecurity() {
  const cases = [];
  cases.push({
    name: 'login_wrong_password',
    ...(await timedFetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companySlug: COMPANY, email: EMAIL, password: 'WrongPassword!!!' }),
    })),
  });
  cases.push({
    name: 'login_missing_fields',
    ...(await timedFetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })),
  });
  cases.push({
    name: 'protected_without_token',
    ...(await timedFetch(`${BASE}/api/v1/dashboard/stats`)),
  });
  cases.push({
    name: 'protected_with_garbage_token',
    ...(await timedFetch(`${BASE}/api/v1/dashboard/stats`, {
      headers: { Authorization: 'Bearer not.a.real.token' },
    })),
  });
  cases.push({
    name: 'sql_injection_login_email',
    ...(await timedFetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companySlug: COMPANY,
        email: "' OR '1'='1",
        password: 'x',
      }),
    })),
  });
  return cases;
}

const AUTH_GET_ENDPOINTS = [
  '/api/v1/dashboard/stats',
  '/api/v1/customers?limit=10',
  '/api/v1/products?limit=10',
  '/api/v1/users?limit=10',
  '/api/v1/inventory/stock?limit=10',
  '/api/v1/inventory/warehouses',
  '/api/v1/inventory/materials?limit=10',
  '/api/v1/operations/orders?limit=10',
  '/api/v1/operations/quotations?limit=10',
  '/api/v1/operations/sales-officers',
  '/api/v1/operations/work-orders?limit=10',
  '/api/v1/finance/invoices?limit=10',
  '/api/v1/finance/accounts',
  '/api/v1/finance/my-sales?limit=10',
  '/api/v1/delivery/notes?limit=10',
  '/api/v1/delivery/trips?limit=10',
  '/api/v1/delivery/vehicles',
  '/api/v1/quality/inspections?limit=10',
  '/api/v1/hr/employees?limit=10',
  '/api/v1/maintenance/machines',
  '/api/v1/maintenance/schedules?limit=10',
  '/api/v1/crm/opportunities?limit=10',
  '/api/v1/crm/complaints?limit=10',
  '/api/v1/search?q=a&limit=5',
  '/api/v1/tenant/company',
  '/api/v1/products/categories',
];

async function phaseApiMatrix(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const results = [];
  for (const ep of AUTH_GET_ENDPOINTS) {
    results.push({ endpoint: ep, ...(await timedFetch(`${BASE}${ep}`, { headers })) });
  }
  return results;
}

async function phaseConcurrency(token, concurrency = 25) {
  const headers = { Authorization: `Bearer ${token}` };
  const url = `${BASE}/api/v1/dashboard/stats`;
  const start = performance.now();
  const settled = await Promise.all(
    Array.from({ length: concurrency }, () => timedFetch(url, { headers }))
  );
  const wallMs = performance.now() - start;
  const latencies = settled.map((r) => r.ms);
  const failures = settled.filter((r) => r.status >= 500 || r.status === 0).length;
  const unauthorized = settled.filter((r) => r.status === 401 || r.status === 403).length;
  return {
    concurrency,
    wallMs: Number(wallMs.toFixed(3)),
    rps: Number(((concurrency / wallMs) * 1000).toFixed(3)),
    failures,
    unauthorized,
    latency: stats(latencies),
    statuses: settled.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function phaseLoadLadder(token) {
  const levels = [1, 10, 25, 50, 100, 250];
  const out = [];
  for (const n of levels) {
    // Warm a bit between levels
    await new Promise((r) => setTimeout(r, 250));
    const result = await phaseConcurrency(token, n);
    out.push(result);
    // Stop ladder if error rate > 10% or p95 > 5000ms
    const errRate = result.failures / n;
    if (errRate > 0.1 || (result.latency?.p95 ?? 0) > 5000) {
      out.push({ stoppedAt: n, reason: errRate > 0.1 ? 'error_rate' : 'p95_latency' });
      break;
    }
  }
  return out;
}

async function phaseStress(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const urls = [
    `${BASE}/api/health/live`,
    `${BASE}/api/v1/dashboard/stats`,
    `${BASE}/api/v1/customers?limit=50`,
    `${BASE}/api/v1/operations/orders?limit=50`,
    `${BASE}/api/v1/search?q=filter&limit=20`,
  ];
  const waves = [100, 250, 500];
  const results = [];
  for (const n of waves) {
    const start = performance.now();
    const settled = await Promise.all(
      Array.from({ length: n }, (_, i) => timedFetch(urls[i % urls.length], { headers }))
    );
    const wallMs = performance.now() - start;
    const latencies = settled.map((r) => r.ms);
    results.push({
      requests: n,
      wallMs: Number(wallMs.toFixed(3)),
      rps: Number(((n / wallMs) * 1000).toFixed(3)),
      failures: settled.filter((r) => r.status >= 500 || r.status === 0).length,
      rateLimited: settled.filter((r) => r.status === 429).length,
      latency: stats(latencies),
      statuses: settled.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  return results;
}

async function phaseEndurance(token, durationMs = 60_000, intervalMs = 1000) {
  const headers = { Authorization: `Bearer ${token}` };
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const r = await timedFetch(`${BASE}/api/v1/dashboard/stats`, { headers });
    samples.push({ t: Date.now() - started, status: r.status, ms: r.ms, bytes: r.bytes });
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  const latencies = samples.map((s) => s.ms);
  const firstHalf = latencies.slice(0, Math.floor(latencies.length / 2));
  const secondHalf = latencies.slice(Math.floor(latencies.length / 2));
  return {
    durationMs,
    samples: samples.length,
    failures: samples.filter((s) => s.status >= 500 || s.status === 0).length,
    latency: stats(latencies),
    firstHalfMean: firstHalf.length ? Number((firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length).toFixed(3)) : null,
    secondHalfMean: secondHalf.length
      ? Number((secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length).toFixed(3))
      : null,
    series: samples,
  };
}

async function phaseFrontend() {
  const pages = [
    '/',
    '/login',
    '/manifest.webmanifest',
  ];
  const results = [];
  for (const p of pages) {
    results.push({ path: p, ...(await timedFetch(`${FE_BASE}${p}`)) });
  }
  // Also probe common Vite asset patterns from login HTML
  const login = results.find((r) => r.path === '/login');
  return { pages: results, loginSnippet: login?.json ? null : undefined };
}

async function phaseValidationErrors(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const cases = [];
  cases.push({
    name: 'create_customer_empty',
    ...(await timedFetch(`${BASE}/api/v1/customers`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })),
  });
  cases.push({
    name: 'create_order_empty',
    ...(await timedFetch(`${BASE}/api/v1/operations/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })),
  });
  cases.push({
    name: 'search_empty_q',
    ...(await timedFetch(`${BASE}/api/v1/search`, { headers })),
  });
  return cases;
}

async function phaseDbViaApi(token) {
  const headers = { Authorization: `Bearer ${token}` };
  // Repeated list queries as proxy for DB read latency (no direct DB mutation)
  const rounds = 30;
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    const r = await timedFetch(`${BASE}/api/v1/customers?limit=50&page=1`, { headers });
    samples.push(r);
  }
  return {
    rounds,
    endpoint: '/api/v1/customers?limit=50&page=1',
    latency: stats(samples.map((s) => s.ms)),
    bytes: stats(samples.map((s) => s.bytes)),
    failures: samples.filter((s) => !s.ok).length,
    sampleStatus: samples[0]?.status,
    sampleCount: samples[0]?.json?.data?.length ?? samples[0]?.json?.pagination?.total ?? null,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const meta = {
    startedAt,
    apiBase: BASE,
    feBase: FE_BASE,
    company: COMPANY,
    email: EMAIL,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  writeJson('00-meta.json', meta);

  const health = await phaseHealth();
  writeJson('01-health.json', health);

  const authSecurity = await phaseAuthSecurity();
  writeJson('02-auth-security.json', authSecurity);

  const loginResult = await login();
  writeJson('03-login.json', {
    status: loginResult.status,
    ms: loginResult.ms,
    ok: Boolean(loginResult.token),
    user: loginResult.user
      ? {
          id: loginResult.user.id,
          email: loginResult.user.email,
          role: loginResult.user.role || loginResult.user.roleName,
          companyId: loginResult.user.companyId,
        }
      : null,
    message: loginResult.json?.message || null,
  });

  if (!loginResult.token) {
    writeJson('99-summary.json', {
      fatal: 'Login failed — remaining authenticated phases skipped',
      health,
      authSecurity,
    });
    console.error('LOGIN FAILED');
    process.exit(2);
  }

  const token = loginResult.token;
  const apiMatrix = await phaseApiMatrix(token);
  writeJson('04-api-matrix.json', apiMatrix);

  const validation = await phaseValidationErrors(token);
  writeJson('05-validation-errors.json', validation);

  const dbProxy = await phaseDbViaApi(token);
  writeJson('06-db-proxy-latency.json', dbProxy);

  const concurrency = await phaseConcurrency(token, 25);
  writeJson('07-concurrency-25.json', concurrency);

  const loadLadder = await phaseLoadLadder(token);
  writeJson('08-load-ladder.json', loadLadder);

  const stress = await phaseStress(token);
  writeJson('09-stress.json', stress);

  console.log('Running 60s endurance...');
  const endurance = await phaseEndurance(token, 60_000, 1000);
  writeJson('10-endurance-60s.json', {
    ...endurance,
    series: endurance.series, // keep full series for report appendix
  });

  const frontend = await phaseFrontend();
  writeJson('11-frontend.json', frontend);

  // Security headers from authenticated + health
  const secHeaders = {
    health: health.find((h) => h.url.endsWith('/api/health'))?.headers,
    dashboard: apiMatrix.find((a) => a.endpoint === '/api/v1/dashboard/stats')?.headers,
  };
  writeJson('12-security-headers.json', secHeaders);

  const passedApi = apiMatrix.filter((r) => r.status >= 200 && r.status < 400).length;
  const warnApi = apiMatrix.filter((r) => r.status >= 400 && r.status < 500).length;
  const failApi = apiMatrix.filter((r) => r.status >= 500 || r.status === 0).length;

  const summary = {
    finishedAt: new Date().toISOString(),
    loginOk: true,
    apiMatrix: { total: apiMatrix.length, passed: passedApi, clientErrors: warnApi, serverErrors: failApi },
    loadPeakRps: Math.max(...loadLadder.filter((x) => x.rps).map((x) => x.rps)),
    stressPeakRps: Math.max(...stress.map((x) => x.rps)),
    enduranceDriftMs:
      endurance.firstHalfMean != null && endurance.secondHalfMean != null
        ? Number((endurance.secondHalfMean - endurance.firstHalfMean).toFixed(3))
        : null,
    dbProxyP95: dbProxy.latency?.p95,
    dashboardP95At25: concurrency.latency?.p95,
  };
  writeJson('99-summary.json', summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
