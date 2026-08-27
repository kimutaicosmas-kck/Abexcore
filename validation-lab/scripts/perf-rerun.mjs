/**
 * Re-run load/stress/endurance against verified 200 OK endpoints.
 * Corrects Phase 9–11 evidence after discovering /dashboard/stats is 404.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.resolve(__dirname, '../evidence');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const COMPANY = process.env.TEST_COMPANY_SLUG || 'owner';
const EMAIL = process.env.TEST_EMAIL || 'kimutaicosmas547@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'CiOnly-ChangeMe-NotForProd!';

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: samples.length,
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
  return {
    status: res?.status ?? 0,
    ms: Number((performance.now() - start).toFixed(3)),
    bytes: Buffer.byteLength(bodyText || ''),
    error,
  };
}

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companySlug: COMPANY, email: EMAIL, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json?.data?.accessToken) throw new Error(`login failed ${res.status}`);
  return json.data.accessToken;
}

async function burst(token, url, n) {
  const headers = { Authorization: `Bearer ${token}` };
  const start = performance.now();
  const settled = await Promise.all(Array.from({ length: n }, () => timedFetch(url, { headers })));
  const wallMs = performance.now() - start;
  return {
    url,
    concurrency: n,
    wallMs: Number(wallMs.toFixed(3)),
    rps: Number(((n / wallMs) * 1000).toFixed(3)),
    failures: settled.filter((r) => r.status >= 500 || r.status === 0).length,
    non200: settled.filter((r) => r.status !== 200).length,
    latency: stats(settled.map((r) => r.ms)),
    statuses: settled.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  const token = await login();
  const primary = `${BASE}/api/v1/customers?limit=10`;
  const mix = [
    `${BASE}/api/health/live`,
    `${BASE}/api/v1/dashboard/kpis`,
    `${BASE}/api/v1/customers?limit=10`,
    `${BASE}/api/v1/operations/orders?limit=10`,
    `${BASE}/api/v1/finance/invoices?limit=10`,
  ];

  // Corrected API matrix for previously wrong paths
  const corrected = [];
  for (const ep of [
    '/api/v1/dashboard/kpis',
    '/api/v1/dashboard/charts',
    '/api/v1/delivery',
    '/api/v1/quality',
    '/api/v1/tenant/me',
    '/api/v1/tenant/settings',
    '/api/v1/products/catalog/categories',
    '/api/v1/inventory/stock-levels?limit=10',
    '/api/v1/operations/productions?limit=10',
  ]) {
    corrected.push({ endpoint: ep, ...(await timedFetch(`${BASE}${ep}`, { headers: { Authorization: `Bearer ${token}` } })) });
  }
  fs.writeFileSync(path.join(EVIDENCE, '04b-api-path-corrections.json'), JSON.stringify(corrected, null, 2));

  const ladder = [];
  for (const n of [1, 10, 25, 50, 100, 250]) {
    await new Promise((r) => setTimeout(r, 300));
    ladder.push(await burst(token, primary, n));
  }
  fs.writeFileSync(path.join(EVIDENCE, '08b-load-ladder-customers.json'), JSON.stringify(ladder, null, 2));

  const stress = [];
  for (const n of [100, 250, 500]) {
    const headers = { Authorization: `Bearer ${token}` };
    const start = performance.now();
    const settled = await Promise.all(
      Array.from({ length: n }, (_, i) => timedFetch(mix[i % mix.length], { headers }))
    );
    const wallMs = performance.now() - start;
    stress.push({
      requests: n,
      wallMs: Number(wallMs.toFixed(3)),
      rps: Number(((n / wallMs) * 1000).toFixed(3)),
      failures: settled.filter((r) => r.status >= 500 || r.status === 0).length,
      non200: settled.filter((r) => r.status !== 200).length,
      latency: stats(settled.map((r) => r.ms)),
      statuses: settled.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {}),
    });
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.writeFileSync(path.join(EVIDENCE, '09b-stress-mixed.json'), JSON.stringify(stress, null, 2));

  console.log('Endurance 60s on /customers?limit=10 ...');
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    const r = await timedFetch(primary, { headers: { Authorization: `Bearer ${token}` } });
    samples.push({ t: Date.now() - started, ...r });
    await new Promise((res) => setTimeout(res, 1000));
  }
  const latencies = samples.map((s) => s.ms);
  const mid = Math.floor(latencies.length / 2);
  const endurance = {
    durationMs: 60000,
    samples: samples.length,
    failures: samples.filter((s) => s.status >= 500 || s.status === 0).length,
    non200: samples.filter((s) => s.status !== 200).length,
    latency: stats(latencies),
    firstHalfMean: Number((latencies.slice(0, mid).reduce((a, b) => a + b, 0) / mid).toFixed(3)),
    secondHalfMean: Number(
      (latencies.slice(mid).reduce((a, b) => a + b, 0) / (latencies.length - mid)).toFixed(3)
    ),
    series: samples,
  };
  fs.writeFileSync(path.join(EVIDENCE, '10b-endurance-customers-60s.json'), JSON.stringify(endurance, null, 2));

  // Health sequential load (self-contained; no repo script dependency)
  const healthSamples = [];
  for (let i = 0; i < 100; i += 1) {
    healthSamples.push(await timedFetch(`${BASE}/api/health/live`));
    healthSamples.push(await timedFetch(`${BASE}/api/health/ready`));
  }
  const healthOut = {
    requests: healthSamples.length,
    failures: healthSamples.filter((r) => r.status >= 500 || r.status === 0).length,
    latency: stats(healthSamples.map((r) => r.ms)),
    statuses: healthSamples.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
  };
  fs.writeFileSync(path.join(EVIDENCE, '14-health-load-200.json'), JSON.stringify(healthOut, null, 2));

  // Resource snapshot via process (Node side only)
  const mem = process.memoryUsage();
  fs.writeFileSync(
    path.join(EVIDENCE, '15-lab-process-memory.json'),
    JSON.stringify({ rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external }, null, 2)
  );

  const summary = {
    ladderPeakRps: Math.max(...ladder.map((x) => x.rps)),
    ladderP95At250: ladder.find((x) => x.concurrency === 250)?.latency?.p95,
    stressPeakRps: Math.max(...stress.map((x) => x.rps)),
    stressFailuresAt500: stress.find((x) => x.requests === 500)?.failures,
    enduranceDriftMs: Number((endurance.secondHalfMean - endurance.firstHalfMean).toFixed(3)),
    healthP95: healthOut.latency.p95,
    pathCorrections: corrected,
  };
  fs.writeFileSync(path.join(EVIDENCE, '99b-perf-corrected-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
