/**
 * Migrates global raw material type enums to tenant-scoped material_types.
 *
 * Usage (from backend/):
 *   npx tsx scripts/migrate-material-types.ts
 *   npx prisma generate
 *   npx prisma db push --accept-data-loss
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_MATERIAL_TYPE_NAMES,
  legacyEnumToMaterialTypeName,
} from '../src/utils/materialTypes';

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

async function ensureMaterialTypesTable() {
  if (await tableExists('material_types')) {
    console.log('material_types table already exists');
    return;
  }

  await prisma.$executeRawUnsafe(`
    CREATE TABLE material_types (
      id CHAR(36) NOT NULL PRIMARY KEY,
      company_id CHAR(36) NOT NULL,
      name VARCHAR(191) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY material_types_company_id_name_key (company_id, name),
      KEY material_types_company_id_is_active_idx (company_id, is_active)
    )
  `);
  console.log('Created material_types table');
}

async function ensureTypeIdColumn() {
  if (await columnExists('raw_materials', 'type_id')) {
    console.log('raw_materials.type_id already exists');
    return;
  }

  await prisma.$executeRawUnsafe(`
    ALTER TABLE raw_materials ADD COLUMN type_id CHAR(36) NULL AFTER name
  `);
  console.log('Added raw_materials.type_id');
}

async function getOrCreateType(companyId: string, name: string, sortOrder: number): Promise<string> {
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM material_types WHERE company_id = ? AND name = ? LIMIT 1`,
    companyId,
    name
  );
  if (existing[0]?.id) return existing[0].id;

  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO material_types (id, company_id, name, sort_order, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, TRUE, NOW(3), NOW(3))`,
    id,
    companyId,
    name,
    sortOrder
  );
  return id;
}

async function migrateCompany(companyId: string, hasLegacyType: boolean) {
  const namesNeeded = new Set<string>(DEFAULT_MATERIAL_TYPE_NAMES);

  if (hasLegacyType) {
    const legacyRows = await prisma.$queryRawUnsafe<Array<{ type: string }>>(
      `SELECT DISTINCT type FROM raw_materials WHERE company_id = ? AND type IS NOT NULL`,
      companyId
    );
    for (const row of legacyRows) {
      namesNeeded.add(legacyEnumToMaterialTypeName(row.type));
    }
  }

  const typeMap = new Map<string, string>();
  let sortOrder = 0;
  for (const name of namesNeeded) {
    typeMap.set(name, await getOrCreateType(companyId, name, sortOrder++));
  }

  const fallbackId = typeMap.get('Raw Material') || typeMap.get('Other') || [...typeMap.values()][0];
  if (!fallbackId) {
    console.warn(`  No material types created for company ${companyId}`);
    return;
  }

  if (hasLegacyType) {
    const materials = await prisma.$queryRawUnsafe<Array<{ id: string; type: string | null }>>(
      `SELECT id, type FROM raw_materials WHERE company_id = ? AND (type_id IS NULL OR type_id = '')`,
      companyId
    );

    for (const material of materials) {
      const label = material.type ? legacyEnumToMaterialTypeName(material.type) : 'Raw Material';
      const typeId = typeMap.get(label) || fallbackId;
      await prisma.$executeRawUnsafe(`UPDATE raw_materials SET type_id = ? WHERE id = ?`, typeId, material.id);
    }
    console.log(`  Backfilled ${materials.length} material(s) from legacy enum`);
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE raw_materials SET type_id = ? WHERE company_id = ? AND (type_id IS NULL OR type_id = '')`,
      fallbackId,
      companyId
    );
    console.log(`  Assigned default material type to orphan materials`);
  }
}

async function main() {
  console.log('Migrating material types…');
  await ensureMaterialTypesTable();
  await ensureTypeIdColumn();

  const hasLegacyType = await columnExists('raw_materials', 'type');
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    console.log(`Company: ${company.name}`);
    await migrateCompany(company.id, hasLegacyType);
  }

  console.log('Done. Run `npx prisma generate` then `npx prisma db push --accept-data-loss`.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
