export const PART_NUMBER_LABEL = 'Part number';

export function formatProductOptionLabel(product: { sku: string; name: string }) {
  return `${product.sku} — ${product.name}`;
}

export function formatPartNumberLine(sku: string) {
  return `${PART_NUMBER_LABEL}: ${sku}`;
}
