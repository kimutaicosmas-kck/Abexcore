import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      TABLE_NAME: string;
      COLUMN_NAME: string;
      COLUMN_TYPE: string;
      IS_NULLABLE: string;
      CHARACTER_SET_NAME: string | null;
      COLLATION_NAME: string | null;
    }>
  >(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND (
         (TABLE_NAME = 'products' AND COLUMN_NAME IN ('id', 'category_id', 'category'))
         OR (TABLE_NAME = 'product_categories' AND COLUMN_NAME = 'id')
         OR (TABLE_NAME = 'raw_materials' AND COLUMN_NAME IN ('id', 'type_id', 'type'))
         OR (TABLE_NAME = 'material_types' AND COLUMN_NAME = 'id')
       )
     ORDER BY TABLE_NAME, COLUMN_NAME`
  );
  console.table(rows);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
