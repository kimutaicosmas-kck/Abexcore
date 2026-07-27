/**
 * Updates platform owner company code and admin email on existing databases.
 *
 * Usage (from backend/): npx tsx scripts/migrate-platform-owner.ts
 */
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import {
  PLATFORM_OWNER_DEFAULT_PASSWORD,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_SLUG,
} from '../src/config/platformOwner';

const DEFAULT_COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const prisma = new PrismaClient();

async function main() {
  console.log('Updating platform owner credentials…');

  const company = await prisma.company.findUnique({ where: { id: DEFAULT_COMPANY_ID } });
  if (!company) {
    console.log('Default company not found — run seed first.');
    return;
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      slug: PLATFORM_OWNER_SLUG,
      name: 'ApexCore Platform',
      legalName: 'ApexCore Platform',
      email: PLATFORM_OWNER_EMAIL,
      isActive: true,
    },
  });
  console.log(`Company slug set to "${PLATFORM_OWNER_SLUG}"`);

  const superAdminRole = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
  if (!superAdminRole) throw new Error('Super Admin role missing');

  const passwordHash = await bcrypt.hash(PLATFORM_OWNER_DEFAULT_PASSWORD, 12);
  const admin = await prisma.user.findFirst({
    where: {
      companyId: company.id,
      roleId: superAdminRole.id,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: 'Cosmas',
        lastName: 'Kimutai',
        status: 'ACTIVE',
      },
    });
    console.log(`Platform admin updated to ${PLATFORM_OWNER_EMAIL}`);
  } else {
    const branch = await prisma.branch.findFirst({ where: { companyId: company.id } });
    const dept = await prisma.department.findFirst({ where: { companyId: company.id } });
    await prisma.user.create({
      data: {
        companyId: company.id,
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: 'Cosmas',
        lastName: 'Kimutai',
        roleId: superAdminRole.id,
        departmentId: dept?.id,
        branchId: branch?.id,
        status: 'ACTIVE',
      },
    });
    console.log(`Platform admin created: ${PLATFORM_OWNER_EMAIL}`);
  }

  console.log(`Default password: ${PLATFORM_OWNER_DEFAULT_PASSWORD}`);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
