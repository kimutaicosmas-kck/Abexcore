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
import type { CustomerStatementResult, VatCustomerReportResult } from './customerStatement.service';
import type { VendorStatementResult } from './vendorStatement.service';

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
      if (invoice.type === 'SALES') {
        metaLines.push(
          invoice.customerPoNumber
            ? `LPO: ${invoice.customerPoNumber}`
            : 'LPO: —'
        );
      }

      drawCompanyDocumentHeader(doc, company, 'TAX INVOICE', metaLines);

      doc.fontSize(11).fillColor('#000').text(partyLabel);
      doc.fontSize(10).text(party?.name || 'N/A');
      if (party && 'address' in party && party.address) doc.text(party.address);
      if (party && 'city' in party && party.city) doc.text(String(party.city));
      if (party && 'phone' in party && party.phone) doc.text(party.phone);
      if (invoice.type === 'SALES') {
        doc.moveDown(0.5);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(
          `LPO / Customer PO: ${invoice.customerPoNumber || '—'}`
        );
        doc.font('Helvetica');
      }
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
      if (delivery.waybillNo) {
        doc.text(`Waybill #: ${delivery.waybillNo}`);
      }
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

  static async getPurchaseOrder(id: string) {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id, companyId: requireTenantId() },
      include: {
        supplier: true,
        items: { orderBy: { description: 'asc' } },
      },
    });
    if (!po) throw new AppError('Purchase order not found', 404);
    return po;
  }

  static async generatePurchaseOrderPDF(
    po: NonNullable<Awaited<ReturnType<typeof ExportService.getPurchaseOrder>>>
  ): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(po.companyId);
    const { vatRate } = company;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const metaLines = [
        `PO #: ${po.poNumber}`,
        `Date: ${po.orderDate.toLocaleDateString('en-KE')}`,
        `Status: ${po.status.replace(/_/g, ' ')}`,
      ];
      if (po.expectedDate) {
        metaLines.push(`Expected: ${po.expectedDate.toLocaleDateString('en-KE')}`);
      }

      drawCompanyDocumentHeader(doc, company, 'PURCHASE ORDER', metaLines);

      const supplier = po.supplier;
      doc.fontSize(11).fillColor('#000').text('Supplier');
      doc.fontSize(10).text(supplier?.name || 'N/A');
      if (supplier?.code) doc.text(`Code: ${supplier.code}`);
      if (supplier?.address) doc.text(supplier.address);
      if (supplier?.city) doc.text(supplier.city);
      if (supplier?.phone) doc.text(supplier.phone);
      if (supplier?.email) doc.text(supplier.email);
      doc.moveDown();

      const tableTop = doc.y;
      doc.fontSize(10).fillColor('#fff');
      doc.rect(50, tableTop, 495, 20).fill('#2563eb');
      doc.fillColor('#fff').text('Description', 55, tableTop + 5, { width: 200 });
      doc.text('Qty', 260, tableTop + 5, { width: 45 });
      doc.text('Unit', 305, tableTop + 5, { width: 40 });
      doc.text('Unit Price', 350, tableTop + 5, { width: 80 });
      doc.text('Total', 440, tableTop + 5, { width: 90 });

      let y = tableTop + 25;
      doc.fillColor('#000');
      for (const item of po.items) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.text(item.description, 55, y, { width: 200 });
        doc.text(String(Number(item.quantity)), 260, y, { width: 45 });
        doc.text(item.unit || 'pcs', 305, y, { width: 40 });
        doc.text(Number(item.unitPrice).toLocaleString('en-KE'), 350, y, { width: 80 });
        doc.text(Number(item.totalPrice).toLocaleString('en-KE'), 440, y, { width: 90 });
        y += 20;
      }

      y += 10;
      doc.text(`Subtotal: KES ${Number(po.subtotal).toLocaleString('en-KE')}`, 350, y, { align: 'right' });
      y += 15;
      doc.text(
        `VAT (${vatRate}%): KES ${Number(po.taxAmount).toLocaleString('en-KE')}`,
        350,
        y,
        { align: 'right' }
      );
      y += 15;
      doc.fontSize(12).text(
        `Total: KES ${Number(po.totalAmount).toLocaleString('en-KE')}`,
        350,
        y,
        { align: 'right' }
      );

      if (po.notes) {
        doc.moveDown(2);
        doc.fontSize(9).fillColor('#666').text(`Notes: ${po.notes}`, 50, doc.y, { width: 495 });
      }

      doc.fontSize(8).fillColor('#999').text(
        'Please confirm this purchase order and advise delivery schedule.',
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
    sheet.getCell(`A${startRow + 4}`).value = 'LPO / Customer PO';
    sheet.getCell(`B${startRow + 4}`).value = invoice.customerPoNumber || '—';

    const party = invoice.customer || invoice.supplier;
    sheet.getCell(`D${startRow}`).value = invoice.customer ? 'Customer' : 'Supplier';
    sheet.getCell(`E${startRow}`).value = party?.name || '';

    // Jump past meta block before line items
    sheet.getRow(startRow + 5).values = [];
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

  static async generateProductsSoldExcel(query: {
    startDate?: string;
    endDate?: string;
    search?: string;
    productId?: string;
    needsRestockOnly?: boolean;
  }): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    const { ProductsSoldReportService } = await import('./products-sold-report.service');
    const { period, summary, rows } = await ProductsSoldReportService.getRowsForExport(query);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products Sold');
    const nextRow = addExcelCompanyLetterhead(
      workbook,
      sheet,
      company,
      `${company.name} — Products Sold Statement`,
      'J'
    );
    sheet.getCell(`A${nextRow}`).value = `Period: ${period.startDate || 'start'} to ${period.endDate || 'today'}`;
    sheet.getCell(`A${nextRow + 1}`).value =
      `Products: ${summary.productCount} · Qty sold: ${summary.totalQtySold} · Need restock: ${summary.needsRestockCount}`;

    const headerRow = sheet.addRow([
      'Part No.',
      'Product',
      'Category',
      'Qty Sold',
      'On Hand',
      'Reserved',
      'Available',
      'Min Stock',
      'Needs Restock',
      'Suggested Restock Qty',
    ]);
    headerRow.font = { bold: true };

    for (const row of rows) {
      sheet.addRow([
        row.sku,
        row.name,
        row.category,
        row.qtySold,
        row.onHand,
        row.reservedQty,
        row.availableQty,
        row.minStockLevel,
        row.needsRestock ? 'Yes' : 'No',
        row.suggestedRestockQty,
      ]);
    }

    sheet.columns = [
      { width: 16 },
      { width: 32 },
      { width: 18 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 18 },
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

  static async generateCustomerStatementPDF(
    statement: CustomerStatementResult,
    opts?: { documentTitle?: string; partyLabel?: string; footerLabel?: string }
  ): Promise<Buffer> {
    const companyId = requireTenantId();
    const company = await resolveCompanyDocHeader(companyId);
    const isOutstanding = statement.mode === 'OUTSTANDING';
    const documentTitle = opts?.documentTitle || 'CUSTOMER STATEMENT';
    const partyLabel = opts?.partyLabel || 'CUSTOMER';
    const footerLabel = opts?.footerLabel || 'Customer statement';
    const fmt = (n: number) =>
      n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtKes = (n: number) => `KES ${fmt(n)}`;
    const fmtDate = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };

    const aging = statement.aging || {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90Plus: 0,
      amountDue: statement.totalDue || 0,
    };
    const days61Plus = aging.days61_90 + aging.days90Plus;
    const asAtLabel = statement.period.from
      ? `${fmtDate(statement.period.from)} – ${fmtDate(statement.period.to)}`
      : `As at ${fmtDate(statement.period.to)}`;

    const LEFT = 48;
    const RIGHT = 547;
    const WIDTH = RIGHT - LEFT;
    const ROW_H = 22;
    const HEADER_H = 26;
    const CONTENT_BOTTOM = 668;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 48,
        size: 'A4',
        bufferPages: true,
        info: {
          Title: `${documentTitle} — ${statement.customer.name}`,
          Author: company.name,
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // —— Letterhead ——
      const headerTop = 48;
      const logoSize = 44;
      const textLeft = company.logoPng ? LEFT + logoSize + 14 : LEFT;

      if (company.logoPng) {
        try {
          doc.image(company.logoPng, LEFT, headerTop, {
            fit: [logoSize, logoSize],
            align: 'center',
            valign: 'center',
          });
        } catch {
          // skip logo
        }
      }

      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(company.name, textLeft, headerTop, {
        width: 250,
      });
      let leftY = doc.y + 2;
      doc.font('Helvetica').fontSize(9).fillColor('#64748b');
      if (company.addressLine) {
        doc.text(company.addressLine, textLeft, leftY, { width: 250 });
        leftY = doc.y + 1;
      }
      if (company.contactLine) {
        doc.text(company.contactLine, textLeft, leftY, { width: 250 });
        leftY = doc.y;
      }
      leftY = Math.max(leftY, company.logoPng ? headerTop + logoSize : leftY);

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#0f172a')
        .text(documentTitle, 320, headerTop, { width: RIGHT - 320, align: 'right' });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#475569')
        .text(asAtLabel, 320, headerTop + 20, { width: RIGHT - 320, align: 'right' });

      const dividerY = Math.max(leftY, headerTop + 36) + 14;
      doc
        .moveTo(LEFT, dividerY)
        .lineTo(RIGHT, dividerY)
        .strokeColor('#cbd5e1')
        .lineWidth(1)
        .stroke();

      // —— Party block ——
      let y = dividerY + 18;
      doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(partyLabel, LEFT, y);
      y += 14;
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#0f172a').text(statement.customer.name, LEFT, y, {
        width: WIDTH * 0.62,
      });
      y = doc.y + 4;
      doc.font('Helvetica').fontSize(9).fillColor('#475569');
      const detailBits = [
        statement.customer.code ? `Code: ${statement.customer.code}` : null,
        statement.customer.address,
        statement.customer.city,
        statement.customer.phone,
      ].filter(Boolean) as string[];
      for (const bit of detailBits) {
        doc.text(bit, LEFT, y, { width: WIDTH * 0.62 });
        y = doc.y + 2;
      }

      y = Math.max(y, dividerY + 18 + 56) + 16;

      // —— Table ——
      type Col = { key: string; label: string; x: number; w: number; align?: 'left' | 'right' };
      const cols: Col[] = isOutstanding
        ? [
            { key: 'date', label: 'Date', x: LEFT, w: 58 },
            { key: 'ref', label: 'Invoice', x: LEFT + 62, w: 78 },
            { key: 'due', label: 'Due date', x: LEFT + 144, w: 58 },
            { key: 'status', label: 'Status', x: LEFT + 206, w: 58 },
            { key: 'invoiced', label: 'Invoiced', x: LEFT + 268, w: 72, align: 'right' },
            { key: 'paid', label: 'Paid', x: LEFT + 344, w: 68, align: 'right' },
            { key: 'balance', label: 'Balance', x: LEFT + 416, w: WIDTH - 416, align: 'right' },
          ]
        : [
            { key: 'date', label: 'Date', x: LEFT, w: 58 },
            { key: 'type', label: 'Type', x: LEFT + 62, w: 62 },
            { key: 'ref', label: 'Reference', x: LEFT + 128, w: 78 },
            { key: 'desc', label: 'Description', x: LEFT + 210, w: 120 },
            { key: 'debit', label: 'Debit', x: LEFT + 334, w: 54, align: 'right' },
            { key: 'credit', label: 'Credit', x: LEFT + 392, w: 54, align: 'right' },
            { key: 'balance', label: 'Balance', x: LEFT + 450, w: WIDTH - 450, align: 'right' },
          ];

      const drawTableHeader = (top: number) => {
        doc.rect(LEFT, top, WIDTH, HEADER_H).fill('#f1f5f9');
        doc
          .moveTo(LEFT, top + HEADER_H)
          .lineTo(RIGHT, top + HEADER_H)
          .strokeColor('#cbd5e1')
          .lineWidth(0.75)
          .stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155');
        for (const c of cols) {
          doc.text(c.label, c.x, top + 8, { width: c.w, align: c.align || 'left' });
        }
        return top + HEADER_H;
      };

      const ensureSpace = (need: number) => {
        if (y + need > CONTENT_BOTTOM) {
          doc.addPage();
          y = 48;
          y = drawTableHeader(y) + 4;
        }
      };

      y = drawTableHeader(y) + 4;

      if (statement.lines.length === 0) {
        ensureSpace(40);
        doc.font('Helvetica').fontSize(10).fillColor('#64748b').text('No transactions for this statement.', LEFT, y + 8, {
          width: WIDTH,
          align: 'center',
        });
        y += 36;
      } else {
        let rowIndex = 0;
        for (const line of statement.lines) {
          ensureSpace(ROW_H + 2);
          if (rowIndex % 2 === 1) {
            doc.rect(LEFT, y - 2, WIDTH, ROW_H).fill('#f8fafc');
          }

          doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
          const cells: Record<string, string> = isOutstanding
            ? {
                date: fmtDate(line.date),
                ref: line.reference,
                due: fmtDate(line.dueDate),
                status: (line.status || '').replace(/_/g, ' '),
                invoiced: fmt(line.invoiceTotal || 0),
                paid: fmt(line.paidAmount || 0),
                balance: fmt(line.balanceDue || line.debit),
              }
            : {
                date: fmtDate(line.date),
                type:
                  line.type === 'PAYMENT'
                    ? line.paymentMethod || 'Payment'
                    : line.type.replace(/_/g, ' '),
                ref: line.reference,
                desc: line.description,
                debit: line.debit ? fmt(line.debit) : '—',
                credit: line.credit ? fmt(line.credit) : '—',
                balance: fmt(line.balance),
              };

          for (const c of cols) {
            doc.text(cells[c.key] || '', c.x, y + 4, {
              width: c.w,
              align: c.align || 'left',
              ellipsis: true,
              lineBreak: false,
              height: ROW_H - 4,
            });
          }

          doc
            .moveTo(LEFT, y + ROW_H - 2)
            .lineTo(RIGHT, y + ROW_H - 2)
            .strokeColor('#e2e8f0')
            .lineWidth(0.5)
            .stroke();

          y += ROW_H;
          rowIndex += 1;
        }
      }

      // —— Aging footer (light, readable) ——
      const agingH = 92;
      if (y + agingH + 36 > CONTENT_BOTTOM) {
        doc.addPage();
        y = 48;
      }
      y += 24;

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text('Aging summary', LEFT, y);
      y += 16;

      doc.roundedRect(LEFT, y, WIDTH, 68, 4).fillAndStroke('#ffffff', '#cbd5e1');

      const agingCols: { label: string; value: number; emphasize?: boolean }[] = [
        { label: 'Current', value: aging.current },
        { label: '1–30 past due', value: aging.days1_30 },
        { label: '31–60 days past due', value: aging.days31_60 },
        { label: '61–90 days past due', value: days61Plus },
        { label: 'Amount due', value: aging.amountDue, emphasize: true },
      ];
      const colW = WIDTH / agingCols.length;

      agingCols.forEach((col, i) => {
        const x = LEFT + i * colW;
        if (i > 0) {
          doc
            .moveTo(x, y + 10)
            .lineTo(x, y + 58)
            .strokeColor('#e2e8f0')
            .lineWidth(0.75)
            .stroke();
        }
        doc
          .font('Helvetica')
          .fontSize(7.5)
          .fillColor('#64748b')
          .text(col.label, x + 6, y + 14, { width: colW - 12, align: 'center' });
        doc
          .font(col.emphasize ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(col.emphasize ? 10 : 9)
          .fillColor('#0f172a')
          .text(fmtKes(col.value), x + 4, y + 36, { width: colW - 8, align: 'center' });
      });

      // Page footers
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#94a3b8')
          .text(
            `${company.name}  ·  ${footerLabel}  ·  Page ${i + 1} of ${range.count}`,
            LEFT,
            780,
            { width: WIDTH, align: 'center' }
          );
      }

      doc.end();
    });
  }

  static async generateCustomerStatementExcel(
    statement: CustomerStatementResult,
    opts?: { documentTitle?: string; partyLabel?: string; sheetName?: string }
  ): Promise<Buffer> {
    const companyId = requireTenantId();
    const company = await resolveCompanyDocHeader(companyId);
    const isOutstanding = statement.mode === 'OUTSTANDING';
    const documentTitle = opts?.documentTitle || 'CUSTOMER STATEMENT';
    const partyLabel = opts?.partyLabel || 'Customer';
    const sheetName = opts?.sheetName || 'Customer Statement';
    const aging = statement.aging || {
      current: 0,
      days1_30: 0,
      days31_60: 0,
      days61_90: 0,
      days90Plus: 0,
      amountDue: statement.totalDue || 0,
    };
    const days61Plus = aging.days61_90 + aging.days90Plus;
    const fmtDate = (iso: string | null | undefined) => {
      if (!iso) return '—';
      const d = new Date(iso);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    };
    const asAtLabel = statement.period.from
      ? `${fmtDate(statement.period.from)} – ${fmtDate(statement.period.to)}`
      : `As at ${fmtDate(statement.period.to)}`;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName);
    const startRow = addExcelCompanyLetterhead(
      workbook,
      sheet,
      company,
      `${company.name} — ${documentTitle}`,
      'G'
    );

    sheet.getCell(`A${startRow}`).value = `${partyLabel}: ${statement.customer.name}`;
    sheet.getCell(`A${startRow}`).font = { bold: true, size: 12 };
    sheet.getCell(`A${startRow + 1}`).value = asAtLabel;
    sheet.getCell(`A${startRow + 2}`).value = `Code: ${statement.customer.code}`;

    if (isOutstanding) {
      const header = sheet.getRow(startRow + 5);
      header.values = ['Date', 'Invoice', 'Due date', 'Status', 'Invoiced', 'Paid', 'Balance'];
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      for (const line of statement.lines) {
        sheet.addRow([
          line.date ? new Date(line.date) : null,
          line.reference,
          line.dueDate ? new Date(line.dueDate) : null,
          line.status || '',
          line.invoiceTotal || 0,
          line.paidAmount || 0,
          line.balanceDue || line.debit,
        ]);
      }
    } else {
      const header = sheet.getRow(startRow + 5);
      header.values = ['Date', 'Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'];
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      for (const line of statement.lines) {
        sheet.addRow([
          line.date ? new Date(line.date) : null,
          line.type === 'PAYMENT' ? line.paymentMethod || 'Payment' : line.type,
          line.reference,
          line.description,
          line.debit || null,
          line.credit || null,
          line.balance,
        ]);
      }
    }

    sheet.addRow([]);
    const agingHeader = sheet.addRow([
      'Current',
      '1–30 past due',
      '31–60 days past due',
      '61–90 days past due',
      'Amount due',
    ]);
    agingHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    agingHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    const agingValues = sheet.addRow([
      aging.current,
      aging.days1_30,
      aging.days31_60,
      days61Plus,
      aging.amountDue,
    ]);
    agingValues.getCell(5).font = { bold: true };

    sheet.columns = [
      { width: 14 },
      { width: 16 },
      { width: 20 },
      { width: 22 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private static vendorStatementAsCustomerShape(
    statement: VendorStatementResult
  ): CustomerStatementResult {
    return {
      mode: statement.mode,
      customer: {
        id: statement.supplier.id,
        code: statement.supplier.code,
        name: statement.supplier.name,
        vatStatus: 'VAT',
        taxPin: statement.supplier.taxPin,
        email: statement.supplier.email,
        phone: statement.supplier.phone,
        address: statement.supplier.address,
        city: statement.supplier.city,
        creditLimit: null,
        creditUsed: null,
      },
      period: statement.period,
      openingBalance: statement.openingBalance,
      periodDebits: statement.periodDebits,
      periodCredits: statement.periodCredits,
      closingBalance: statement.closingBalance,
      totalDue: statement.totalDue,
      aging: statement.aging,
      lines: statement.lines,
    };
  }

  static async generateVendorStatementPDF(statement: VendorStatementResult): Promise<Buffer> {
    return this.generateCustomerStatementPDF(this.vendorStatementAsCustomerShape(statement), {
      documentTitle: 'VENDOR STATEMENT',
      partyLabel: 'VENDOR',
      footerLabel: 'Vendor statement',
    });
  }

  static async generateVendorStatementExcel(statement: VendorStatementResult): Promise<Buffer> {
    return this.generateCustomerStatementExcel(this.vendorStatementAsCustomerShape(statement), {
      documentTitle: 'VENDOR STATEMENT',
      partyLabel: 'Vendor',
      sheetName: 'Vendor Statement',
    });
  }

  static vatCustomerReportTitle(scope: VatCustomerReportResult['vatStatus']) {
    if (scope === 'VAT') return 'VAT Customers Report';
    if (scope === 'NON_VAT') return 'Non-VAT Customers Report';
    return 'VAT & Non-VAT Customers Report';
  }

  static async generateVatCustomerReportPDF(report: VatCustomerReportResult): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    const title = this.vatCustomerReportTitle(report.vatStatus);
    const fmt = (n: number) =>
      n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const includeStatusCol = report.vatStatus === 'ALL';

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const meta = [
        `Customers: ${report.count}`,
        `Invoiced: KES ${fmt(report.totals.invoicedTotal)}`,
        `VAT: KES ${fmt(report.totals.vatTotal)}`,
        `Outstanding: KES ${fmt(report.totals.outstanding)}`,
      ];
      if (report.sections) {
        meta.push(
          `VAT customers: ${report.sections.VAT.count} · Non-VAT: ${report.sections.NON_VAT.count}`
        );
      }
      drawCompanyDocumentHeader(doc, company, title.toUpperCase(), meta);

      doc.fontSize(9).fillColor('#475569').text(
        report.vatStatus === 'NON_VAT'
          ? 'Non-VAT customers receive company invoices at 0% VAT.'
          : report.vatStatus === 'ALL'
            ? 'Combined report of VAT-registered and Non-VAT customers.'
            : 'VAT-registered customers and invoice VAT totals.',
        { width: 500 }
      );
      doc.moveDown(0.8);

      const drawSection = (label: string, customers: VatCustomerReportResult['customers']) => {
        if (report.vatStatus === 'ALL') {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(label);
          doc.moveDown(0.3);
        }

        const tableTop = doc.y;
        doc.fontSize(8).fillColor('#fff');
        doc.rect(48, tableTop, 500, 18).fill('#1e40af');
        let x = 52;
        const cols = includeStatusCol
          ? [
              ['Code', 48],
              ['Name', 110],
              ['Status', 48],
              ['Tax PIN', 70],
              ['Inv', 28],
              ['Invoiced', 64],
              ['VAT', 54],
              ['Outstanding', 64],
            ]
          : [
              ['Code', 52],
              ['Name', 130],
              ['Tax PIN', 78],
              ['Inv', 30],
              ['Invoiced', 70],
              ['VAT', 58],
              ['Outstanding', 70],
            ];
        for (const [labelText, w] of cols) {
          doc.fillColor('#fff').text(String(labelText), x, tableTop + 5, { width: Number(w) });
          x += Number(w);
        }

        let y = tableTop + 22;
        doc.fillColor('#0f172a').font('Helvetica').fontSize(8);
        for (const c of customers) {
          if (y > 720) {
            doc.addPage();
            y = 50;
          }
          x = 52;
          const values = includeStatusCol
            ? [
                c.code,
                c.name,
                c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT',
                c.taxPin || '—',
                String(c.invoiceCount),
                fmt(c.invoicedTotal),
                fmt(c.vatTotal),
                fmt(c.outstanding),
              ]
            : [
                c.code,
                c.name,
                c.taxPin || '—',
                String(c.invoiceCount),
                fmt(c.invoicedTotal),
                fmt(c.vatTotal),
                fmt(c.outstanding),
              ];
          values.forEach((val, i) => {
            doc.text(val, x, y, { width: Number(cols[i][1]) });
            x += Number(cols[i][1]);
          });
          y += 16;
        }
        doc.y = y + 10;
      };

      if (report.vatStatus === 'ALL') {
        drawSection(
          `VAT customers (${report.sections?.VAT.count || 0})`,
          report.customers.filter((c) => c.vatStatus === 'VAT')
        );
        drawSection(
          `Non-VAT customers (${report.sections?.NON_VAT.count || 0})`,
          report.customers.filter((c) => c.vatStatus === 'NON_VAT')
        );
      } else {
        drawSection('', report.customers);
      }

      doc.end();
    });
  }

  static async generateVatCustomerReportExcel(report: VatCustomerReportResult): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    const title = this.vatCustomerReportTitle(report.vatStatus);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(
      report.vatStatus === 'ALL' ? 'VAT & Non-VAT' : report.vatStatus === 'VAT' ? 'VAT Customers' : 'Non-VAT Customers'
    );

    const nextRow = addExcelCompanyLetterhead(workbook, sheet, company, `${company.name} — ${title}`, 'I');
    sheet.getCell(`A${nextRow}`).value =
      `Customers: ${report.count} · Invoiced: ${report.totals.invoicedTotal} · VAT: ${report.totals.vatTotal} · Outstanding: ${report.totals.outstanding}`;
    if (report.sections) {
      sheet.getCell(`A${nextRow + 1}`).value =
        `VAT: ${report.sections.VAT.count} customers · Non-VAT: ${report.sections.NON_VAT.count} customers`;
    }

    const header = sheet.addRow([
      'Code',
      'Name',
      'VAT Status',
      'Type',
      'Tax PIN',
      'Invoices',
      'Invoiced (KES)',
      'VAT (KES)',
      'Outstanding (KES)',
    ]);
    header.font = { bold: true };

    for (const c of report.customers) {
      sheet.addRow([
        c.code,
        c.name,
        c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT',
        c.type,
        c.taxPin || '',
        c.invoiceCount,
        c.invoicedTotal,
        c.vatTotal,
        c.outstanding,
      ]);
    }

    sheet.addRow([]);
    sheet.addRow([
      '',
      '',
      '',
      '',
      'Totals',
      report.count,
      report.totals.invoicedTotal,
      report.totals.vatTotal,
      report.totals.outstanding,
    ]).font = { bold: true };

    if (report.vatStatus === 'ALL' && report.sections) {
      const vatSheet = workbook.addWorksheet('VAT only');
      addExcelCompanyLetterhead(workbook, vatSheet, company, `${company.name} — VAT Customers`, 'I');
      const vatHeader = vatSheet.addRow([
        'Code',
        'Name',
        'Tax PIN',
        'Invoices',
        'Invoiced (KES)',
        'VAT (KES)',
        'Outstanding (KES)',
      ]);
      vatHeader.font = { bold: true };
      for (const c of report.customers.filter((r) => r.vatStatus === 'VAT')) {
        vatSheet.addRow([
          c.code,
          c.name,
          c.taxPin || '',
          c.invoiceCount,
          c.invoicedTotal,
          c.vatTotal,
          c.outstanding,
        ]);
      }

      const nonSheet = workbook.addWorksheet('Non-VAT only');
      addExcelCompanyLetterhead(workbook, nonSheet, company, `${company.name} — Non-VAT Customers`, 'I');
      const nonHeader = nonSheet.addRow([
        'Code',
        'Name',
        'Tax PIN',
        'Invoices',
        'Invoiced (KES)',
        'VAT (KES)',
        'Outstanding (KES)',
      ]);
      nonHeader.font = { bold: true };
      for (const c of report.customers.filter((r) => r.vatStatus === 'NON_VAT')) {
        nonSheet.addRow([
          c.code,
          c.name,
          c.taxPin || '',
          c.invoiceCount,
          c.invoicedTotal,
          c.vatTotal,
          c.outstanding,
        ]);
      }
    }

    sheet.columns = [
      { width: 12 },
      { width: 28 },
      { width: 12 },
      { width: 14 },
      { width: 16 },
      { width: 10 },
      { width: 14 },
      { width: 12 },
      { width: 16 },
    ];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }
}
