/**
 * Applies multi-tenant schema changes to an existing single-tenant database.
 * Adds nullable columns, backfills data, then enforces NOT NULL constraints.
 *
 * Usage (from backend/): npx tsx scripts/migrate-multitenant.ts
 * Then: npx prisma db push
 */
import { PrismaClient } from '@prisma/client';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

const prisma = new PrismaClient();

const TABLES = [
  'branches',
  'tax_rates',
  'users',
  'departments',
  'customers',
  'suppliers',
  'products',
  'raw_materials',
  'warehouses',
  'purchase_requisitions',
  'request_for_quotations',
  'purchase_orders',
  'goods_receipts',
  'machines',
  'production_orders',
  'sales_quotations',
  'sales_orders',
  'sales_targets',
  'vehicles',
  'delivery_trips',
  'invoices',
  'payments',
  'employees',
  'accounts',
  'journal_entries',
  'bank_statements',
  'mpesa_transactions',
  'audit_logs',
  'notifications',
  'email_configs',
];

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    table,
    column
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    table
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function addColumnIfMissing(table: string, column: string, definition: string) {
  if (!(await tableExists(table))) {
    console.log(`  Skipping ${table} (table missing)`);
    return;
  }
  if (await columnExists(table, column)) {
    console.log(`  ${table}.${column} already exists`);
    return;
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`  Added ${table}.${column}`);
}

async function ensureCompanyColumns() {
  console.log('Updating companies table…');
  await addColumnIfMissing('companies', 'slug', 'VARCHAR(191) NULL');
  await addColumnIfMissing('companies', 'is_active', 'BOOLEAN NOT NULL DEFAULT TRUE');

  await prisma.$executeRawUnsafe(
    `UPDATE companies SET slug = 'demo', is_active = TRUE WHERE slug IS NULL OR slug = ''`
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE companies MODIFY COLUMN slug VARCHAR(191) NOT NULL`
  );

  try {
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX companies_slug_key ON companies (slug)`
    );
    console.log('  Added unique index on companies.slug');
  } catch {
    console.log('  Unique index on companies.slug already exists');
  }
}

async function resolveCompanyId(): Promise<string> {
  const companies = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT id FROM companies ORDER BY created_at ASC LIMIT 1'
  );
  return companies[0]?.id ?? DEFAULT_COMPANY_ID;
}

async function isColumnNullable(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ IS_NULLABLE: string }>>(
    `SELECT IS_NULLABLE
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    table,
    column
  );
  return rows[0]?.IS_NULLABLE === 'YES';
}

async function ensureCompanyIdColumns(companyId: string) {
  console.log('Adding company_id columns…');
  for (const table of TABLES) {
    if (!(await tableExists(table))) {
      console.log(`  Skipping ${table} (table missing)`);
      continue;
    }
    await addColumnIfMissing(table, 'company_id', 'VARCHAR(36) NULL');
    await prisma.$executeRawUnsafe(
      `UPDATE \`${table}\` SET company_id = ? WHERE company_id IS NULL OR company_id = ''`,
      companyId
    );
    if (await isColumnNullable(table, 'company_id')) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE \`${table}\` MODIFY COLUMN company_id VARCHAR(36) NOT NULL`
      );
    }
    console.log(`  Backfilled ${table}`);
  }
}

async function upsertDefaultCompany() {
  await prisma.company.upsert({
    where: { id: DEFAULT_COMPANY_ID },
    update: { slug: 'demo', isActive: true },
    create: {
      id: DEFAULT_COMPANY_ID,
      slug: 'demo',
      name: 'Kenya Filter Industries Ltd',
      legalName: 'Kenya Filter Industries Limited',
      isActive: true,
      country: 'Kenya',
      currency: 'KES',
    },
  });
}

async function main() {
  console.log('Starting multi-tenant schema migration…');
  await ensureCompanyColumns();
  const companyId = await resolveCompanyId();
  console.log(`Using company id: ${companyId}`);
  await ensureCompanyIdColumns(companyId);
  await upsertDefaultCompany();
  console.log('Multi-tenant backfill complete.');
  console.log('Next: run `npx prisma db push` to apply remaining indexes and foreign keys.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
