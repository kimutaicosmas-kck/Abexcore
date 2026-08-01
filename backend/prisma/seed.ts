import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  SYSTEM_ROLES,
  permissionsForRole,
} from '../src/config/rolePermissions';
import {
  FILTER_DEMO_PRODUCT_CATEGORY_NAMES,
  seedProductCategoriesForCompany,
} from '../src/utils/productCategories';
import {
  FILTER_DEMO_MATERIAL_TYPE_NAMES,
  seedMaterialTypesForCompany,
} from '../src/utils/materialTypes';
import {
  PLATFORM_OWNER_DEFAULT_PASSWORD,
  PLATFORM_OWNER_EMAIL,
  PLATFORM_OWNER_SLUG,
} from '../src/config/platformOwner';

const prisma = new PrismaClient();

function invNumber(seq: number) {
  return `INV-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}

function soNumber(seq: number) {
  return `SO-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}

function poNumber(seq: number) {
  return `PO-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}

function prodNumber(seq: number) {
  return `PROD-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
}

function subDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

const ROLES = [...SYSTEM_ROLES];

const MODULES = [...PERMISSION_MODULES];

const ACTIONS = [...PERMISSION_ACTIONS];

async function main() {
  console.log('Seeding database...');

  // Permissions
  const permissions = [];
  for (const module of MODULES) {
    for (const action of ACTIONS) {
      const perm = await prisma.permission.upsert({
        where: { module_action: { module, action } },
        update: {},
        create: { module, action, description: `${action} ${module}` },
      });
      permissions.push(perm);
    }
  }

  // Roles with permissions
  for (const roleName of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: {
        name: roleName,
        description: `${roleName} role`,
        isSystem: roleName === 'Super Admin',
      },
    });

    const permsToAssign = permissionsForRole(roleName, permissions);

    for (const perm of permsToAssign) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // Company first (tenant root)
  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { slug: PLATFORM_OWNER_SLUG, isActive: true, name: 'ApexCore Platform' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      slug: PLATFORM_OWNER_SLUG,
      name: 'ApexCore Platform',
      legalName: 'ApexCore Platform',
      registrationNo: 'C.123456',
      taxPin: 'P051234567X',
      address: 'Industrial Area, Nairobi',
      city: 'Nairobi',
      country: 'Kenya',
      phone: '+254 700 123 456',
      email: PLATFORM_OWNER_EMAIL,
      website: 'https://apexcore.co.ke',
      currency: 'KES',
      vatRate: 16,
      isActive: true,
    },
  });

  // Departments (per company)
  const deptNames = ['Management', 'Production', 'Procurement', 'Warehouse', 'Sales', 'Finance', 'HR', 'Quality Control'];
  const departments = [];
  for (const name of deptNames) {
    const dept = await prisma.department.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {},
      create: { companyId: company.id, name, description: `${name} department` },
    });
    departments.push(dept);
  }

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'HQ' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Head Office - Nairobi',
      code: 'HQ',
      address: 'Industrial Area, Nairobi',
      phone: '+254 700 123 456',
      email: 'hq@kenyafilters.co.ke',
    },
  });

  // Warehouses
  const rawWarehouse = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: company.id, code: 'WH-RM' } },
    update: {},
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: 'WH-RM',
      name: 'Raw Materials Warehouse',
      type: 'raw_materials',
      address: 'Industrial Area, Block A',
    },
  });

  const fgWarehouse = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId: company.id, code: 'WH-FG' } },
    update: {},
    create: {
      companyId: company.id,
      branchId: branch.id,
      code: 'WH-FG',
      name: 'Finished Goods Warehouse',
      type: 'finished_goods',
      address: 'Industrial Area, Block B',
    },
  });

  // Admin user
  const adminRole = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
  const passwordHash = await bcrypt.hash(PLATFORM_OWNER_DEFAULT_PASSWORD, 12);

  const legacyAdmin = await prisma.user.findFirst({
    where: {
      companyId: company.id,
      email: { in: ['admin@filtererp.co.ke', PLATFORM_OWNER_EMAIL] },
    },
  });

  if (legacyAdmin) {
    await prisma.user.update({
      where: { id: legacyAdmin.id },
      data: {
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: 'Cosmas',
        lastName: 'Kimutai',
        roleId: adminRole!.id,
        departmentId: departments[0].id,
        branchId: branch.id,
        status: 'ACTIVE',
      },
    });
  } else {
    await prisma.user.create({
      data: {
        companyId: company.id,
        email: PLATFORM_OWNER_EMAIL,
        passwordHash,
        firstName: 'Cosmas',
        lastName: 'Kimutai',
        phone: '+254 700 000 001',
        roleId: adminRole!.id,
        departmentId: departments[0].id,
        branchId: branch.id,
      },
    });
  }

  const adminUser = await prisma.user.findUnique({
    where: { companyId_email: { companyId: company.id, email: PLATFORM_OWNER_EMAIL } },
  });
  const cid = company.id;

  // Suppliers
  const suppliers = await Promise.all([
    prisma.supplier.upsert({
      where: { companyId_code: { companyId: cid, code: 'SUP-001' } },
      update: {},
      create: { companyId: cid, code: 'SUP-001', name: 'Steel Works Kenya', email: 'orders@steelworks.co.ke', phone: '+254 711 111 111', city: 'Nairobi', leadTimeDays: 5, rating: 4.5 },
    }),
    prisma.supplier.upsert({
      where: { companyId_code: { companyId: cid, code: 'SUP-002' } },
      update: {},
      create: { companyId: cid, code: 'SUP-002', name: 'Filter Paper Co.', email: 'sales@filterpaper.co.ke', phone: '+254 722 222 222', city: 'Mombasa', leadTimeDays: 7, rating: 4.2 },
    }),
    prisma.supplier.upsert({
      where: { companyId_code: { companyId: cid, code: 'SUP-003' } },
      update: {},
      create: { companyId: cid, code: 'SUP-003', name: 'Rubber & Gasket Supplies', email: 'info@rubbersupplies.co.ke', phone: '+254 733 333 333', city: 'Nairobi', leadTimeDays: 3, rating: 4.8 },
    }),
  ]);

  const materialTypeIds = await seedMaterialTypesForCompany(
    prisma,
    cid,
    FILTER_DEMO_MATERIAL_TYPE_NAMES
  );

  // Raw Materials
  const materials = await Promise.all([
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-STEEL' } }, update: {}, create: { companyId: cid, code: 'RM-STEEL', name: 'Steel Shell', typeId: materialTypeIds.get('Steel')!, unit: 'pcs', unitCost: 45, supplierId: suppliers[0].id, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-PAPER' } }, update: {}, create: { companyId: cid, code: 'RM-PAPER', name: 'Filter Paper', typeId: materialTypeIds.get('Filter Paper')!, unit: 'sqm', unitCost: 12, supplierId: suppliers[1].id, minStockLevel: 200, reorderQty: 500 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-RUBBER' } }, update: {}, create: { companyId: cid, code: 'RM-RUBBER', name: 'Rubber Gasket', typeId: materialTypeIds.get('Rubber')!, unit: 'pcs', unitCost: 3.5, supplierId: suppliers[2].id, minStockLevel: 1000, reorderQty: 2000 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-SPRING' } }, update: {}, create: { companyId: cid, code: 'RM-SPRING', name: 'Anti-Drain Back Valve Spring', typeId: materialTypeIds.get('Steel')!, unit: 'pcs', unitCost: 2, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-ENDCAP' } }, update: {}, create: { companyId: cid, code: 'RM-ENDCAP', name: 'End Cap', typeId: materialTypeIds.get('End Cap')!, unit: 'pcs', unitCost: 8, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-THREAD' } }, update: {}, create: { companyId: cid, code: 'RM-THREAD', name: 'Thread Plate', typeId: materialTypeIds.get('Thread Plate')!, unit: 'pcs', unitCost: 15, minStockLevel: 300, reorderQty: 600 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-GLUE' } }, update: {}, create: { companyId: cid, code: 'RM-GLUE', name: 'Industrial Adhesive', typeId: materialTypeIds.get('Adhesive')!, unit: 'ltr', unitCost: 25, minStockLevel: 50, reorderQty: 100 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-BOX' } }, update: {}, create: { companyId: cid, code: 'RM-BOX', name: 'Packaging Box', typeId: materialTypeIds.get('Packaging Box')!, unit: 'pcs', unitCost: 5, minStockLevel: 1000, reorderQty: 2000 } }),
    prisma.rawMaterial.upsert({ where: { companyId_code: { companyId: cid, code: 'RM-LABEL' } }, update: {}, create: { companyId: cid, code: 'RM-LABEL', name: 'Product Label', typeId: materialTypeIds.get('Label')!, unit: 'pcs', unitCost: 0.5, minStockLevel: 2000, reorderQty: 5000 } }),
  ]);

  const categoryIds = await seedProductCategoriesForCompany(
    prisma,
    cid,
    FILTER_DEMO_PRODUCT_CATEGORY_NAMES
  );

  // Products
  const products = await Promise.all([
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'OF-001' } }, update: {}, create: { companyId: cid, sku: 'OF-001', barcode: '6281234567890', name: 'Oil Filter KFI-101', categoryId: categoryIds.get('Oil Filter')!, manufacturingCost: 85, sellingPrice: 150, distributorPrice: 120, retailPrice: 180, minStockLevel: 100 } }),
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'OF-002' } }, update: {}, create: { companyId: cid, sku: 'OF-002', barcode: '6281234567891', name: 'Oil Filter KFI-102 Heavy Duty', categoryId: categoryIds.get('Oil Filter')!, manufacturingCost: 120, sellingPrice: 220, distributorPrice: 180, retailPrice: 260, minStockLevel: 50 } }),
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'AF-001' } }, update: {}, create: { companyId: cid, sku: 'AF-001', barcode: '6281234567892', name: 'Air Filter KFI-A50', categoryId: categoryIds.get('Air Filter')!, manufacturingCost: 65, sellingPrice: 120, distributorPrice: 95, retailPrice: 145, minStockLevel: 150 } }),
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'FF-001' } }, update: {}, create: { companyId: cid, sku: 'FF-001', barcode: '6281234567893', name: 'Fuel Filter KFI-F30', categoryId: categoryIds.get('Fuel Filter')!, manufacturingCost: 55, sellingPrice: 100, distributorPrice: 80, retailPrice: 120, minStockLevel: 100 } }),
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'HF-001' } }, update: {}, create: { companyId: cid, sku: 'HF-001', barcode: '6281234567894', name: 'Hydraulic Filter KFI-H200', categoryId: categoryIds.get('Hydraulic Filter')!, manufacturingCost: 200, sellingPrice: 380, distributorPrice: 320, retailPrice: 420, minStockLevel: 30 } }),
    prisma.product.upsert({ where: { companyId_sku: { companyId: cid, sku: 'WF-001' } }, update: {}, create: { companyId: cid, sku: 'WF-001', barcode: '6281234567895', name: 'Water Filter KFI-W10', categoryId: categoryIds.get('Water Filter')!, manufacturingCost: 40, sellingPrice: 85, distributorPrice: 70, retailPrice: 100, minStockLevel: 200 } }),
  ]);

  // BOM for Oil Filter KFI-101
  const bom = await prisma.billOfMaterial.upsert({
    where: { productId: products[0].id },
    update: {},
    create: {
      productId: products[0].id,
      version: '1.0',
      items: {
        create: [
          { rawMaterialId: materials[0].id, quantity: 1, unit: 'pcs' },
          { rawMaterialId: materials[1].id, quantity: 0.5, unit: 'sqm' },
          { rawMaterialId: materials[2].id, quantity: 2, unit: 'pcs' },
          { rawMaterialId: materials[3].id, quantity: 1, unit: 'pcs' },
          { rawMaterialId: materials[4].id, quantity: 2, unit: 'pcs' },
          { rawMaterialId: materials[5].id, quantity: 1, unit: 'pcs' },
          { rawMaterialId: materials[6].id, quantity: 0.05, unit: 'ltr' },
          { rawMaterialId: materials[7].id, quantity: 1, unit: 'pcs' },
          { rawMaterialId: materials[8].id, quantity: 1, unit: 'pcs' },
        ],
      },
    },
  });

  // Stock levels
  for (const material of materials) {
    const existing = await prisma.stockLevel.findFirst({
      where: { warehouseId: rawWarehouse.id, rawMaterialId: material.id },
    });
    if (!existing) {
      await prisma.stockLevel.create({
        data: {
          warehouseId: rawWarehouse.id,
          rawMaterialId: material.id,
          quantity: 5000,
          unitCost: material.unitCost,
        },
      });
    }
  }

  for (const product of products) {
    const existing = await prisma.stockLevel.findFirst({
      where: { warehouseId: fgWarehouse.id, productId: product.id },
    });
    if (!existing) {
      await prisma.stockLevel.create({
        data: {
          warehouseId: fgWarehouse.id,
          productId: product.id,
          quantity: 500,
          unitCost: product.manufacturingCost,
        },
      });
    }
  }

  // Customers
  const customers = await Promise.all([
    prisma.customer.upsert({
      where: { companyId_code: { companyId: cid, code: 'CUST-001' } },
      update: { vatStatus: 'VAT', taxPin: 'P051234567A' },
      create: {
        companyId: cid,
        code: 'CUST-001',
        name: 'Auto Parts Kenya Ltd',
        type: 'DEALER',
        vatStatus: 'VAT',
        taxPin: 'P051234567A',
        email: 'orders@autopartskenya.co.ke',
        phone: '+254 744 444 444',
        city: 'Nairobi',
        creditLimit: 500000,
        paymentTerms: 30,
      },
    }),
    prisma.customer.upsert({
      where: { companyId_code: { companyId: cid, code: 'CUST-002' } },
      update: { vatStatus: 'VAT', taxPin: 'P051111111B' },
      create: {
        companyId: cid,
        code: 'CUST-002',
        name: 'Mombasa Motors',
        type: 'DEALER',
        vatStatus: 'VAT',
        taxPin: 'P051111111B',
        email: 'sales@mombasamotors.co.ke',
        phone: '+254 755 555 555',
        city: 'Mombasa',
        creditLimit: 300000,
        paymentTerms: 30,
      },
    }),
    prisma.customer.upsert({
      where: { companyId_code: { companyId: cid, code: 'CUST-003' } },
      update: { vatStatus: 'VAT', taxPin: 'P052222222C' },
      create: {
        companyId: cid,
        code: 'CUST-003',
        name: 'East Africa Industries',
        type: 'INDUSTRY',
        vatStatus: 'VAT',
        taxPin: 'P052222222C',
        email: 'procurement@eaindustries.co.ke',
        phone: '+254 766 666 666',
        city: 'Nairobi',
        creditLimit: 1000000,
        paymentTerms: 45,
      },
    }),
    prisma.customer.upsert({
      where: { companyId_code: { companyId: cid, code: 'CUST-004' } },
      update: { vatStatus: 'NON_VAT' },
      create: {
        companyId: cid,
        code: 'CUST-004',
        name: 'Quick Lube Service Center',
        type: 'RETAIL_SHOP',
        vatStatus: 'NON_VAT',
        email: 'info@quicklube.co.ke',
        phone: '+254 777 777 777',
        city: 'Nairobi',
        creditLimit: 50000,
        paymentTerms: 15,
      },
    }),
  ]);

  // Machines
  await Promise.all([
    prisma.machine.upsert({ where: { companyId_code: { companyId: cid, code: 'MCH-001' } }, update: {}, create: { companyId: cid, code: 'MCH-001', name: 'Filter Assembly Line 1', type: 'Assembly', capacity: '500 units/day', location: 'Production Floor A' } }),
    prisma.machine.upsert({ where: { companyId_code: { companyId: cid, code: 'MCH-002' } }, update: {}, create: { companyId: cid, code: 'MCH-002', name: 'Filter Assembly Line 2', type: 'Assembly', capacity: '400 units/day', location: 'Production Floor A' } }),
    prisma.machine.upsert({ where: { companyId_code: { companyId: cid, code: 'MCH-003' } }, update: {}, create: { companyId: cid, code: 'MCH-003', name: 'Pleating Machine', type: 'Pleating', capacity: '1000 sheets/day', location: 'Production Floor B' } }),
    prisma.machine.upsert({ where: { companyId_code: { companyId: cid, code: 'MCH-004' } }, update: {}, create: { companyId: cid, code: 'MCH-004', name: 'Canning Press', type: 'Press', capacity: '600 units/day', location: 'Production Floor B' } }),
  ]);

  // Chart of Accounts
  const accounts = [
    { code: '1000', name: 'Assets', type: 'ASSET' as const },
    { code: '1100', name: 'Cash & Bank', type: 'ASSET' as const },
    { code: '1110', name: 'M-Pesa Float', type: 'ASSET' as const },
    { code: '1120', name: 'Bank Accounts', type: 'ASSET' as const },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
    { code: '1250', name: 'VAT Input Recoverable', type: 'ASSET' as const },
    { code: '1300', name: 'Inventory', type: 'ASSET' as const },
    { code: '2000', name: 'Liabilities', type: 'LIABILITY' as const },
    { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' as const },
    { code: '2150', name: 'Goods Received Not Invoiced', type: 'LIABILITY' as const },
    { code: '2200', name: 'VAT Payable', type: 'LIABILITY' as const },
    { code: '3000', name: 'Equity', type: 'EQUITY' as const },
    { code: '4000', name: 'Revenue', type: 'INCOME' as const },
    { code: '4100', name: 'Sales Revenue', type: 'INCOME' as const },
    { code: '5000', name: 'Expenses', type: 'EXPENSE' as const },
    { code: '5100', name: 'Cost of Goods Sold', type: 'EXPENSE' as const },
    { code: '5200', name: 'Operating Expenses', type: 'EXPENSE' as const },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { companyId_code: { companyId: cid, code: acc.code } },
      update: { name: acc.name, type: acc.type, isActive: true },
      create: { companyId: cid, code: acc.code, name: acc.name, type: acc.type },
    });
  }

  // Employees
  await Promise.all([
    prisma.employee.upsert({ where: { companyId_employeeNo: { companyId: cid, employeeNo: 'EMP-001' } }, update: {}, create: { companyId: cid, employeeNo: 'EMP-001', firstName: 'John', lastName: 'Kamau', email: 'john.kamau@kenyafilters.co.ke', departmentId: departments[1].id, branchId: branch.id, position: 'Production Supervisor', hireDate: new Date('2020-01-15'), salary: 85000 } }),
    prisma.employee.upsert({ where: { companyId_employeeNo: { companyId: cid, employeeNo: 'EMP-002' } }, update: {}, create: { companyId: cid, employeeNo: 'EMP-002', firstName: 'Mary', lastName: 'Wanjiku', email: 'mary.wanjiku@kenyafilters.co.ke', departmentId: departments[4].id, branchId: branch.id, position: 'Sales Manager', hireDate: new Date('2019-06-01'), salary: 120000 } }),
    prisma.employee.upsert({ where: { companyId_employeeNo: { companyId: cid, employeeNo: 'EMP-003' } }, update: {}, create: { companyId: cid, employeeNo: 'EMP-003', firstName: 'Peter', lastName: 'Ochieng', email: 'peter.ochieng@kenyafilters.co.ke', departmentId: departments[2].id, branchId: branch.id, position: 'Procurement Officer', hireDate: new Date('2021-03-10'), salary: 75000 } }),
  ]);

  // Vehicles — motorcycles, trucks, and lorries
  await prisma.vehicle.upsert({
    where: { companyId_registration: { companyId: cid, registration: 'KCA 123A' } },
    update: { type: 'TRUCK' },
    create: { companyId: cid, registration: 'KCA 123A', type: 'TRUCK', make: 'Isuzu', model: 'NQR', capacity: '3 tons' },
  });
  await prisma.vehicle.upsert({
    where: { companyId_registration: { companyId: cid, registration: 'KDB 456B' } },
    update: { type: 'LORRY' },
    create: { companyId: cid, registration: 'KDB 456B', type: 'LORRY', make: 'Scania', model: 'P-Series', capacity: '10 tons' },
  });
  await prisma.vehicle.upsert({
    where: { companyId_registration: { companyId: cid, registration: 'KCE 789C' } },
    update: { type: 'MOTORCYCLE' },
    create: { companyId: cid, registration: 'KCE 789C', type: 'MOTORCYCLE', make: 'Bajaj', model: 'Boxer', capacity: '50 kg' },
  });

  // Transactional demo data — platform owner workspace only (never mixed across tenants)
  if (adminUser) {
    const { seedDemoDataForCompany } = await import('../src/services/demoDataSeed.service');
    await seedDemoDataForCompany(prisma, PLATFORM_OWNER_SLUG);
  }

  console.log('Seed completed successfully!');
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo data loaded. Configure SEED_ADMIN_PASSWORD in production.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
