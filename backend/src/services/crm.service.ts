import prisma from '../config/database';
import { subDays } from '../utils/date';
import { requireTenantId } from '../utils/tenant';
import type { Prisma } from '@prisma/client';

/** Scope CRM entities to customers owned by a salesperson. */
export function salesPersonCustomerFilter(
  salesPersonId: string
): Prisma.CustomerWhereInput {
  return { salesPersonId };
}

export class CrmService {
  static async getStats(salesPersonId?: string) {
    const companyId = requireTenantId();
    const now = new Date();
    const expiringThreshold = subDays(now, -30);

    const customerBase: Prisma.CustomerWhereInput = {
      companyId,
      deletedAt: null,
      ...(salesPersonId ? salesPersonCustomerFilter(salesPersonId) : {}),
    };

    const ownedCustomer: Prisma.CustomerWhereInput | undefined = salesPersonId
      ? { salesPersonId }
      : { companyId };

    const [
      totalCustomers,
      activeCustomers,
      openComplaints,
      resolvedComplaints,
      openOpportunities,
      pipelineAgg,
      wonOpportunities,
      totalWarranties,
      expiringWarranties,
    ] = await Promise.all([
      prisma.customer.count({ where: customerBase }),
      prisma.customer.count({ where: { ...customerBase, isActive: true } }),
      prisma.complaint.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'DRAFT'] },
          resolvedAt: null,
          ...(salesPersonId ? { customer: ownedCustomer } : {}),
        },
      }),
      prisma.complaint.count({
        where: {
          companyId,
          OR: [{ status: 'APPROVED' }, { resolvedAt: { not: null } }],
          ...(salesPersonId ? { customer: ownedCustomer } : {}),
        },
      }),
      prisma.opportunity.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
          ...(salesPersonId ? { customer: ownedCustomer } : {}),
        },
      }),
      prisma.opportunity.aggregate({
        where: {
          companyId,
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
          ...(salesPersonId ? { customer: ownedCustomer } : {}),
        },
        _sum: { value: true },
      }),
      prisma.opportunity.count({
        where: {
          companyId,
          stage: { in: ['CLOSED_WON', 'closed_won'] },
          ...(salesPersonId ? { customer: ownedCustomer } : {}),
        },
      }),
      prisma.warranty.count({
        where: { customer: ownedCustomer || { companyId } },
      }),
      prisma.warranty.count({
        where: {
          customer: ownedCustomer || { companyId },
          endDate: { gte: now, lte: expiringThreshold },
        },
      }),
    ]);

    return {
      customers: {
        total: totalCustomers,
        active: activeCustomers,
        inactive: totalCustomers - activeCustomers,
      },
      complaints: {
        open: openComplaints,
        resolved: resolvedComplaints,
      },
      opportunities: {
        open: openOpportunities,
        pipelineValue: Number(pipelineAgg._sum.value || 0),
        won: wonOpportunities,
      },
      warranties: {
        total: totalWarranties,
        expiringSoon: expiringWarranties,
      },
      scopedToSalesPerson: Boolean(salesPersonId),
    };
  }
}
