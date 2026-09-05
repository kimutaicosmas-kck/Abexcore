import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { StockMovementService } from './inventory.service';
import { AccountingService } from './accounting.service';
import { SalesOrderService } from './sales-order.service';

type TxClient = Prisma.TransactionClient;

export type BomLinePreview = {
  rawMaterialId: string;
  rawMaterialName: string;
  rawMaterialCode: string;
  unit: string;
  qtyPerUnit: number;
  wastePercent: number;
  plannedQty: number;
  unitCost: number;
  lineCost: number;
  onHand: number;
};

export class ProductionService {
  /** Explode active BOM for a production quantity. */
  static async explodeBom(
    tx: TxClient,
    productId: string,
    orderQuantity: number
  ): Promise<{ lines: BomLinePreview[]; estimatedCost: number }> {
    const bom = await tx.billOfMaterial.findUnique({
      where: { productId },
      include: {
        items: {
          include: {
            rawMaterial: { select: { id: true, name: true, code: true, unitCost: true, unit: true } },
          },
        },
      },
    });

    if (!bom?.isActive || bom.items.length === 0) {
      return { lines: [], estimatedCost: 0 };
    }

    const rmWarehouseId = await StockMovementService.getRawMaterialsWarehouseId(tx);
    let estimatedCost = 0;
    const lines: BomLinePreview[] = [];

    for (const item of bom.items) {
      const wasteFactor = 1 + Number(item.wastePercent || 0) / 100;
      const plannedQty = Number(item.quantity) * wasteFactor * orderQuantity;
      const stockLevel = await tx.stockLevel.findFirst({
        where: { rawMaterialId: item.rawMaterialId, warehouseId: rmWarehouseId },
      });
      const unitCost = Number(stockLevel?.unitCost ?? item.rawMaterial.unitCost ?? 0);
      const lineCost = plannedQty * unitCost;
      estimatedCost += lineCost;

      lines.push({
        rawMaterialId: item.rawMaterialId,
        rawMaterialName: item.rawMaterial.name,
        rawMaterialCode: item.rawMaterial.code,
        unit: item.unit || item.rawMaterial.unit,
        qtyPerUnit: Number(item.quantity),
        wastePercent: Number(item.wastePercent || 0),
        plannedQty,
        unitCost,
        lineCost,
        onHand: Number(stockLevel?.quantity ?? 0),
      });
    }

    return { lines, estimatedCost };
  }

  static async attachBomConsumption(
    tx: TxClient,
    productionOrderId: string,
    productId: string,
    orderQuantity: number
  ): Promise<{ estimatedCost: number; lineCount: number }> {
    const { lines, estimatedCost } = await this.explodeBom(tx, productId, orderQuantity);

    if (lines.length === 0) {
      return { estimatedCost: 0, lineCount: 0 };
    }

    await tx.productionConsumption.createMany({
      data: lines.map((line) => ({
        productionOrderId,
        rawMaterialId: line.rawMaterialId,
        plannedQty: line.plannedQty,
        unit: line.unit,
      })),
    });

    await tx.productionOrder.update({
      where: { id: productionOrderId },
      data: { estimatedCost },
    });

    return { estimatedCost, lineCount: lines.length };
  }

