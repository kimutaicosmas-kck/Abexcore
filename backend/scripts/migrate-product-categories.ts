/**
 * Migrates global product category enums to tenant-scoped product_categories.
 *
 * Usage (from backend/):
 *   npx tsx scripts/migrate-product-categories.ts
 *   npx prisma generate
 *   npx prisma db push
 *
 * Safe to re-run.
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_PRODUCT_CATEGORY_NAMES,
  legacyEnumToCategoryName,
} from '../src/utils/productCategories';

const prisma = new PrismaClient();

async function tableExists(table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    table
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table,
    column
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function ensureProductCategoriesTable() {
  if (await tableExists('product_categories')) {
    console.log('product_categories table already exists');
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE product_categories (
      id CHAR(36) NOT NULL PRIMARY KEY,
      company_id CHAR(36) NOT NULL,
      name VARCHAR(191) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY product_categories_company_id_name_key (company_id, name),
      KEY product_categories_company_id_is_active_idx (company_id, is_active)
    )
  `);
  console.log('Created product_categories table');
}

async function ensureCategoryIdColumn() {
  if (await columnExists('products', 'category_id')) {
    console.log('products.category_id already exists');
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE products ADD COLUMN category_id CHAR(36) NULL AFTER name
  `);
  console.log('Added products.category_id');
}

async function getOrCreateCategory(companyId: string, name: string, sortOrder: number): Promise<string> {
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM product_categories WHERE company_id = ? AND name = ? LIMIT 1`,
    companyId,
    name
  );
  if (existing[0]?.id) return existing[0].id;

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO product_categories (id, company_id, name, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, TRUE, NOW(3), NOW(3))`,
    id,
    companyId,
    name,
    sortOrder
  );
  return id;
}

async function migrateCompany(companyId: string, hasLegacyCategory: boolean) {
  const namesNeeded = new Set<string>(DEFAULT_PRODUCT_CATEGORY_NAMES);

  if (hasLegacyCategory) {
    const legacyRows = await prisma.$queryRawUnsafe<Array<{ category: string }>>(
      `SELECT DISTINCT category FROM products WHERE company_id = ? AND category IS NOT NULL`,
      companyId
    );
    for (const row of legacyRows) {
      namesNeeded.add(legacyEnumToCategoryName(row.category));
    }
  }

  const categoryMap = new Map<string, string>();
  let sortOrder = 0;
  for (const name of namesNeeded) {
    categoryMap.set(name, await getOrCreateCategory(companyId, name, sortOrder++));
  }

  const fallbackId = categoryMap.get('General') || [...categoryMap.values()][0];
  if (!fallbackId) {
    console.warn(`  No categories created for company ${companyId}`);
    return;
  }

  if (hasLegacyCategory) {
    const products = await prisma.$queryRawUnsafe<Array<{ id: string; category: string | null }>>(
      `SELECT id, category FROM products WHERE company_id = ? AND (category_id IS NULL OR category_id = '')`,
      companyId
    );

    for (const product of products) {
      const label = product.category ? legacyEnumToCategoryName(product.category) : 'General';
      const categoryId = categoryMap.get(label) || fallbackId;
      await prisma.$executeRawUnsafe(`UPDATE products SET category_id = ? WHERE id = ?`, categoryId, product.id);
    }
    console.log(`  Backfilled ${products.length} product(s) from legacy enum`);
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE products SET category_id = ? WHERE company_id = ? AND (category_id IS NULL OR category_id = '')`,
      fallbackId,
      companyId
    );
    console.log(`  Assigned default category to orphan products`);
  }
}

async function main() {
  console.log('Migrating product categories…');
  await ensureProductCategoriesTable();
  await ensureCategoryIdColumn();

  const hasLegacyCategory = await columnExists('products', 'category');
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    console.log(`Company: ${company.name}`);
    await migrateCompany(company.id, hasLegacyCategory);
  }

  console.log('Done. Run `npx prisma generate` then `npx prisma db push` to finalize schema.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
