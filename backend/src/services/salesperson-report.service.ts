import prisma from '../config/database';
import { endOfDay, startOfDay } from '../utils/date';
import { salesPersonOrderFilter } from './my-sales.service';
import { Prisma } from '@prisma/client';
import { requireTenantId } from '../utils/tenant';

export interface SalesByPersonQuery {
  page: number;
  limit: number;
  salesPersonId?: string;
  startDate?: string;
  endDate?: string;
}

function buildInvoiceWhere(query: Pick<SalesByPersonQuery, 'salesPersonId' | 'startDate' | 'endDate'>) {
  const where: Prisma.InvoiceWhereInput = {
    companyId: requireTenantId(),
    type: 'SALES',
    status: { not: 'REFUNDED' },
    salesOrderId: { not: null },
  };

  if (query.salesPersonId) {
    where.salesOrder = salesPersonOrderFilter(query.salesPersonId);
  }

  if (query.startDate || query.endDate) {
    where.invoiceDate = {};
    if (query.startDate) {
      where.invoiceDate.gte = startOfDay(new Date(query.startDate));
    }
    if (query.endDate) {
      where.invoiceDate.lte = endOfDay(new Date(query.endDate));
    }
  }

  return where;
}

function formatPersonName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function resolveOrderSalesPerson(order?: {
  salesPerson: { id: string; firstName: string; lastName: string } | null;
  createdBy: { id: string; firstName: string; lastName: string };
} | null) {
  if (!order) return null;
  return order.salesPerson || order.createdBy;
}

export class SalespersonReportService {
  static async listSalesOfficers() {
    const users = await prisma.user.findMany({
      where: {
        companyId: requireTenantId(),
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { salesOrders: { some: {} } },
          { role: { name: 'Sales Officer' } },
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return users.map((user) => ({
      id: user.id,
      name: formatPersonName(user),
      email: user.email,
      role: user.role.name,
    }));
  }

  static async getReport(query: SalesByPersonQuery) {
    const where = buildInvoiceWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [rows, total, aggregate, allForBreakdown] = await Promise.all([
      prisma.invoice.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { invoiceDate: 'desc' },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          salesOrder: {
            select: {
              id: true,
              orderNumber: true,
              salesPerson: { select: { id: true, firstName: true, lastName: true } },
              createdBy: { select: { id: true, firstName: true, lastName: true } },
            },
          },
        },
      }),
      prisma.invoice.count({ where }),
      prisma.invoice.aggregate({
        where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: true,
      }),
      query.salesPersonId
        ? Promise.resolve([])
        : prisma.invoice.findMany({
            where,
            select: {
              totalAmount: true,
              paidAmount: true,
              salesOrder: {
                select: {
                  salesPerson: { select: { id: true, firstName: true, lastName: true } },
                  createdBy: { select: { id: true, firstName: true, lastName: true } },
                },
              },
            },
          }),
    ]);

    const bySalesPerson = query.salesPersonId
      ? []
      : Array.from(
          allForBreakdown.reduce((map, invoice) => {
            const person = resolveOrderSalesPerson(invoice.salesOrder);
            if (!person) return map;

            const existing = map.get(person.id) ?? {
              id: person.id,
              name: formatPersonName(person),
              invoiceCount: 0,
              totalSales: 0,
              totalPaid: 0,
            };

            existing.invoiceCount += 1;
            existing.totalSales += Number(invoice.totalAmount);
            existing.totalPaid += Number(invoice.paidAmount);
            map.set(person.id, existing);
            return map;
          }, new Map<string, { id: string; name: string; invoiceCount: number; totalSales: number; totalPaid: number }>()).values()
        ).sort((a, b) => b.totalSales - a.totalSales);

    return {
      summary: {
        invoiceCount: aggregate._count,
        totalSales: Number(aggregate._sum.totalAmount || 0),
        totalPaid: Number(aggregate._sum.paidAmount || 0),
        outstanding:
          Number(aggregate._sum.totalAmount || 0) - Number(aggregate._sum.paidAmount || 0),
        bySalesPerson,
      },
      rows: rows.map((invoice) => {
        const person = resolveOrderSalesPerson(invoice.salesOrder);
        return {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        orderNumber: invoice.salesOrder?.orderNumber || '',
        orderId: invoice.salesOrder?.id || null,
        invoiceDate: invoice.invoiceDate.toISOString(),
        customerId: invoice.customer?.id || null,
        customerName: invoice.customer?.name || '',
        customerCode: invoice.customer?.code || '',
        salesPersonId: person?.id || null,
        salesPersonName: person ? formatPersonName(person) : 'Unassigned',
        totalAmount: Number(invoice.totalAmount),
        paidAmount: Number(invoice.paidAmount),
        balance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
        status: invoice.status,
      };
      }),
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit) || 1,
      },
    };
  }

  static async getRowsForExport(query: Omit<SalesByPersonQuery, 'page' | 'limit'>) {
    const where = buildInvoiceWhere(query);

    const rows = await prisma.invoice.findMany({
      where,
      orderBy: { invoiceDate: 'desc' },
      include: {
        customer: { select: { name: true, code: true } },
        salesOrder: {
          select: {
            orderNumber: true,
            salesPerson: { select: { id: true, firstName: true, lastName: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    return rows.map((invoice) => {
      const person = resolveOrderSalesPerson(invoice.salesOrder);
      return {
      invoiceNumber: invoice.invoiceNumber,
      orderNumber: invoice.salesOrder?.orderNumber || '',
      invoiceDate: invoice.invoiceDate,
      customerName: invoice.customer?.name || '',
      customerCode: invoice.customer?.code || '',
      salesPersonName: person ? formatPersonName(person) : 'Unassigned',
      totalAmount: Number(invoice.totalAmount),
      paidAmount: Number(invoice.paidAmount),
      balance: Number(invoice.totalAmount) - Number(invoice.paidAmount),
      status: invoice.status,
    };
    });
  }
}
