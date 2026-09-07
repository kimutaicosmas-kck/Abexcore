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

    let rmWarehouse = await prisma.warehouse.findFirst({
      where: { companyId, deletedAt: null, isActive: true, type: 'raw_materials' },
      select: { id: true },
    });
    if (!rmWarehouse) {
      rmWarehouse = await prisma.warehouse.create({
        data: {
          companyId,
          branchId: branch.id,
          code: 'WH-RM',
          name: 'Raw Materials',
          type: 'raw_materials',
          isActive: true,
        },
        select: { id: true },
      });
    }

    let fgWarehouse = await prisma.warehouse.findFirst({
      where: { companyId, deletedAt: null, isActive: true, type: 'finished_goods' },
      select: { id: true },
    });
    if (!fgWarehouse) {
      fgWarehouse = await prisma.warehouse.create({
        data: {
          companyId,
          branchId: branch.id,
          code: 'WH-FG',
          name: 'Finished Goods',
          type: 'finished_goods',
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

    let material = await prisma.rawMaterial.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      select: { id: true, unitCost: true },
    });
    if (!material) {
      material = await prisma.rawMaterial.create({
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
        select: { id: true, unitCost: true },
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

    let product = await prisma.product.findFirst({
      where: { companyId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, manufacturingCost: true },
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
      product = await prisma.product.create({
        data: injectTenantData({
          sku: 'SKU-TEST-001',
          name: 'Test Product',
          categoryId: category.id,
          sellingPrice: 100,
          manufacturingCost: 50,
          isActive: true,
        }),
        select: { id: true, manufacturingCost: true },
      });
    }

    const bom = await prisma.billOfMaterial.findUnique({
      where: { productId: product.id },
      include: { items: true },
    });
    if (!bom) {
      await prisma.billOfMaterial.create({
        data: {
          productId: product.id,
          version: '1.0',
          isActive: true,
          items: {
            create: [{ rawMaterialId: material.id, quantity: 1, unit: 'pcs' }],
          },
        },
      });
    } else {
      if (!bom.isActive) {
        await prisma.billOfMaterial.update({
          where: { id: bom.id },
          data: { isActive: true },
        });
      }
      if (bom.items.length === 0) {
        await prisma.billOfMaterialItem.create({
          data: {
            bomId: bom.id,
            rawMaterialId: material.id,
            quantity: 1,
            unit: 'pcs',
          },
        });
      }
    }

    const rmStock = await prisma.stockLevel.findFirst({
      where: { warehouseId: rmWarehouse.id, rawMaterialId: material.id },
    });
    if (!rmStock) {
      await prisma.stockLevel.create({
        data: {
          warehouseId: rmWarehouse.id,
          rawMaterialId: material.id,
          quantity: 10000,
          unitCost: material.unitCost,
        },
      });
    } else if (Number(rmStock.quantity) < 100) {
      await prisma.stockLevel.update({
        where: { id: rmStock.id },
        data: { quantity: 10000 },
      });
    }

    const fgStock = await prisma.stockLevel.findFirst({
      where: { warehouseId: fgWarehouse.id, productId: product.id },
    });
    if (!fgStock) {
      await prisma.stockLevel.create({
        data: {
          warehouseId: fgWarehouse.id,
          productId: product.id,
          quantity: 500,
          unitCost: product.manufacturingCost,
        },
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

    void rmWarehouse;
    void fgWarehouse;
  });
}
