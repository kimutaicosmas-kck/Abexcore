import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const fks = await prisma.$queryRawUnsafe<
    Array<{ CONSTRAINT_NAME: string; TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string }>
  >(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND REFERENCED_TABLE_NAME IS NOT NULL
       AND TABLE_NAME IN ('products', 'raw_materials')
     ORDER BY TABLE_NAME, CONSTRAINT_NAME`
  );
  console.log('Foreign keys:');
  console.table(fks);

  const indexes = await prisma.$queryRawUnsafe<Array<{ TABLE_NAME: string; INDEX_NAME: string; COLUMN_NAME: string }>>(
    `SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('products', 'raw_materials', 'product_categories', 'material_types')
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
  );
  console.log('Indexes:');
  console.table(indexes);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
