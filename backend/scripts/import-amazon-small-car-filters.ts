/**
 * Import Amazon Filtration K Limited — Air Filters for Small Cars & Light Trucks.
 *
 * On Contabo:
 *   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec backend \
 *     npx tsx scripts/import-amazon-small-car-filters.ts
 *
 * Optional:
 *   COMPANY_SLUG=your-company-code  (default: first active non-owner company, else owner)
 */
import 'dotenv/config';
import prisma from '../src/config/database';
import { runWithoutTenant, runWithTenant } from '../src/utils/tenant';

type Row = {
  oem: string;
  application: string;
  wholesale: number;
  retail?: number;
};

/** From: AMAZON FILTRATION K LIMITED- SMALL CARS.docx — prices only; stock/credit later. */
const PRODUCTS: Row[] = [
  { oem: '17801-21030', application: 'TOYOTA BB, COROLLA, AXIO/FILDER, ECHO', wholesale: 115, retail: 170 },
  { oem: '17801-23030', application: 'TOYOTA AYGO, BB, PASSO, PLATZ, RACTIS', wholesale: 115, retail: 170 },
  { oem: '17801-22020', application: 'TOYOTA AVENSIS, CALDINA, COROLLA', wholesale: 115, retail: 170 },
  { oem: '17801-21050', application: 'TOYOTA AURIS/COROLLA, BELTA, COROLLA ALTIS, AXIO/FIELDER', wholesale: 130, retail: 180 },
  { oem: '17801-50060', application: 'TOYOTA CROWN/MAJESTA, LEXUS GS, LEXUS SC, SOARER', wholesale: 170, retail: 200 },
  { oem: '17801-70050', application: 'TOYOTA ALTEZZA/ALTEZA GITA, CHASER, CRESTA, CROWN COMFORT, CROWN/MAJESTA, LEXUS', wholesale: 170, retail: 200 },
  { oem: '17801-26020', application: 'ALTIS, VERSO, CAMRY, RAV 4', wholesale: 350, retail: 450 },
  { oem: '17801-26010', application: 'LEXUS II, RAV4 III 2015 MODELS', wholesale: 400, retail: 600 },
  { oem: '17801-20050', application: 'ALPHARD OLD, TOWNACE', wholesale: 250, retail: 350 },
  { oem: 'MR968274', application: 'MIT OUTLANDER, GALANT, PAJERO LANCE NEW', wholesale: 300, retail: 350 },
  { oem: '17801-20040', application: 'TOYOTA HARRIER', wholesale: 180, retail: 200 },
  { oem: '17801-31120', application: 'RAV 4 NEW ESTIMA, MARK X, ALPHARD NEW', wholesale: 200, retail: 250 },
  { oem: '17801-28010', application: 'TOYOTA CROWN', wholesale: 170, retail: 200 },
  { oem: '17801-B1010', application: 'WISH NEW MODEL', wholesale: 200, retail: 250 },
  { oem: 'ZJ01-13-Z40', application: 'MAZDA VERISA DEMIO, AXELLA', wholesale: 200, retail: 250 },
  { oem: '1-14215153-0', application: 'ISUZU NQR 4.3', wholesale: 900, retail: 1200 },
  { oem: '5-87610-290-0', application: 'ISUZU NRM, NLM NEW MODEL 4.3', wholesale: 900, retail: 1500 },
  { oem: '8-94156-052', application: 'ISUZU NRK 3.6', wholesale: 600, retail: 1200 },
  { oem: 'ME017242', application: 'CANTER 4D32', wholesale: 400, retail: 700 },
  { oem: '16546-AW002A', application: 'NISSAN HARDBODY NP 300', wholesale: 400, retail: 600 },
  { oem: '17801-OC010', application: 'TOYOTA VIGOP D4D', wholesale: 380, retail: 700 },
  { oem: '17801-61030', application: 'LAND CRUISER PICKUP', wholesale: 400, retail: 600 },
  { oem: 'AB39-9601', application: 'FORD RANGER', wholesale: 450, retail: 800 },
  { oem: '17801-B2050', application: 'DAIHATSU MIRA', wholesale: 220, retail: 300 },
  { oem: '13780-85K00', application: 'SUZUKI ALTO ECO', wholesale: 220, retail: 300 },
  { oem: '13780-50M00', application: 'SUZUKI', wholesale: 220, retail: 300 },
  { oem: '17801-78110', application: 'HINO 300', wholesale: 1100, retail: 1500 },
  { oem: '17801-17010/20', application: 'V8 OLD MODEL', wholesale: 750 },
  { oem: '16546-02N00', application: 'NISSAN E24', wholesale: 350 },
  { oem: '17801-54100', application: 'TRUCK 5L', wholesale: 350 },
  { oem: '1869993', application: 'SCANIA 124 (E1013L)', wholesale: 4500 },
  { oem: '885409052516', application: 'TATA TRUCK (2516)', wholesale: 2500 },
  { oem: '17801-3360/70', application: 'HINO 500', wholesale: 1800 },
  { oem: '1-14215203-0', application: 'ISUZU CXZ', wholesale: 3500 },
  { oem: '8-97941-655-0/8-97944-570-0', application: 'DMAX OLD MODEL', wholesale: 300 },
];

async function resolveCompany() {
  const slug = (process.env.COMPANY_SLUG || '').trim().toLowerCase();
  if (slug) {
    const company = await runWithoutTenant(() =>
      prisma.company.findFirst({ where: { slug, isActive: true } })
    );
    if (!company) throw new Error(`Company not found for COMPANY_SLUG=${slug}`);
    return company;
  }

  const companies = await runWithoutTenant(() =>
    prisma.company.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, slug: true, name: true },
    })
  );
  if (!companies.length) throw new Error('No active companies found');

  const amazon = companies.find((c) => /amazon|filtration/i.test(`${c.slug} ${c.name}`));
  if (amazon) return amazon;

  const nonOwner = companies.find((c) => c.slug !== 'owner');
  return nonOwner || companies[0];
}

async function main() {
  const company = await resolveCompany();
  console.log(`Importing ${PRODUCTS.length} air filters into ${company.slug} (${company.name})`);

  await runWithTenant({ companyId: company.id }, async () => {
    let category = await prisma.productCategory.findFirst({
      where: { name: 'Air Filters', isActive: true },
    });
    if (!category) {
      category = await prisma.productCategory.create({
        data: { name: 'Air Filters', sortOrder: 0, isActive: true },
      });
      console.log('Created category: Air Filters');
    }

    let created = 0;
    let updated = 0;

    for (const row of PRODUCTS) {
      const retail = row.retail ?? row.wholesale;
      const name = `Air Filter ${row.oem}`;
      const description = row.application;

      const existing = await prisma.product.findFirst({
        where: { sku: row.oem },
      });

      if (existing) {
        await prisma.product.update({
          where: { id: existing.id },
          data: {
            name,
            description,
            categoryId: category.id,
            distributorPrice: row.wholesale,
            sellingPrice: retail,
            retailPrice: retail,
            barcode: null,
            isActive: true,
          },
        });
        updated += 1;
        console.log(`  updated ${row.oem}`);
      } else {
        await prisma.product.create({
          data: {
            sku: row.oem,
            name,
            description,
            categoryId: category.id,
            distributorPrice: row.wholesale,
            sellingPrice: retail,
            retailPrice: retail,
            barcode: null,
            minStockLevel: 0,
            isActive: true,
          },
        });
        created += 1;
        console.log(`  created ${row.oem}`);
      }
    }

    console.log(`Done. created=${created} updated=${updated}`);
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
