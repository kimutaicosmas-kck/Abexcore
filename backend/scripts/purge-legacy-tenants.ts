/**
 * Remove legacy demo tenants (e.g. amazon, filter) — keeps platform owner only.
 * Run: npm run db:purge-legacy --prefix backend
 */
import { PLATFORM_OWNER_SLUG } from '../src/config/platformOwner';
import { deleteCompanyCompletely } from '../src/services/companyDeletion.service';
import prisma from '../src/config/database';

const LEGACY_SLUGS = ['amazon', 'filter', 'kenya-filters', 'kenyafilters', 'demo'];

async function main() {
  const companies = await prisma.company.findMany({
    where: {
      slug: { in: LEGACY_SLUGS.map((s) => s.toLowerCase()) },
    },
    select: { id: true, slug: true, name: true },
  });

  if (!companies.length) {
    console.log('No legacy demo tenants found.');
    return;
  }

  for (const company of companies) {
    if (company.slug === PLATFORM_OWNER_SLUG) continue;
    console.log(`Deleting legacy tenant: ${company.slug} (${company.name})`);
    await deleteCompanyCompletely(company.id);
    console.log(`Deleted: ${company.slug}`);
  }

  console.log('Legacy tenant purge complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
