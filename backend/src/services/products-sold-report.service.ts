import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { endOfDay, parseLocalDateInput, startOfDay } from '../utils/date';
import { requireTenantId } from '../utils/tenant';

export interface ProductsSoldQuery {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
  productId?: string;
  needsRestockOnly?: boolean;
}

function periodBounds(startDate?: string, endDate?: string) {
  const start = startDate
    ? startOfDay(parseLocalDateInput(startDate) || new Date(startDate))
    : undefined;
  const end = endDate ? endOfDay(parseLocalDateInput(endDate) || new Date(endDate)) : undefined;
  return { start, end };
}

export class ProductsSoldReportService {
  /** Qty sold (dispatched) per product in period, with stock for restocking. */
  static async getReport(query: ProductsSoldQuery) {
    const companyId = requireTenantId();
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const { start, end } = periodBounds(query.startDate, query.endDate);

    const deliveryDateFilter: Prisma.DateTimeFilter = {};
    if (start) deliveryDateFilter.gte = start;
    if (end) deliveryDateFilter.lte = end;

    let productIdsFilter: string[] | undefined;
    if (query.productId) {
      productIdsFilter = [query.productId];
    } else if (query.search?.trim()) {
      const q = query.search.trim();
      const matched = await prisma.product.findMany({
        where: {
          companyId,
          deletedAt: null,
          OR: [{ name: { contains: q } }, { sku: { contains: q } }],
        },
        select: { id: true },
        take: 500,
      });
      productIdsFilter = matched.map((p) => p.id);
      if (productIdsFilter.length === 0) {
        return {
          period: {
            startDate: query.startDate || null,
            endDate: query.endDate || null,
          },
          summary: {
            productCount: 0,
            totalQtySold: 0,
            needsRestockCount: 0,
          },
          rows: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        };
      }
    }

    const grouped = await prisma.deliveryItem.groupBy({
      by: ['productId'],
      where: {
        ...(productIdsFilter ? { productId: { in: productIdsFilter } } : {}),
        deliveryNote: {
          companyId,
          status: { notIn: ['FAILED', 'RETURNED'] },
          ...(Object.keys(deliveryDateFilter).length
            ? { createdAt: deliveryDateFilter }
            : {}),
        },
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
    });

    const productIds = grouped.map((g) => g.productId);
    const [products, stockLevels] = await Promise.all([
      productIds.length
        ? prisma.product.findMany({
            where: { id: { in: productIds }, companyId },
            select: {
              id: true,
              sku: true,
              name: true,
              minStockLevel: true,
              isActive: true,
              category: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      productIds.length
        ? prisma.stockLevel.findMany({
            where: { productId: { in: productIds }, warehouse: { companyId } },
            select: { productId: true, quantity: true, reservedQty: true },
          })
        : Promise.resolve([]),
    ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const stockByProduct = new Map<string, { onHand: number; reserved: number }>();
    for (const sl of stockLevels) {
      if (!sl.productId) continue;
      const cur = stockByProduct.get(sl.productId) || { onHand: 0, reserved: 0 };
      cur.onHand += Number(sl.quantity);
      cur.reserved += Number(sl.reservedQty);
      stockByProduct.set(sl.productId, cur);
    }

    let rows = grouped
      .map((g) => {
        const product = productById.get(g.productId);
        if (!product) return null;
        const stock = stockByProduct.get(g.productId) || { onHand: 0, reserved: 0 };
        const availableQty = Math.max(0, stock.onHand - stock.reserved);
        const qtySold = g._sum.quantity || 0;
        const minStockLevel = product.minStockLevel;
        const needsRestock = availableQty <= minStockLevel;
        const suggestedRestockQty = needsRestock
          ? Math.max(qtySold, minStockLevel - availableQty + qtySold)
          : 0;
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category?.name || '—',
          qtySold,
          onHand: stock.onHand,
          reservedQty: stock.reserved,
          availableQty,
          minStockLevel,
          needsRestock,
          suggestedRestockQty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (query.needsRestockOnly) {
      rows = rows.filter((r) => r.needsRestock);
    }

    const totalQtySold = rows.reduce((sum, r) => sum + r.qtySold, 0);
    const needsRestockCount = rows.filter((r) => r.needsRestock).length;
    const total = rows.length;
    const skip = (page - 1) * limit;
    const pageRows = rows.slice(skip, skip + limit);

    return {
      period: {
        startDate: query.startDate || null,
        endDate: query.endDate || null,
      },
      summary: {
        productCount: total,
        totalQtySold,
        needsRestockCount,
      },
      rows: pageRows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 0,
      },
    };
  }

  static async getRowsForExport(query: Omit<ProductsSoldQuery, 'page' | 'limit'>) {
    const report = await this.getReport({ ...query, page: 1, limit: 10_000 });
    return { period: report.period, summary: report.summary, rows: report.rows };
  }
}
