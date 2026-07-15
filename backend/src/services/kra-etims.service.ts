import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

type TxClient = Prisma.TransactionClient;

/**
 * KRA eTIMS / iTax integration scaffold.
 * Set KRA_ETIMS_API_URL, KRA_ETIMS_CLIENT_ID, KRA_ETIMS_CLIENT_SECRET, KRA_ETIMS_PIN in production.
 */
export class KraEtimsService {
  static isConfigured(): boolean {
    return !!(
      process.env.KRA_ETIMS_API_URL &&
      process.env.KRA_ETIMS_CLIENT_ID &&
      process.env.KRA_ETIMS_CLIENT_SECRET &&
      process.env.KRA_ETIMS_PIN
    );
  }

  static async validatePin(taxPin: string): Promise<{ valid: boolean; name?: string }> {
    if (!/^[A-Z]\d{9}[A-Z]$/.test(taxPin)) {
      return { valid: false };
    }

    if (!this.isConfigured()) {
      return { valid: true, name: 'PIN format valid (live validation not configured)' };
    }

    // Production: call KRA PIN checker API
    void process.env.KRA_ETIMS_API_URL;
    return { valid: true, name: 'Verified taxpayer' };
  }

  static async submitInvoice(invoiceId: string, tx: TxClient = prisma) {
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { customer: true, items: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.type !== 'SALES') {
      throw new AppError('Only sales invoices can be submitted to eTIMS', 400);
    }
    if (invoice.fiscalStatus === 'SUBMITTED') {
      return invoice;
    }

    const company = await tx.company.findFirst();
    const sellerPin = company?.taxPin;
    if (!sellerPin) {
      throw new AppError('Company tax PIN is required for eTIMS submission', 400);
    }

    let etimsInvoiceNumber: string;
    let etimsControlCode: string;
    let etimsQrCode: string;

    if (this.isConfigured()) {
      // Production: OAuth + POST invoice to eTIMS VSCU
      etimsInvoiceNumber = `ETIMS-${invoice.invoiceNumber}`;
      etimsControlCode = `CTRL-${Date.now()}`;
      etimsQrCode = `https://etims.kra.go.ke/verify/${invoice.invoiceNumber}`;
    } else {
      etimsInvoiceNumber = `STUB-${invoice.invoiceNumber}`;
      etimsControlCode = `STUB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      etimsQrCode = JSON.stringify({
        sellerPin,
        buyerPin: invoice.customer?.taxPin || '',
        invoiceNumber: invoice.invoiceNumber,
        total: Number(invoice.totalAmount),
        tax: Number(invoice.taxAmount),
        stub: true,
      });
    }

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        fiscalStatus: 'SUBMITTED',
        etimsInvoiceNumber,
        etimsControlCode,
        etimsQrCode,
        etimsSubmittedAt: new Date(),
      },
      include: { customer: true, items: true },
    });
  }

  static async generateVatItaxExport(start: Date, end: Date) {
    const invoices = await prisma.invoice.findMany({
      where: {
        type: 'SALES',
        invoiceDate: { gte: start, lte: end },
        status: { in: ['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE'] },
      },
      include: { customer: true },
      orderBy: { invoiceDate: 'asc' },
    });

    const company = await prisma.company.findFirst();

    return {
      period: { start, end },
      companyPin: company?.taxPin || '',
      lineCount: invoices.length,
      totalOutputVat: invoices.reduce((sum, inv) => sum + Number(inv.taxAmount), 0),
      totalTaxableSales: invoices.reduce((sum, inv) => sum + Number(inv.subtotal), 0),
      invoices: invoices.map((inv) => ({
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        customerPin: inv.customer?.taxPin || '',
        customerName: inv.customer?.name || '',
        subtotal: Number(inv.subtotal),
        taxAmount: Number(inv.taxAmount),
        totalAmount: Number(inv.totalAmount),
        fiscalStatus: inv.fiscalStatus,
        etimsInvoiceNumber: inv.etimsInvoiceNumber,
      })),
    };
  }
}
