/**
 * Removes auto-seeded default product categories and material types
 * when they are not referenced by any products or raw materials.
 *
 * Usage (from backend/):
 *   npx tsx scripts/cleanup-default-catalog.ts
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_PRODUCT_CATEGORY_NAMES } from '../src/utils/productCategories';
import { DEFAULT_MATERIAL_TYPE_NAMES } from '../src/utils/materialTypes';

const prisma = new PrismaClient();

async function cleanupCompany(companyId: string, companyName: string) {
  let removedCategories = 0;
  let removedTypes = 0;
  let skippedCategories = 0;
  let skippedTypes = 0;

  for (const name of DEFAULT_PRODUCT_CATEGORY_NAMES) {
    const category = await prisma.productCategory.findFirst({
      where: { companyId, name },
      select: { id: true, _count: { select: { products: true } } },
    });
    if (!category) continue;
    if (category._count.products > 0) {
      skippedCategories++;
      continue;
    }
    await prisma.productCategory.delete({ where: { id: category.id } });
    removedCategories++;
  }

  for (const name of DEFAULT_MATERIAL_TYPE_NAMES) {
    const materialType = await prisma.materialType.findFirst({
      where: { companyId, name },
      select: { id: true, _count: { select: { materials: true } } },
    });
    if (!materialType) continue;
    if (materialType._count.materials > 0) {
      skippedTypes++;
      continue;
    }
    await prisma.materialType.delete({ where: { id: materialType.id } });
    removedTypes++;
  }

  console.log(
    `${companyName}: removed ${removedCategories} categor${removedCategories === 1 ? 'y' : 'ies'}, ${removedTypes} material type(s)` +
      (skippedCategories || skippedTypes
        ? ` (kept ${skippedCategories} categor${skippedCategories === 1 ? 'y' : 'ies'} and ${skippedTypes} type(s) still in use)`
        : '')
  );
}

async function main() {
  console.log('Removing unused default catalog entries…');
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });

  for (const company of companies) {
    await cleanupCompany(company.id, company.name);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
