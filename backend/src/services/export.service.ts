import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getCompanySettings } from '../utils/company';
import { isPlatformCompanySlug } from '../utils/platform';
import { requireTenantId } from '../utils/tenant';

type InvoiceWithRelations = Awaited<ReturnType<typeof ExportService.getInvoice>>;

type CompanyDocHeader = {
  name: string;
  addressLine: string;
  contactLine: string;
  vatRate: number;
  /** PNG buffer for letterhead (tenant upload or platform brand mark). */
  logoPng: Buffer | null;
};

const LOGO_PDF_SIZE = 52;
const LOGO_EXCEL_SIZE = 64;

function companyLogoDiskPath(logo: string | null | undefined): string | null {
  if (!logo) return null;
  const filename = path.basename(logo);
  if (!filename || filename === '.' || filename === '..') return null;
  return path.resolve(config.uploadDir, 'companies', filename);
}

/** Platform mark when the owner workspace has no uploadable logo. */
async function buildPlatformLogoPng(): Promise<Buffer> {
  const faviconCandidates = [
    path.resolve(process.cwd(), '../frontend/public/favicon.svg'),
    path.resolve(process.cwd(), 'frontend/public/favicon.svg'),
    path.resolve(__dirname, '../../../frontend/public/favicon.svg'),
  ];
  for (const candidate of faviconCandidates) {
    if (fs.existsSync(candidate)) {
      return sharp(candidate)
        .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    }
  }

  // Fallback monogram if favicon is unavailable.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" rx="48" fill="#1d4ed8"/>
      <text x="128" y="168" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="120" font-weight="700" fill="#ffffff">A</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function resolveCompanyLogoPng(company: {
  logo: string | null;
  slug: string;
}): Promise<Buffer | null> {
  const diskPath = companyLogoDiskPath(company.logo);
  if (diskPath && fs.existsSync(diskPath)) {
    try {
      return await sharp(diskPath)
        .resize(256, 256, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    } catch {
      // Fall through to platform mark / null
    }
  }

  if (isPlatformCompanySlug(company.slug)) {
    try {
      return await buildPlatformLogoPng();
    } catch {
      return null;
    }
  }

  return null;
}

async function resolveCompanyDocHeader(companyId: string): Promise<CompanyDocHeader> {
  const company = await getCompanySettings(companyId);
  if (!company) {
    throw new AppError('Company not found for this document', 404);
  }
  // Prefer trading name from company settings (each tenant's brand on documents).
  const displayName = company.name?.trim() || company.legalName?.trim() || 'Company';
  const addressParts = [company.address?.trim(), company.city?.trim()].filter(Boolean) as string[];
  // Avoid "Nairobi, Nairobi" when address already includes the city.
  const addressLine =
    addressParts.length === 2 &&
    addressParts[0]!.toLowerCase().includes(addressParts[1]!.toLowerCase())
      ? addressParts[0]!
      : addressParts.join(', ');
  const contactLine = [company.email?.trim(), company.phone?.trim()].filter(Boolean).join(' | ');
  const logoPng = await resolveCompanyLogoPng({ logo: company.logo, slug: company.slug });
  return {
    name: displayName,
    addressLine,
    contactLine,
    vatRate: Number(company.vatRate),
    logoPng,
  };
}

/** Shared letterhead: logo + tenant company left, document title/meta right. */
function drawCompanyDocumentHeader(
  doc: PDFKit.PDFDocument,
  company: Pick<CompanyDocHeader, 'name' | 'addressLine' | 'contactLine' | 'logoPng'>,
  title: string,
  metaLines: string[]
): void {
  const pageLeft = 50;
  const rightX = 320;
  const rightWidth = 225;
  const headerTop = 50;
  const textLeft = company.logoPng ? pageLeft + LOGO_PDF_SIZE + 12 : pageLeft;
  const textWidth = company.logoPng ? 238 : 250;

  if (company.logoPng) {
    try {
      doc.image(company.logoPng, pageLeft, headerTop, {
        fit: [LOGO_PDF_SIZE, LOGO_PDF_SIZE],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // Continue without logo if the image cannot be embedded
    }
  }

  doc.fontSize(18).fillColor('#1e293b').text(company.name, textLeft, headerTop, {
    width: textWidth,
    align: 'left',
  });
  let leftY = doc.y;
  if (company.addressLine) {
    doc.fontSize(10).fillColor('#64748b').text(company.addressLine, textLeft, leftY, { width: textWidth });
    leftY = doc.y;
  }
  if (company.contactLine) {
    doc.fontSize(10).fillColor('#64748b').text(company.contactLine, textLeft, leftY, { width: textWidth });
    leftY = doc.y;
  }
  leftY = Math.max(leftY, company.logoPng ? headerTop + LOGO_PDF_SIZE : leftY);

  let rightY = headerTop;
  doc.fontSize(16).fillColor('#0f172a').text(title, rightX, rightY, {
    width: rightWidth,
    align: 'right',
  });
  rightY = doc.y + 4;
  doc.fontSize(10).fillColor('#64748b');
  for (const line of metaLines) {
    doc.text(line, rightX, rightY, { width: rightWidth, align: 'right' });
    rightY = doc.y;
  }

  // Subtle divider under letterhead
  const dividerY = Math.max(leftY, rightY) + 10;
  doc
    .moveTo(pageLeft, dividerY)
    .lineTo(545, dividerY)
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .stroke();
  doc.y = dividerY + 14;
}

function addExcelCompanyLetterhead(
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  company: CompanyDocHeader,
  title: string,
  mergeToCol = 'G'
): number {
  workbook.creator = company.name;
  sheet.mergeCells(`A1:${mergeToCol}1`);
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  sheet.getCell('A2').value = company.addressLine || '';
  sheet.getCell('A3').value = company.contactLine || '';
  sheet.getCell('A4').value = `Generated: ${new Date().toLocaleString('en-KE')}`;

  if (company.logoPng) {
    const imageId = workbook.addImage({
      buffer: company.logoPng as unknown as ExcelJS.Buffer,
      extension: 'png',
    });
    sheet.addImage(imageId, {
      tl: { col: 0, row: 0 },
      ext: { width: LOGO_EXCEL_SIZE, height: LOGO_EXCEL_SIZE },
    });
    sheet.getRow(1).height = 48;
    // Keep title readable beside the logo
    sheet.getCell('A1').alignment = { vertical: 'middle', indent: 10 };
  }

  return 5;
}

export class ExportService {
  static async getInvoice(id: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId: requireTenantId() },
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
    const company = await resolveCompanyDocHeader(invoice.companyId);
    const { vatRate } = company;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const party = invoice.customer || invoice.supplier;
      const partyLabel = invoice.customer ? 'Bill To' : 'Supplier';
      const metaLines = [
        `Invoice #: ${invoice.invoiceNumber}`,
        `Date: ${invoice.invoiceDate.toLocaleDateString('en-KE')}`,
      ];
      if (invoice.dueDate) {
        metaLines.push(`Due: ${invoice.dueDate.toLocaleDateString('en-KE')}`);
      }

      drawCompanyDocumentHeader(doc, company, 'TAX INVOICE', metaLines);

      doc.fontSize(11).fillColor('#000').text(partyLabel);
      doc.fontSize(10).text(party?.name || 'N/A');
      if (party && 'address' in party && party.address) doc.text(party.address);
      if (party && 'city' in party && party.city) doc.text(String(party.city));
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

      doc.end();
    });
  }

  static async getDeliveryNote(id: string) {
    const delivery = await prisma.deliveryNote.findFirst({
      where: { id, companyId: requireTenantId() },
      include: {
        salesOrder: {
          include: {
            customer: true,
            items: { include: { product: true } },
          },
        },
        vehicle: true,
        driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
        items: true,
        invoices: { select: { invoiceNumber: true }, take: 1 },
      },
    });
    if (!delivery) throw new AppError('Delivery note not found', 404);
    return delivery;
  }

  static async generateDeliveryNotePDF(
    delivery: NonNullable<Awaited<ReturnType<typeof ExportService.getDeliveryNote>>>
  ): Promise<Buffer> {
    // Always brand from the delivery's tenant — never the platform default / first company.
    const company = await resolveCompanyDocHeader(delivery.companyId);

    const productIds = delivery.items.map((item) => item.productId);
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds }, companyId: delivery.companyId },
          select: { id: true, name: true, sku: true },
        })
      : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const customer = delivery.salesOrder.customer;
      const driverName = delivery.driver
        ? `${delivery.driver.firstName} ${delivery.driver.lastName}`.trim()
        : '—';
      const vehicleLabel = delivery.vehicle
        ? [delivery.vehicle.registration, delivery.vehicle.make, delivery.vehicle.model]
            .filter(Boolean)
            .join(' · ')
        : '—';

      const metaLines = [
        `Delivery #: ${delivery.deliveryNo}`,
        `Date: ${delivery.createdAt.toLocaleDateString('en-KE')}`,
        `Order #: ${delivery.salesOrder.orderNumber}`,
      ];
      if (delivery.invoices[0]?.invoiceNumber) {
        metaLines.push(`Invoice #: ${delivery.invoices[0].invoiceNumber}`);
      }

      drawCompanyDocumentHeader(doc, company, 'DELIVERY NOTE', metaLines);

      doc.fontSize(11).fillColor('#000').text('Deliver To');
      doc.fontSize(10).text(customer?.name || 'N/A');
      if (customer?.address) doc.text(customer.address);
      if (customer?.city) doc.text(customer.city);
      if (customer?.phone) doc.text(customer.phone);
      doc.moveDown();

      doc.fontSize(10).fillColor('#000').text(`Vehicle: ${vehicleLabel}`);
      doc.text(`Driver: ${driverName}${delivery.driver?.phone ? ` · ${delivery.driver.phone}` : ''}`);
      if (delivery.scheduledDate) {
        doc.text(`Scheduled: ${delivery.scheduledDate.toLocaleDateString('en-KE')}`);
      }
      doc.text(`Status: ${delivery.status.replace(/_/g, ' ')}`);
      doc.moveDown();

      const tableTop = doc.y;
      doc.fontSize(10).fillColor('#fff');
      doc.rect(50, tableTop, 495, 20).fill('#2563eb');
      doc.fillColor('#fff').text('Part No.', 55, tableTop + 5, { width: 90 });
      doc.text('Product', 150, tableTop + 5, { width: 280 });
      doc.text('Qty', 450, tableTop + 5, { width: 80 });

      let y = tableTop + 25;
      doc.fillColor('#000');
      for (const item of delivery.items) {
        const product = productById.get(item.productId);
        const orderLine = delivery.salesOrder.items.find((line) => line.productId === item.productId);
        const name = product?.name || orderLine?.product?.name || 'Product';
        const partNo = product?.sku || '—';
        doc.text(partNo, 55, y, { width: 90 });
        doc.text(name, 150, y, { width: 280 });
        doc.text(String(item.quantity), 450, y, { width: 80 });
        y += 20;
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
      }

      if (delivery.notes) {
        y += 10;
        doc.fontSize(9).fillColor('#666').text(`Notes: ${delivery.notes}`, 50, y, { width: 495 });
        y += 30;
      } else {
        y += 20;
      }

      doc.fontSize(10).fillColor('#000');
      doc.text('Received in good order by:', 50, Math.max(y + 20, 620));
      doc.text('Customer name: ____________________________', 50, Math.max(y + 45, 645));
      doc.text('Signature: ________________________________', 50, Math.max(y + 70, 670));
      doc.text('Date: ____________________________________', 50, Math.max(y + 95, 695));

      doc.fontSize(8).fillColor('#999').text(
        'This delivery note must accompany the goods. Retain a signed copy for records.',
        50,
        760,
        { width: 495, align: 'center' }
      );

      doc.end();
    });
  }

  static async generateInvoiceExcel(invoice: NonNullable<InvoiceWithRelations>): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(invoice.companyId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Invoice');
    const startRow = addExcelCompanyLetterhead(
      workbook,
      sheet,
      company,
      `${company.name} — Tax Invoice`,
      'E'
    );

    sheet.getCell(`A${startRow}`).value = 'Invoice #';
    sheet.getCell(`B${startRow}`).value = invoice.invoiceNumber;
    sheet.getCell(`A${startRow + 1}`).value = 'Date';
    sheet.getCell(`B${startRow + 1}`).value = invoice.invoiceDate;
    sheet.getCell(`A${startRow + 2}`).value = 'Type';
    sheet.getCell(`B${startRow + 2}`).value = invoice.type;
    sheet.getCell(`A${startRow + 3}`).value = 'Status';
    sheet.getCell(`B${startRow + 3}`).value = invoice.status;

    const party = invoice.customer || invoice.supplier;
    sheet.getCell(`D${startRow}`).value = invoice.customer ? 'Customer' : 'Supplier';
    sheet.getCell(`E${startRow}`).value = party?.name || '';

    // Jump past meta block before line items
    sheet.getRow(startRow + 4).values = [];
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
    const companyId = requireTenantId();
    const company = await resolveCompanyDocHeader(companyId);
    const invoices = await prisma.invoice.findMany({
      where: { type: 'SALES', companyId },
      include: {
        customer: true,
        salesOrder: {
          include: {
            createdBy: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { invoiceDate: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales Report');
    addExcelCompanyLetterhead(workbook, sheet, company, `${company.name} — Sales Report`, 'H');

    const headerRow = sheet.addRow([
      'Invoice #',
      'Order #',
      'Sales Person',
      'Customer',
      'Date',
      'Amount',
      'Paid',
      'Status',
    ]);
    headerRow.font = { bold: true };

    let total = 0;
    for (const inv of invoices) {
      total += Number(inv.totalAmount);
      const salesPerson = inv.salesOrder?.createdBy
        ? `${inv.salesOrder.createdBy.firstName} ${inv.salesOrder.createdBy.lastName}`.trim()
        : '';
      sheet.addRow([
        inv.invoiceNumber,
        inv.salesOrder?.orderNumber || '',
        salesPerson,
        inv.customer?.name || '',
        inv.invoiceDate,
        Number(inv.totalAmount),
        Number(inv.paidAmount),
        inv.status,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['', '', '', '', 'Total', total, '', '']);

    sheet.columns = [
      { width: 18 },
      { width: 16 },
      { width: 22 },
      { width: 30 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 12 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generateSalesByPersonExcel(query: {
    salesPersonId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    const { SalespersonReportService } = await import('./salesperson-report.service');
    const rows = await SalespersonReportService.getRowsForExport(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sales by Salesperson');
    const nextRow = addExcelCompanyLetterhead(
      workbook,
      sheet,
      company,
      `${company.name} — Sales by Salesperson`,
      'J'
    );
    if (query.startDate || query.endDate) {
      sheet.getCell(`A${nextRow}`).value =
        `Period: ${query.startDate || 'start'} to ${query.endDate || 'today'}`;
    }

    const headerRow = sheet.addRow([
      'Invoice #',
      'Order #',
      'Date',
      'Sales Person',
      'Customer',
      'Customer Code',
      'Amount (KES)',
      'Paid (KES)',
      'Balance (KES)',
      'Status',
    ]);
    headerRow.font = { bold: true };

    let total = 0;
    let paid = 0;
    for (const row of rows) {
      total += row.totalAmount;
      paid += row.paidAmount;
      sheet.addRow([
        row.invoiceNumber,
        row.orderNumber,
        row.invoiceDate,
        row.salesPersonName,
        row.customerName,
        row.customerCode,
        row.totalAmount,
        row.paidAmount,
        row.balance,
        row.status,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow(['', '', '', '', '', 'Totals', total, paid, total - paid, '']);

    sheet.columns = [
      { width: 18 },
      { width: 16 },
      { width: 14 },
      { width: 22 },
      { width: 28 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 12 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generateInventoryReportExcel(): Promise<Buffer> {
    const companyId = requireTenantId();
    const company = await resolveCompanyDocHeader(companyId);
    const stockLevels = await prisma.stockLevel.findMany({
      where: { warehouse: { companyId } },
      include: { warehouse: true, product: true, rawMaterial: true },
      orderBy: { updatedAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inventory Report');
    addExcelCompanyLetterhead(workbook, sheet, company, `${company.name} — Inventory Report`, 'F');

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
