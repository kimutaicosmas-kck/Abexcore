const MIN_MEANINGFUL_UNIT_COST = 0.01;

function meaningfulCost(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) && n >= MIN_MEANINGFUL_UNIT_COST ? n : 0;
}

/** Display unit cost for a stock-level row (API enriched or catalog fallback). */
export function stockLevelUnitCost(row: Record<string, unknown>): number {
  const effective = meaningfulCost((row as { effectiveUnitCost?: number }).effectiveUnitCost);
  if (effective > 0) return effective;

  const stored = meaningfulCost(row.unitCost);
  if (stored > 0) return stored;

  const product = row.product as
    | {
        sellingPrice?: number | string;
        distributorPrice?: number | string;
        retailPrice?: number | string;
        manufacturingCost?: number | string;
      }
    | undefined;
  if (product) {
    return (
      meaningfulCost(product.sellingPrice) ||
      meaningfulCost(product.distributorPrice) ||
      meaningfulCost(product.retailPrice) ||
      meaningfulCost(product.manufacturingCost) ||
      0
    );
  }

  const material = row.rawMaterial as { unitCost?: number | string } | undefined;
  return meaningfulCost(material?.unitCost);
}

export function stockLevelLineValue(row: Record<string, unknown>): number {
  const preset = (row as { lineValue?: number }).lineValue;
  if (preset != null && preset > 0) return preset;
  return Number(row.quantity || 0) * stockLevelUnitCost(row);
}
