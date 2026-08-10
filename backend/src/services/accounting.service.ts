import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { AppError } from '../middleware/errorHandler';
import { injectTenantData } from '../utils/tenant';

type TxClient = Prisma.TransactionClient;

type JournalLineInput = {
  accountCode?: string;
  accountId?: string;
  debit: number;
  credit: number;
  description?: string;
};

export class AccountingService {
  static assertBalanced(lines: { debit: number; credit: number }[]) {
    const totalDebit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.009) {
      throw new AppError(
        `Journal entry is not balanced (debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)})`,
        400
      );
    }
    if (totalDebit <= 0) {
      throw new AppError('Journal entry must have positive debits and credits', 400);
    }
  }

  static async resolveCashAccountCode(tx: TxClient, method?: string | null): Promise<string> {
    const preferred = (() => {
      switch ((method || 'CASH').toUpperCase()) {
        case 'MPESA':
          return '1110';
        case 'BANK':
        case 'BANK_TRANSFER':
        case 'CHEQUE':
          return '1120';
        default:
          return '1100';
      }
    })();

    const account = await tx.account.findFirst({ where: { code: preferred, isActive: true } });
    return account ? preferred : '1100';
  }

  static async getAccountByCode(tx: TxClient, code: string) {
    const account = await tx.account.findFirst({ where: { code } });
    if (!account) throw new AppError(`Account ${code} not found — chart of accounts may not be set up for this company`, 400);
    return account;
  }

  /** Ensure staff advances receivable exists for tenants created before this account was added. */
  static async ensureStaffAdvanceAccount(tx: TxClient) {
    const existing = await tx.account.findFirst({ where: { code: '1210' } });
    if (existing) return existing;
    return tx.account.create({
      data: injectTenantData({
        code: '1210',
        name: 'Staff Salary Advances',
        type: 'ASSET',
      }),
    });
  }

  static async resolveJournalLines(tx: TxClient, lines: JournalLineInput[]) {
    this.assertBalanced(lines);

    const accountIds = lines.filter((line) => line.accountId).map((line) => line.accountId!);
    const accountCodes = lines.filter((line) => line.accountCode).map((line) => line.accountCode!);

    const accounts = await tx.account.findMany({
      where: {
        OR: [
          ...(accountIds.length ? [{ id: { in: accountIds } }] : []),
          ...(accountCodes.length ? [{ code: { in: accountCodes } }] : []),
        ],
      },
    });

    const byId = new Map(accounts.map((account) => [account.id, account]));
    const byCode = new Map(accounts.map((account) => [account.code, account]));

    return lines.map((line) => {
      const account = line.accountId ? byId.get(line.accountId) : byCode.get(line.accountCode || '');
      if (!account) {
        throw new AppError(`Account not found for journal line`, 400);
      }
      return {
        accountId: account.id,
        debit: Number(line.debit),
        credit: Number(line.credit),
        description: line.description,
      };
    });
  }

  static async createJournalEntry(
    tx: TxClient,
    opts: {
      description: string;
      reference?: string;
      sourceType?: string;
      sourceId?: string;
      reversalOfId?: string;
      date?: Date;
      lines: JournalLineInput[];
    }
  ) {
    const lines = await this.resolveJournalLines(tx, opts.lines);
    const count = await tx.journalEntry.count();
    const entryNumber = generateNumber('JE', count + 1);

    const entry = await tx.journalEntry.create({
      data: injectTenantData({
        entryNumber,
        date: opts.date || new Date(),
        description: opts.description,
        reference: opts.reference,
        sourceType: opts.sourceType,
        sourceId: opts.sourceId,
        reversalOfId: opts.reversalOfId,
        isPosted: true,
        lines: { create: lines },
      }),
      include: { lines: { include: { account: true } } },
    });

    const balanceDeltas = new Map<string, number>();
    for (const line of lines) {
      const net = line.debit - line.credit;
      balanceDeltas.set(line.accountId, (balanceDeltas.get(line.accountId) || 0) + net);
    }

    await Promise.all(
      [...balanceDeltas.entries()].map(([accountId, net]) =>
        tx.account.update({
          where: { id: accountId },
          data: { balance: { increment: net } },
        })
      )
    );

    return entry;
  }

  static async reverseJournalEntry(
    tx: TxClient,
    entryId: string,
    reason = 'Reversal entry'
  ) {
    const original = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: { lines: { include: { account: true } } },
    });
    if (!original) throw new AppError('Journal entry not found', 404);

    return this.createJournalEntry(tx, {
      description: `${reason}: ${original.description || original.entryNumber}`,
      reference: original.entryNumber,
      sourceType: 'REVERSAL',
      sourceId: original.id,
      reversalOfId: original.id,
      lines: original.lines.map((line) => ({
        accountCode: line.account.code,
        debit: Number(line.credit),
        credit: Number(line.debit),
        description: reason,
      })),
    });
  }

  static async postSalesInvoice(tx: TxClient, invoice: { invoiceNumber: string; subtotal: number; taxAmount: number; totalAmount: number; id?: string }) {
    const subtotal = Number(invoice.subtotal);
    const tax = Number(invoice.taxAmount);
    const total = Number(invoice.totalAmount);

    const lines: JournalLineInput[] = [
      { accountCode: '1200', debit: total, credit: 0, description: 'Accounts receivable' },
      { accountCode: '4100', debit: 0, credit: subtotal, description: 'Sales revenue' },
    ];
    // Non-VAT invoices post with taxAmount = 0 — omit zero VAT line.
    if (tax > 0.009) {
      lines.push({ accountCode: '2200', debit: 0, credit: tax, description: 'VAT payable' });
    }

    return this.createJournalEntry(tx, {
      description: `Sales invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      sourceType: 'SALES_INVOICE',
      sourceId: invoice.id,
      lines,
    });
  }

  static async postPayment(
    tx: TxClient,
    payment: { paymentNumber: string; amount: number; method?: string | null; id?: string },
    invoiceNumber?: string
  ) {
    const amount = Number(payment.amount);
    const cashCode = await this.resolveCashAccountCode(tx, payment.method);

    return this.createJournalEntry(tx, {
      description: `Payment ${payment.paymentNumber}${invoiceNumber ? ` for ${invoiceNumber}` : ''}`,
      reference: payment.paymentNumber,
      sourceType: 'PAYMENT',
      sourceId: payment.id,
      lines: [
        { accountCode: cashCode, debit: amount, credit: 0, description: 'Cash received' },
        { accountCode: '1200', debit: 0, credit: amount, description: 'Clear receivable' },
      ],
    });
  }

  static async postPayrollPayment(
    tx: TxClient,
    record: {
      id: string;
      employeeName: string;
      periodLabel: string;
      basicSalary: number;
      allowances: number;
      paye: number;
      nssf: number;
      shif: number;
      housingLevy: number;
      netPay: number;
      /** Optional — when provided, recovery is posted inside the payroll JE. */
      advanceDeduction?: number;
    }
  ) {
    const gross = Number(record.basicSalary) + Number(record.allowances);
    const netPay = Number(record.netPay);
    const statutory =
      Number(record.paye) +
      Number(record.nssf) +
      Number(record.shif) +
      Number(record.housingLevy);
    // Advance recovery is posted separately via postSalaryAdvanceRepayment to keep
    // the staff-advances receivable ledger accurate per advance document.
    const deductions = statutory;

    const lines = [
      {
        accountCode: '5200',
        debit: gross,
        credit: 0,
        description: `Salary expense - ${record.employeeName}`,
      },
      { accountCode: '1100', debit: 0, credit: netPay, description: 'Net pay disbursed' },
    ];

    if (deductions > 0) {
      lines.push({
        accountCode: '2100',
        debit: 0,
        credit: deductions,
        description: 'Statutory payroll deductions payable',
      });
    }

    // Bridge: cash not paid out for advance recovery must balance the JE.
    const advanceDeduction = Number(record.advanceDeduction || 0);
    if (advanceDeduction > 0) {
      await this.ensureStaffAdvanceAccount(tx);
      lines.push({
        accountCode: '1210',
        debit: 0,
        credit: advanceDeduction,
        description: 'Salary advance recovery (payroll)',
      });
    }

    return this.createJournalEntry(tx, {
      description: `Payroll ${record.periodLabel} - ${record.employeeName}`,
      reference: record.id,
      sourceType: 'PAYROLL',
      sourceId: record.id,
      lines,
    });
  }

  static async postSalaryAdvanceDisbursement(
    tx: TxClient,
    advance: {
      id: string;
      advanceNo: string;
      amount: number;
      employeeName: string;
      method?: string;
    }
  ) {
    const amount = Number(advance.amount);
    if (amount <= 0) return null;
    await this.ensureStaffAdvanceAccount(tx);
    const cashCode = await this.resolveCashAccountCode(tx, advance.method);

    return this.createJournalEntry(tx, {
      description: `Salary advance ${advance.advanceNo} - ${advance.employeeName}`,
      reference: advance.advanceNo,
      sourceType: 'SALARY_ADVANCE',
      sourceId: advance.id,
      lines: [
        {
          accountCode: '1210',
          debit: amount,
          credit: 0,
          description: 'Staff salary advance receivable',
        },
        {
          accountCode: cashCode,
          debit: 0,
          credit: amount,
          description: 'Advance disbursed to employee',
        },
      ],
    });
  }

  static async postSalaryAdvanceRepayment(
    tx: TxClient,
    repayment: {
      id: string;
      advanceNo: string;
      amount: number;
      employeeName: string;
      method?: string;
      sourceId?: string;
    }
  ) {
    const amount = Number(repayment.amount);
    if (amount <= 0) return null;

    // Payroll recoveries are already credited to 1210 inside the payroll JE.
    if ((repayment.method || '').toUpperCase() === 'PAYROLL') {
      return null;
    }

    await this.ensureStaffAdvanceAccount(tx);
    const cashCode = await this.resolveCashAccountCode(tx, repayment.method);
    return this.createJournalEntry(tx, {
      description: `Advance repayment ${repayment.advanceNo} - ${repayment.employeeName}`,
      reference: repayment.advanceNo,
      sourceType: 'SALARY_ADVANCE_REPAYMENT',
      sourceId: repayment.sourceId || repayment.id,
      lines: [
        {
          accountCode: cashCode,
          debit: amount,
          credit: 0,
          description: 'Cash received for advance repayment',
        },
        {
          accountCode: '1210',
          debit: 0,
          credit: amount,
          description: 'Clear staff salary advance',
        },
      ],
    });
  }

  static async postSalaryAdvanceWriteOff(
    tx: TxClient,
    advance: { id: string; advanceNo: string; amount: number; employeeName: string }
  ) {
    const amount = Number(advance.amount);
    if (amount <= 0) return null;
    await this.ensureStaffAdvanceAccount(tx);

    return this.createJournalEntry(tx, {
      description: `Advance write-off ${advance.advanceNo} - ${advance.employeeName}`,
      reference: advance.advanceNo,
      sourceType: 'SALARY_ADVANCE_WRITEOFF',
      sourceId: advance.id,
      lines: [
        {
          accountCode: '5200',
          debit: amount,
          credit: 0,
          description: 'Salary advance written off',
        },
        {
          accountCode: '1210',
          debit: 0,
          credit: amount,
          description: 'Clear staff salary advance',
        },
      ],
    });
  }

  static async reverseSalaryAdvanceDisbursement(
    tx: TxClient,
    advance: { id: string; advanceNo: string; amount: number; employeeName: string; method?: string }
  ) {
    const amount = Number(advance.amount);
    if (amount <= 0) return null;
    await this.ensureStaffAdvanceAccount(tx);
    const cashCode = await this.resolveCashAccountCode(tx, advance.method);

    return this.createJournalEntry(tx, {
      description: `Reverse advance ${advance.advanceNo} - ${advance.employeeName}`,
      reference: advance.advanceNo,
      sourceType: 'SALARY_ADVANCE_REVERSE',
      sourceId: advance.id,
      lines: [
        {
          accountCode: cashCode,
          debit: amount,
          credit: 0,
          description: 'Advance funds returned / cancelled',
        },
        {
          accountCode: '1210',
          debit: 0,
          credit: amount,
          description: 'Clear staff salary advance',
        },
      ],
    });
  }

  static async postGoodsReceipt(
    tx: TxClient,
    receipt: { grnNumber: string; id?: string; items: { quantity: number; unitCost: number }[] }
  ) {
    const total = receipt.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitCost),
      0
    );
    if (total <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Goods receipt ${receipt.grnNumber}`,
      reference: receipt.grnNumber,
      sourceType: 'GOODS_RECEIPT',
      sourceId: receipt.id,
      lines: [
        { accountCode: '1300', debit: total, credit: 0, description: 'Inventory received' },
        { accountCode: '2150', debit: 0, credit: total, description: 'Goods received not invoiced' },
      ],
    });
  }

  static async postPurchaseInvoice(
    tx: TxClient,
    invoice: { invoiceNumber: string; subtotal: number; taxAmount: number; totalAmount: number; id?: string }
  ) {
    const subtotal = Number(invoice.subtotal);
    const tax = Number(invoice.taxAmount);
    const total = Number(invoice.totalAmount);

    const lines = [
      { accountCode: '2150', debit: subtotal, credit: 0, description: 'Clear GRNI' },
      { accountCode: '2100', debit: 0, credit: total, description: 'Accounts payable' },
    ];

    if (tax > 0) {
      lines.splice(1, 0, {
        accountCode: '5200',
        debit: tax,
        credit: 0,
        description: 'Purchase tax / non-recoverable VAT',
      });
    }

    return this.createJournalEntry(tx, {
      description: `Purchase invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      sourceType: 'PURCHASE_INVOICE',
      sourceId: invoice.id,
      lines,
    });
  }

  static async postSupplierPayment(
    tx: TxClient,
    payment: { paymentNumber: string; amount: number; method?: string | null; id?: string },
    invoiceNumber?: string
  ) {
    const amount = Number(payment.amount);
    const cashCode = await this.resolveCashAccountCode(tx, payment.method);

    return this.createJournalEntry(tx, {
      description: `Supplier payment ${payment.paymentNumber}${invoiceNumber ? ` for ${invoiceNumber}` : ''}`,
      reference: payment.paymentNumber,
      sourceType: 'SUPPLIER_PAYMENT',
      sourceId: payment.id,
      lines: [
        { accountCode: '2100', debit: amount, credit: 0, description: 'Clear payable' },
        { accountCode: cashCode, debit: 0, credit: amount, description: 'Cash disbursed' },
      ],
    });
  }

  static async postProductionCosting(
    tx: TxClient,
    opts: { orderNumber: string; materialCost: number; finishedGoodsCost: number; id?: string }
  ) {
    const materialCost = Number(opts.materialCost);
    const finishedGoodsCost = Number(opts.finishedGoodsCost);
    if (materialCost <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Production costing ${opts.orderNumber}`,
      reference: opts.orderNumber,
      sourceType: 'PRODUCTION',
      sourceId: opts.id,
      lines: [
        {
          accountCode: '1300',
          debit: finishedGoodsCost,
          credit: 0,
          description: 'Capitalize finished goods inventory',
        },
        {
          accountCode: '1300',
          debit: 0,
          credit: materialCost,
          description: 'Raw materials consumed',
        },
      ],
    });
  }

  static async postCostOfGoodsSold(
    tx: TxClient,
    opts: { reference: string; amount: number; sourceId?: string }
  ) {
    const amount = Number(opts.amount);
    if (amount <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Cost of goods sold — ${opts.reference}`,
      reference: opts.reference,
      sourceType: 'COGS',
      sourceId: opts.sourceId,
      lines: [
        { accountCode: '5100', debit: amount, credit: 0, description: 'Cost of goods sold' },
        { accountCode: '1300', debit: 0, credit: amount, description: 'Inventory issued to customer' },
      ],
    });
  }

  static async postInventoryAdjustment(
    tx: TxClient,
    opts: { reference: string; amount: number; direction: 'increase' | 'decrease'; reason?: string; sourceId?: string }
  ) {
    const amount = Number(opts.amount);
    if (amount <= 0) return null;

    const description =
      opts.reason ?? `Inventory adjustment — ${opts.reference}`;

    if (opts.direction === 'increase') {
      return this.createJournalEntry(tx, {
        description,
        reference: opts.reference,
        sourceType: 'INVENTORY_ADJUSTMENT',
        sourceId: opts.sourceId,
        lines: [
          { accountCode: '1300', debit: amount, credit: 0, description: 'Inventory increase' },
          { accountCode: '5200', debit: 0, credit: amount, description: 'Inventory count gain' },
        ],
      });
    }

    return this.createJournalEntry(tx, {
      description,
      reference: opts.reference,
      sourceType: 'INVENTORY_ADJUSTMENT',
      sourceId: opts.sourceId,
      lines: [
        { accountCode: '5200', debit: amount, credit: 0, description: 'Inventory shrinkage' },
        { accountCode: '1300', debit: 0, credit: amount, description: 'Inventory decrease' },
      ],
    });
  }

  static async postInventoryTransfer(
    tx: TxClient,
    opts: {
      reference: string;
      amount: number;
      fromWarehouseCode: string;
      toWarehouseCode: string;
      notes?: string;
      sourceId?: string;
    }
  ) {
    const amount = Number(opts.amount);
    if (amount <= 0) return null;

    const description =
      opts.notes ??
      `Inventory transfer ${opts.fromWarehouseCode} → ${opts.toWarehouseCode}`;

    return this.createJournalEntry(tx, {
      description,
      reference: opts.reference,
      sourceType: 'INVENTORY_TRANSFER',
      sourceId: opts.sourceId,
      lines: [
        {
          accountCode: '1300',
          debit: amount,
          credit: 0,
          description: `Transfer in — ${opts.toWarehouseCode}`,
        },
        {
          accountCode: '1300',
          debit: 0,
          credit: amount,
          description: `Transfer out — ${opts.fromWarehouseCode}`,
        },
      ],
    });
  }

  /** Sum ledger activity for an account in a period (respects normal balance side). */
  static async getAccountActivityInPeriod(code: string, start: Date, end: Date) {
    const account = await prisma.account.findFirst({ where: { code, isActive: true } });
    if (!account) return 0;

    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        accountId: account.id,
        journalEntry: { date: { gte: start, lte: end }, isPosted: true },
      },
      _sum: { debit: true, credit: true },
    });

    const debit = Number(agg._sum.debit || 0);
    const credit = Number(agg._sum.credit || 0);

    if (account.type === 'INCOME') return credit - debit;
    if (account.type === 'EXPENSE') return debit - credit;
    return debit - credit;
  }

  static async getTrialBalance(asOfDate?: Date) {
    const accounts = await prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });

    const rows = accounts.map((account) => {
      const balance = Number(account.balance);
      const isDebitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
      const debit = isDebitNormal ? Math.max(balance, 0) : Math.max(-balance, 0);
      const credit = isDebitNormal ? Math.max(-balance, 0) : Math.max(balance, 0);
      return {
        code: account.code,
        name: account.name,
        type: account.type,
        debit,
        credit,
      };
    });

    const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
    const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);

    return {
      asOf: asOfDate || new Date(),
      accounts: rows,
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }

  static async getGeneralLedger(accountCode: string, startDate?: Date, endDate?: Date) {
    const account = await prisma.account.findFirst({ where: { code: accountCode, isActive: true } });
    if (!account) throw new AppError(`Account ${accountCode} not found`, 404);

    const start = startDate || new Date(new Date().getFullYear(), 0, 1);
    const end = endDate || new Date();

    const lines = await prisma.journalEntryLine.findMany({
      where: {
        accountId: account.id,
        journalEntry: { date: { gte: start, lte: end }, isPosted: true },
      },
      include: {
        journalEntry: {
          select: {
            entryNumber: true,
            date: true,
            description: true,
            reference: true,
            sourceType: true,
            sourceId: true,
          },
        },
      },
    });

    lines.sort((a, b) => {
      const dateDiff = a.journalEntry.date.getTime() - b.journalEntry.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      return a.journalEntry.entryNumber.localeCompare(b.journalEntry.entryNumber);
    });

    let running = 0;
    const entries = lines.map((line) => {
      const debit = Number(line.debit);
      const credit = Number(line.credit);
      running += debit - credit;
      return {
        entryNumber: line.journalEntry.entryNumber,
        date: line.journalEntry.date,
        description: line.description || line.journalEntry.description,
        reference: line.journalEntry.reference,
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        debit,
        credit,
        runningBalance: running,
      };
    });

    return {
      account: { code: account.code, name: account.name, type: account.type },
      period: { start, end },
      openingBalance: Number(account.balance) - running,
      closingBalance: Number(account.balance),
      entries,
    };
  }
}
