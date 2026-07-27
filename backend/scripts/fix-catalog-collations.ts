/**
 * Aligns catalog table collations so Prisma can add foreign keys.
 * Fixes: product_categories/material_types (utf8mb4_0900_ai_ci) vs
 *        products/raw_materials FK columns (utf8mb4_unicode_ci)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_COLLATION = 'utf8mb4_unicode_ci';

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    table,
    column
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

async function alignColumn(table: string, column: string) {
  if (!(await columnExists(table, column))) {
    console.log(`Skip ${table}.${column} (missing)`);
    return;
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`${table}\` MODIFY \`${column}\` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE ${TARGET_COLLATION} NOT NULL`
  );
  console.log(`Aligned ${table}.${column} -> ${TARGET_COLLATION}`);
}

async function main() {
  console.log('Aligning catalog column collations…');
  await alignColumn('product_categories', 'id');
  await alignColumn('product_categories', 'company_id');
  await alignColumn('material_types', 'id');
  await alignColumn('material_types', 'company_id');
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
