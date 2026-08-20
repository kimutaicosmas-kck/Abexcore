/**
 * Production seed — roles, permissions, company shell, admin user only.
 * No demo orders, customers, or sample transactions.
 *
 * Usage:
 *   SEED_ADMIN_EMAIL=admin@yourcompany.co.ke SEED_ADMIN_PASSWORD='StrongPass1' npm run db:seed:production
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

// Inline defaults so production Docker can seed without resolving ../src (image may omit sources).
// Prefer PLATFORM_OWNER_* / SEED_ADMIN_* env vars set by contabo-prod-setup.sh.
const PLATFORM_OWNER_SLUG = process.env.PLATFORM_COMPANY_SLUG?.trim() || 'owner';
const PLATFORM_OWNER_EMAIL =
  process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'info.abexcore@gmail.com';
const PLATFORM_OWNER_DEFAULT_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD || 'Kimutai@44!';

const prisma = new PrismaClient();

const ROLES = [
  'Super Admin',
  'General Manager',
  'Operations Manager',
  'Production Manager',
  'Sales Manager',
  'Procurement Manager',
  'Warehouse Manager',
  'Quality Manager',
  'Finance Manager',
  'HR Manager',
  'Accountant',
  'Sales Executive',
  'Storekeeper',
  'Machine Operator',
  'Logistics & Delivery',
];

const MODULES = [
  'dashboard', 'users', 'customers', 'crm', 'products', 'inventory', 'procurement',
  'production', 'quality', 'sales', 'delivery', 'finance', 'hr', 'maintenance', 'reports', 'settings',
];

const ACTIONS = ['read', 'create', 'update', 'delete', 'approve'];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || PLATFORM_OWNER_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || PLATFORM_OWNER_DEFAULT_PASSWORD;

  // Apply display renames before upserts (USE_DB_PUSH hosts may never run SQL migrations).
  await prisma.$executeRawUnsafe(
    `UPDATE \`roles\` SET \`name\` = 'Sales Executive' WHERE \`name\` = 'Sales Representative'`
  );
  await prisma.$executeRawUnsafe(
    `UPDATE \`roles\` SET \`name\` = 'Logistics & Delivery' WHERE \`name\` = 'Driver'`
  );

  for (const name of ROLES) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} role`, isSystem: true },
    });
  }

  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const key = `${module}:${action}`;
      await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action, description: key },
      });
    }
  }

  const superAdmin = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
  const allPerms = await prisma.permission.findMany();
  for (const perm of allPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdmin!.id, permissionId: perm.id } },
      update: {},
      create: { roleId: superAdmin!.id, permissionId: perm.id },
    });
  }

  const seedCompanyName = process.env.SEED_COMPANY_NAME || 'AbexCore Platform';
  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      slug: PLATFORM_OWNER_SLUG,
      isActive: true,
      name: seedCompanyName,
      legalName: seedCompanyName,
      website: process.env.SEED_COMPANY_WEBSITE || 'https://abexcore.co.ke',
      welcomeMessage:
        process.env.SEED_WELCOME_MESSAGE ||
        `Welcome to ${seedCompanyName}. Platform operations are ready.`,
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      slug: PLATFORM_OWNER_SLUG,
      name: seedCompanyName,
      legalName: seedCompanyName,
      website: process.env.SEED_COMPANY_WEBSITE || 'https://abexcore.co.ke',
      currency: 'KES',
      country: 'Kenya',
      vatRate: 16,
      isActive: true,
      welcomeMessage:
        process.env.SEED_WELCOME_MESSAGE ||
        `Welcome to ${seedCompanyName}. Platform operations are ready.`,
    },
  });

  const companyId = company.id;

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId, code: 'HQ' } },
    update: {},
    create: {
      companyId,
      code: 'HQ',
      name: 'Head Office',
      address: 'Nairobi, Kenya',
    },
  });

  await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'WH-FG' } },
    update: {},
    create: {
      companyId,
      branchId: branch.id,
      code: 'WH-FG',
      name: 'Finished Goods Warehouse',
      type: 'finished_goods',
    },
  });

  const dept = await prisma.department.upsert({
    where: { companyId_name: { companyId, name: 'Administration' } },
    update: {},
    create: {
      companyId,
      name: 'Administration',
      description: 'System administration',
    },
  });

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const email = adminEmail.toLowerCase();

  const existingAdmin = await prisma.user.findUnique({
    where: { companyId_email: { companyId, email } },
    select: { id: true },
  });

  if (existingAdmin) {
    // Never reset password on redeploy — that locked owners out after Contabo rebuilds.
    await prisma.user.update({
      where: { id: existingAdmin.id },
      data: {
        status: 'ACTIVE',
        deletedAt: null,
        roleId: superAdmin!.id,
        departmentId: dept.id,
        branchId: branch.id,
      },
    });
  } else {
    await prisma.user.create({
      data: {
        companyId,
        email,
        passwordHash,
        firstName: 'System',
        lastName: 'Administrator',
        roleId: superAdmin!.id,
        departmentId: dept.id,
        branchId: branch.id,
        mustChangePassword: true,
        status: 'ACTIVE',
      },
    });
  }

  const accounts = [
    { code: '1100', name: 'Cash & Bank', type: 'ASSET' as const },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
    { code: '1300', name: 'Inventory', type: 'ASSET' as const },
    { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' as const },
    { code: '2150', name: 'Goods Received Not Invoiced', type: 'LIABILITY' as const },
    { code: '2200', name: 'VAT Payable', type: 'LIABILITY' as const },
    { code: '4100', name: 'Sales Revenue', type: 'INCOME' as const },
    { code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE' as const },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId, code: acc.code } },
      update: {},
      create: { companyId, ...acc },
    });
  }

  console.log('Production seed completed.');
  console.log(`Admin: ${adminEmail} (must change password on first login)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
