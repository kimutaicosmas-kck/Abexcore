import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { generateNumber } from '../utils/date';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

export class AccountingService {
  static async getAccountByCode(tx: TxClient, code: string) {
    const account = await tx.account.findUnique({ where: { code } });
    if (!account) throw new AppError(`Account ${code} not found — run seed to create chart of accounts`, 400);
    return account;
  }

  static async createJournalEntry(
    tx: TxClient,
    opts: {
      description: string;
      reference?: string;
      lines: { accountCode: string; debit: number; credit: number; description?: string }[];
    }
  ) {
    const count = await tx.journalEntry.count();
    const entryNumber = generateNumber('JE', count + 1);

    const codes = [...new Set(opts.lines.map((line) => line.accountCode))];
    const accounts = await tx.account.findMany({ where: { code: { in: codes } } });
    const accountByCode = new Map(accounts.map((account) => [account.code, account]));

    const lines = opts.lines.map((line) => {
      const account = accountByCode.get(line.accountCode);
      if (!account) {
        throw new AppError(`Account ${line.accountCode} not found — run seed to create chart of accounts`, 400);
      }
      return {
        accountId: account.id,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
      };
    });

    const entry = await tx.journalEntry.create({
      data: {
        entryNumber,
        description: opts.description,
        reference: opts.reference,
        isPosted: true,
        lines: { create: lines },
      },
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

  static async postSalesInvoice(tx: TxClient, invoice: { invoiceNumber: string; subtotal: number; taxAmount: number; totalAmount: number }) {
    const subtotal = Number(invoice.subtotal);
    const tax = Number(invoice.taxAmount);
    const total = Number(invoice.totalAmount);

    return this.createJournalEntry(tx, {
      description: `Sales invoice ${invoice.invoiceNumber}`,
      reference: invoice.invoiceNumber,
      lines: [
        { accountCode: '1200', debit: total, credit: 0, description: 'Accounts receivable' },
        { accountCode: '4100', debit: 0, credit: subtotal, description: 'Sales revenue' },
        { accountCode: '2200', debit: 0, credit: tax, description: 'VAT payable' },
      ],
    });
  }

  static async postPayment(
    tx: TxClient,
    payment: { paymentNumber: string; amount: number; method?: string | null },
    invoiceNumber?: string
  ) {
    const amount = Number(payment.amount);
    const cashCode = payment.method === 'MPESA' ? '1100' : '1100';

    return this.createJournalEntry(tx, {
      description: `Payment ${payment.paymentNumber}${invoiceNumber ? ` for ${invoiceNumber}` : ''}`,
      reference: payment.paymentNumber,
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
    }
  ) {
    const gross = Number(record.basicSalary) + Number(record.allowances);
    const netPay = Number(record.netPay);
    const deductions =
      Number(record.paye) +
      Number(record.nssf) +
      Number(record.shif) +
      Number(record.housingLevy);

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

    return this.createJournalEntry(tx, {
      description: `Payroll ${record.periodLabel} - ${record.employeeName}`,
      reference: record.id,
      lines,
    });
  }

  static async postGoodsReceipt(
    tx: TxClient,
    receipt: { grnNumber: string; items: { quantity: number; unitCost: number }[] }
  ) {
    const total = receipt.items.reduce(
      (sum, item) => sum + Number(item.quantity) * Number(item.unitCost),
      0
    );
    if (total <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Goods receipt ${receipt.grnNumber}`,
      reference: receipt.grnNumber,
      lines: [
        { accountCode: '1300', debit: total, credit: 0, description: 'Inventory received' },
        { accountCode: '2150', debit: 0, credit: total, description: 'Goods received not invoiced' },
      ],
    });
  }

  static async postPurchaseInvoice(
    tx: TxClient,
    invoice: { invoiceNumber: string; subtotal: number; taxAmount: number; totalAmount: number }
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
      lines,
    });
  }

  static async postSupplierPayment(
    tx: TxClient,
    payment: { paymentNumber: string; amount: number; method?: string | null },
    invoiceNumber?: string
  ) {
    const amount = Number(payment.amount);

    return this.createJournalEntry(tx, {
      description: `Supplier payment ${payment.paymentNumber}${invoiceNumber ? ` for ${invoiceNumber}` : ''}`,
      reference: payment.paymentNumber,
      lines: [
        { accountCode: '2100', debit: amount, credit: 0, description: 'Clear payable' },
        { accountCode: '1100', debit: 0, credit: amount, description: 'Cash disbursed' },
      ],
    });
  }

  static async postProductionCosting(
    tx: TxClient,
    opts: { orderNumber: string; materialCost: number; finishedGoodsCost: number }
  ) {
    const materialCost = Number(opts.materialCost);
    const finishedGoodsCost = Number(opts.finishedGoodsCost);
    if (materialCost <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Production costing ${opts.orderNumber}`,
      reference: opts.orderNumber,
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
    opts: { reference: string; amount: number }
  ) {
    const amount = Number(opts.amount);
    if (amount <= 0) return null;

    return this.createJournalEntry(tx, {
      description: `Cost of goods sold — ${opts.reference}`,
      reference: opts.reference,
      lines: [
        { accountCode: '5100', debit: amount, credit: 0, description: 'Cost of goods sold' },
        { accountCode: '1300', debit: 0, credit: amount, description: 'Inventory issued to customer' },
      ],
    });
  }

  static async postInventoryAdjustment(
    tx: TxClient,
    opts: { reference: string; amount: number; direction: 'increase' | 'decrease'; reason?: string }
  ) {
    const amount = Number(opts.amount);
    if (amount <= 0) return null;

    const description =
      opts.reason ?? `Inventory adjustment — ${opts.reference}`;

    if (opts.direction === 'increase') {
      return this.createJournalEntry(tx, {
        description,
        reference: opts.reference,
        lines: [
          { accountCode: '1300', debit: amount, credit: 0, description: 'Inventory increase' },
          { accountCode: '5200', debit: 0, credit: amount, description: 'Inventory count gain' },
        ],
      });
    }

    return this.createJournalEntry(tx, {
      description,
      reference: opts.reference,
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
}
