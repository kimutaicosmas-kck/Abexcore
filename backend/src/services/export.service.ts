import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getCompanySettings } from '../utils/company';

type InvoiceWithRelations = Awaited<ReturnType<typeof ExportService.getInvoice>>;

export class ExportService {
  static async getInvoice(id: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        items: true,
        payments: true,
      },
    });
    if (!invoice) throw new AppError('Invoice not found', 404);
    return invoice;
  }

  static async generateInvoicePDF(invoice: NonNullable<InvoiceWithRelations>): Promise<Buffer> {
    const company = await getCompanySettings();
    const companyName = company?.name ?? 'Company';
    const companyAddress = company?.address ?? '';
    const companyContact = [company?.email, company?.phone].filter(Boolean).join(' | ');
    const vatRate = company ? Number(company.vatRate) : 16;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const party = invoice.customer || invoice.supplier;
      const partyLabel = invoice.customer ? 'Bill To' : 'Supplier';

      doc.fontSize(20).fillColor('#2563eb').text(companyName, { align: 'left' });
      if (companyAddress) doc.fontSize(10).fillColor('#666').text(companyAddress);
      if (companyContact) doc.fontSize(10).text(companyContact);
      doc.moveDown();

      doc.fontSize(16).fillColor('#000').text('TAX INVOICE', { align: 'right' });
      doc.fontSize(10).fillColor('#666').text(`Invoice #: ${invoice.invoiceNumber}`, { align: 'right' });
      doc.text(`Date: ${invoice.invoiceDate.toLocaleDateString('en-KE')}`, { align: 'right' });
      if (invoice.dueDate) {
        doc.text(`Due: ${invoice.dueDate.toLocaleDateString('en-KE')}`, { align: 'right' });
      }
      doc.moveDown();

      doc.fontSize(11).fillColor('#000').text(partyLabel);
      doc.fontSize(10).text(party?.name || 'N/A');
      if (party && 'address' in party && party.address) doc.text(party.address);
      if (party && 'phone' in party && party.phone) doc.text(party.phone);
      doc.moveDown();

      const tableTop = doc.y;
      doc.fontSize(10).fillColor('#fff');
      doc.rect(50, tableTop, 495, 20).fill('#2563eb');
      doc.fillColor('#fff').text('Description', 55, tableTop + 5, { width: 200 });
      doc.text('Qty', 260, tableTop + 5, { width: 50 });
      doc.text('Unit Price', 320, tableTop + 5, { width: 80 });
      doc.text('Total', 420, tableTop + 5, { width: 80 });

      let y = tableTop + 25;
      doc.fillColor('#000');
      for (const item of invoice.items) {
        doc.text(item.description, 55, y, { width: 200 });
        doc.text(String(item.quantity), 260, y, { width: 50 });
        doc.text(Number(item.unitPrice).toLocaleString('en-KE'), 320, y, { width: 80 });
        doc.text(Number(item.totalPrice).toLocaleString('en-KE'), 420, y, { width: 80 });
        y += 20;
      }

      y += 10;
      doc.text(`Subtotal: KES ${Number(invoice.subtotal).toLocaleString('en-KE')}`, 350, y, { align: 'right' });
      y += 15;
      doc.text(`VAT (${vatRate}%): KES ${Number(invoice.taxAmount).toLocaleString('en-KE')}`, 350, y, { align: 'right' });
      y += 15;
      doc.fontSize(12).text(`Total: KES ${Number(invoice.totalAmount).toLocaleString('en-KE')}`, 350, y, { align: 'right' });
      y += 15;
      doc.fontSize(10).text(`Paid: KES ${Number(invoice.paidAmount).toLocaleString('en-KE')}`, 350, y, { align: 'right' });
      y += 15;
      doc.text(`Balance: KES ${(Number(invoice.totalAmount) - Number(invoice.paidAmount)).toLocaleString('en-KE')}`, 350, y, { align: 'right' });

      if (invoice.notes) {
        doc.moveDown(2);
        doc.fontSize(9).fillColor('#666').text(`Notes: ${invoice.notes}`);
      }

      doc.fontSize(8).fillColor('#9ca3af').text(
        'Powered by ApexCore ERP — Designed by ApexCore Technologies',
        50,
        doc.page.height - 50,
        { align: 'center' }
      );

      doc.end();
    });
  }

  static async generateInvoiceExcel(invoice: NonNullable<InvoiceWithRelations>): Promise<Buffer> {
    const company = await getCompanySettings();
    const companyName = company?.name ?? 'Company';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ApexCore ERP';
    const sheet = workbook.addWorksheet('Invoice');

    sheet.mergeCells('A1:E1');
    sheet.getCell('A1').value = `${companyName} - Tax Invoice`;
    sheet.getCell('A1').font = { bold: true, size: 14 };

    sheet.getCell('A3').value = 'Invoice #';
    sheet.getCell('B3').value = invoice.invoiceNumber;
    sheet.getCell('A4').value = 'Date';
    sheet.getCell('B4').value = invoice.invoiceDate;
    sheet.getCell('A5').value = 'Type';
    sheet.getCell('B5').value = invoice.type;
    sheet.getCell('A6').value = 'Status';
    sheet.getCell('B6').value = invoice.status;

    const party = invoice.customer || invoice.supplier;
    sheet.getCell('D3').value = invoice.customer ? 'Customer' : 'Supplier';
    sheet.getCell('E3').value = party?.name || '';

    sheet.addRow([]);
    const headerRow = sheet.addRow(['Description', 'Quantity', 'Unit Price', 'Tax Rate', 'Total']);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    });

    for (const item of invoice.items) {
      sheet.addRow([
        item.description,
        Number(item.quantity),
        Number(item.unitPrice),
        Number(item.taxRate),
        Number(item.totalPrice),
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['', '', '', 'Subtotal', Number(invoice.subtotal)]);
    sheet.addRow(['', '', '', 'VAT', Number(invoice.taxAmount)]);
    sheet.addRow(['', '', '', 'Total', Number(invoice.totalAmount)]);
    sheet.addRow(['', '', '', 'Paid', Number(invoice.paidAmount)]);

    sheet.columns = [
      { width: 35 },
      { width: 12 },
      { width: 15 },
      { width: 12 },
      { width: 15 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generateSalesReportExcel(): Promise<Buffer> {
    const invoices = await prisma.invoice.findMany({
      where: { type: 'SALES' },
      include: { customer: true },
      orderBy: { invoiceDate: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales Report');

    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = 'Sales Report — ApexCore ERP';
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-KE')}`;

    const headerRow = sheet.addRow(['Invoice #', 'Customer', 'Date', 'Amount', 'Paid', 'Status']);
    headerRow.font = { bold: true };

    let total = 0;
    for (const inv of invoices) {
      total += Number(inv.totalAmount);
      sheet.addRow([
        inv.invoiceNumber,
        inv.customer?.name || '',
        inv.invoiceDate,
        Number(inv.totalAmount),
        Number(inv.paidAmount),
        inv.status,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['', '', 'Total', total, '', '']);

    sheet.columns = [{ width: 18 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generateInventoryReportExcel(): Promise<Buffer> {
    const stockLevels = await prisma.stockLevel.findMany({
      include: { warehouse: true, product: true, rawMaterial: true },
      orderBy: { updatedAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inventory Report');

    sheet.mergeCells('A1:F1');
    sheet.getCell('A1').value = 'Inventory Report';
    sheet.getCell('A1').font = { bold: true, size: 14 };

    const headerRow = sheet.addRow(['Warehouse', 'Item', 'Type', 'Quantity', 'Unit Cost', 'Value']);
    headerRow.font = { bold: true };

    let totalValue = 0;
    for (const sl of stockLevels) {
      const value = Number(sl.quantity) * Number(sl.unitCost);
      totalValue += value;
      sheet.addRow([
        sl.warehouse.name,
        sl.product?.name || sl.rawMaterial?.name || '',
        sl.product ? 'Finished Good' : 'Raw Material',
        Number(sl.quantity),
        Number(sl.unitCost),
        value,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['', '', '', '', 'Total Value', totalValue]);

    sheet.columns = [{ width: 22 }, { width: 30 }, { width: 15 }, { width: 12 }, { width: 12 }, { width: 15 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static ensureReportDir() {
    if (!fs.existsSync(config.reportDir)) {
      fs.mkdirSync(config.reportDir, { recursive: true });
    }
  }

  static saveReport(filename: string, buffer: Buffer): string {
    this.ensureReportDir();
    const filepath = path.join(config.reportDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }
}
