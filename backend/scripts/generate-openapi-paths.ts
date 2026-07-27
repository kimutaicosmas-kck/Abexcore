/**
 * Scan Express route files and emit OpenAPI path stubs for Swagger UI.
 * Run: npx tsx scripts/generate-openapi-paths.ts
 */
import fs from 'fs';
import path from 'path';

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

const TAG_FROM_FILE: Record<string, string> = {
  'auth.routes.ts': 'Auth',
  'dashboard.routes.ts': 'Dashboard',
  'users.routes.ts': 'Users',
  'customers.routes.ts': 'Customers',
  'products.routes.ts': 'Products',
  'inventory.routes.ts': 'Inventory',
  'operations.routes.ts': 'Operations',
  'finance.routes.ts': 'Finance',
  'mpesa.routes.ts': 'M-Pesa',
  'hr.routes.ts': 'HR',
  'delivery.routes.ts': 'Delivery',
  'crm.routes.ts': 'CRM',
  'quality.routes.ts': 'Quality',
  'maintenance.routes.ts': 'Maintenance',
  'search.routes.ts': 'Search',
  'realtime.routes.ts': 'Realtime',
  'tenant.routes.ts': 'Tenant',
};

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;

function yamlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

function methodBlock(method: string, tag: string, summary: string, secured: boolean): string {
  const security = secured ? '\n      security:\n        - bearerAuth: []' : '';
  return `    ${method}:
      tags: [${tag}]
      summary: ${summary}${security}
      responses:
        '200':
          description: Success
        '400':
          description: Validation error
        '401':
          description: Unauthorized
        '403':
          description: Forbidden`;
}

function main() {
  const routesDir = path.join(__dirname, '../src/routes');
  const paths: Record<string, Record<string, string>> = {};

  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.routes.ts'))) {
    const base = ROUTE_MOUNT[file];
    if (!base) continue;
    const tag = TAG_FROM_FILE[file] || file.replace('.routes.ts', '');
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    const secured = file !== 'auth.routes.ts' || content.includes('router.use(authenticate)');

    let match: RegExpExecArray | null;
    ROUTE_RE.lastIndex = 0;
    while ((match = ROUTE_RE.exec(content)) !== null) {
      const httpMethod = match[1].toLowerCase();
      const routePath = match[2];
      const fullPath = `${base}${routePath.startsWith('/') ? routePath : `/${routePath}`}`.replace(/\/+/g, '/');
      const openapiPath = fullPath.replace(/:([a-zA-Z]+)/g, '{$1}');
      if (!paths[openapiPath]) paths[openapiPath] = {};
      if (paths[openapiPath][httpMethod]) continue;
      const isPublicAuth =
        file === 'auth.routes.ts' &&
        (routePath.includes('login') || routePath.includes('refresh') || routePath.includes('resolve-tenant'));
      paths[openapiPath][httpMethod] = methodBlock(
        httpMethod,
        tag,
        `${httpMethod.toUpperCase()} ${openapiPath}`,
        secured && !isPublicAuth
      );
    }
  }

  // Health endpoints (defined in app.ts)
  paths['/health/live'] = {
    get: methodBlock('get', 'Health', 'Liveness probe', false),
  };
  paths['/health/ready'] = {
    get: methodBlock('get', 'Health', 'Readiness probe', false),
  };
  paths['/health'] = {
    get: methodBlock('get', 'Health', 'Combined health check', false),
  };

  const lines = ['paths:'];
  for (const routePath of Object.keys(paths).sort()) {
    lines.push(`  ${routePath}:`);
    for (const block of Object.values(paths[routePath])) {
      lines.push(block);
    }
  }

  const outPath = path.join(__dirname, '../src/openapi/paths.yaml');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Generated ${Object.keys(paths).length} OpenAPI paths -> ${outPath}`);
}

main();
