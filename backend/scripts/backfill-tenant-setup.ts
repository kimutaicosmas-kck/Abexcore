/**
 * Backfill chart of accounts and departments for companies missing them.
 * Run: npx tsx scripts/backfill-tenant-setup.ts
 */
import prisma from '../src/config/database';
import { runWithoutTenant, runWithTenant } from '../src/utils/tenant';
import { seedTenantDefaults } from '../src/utils/tenantSetup';

async function main() {
  const companies = await runWithoutTenant(() =>
    prisma.company.findMany({ where: { isActive: true }, select: { id: true, name: true, slug: true } })
  );

  for (const company of companies) {
    await runWithoutTenant(() =>
      prisma.$transaction(async (tx) => {
        const accountCount = await tx.account.count({ where: { companyId: company.id } });
        const deptCount = await tx.department.count({ where: { companyId: company.id } });

        if (accountCount === 0 || deptCount < 8) {
          await seedTenantDefaults(tx, company.id);
          console.log(`Seeded defaults for ${company.slug} (${company.name})`);
        } else {
          console.log(`Skipped ${company.slug} — already configured`);
        }
      })
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
