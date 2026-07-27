import type { PrismaClient } from '@prisma/client';

/** Generic defaults used only by legacy migration scripts — not seeded for new tenants. */
export const DEFAULT_MATERIAL_TYPE_NAMES = [
  'Raw Material',
  'Component',
  'Packaging',
  'Consumable',
  'Chemical',
  'Metal',
  'Plastic',
  'Fabric',
  'Hardware',
  'Other',
];

/** Demo / filter-manufacturing sample data for the seeded platform company only. */
export const FILTER_DEMO_MATERIAL_TYPE_NAMES = [
  'Steel',
  'Filter Paper',
  'Rubber',
  'Mesh',
  'Adhesive',
  'Plastic',
  'End Cap',
  'Thread Plate',
  'Packaging Box',
  'Label',
  'Other',
];

export const LEGACY_MATERIAL_TYPE_LABELS: Record<string, string> = {
  STEEL: 'Steel',
  FILTER_PAPER: 'Filter Paper',
  RUBBER: 'Rubber',
  MESH: 'Mesh',
  ADHESIVE: 'Adhesive',
  PLASTIC: 'Plastic',
  END_CAP: 'End Cap',
  THREAD_PLATE: 'Thread Plate',
  PACKAGING_BOX: 'Packaging Box',
  LABEL: 'Label',
  OTHER: 'Other',
};

type DbClient = Pick<PrismaClient, 'materialType'>;

export async function seedMaterialTypesForCompany(
  db: DbClient,
  companyId: string,
  names: string[] = DEFAULT_MATERIAL_TYPE_NAMES
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;

    const materialType = await db.materialType.upsert({
      where: { companyId_name: { companyId, name } },
      update: { sortOrder: i, isActive: true },
      create: { companyId, name, sortOrder: i },
      select: { id: true, name: true },
    });
    map.set(materialType.name, materialType.id);
  }

  return map;
}

export function legacyEnumToMaterialTypeName(value: string): string {
  return LEGACY_MATERIAL_TYPE_LABELS[value] || value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
