import prisma from '../config/database';
import { subDays } from '../utils/date';

export class CrmService {
  static async getStats() {
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
      prisma.customer.count({ where: { deletedAt: null } }),
      prisma.customer.count({ where: { deletedAt: null, isActive: true } }),
      prisma.complaint.count({
        where: { status: { in: ['PENDING', 'DRAFT'] }, resolvedAt: null },
      }),
      prisma.complaint.count({
        where: { OR: [{ status: 'APPROVED' }, { resolvedAt: { not: null } }] },
      }),
      prisma.opportunity.count({
        where: {
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
        },
      }),
      prisma.opportunity.aggregate({
        where: {
          status: { in: ['PENDING', 'APPROVED'] },
          NOT: { stage: { in: ['CLOSED_WON', 'CLOSED_LOST', 'closed_won', 'closed_lost'] } },
        },
        _sum: { value: true },
      }),
      prisma.opportunity.count({
        where: { stage: { in: ['CLOSED_WON', 'closed_won'] } },
      }),
      prisma.warranty.count(),
      prisma.warranty.count({
        where: {
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
