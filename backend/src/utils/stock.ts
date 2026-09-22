/** Costs at or below this are treated as unset (legacy imports often store 0.0000). */
export const MIN_MEANINGFUL_UNIT_COST = 0.01;

/** Coerce Prisma Decimal / string / number stock values to a finite number. */
export function toStockQty(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (
    typeof value === 'object' &&
    value !== null &&
    'toNumber' in value &&
    typeof (value as { toNumber: () => number }).toNumber === 'function'
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Low-stock alert only (dashboard / notifications / reports).
 * Does NOT limit how many units you can sell — sales may deplete stock to zero.
 * When minimum is unset (0), only zero/negative on-hand is flagged.
 */
export function isLowStock(quantity: unknown, minStockLevel: unknown): boolean {
  const qty = toStockQty(quantity);
  const min = toStockQty(minStockLevel);
  return qty <= 0 || (min > 0 && qty <= min);
}

export function sumStockQuantities(levels: { quantity: unknown }[] | undefined | null): number {
  if (!levels?.length) return 0;
  return levels.reduce((sum, sl) => sum + toStockQty(sl.quantity), 0);
}

/** Weighted average unit cost from stock levels; falls back when no stock. */
export function weightedStockUnitCost(
  levels: { quantity: unknown; unitCost?: unknown }[] | undefined | null,
  fallback = 0
): number {
  if (!levels?.length) return fallback;
  const qty = sumStockQuantities(levels);
  if (qty <= 0) return fallback;
  const total = levels.reduce(
    (sum, l) => sum + toStockQty(l.quantity) * toStockQty(l.unitCost),
    0
  );
  const weighted = total / qty;
  return weighted > 0 ? weighted : fallback;
}

/** Catalog selling price for finished goods (used when stock-level cost was never set). */
export function productCatalogUnitCost(product?: {
  sellingPrice?: unknown;
  distributorPrice?: unknown;
  retailPrice?: unknown;
  manufacturingCost?: unknown;
} | null): number {
  if (!product) return 0;
  return (
    toStockQty(product.sellingPrice) ||
    toStockQty(product.distributorPrice) ||
    toStockQty(product.retailPrice) ||
    toStockQty(product.manufacturingCost)
  );
}

export function isMeaningfulUnitCost(value: unknown): boolean {
  return toStockQty(value) >= MIN_MEANINGFUL_UNIT_COST;
}

/** Stored stock cost, or catalog price when the level was saved with zero cost. */
export function resolveStockLevelUnitCost(
  level: { unitCost?: unknown },
  catalog?: {
    sellingPrice?: unknown;
    distributorPrice?: unknown;
    retailPrice?: unknown;
    unitCost?: unknown;
  } | null
): number {
  const stored = toStockQty(level.unitCost);
  if (isMeaningfulUnitCost(stored)) return stored;
  if (!catalog) return 0;
  const productCost = productCatalogUnitCost(catalog);
  if (isMeaningfulUnitCost(productCost)) return productCost;
  const materialCost = toStockQty(catalog.unitCost);
  return isMeaningfulUnitCost(materialCost) ? materialCost : 0;
}

export function enrichStockLevelForDisplay<
  T extends {
    id?: string;
    quantity: unknown;
    unitCost?: unknown;
    product?: {
      sellingPrice?: unknown;
      distributorPrice?: unknown;
      retailPrice?: unknown;
    } | null;
    rawMaterial?: { unitCost?: unknown } | null;
  },
>(row: T) {
  const catalog = row.product || row.rawMaterial;
  const storedUnitCost = toStockQty(row.unitCost);
  const effectiveUnitCost = resolveStockLevelUnitCost(row, catalog);
  const qty = toStockQty(row.quantity);
  const lineValue = qty * effectiveUnitCost;
  return {
    ...row,
    quantity: qty,
    storedUnitCost,
    effectiveUnitCost,
    unitCost: effectiveUnitCost,
    lineValue,
  };
}

const PRODUCT_PRICE_SELECT = {
  id: true,
  sku: true,
  name: true,
  sellingPrice: true,
  distributorPrice: true,
  retailPrice: true,
  manufacturingCost: true,
  minStockLevel: true,
} as const;

/** Plain JSON numbers for stock-level list responses (avoids Decimal / cache mismatches). */
export function serializeStockLevelForApi<
  T extends {
    quantity: unknown;
    unitCost?: unknown;
    storedUnitCost?: number;
    effectiveUnitCost?: number;
    lineValue?: number;
    product?: Record<string, unknown> | null;
    rawMaterial?: Record<string, unknown> | null;
    warehouse?: Record<string, unknown> | null;
  },
>(row: T) {
  const display = enrichStockLevelForDisplay(row);
  return {
    ...display,
    quantity: display.quantity,
    unitCost: display.effectiveUnitCost,
    storedUnitCost: display.storedUnitCost,
    effectiveUnitCost: display.effectiveUnitCost,
    lineValue: display.lineValue,
    product: display.product
      ? {
          ...display.product,
          sellingPrice: toStockQty(display.product.sellingPrice),
          distributorPrice: toStockQty(display.product.distributorPrice),
          retailPrice: toStockQty(display.product.retailPrice),
          manufacturingCost: toStockQty(
            (display.product as { manufacturingCost?: unknown }).manufacturingCost
          ),
          minStockLevel: Number(display.product.minStockLevel ?? 0),
        }
      : null,
    rawMaterial: display.rawMaterial
      ? {
          ...display.rawMaterial,
          unitCost: toStockQty(display.rawMaterial.unitCost),
          minStockLevel: Number(display.rawMaterial.minStockLevel ?? 0),
        }
      : null,
  };
}

export { PRODUCT_PRICE_SELECT };
