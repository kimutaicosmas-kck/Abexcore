/**
 * Load demo data for the platform owner workspace only.
 * Run: npm run db:seed:demo
 */
import { PrismaClient } from '@prisma/client';
import { seedDemoDataForCompany } from '../src/services/demoDataSeed.service';
import { PLATFORM_OWNER_SLUG } from '../src/config/platformOwner';

const prisma = new PrismaClient();

async function main() {
  const requested = process.argv[2]?.trim().toLowerCase();
  if (requested && requested !== PLATFORM_OWNER_SLUG.toLowerCase()) {
    throw new Error(
      `Demo data can only be seeded for "${PLATFORM_OWNER_SLUG}". Other tenants must remain empty.`
    );
  }

  console.log(`Seeding demo data (min 10 per module) for platform owner "${PLATFORM_OWNER_SLUG}"…`);

  const summary = await seedDemoDataForCompany(prisma, PLATFORM_OWNER_SLUG);

  console.log('\nDemo data summary:');
  for (const [module, stats] of Object.entries(summary).sort(([a], [b]) => a.localeCompare(b))) {
    if (stats.added > 0) {
      console.log(`  + ${module}: ${stats.before} → ${stats.after} (+${stats.added})`);
    } else {
      console.log(`  ✓ ${module}: ${stats.after} (already sufficient)`);
    }
  }

  console.log('\nDemo team users password (if created): Demo@12345!');
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
