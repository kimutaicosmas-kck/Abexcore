import { Prisma } from '@prisma/client';
import { SALES_PERSON_ROLE_NAMES } from '../config/rolePermissions';
import { salesPersonOrderFilter } from '../services/my-sales.service';
import { dayRangeFromInput } from './date';

/** Orders with no sales officer (null) or attributed to a non-sales role (admin / house). */
export function houseSalesOrderFilter(): Prisma.SalesOrderWhereInput {
  return {
    OR: [
      { salesPersonId: null },
      { salesPerson: { role: { name: { notIn: [...SALES_PERSON_ROLE_NAMES] } } } },
    ],
  };
}

export function resolveSalesPersonListFilter(
  salesPersonId?: string
): Prisma.SalesOrderWhereInput {
  if (!salesPersonId) return {};
  if (salesPersonId === 'unassigned') return houseSalesOrderFilter();
  return salesPersonOrderFilter(salesPersonId);
}

export function salesOrderSearchFilter(search: string): Prisma.SalesOrderWhereInput {
  return {
    OR: [
      { orderNumber: { contains: search } },
      { customer: { name: { contains: search } } },
      { customer: { code: { contains: search } } },
    ],
  };
}

function appendAnd(
  where: Prisma.SalesOrderWhereInput,
  clause: Prisma.SalesOrderWhereInput
) {
  where.AND = [
    ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
    clause,
  ];
}

/**
 * Same scope rules as GET /operations/orders so list + KPI cards stay aligned.
 * Set `includeDate` to apply the calendar-day range (list behaviour).
 */
export async function buildSalesOrdersWhere(opts: {
  status?: string;
  salesPersonId?: string;
  date?: string;
  search?: string;
  /** Force book to this user (sales officers). */
  bookOwnerId?: string;
  includeDate?: boolean;
}): Promise<Prisma.SalesOrderWhereInput> {
  const where: Prisma.SalesOrderWhereInput = {};

  if (opts.status) {
    where.status = opts.status as Prisma.EnumOrderStatusFilter['equals'];
  }

  if (opts.bookOwnerId) {
    Object.assign(where, salesPersonOrderFilter(opts.bookOwnerId));
  } else {
    Object.assign(where, resolveSalesPersonListFilter(opts.salesPersonId));
  }

  if (opts.search?.trim()) {
    appendAnd(where, salesOrderSearchFilter(opts.search.trim()));
  }

  if (opts.includeDate && opts.date) {
    const range = dayRangeFromInput(opts.date);
    if (range) {
      const { salesOrderInDateRange } = await import('./salesDate');
      appendAnd(where, salesOrderInDateRange(range));
    }
  }

  return where;
}
