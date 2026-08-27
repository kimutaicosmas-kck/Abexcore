import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { injectTenantData } from '../utils/tenant';

type TxClient = Prisma.TransactionClient;

export class StockMovementService {
  static async getDefaultWarehouseId(tx: TxClient = prisma): Promise<string> {
    const warehouse = await tx.warehouse.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouse) throw new AppError('No active warehouse configured', 400);
    return warehouse.id;
  }

  static async getFinishedGoodsWarehouseId(tx: TxClient = prisma): Promise<string> {
    const warehouse = await tx.warehouse.findFirst({
      where: { isActive: true, deletedAt: null, type: 'finished_goods' },
      orderBy: { createdAt: 'asc' },
    });
    if (!warehouse) throw new AppError('No finished goods warehouse configured', 400);
    return warehouse.id;
  }

  /** Returns (and creates if missing) the tenant's raw materials warehouse. */
  static async getRawMaterialsWarehouseId(tx: TxClient = prisma): Promise<string> {
    const existing = await tx.warehouse.findFirst({
      where: { isActive: true, deletedAt: null, type: 'raw_materials' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    const branch = await tx.branch.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) {
      throw new AppError('No branch configured — cannot create raw materials warehouse', 400);
    }

    const created = await tx.warehouse.create({
      data: injectTenantData({
        code: 'WH-RM',
        name: 'Raw Materials Warehouse',
        type: 'raw_materials',
        isActive: true,
        branchId: branch.id,
      }),
    });
    return created.id;
  }

  /** Raw materials → raw_materials warehouse; finished products → finished_goods. */
  static async assertWarehouseMatchesItem(
    tx: TxClient,
    opts: { warehouseId: string; productId?: string | null; rawMaterialId?: string | null }
  ) {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: opts.warehouseId, isActive: true, deletedAt: null },
      select: { id: true, type: true, name: true, code: true },
    });
    if (!warehouse) throw new AppError('Warehouse not found', 404);

    if (opts.rawMaterialId && !opts.productId) {
      if (warehouse.type !== 'raw_materials') {
        throw new AppError(
          `Raw materials must be stocked in a raw materials warehouse (got ${warehouse.code} · ${warehouse.type})`,
          400
        );
      }
      return warehouse;
    }

    if (opts.productId && !opts.rawMaterialId) {
      if (warehouse.type !== 'finished_goods') {
        throw new AppError(
          `Finished products must be stocked in a finished goods warehouse (got ${warehouse.code} · ${warehouse.type})`,
          400
        );
      }
      return warehouse;
    }

    return warehouse;
  }

  static async reserveProductStock(
    tx: TxClient,
    opts: {
      productId: string;
      quantity: number;
      warehouseId?: string;
    }
  ) {
    const warehouseId = opts.warehouseId ?? (await this.getFinishedGoodsWarehouseId(tx));
    const qty = opts.quantity;

    const stock = await tx.stockLevel.findFirst({
      where: { warehouseId, productId: opts.productId },
    });

    const onHand = stock ? Number(stock.quantity) : 0;
    const reserved = stock ? Number(stock.reservedQty) : 0;
    const available = onHand - reserved;

    if (available < qty) {
      throw new AppError(
        `Insufficient stock to reserve (available: ${available}, required: ${qty})`,
        400
      );
    }

    if (!stock) {
      throw new AppError('No stock record found for product', 400);
    }

    await tx.stockLevel.update({
      where: { id: stock.id },
      data: { reservedQty: { increment: qty } },
    });
  }

  static async releaseProductReservation(
    tx: TxClient,
    opts: {
      productId: string;
      quantity: number;
      warehouseId?: string;
    }
  ) {
    const warehouseId = opts.warehouseId ?? (await this.getFinishedGoodsWarehouseId(tx));
    const stock = await tx.stockLevel.findFirst({
      where: { warehouseId, productId: opts.productId },
    });

    if (!stock) return;

    const releaseQty = Math.min(opts.quantity, Number(stock.reservedQty));
    if (releaseQty <= 0) return;

    await tx.stockLevel.update({
      where: { id: stock.id },
      data: { reservedQty: { decrement: releaseQty } },
    });
  }

  static async releaseSalesOrderReservations(
    tx: TxClient,
    _salesOrderId: string,
    items: { productId: string; quantity: number; deliveredQty?: number }[]
  ) {
    for (const item of items) {
      const remaining = item.quantity - (item.deliveredQty || 0);
      if (remaining <= 0) continue;
      await this.releaseProductReservation(tx, {
        productId: item.productId,
        quantity: remaining,
      });
    }
  }

  static async deductProductStock(
    tx: TxClient,
    opts: {
      productId: string;
      quantity: number;
      warehouseId?: string;
      referenceType: string;
      referenceId: string;
      userId?: string;
      notes?: string;
      releaseReservedQty?: number;
    }
  ) {
    const warehouseId = opts.warehouseId ?? (await this.getFinishedGoodsWarehouseId(tx));
    const qty = opts.quantity;

    const stock = await tx.stockLevel.findFirst({
      where: { warehouseId, productId: opts.productId },
    });

    const available = stock ? Number(stock.quantity) - Number(stock.reservedQty) : 0;
    if (available < qty) {
      throw new AppError(`Insufficient finished goods stock (available: ${available}, required: ${qty})`, 400);
    }

    if (stock) {
      const releaseQty = opts.releaseReservedQty
        ? Math.min(opts.releaseReservedQty, Number(stock.reservedQty))
        : 0;

      await tx.stockLevel.update({
        where: { id: stock.id },
        data: {
          quantity: { decrement: qty },
          ...(releaseQty > 0 ? { reservedQty: { decrement: releaseQty } } : {}),
        },
      });
    }

    await tx.inventoryTransaction.create({
      data: {
        warehouseId,
        type: 'ISSUE',
        productId: opts.productId,
        quantity: qty,
        unitCost: stock ? Number(stock.unitCost) : 0,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        notes: opts.notes,
        createdById: opts.userId,
      },
    });
  }

  static async addProductStock(
    tx: TxClient,
    opts: {
      productId: string;
      quantity: number;
      warehouseId?: string;
      referenceType: string;
      referenceId: string;
      userId?: string;
      unitCost?: number;
      notes?: string;
      transactionType?: 'PRODUCTION_OUTPUT' | 'RETURN' | 'ADJUSTMENT';
    }
  ) {
    const warehouseId = opts.warehouseId ?? (await this.getFinishedGoodsWarehouseId(tx));
    const existing = await tx.stockLevel.findFirst({
      where: { warehouseId, productId: opts.productId },
    });

    if (existing) {
      await tx.stockLevel.update({
        where: { id: existing.id },
        data: { quantity: { increment: opts.quantity } },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          warehouseId,
          productId: opts.productId,
          quantity: opts.quantity,
          unitCost: opts.unitCost ?? 0,
        },
      });
    }

    await tx.inventoryTransaction.create({
      data: {
        warehouseId,
        type: opts.transactionType ?? 'PRODUCTION_OUTPUT',
        productId: opts.productId,
        quantity: opts.quantity,
        unitCost: opts.unitCost ?? 0,
        referenceType: opts.referenceType,
        referenceId: opts.referenceId,
        notes: opts.notes,
        createdById: opts.userId,
      },
    });
  }

  static async postGoodsReceiptToStock(
    tx: TxClient,
    opts: {
      goodsReceiptId: string;
      warehouseId: string;
      items: {
        rawMaterialId?: string | null;
        batchNumber?: string | null;
        quantity: number;
        unitCost: number;
        expiryDate?: string | Date | null;
      }[];
      userId?: string;
    }
  ) {
    const hasRaw = opts.items.some((i) => i.rawMaterialId);
    if (hasRaw) {
      await this.assertWarehouseMatchesItem(tx, {
        warehouseId: opts.warehouseId,
        rawMaterialId: opts.items.find((i) => i.rawMaterialId)?.rawMaterialId,
      });
    }

    for (const item of opts.items) {
      const existing = await tx.stockLevel.findFirst({
        where: {
          warehouseId: opts.warehouseId,
          rawMaterialId: item.rawMaterialId || null,
          batchNumber: item.batchNumber || null,
        },
      });

      if (existing) {
        await tx.stockLevel.update({
          where: { id: existing.id },
          data: { quantity: { increment: item.quantity }, unitCost: item.unitCost },
        });
      } else {
        await tx.stockLevel.create({
          data: {
            warehouseId: opts.warehouseId,
            rawMaterialId: item.rawMaterialId,
            batchNumber: item.batchNumber,
            quantity: item.quantity,
            unitCost: item.unitCost,
            expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
          },
        });
      }

      await tx.inventoryTransaction.create({
        data: {
          warehouseId: opts.warehouseId,
          type: 'RECEIPT',
          rawMaterialId: item.rawMaterialId,
          batchNumber: item.batchNumber,
          quantity: item.quantity,
          unitCost: item.unitCost,
          referenceType: 'goods_receipt',
          referenceId: opts.goodsReceiptId,
          createdById: opts.userId,
        },
      });
    }
  }
}
