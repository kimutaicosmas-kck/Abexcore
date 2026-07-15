import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { NotificationService } from './notification.service';

type TxClient = Prisma.TransactionClient;

export class InvoiceMaintenanceService {
  static async markOverdueInvoices(tx: TxClient = prisma): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const revertCandidates = await tx.invoice.findMany({
      where: {
        status: 'OVERDUE',
        dueDate: { gte: today },
      },
      select: { id: true, totalAmount: true, paidAmount: true },
    });

    for (const inv of revertCandidates) {
      const paid = Number(inv.paidAmount);
      const total = Number(inv.totalAmount);
      const nextStatus = paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
      await tx.invoice.update({
        where: { id: inv.id },
        data: { status: nextStatus },
      });
    }

    const overdueCandidates = await tx.invoice.findMany({
      where: {
        status: { in: ['UNPAID', 'PARTIAL'] },
        dueDate: { lt: today },
      },
      select: { id: true, invoiceNumber: true, type: true },
    });

    if (overdueCandidates.length === 0) return 0;

    const result = await tx.invoice.updateMany({
      where: {
        id: { in: overdueCandidates.map((inv) => inv.id) },
      },
      data: { status: 'OVERDUE' },
    });

    if (result.count > 0 && tx === prisma) {
      const salesCount = overdueCandidates.filter((inv) => inv.type === 'SALES').length;
      if (salesCount > 0) {
        await NotificationService.notifyRole(
          'Finance Officer',
          'OVERDUE_PAYMENT',
          `${salesCount} sales invoice(s) marked overdue`,
          'Review overdue receivables in Finance',
          '/finance'
        ).catch(() => undefined);
      }
    }

    return result.count;
  }
}
