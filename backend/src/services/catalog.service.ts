import prisma from '../config/database';
import { mergeTenantWarehouseWhere, requireTenantId } from '../utils/tenant';
import { isLowStock, sumStockQuantities } from '../utils/stock';

export class ProductService {
  static async getStats() {
    const [total, active, categoryCounts, totalStock] = await Promise.all([
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.product.count({ where: { deletedAt: null, isActive: true } }),
      prisma.product.groupBy({
        by: ['categoryId'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      prisma.stockLevel.aggregate({
        where: mergeTenantWarehouseWhere({ productId: { not: null } }),
        _sum: { quantity: true },
      }),
    ]);

    const categoryIds = categoryCounts.map((c) => c.categoryId);
    const categories = categoryIds.length
      ? await prisma.productCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [];
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    return {
      total,
      active,
      inactive: total - active,
      finishedGoodsQty: Number(totalStock._sum.quantity || 0),
      byCategory: categoryCounts.map((c) => ({
        categoryId: c.categoryId,
        category: categoryNameById.get(c.categoryId) || 'Uncategorized',
        count: c._count.id,
      })),
    };
  }
}

export class InventoryService {
  static async getStats() {
    const companyId = requireTenantId();
    const stockWhere = { warehouse: { companyId } };

    const [materials, products] = await Promise.all([
      prisma.rawMaterial.findMany({
        where: { isActive: true, deletedAt: null },
        include: { stockLevels: { where: stockWhere } },
      }),
      prisma.product.findMany({
        where: { isActive: true, deletedAt: null },
        include: { stockLevels: { where: stockWhere } },
      }),
    ]);

    const lowMaterials = materials.filter((m) =>
      isLowStock(sumStockQuantities(m.stockLevels), m.minStockLevel)
    );
    const lowProducts = products.filter((p) =>
      isLowStock(sumStockQuantities(p.stockLevels), p.minStockLevel)
    );

    const stockLevels = await prisma.stockLevel.findMany({
      where: mergeTenantWarehouseWhere(),
      include: { product: true, rawMaterial: true },
    });

    const inventoryValue = stockLevels.reduce(
      (sum, sl) => sum + Number(sl.quantity) * Number(sl.unitCost),
      0
    );

    const [warehouses, materialsCount, transfersToday] = await Promise.all([
      prisma.warehouse.count({ where: { isActive: true, deletedAt: null } }),
      prisma.rawMaterial.count({ where: { deletedAt: null, isActive: true } }),
      prisma.inventoryTransaction.count({
        where: mergeTenantWarehouseWhere({
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        }),
      }),
    ]);

    return {
      materialsCount,
      warehouses,
      lowStockCount: lowMaterials.length + lowProducts.length,
      inventoryValue,
      transfersToday,
    };
  }

  static async getProcurementStats() {
    const [
      pendingRequisitions,
      openRfqs,
      activePurchaseOrders,
      goodsReceiptsMonth,
      suppliers,
    ] = await Promise.all([
      prisma.purchaseRequisition.count({ where: { status: 'PENDING' } }),
      prisma.requestForQuotation.count({ where: { status: 'PENDING' } }),
      prisma.purchaseOrder.count({ where: { status: { in: ['PENDING', 'CONFIRMED'] } } }),
      prisma.goodsReceipt.count({
        where: {
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.supplier.count({ where: { isActive: true, deletedAt: null } }),
    ]);

    const poValue = await prisma.purchaseOrder.aggregate({
      where: { status: { in: ['PENDING', 'CONFIRMED'] } },
      _sum: { totalAmount: true },
    });

    return {
      pendingRequisitions,
      openRfqs,
      activePurchaseOrders,
      activePoValue: Number(poValue._sum.totalAmount || 0),
      goodsReceiptsMonth,
      suppliers,
    };
  }
}
