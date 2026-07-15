import prisma from '../config/database';

export class ProductService {
  static async getStats() {
    const [total, active, withBom, categoryCounts, totalStock] = await Promise.all([
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.product.count({ where: { deletedAt: null, isActive: true } }),
      prisma.billOfMaterial.count(),
      prisma.product.groupBy({
        by: ['category'],
        where: { deletedAt: null },
        _count: { id: true },
      }),
      prisma.stockLevel.aggregate({
        where: { productId: { not: null } },
        _sum: { quantity: true },
      }),
    ]);

    return {
      total,
      active,
      inactive: total - active,
      withBom,
      withoutBom: total - withBom,
      finishedGoodsQty: Number(totalStock._sum.quantity || 0),
      byCategory: categoryCounts.map((c) => ({
        category: c.category,
        count: c._count.id,
      })),
    };
  }
}

export class InventoryService {
  static async getStats() {
    const materials = await prisma.rawMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      include: { stockLevels: true },
    });

    const lowStock = materials.filter((m) => {
      const total = m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      return total <= Number(m.minStockLevel);
    });

    const stockLevels = await prisma.stockLevel.findMany({
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
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
    ]);

    return {
      materialsCount,
      warehouses,
      lowStockCount: lowStock.length,
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