  static async completeProduction(
    tx: TxClient,
    order: {
      id: string;
      orderNumber: string;
      productId: string;
      quantity: number;
      salesOrderId: string | null;
      product: { manufacturingCost: Prisma.Decimal };
      consumption: Array<{
        id: string;
        rawMaterialId: string;
        plannedQty: Prisma.Decimal;
        rawMaterial?: { name: string; code: string } | null;
      }>;
    },
    params: {
      completedQty: number;
      rejectedQty?: number;
      userId: string;
      warehouseId?: string;
      consumptionOverrides?: Array<{
        rawMaterialId: string;
        actualQty?: number;
        wasteQty?: number;
      }>;
    }
  ) {
    const { completedQty, rejectedQty = 0, userId, warehouseId, consumptionOverrides } = params;

    if (completedQty > order.quantity) {
      throw new AppError(`Completed quantity cannot exceed order quantity (${order.quantity})`, 400);
    }

    const fgWarehouseId = await StockMovementService.getFinishedGoodsWarehouseId(tx);
    if (warehouseId && warehouseId !== fgWarehouseId) {
      throw new AppError('Production output must be posted to the finished goods warehouse', 400);
    }

    const rawMaterialsWarehouseId = await StockMovementService.getRawMaterialsWarehouseId(tx);
    const scale = completedQty / order.quantity;
    const overrideMap = new Map(
      (consumptionOverrides || []).map((o) => [o.rawMaterialId, o])
    );

    let totalMaterialCost = 0;

    let consumptionRows = order.consumption;

    if (consumptionRows.length === 0) {
      const { lineCount } = await this.attachBomConsumption(
        tx,
        order.id,
        order.productId,
        order.quantity
      );
      if (lineCount === 0) {
        throw new AppError(
          'No material recipe (BOM) for this product. Add a materials recipe under Products, then complete production.',
          400
        );
      }
      consumptionRows = await tx.productionConsumption.findMany({
        where: { productionOrderId: order.id },
        include: { rawMaterial: { select: { name: true, code: true } } },
      });
    }

    for (const consumption of consumptionRows) {
      const override = overrideMap.get(consumption.rawMaterialId);
      const plannedForRun = Number(consumption.plannedQty) * scale;
      const wasteQty = override?.wasteQty ?? 0;
      const actualQty = override?.actualQty ?? plannedForRun + wasteQty;

      if (actualQty <= 0) continue;

      const stockLevel = await tx.stockLevel.findFirst({
        where: { rawMaterialId: consumption.rawMaterialId, warehouseId: rawMaterialsWarehouseId },
      });

      if (!stockLevel) {
        const label =
          consumption.rawMaterial?.name ||
          consumption.rawMaterial?.code ||
          consumption.rawMaterialId;
        throw new AppError(
          `No stock record for raw material "${label}" in the raw materials warehouse. Receive stock via goods receipt first.`,
          400
        );
      }

      const onHand = Number(stockLevel.quantity);
      if (onHand < actualQty) {
        const label =
          consumption.rawMaterial?.name ||
          consumption.rawMaterial?.code ||
          consumption.rawMaterialId;
        throw new AppError(
          `Insufficient stock for "${label}": need ${actualQty.toFixed(3)}, have ${onHand.toFixed(3)}`,
          400
        );
      }

      const unitCost = Number(stockLevel.unitCost);
      const lineCost = actualQty * unitCost;
      totalMaterialCost += lineCost;

      await tx.stockLevel.update({
        where: { id: stockLevel.id },
        data: { quantity: onHand - actualQty },
      });

      await tx.inventoryTransaction.create({
        data: {
          warehouseId: rawMaterialsWarehouseId,
          type: 'PRODUCTION_CONSUMPTION',
          rawMaterialId: consumption.rawMaterialId,
          quantity: actualQty,
          unitCost,
          referenceType: 'production_order',
          referenceId: order.id,
          notes: wasteQty > 0 ? `Includes ${wasteQty} waste units` : undefined,
          createdById: userId,
        },
      });

      await tx.productionConsumption.update({
        where: { id: consumption.id },
        data: {
          actualQty,
          wasteQty,
        },
      });
    }

    const batchNumber = generateNumber('BATCH', (await tx.productionBatch.count()) + 1);

    await tx.productionBatch.create({
      data: {
        productionOrderId: order.id,
        batchNumber,
        quantity: completedQty,
      },
    });

    const fgUnitCost =
      completedQty > 0 ? totalMaterialCost / completedQty : Number(order.product.manufacturingCost);

    const fgStock = await tx.stockLevel.findFirst({
      where: { productId: order.productId, warehouseId: fgWarehouseId },
    });

    if (fgStock) {
      const prevQty = Number(fgStock.quantity);
      const prevCost = Number(fgStock.unitCost);
      const newQty = prevQty + completedQty;
      const blendedCost =
        newQty > 0 ? (prevQty * prevCost + completedQty * fgUnitCost) / newQty : fgUnitCost;
      await tx.stockLevel.update({
        where: { id: fgStock.id },
        data: {
          quantity: newQty,
          unitCost: blendedCost,
        },
      });
    } else {
      await tx.stockLevel.create({
        data: {
          warehouseId: fgWarehouseId,
          productId: order.productId,
          batchNumber,
          quantity: completedQty,
          unitCost: fgUnitCost,
        },
      });
    }

    await tx.inventoryTransaction.create({
      data: {
        warehouseId: fgWarehouseId,
        type: 'PRODUCTION_OUTPUT',
        productId: order.productId,
        batchNumber,
        quantity: completedQty,
        unitCost: fgUnitCost,
        referenceType: 'production_order',
        referenceId: order.id,
        createdById: userId,
      },
    });

    if (totalMaterialCost > 0) {
      await AccountingService.postProductionCosting(tx, {
        orderNumber: order.orderNumber,
        materialCost: totalMaterialCost,
        finishedGoodsCost: totalMaterialCost,
      });
    }

    await tx.product.update({
      where: { id: order.productId },
      data: { manufacturingCost: fgUnitCost },
    });

    const productionResult = await tx.productionOrder.update({
      where: { id: order.id },
      data: {
        status: 'COMPLETED',
        actualEnd: new Date(),
        completedQty,
        rejectedQty,
        actualCost: totalMaterialCost,
      },
      include: {
        product: true,
        batches: true,
        consumption: { include: { rawMaterial: true } },
      },
    });

    if (order.salesOrderId) {
      await SalesOrderService.maybeAdvanceToReady(tx, order.salesOrderId);
    }

    return productionResult;
  }
}

export default ProductionService;
