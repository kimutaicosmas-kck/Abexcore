/**
 * Lightweight load test for APEXCORE ERP API health and auth endpoints.
 * Run: node scripts/load-test/health-load.mjs http://localhost:3001 50
 */
const baseUrl = process.argv[2] || 'http://localhost:3001';
const requests = Number(process.argv[3] || 50);

async function hit(path) {
  const start = performance.now();
  const res = await fetch(`${baseUrl}${path}`);
  const ms = performance.now() - start;
  return { path, status: res.status, ms };
}

async function main() {
  const paths = ['/api/health/live', '/api/health/ready'];
  const results = [];
  for (let i = 0; i < requests; i += 1) {
    for (const path of paths) {
      results.push(await hit(path));
    }
  }
  const avg = results.reduce((s, r) => s + r.ms, 0) / results.length;
  const failed = results.filter((r) => r.status >= 500).length;
  console.log(`Requests: ${results.length}, avg: ${avg.toFixed(1)}ms, failures: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
