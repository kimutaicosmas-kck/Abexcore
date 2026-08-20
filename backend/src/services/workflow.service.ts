import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { OutboxService } from './outbox.service';
import { NotificationService } from './notification.service';

export type ApprovalEntityType =
  | 'purchase_order'
  | 'purchase_requisition'
  | 'leave_request'
  | 'salary_advance'
  | 'sales_order'
  | 'payment'
  | 'expense';

/**
 * Lightweight approval workflow — request → pending → approve/reject.
 * Hooks into domain via Outbox events for downstream automation.
 */
export class WorkflowService {
  static async requestApproval(input: {
    entityType: ApprovalEntityType;
    entityId: string;
    title: string;
    requestedById: string;
    metadata?: Record<string, unknown>;
    companyId?: string;
  }) {
    const companyId = input.companyId || requireTenantId();

    const existing = await prisma.approvalRequest.findFirst({
      where: {
        companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        status: 'PENDING',
      },
    });
    if (existing) return existing;

    const approval = await prisma.approvalRequest.create({
      data: {
        companyId,
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
        status: 'PENDING',
        requestedById: input.requestedById,
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await OutboxService.publish(prisma, {
      companyId,
      eventType: 'approval.requested',
      aggregateType: 'ApprovalRequest',
      aggregateId: approval.id,
      payload: {
        entityType: input.entityType,
        entityId: input.entityId,
        title: input.title,
      },
    });

    await NotificationService.notifyRole(
      'Managing Director',
      'SYSTEM',
      'Approval required',
      input.title,
      '/approvals'
    ).catch(() => undefined);

    return approval;
  }

  static async list(status?: string) {
    const companyId = requireTenantId();
    return prisma.approvalRequest.findMany({
      where: {
        companyId,
        ...(status ? { status } : {}),
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        decidedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  static async decide(input: {
    id: string;
    decidedById: string;
    decision: 'APPROVED' | 'REJECTED';
    note?: string;
  }) {
    const companyId = requireTenantId();
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: input.id, companyId },
    });
    if (!approval) throw new AppError('Approval request not found', 404);
    if (approval.status !== 'PENDING') {
      throw new AppError('Approval request is already decided', 400);
    }

    const updated = await prisma.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: input.decision,
        decidedById: input.decidedById,
        decisionNote: input.note,
        decidedAt: new Date(),
      },
      include: {
        requestedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        decidedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    await OutboxService.publish(prisma, {
      companyId,
      eventType: input.decision === 'APPROVED' ? 'approval.approved' : 'approval.rejected',
      aggregateType: 'ApprovalRequest',
      aggregateId: updated.id,
      payload: {
        entityType: updated.entityType,
        entityId: updated.entityId,
        decision: input.decision,
      },
    });

    if (updated.entityType === 'expense') {
      const { ExpenseService } = await import('./expense.service');
      await ExpenseService.decide(
        updated.entityId,
        input.decision,
        input.decidedById,
        input.note
      ).catch(() => undefined);
    }

    await NotificationService.notifyUser(
      updated.requestedById,
      'SYSTEM',
      input.decision === 'APPROVED' ? 'Request approved' : 'Request rejected',
      updated.title,
      '/approvals'
    ).catch(() => undefined);

    return updated;
  }
}
