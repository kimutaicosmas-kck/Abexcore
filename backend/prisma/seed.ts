import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

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
  'procurement', 'production', 'sales', 'delivery', 'finance', 'hr',
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
              'Sales Officer': ['dashboard', 'customers', 'sales', 'delivery'],
              'Finance Officer': ['dashboard', 'finance', 'reports'],
              Accountant: ['dashboard', 'finance', 'reports'],
              HR: ['dashboard', 'hr'],
              'Customer Service': ['dashboard', 'customers'],
              Driver: ['dashboard', 'delivery'],
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

  const adminUser = await prisma.user.findUnique({ where: { email: 'admin@filtererp.co.ke' } });

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

  // Dashboard demo data (sales history, pending actions, production)
  const existingOrders = await prisma.salesOrder.count();
  if (existingOrders < 5 && adminUser) {
    const orderStatuses = ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'COMPLETED', 'PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'DELIVERED', 'COMPLETED'] as const;
    let invSeq = await prisma.invoice.count();
    let soSeq = 0;

    for (let i = 0; i < 10; i++) {
      const customer = customers[i % customers.length];
      const product = products[i % products.length];
      const qty = 20 + i * 15;
      const unitPrice = Number(product.sellingPrice);
      const subtotal = qty * unitPrice;
      const taxAmount = subtotal * 0.16;
      const totalAmount = subtotal + taxAmount;
      const orderDate = subDays(new Date(), i * 2);
      soSeq += 1;

      const order = await prisma.salesOrder.create({
        data: {
          orderNumber: soNumber(soSeq),
          customerId: customer.id,
          createdById: adminUser.id,
          orderDate,
          status: orderStatuses[i],
          subtotal,
          taxAmount,
          totalAmount,
          items: {
            create: [{ productId: product.id, quantity: qty, unitPrice, totalPrice: subtotal }],
          },
        },
      });

      if (i % 3 === 0) {
        invSeq += 1;
        const invoiceDate = subDays(new Date(), Math.min(i * 2, 29));
        await prisma.invoice.create({
          data: {
            invoiceNumber: invNumber(invSeq),
            type: 'SALES',
            customerId: customer.id,
            salesOrderId: order.id,
            invoiceDate,
            dueDate: subDays(invoiceDate, -30),
            subtotal,
            taxAmount,
            totalAmount,
            status: i === 0 ? 'OVERDUE' : i % 4 === 0 ? 'PAID' : 'UNPAID',
            items: {
              create: [{ description: `${product.name} x ${qty}`, quantity: qty, unitPrice, taxRate: 16, totalPrice: subtotal }],
            },
          },
        });
      }
    }

    // Spread additional sales invoices across 30 days for chart data
    for (let day = 1; day <= 29; day += 3) {
      invSeq += 1;
      const customer = customers[day % customers.length];
      const product = products[day % products.length];
      const qty = 10 + (day % 5) * 5;
      const subtotal = qty * Number(product.sellingPrice);
      const taxAmount = subtotal * 0.16;
      await prisma.invoice.create({
        data: {
          invoiceNumber: invNumber(invSeq),
          type: 'SALES',
          customerId: customer.id,
          invoiceDate: subDays(new Date(), day),
          subtotal,
          taxAmount,
          totalAmount: subtotal + taxAmount,
          status: 'PAID',
          items: {
            create: [{ description: `${product.name} daily sale`, quantity: qty, unitPrice: Number(product.sellingPrice), taxRate: 16, totalPrice: subtotal }],
          },
        },
      });
    }

    // Purchase invoices for monthly expenses
    const supplier = suppliers[0];
    for (let e = 0; e < 3; e++) {
      invSeq += 1;
      const amount = 25000 + e * 8000;
      await prisma.invoice.create({
        data: {
          invoiceNumber: invNumber(invSeq),
          type: 'PURCHASE',
          supplierId: supplier.id,
          invoiceDate: subDays(new Date(), e * 7),
          subtotal: amount,
          taxAmount: amount * 0.16,
          totalAmount: amount * 1.16,
          status: 'PAID',
          items: {
            create: [{ description: 'Raw material purchase', quantity: 1, unitPrice: amount, taxRate: 16, totalPrice: amount }],
          },
        },
      });
    }

    const machine = await prisma.machine.findFirst();
    const prodStatuses = ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;
    let prodSeq = await prisma.productionOrder.count();
    for (let p = 0; p < 4; p++) {
      prodSeq += 1;
      await prisma.productionOrder.create({
        data: {
          orderNumber: prodNumber(prodSeq),
          productId: products[p].id,
          machineId: machine?.id,
          quantity: 100 + p * 50,
          completedQty: p === 3 ? 150 : p * 30,
          status: prodStatuses[p],
          scheduledStart: subDays(new Date(), 5 - p),
        },
      });
    }

    await prisma.purchaseRequisition.create({
      data: {
        requisitionNo: `PR-${new Date().getFullYear()}-00001`,
        requestedById: adminUser.id,
        department: 'Production',
        status: 'PENDING',
        items: {
          create: [{ rawMaterialId: materials[0].id, description: 'Steel Shell restock', quantity: 500, unit: 'pcs', estimatedCost: 22500 }],
        },
      },
    });

    await prisma.requestForQuotation.create({
      data: {
        rfqNo: `RFQ-${new Date().getFullYear()}-00001`,
        status: 'PENDING',
        dueDate: subDays(new Date(), -7),
        notes: 'Awaiting supplier quotes for filter paper',
      },
    });

    const employees = await prisma.employee.findMany({ take: 2 });
    if (employees[0]) {
      await prisma.leaveRequest.create({
        data: {
          employeeId: employees[0].id,
          type: 'Annual',
          startDate: subDays(new Date(), -5),
          endDate: subDays(new Date(), -3),
          reason: 'Family event',
          status: 'PENDING',
        },
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      for (const emp of employees) {
        await prisma.attendance.upsert({
          where: { employeeId_date: { employeeId: emp.id, date: today } },
          update: {},
          create: {
            employeeId: emp.id,
            date: today,
            checkIn: new Date(),
            status: 'present',
          },
        });
      }
    }

    await prisma.complaint.createMany({
      data: [
        { customerId: customers[0].id, subject: 'Delayed delivery', description: 'Order arrived 3 days late.', priority: 'high', status: 'PENDING' },
        { customerId: customers[1].id, subject: 'Wrong filter size', description: 'Received incorrect SKU.', priority: 'medium', status: 'PENDING' },
      ],
    });

    await prisma.opportunity.createMany({
      data: [
        { customerId: customers[2].id, title: 'Annual filter supply contract', value: 850000, stage: 'proposal', probability: 65, status: 'PENDING' },
        { customerId: customers[3].id, title: 'Fleet maintenance filters', value: 320000, stage: 'negotiation', probability: 80, status: 'APPROVED' },
      ],
    });

    await prisma.notification.createMany({
      data: [
        { userId: adminUser.id, type: 'APPROVAL', title: 'Leave request pending', message: 'John Kamau submitted a leave request for approval.', link: '/hr', isRead: false },
        { userId: adminUser.id, type: 'LOW_STOCK', title: 'Low stock alert', message: 'Industrial Adhesive is below minimum level.', link: '/inventory', isRead: false },
      ],
    });

    // Set one material below minimum for low-stock widget
    const glueStock = await prisma.stockLevel.findFirst({
      where: { rawMaterialId: materials[6].id },
    });
    if (glueStock) {
      await prisma.stockLevel.update({
        where: { id: glueStock.id },
        data: { quantity: 30 },
      });
    }

    const poCount = await prisma.purchaseOrder.count();
    await prisma.purchaseOrder.create({
      data: {
        poNumber: poNumber(poCount + 1),
        supplierId: suppliers[1].id,
        status: 'CONFIRMED',
        subtotal: 45000,
        taxAmount: 7200,
        totalAmount: 52200,
        items: {
          create: [{ description: 'Filter Paper bulk order', quantity: 200, unitPrice: 225, totalPrice: 45000 }],
        },
      },
    });
  } else if (adminUser) {
    // Ensure at least one sales invoice exists for finance demo
    const invCount = await prisma.invoice.count();
    const customer = await prisma.customer.findFirst();
    if (customer && invCount === 0) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: invNumber(1),
          type: 'SALES',
          customerId: customer.id,
          subtotal: 15000,
          taxAmount: 2400,
          totalAmount: 17400,
          status: 'UNPAID',
          items: {
            create: [{ description: 'Oil Filter KFI-101 x 100', quantity: 100, unitPrice: 150, taxRate: 16, totalPrice: 15000 }],
          },
        },
      });
    }
  }

  // Quality & delivery demo data
  if (adminUser) {
    const qcCount = await prisma.qualityInspection.count();
    if (qcCount === 0) {
      const [gr, prodOrder] = await Promise.all([
        prisma.goodsReceipt.findFirst(),
        prisma.productionOrder.findFirst(),
      ]);
      await prisma.qualityInspection.createMany({
        data: [
          {
            inspectionNo: 'QC-00001',
            type: 'incoming',
            goodsReceiptId: gr?.id,
            inspectorId: adminUser.id,
            status: 'PASSED',
            result: 'All items within spec',
            defectsFound: 0,
            inspectedAt: subDays(new Date(), 2),
          },
          {
            inspectionNo: 'QC-00002',
            type: 'production',
            productionOrderId: prodOrder?.id,
            inspectorId: adminUser.id,
            status: 'PENDING',
            defectsFound: 0,
          },
          {
            inspectionNo: 'QC-00003',
            type: 'finished',
            productionOrderId: prodOrder?.id,
            inspectorId: adminUser.id,
            status: 'CONDITIONAL',
            result: 'Minor packaging defect',
            defectsFound: 2,
            correctiveAction: 'Repack affected units',
            inspectedAt: subDays(new Date(), 1),
          },
        ],
      });
    }

    const dnCount = await prisma.deliveryNote.count();
    if (dnCount === 0) {
      const [order, vehicle] = await Promise.all([
        prisma.salesOrder.findFirst({
          where: { status: { in: ['READY', 'DISPATCHED', 'CONFIRMED'] } },
          include: { items: true },
        }),
        prisma.vehicle.findFirst(),
      ]);
      if (order && order.items.length > 0) {
        await prisma.deliveryNote.create({
          data: {
            deliveryNo: 'DN-00001',
            salesOrderId: order.id,
            vehicleId: vehicle?.id,
            status: vehicle ? 'ASSIGNED' : 'PENDING',
            scheduledDate: subDays(new Date(), -1),
            items: {
              create: order.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
            },
          },
        });
      }
    }

    const quoteCount = await prisma.salesQuotation.count();
    if (quoteCount === 0) {
      const customer = await prisma.customer.findFirst();
      const product = await prisma.product.findFirst();
      if (customer && product) {
        const subtotal = Number(product.sellingPrice) * 50;
        const taxAmount = subtotal * 0.16;
        await prisma.salesQuotation.create({
          data: {
            quotationNo: 'QT-00001',
            customerId: customer.id,
            status: 'PENDING',
            validUntil: subDays(new Date(), -14),
            subtotal,
            taxAmount,
            totalAmount: subtotal + taxAmount,
            items: {
              create: [{
                productId: product.id,
                quantity: 50,
                unitPrice: Number(product.sellingPrice),
                totalPrice: subtotal,
              }],
            },
          },
        });
      }
    }
  }

  console.log('Seed completed successfully!');
  if (process.env.NODE_ENV !== 'production') {
    console.log('Demo data loaded. Configure SEED_ADMIN_PASSWORD in production.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
