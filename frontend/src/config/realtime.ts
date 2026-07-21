/** Reference data that rarely changes — skip auto-refresh to reduce noise. */
const STATIC_QUERY_ROOTS = new Set([
  'user-roles',
  'product-categories',
  'company',
]);

export const LIVE_POLL_MS = 20_000;
export const LIVE_STALE_MS = 10_000;
export const NOTIFICATION_POLL_MS = 20_000;

export function isLiveQuery(queryKey: readonly unknown[]): boolean {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return false;
  const head = String(queryKey[0] ?? '');
  if (!head || STATIC_QUERY_ROOTS.has(head)) return false;
  return true;
}

export const ERP_DATA_MUTATED_EVENT = 'erp:data-mutated';
