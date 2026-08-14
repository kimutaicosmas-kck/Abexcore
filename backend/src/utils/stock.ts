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
 * Low stock = on-hand is zero (or negative) OR at/below the configured minimum.
 * When minimum is unset (0), only zero/negative stock is flagged.
 */
export function isLowStock(quantity: unknown, minStockLevel: unknown): boolean {
  const qty = toStockQty(quantity);
  const min = toStockQty(minStockLevel);
  return qty <= 0 || qty <= min;
}

export function sumStockQuantities(levels: { quantity: unknown }[] | undefined | null): number {
  if (!levels?.length) return 0;
  return levels.reduce((sum, sl) => sum + toStockQty(sl.quantity), 0);
}
