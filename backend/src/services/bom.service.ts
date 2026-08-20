import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export class BomService {
  static async getByProductId(productId: string) {
    const product = await prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true, name: true, sku: true, unit: true },
    });
    if (!product) throw new AppError('Product not found', 404);

    const bom = await prisma.billOfMaterial.findUnique({
      where: { productId },
      include: {
        items: {
          include: {
            rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
          },
          orderBy: { rawMaterial: { name: 'asc' } },
        },
      },
    });

    return { product, bom };
  }

  static async list(params?: { search?: string; page?: number; limit?: number }) {
    const page = params?.page || 1;
    const limit = Math.min(params?.limit || 50, 100);
    const search = params?.search?.trim();

    const where: Prisma.BillOfMaterialWhereInput = {
      isActive: true,
      ...(search
        ? {
            product: {
              OR: [
                { name: { contains: search } },
                { sku: { contains: search } },
              ],
            },
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.billOfMaterial.count({ where }),
      prisma.billOfMaterial.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          items: {
            include: {
              rawMaterial: { select: { id: true, name: true, code: true, unit: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: rows,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  static async upsert(input: {
    productId: string;
    version?: string;
    notes?: string;
    items: Array<{
      rawMaterialId: string;
      quantity: number;
      unit?: string;
      wastePercent?: number;
      notes?: string;
    }>;
  }) {
    if (!input.items.length) {
      throw new AppError('BOM must include at least one raw material', 400);
    }

    const product = await prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
    });
    if (!product) throw new AppError('Product not found', 404);

    const materialIds = [...new Set(input.items.map((i) => i.rawMaterialId))];
    const materials = await prisma.rawMaterial.findMany({
      where: { id: { in: materialIds }, deletedAt: null },
      select: { id: true, unit: true },
    });
    if (materials.length !== materialIds.length) {
      throw new AppError('One or more raw materials were not found', 400);
    }
    const unitById = new Map(materials.map((m) => [m.id, m.unit]));

    return prisma.$transaction(async (tx) => {
      const existing = await tx.billOfMaterial.findUnique({ where: { productId: input.productId } });
      if (existing) {
        await tx.billOfMaterialItem.deleteMany({ where: { bomId: existing.id } });
        return tx.billOfMaterial.update({
          where: { id: existing.id },
          data: {
            version: input.version || existing.version,
            notes: input.notes ?? existing.notes,
            isActive: true,
            items: {
              create: input.items.map((item) => ({
                rawMaterialId: item.rawMaterialId,
                quantity: item.quantity,
                unit: item.unit || unitById.get(item.rawMaterialId) || 'pcs',
                wastePercent: item.wastePercent ?? 0,
                notes: item.notes,
              })),
            },
          },
          include: {
            product: true,
            items: { include: { rawMaterial: true } },
          },
        });
      }

      return tx.billOfMaterial.create({
        data: {
          productId: input.productId,
          version: input.version || '1.0',
          notes: input.notes,
          items: {
            create: input.items.map((item) => ({
              rawMaterialId: item.rawMaterialId,
              quantity: item.quantity,
              unit: item.unit || unitById.get(item.rawMaterialId) || 'pcs',
              wastePercent: item.wastePercent ?? 0,
              notes: item.notes,
            })),
          },
        },
        include: {
          product: true,
          items: { include: { rawMaterial: true } },
        },
      });
    });
  }

  /** Expand active BOM into planned consumption rows for a production order. */
  static async expandOntoProductionOrder(
    tx: TxClient,
    productionOrderId: string,
    productId: string,
    orderQty: number
  ) {
    const bom = await tx.billOfMaterial.findUnique({
      where: { productId },
      include: { items: true },
    });
    if (!bom || !bom.isActive || bom.items.length === 0) return 0;

    const rows = bom.items.map((item) => {
      const wasteFactor = 1 + Number(item.wastePercent || 0) / 100;
      const plannedQty = Number(item.quantity) * orderQty * wasteFactor;
      return {
        productionOrderId,
        rawMaterialId: item.rawMaterialId,
        plannedQty,
        actualQty: plannedQty,
        wasteQty: plannedQty - Number(item.quantity) * orderQty,
        unit: item.unit,
      };
    });

    await tx.productionConsumption.createMany({ data: rows });
    return rows.length;
  }
}
