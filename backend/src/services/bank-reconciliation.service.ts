import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export type BankStatementCsvLine = {
  transactionDate: Date;
  description?: string;
  reference?: string;
  amount: number;
};

export class BankReconciliationService {
  static parseCsv(csvText: string): BankStatementCsvLine[] {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new AppError('CSV must include a header row and at least one transaction', 400);
    }

    const header = lines[0].toLowerCase();
    const hasHeader =
      header.includes('date') && (header.includes('amount') || header.includes('debit'));

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const results: BankStatementCsvLine[] = [];

    for (const line of dataLines) {
      const parts = line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) continue;

      const dateStr = parts[0];
      const parsedDate = new Date(dateStr);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new AppError(`Invalid date in CSV row: ${dateStr}`, 400);
      }

      let amount = 0;
      let description = '';
      let reference = '';

      if (parts.length >= 4) {
        description = parts[1];
        reference = parts[2];
        amount = Number(parts[3]);
      } else if (parts.length === 3) {
        description = parts[1];
        amount = Number(parts[2]);
      } else {
        amount = Number(parts[1]);
      }

      if (Number.isNaN(amount)) {
        throw new AppError(`Invalid amount in CSV row: ${line}`, 400);
      }

      results.push({
        transactionDate: parsedDate,
        description: description || undefined,
        reference: reference || undefined,
        amount,
      });
    }

    if (results.length === 0) {
      throw new AppError('No valid transactions found in CSV', 400);
    }

    return results;
  }

  static async importStatement(
    opts: {
      csvText: string;
      periodStart: Date;
      periodEnd: Date;
      openingBalance?: number;
      closingBalance?: number;
      bankAccountCode?: string;
      notes?: string;
    },
    tx: TxClient = prisma
  ) {
    const parsed = this.parseCsv(opts.csvText);
    const count = await tx.bankStatement.count();
    const statementNumber = generateNumber('BST', count + 1);

    const statement = await tx.bankStatement.create({
      data: {
        statementNumber,
        bankAccountCode: opts.bankAccountCode || '1100',
        periodStart: opts.periodStart,
        periodEnd: opts.periodEnd,
        openingBalance: opts.openingBalance ?? 0,
        closingBalance: opts.closingBalance ?? 0,
        notes: opts.notes,
        lines: {
          create: parsed.map((line) => ({
            transactionDate: line.transactionDate,
            description: line.description,
            reference: line.reference,
            amount: line.amount,
          })),
        },
      },
      include: { lines: true },
    });

    return statement;
  }

  static async autoMatchPayments(statementId: string, tx: TxClient = prisma) {
    const statement = await tx.bankStatement.findUnique({
      where: { id: statementId },
      include: { lines: { where: { matchStatus: 'UNMATCHED' } } },
    });
    if (!statement) throw new AppError('Bank statement not found', 404);

    const unreconciled = await tx.payment.findMany({
      where: {
        isReconciled: false,
        method: { in: ['BANK_TRANSFER', 'CHEQUE', 'MPESA'] },
        statementLine: null,
      },
    });

    let matched = 0;

    for (const line of statement.lines) {
      const lineAmount = Number(line.amount);
      const lineDate = new Date(line.transactionDate);
      const windowStart = new Date(lineDate);
      windowStart.setDate(windowStart.getDate() - 3);
      const windowEnd = new Date(lineDate);
      windowEnd.setDate(windowEnd.getDate() + 3);

      const candidate = unreconciled.find((payment) => {
        const payAmount = Number(payment.amount);
        const payDate = new Date(payment.paymentDate);
        const amountMatch = Math.abs(payAmount - Math.abs(lineAmount)) < 0.01;
        const dateMatch = payDate >= windowStart && payDate <= windowEnd;
        const refMatch =
          !line.reference ||
          payment.reference?.includes(line.reference) ||
          payment.bankReference?.includes(line.reference) ||
          line.reference.includes(payment.reference || '');

        return amountMatch && dateMatch && (!line.reference || refMatch);
      });

      if (!candidate) continue;

      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          matchStatus: 'MATCHED',
          matchedPaymentId: candidate.id,
        },
      });

      await tx.payment.update({
        where: { id: candidate.id },
        data: {
          isReconciled: true,
          reconciledAt: new Date(),
          bankReference: line.reference || candidate.bankReference || undefined,
        },
      });

      matched += 1;
      const idx = unreconciled.findIndex((p) => p.id === candidate.id);
      if (idx >= 0) unreconciled.splice(idx, 1);
    }

    return { matched, unmatchedLines: statement.lines.length - matched };
  }

  static async getReport() {
    const [bankAccount, unreconciled, latestStatement, unmatchedLines] = await Promise.all([
      prisma.account.findFirst({ where: { code: '1100' } }),
      prisma.payment.findMany({
        where: { isReconciled: false, method: { in: ['BANK_TRANSFER', 'CHEQUE', 'MPESA'] } },
        include: { invoice: { select: { invoiceNumber: true, type: true } } },
        orderBy: { paymentDate: 'desc' },
        take: 100,
      }),
      prisma.bankStatement.findFirst({
        orderBy: { importedAt: 'desc' },
        include: { lines: true },
      }),
      prisma.bankStatementLine.count({ where: { matchStatus: 'UNMATCHED' } }),
    ]);

    const glBalance = Number(bankAccount?.balance || 0);
    const statementBalance = latestStatement ? Number(latestStatement.closingBalance) : null;
    const variance =
      statementBalance !== null ? glBalance - statementBalance : null;

    return {
      bankBalance: glBalance,
      statementBalance,
      variance,
      latestStatement,
      unmatchedStatementLines: unmatchedLines,
      unreconciled,
      unreconciledTotal: unreconciled.reduce((sum, payment) => sum + Number(payment.amount), 0),
      reconciled: await prisma.payment.findMany({
        where: { isReconciled: true },
        include: { invoice: { select: { invoiceNumber: true } } },
        orderBy: { reconciledAt: 'desc' },
        take: 50,
      }),
    };
  }
}
