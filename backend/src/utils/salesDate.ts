import { Prisma } from '@prisma/client';

/**
 * Business date for a sales order: required delivery/sale date when set, else order date.
 * Used for day filters, My Sales, and backdating invoices.
 */
export function resolveSalesBusinessDate(order: {
  requiredDate?: Date | null;
  orderDate: Date;
}): Date {
  return order.requiredDate ?? order.orderDate;
}

/** Prisma filter: order's business date falls in [gte, lte]. */
export function salesOrderInDateRange(range: { gte: Date; lte: Date }): Prisma.SalesOrderWhereInput {
  return {
    OR: [
      { requiredDate: { gte: range.gte, lte: range.lte } },
      {
        AND: [{ requiredDate: null }, { orderDate: { gte: range.gte, lte: range.lte } }],
      },
    ],
  };
}
