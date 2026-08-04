import { Gender } from '@prisma/client';

/** Canonical leave type codes stored on LeaveRequest / LeaveBalance. */
export const LEAVE_TYPES = [
  'ANNUAL',
  'SICK',
  'COMPASSIONATE',
  'PATERNITY',
  'MATERNITY',
  'UNPAID',
] as const;

export type LeaveTypeCode = (typeof LEAVE_TYPES)[number];

/** Default yearly entitlements (Kenya-style baselines for this product). */
export const DEFAULT_LEAVE_ENTITLEMENTS: Record<LeaveTypeCode, number> = {
  ANNUAL: 21,
  SICK: 7,
  COMPASSIONATE: 5,
  PATERNITY: 14,
  MATERNITY: 90,
  UNPAID: 0,
};

export function normalizeLeaveType(type: string): string {
  return String(type || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

export function isTrackedLeaveType(type: string): type is LeaveTypeCode {
  return (LEAVE_TYPES as readonly string[]).includes(type) && type !== 'UNPAID';
}

export function defaultEntitlementFor(type: string, gender?: Gender | null): number {
  const code = normalizeLeaveType(type) as LeaveTypeCode;
  if (code === 'UNPAID') return 0;
  if (code === 'PATERNITY' && gender && gender !== 'MALE' && gender !== 'UNSPECIFIED') {
    return 0;
  }
  if (code === 'MATERNITY' && gender && gender !== 'FEMALE' && gender !== 'UNSPECIFIED') {
    return 0;
  }
  return DEFAULT_LEAVE_ENTITLEMENTS[code] ?? 0;
}

/** Inclusive calendar days between local start/end dates. */
export function countLeaveDays(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const ms = e.getTime() - s.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000) + 1;
}

export function leaveTypesForGender(gender?: Gender | null): LeaveTypeCode[] {
  const types: LeaveTypeCode[] = ['ANNUAL', 'SICK', 'COMPASSIONATE', 'UNPAID'];
  if (!gender || gender === 'MALE' || gender === 'UNSPECIFIED') types.push('PATERNITY');
  if (!gender || gender === 'FEMALE' || gender === 'UNSPECIFIED') types.push('MATERNITY');
  return types;
}
