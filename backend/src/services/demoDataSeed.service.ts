/**
 * Seeds at least MIN_RECORDS dummy rows per ERP module for serious testing.
 */
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PLATFORM_OWNER_SLUG } from '../config/platformOwner';
import { seedProductCategoriesForCompany, FILTER_DEMO_PRODUCT_CATEGORY_NAMES } from '../utils/productCategories';
import { seedMaterialTypesForCompany, FILTER_DEMO_MATERIAL_TYPE_NAMES } from '../utils/materialTypes';
import { seedTenantDefaults } from '../utils/tenantSetup';

const MIN_RECORDS = 10;
const DEMO_PASSWORD = 'Demo@12345!';

const CUSTOMER_TYPES = ['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO'] as const;
const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'COMPLETED'] as const;
const PROD_STATUSES = ['PLANNED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'] as const;
const DELIVERY_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED'] as const;
const QC_STATUSES = ['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL'] as const;
const VEHICLE_TYPES = ['TRUCK', 'LORRY', 'MOTORCYCLE'] as const;

function subDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

function padNum(n: number, len = 3) {
  return String(n).padStart(len, '0');
}

function yearCode(prefix: string, seq: number) {
  return `${prefix}-${new Date().getFullYear()}-${padNum(seq, 5)}`;
}

export type DemoSeedSummary = Record<string, { before: number; after: number; added: number }>;

