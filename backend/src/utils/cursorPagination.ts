import { z } from 'zod';

export const cursorPaginationSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  direction: z.enum(['forward', 'backward']).default('forward'),
});

export type CursorPage<T> = {
  data: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  hasMore: boolean;
  limit: number;
};

/** Keyset pagination for large tables — avoids slow OFFSET on deep pages. */
export function buildCursorResult<T extends { id: string }>(
  rows: T[],
  limit: number
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    nextCursor: hasMore && data.length ? data[data.length - 1].id : null,
    prevCursor: data.length ? data[0].id : null,
    hasMore,
    limit,
  };
}
