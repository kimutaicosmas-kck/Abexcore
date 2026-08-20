/**
 * Updates platform owner company code and admin email/password on existing databases.
 *
 * Usage (from backend/ or Docker backend container):
 *   npx tsx scripts/migrate-platform-owner.ts
 */
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import {
  PLATFORM_OWNER_DEFAULT_PASSWORD,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_SLUG,
} from '../src/config/platformOwner';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const LEGACY_OWNER_EMAILS = ['kimutaicosmas547@gmail.com', 'admin@filtererp.co.ke'];
const prisma = new PrismaClient();

async function main() {
  console.log('Updating platform owner credentials…');

  let company = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
  if (!company) {
    company = await prisma.company.findFirst({
      where: { slug: PLATFORM_OWNER_SLUG },
    });
  }
  if (!company) {
    console.log('Platform owner company not found — run seed first.');
    return;
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      slug: PLATFORM_OWNER_SLUG,
      name: company.name || 'AbexCore Platform',
      legalName: company.legalName || 'AbexCore Platform',
      email: PLATFORM_OWNER_EMAIL,
      isActive: true,
    },
  });
  console.log(`Company slug set to "${PLATFORM_OWNER_SLUG}"`);

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
  if (!superAdminRole) throw new Error('Super Admin role missing');

  const passwordHash = await bcrypt.hash(PLATFORM_OWNER_DEFAULT_PASSWORD, 12);

  const admin =
    (await prisma.user.findFirst({
      where: { companyId: company.id, email: PLATFORM_OWNER_EMAIL },
    })) ||
    (await prisma.user.findFirst({
      where: { companyId: company.id, email: { in: LEGACY_OWNER_EMAILS } },
      orderBy: { createdAt: 'asc' },
    })) ||
    (await prisma.user.findFirst({
      where: { companyId: company.id, roleId: superAdminRole.id },
      orderBy: { createdAt: 'asc' },
    }));

  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: admin.firstName || 'AbexCore',
        lastName: admin.lastName || 'Owner',
        status: 'ACTIVE',
        deletedAt: null,
        mustChangePassword: false,
        roleId: superAdminRole.id,
      },
    });
    console.log(`Platform admin updated: ${admin.email} → ${PLATFORM_OWNER_EMAIL}`);
  } else {
    const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
    const dept = await prisma.department.findFirst({ where: { companyId: company.id } });
    await prisma.user.create({
      data: {
        companyId: company.id,
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: 'AbexCore',
        lastName: 'Owner',
        roleId: superAdminRole.id,
        departmentId: dept?.id,
        branchId: branch?.id,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
    console.log(`Platform admin created: ${PLATFORM_OWNER_EMAIL}`);
  }

  console.log(`Login company: ${PLATFORM_OWNER_SLUG}`);
  console.log(`Login email: ${PLATFORM_OWNER_EMAIL}`);
  console.log(`Login password: ${PLATFORM_OWNER_DEFAULT_PASSWORD}`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
