import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROUTE_MOUNT: Record<string, string> = {
  'auth.routes.ts': '/auth',
  'dashboard.routes.ts': '/dashboard',
  'users.routes.ts': '/users',
  'customers.routes.ts': '/customers',
  'products.routes.ts': '/products',
  'inventory.routes.ts': '/inventory',
  'operations.routes.ts': '/operations',
  'finance.routes.ts': '/finance',
  'mpesa.routes.ts': '/finance/mpesa',
  'hr.routes.ts': '/hr',
  'delivery.routes.ts': '/delivery',
  'crm.routes.ts': '/crm',
  'quality.routes.ts': '/quality',
  'maintenance.routes.ts': '/maintenance',
  'search.routes.ts': '/search',
  'realtime.routes.ts': '/realtime',
  'tenant.routes.ts': '/tenant',
};

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

function collectRuntimePaths(): Set<string> {
  const routesDir = path.join(__dirname, '../src/routes');
  const paths = new Set<string>(['/health', '/health/live', '/health/ready']);

  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.routes.ts'))) {
    const base = ROUTE_MOUNT[file];
    if (!base) continue;
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    let match: RegExpExecArray | null;
    ROUTE_RE.lastIndex = 0;
    while ((match = ROUTE_RE.exec(content)) !== null) {
      const routePath = match[2];
      const fullPath = `${base}${routePath.startsWith('/') ? routePath : `/${routePath}`}`.replace(
        /\/+/g,
        '/'
      );
      paths.add(fullPath.replace(/:([a-zA-Z]+)/g, '{$1}'));
    }
  }
  return paths;
}

function collectOpenApiPaths(): Set<string> {
  const yaml = fs.readFileSync(path.join(__dirname, '../src/openapi/paths.yaml'), 'utf8');
  const paths = new Set<string>();
  for (const line of yaml.split(/\r?\n/)) {
    const m = line.match(/^ {2}(\/[^\s:]+):$/);
    if (m) paths.add(m[1]);
  }
  return paths;
}

describe('OpenAPI ↔ Express contract (CF-03)', () => {
  it('paths.yaml matches routes discovered from Express routers', () => {
    const runtime = collectRuntimePaths();
    const documented = collectOpenApiPaths();

    const missingFromOpenApi = [...runtime].filter((p) => !documented.has(p)).sort();
    const extraInOpenApi = [...documented].filter((p) => !runtime.has(p)).sort();

    expect(missingFromOpenApi, `Missing from OpenAPI: ${missingFromOpenApi.join(', ')}`).toEqual([]);
    expect(extraInOpenApi, `Extra in OpenAPI: ${extraInOpenApi.join(', ')}`).toEqual([]);
  });

  it('documents compatibility aliases from the validation report (CF-03)', () => {
    const documented = collectOpenApiPaths();
    const aliases = [
      '/dashboard/stats',
      '/inventory/stock',
      '/operations/work-orders',
      '/delivery/notes',
      '/quality/inspections',
      '/maintenance/schedules',
      '/tenant/company',
      '/products/categories',
    ];
    for (const p of aliases) {
      expect(documented.has(p), `${p} should be documented`).toBe(true);
    }
  });
});
