const BUSINESS_TIMEZONE = 'Africa/Nairobi';

/** Calendar day key (YYYY-MM-DD) in the business timezone. */
export function toLocalDateKey(date: Date | string, timeZone = BUSINESS_TIMEZONE): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function resolveSalesBusinessDate(order: {
  requiredDate?: string | null;
  orderDate: string;
}): string {
  return order.requiredDate || order.orderDate;
}

/** Sales person may only be reassigned on the order's sale date (same local calendar day). */
export function isSalesOrderReassignableToday(order: {
  status: string;
  requiredDate?: string | null;
  orderDate: string;
}): boolean {
  if (order.status === 'CANCELLED') return false;
  const businessDate = resolveSalesBusinessDate(order);
  return toLocalDateKey(businessDate) === toLocalDateKey(new Date());
}

export function toLocalDateInput(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toMonthInput(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Inclusive first/last calendar day for `YYYY-MM`. */
export function monthBounds(monthKey: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(last).padStart(2, '0')}`,
  };
}

export function formatMonthLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!match) return monthKey;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString('en-KE', {
    month: 'long',
    year: 'numeric',
  });
}

export function previousMonthInput(date = new Date()): string {
  return toMonthInput(new Date(date.getFullYear(), date.getMonth() - 1, 1));
}
