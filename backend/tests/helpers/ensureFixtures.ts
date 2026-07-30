import jwt from 'jsonwebtoken';
import prisma from '../../src/config/database';
import { config } from '../../src/config';
import { injectTenantData, runWithTenant } from '../../src/utils/tenant';

/**
 * Ensure catalog fixtures exist for workflow integration tests.
 * Self-heals when seed/demo data was purged (validation CF-02).
 */
export async function ensureWorkflowFixtures(accessToken: string): Promise<void> {
  const decoded = jwt.verify(accessToken, config.jwt.secret) as {
    userId: string;
    companyId?: string;
  };

  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: { companyId: true },
  });
  const companyId = decoded.companyId || user?.companyId;
  if (!companyId) {
    throw new Error('Cannot resolve companyId for workflow fixtures');
  }

  await runWithTenant({ companyId }, async () => {
    let branch = await prisma.branch.findFirst({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    if (!branch) {
      branch = await prisma.branch.create({
        data: {
          companyId,
          name: 'Test HQ',
          code: 'HQ-TEST',
          isActive: true,
        },
        select: { id: true },
      });
    }

    let warehouse = await prisma.warehouse.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!warehouse) {
      warehouse = await prisma.warehouse.create({
        data: {
          companyId,
          branchId: branch.id,
          code: 'WH-TEST',
          name: 'Test Warehouse',
          type: 'general',
          isActive: true,
        },
        select: { id: true },
      });
    }

    let supplier = await prisma.supplier.findFirst({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: injectTenantData({
          code: 'SUP-TEST',
          name: 'Test Supplier',
          isActive: true,
        }),
        select: { id: true },
      });
    }

    let materialType = await prisma.materialType.findFirst({
      where: { companyId, isActive: true },
      select: { id: true },
    });
    if (!materialType) {
      materialType = await prisma.materialType.create({
        data: injectTenantData({
          name: 'Test Material Type',
          isActive: true,
          sortOrder: 0,
        }),
        select: { id: true },
      });
    }

    const material = await prisma.rawMaterial.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!material) {
      await prisma.rawMaterial.create({
        data: injectTenantData({
          code: 'RM-TEST',
          name: 'Test Raw Material',
          typeId: materialType.id,
          unit: 'pcs',
          unitCost: 10,
          supplierId: supplier.id,
          minStockLevel: 1,
          reorderQty: 10,
          isActive: true,
        }),
      });
    }

    const machine = await prisma.machine.findFirst({
      where: { companyId, isActive: true },
      select: { id: true },
    });
    if (!machine) {
      await prisma.machine.create({
        data: injectTenantData({
          code: 'MCH-TEST',
          name: 'Test Machine',
          type: 'Assembly',
          capacity: '100/day',
          location: 'Test Floor',
          isActive: true,
        }),
      });
    }

    const product = await prisma.product.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!product) {
      let category = await prisma.productCategory.findFirst({
        where: { companyId, isActive: true },
        select: { id: true },
      });
      if (!category) {
        category = await prisma.productCategory.create({
          data: injectTenantData({
            name: 'Test Category',
            isActive: true,
            sortOrder: 0,
          }),
          select: { id: true },
        });
      }
      await prisma.product.create({
        data: injectTenantData({
          sku: 'SKU-TEST-001',
          name: 'Test Product',
          categoryId: category.id,
          sellingPrice: 100,
          manufacturingCost: 50,
          isActive: true,
        }),
      });
    }

    const customer = await prisma.customer.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!customer) {
      await prisma.customer.create({
        data: injectTenantData({
          code: 'CUST-TEST',
          name: 'Test Customer',
          type: 'DEALER',
          isActive: true,
        }),
      });
    }

    void warehouse;
  });
}
