import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import { nextExpenseNumber } from '../utils/numbering';
import { AccountingService } from './accounting.service';
import { WorkflowService } from './workflow.service';
import { OutboxService } from './outbox.service';
import { seedChartOfAccountsForCompany } from '../utils/chartOfAccounts';

const expenseInclude = {
  categoryAccount: { select: { id: true, code: true, name: true, type: true } },
  supplier: { select: { id: true, code: true, name: true } },
  submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} as const;

export type CreateExpenseInput = {
  expenseDate?: string | Date;
  categoryAccountId: string;
  payeeName: string;
  supplierId?: string | null;
  description: string;
  amount: number;
  vatAmount?: number;
  paymentMethod?: string;
  reference?: string | null;
  notes?: string | null;
  receiptUrl?: string | null;
  /** Skip draft — create as PENDING_APPROVAL immediately */
  submit?: boolean;
};

export class ExpenseService {
  static async ensureOperatingAccounts(companyId: string) {
    await seedChartOfAccountsForCompany(prisma, companyId);
  }

  static async list(params: {
    status?: string;
    search?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }) {
    const companyId = requireTenantId();
    await this.ensureOperatingAccounts(companyId);

    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      ...(params.status ? { status: params.status as Prisma.EnumExpenseStatusFilter['equals'] } : {}),
      ...(params.from || params.to
        ? {
            expenseDate: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { expenseNumber: { contains: params.search } },
              { payeeName: { contains: params.search } },
              { description: { contains: params.search } },
              { reference: { contains: params.search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.expense.count({ where }),
    ]);

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  static async get(id: string) {
    const expense = await prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: expenseInclude,
    });
    if (!expense) throw new AppError('Expense not found', 404);
    return expense;
  }

  static async categories() {
    const companyId = requireTenantId();
    await this.ensureOperatingAccounts(companyId);
    return prisma.account.findMany({
      where: {
        type: 'EXPENSE',
        isActive: true,
        // Postable opex lines only — skip COGS and header parents
        code: { notIn: ['5000', '5100', '5200'] },
      },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  static async create(input: CreateExpenseInput, userId: string) {
    const companyId = requireTenantId();
    await this.ensureOperatingAccounts(companyId);

    const amount = Number(input.amount);
    const vatAmount = Number(input.vatAmount || 0);
    if (!(amount > 0)) throw new AppError('Amount must be greater than zero', 400);
    if (vatAmount < 0) throw new AppError('VAT amount cannot be negative', 400);
    const totalAmount = amount + vatAmount;

    const category = await prisma.account.findFirst({
      where: { id: input.categoryAccountId, type: 'EXPENSE', isActive: true },
    });
    if (!category) throw new AppError('Select a valid expense account category', 400);

    if (input.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: { id: input.supplierId, deletedAt: null },
      });
      if (!supplier) throw new AppError('Supplier not found', 404);
    }

    const expense = await prisma.$transaction(async (tx) => {
      const expenseNumber = await nextExpenseNumber(tx, companyId);
      const created = await tx.expense.create({
        data: {
          companyId,
          expenseNumber,
          expenseDate: input.expenseDate ? new Date(input.expenseDate) : new Date(),
          categoryAccountId: input.categoryAccountId,
          payeeName: input.payeeName.trim(),
          supplierId: input.supplierId || null,
          description: input.description.trim(),
          amount,
          vatAmount,
          totalAmount,
          paymentMethod: (input.paymentMethod || 'CASH').toUpperCase(),
          status: input.submit ? 'PENDING_APPROVAL' : 'DRAFT',
          receiptUrl: input.receiptUrl || null,
          reference: input.reference?.trim() || null,
          notes: input.notes?.trim() || null,
          submittedById: userId,
        },
        include: expenseInclude,
      });
      return created;
    });

    if (input.submit) {
      await WorkflowService.requestApproval({
        entityType: 'expense',
        entityId: expense.id,
        title: `Expense ${expense.expenseNumber} — ${expense.payeeName} (${totalAmount.toFixed(2)})`,
        requestedById: userId,
        metadata: { expenseNumber: expense.expenseNumber, totalAmount },
        companyId,
      }).catch(() => undefined);

      await OutboxService.publish(prisma, {
        companyId,
        eventType: 'expense.submitted',
        aggregateType: 'Expense',
        aggregateId: expense.id,
        payload: { expenseNumber: expense.expenseNumber, totalAmount },
      });
    }

    return expense;
  }

  static async update(id: string, input: Partial<CreateExpenseInput>, userId: string) {
    const existing = await this.get(id);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) {
      throw new AppError('Only draft or rejected expenses can be edited', 400);
    }
    if (existing.submittedById !== userId) {
      // allow finance managers via route authorize — still restrict non-owner drafts lightly
    }

    const amount = input.amount != null ? Number(input.amount) : Number(existing.amount);
    const vatAmount =
      input.vatAmount != null ? Number(input.vatAmount) : Number(existing.vatAmount);
    if (!(amount > 0)) throw new AppError('Amount must be greater than zero', 400);
    if (vatAmount < 0) throw new AppError('VAT amount cannot be negative', 400);

    if (input.categoryAccountId) {
      const category = await prisma.account.findFirst({
        where: { id: input.categoryAccountId, type: 'EXPENSE', isActive: true },
      });
      if (!category) throw new AppError('Select a valid expense account category', 400);
    }

    return prisma.expense.update({
      where: { id },
      data: {
        expenseDate: input.expenseDate ? new Date(input.expenseDate) : undefined,
        categoryAccountId: input.categoryAccountId,
        payeeName: input.payeeName?.trim(),
        supplierId: input.supplierId === undefined ? undefined : input.supplierId || null,
        description: input.description?.trim(),
        amount,
        vatAmount,
        totalAmount: amount + vatAmount,
        paymentMethod: input.paymentMethod
          ? input.paymentMethod.toUpperCase()
          : undefined,
        receiptUrl: input.receiptUrl === undefined ? undefined : input.receiptUrl,
        reference: input.reference === undefined ? undefined : input.reference?.trim() || null,
        notes: input.notes === undefined ? undefined : input.notes?.trim() || null,
        status: 'DRAFT',
        rejectionReason: null,
      },
      include: expenseInclude,
    });
  }

  /** Attach / replace receipt without changing status (works after submit-for-approval). */
  static async attachReceipt(id: string, receiptUrl: string) {
    const expense = await this.get(id);
    if (!['DRAFT', 'REJECTED', 'PENDING_APPROVAL'].includes(expense.status)) {
      throw new AppError('Receipt can only be attached before the expense is posted', 400);
    }
    return prisma.expense.update({
      where: { id },
      data: { receiptUrl },
      include: expenseInclude,
    });
  }

  static async submit(id: string, userId: string) {
    const expense = await this.get(id);
    if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
      throw new AppError('Expense cannot be submitted in its current status', 400);
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL', rejectionReason: null },
      include: expenseInclude,
    });

