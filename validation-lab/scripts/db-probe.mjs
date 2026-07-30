/**
 * Read-only MySQL probe via Prisma client already installed in backend.
 * Does not mutate application source. Uses SELECT-only queries.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.resolve(__dirname, '../evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

const require = createRequire(path.join(ROOT, 'backend', 'package.json'));

// Load backend .env without printing secrets
try {
  require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });
} catch {
  /* optional */
}

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  return {
    count: samples.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Number(mean.toFixed(3)),
    median: pct(50),
    p95: pct(95),
    p99: pct(99),
  };
}

async function timed(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { ms: Number((performance.now() - t0).toFixed(3)), result };
}

async function main() {
  const out = { startedAt: new Date().toISOString(), queries: {} };

  const ping = await timed(() => prisma.$queryRaw`SELECT 1 AS ok`);
  out.queries.ping = { ms: ping.ms, result: ping.result };

  const version = await timed(() => prisma.$queryRaw`SELECT VERSION() AS version`);
  out.queries.version = { ms: version.ms, result: version.result };

  const tables = await timed(() =>
    prisma.$queryRaw`
      SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows, DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY (DATA_LENGTH + INDEX_LENGTH) DESC
      LIMIT 40
    `
  );
  out.queries.topTables = { ms: tables.ms, tables: tables.result };

  const counts = {};
  for (const model of [
    ['company', () => prisma.company.count()],
    ['user', () => prisma.user.count({ where: { deletedAt: null } })],
    ['customer', () => prisma.customer.count({ where: { deletedAt: null } })],
    ['product', () => prisma.product.count({ where: { deletedAt: null } })],
    ['salesOrder', () => prisma.salesOrder.count()],
    ['invoice', () => prisma.invoice.count()],
    ['deliveryNote', () => prisma.deliveryNote.count()],
  ]) {
    const r = await timed(model[1]);
    counts[model[0]] = { count: r.result, ms: r.ms };
  }
  out.counts = counts;

  const customerLatency = [];
  for (let i = 0; i < 25; i += 1) {
    const r = await timed(() =>
      prisma.customer.findMany({
        take: 50,
        where: { deletedAt: null },
        select: { id: true, code: true, name: true, salesPersonId: true },
      })
    );
    customerLatency.push(r.ms);
  }
  out.customerFindMany50 = stats(customerLatency);

  const orderLatency = [];
  for (let i = 0; i < 25; i += 1) {
    const r = await timed(() =>
      prisma.salesOrder.findMany({
        take: 50,
        include: {
          customer: { select: { name: true } },
          salesPerson: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      })
    );
    orderLatency.push(r.ms);
  }
  out.salesOrderFindMany50 = stats(orderLatency);

  // Index presence check (read-only)
  const indexes = await timed(() =>
    prisma.$queryRaw`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('companyId', 'salesPersonId', 'customerId', 'status')
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
      LIMIT 200
    `
  );
  out.relevantIndexes = { ms: indexes.ms, rows: indexes.result };

  out.finishedAt = new Date().toISOString();
  const jsonSafe = (value) =>
    JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
  fs.writeFileSync(path.join(EVIDENCE, '13-db-probe.json'), JSON.stringify(jsonSafe(out), null, 2));
  console.log(
    JSON.stringify(
      jsonSafe({
        version: out.queries.version.result,
        counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.count])),
        customerP95: out.customerFindMany50.p95,
        orderP95: out.salesOrderFindMany50.p95,
      }),
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
