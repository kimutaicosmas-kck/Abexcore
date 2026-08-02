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
  process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'admin@abexcore.co.ke';
const PLATFORM_OWNER_DEFAULT_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD || 'ChangeMeNow1!';

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
  'Sales Representative',
  'Storekeeper',
  'Machine Operator',
];

const MODULES = [
  'dashboard', 'users', 'customers', 'crm', 'products', 'inventory', 'procurement',
  'production', 'quality', 'sales', 'delivery', 'finance', 'hr', 'maintenance', 'reports', 'settings',
];

const ACTIONS = ['read', 'create', 'update', 'delete', 'approve'];

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || PLATFORM_OWNER_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || PLATFORM_OWNER_DEFAULT_PASSWORD;

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

  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {
      slug: PLATFORM_OWNER_SLUG,
      isActive: true,
      name: process.env.SEED_COMPANY_NAME || 'AbexCore Platform',
      legalName: process.env.SEED_COMPANY_NAME || 'AbexCore Platform',
      website: process.env.SEED_COMPANY_WEBSITE || 'https://abexcore.co.ke',
    },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      slug: PLATFORM_OWNER_SLUG,
      name: process.env.SEED_COMPANY_NAME || 'AbexCore Platform',
      legalName: process.env.SEED_COMPANY_NAME || 'AbexCore Platform',
      website: process.env.SEED_COMPANY_WEBSITE || 'https://abexcore.co.ke',
      currency: 'KES',
      country: 'Kenya',
      vatRate: 16,
      isActive: true,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { code: 'HQ' },
    update: {},
    create: {
      companyId: company.id,
      code: 'HQ',
      name: 'Head Office',
      address: 'Nairobi, Kenya',
    },
  });

  await prisma.warehouse.upsert({
    where: { code: 'WH-FG' },
    update: {},
    create: {
      branchId: branch.id,
      code: 'WH-FG',
      name: 'Finished Goods Warehouse',
      type: 'finished_goods',
    },
  });

  await prisma.department.upsert({
    where: { name: 'Administration' },
    update: {},
    create: { name: 'Administration', description: 'System administration' },
  });

  const dept = await prisma.department.findUnique({ where: { name: 'Administration' } });
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail.toLowerCase() },
    update: { mustChangePassword: true },
    create: {
      email: adminEmail.toLowerCase(),
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      roleId: superAdmin!.id,
      departmentId: dept!.id,
      branchId: branch.id,
      mustChangePassword: true,
    },
  });

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
    await prisma.account.upsert({ where: { code: acc.code }, update: {}, create: acc });
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