export async function seedDemoDataForCompany(
  prisma: PrismaClient,
  companySlug: string = PLATFORM_OWNER_SLUG
): Promise<DemoSeedSummary> {
  const normalizedSlug = companySlug.trim().toLowerCase();
  if (normalizedSlug !== PLATFORM_OWNER_SLUG.toLowerCase()) {
    throw new Error(
      `Demo data can only be loaded for the platform owner workspace ("${PLATFORM_OWNER_SLUG}").`
    );
  }

  const company = await prisma.company.findFirst({
    where: { slug: normalizedSlug, isActive: true },
    include: {
      branches: { where: { isActive: true }, take: 1 },
      departments: true,
    },
  });

  if (!company) {
    throw new Error(`Company "${companySlug}" not found or inactive`);
  }

  const warehouses = await prisma.warehouse.findMany({
    where: { companyId: company.id, isActive: true },
  });

  const summary: DemoSeedSummary = {};
  const track = (key: string, before: number, added: number) => {
    summary[key] = { before, after: before + added, added };
  };

  await prisma.$transaction(async (tx) => {
    await seedTenantDefaults(tx, company.id);

    let branch = company.branches[0];
    if (!branch) {
      branch = await tx.branch.create({
        data: { companyId: company.id, name: 'Head Office', code: 'HQ', isActive: true },
      });
    }

    let rawWh = warehouses.find((w) => w.type === 'raw_materials');
    let fgWh = warehouses.find((w) => w.type === 'finished_goods');
    if (!rawWh) {
      rawWh = await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          code: 'WH-RM',
          name: 'Raw Materials Warehouse',
          type: 'raw_materials',
          isActive: true,
        },
      });
    }
    if (!fgWh) {
      fgWh = await tx.warehouse.create({
        data: {
          companyId: company.id,
          branchId: branch.id,
          code: 'WH-FG',
          name: 'Finished Goods Warehouse',
          type: 'finished_goods',
          isActive: true,
        },
      });
    }

    const departments = await tx.department.findMany({ where: { companyId: company.id } });
    const deptByName = (name: string) => departments.find((d) => d.name === name)?.id;

    const adminRole = await tx.role.findUnique({ where: { name: 'Super Admin' } });
    let adminUser = await tx.user.findFirst({
      where: { companyId: company.id, deletedAt: null, roleId: adminRole?.id },
    });
    if (!adminUser && adminRole) {
      const mgmtDept = deptByName('Management') || departments[0]?.id;
      adminUser = await tx.user.create({
        data: {
          companyId: company.id,
          email: `admin.demo@${company.slug}.local`,
          passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
          firstName: 'Demo',
          lastName: 'Admin',
          roleId: adminRole.id,
          departmentId: mgmtDept,
          branchId: branch.id,
          status: 'ACTIVE',
        },
      });
    }
    if (!adminUser) throw new Error('No admin user available to seed demo data');

    const cid = company.id;
    const vatRate = Number(company.vatRate) || 16;

    // --- Catalog ---
    await seedProductCategoriesForCompany(tx, cid, [
      ...FILTER_DEMO_PRODUCT_CATEGORY_NAMES,
      'Spare Parts',
      'Accessories',
    ]);
    await seedMaterialTypesForCompany(tx, cid, FILTER_DEMO_MATERIAL_TYPE_NAMES);

    const categories = await tx.productCategory.findMany({ where: { companyId: cid, isActive: true } });
    const materialTypes = await tx.materialType.findMany({ where: { companyId: cid, isActive: true } });

    // --- Suppliers ---
    const supplierBefore = await tx.supplier.count({ where: { companyId: cid } });
    for (let i = supplierBefore; i < MIN_RECORDS; i++) {
      await tx.supplier.create({
        data: {
          companyId: cid,
          code: `SUP-D${padNum(i + 1)}`,
          name: `Demo Supplier ${i + 1}`,
          email: `supplier${i + 1}@demo.local`,
          phone: `+2547${String(10000000 + i).slice(0, 8)}`,
          city: i % 2 === 0 ? 'Nairobi' : 'Mombasa',
          leadTimeDays: 3 + (i % 7),
          rating: 3.5 + (i % 5) * 0.3,
        },
      });
    }
    track('suppliers', supplierBefore, Math.max(0, MIN_RECORDS - supplierBefore));
    const suppliers = await tx.supplier.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Raw materials ---
    const rmBefore = await tx.rawMaterial.count({ where: { companyId: cid } });
    for (let i = rmBefore; i < MIN_RECORDS; i++) {
      const type = materialTypes[i % materialTypes.length];
      const supplier = suppliers[i % suppliers.length];
      await tx.rawMaterial.create({
        data: {
          companyId: cid,
          code: `RM-D${padNum(i + 1)}`,
          name: `Demo Raw Material ${i + 1}`,
          typeId: type.id,
          unit: 'pcs',
          unitCost: 10 + i * 5,
          supplierId: supplier.id,
          minStockLevel: 100 + i * 10,
          reorderQty: 200 + i * 20,
        },
      });
    }
    track('rawMaterials', rmBefore, Math.max(0, MIN_RECORDS - rmBefore));
    const materials = await tx.rawMaterial.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Products ---
    const prodBefore = await tx.product.count({ where: { companyId: cid } });
    for (let i = prodBefore; i < MIN_RECORDS; i++) {
      const cat = categories[i % categories.length];
      const price = 80 + i * 25;
      await tx.product.create({
        data: {
          companyId: cid,
          sku: `DEMO-${padNum(i + 1)}`,
          barcode: `6289999${padNum(i + 1, 5)}`,
          name: `Demo Product ${i + 1}`,
          categoryId: cat.id,
          manufacturingCost: price * 0.6,
          sellingPrice: price,
          distributorPrice: price * 0.85,
          retailPrice: price * 1.1,
          minStockLevel: 50 + i * 5,
        },
      });
    }
    track('products', prodBefore, Math.max(0, MIN_RECORDS - prodBefore));
    const products = await tx.product.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Stock levels ---
    for (const material of materials) {
      const exists = await tx.stockLevel.findFirst({
        where: { warehouseId: rawWh!.id, rawMaterialId: material.id },
      });
      if (!exists) {
        await tx.stockLevel.create({
          data: {
            warehouseId: rawWh!.id,
            rawMaterialId: material.id,
            quantity: 1000 + Math.floor(Math.random() * 500),
            unitCost: material.unitCost,
          },
        });
      }
    }
    for (const product of products) {
      const exists = await tx.stockLevel.findFirst({
        where: { warehouseId: fgWh!.id, productId: product.id },
      });
      if (!exists) {
        await tx.stockLevel.create({
          data: {
            warehouseId: fgWh!.id,
            productId: product.id,
            quantity: 200 + Math.floor(Math.random() * 300),
            unitCost: product.manufacturingCost,
          },
        });
      }
    }

    // --- Customers ---
    const custBefore = await tx.customer.count({ where: { companyId: cid } });
    for (let i = custBefore; i < MIN_RECORDS; i++) {
      await tx.customer.create({
        data: {
          companyId: cid,
          code: `CUST-D${padNum(i + 1)}`,
          name: `Demo Customer ${i + 1}`,
          type: CUSTOMER_TYPES[i % CUSTOMER_TYPES.length],
          email: `customer${i + 1}@demo.local`,
          phone: `+2547${String(20000000 + i).slice(0, 8)}`,
          city: i % 3 === 0 ? 'Nairobi' : i % 3 === 1 ? 'Mombasa' : 'Kisumu',
          creditLimit: 100000 + i * 50000,
          paymentTerms: 15 + (i % 3) * 15,
        },
      });
    }
    track('customers', custBefore, Math.max(0, MIN_RECORDS - custBefore));
    const customers = await tx.customer.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Customer contacts ---
    const contactBefore = await tx.customerContact.count({
      where: { customer: { companyId: cid } },
    });
    for (let i = contactBefore; i < MIN_RECORDS; i++) {
      await tx.customerContact.create({
        data: {
          customerId: customers[i % customers.length].id,
          name: `Contact Person ${i + 1}`,
          title: i % 2 === 0 ? 'Purchasing Manager' : 'Store Owner',
          email: `contact${i + 1}@demo.local`,
          phone: `+2547${String(30000000 + i).slice(0, 8)}`,
          isPrimary: i % customers.length === 0,
        },
      });
    }
    track('customerContacts', contactBefore, Math.max(0, MIN_RECORDS - contactBefore));

    // --- Machines ---
    const mchBefore = await tx.machine.count({ where: { companyId: cid } });
    for (let i = mchBefore; i < MIN_RECORDS; i++) {
      await tx.machine.create({
        data: {
          companyId: cid,
          code: `MCH-D${padNum(i + 1)}`,
          name: `Demo Machine ${i + 1}`,
          type: i % 2 === 0 ? 'Assembly' : 'Press',
          capacity: `${200 + i * 50} units/day`,
          location: `Floor ${String.fromCharCode(65 + (i % 3))}`,
        },
      });
    }
    track('machines', mchBefore, Math.max(0, MIN_RECORDS - mchBefore));
    const machines = await tx.machine.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Employees ---
    const empBefore = await tx.employee.count({ where: { companyId: cid } });
    const deptIds = departments.map((d) => d.id);
    for (let i = empBefore; i < MIN_RECORDS; i++) {
      await tx.employee.create({
        data: {
          companyId: cid,
          employeeNo: `EMP-D${padNum(i + 1)}`,
          firstName: `Employee${i + 1}`,
          lastName: 'Demo',
          email: `employee${i + 1}@demo.local`,
          departmentId: deptIds[i % deptIds.length],
          branchId: branch.id,
          position: ['Operator', 'Sales Rep', 'Accountant', 'Driver', 'QC Inspector'][i % 5],
          hireDate: subDays(new Date(), 365 + i * 30),
          salary: 45000 + i * 5000,
        },
      });
    }
    track('employees', empBefore, Math.max(0, MIN_RECORDS - empBefore));
    const employees = await tx.employee.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Demo team users ---
    const userBefore = await tx.user.count({ where: { companyId: cid, deletedAt: null } });
    const roleNames = [
      'Sales Officer',
      'Finance Officer',
      'Warehouse Officer',
      'Production Manager',
      'Procurement Officer',
      'HR',
      'Customer Service',
      'Logistics & Delivery',
      'Accountant',
      'Operations Manager',
    ];
    const roles = await tx.role.findMany({ where: { name: { in: roleNames } } });
    const roleMap = new Map(roles.map((r) => [r.name, r.id]));
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

    for (let i = userBefore; i < MIN_RECORDS; i++) {
      const roleName = roleNames[i % roleNames.length];
      const roleId = roleMap.get(roleName);
      if (!roleId) continue;
      const deptMap: Record<string, string> = {
        'Finance Officer': 'Finance',
        Accountant: 'Finance',
        'Production Manager': 'Production',
        'Procurement Officer': 'Procurement',
        'Warehouse Officer': 'Warehouse',
        'Sales Officer': 'Sales',
        HR: 'HR',
        'Logistics & Delivery': 'Warehouse',
        'Operations Manager': 'Management',
        'Customer Service': 'Sales',
      };
      await tx.user.create({
        data: {
          companyId: cid,
          email: `demo.user${i + 1}@${company.slug}.local`,
          passwordHash,
          firstName: 'Demo',
          lastName: `User ${i + 1}`,
          roleId,
          departmentId: deptByName(deptMap[roleName] || 'Management'),
          branchId: branch.id,
          status: 'ACTIVE',
        },
      });
    }
    track('users', userBefore, Math.max(0, MIN_RECORDS - userBefore));

    // --- Vehicles ---
    const vehBefore = await tx.vehicle.count({ where: { companyId: cid } });
    for (let i = vehBefore; i < MIN_RECORDS; i++) {
      await tx.vehicle.create({
        data: {
          companyId: cid,
          registration: `KDA ${100 + i}${String.fromCharCode(65 + (i % 26))}`,
          type: VEHICLE_TYPES[i % VEHICLE_TYPES.length],
          make: ['Isuzu', 'Toyota', 'Bajaj', 'Scania', 'Mitsubishi'][i % 5],
          model: `Model-${i + 1}`,
          capacity: `${1 + (i % 5)} tons`,
        },
      });
    }
    track('vehicles', vehBefore, Math.max(0, MIN_RECORDS - vehBefore));
    const vehicles = await tx.vehicle.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Sales quotations ---
    const quoteBefore = await tx.salesQuotation.count({ where: { companyId: cid } });
    for (let i = quoteBefore; i < MIN_RECORDS; i++) {
      const customer = customers[i % customers.length];
      const product = products[i % products.length];
      const qty = 20 + i * 5;
      const subtotal = qty * Number(product.sellingPrice);
      const taxAmount = subtotal * (vatRate / 100);
      await tx.salesQuotation.create({
        data: {
          companyId: cid,
          quotationNo: `QT-D${padNum(i + 1, 5)}`,
          customerId: customer.id,
          status: (['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const)[i % 4],
          validUntil: subDays(new Date(), -14 - i),
          subtotal,
          taxAmount,
          totalAmount: subtotal + taxAmount,
          items: {
            create: [{ productId: product.id, quantity: qty, unitPrice: product.sellingPrice, totalPrice: subtotal }],
          },
        },
      });
    }
    track('salesQuotations', quoteBefore, Math.max(0, MIN_RECORDS - quoteBefore));

    // --- Sales orders ---
    const soBefore = await tx.salesOrder.count({ where: { companyId: cid } });
    for (let i = soBefore; i < MIN_RECORDS; i++) {
      const customer = customers[i % customers.length];
      const product = products[i % products.length];
      const qty = 15 + i * 8;
      const subtotal = qty * Number(product.sellingPrice);
      const taxAmount = subtotal * (vatRate / 100);
      await tx.salesOrder.create({
        data: {
          companyId: cid,
          orderNumber: yearCode('SO-D', i + 1),
          customerId: customer.id,
          createdById: adminUser.id,
          orderDate: subDays(new Date(), i * 2),
          status: ORDER_STATUSES[i % ORDER_STATUSES.length],
          subtotal,
          taxAmount,
          totalAmount: subtotal + taxAmount,
          items: {
            create: [{ productId: product.id, quantity: qty, unitPrice: product.sellingPrice, totalPrice: subtotal }],
          },
        },
      });
    }
    track('salesOrders', soBefore, Math.max(0, MIN_RECORDS - soBefore));
    const salesOrders = await tx.salesOrder.findMany({
      where: { companyId: cid },
      include: { items: true },
      take: MIN_RECORDS,
    });

    // --- Production orders ---
    const poProdBefore = await tx.productionOrder.count({ where: { companyId: cid } });
    for (let i = poProdBefore; i < MIN_RECORDS; i++) {
      await tx.productionOrder.create({
        data: {
          companyId: cid,
          orderNumber: yearCode('PROD-D', i + 1),
          productId: products[i % products.length].id,
          machineId: machines[i % machines.length]?.id,
          salesOrderId: salesOrders[i % salesOrders.length]?.id,
          quantity: 100 + i * 25,
          completedQty: i * 20,
          status: PROD_STATUSES[i % PROD_STATUSES.length],
          scheduledStart: subDays(new Date(), 10 - i),
        },
      });
    }
    track('productionOrders', poProdBefore, Math.max(0, MIN_RECORDS - poProdBefore));
    const productionOrders = await tx.productionOrder.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Purchase requisitions ---
    const prBefore = await tx.purchaseRequisition.count({ where: { companyId: cid } });
    for (let i = prBefore; i < MIN_RECORDS; i++) {
      const material = materials[i % materials.length];
      await tx.purchaseRequisition.create({
        data: {
          companyId: cid,
          requisitionNo: yearCode('PR-D', i + 1),
          requestedById: adminUser.id,
          department: departments[i % departments.length]?.name || 'Procurement',
          status: (['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] as const)[i % 4],
          items: {
            create: [{
              rawMaterialId: material.id,
              description: `Restock ${material.name}`,
              quantity: 100 + i * 10,
              unit: 'pcs',
              estimatedCost: Number(material.unitCost) * (100 + i * 10),
            }],
          },
        },
      });
    }
    track('purchaseRequisitions', prBefore, Math.max(0, MIN_RECORDS - prBefore));

    // --- RFQs ---
    const rfqBefore = await tx.requestForQuotation.count({ where: { companyId: cid } });
    for (let i = rfqBefore; i < MIN_RECORDS; i++) {
      await tx.requestForQuotation.create({
        data: {
          companyId: cid,
          rfqNo: yearCode('RFQ-D', i + 1),
          status: (['PENDING', 'APPROVED', 'REJECTED'] as const)[i % 3],
          dueDate: subDays(new Date(), -7 - i),
          notes: `Demo RFQ ${i + 1}`,
        },
      });
    }
    track('requestForQuotations', rfqBefore, Math.max(0, MIN_RECORDS - rfqBefore));

    // --- Purchase orders ---
    const poBefore = await tx.purchaseOrder.count({ where: { companyId: cid } });
    for (let i = poBefore; i < MIN_RECORDS; i++) {
      const supplier = suppliers[i % suppliers.length];
      const material = materials[i % materials.length];
      const qty = 50 + i * 10;
      const unitPrice = Number(material.unitCost);
      const subtotal = qty * unitPrice;
      const taxAmount = subtotal * (vatRate / 100);
      await tx.purchaseOrder.create({
        data: {
          companyId: cid,
          poNumber: yearCode('PO-D', i + 1),
          supplierId: supplier.id,
          status: (['PENDING', 'CONFIRMED', 'COMPLETED'] as const)[i % 3],
          subtotal,
          taxAmount,
          totalAmount: subtotal + taxAmount,
          items: {
            create: [{
              rawMaterialId: material.id,
              description: material.name,
              quantity: qty,
              unitPrice,
              totalPrice: subtotal,
            }],
          },
        },
      });
    }
    track('purchaseOrders', poBefore, Math.max(0, MIN_RECORDS - poBefore));
    const purchaseOrders = await tx.purchaseOrder.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Goods receipts ---
    const grBefore = await tx.goodsReceipt.count({ where: { companyId: cid } });
    for (let i = grBefore; i < MIN_RECORDS; i++) {
      const po = purchaseOrders[i % purchaseOrders.length];
      const supplier = suppliers[i % suppliers.length];
      await tx.goodsReceipt.create({
        data: {
          companyId: cid,
          grnNumber: yearCode('GRN-D', i + 1),
          purchaseOrderId: po?.id,
          supplierId: supplier.id,
          warehouseId: rawWh!.id,
          receiptDate: subDays(new Date(), i),
          status: (['PENDING', 'APPROVED'] as const)[i % 2],
          items: {
            create: [{
              rawMaterialId: materials[i % materials.length].id,
              quantity: 50 + i * 5,
              unitCost: materials[i % materials.length].unitCost,
            }],
          },
        },
      });
    }
    track('goodsReceipts', grBefore, Math.max(0, MIN_RECORDS - grBefore));
    const goodsReceipts = await tx.goodsReceipt.findMany({ where: { companyId: cid }, take: MIN_RECORDS });

    // --- Sales invoices ---
    const invBefore = await tx.invoice.count({ where: { companyId: cid, type: 'SALES' } });
    for (let i = invBefore; i < MIN_RECORDS; i++) {
      const customer = customers[i % customers.length];
      const product = products[i % products.length];
      const order = salesOrders[i % salesOrders.length];
      const qty = 10 + i * 5;
      const subtotal = qty * Number(product.sellingPrice);
      const taxAmount = subtotal * (vatRate / 100);
      await tx.invoice.create({
        data: {
          companyId: cid,
          invoiceNumber: yearCode('INV-S-D', i + 1),
          type: 'SALES',
          customerId: customer.id,
          salesOrderId: order?.id,
          invoiceDate: subDays(new Date(), i * 3),
          dueDate: subDays(new Date(), -30 + i),
          subtotal,
          taxAmount,
          totalAmount: subtotal + taxAmount,
          status: (['UNPAID', 'PAID', 'OVERDUE', 'PARTIAL'] as const)[i % 4],
          items: {
            create: [{
              description: `${product.name} x ${qty}`,
              quantity: qty,
              unitPrice: product.sellingPrice,
              taxRate: vatRate,
              totalPrice: subtotal,
            }],
          },
        },
      });
    }
    track('salesInvoices', invBefore, Math.max(0, MIN_RECORDS - invBefore));

    // --- Purchase invoices ---
    const pinvBefore = await tx.invoice.count({ where: { companyId: cid, type: 'PURCHASE' } });
    for (let i = pinvBefore; i < MIN_RECORDS; i++) {
      const supplier = suppliers[i % suppliers.length];
      const amount = 15000 + i * 2500;
      const taxAmount = amount * (vatRate / 100);
      await tx.invoice.create({
        data: {
          companyId: cid,
          invoiceNumber: yearCode('INV-P-D', i + 1),
          type: 'PURCHASE',
          supplierId: supplier.id,
          purchaseOrderId: purchaseOrders[i % purchaseOrders.length]?.id,
          invoiceDate: subDays(new Date(), i * 4),
          subtotal: amount,
          taxAmount,
          totalAmount: amount + taxAmount,
          status: i % 2 === 0 ? 'PAID' : 'UNPAID',
          items: {
            create: [{
              description: `Supplier invoice ${i + 1}`,
              quantity: 1,
              unitPrice: amount,
              taxRate: vatRate,
              totalPrice: amount,
            }],
          },
        },
      });
    }
    track('purchaseInvoices', pinvBefore, Math.max(0, MIN_RECORDS - pinvBefore));

    const salesInvoices = await tx.invoice.findMany({
      where: { companyId: cid, type: 'SALES' },
      take: MIN_RECORDS,
    });

    // --- Payments ---
    const payBefore = await tx.payment.count({ where: { companyId: cid } });
    for (let i = payBefore; i < MIN_RECORDS; i++) {
      const invoice = salesInvoices[i % salesInvoices.length];
      if (!invoice) break;
      await tx.payment.create({
        data: {
          companyId: cid,
          paymentNumber: yearCode('PAY-D', i + 1),
          invoiceId: invoice.id,
          amount: Number(invoice.totalAmount) * (i % 2 === 0 ? 1 : 0.5),
          method: (['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE'] as const)[i % 4],
          paymentDate: subDays(new Date(), i),
          reference: `REF-DEMO-${i + 1}`,
        },
      });
    }
    track('payments', payBefore, Math.max(0, MIN_RECORDS - payBefore));

    // --- Journal entries ---
    const cashAccount = await tx.account.findFirst({ where: { companyId: cid, code: '1100' } });
    const revenueAccount = await tx.account.findFirst({ where: { companyId: cid, code: '4100' } });
    const jeBefore = await tx.journalEntry.count({ where: { companyId: cid } });
    if (cashAccount && revenueAccount) {
      for (let i = jeBefore; i < MIN_RECORDS; i++) {
        const amount = 5000 + i * 1000;
        await tx.journalEntry.create({
          data: {
            companyId: cid,
            entryNumber: yearCode('JE-D', i + 1),
            date: subDays(new Date(), i),
            description: `Demo journal entry ${i + 1}`,
            reference: `JE-REF-${i + 1}`,
            isPosted: true,
            lines: {
              create: [
                { accountId: cashAccount.id, debit: amount, credit: 0, description: 'Cash receipt' },
                { accountId: revenueAccount.id, debit: 0, credit: amount, description: 'Revenue' },
              ],
            },
          },
        });
      }
    }
    track('journalEntries', jeBefore, cashAccount && revenueAccount ? Math.max(0, MIN_RECORDS - jeBefore) : 0);

    // --- Delivery notes ---
    const dnBefore = await tx.deliveryNote.count({
      where: { salesOrder: { companyId: cid } },
    });
    for (let i = dnBefore; i < MIN_RECORDS; i++) {
      const order = salesOrders[i % salesOrders.length];
      if (!order?.items?.length) continue;
      const item = order.items[0];
      await tx.deliveryNote.create({
        data: {
          companyId: cid,
          deliveryNo: `DN-${company.slug.toUpperCase()}-${padNum(i + 1, 5)}`,
          salesOrderId: order.id,
          vehicleId: vehicles[i % vehicles.length]?.id,
          status: DELIVERY_STATUSES[i % DELIVERY_STATUSES.length],
          scheduledDate: subDays(new Date(), i),
          items: {
            create: [{ productId: item.productId, quantity: Math.min(item.quantity, 50) }],
          },
        },
      });
    }
    track('deliveryNotes', dnBefore, Math.max(0, MIN_RECORDS - dnBefore));

    // --- Quality inspections ---
    const qcBefore = await tx.qualityInspection.count({ where: { companyId: cid } });
    for (let i = qcBefore; i < MIN_RECORDS; i++) {
      await tx.qualityInspection.create({
        data: {
          companyId: cid,
          inspectionNo: `QC-${company.slug.toUpperCase()}-${padNum(i + 1, 5)}`,
          type: (['incoming', 'production', 'finished'] as const)[i % 3],
          goodsReceiptId: goodsReceipts[i % goodsReceipts.length]?.id,
          productionOrderId: productionOrders[i % productionOrders.length]?.id,
          inspectorId: adminUser.id,
          status: QC_STATUSES[i % QC_STATUSES.length],
          result: i % 4 === 0 ? 'Within tolerance' : undefined,
          defectsFound: i % 5,
          inspectedAt: i % 2 === 0 ? subDays(new Date(), i) : undefined,
        },
      });
    }
    track('qualityInspections', qcBefore, Math.max(0, MIN_RECORDS - qcBefore));

    // --- CRM ---
    const oppBefore = await tx.opportunity.count({ where: { customer: { companyId: cid } } });
    for (let i = oppBefore; i < MIN_RECORDS; i++) {
      await tx.opportunity.create({
        data: {
          companyId: cid,
          customerId: customers[i % customers.length].id,
          title: `Demo Opportunity ${i + 1}`,
          value: 100000 + i * 75000,
          stage: ['prospecting', 'proposal', 'negotiation', 'closed'][i % 4],
          probability: 20 + i * 7,
          status: (['PENDING', 'APPROVED'] as const)[i % 2],
        },
      });
    }
    track('opportunities', oppBefore, Math.max(0, MIN_RECORDS - oppBefore));

    const compBefore = await tx.complaint.count({ where: { customer: { companyId: cid } } });
    for (let i = compBefore; i < MIN_RECORDS; i++) {
      await tx.complaint.create({
        data: {
          companyId: cid,
          customerId: customers[i % customers.length].id,
          subject: `Demo Complaint ${i + 1}`,
          description: `Sample complaint description for testing #${i + 1}.`,
          priority: (['low', 'medium', 'high'] as const)[i % 3],
          status: (['PENDING', 'APPROVED', 'REJECTED'] as const)[i % 3],
        },
      });
    }
    track('complaints', compBefore, Math.max(0, MIN_RECORDS - compBefore));

    const warBefore = await tx.warranty.count({ where: { customer: { companyId: cid } } });
    for (let i = warBefore; i < MIN_RECORDS; i++) {
      await tx.warranty.create({
        data: {
          customerId: customers[i % customers.length].id,
          productId: products[i % products.length].id,
          serialNumber: `SN-D${padNum(i + 1, 5)}`,
          startDate: subDays(new Date(), 30 + i),
          endDate: subDays(new Date(), -335 + i),
        },
      });
    }
    track('warranties', warBefore, Math.max(0, MIN_RECORDS - warBefore));

    // --- HR ---
    const leaveBefore = await tx.leaveRequest.count({
      where: { employee: { companyId: cid } },
    });
    for (let i = leaveBefore; i < MIN_RECORDS; i++) {
      const emp = employees[i % employees.length];
      await tx.leaveRequest.create({
        data: {
          employeeId: emp.id,
          type: (['Annual', 'Sick', 'Maternity', 'Unpaid'] as const)[i % 4],
          startDate: subDays(new Date(), 10 + i),
          endDate: subDays(new Date(), 8 + i),
          reason: `Demo leave request ${i + 1}`,
          status: (['PENDING', 'APPROVED', 'REJECTED'] as const)[i % 3],
        },
      });
    }
    track('leaveRequests', leaveBefore, Math.max(0, MIN_RECORDS - leaveBefore));

    const attBefore = await tx.attendance.count({ where: { employee: { companyId: cid } } });
    for (let i = attBefore; i < MIN_RECORDS; i++) {
      const emp = employees[i % employees.length];
      const date = subDays(new Date(), i);
      date.setHours(0, 0, 0, 0);
      await tx.attendance.upsert({
        where: { employeeId_date: { employeeId: emp.id, date } },
        update: {},
        create: {
          employeeId: emp.id,
          date,
          checkIn: subDays(new Date(), i),
          status: i % 5 === 0 ? 'late' : 'present',
        },
      });
    }
    track('attendance', attBefore, Math.max(0, MIN_RECORDS - attBefore));

    // --- Maintenance ---
    const maintBefore = await tx.maintenanceRequest.count({
      where: { machine: { companyId: cid } },
    });
    for (let i = maintBefore; i < MIN_RECORDS; i++) {
      await tx.maintenanceRequest.create({
        data: {
          machineId: machines[i % machines.length].id,
          type: (['Preventive', 'Corrective', 'Inspection'] as const)[i % 3],
          description: `Demo maintenance request ${i + 1} for testing.`,
          status: (['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const)[i % 3],
          scheduledDate: subDays(new Date(), i * 2),
          cost: 5000 + i * 500,
        },
      });
    }
    track('maintenanceRequests', maintBefore, Math.max(0, MIN_RECORDS - maintBefore));

    // --- Inventory transactions ---
    const invTxBefore = await tx.inventoryTransaction.count({
      where: { warehouse: { companyId: cid } },
    });
    for (let i = invTxBefore; i < MIN_RECORDS; i++) {
      const product = products[i % products.length];
      await tx.inventoryTransaction.create({
        data: {
          warehouseId: fgWh!.id,
          type: (['RECEIPT', 'ISSUE', 'ADJUSTMENT'] as const)[i % 3],
          productId: product.id,
          quantity: 10 + i * 3,
          unitCost: product.manufacturingCost,
          notes: `Demo inventory movement ${i + 1}`,
          createdById: adminUser.id,
        },
      });
    }
    track('inventoryTransactions', invTxBefore, Math.max(0, MIN_RECORDS - invTxBefore));

    // --- Bank statements ---
    const bsBefore = await tx.bankStatement.count({ where: { companyId: cid } });
    for (let i = bsBefore; i < MIN_RECORDS; i++) {
      const start = subDays(new Date(), 30 + i * 5);
      const end = subDays(new Date(), 25 + i * 5);
      await tx.bankStatement.create({
        data: {
          companyId: cid,
          statementNumber: yearCode('BST-D', i + 1),
          bankAccountCode: '1100',
          periodStart: start,
          periodEnd: end,
          openingBalance: 100000 + i * 10000,
          closingBalance: 120000 + i * 12000,
          lines: {
            create: [
              {
                transactionDate: subDays(end, 2),
                description: `Demo deposit ${i + 1}`,
                reference: `DEP-${i + 1}`,
                amount: 5000 + i * 500,
              },
              {
                transactionDate: subDays(end, 1),
                description: `Demo withdrawal ${i + 1}`,
                reference: `WTH-${i + 1}`,
                amount: -(2000 + i * 200),
              },
            ],
          },
        },
      });
    }
    track('bankStatements', bsBefore, Math.max(0, MIN_RECORDS - bsBefore));

    // --- M-Pesa ---
    const mpesaBefore = await tx.mpesaTransaction.count({ where: { companyId: cid } });
    for (let i = mpesaBefore; i < MIN_RECORDS; i++) {
      await tx.mpesaTransaction.create({
        data: {
          companyId: cid,
          phone: `2547${String(40000000 + i).slice(0, 8)}`,
          amount: 1000 + i * 250,
          mpesaReceiptNumber: `MPX-D${padNum(i + 1, 8)}`,
          status: i % 3 === 0 ? 'PENDING' : 'SUCCESS',
        },
      });
    }
    track('mpesaTransactions', mpesaBefore, Math.max(0, MIN_RECORDS - mpesaBefore));

    // --- Sales targets ---
    const targetBefore = await tx.salesTarget.count({ where: { companyId: cid } });
    const year = new Date().getFullYear();
    let targetsAdded = 0;
    for (let i = 0; targetsAdded < Math.max(0, MIN_RECORDS - targetBefore); i++) {
      const month = ((i % 12) + 1);
      const existing = await tx.salesTarget.findFirst({
        where: { companyId: cid, salesPersonId: adminUser.id, year, month },
      });
      if (existing) continue;
      await tx.salesTarget.create({
        data: {
          companyId: cid,
          salesPersonId: adminUser.id,
          year,
          month,
          targetAmount: 500000 + targetsAdded * 100000,
        },
      });
      targetsAdded += 1;
    }
    track('salesTargets', targetBefore, targetsAdded);

    // --- Notifications ---
    const notifBefore = await tx.notification.count({ where: { companyId: cid } });
    for (let i = notifBefore; i < MIN_RECORDS; i++) {
      await tx.notification.create({
        data: {
          companyId: cid,
          userId: adminUser.id,
          type: (['SYSTEM', 'APPROVAL', 'LOW_STOCK', 'MAINTENANCE'] as const)[i % 4],
          title: `Demo notification ${i + 1}`,
          message: `Test notification message #${i + 1} for module testing.`,
          link: ['/inventory', '/sales', '/finance', '/delivery'][i % 4],
          isRead: i % 3 === 0,
        },
      });
    }
    track('notifications', notifBefore, Math.max(0, MIN_RECORDS - notifBefore));

    // --- Audit logs ---
    const auditBefore = await tx.auditLog.count({ where: { companyId: cid } });
    for (let i = auditBefore; i < MIN_RECORDS; i++) {
      await tx.auditLog.create({
        data: {
          companyId: cid,
          userId: adminUser.id,
          action: (['create', 'update', 'delete'] as const)[i % 3],
          module: ['products', 'sales', 'inventory', 'finance'][i % 4],
          entityType: ['product', 'sales_order', 'invoice', 'customer'][i % 4],
          entityId: products[i % products.length].id,
          newValues: { demo: true, index: i + 1 },
          ipAddress: '127.0.0.1',
        },
      });
    }
    track('auditLogs', auditBefore, Math.max(0, MIN_RECORDS - auditBefore));

    // --- Supplier contracts ---
    const contractBefore = await tx.supplierContract.count({
      where: { supplier: { companyId: cid } },
    });
    for (let i = contractBefore; i < MIN_RECORDS; i++) {
      await tx.supplierContract.create({
        data: {
          supplierId: suppliers[i % suppliers.length].id,
          title: `Demo Supply Contract ${i + 1}`,
          startDate: subDays(new Date(), 180 + i * 10),
          endDate: subDays(new Date(), -180 + i * 10),
          terms: `Standard supply terms for demo contract ${i + 1}.`,
          isActive: i % 3 !== 2,
        },
      });
    }
    track('supplierContracts', contractBefore, Math.max(0, MIN_RECORDS - contractBefore));

    // --- Delivery trips ---
    const tripBefore = await tx.deliveryTrip.count({ where: { companyId: cid } });
    const driverUser = await tx.user.findFirst({
      where: {
        companyId: cid,
        role: { name: { in: ['Logistics & Delivery', 'Driver'] } },
        deletedAt: null,
      },
    });
    for (let i = tripBefore; i < MIN_RECORDS; i++) {
      await tx.deliveryTrip.create({
        data: {
          companyId: cid,
          tripNo: `TRIP-D${padNum(i + 1, 5)}`,
          vehicleId: vehicles[i % vehicles.length]?.id,
          driverId: driverUser?.id,
          status: DELIVERY_STATUSES[i % DELIVERY_STATUSES.length],
          scheduledDate: subDays(new Date(), i),
          notes: `Demo delivery trip ${i + 1}`,
        },
      });
    }
    track('deliveryTrips', tripBefore, Math.max(0, MIN_RECORDS - tripBefore));

    // --- Payroll records ---
    const payrollBefore = await tx.payrollRecord.count({
      where: { employee: { companyId: cid } },
    });
    for (let i = payrollBefore; i < MIN_RECORDS; i++) {
      const emp = employees[i % employees.length];
      const periodStart = subDays(new Date(), 30 + i * 30);
      const periodEnd = subDays(new Date(), i * 30 + 1);
      const basic = Number(emp.salary);
      await tx.payrollRecord.create({
        data: {
          employeeId: emp.id,
          periodStart,
          periodEnd,
          basicSalary: basic,
          allowances: basic * 0.1,
          paye: basic * 0.15,
          nssf: 1080,
          shif: 500,
          housingLevy: basic * 0.015,
          netPay: basic * 0.75,
          isPaid: i % 3 === 2,
          paidAt: i % 3 === 2 ? subDays(new Date(), i) : undefined,
        },
      });
    }
    track('payrollRecords', payrollBefore, Math.max(0, MIN_RECORDS - payrollBefore));

    // --- Salary advances ---
    const advBefore = await tx.salaryAdvance.count({ where: { companyId: cid } });
    for (let i = advBefore; i < Math.min(MIN_RECORDS, 6); i++) {
      const emp = employees[i % employees.length];
      const amount = 10000 + i * 2500;
      const monthly = Math.round(amount / (3 + (i % 3)));
      const repaid = i % 3 === 0 ? monthly : i % 3 === 1 ? 0 : monthly * 2;
      const remaining = Math.max(0, amount - repaid);
      const status =
        i % 5 === 0 ? 'PENDING' : remaining <= 0 ? 'COMPLETED' : 'ACTIVE';
      const advance = await tx.salaryAdvance.create({
        data: {
          companyId: cid,
          employeeId: emp.id,
          advanceNo: yearCode('ADV-D', i + 1),
          amount,
          monthlyDeduction: monthly,
          remainingBalance: status === 'PENDING' ? amount : remaining,
          totalRepaid: status === 'PENDING' ? 0 : repaid,
          installments: Math.ceil(amount / monthly),
          reason: 'Demo salary advance for testing monthly recovery',
          status,
          deductionStartDate: subDays(new Date(), 60),
          approvedAt: status === 'PENDING' ? undefined : subDays(new Date(), 45),
          disbursedAt: status === 'PENDING' ? undefined : subDays(new Date(), 45),
        },
      });
      if (status !== 'PENDING' && repaid > 0) {
        await tx.salaryAdvanceRepayment.create({
          data: {
            companyId: cid,
            advanceId: advance.id,
            amount: repaid,
            method: 'PAYROLL',
            isApplied: true,
            paidAt: subDays(new Date(), 15),
            notes: 'Demo payroll recovery',
          },
        });
      }
    }
    track('salaryAdvances', advBefore, Math.max(0, Math.min(MIN_RECORDS, 6) - advBefore));
  }, { timeout: 300_000 });

  return summary;
}
