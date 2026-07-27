import prisma from '../config/database';
import { subDays } from '../utils/date';
import { requireTenantId } from '../utils/tenant';

export class CrmService {
  static async getStats() {
    const companyId = requireTenantId();
    const now = new Date();
    const expiringThreshold = subDays(now, -30);

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
      prisma.customer.count({ where: { companyId, deletedAt: null } }),
      prisma.customer.count({ where: { companyId, deletedAt: null, isActive: true } }),
      prisma.complaint.count({
        where: { companyId, status: { in: ['PENDING', 'DRAFT'] }, resolvedAt: null },
      }),
      prisma.complaint.count({
        where: {
          companyId,
          OR: [{ status: 'APPROVED' }, { resolvedAt: { not: null } }],
        },
      }),
      prisma.opportunity.count({
        where: {
          companyId,
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
        },
      }),
      prisma.opportunity.aggregate({
        where: {
          companyId,
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
        },
        _sum: { value: true },
      }),
      prisma.opportunity.count({
        where: { companyId, stage: { in: ['CLOSED_WON', 'closed_won'] } },
      }),
      prisma.warranty.count({ where: { customer: { companyId } } }),
      prisma.warranty.count({
        where: {
          customer: { companyId },
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
    };
  }
}
