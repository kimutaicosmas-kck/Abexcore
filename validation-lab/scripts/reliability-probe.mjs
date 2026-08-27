/**
 * Reliability probes (non-destructive): dependency loss simulation via bad DB URL is NOT done.
 * Instead: sequential restart-window check (health continuity), auth session validity,
 * and post-stress health recovery.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE = path.resolve(__dirname, '../evidence');
const BASE = process.env.API_BASE || 'http://localhost:3001';
const COMPANY = process.env.TEST_COMPANY_SLUG || 'owner';
const EMAIL = process.env.TEST_EMAIL || 'kimutaicosmas547@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || 'CiOnly-ChangeMe-NotForProd!';

async function hit(url, options) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    return { status: res.status, ms: Number((performance.now() - t0).toFixed(3)), bytes: text.length };
  } catch (e) {
    return { status: 0, ms: Number((performance.now() - t0).toFixed(3)), error: String(e.message || e) };
  }
}

async function main() {
  const out = { startedAt: new Date().toISOString(), probes: {} };

  // Continuity: 20 health checks over ~10s
  const continuity = [];
  for (let i = 0; i < 20; i += 1) {
    continuity.push(await hit(`${BASE}/api/health/ready`));
    await new Promise((r) => setTimeout(r, 500));
  }
  out.probes.healthContinuity = {
    samples: continuity.length,
    failures: continuity.filter((c) => c.status !== 200).length,
    latencyMs: continuity.map((c) => c.ms),
  };

  // Login + reuse token after delay
  const loginRes = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companySlug: COMPANY, email: EMAIL, password: PASSWORD }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson?.data?.accessToken;
  out.probes.login = { status: loginRes.status, hasToken: Boolean(token) };
  await new Promise((r) => setTimeout(r, 2000));
  out.probes.tokenAfter2s = await hit(`${BASE}/api/v1/customers?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // Burst then recovery
  await Promise.all(
    Array.from({ length: 100 }, () =>
      hit(`${BASE}/api/v1/customers?limit=5`, { headers: { Authorization: `Bearer ${token}` } })
    )
  );
  const recovery = [];
  for (let i = 0; i < 10; i += 1) {
    recovery.push(await hit(`${BASE}/api/health/ready`));
    await new Promise((r) => setTimeout(r, 200));
  }
  out.probes.postBurstRecovery = {
    failures: recovery.filter((r) => r.status !== 200).length,
    meanMs: Number((recovery.reduce((a, b) => a + b.ms, 0) / recovery.length).toFixed(3)),
  };

  // Upload path unauthenticated probe (known risk from audit)
  out.probes.publicUploads = await hit(`${BASE}/uploads/`);

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(EVIDENCE, '16-reliability.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
