import { describe, expect, it } from 'vitest';
import { monthBounds, previousMonthInput, toMonthInput } from './salesDate';

describe('monthBounds', () => {
  it('returns first and last day of a 31-day month', () => {
    expect(monthBounds('2026-08-01'.slice(0, 7))).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('handles February in a non-leap year', () => {
    expect(monthBounds('2026-02')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('returns null for invalid keys', () => {
    expect(monthBounds('2026-13')).toBeNull();
    expect(monthBounds('')).toBeNull();
  });
});

describe('previousMonthInput', () => {
  it('steps back one calendar month', () => {
    expect(previousMonthInput(new Date(2026, 8, 30))).toBe('2026-08');
    expect(toMonthInput(new Date(2026, 8, 30))).toBe('2026-09');
  });
});