    await WorkflowService.requestApproval({
      entityType: 'expense',
      entityId: updated.id,
      title: `Expense ${updated.expenseNumber} — ${updated.payeeName} (${Number(updated.totalAmount).toFixed(2)})`,
      requestedById: userId,
      metadata: {
        expenseNumber: updated.expenseNumber,
        totalAmount: Number(updated.totalAmount),
      },
    }).catch(() => undefined);

    await OutboxService.publish(prisma, {
      companyId: updated.companyId,
      eventType: 'expense.submitted',
      aggregateType: 'Expense',
      aggregateId: updated.id,
      payload: { expenseNumber: updated.expenseNumber },
    });

    return updated;
  }

  static async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    note?: string
  ) {
    const expense = await this.get(id);
    if (expense.status !== 'PENDING_APPROVAL') {
      throw new AppError('Only pending expenses can be approved or rejected', 400);
    }

    if (decision === 'REJECTED') {
      const rejected = await prisma.expense.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approvedById: userId,
          approvedAt: new Date(),
          rejectionReason: note?.trim() || 'Rejected',
        },
        include: expenseInclude,
      });
      await this.settleApprovalRequest(id, 'REJECTED', userId, note);
      return rejected;
    }

    const approved = await prisma.expense.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: userId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
      include: expenseInclude,
    });

    await this.settleApprovalRequest(id, 'APPROVED', userId, note);

    // Auto-post to GL after approval for a complete cash→P&L trail.
    return this.post(approved.id, userId);
  }

  /** Keep Approvals inbox in sync when deciding from Finance → Expenses. */
  private static async settleApprovalRequest(
    expenseId: string,
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    note?: string
  ) {
    await prisma.approvalRequest.updateMany({
      where: {
        entityType: 'expense',
        entityId: expenseId,
        status: 'PENDING',
      },
      data: {
        status: decision,
        decidedById: userId,
        decisionNote: note?.trim() || null,
        decidedAt: new Date(),
      },
    });
  }

  static async post(id: string, _userId: string) {
    const expense = await this.get(id);
    if (expense.status === 'POSTED') return expense;
    if (expense.status !== 'APPROVED') {
      throw new AppError('Expense must be approved before posting to the ledger', 400);
    }

    return prisma.$transaction(async (tx) => {
      const entry = await AccountingService.postOperatingExpense(tx, {
        id: expense.id,
        expenseNumber: expense.expenseNumber,
        expenseDate: expense.expenseDate,
        amount: Number(expense.amount),
        vatAmount: Number(expense.vatAmount),
        totalAmount: Number(expense.totalAmount),
        paymentMethod: expense.paymentMethod,
        categoryAccountId: expense.categoryAccountId,
        description: expense.description,
        payeeName: expense.payeeName,
      });

      const posted = await tx.expense.update({
        where: { id: expense.id },
        data: {
          status: 'POSTED',
          postedAt: new Date(),
          journalEntryId: entry.id,
        },
        include: expenseInclude,
      });

      await OutboxService.publish(tx, {
        companyId: expense.companyId,
        eventType: 'expense.posted',
        aggregateType: 'Expense',
        aggregateId: expense.id,
        payload: {
          expenseNumber: expense.expenseNumber,
          journalEntryId: entry.id,
          totalAmount: Number(expense.totalAmount),
        },
      });

      return posted;
    });
  }

  /** Approve+post in one step for users with finance:approve (e.g. petty cash). */
  static async approveAndPost(id: string, userId: string) {
    const expense = await this.get(id);
    if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(expense.status)) {
      throw new AppError('Expense cannot be posted in its current status', 400);
    }
    if (expense.status === 'POSTED') return expense;

    if (expense.status !== 'APPROVED') {
      await prisma.expense.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
          rejectionReason: null,
        },
      });
    }
    return this.post(id, userId);
  }

  static async void(id: string, userId: string, reason?: string) {
    const expense = await this.get(id);
    if (expense.status !== 'POSTED') {
      throw new AppError('Only posted expenses can be voided', 400);
    }
    if (!expense.journalEntryId) {
      throw new AppError('Posted expense is missing its journal link', 400);
    }

    return prisma.$transaction(async (tx) => {
      await AccountingService.reverseJournalEntry(
        tx,
        expense.journalEntryId!,
        reason || `Void expense ${expense.expenseNumber}`
      );
      const voided = await tx.expense.update({
        where: { id },
        data: {
          status: 'VOIDED',
          notes: [expense.notes, reason ? `Voided: ${reason}` : 'Voided']
            .filter(Boolean)
            .join('\n'),
          approvedById: userId,
        },
        include: expenseInclude,
      });

      await OutboxService.publish(tx, {
        companyId: expense.companyId,
        eventType: 'expense.voided',
        aggregateType: 'Expense',
        aggregateId: expense.id,
        payload: { expenseNumber: expense.expenseNumber },
      });

      return voided;
    });
  }

  static async softDelete(id: string) {
    const expense = await this.get(id);
    if (!['DRAFT', 'REJECTED'].includes(expense.status)) {
      throw new AppError('Only draft or rejected expenses can be deleted', 400);
    }
    await prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id };
  }

  static async summary(from?: Date, to?: Date) {
    const where: Prisma.ExpenseWhereInput = {
      deletedAt: null,
      status: 'POSTED',
      ...(from || to
        ? {
            expenseDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    const [agg, byCategory] = await Promise.all([
      prisma.expense.aggregate({
        where,
        _sum: { amount: true, vatAmount: true, totalAmount: true },
        _count: true,
      }),
      prisma.expense.groupBy({
        by: ['categoryAccountId'],
        where,
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    const accounts = await prisma.account.findMany({
      where: { id: { in: byCategory.map((r) => r.categoryAccountId) } },
      select: { id: true, code: true, name: true },
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    return {
      count: agg._count,
      amount: Number(agg._sum.amount || 0),
      vatAmount: Number(agg._sum.vatAmount || 0),
      totalAmount: Number(agg._sum.totalAmount || 0),
      byCategory: byCategory.map((row) => ({
        account: accountMap.get(row.categoryAccountId) || null,
        count: row._count,
        totalAmount: Number(row._sum.totalAmount || 0),
      })),
    };
  }
}
