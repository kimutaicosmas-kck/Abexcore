import type { PrismaClient } from '@prisma/client';

/** Generic defaults used only by legacy migration scripts — not seeded for new tenants. */
export const DEFAULT_PRODUCT_CATEGORY_NAMES = [
  'General',
  'Finished Goods',
  'Raw Materials',
  'Consumables',
  'Spare Parts',
  'Services',
  'Other',
];

/** Demo / filter-manufacturing sample data for the seeded demo company only. */
export const FILTER_DEMO_PRODUCT_CATEGORY_NAMES = [
  'Oil Filter',
  'Fuel Filter',
  'Air Filter',
  'Cabin Filter',
  'Hydraulic Filter',
  'Water Filter',
  'Industrial Filter',
  'Custom Filter',
];

export const LEGACY_PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  OIL_FILTER: 'Oil Filter',
  FUEL_FILTER: 'Fuel Filter',
  AIR_FILTER: 'Air Filter',
  CABIN_FILTER: 'Cabin Filter',
  HYDRAULIC_FILTER: 'Hydraulic Filter',
  WATER_FILTER: 'Water Filter',
  INDUSTRIAL_FILTER: 'Industrial Filter',
  CUSTOM_FILTER: 'Custom Filter',
};

type DbClient = Pick<PrismaClient, 'productCategory'>;

export async function seedProductCategoriesForCompany(
  db: DbClient,
  companyId: string,
  names: string[] = DEFAULT_PRODUCT_CATEGORY_NAMES
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;

    const category = await db.productCategory.upsert({
      where: { companyId_name: { companyId, name } },
      update: { sortOrder: i, isActive: true },
      create: { companyId, name, sortOrder: i },
      select: { id: true, name: true },
    });
    map.set(category.name, category.id);
  }

  return map;
}

export function legacyEnumToCategoryName(value: string): string {
  return LEGACY_PRODUCT_CATEGORY_LABELS[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
