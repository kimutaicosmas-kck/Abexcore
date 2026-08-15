export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Calendar day key (YYYY-MM-DD) in the business timezone.
 * Never use `toISOString().slice(0, 10)` — UTC shifts EAT midnight to the previous day.
 */
export function toLocalDateKey(
  date: Date,
  timeZone = process.env.TZ || 'Africa/Nairobi'
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Parse `YYYY-MM-DD` as a local calendar day (avoids UTC off-by-one). */
export function parseLocalDateInput(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Inclusive local-day range for Prisma DateTime filters. */
export function dayRangeFromInput(dateStr: string): { gte: Date; lte: Date } | null {
  const day = parseLocalDateInput(dateStr);
  if (!day) return null;
  return { gte: startOfDay(day), lte: endOfDay(day) };
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

/** Local week start (Monday = 1 by default). */
export function startOfWeek(date: Date, weekStartsOn = 1): Date {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = (day - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function endOfWeek(date: Date, weekStartsOn = 1): Date {
  const start = startOfWeek(date, weekStartsOn);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return endOfDay(end);
}

export type PaymentPeriodPreset =
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month';

export type PaymentInvoiceTimingPreset =
  | 'same_week_as_invoice'
  | 'same_month_as_invoice'
  | 'this_week_taken_and_paid'
  | 'this_month_taken_and_paid';

/** Inclusive paymentDate range for a named period (local calendar). */
export function paymentPeriodRange(
  period: PaymentPeriodPreset,
  now = new Date()
): { gte: Date; lte: Date } {
  if (period === 'this_week') {
    return { gte: startOfWeek(now), lte: endOfWeek(now) };
  }
  if (period === 'last_week') {
    const ref = subDays(startOfWeek(now), 1);
    return { gte: startOfWeek(ref), lte: endOfWeek(ref) };
  }
  if (period === 'this_month') {
    return { gte: startOfMonth(now), lte: endOfMonth(now) };
  }
  // last_month
  const lastMonth = subMonths(startOfMonth(now), 1);
  return { gte: startOfMonth(lastMonth), lte: endOfMonth(lastMonth) };
}

export function isSameLocalWeek(a: Date, b: Date): boolean {
  return startOfWeek(a).getTime() === startOfWeek(b).getTime();
}

export function isSameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function subDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - days);
  return d;
}

export function subMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

export function generateNumber(prefix: string, sequence: number): string {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;
}

import type { PrismaClient } from '@prisma/client';

/** Next QC inspection number — avoids collisions when count ≠ max sequence. */
export async function nextQualityInspectionNumber(
  client: Pick<PrismaClient, 'qualityInspection'>
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `QC-${year}-`;
  const latest = await client.qualityInspection.findFirst({
    where: { inspectionNo: { startsWith: prefix } },
    orderBy: { inspectionNo: 'desc' },
    select: { inspectionNo: true },
  });
  const lastSeq = latest ? Number.parseInt(latest.inspectionNo.slice(prefix.length), 10) : 0;
  return generateNumber('QC', (Number.isFinite(lastSeq) ? lastSeq : 0) + 1);
}
