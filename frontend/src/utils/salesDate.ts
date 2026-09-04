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
