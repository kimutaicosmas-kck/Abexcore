import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { injectTenantData, requireTenantId } from '../utils/tenant';

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
    const companyId = requireTenantId();
    const existing = await tx.warehouse.findFirst({
      where: { companyId, isActive: true, deletedAt: null, type: 'raw_materials' },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    const branch = await tx.branch.findFirst({
      where: { companyId, isActive: true },
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

  /**
   * Move any raw-material stock that landed in the wrong warehouse into WH-RM.
   * Uses explicit company warehouse IDs so nested filters / tx extensions cannot miss rows.
   */
  static async relocateMisplacedRawMaterialStock(): Promise<number> {
    const companyId = requireTenantId();

    // Normalize known warehouse codes so type mismatches cannot hide stock.
    await Promise.all([
      prisma.warehouse.updateMany({
        where: { companyId, code: 'WH-RM' },
        data: { type: 'raw_materials', isActive: true },
      }),
      prisma.warehouse.updateMany({
        where: { companyId, code: 'WH-FG' },
        data: { type: 'finished_goods', isActive: true },
      }),
    ]);

    const [rmWarehouseId, wrongWarehouses] = await Promise.all([
      this.getRawMaterialsWarehouseId(),
      prisma.warehouse.findMany({
        where: {
          companyId,
          deletedAt: null,
          type: { not: 'raw_materials' },
        },
        select: { id: true, code: true },
      }),
    ]);

    if (wrongWarehouses.length === 0) return 0;

    const wrongIds = wrongWarehouses.map((w) => w.id);
    const codeById = new Map(wrongWarehouses.map((w) => [w.id, w.code]));

    const misplaced = await prisma.stockLevel.findMany({
      where: {
        rawMaterialId: { not: null },
        warehouseId: { in: wrongIds },
        OR: [{ quantity: { not: 0 } }, { reservedQty: { not: 0 } }],
      },
    });

    if (misplaced.length === 0) return 0;

    let moved = 0;

    for (const level of misplaced) {
      const qty = Number(level.quantity);
      const reserved = Number(level.reservedQty || 0);
      if (!level.rawMaterialId || (qty === 0 && reserved === 0)) continue;

      const fromCode = codeById.get(level.warehouseId) || 'unknown';

      await prisma.$transaction(async (tx) => {
        const current = await tx.stockLevel.findUnique({ where: { id: level.id } });
        if (!current || current.warehouseId === rmWarehouseId) return;
        if (Number(current.quantity) === 0 && Number(current.reservedQty || 0) === 0) return;
        if (!wrongIds.includes(current.warehouseId)) return;

        const moveQty = Number(current.quantity);
        const moveReserved = Number(current.reservedQty || 0);

        const dest = await tx.stockLevel.findFirst({
          where: {
            warehouseId: rmWarehouseId,
            rawMaterialId: current.rawMaterialId,
            batchNumber: current.batchNumber ?? null,
          },
        });

        if (dest) {
          await tx.stockLevel.update({
            where: { id: dest.id },
            data: {
              quantity: { increment: moveQty },
              reservedQty: { increment: moveReserved },
              unitCost: current.unitCost ?? dest.unitCost,
              expiryDate: current.expiryDate ?? dest.expiryDate,
            },
          });
        } else {
          await tx.stockLevel.create({
            data: {
              warehouseId: rmWarehouseId,
              rawMaterialId: current.rawMaterialId,
              batchNumber: current.batchNumber,
              quantity: moveQty,
              reservedQty: moveReserved,
              unitCost: current.unitCost,
              expiryDate: current.expiryDate,
            },
          });
        }

        await tx.stockLevel.delete({ where: { id: current.id } });

        if (moveQty !== 0) {
          await tx.inventoryTransaction.create({
            data: {
              warehouseId: current.warehouseId,
              type: 'TRANSFER',
              rawMaterialId: current.rawMaterialId,
              batchNumber: current.batchNumber,
              quantity: -Math.abs(moveQty),
              unitCost: Number(current.unitCost || 0),
              notes: `Auto-relocate raw material from ${fromCode} to WH-RM`,
              referenceType: 'warehouse_repair',
              referenceId: rmWarehouseId,
            },
          });
          await tx.inventoryTransaction.create({
            data: {
              warehouseId: rmWarehouseId,
              type: 'TRANSFER',
              rawMaterialId: current.rawMaterialId,
              batchNumber: current.batchNumber,
              quantity: Math.abs(moveQty),
              unitCost: Number(current.unitCost || 0),
              notes: `Auto-relocate raw material from ${fromCode} to WH-RM`,
              referenceType: 'warehouse_repair',
              referenceId: current.warehouseId,
            },
          });
        }
      });

      moved += 1;
    }

    return moved;
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

  /** Goods receipts always land in a raw materials warehouse. */
  static async assertGoodsReceiptWarehouse(tx: TxClient, warehouseId: string) {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, isActive: true, deletedAt: null },
      select: { id: true, type: true, code: true },
    });
    if (!warehouse) throw new AppError('Warehouse not found', 404);
    if (warehouse.type !== 'raw_materials') {
      throw new AppError(
        `Goods receipts must use a raw materials warehouse (got ${warehouse.code} · ${warehouse.type})`,
        400
      );
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
    await this.assertGoodsReceiptWarehouse(tx, opts.warehouseId);

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
