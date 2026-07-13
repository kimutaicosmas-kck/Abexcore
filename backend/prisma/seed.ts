import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ROLES = [
  'Super Admin',
  'Managing Director',
  'Operations Manager',
  'Production Manager',
  'Procurement Officer',
  'Warehouse Officer',
  'Sales Officer',
  'Finance Officer',
  'Accountant',
  'HR',
  'Customer Service',
  'Driver',
  'Auditor',
];

const MODULES = [
  'dashboard', 'users', 'customers', 'products', 'inventory',
  'procurement', 'production', 'sales', 'finance', 'hr',
  'maintenance', 'quality', 'reports', 'settings',
];

const ACTIONS = ['create', 'read', 'update', 'delete', 'approve'];

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

    const permsToAssign =
      roleName === 'Super Admin'
        ? permissions
        : permissions.filter((p) => {
            const roleModules: Record<string, string[]> = {
              'Managing Director': MODULES,
              'Operations Manager': ['dashboard', 'production', 'inventory', 'procurement', 'quality'],
              'Production Manager': ['dashboard', 'production', 'inventory', 'quality'],
              'Procurement Officer': ['dashboard', 'procurement', 'inventory'],
              'Warehouse Officer': ['dashboard', 'inventory'],
              'Sales Officer': ['dashboard', 'customers', 'sales'],
              'Finance Officer': ['dashboard', 'finance', 'reports'],
              Accountant: ['dashboard', 'finance', 'reports'],
              HR: ['dashboard', 'hr'],
              'Customer Service': ['dashboard', 'customers'],
              Driver: ['dashboard'],
              Auditor: ['dashboard', 'reports', 'finance'],
            };
            return (roleModules[roleName] || ['dashboard']).includes(p.module);
          });

    for (const perm of permsToAssign) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // Departments
  const deptNames = ['Management', 'Production', 'Procurement', 'Warehouse', 'Sales', 'Finance', 'HR', 'Quality Control'];
  const departments = [];
  for (const name of deptNames) {
    const dept = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name, description: `${name} department` },
    });
    departments.push(dept);
  }

  // Company & Branch
  const company = await prisma.company.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Kenya Filter Industries Ltd',
      legalName: 'Kenya Filter Industries Limited',
      registrationNo: 'C.123456',
      taxPin: 'P051234567X',
      address: 'Industrial Area, Nairobi',
      city: 'Nairobi',
      country: 'Kenya',
      phone: '+254 700 123 456',
      email: 'info@kenyafilters.co.ke',
      website: 'https://kenyafilters.co.ke',
      currency: 'KES',
      vatRate: 16,
    },
  });

  const branch = await prisma.branch.upsert({
    where: { code: 'HQ' },
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
    where: { code: 'WH-RM' },
    update: {},
    create: {
      branchId: branch.id,
      code: 'WH-RM',
      name: 'Raw Materials Warehouse',
      type: 'raw_materials',
      address: 'Industrial Area, Block A',
    },
  });

  const fgWarehouse = await prisma.warehouse.upsert({
    where: { code: 'WH-FG' },
    update: {},
    create: {
      branchId: branch.id,
      code: 'WH-FG',
      name: 'Finished Goods Warehouse',
      type: 'finished_goods',
      address: 'Industrial Area, Block B',
    },
  });

  // Admin user
  const adminRole = await prisma.role.findUnique({ where: { name: 'Super Admin' } });
  const passwordHash = await bcrypt.hash('Admin@123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@filtererp.co.ke' },
    update: {},
    create: {
      email: 'admin@filtererp.co.ke',
      passwordHash,
      firstName: 'System',
      lastName: 'Administrator',
      phone: '+254 700 000 001',
      roleId: adminRole!.id,
      departmentId: departments[0].id,
      branchId: branch.id,
    },
  });

  // Suppliers
  const suppliers = await Promise.all([
    prisma.supplier.upsert({
      where: { code: 'SUP-001' },
      update: {},
      create: { code: 'SUP-001', name: 'Steel Works Kenya', email: 'orders@steelworks.co.ke', phone: '+254 711 111 111', city: 'Nairobi', leadTimeDays: 5, rating: 4.5 },
    }),
    prisma.supplier.upsert({
      where: { code: 'SUP-002' },
      update: {},
      create: { code: 'SUP-002', name: 'Filter Paper Co.', email: 'sales@filterpaper.co.ke', phone: '+254 722 222 222', city: 'Mombasa', leadTimeDays: 7, rating: 4.2 },
    }),
    prisma.supplier.upsert({
      where: { code: 'SUP-003' },
      update: {},
      create: { code: 'SUP-003', name: 'Rubber & Gasket Supplies', email: 'info@rubbersupplies.co.ke', phone: '+254 733 333 333', city: 'Nairobi', leadTimeDays: 3, rating: 4.8 },
    }),
  ]);

  // Raw Materials
  const materials = await Promise.all([
    prisma.rawMaterial.upsert({ where: { code: 'RM-STEEL' }, update: {}, create: { code: 'RM-STEEL', name: 'Steel Shell', type: 'STEEL', unit: 'pcs', unitCost: 45, supplierId: suppliers[0].id, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-PAPER' }, update: {}, create: { code: 'RM-PAPER', name: 'Filter Paper', type: 'FILTER_PAPER', unit: 'sqm', unitCost: 12, supplierId: suppliers[1].id, minStockLevel: 200, reorderQty: 500 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-RUBBER' }, update: {}, create: { code: 'RM-RUBBER', name: 'Rubber Gasket', type: 'RUBBER', unit: 'pcs', unitCost: 3.5, supplierId: suppliers[2].id, minStockLevel: 1000, reorderQty: 2000 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-SPRING' }, update: {}, create: { code: 'RM-SPRING', name: 'Anti-Drain Back Valve Spring', type: 'STEEL', unit: 'pcs', unitCost: 2, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-ENDCAP' }, update: {}, create: { code: 'RM-ENDCAP', name: 'End Cap', type: 'END_CAP', unit: 'pcs', unitCost: 8, minStockLevel: 500, reorderQty: 1000 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-THREAD' }, update: {}, create: { code: 'RM-THREAD', name: 'Thread Plate', type: 'THREAD_PLATE', unit: 'pcs', unitCost: 15, minStockLevel: 300, reorderQty: 600 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-GLUE' }, update: {}, create: { code: 'RM-GLUE', name: 'Industrial Adhesive', type: 'ADHESIVE', unit: 'ltr', unitCost: 25, minStockLevel: 50, reorderQty: 100 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-BOX' }, update: {}, create: { code: 'RM-BOX', name: 'Packaging Box', type: 'PACKAGING_BOX', unit: 'pcs', unitCost: 5, minStockLevel: 1000, reorderQty: 2000 } }),
    prisma.rawMaterial.upsert({ where: { code: 'RM-LABEL' }, update: {}, create: { code: 'RM-LABEL', name: 'Product Label', type: 'LABEL', unit: 'pcs', unitCost: 0.5, minStockLevel: 2000, reorderQty: 5000 } }),
  ]);

  // Products
  const products = await Promise.all([
    prisma.product.upsert({ where: { sku: 'OF-001' }, update: {}, create: { sku: 'OF-001', barcode: '6281234567890', name: 'Oil Filter KFI-101', category: 'OIL_FILTER', manufacturingCost: 85, sellingPrice: 150, distributorPrice: 120, retailPrice: 180, minStockLevel: 100 } }),
    prisma.product.upsert({ where: { sku: 'OF-002' }, update: {}, create: { sku: 'OF-002', barcode: '6281234567891', name: 'Oil Filter KFI-102 Heavy Duty', category: 'OIL_FILTER', manufacturingCost: 120, sellingPrice: 220, distributorPrice: 180, retailPrice: 260, minStockLevel: 50 } }),
    prisma.product.upsert({ where: { sku: 'AF-001' }, update: {}, create: { sku: 'AF-001', barcode: '6281234567892', name: 'Air Filter KFI-A50', category: 'AIR_FILTER', manufacturingCost: 65, sellingPrice: 120, distributorPrice: 95, retailPrice: 145, minStockLevel: 150 } }),
    prisma.product.upsert({ where: { sku: 'FF-001' }, update: {}, create: { sku: 'FF-001', barcode: '6281234567893', name: 'Fuel Filter KFI-F30', category: 'FUEL_FILTER', manufacturingCost: 55, sellingPrice: 100, distributorPrice: 80, retailPrice: 120, minStockLevel: 100 } }),
    prisma.product.upsert({ where: { sku: 'HF-001' }, update: {}, create: { sku: 'HF-001', barcode: '6281234567894', name: 'Hydraulic Filter KFI-H200', category: 'HYDRAULIC_FILTER', manufacturingCost: 200, sellingPrice: 380, distributorPrice: 320, retailPrice: 420, minStockLevel: 30 } }),
    prisma.product.upsert({ where: { sku: 'WF-001' }, update: {}, create: { sku: 'WF-001', barcode: '6281234567895', name: 'Water Filter KFI-W10', category: 'WATER_FILTER', manufacturingCost: 40, sellingPrice: 85, distributorPrice: 70, retailPrice: 100, minStockLevel: 200 } }),
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
    prisma.customer.upsert({ where: { code: 'CUST-001' }, update: {}, create: { code: 'CUST-001', name: 'Auto Parts Kenya Ltd', type: 'DEALER', email: 'orders@autopartskenya.co.ke', phone: '+254 744 444 444', city: 'Nairobi', creditLimit: 500000, paymentTerms: 30 } }),
    prisma.customer.upsert({ where: { code: 'CUST-002' }, update: {}, create: { code: 'CUST-002', name: 'Mombasa Motors', type: 'DEALER', email: 'sales@mombasamotors.co.ke', phone: '+254 755 555 555', city: 'Mombasa', creditLimit: 300000, paymentTerms: 30 } }),
    prisma.customer.upsert({ where: { code: 'CUST-003' }, update: {}, create: { code: 'CUST-003', name: 'East Africa Industries', type: 'INDUSTRY', email: 'procurement@eaindustries.co.ke', phone: '+254 766 666 666', city: 'Nairobi', creditLimit: 1000000, paymentTerms: 45 } }),
    prisma.customer.upsert({ where: { code: 'CUST-004' }, update: {}, create: { code: 'CUST-004', name: 'Quick Lube Service Center', type: 'RETAIL_SHOP', email: 'info@quicklube.co.ke', phone: '+254 777 777 777', city: 'Nairobi', creditLimit: 50000, paymentTerms: 15 } }),
  ]);

  // Machines
  await Promise.all([
    prisma.machine.upsert({ where: { code: 'MCH-001' }, update: {}, create: { code: 'MCH-001', name: 'Filter Assembly Line 1', type: 'Assembly', capacity: '500 units/day', location: 'Production Floor A' } }),
    prisma.machine.upsert({ where: { code: 'MCH-002' }, update: {}, create: { code: 'MCH-002', name: 'Filter Assembly Line 2', type: 'Assembly', capacity: '400 units/day', location: 'Production Floor A' } }),
    prisma.machine.upsert({ where: { code: 'MCH-003' }, update: {}, create: { code: 'MCH-003', name: 'Pleating Machine', type: 'Pleating', capacity: '1000 sheets/day', location: 'Production Floor B' } }),
    prisma.machine.upsert({ where: { code: 'MCH-004' }, update: {}, create: { code: 'MCH-004', name: 'Canning Press', type: 'Press', capacity: '600 units/day', location: 'Production Floor B' } }),
  ]);

  // Chart of Accounts
  const accounts = [
    { code: '1000', name: 'Assets', type: 'ASSET' as const },
    { code: '1100', name: 'Cash & Bank', type: 'ASSET' as const },
    { code: '1200', name: 'Accounts Receivable', type: 'ASSET' as const },
    { code: '1300', name: 'Inventory', type: 'ASSET' as const },
    { code: '2000', name: 'Liabilities', type: 'LIABILITY' as const },
    { code: '2100', name: 'Accounts Payable', type: 'LIABILITY' as const },
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
      where: { code: acc.code },
      update: {},
      create: acc,
    });
  }

  // Employees
  await Promise.all([
    prisma.employee.upsert({ where: { employeeNo: 'EMP-001' }, update: {}, create: { employeeNo: 'EMP-001', firstName: 'John', lastName: 'Kamau', email: 'john.kamau@kenyafilters.co.ke', departmentId: departments[1].id, branchId: branch.id, position: 'Production Supervisor', hireDate: new Date('2020-01-15'), salary: 85000 } }),
    prisma.employee.upsert({ where: { employeeNo: 'EMP-002' }, update: {}, create: { employeeNo: 'EMP-002', firstName: 'Mary', lastName: 'Wanjiku', email: 'mary.wanjiku@kenyafilters.co.ke', departmentId: departments[4].id, branchId: branch.id, position: 'Sales Manager', hireDate: new Date('2019-06-01'), salary: 120000 } }),
    prisma.employee.upsert({ where: { employeeNo: 'EMP-003' }, update: {}, create: { employeeNo: 'EMP-003', firstName: 'Peter', lastName: 'Ochieng', email: 'peter.ochieng@kenyafilters.co.ke', departmentId: departments[2].id, branchId: branch.id, position: 'Procurement Officer', hireDate: new Date('2021-03-10'), salary: 75000 } }),
  ]);

  // Vehicles
  await prisma.vehicle.upsert({
    where: { registration: 'KCA 123A' },
    update: {},
    create: { registration: 'KCA 123A', make: 'Isuzu', model: 'NQR', capacity: '3 tons' },
  });

  console.log('Seed completed successfully!');
  console.log('Login: admin@filtererp.co.ke / Admin@123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
