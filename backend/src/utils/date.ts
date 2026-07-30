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
