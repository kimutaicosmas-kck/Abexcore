import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { config } from '../config';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { requireTenantId } from '../utils/tenant';
import {
  DOC_BLUE,
  PAGE_LEFT,
  PAGE_WIDTH,
  resolveCompanyDocHeader,
  drawAmazonStyleHeader,
  drawPartyAndRefs,
  drawInstructionLine,
  drawDocTable,
  drawSignatureBlock,
  drawMoneyTotals,
  type CompanyDocHeader,
} from '../utils/documentTemplate';
import type { CustomerStatementResult, VatCustomerReportResult } from './customerStatement.service';
import type { VendorStatementResult } from './vendorStatement.service';

type InvoiceWithRelations = Awaited<ReturnType<typeof ExportService.getInvoice>>;

const LOGO_EXCEL_SIZE = 64;

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
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E6BB8' } };
  sheet.getCell('A2').value = company.addressLine || '';
  sheet.getCell('A3').value = company.contactLine || '';
  if (company.paybillNumber) {
    sheet.getCell('A4').value = `Lipa na M-Pesa Paybill: ${company.paybillNumber}${
      company.accountNumber ? ` · Acc: ${company.accountNumber}` : ''
    }`;
    sheet.getCell('A5').value = `Generated: ${new Date().toLocaleString('en-KE')}`;
  } else {
    sheet.getCell('A4').value = `Generated: ${new Date().toLocaleString('en-KE')}`;
  }

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
    sheet.getCell('A1').alignment = { vertical: 'middle', indent: 10 };
  }

  return company.paybillNumber ? 6 : 5;
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
    const money = (n: number) =>
      Math.round(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const party = invoice.customer || invoice.supplier;
      const partyAddress = [party && 'address' in party ? party.address : null, party && 'city' in party ? party.city : null]
        .filter(Boolean)
        .join(', ');

      let y = drawAmazonStyleHeader(doc, company, 'INVOICE');
      y = drawPartyAndRefs(doc, y, party?.name || 'N/A', partyAddress, [
        { label: 'Date', value: invoice.invoiceDate.toLocaleDateString('en-KE') },
        { label: 'Invoice No.', value: invoice.invoiceNumber },
        {
          label: invoice.type === 'SALES' ? 'Order / LPO' : 'Due date',
          value:
            invoice.type === 'SALES'
              ? invoice.customerPoNumber || '—'
              : invoice.dueDate
                ? invoice.dueDate.toLocaleDateString('en-KE')
                : '—',
        },
      ]);

      y = drawInstructionLine(
        doc,
        y,
        'Please receive the following goods in good order and condition'
      );

      const rows = invoice.items.map((item) => ({
        qty: String(Number(item.quantity)),
        description: item.description,
        unit: money(Number(item.unitPrice)),
        total: money(Number(item.totalPrice)),
      }));

      y = drawDocTable(
        doc,
        y,
        [
          { key: 'qty', label: 'Qty', width: 50, align: 'center' },
          { key: 'description', label: 'Description', width: 265 },
          { key: 'unit', label: 'Unit Price', width: 92, align: 'right' },
          { key: 'total', label: 'Amount', width: 92, align: 'right' },
        ],
        rows,
        {
          minBodyRows: Math.max(rows.length + 1, 10),
          footerLeft: 'E.& O.E',
          footerCenter: `No. ${invoice.invoiceNumber}`,
        }
      );

      y = drawMoneyTotals(doc, y, [
        { label: 'Subtotal', value: `KES ${money(Number(invoice.subtotal))}` },
        { label: `VAT (${vatRate}%)`, value: `KES ${money(Number(invoice.taxAmount))}` },
        { label: 'Total', value: `KES ${money(Number(invoice.totalAmount))}`, bold: true },
        { label: 'Paid', value: `KES ${money(Number(invoice.paidAmount))}` },
        {
          label: 'Balance',
          value: `KES ${money(Number(invoice.totalAmount) - Number(invoice.paidAmount))}`,
          bold: true,
        },
      ]);

      if (invoice.notes) {
        doc.font('Helvetica').fontSize(8).fillColor(DOC_BLUE).text(`Notes: ${invoice.notes}`, PAGE_LEFT, y, {
          width: PAGE_WIDTH,
        });
        y = doc.y + 10;
      }

      drawSignatureBlock(doc, Math.max(y + 8, 700), {
        instruction: 'Please receive the following goods in good order and condition.',
        confirmLabel: 'Confirmed by:',
        receiveLabel: 'Received by:',
      });

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
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const customer = delivery.salesOrder.customer;
      const partyAddress = [customer?.address, customer?.city, customer?.phone]
        .filter(Boolean)
        .join(', ');

      let y = drawAmazonStyleHeader(doc, company, 'DELIVERY');
      y = drawPartyAndRefs(doc, y, customer?.name || 'N/A', partyAddress, [
        { label: 'Date', value: delivery.createdAt.toLocaleDateString('en-KE') },
        { label: 'Delivery No.', value: delivery.deliveryNo },
        { label: 'Order No.', value: delivery.salesOrder.orderNumber },
      ]);

      y = drawInstructionLine(
        doc,
        y,
        'Please receive the following goods in good order and condition'
      );

      // Delivery notes are quantity-only — no prices or money totals (invoice carries pricing).
      const rows = delivery.items.map((item) => {
        const product = productById.get(item.productId);
        const orderLine = delivery.salesOrder.items.find((line) => line.productId === item.productId);
        const name = product?.name || orderLine?.product?.name || 'Product';
        const partNo = product?.sku || '';
        return {
          qty: String(item.quantity),
          description: partNo ? `${name} (${partNo})` : name,
        };
      });

      y = drawDocTable(
        doc,
        y,
        [
          { key: 'qty', label: 'Qty', width: 70, align: 'center' },
          { key: 'description', label: 'Description', width: 429 },
        ],
        rows,
        {
          minBodyRows: Math.max(rows.length + 2, 12),
          footerLeft: 'E.& O.E',
          footerCenter: `No. ${delivery.deliveryNo}`,
        }
      );

      if (delivery.notes) {
        doc.font('Helvetica').fontSize(8).fillColor(DOC_BLUE).text(`Notes: ${delivery.notes}`, PAGE_LEFT, y, {
          width: PAGE_WIDTH,
        });
        y = doc.y + 8;
      }

      const driverName = delivery.driver
        ? `${delivery.driver.firstName} ${delivery.driver.lastName}`.trim()
        : '';
      const vehicleLabel = delivery.vehicle
        ? [delivery.vehicle.registration, delivery.vehicle.make, delivery.vehicle.model]
            .filter(Boolean)
            .join(' · ')
        : '';
      if (driverName || vehicleLabel) {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(DOC_BLUE)
          .text(
            [vehicleLabel ? `Vehicle: ${vehicleLabel}` : null, driverName ? `Driver: ${driverName}` : null]
              .filter(Boolean)
              .join('  ·  '),
            PAGE_LEFT,
            y,
            { width: PAGE_WIDTH }
          );
        y = doc.y + 8;
      }

      drawSignatureBlock(doc, Math.max(y + 4, 700), {
        instruction: 'Please receive the following goods in good order and condition.',
        confirmLabel: 'Confirmed by:',
        receiveLabel: 'Received by:',
      });

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
    const money = (n: number) =>
      Math.round(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const supplier = po.supplier;
      const partyAddress = [supplier?.address, supplier?.city, supplier?.phone]
        .filter(Boolean)
        .join(', ');

      let y = drawAmazonStyleHeader(doc, company, 'PURCHASE ORDER');
      y = drawPartyAndRefs(doc, y, supplier?.name || 'N/A', partyAddress, [
        { label: 'Date', value: po.orderDate.toLocaleDateString('en-KE') },
        { label: 'PO No.', value: po.poNumber },
        {
          label: 'Expected',
          value: po.expectedDate ? po.expectedDate.toLocaleDateString('en-KE') : '—',
        },
      ]);

      y = drawInstructionLine(
        doc,
        y,
        'Please supply the following goods in good order and condition'
      );

      const rows = po.items.map((item) => ({
        qty: `${Number(item.quantity)} ${item.unit || 'pcs'}`.trim(),
        description: item.description,
        unit: money(Number(item.unitPrice)),
        total: money(Number(item.totalPrice)),
      }));

      y = drawDocTable(
        doc,
        y,
        [
          { key: 'qty', label: 'Qty', width: 70, align: 'center' },
          { key: 'description', label: 'Description', width: 245 },
          { key: 'unit', label: 'Unit Price', width: 92, align: 'right' },
          { key: 'total', label: 'Amount', width: 92, align: 'right' },
        ],
        rows,
        {
          minBodyRows: Math.max(rows.length + 1, 10),
          footerLeft: 'E.& O.E',
          footerCenter: `No. ${po.poNumber}`,
        }
      );

      y = drawMoneyTotals(doc, y, [
        { label: 'Subtotal', value: `KES ${money(Number(po.subtotal))}` },
        { label: `VAT (${vatRate}%)`, value: `KES ${money(Number(po.taxAmount))}` },
        { label: 'Total', value: `KES ${money(Number(po.totalAmount))}`, bold: true },
      ]);

      if (po.notes) {
        doc.font('Helvetica').fontSize(8).fillColor(DOC_BLUE).text(`Notes: ${po.notes}`, PAGE_LEFT, y, {
          width: PAGE_WIDTH,
        });
        y = doc.y + 8;
      }

      drawSignatureBlock(doc, Math.max(y + 8, 700), {
        instruction: 'Please confirm this purchase order and advise delivery schedule.',
        confirmLabel: 'Authorised by:',
        receiveLabel: 'Acknowledged by:',
      });

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
      Math.round(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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

      // —— Stationery letterhead (Amazon-style) ——
      const badgeLabel = documentTitle.includes('VENDOR')
        ? 'VENDOR STMT'
        : documentTitle.includes('OUTSTANDING')
          ? 'OUTSTANDING'
          : 'STATEMENT';
      let y = drawAmazonStyleHeader(doc, company, badgeLabel);
      const partyAddress = [
        statement.customer.code ? `Code: ${statement.customer.code}` : null,
        statement.customer.address,
        statement.customer.city,
        statement.customer.phone,
      ]
        .filter(Boolean)
        .join(', ');
      y = drawPartyAndRefs(doc, y, statement.customer.name, partyAddress, [
        { label: 'Period', value: asAtLabel },
        { label: partyLabel, value: statement.customer.code || '—' },
        { label: 'Amount due', value: fmtKes(aging.amountDue) },
      ]);
      y = drawInstructionLine(doc, y, 'Account statement — please settle outstanding balances promptly');

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
        doc.rect(LEFT, top, WIDTH, HEADER_H).fill(DOC_BLUE);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
        for (const c of cols) {
          doc.text(c.label, c.x, top + 8, { width: c.w, align: c.align || 'left' });
        }
        doc
          .rect(LEFT, top, WIDTH, HEADER_H)
          .strokeColor(DOC_BLUE)
          .lineWidth(1)
          .stroke();
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
      Math.round(n).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const includeStatusCol = report.vatStatus === 'ALL';

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 48, size: 'A4', bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let yHead = drawAmazonStyleHeader(doc, company, 'VAT REPORT');
      yHead = drawPartyAndRefs(doc, yHead, company.name, company.contactLine, [
        { label: 'Customers', value: String(report.count) },
        { label: 'Invoiced', value: `KES ${fmt(report.totals.invoicedTotal)}` },
        { label: 'Outstanding', value: `KES ${fmt(report.totals.outstanding)}` },
      ]);
      doc.y = drawInstructionLine(
        doc,
        yHead,
        report.vatStatus === 'NON_VAT'
          ? 'Non-VAT customers receive company invoices at 0% VAT.'
          : report.vatStatus === 'ALL'
            ? 'Combined report of VAT-registered and Non-VAT customers.'
            : 'VAT-registered customers and invoice VAT totals.'
      );

      const drawSection = (label: string, customers: VatCustomerReportResult['customers']) => {
        if (report.vatStatus === 'ALL') {
          doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(label);
          doc.moveDown(0.3);
        }

        const tableTop = doc.y;
        doc.fontSize(8).fillColor('#fff');
        doc.rect(48, tableTop, 500, 18).fill(DOC_BLUE);
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

  static async generateLeaveBalancesExcel(
    rows: Array<{
      employeeNo: string;
      name: string;
      department: string;
      gender: string;
      type: string;
      year: number;
      entitled: number;
      used: number;
      remaining: number;
    }>,
    year: number
  ): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Leave balances');
    addExcelCompanyLetterhead(workbook, sheet, company, `${company.name} — Leave balances ${year}`, 'I');
    const header = sheet.addRow([
      'Employee No',
      'Name',
      'Department',
      'Gender',
      'Leave type',
      'Year',
      'Entitled',
      'Used',
      'Remaining',
    ]);
    header.font = { bold: true };
    for (const r of rows) {
      sheet.addRow([
        r.employeeNo,
        r.name,
        r.department,
        r.gender,
        r.type.replace(/_/g, ' '),
        r.year,
        r.entitled,
        r.used,
        r.remaining,
      ]);
    }
    sheet.columns = [
      { width: 14 },
      { width: 24 },
      { width: 18 },
      { width: 12 },
      { width: 16 },
      { width: 8 },
      { width: 10 },
      { width: 10 },
      { width: 12 },
    ];
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  static async generateLeaveBalancesPdf(
    rows: Array<{
      employeeNo: string;
      name: string;
      department: string;
      gender: string;
      type: string;
      year: number;
      entitled: number;
      used: number;
      remaining: number;
    }>,
    year: number
  ): Promise<Buffer> {
    const company = await resolveCompanyDocHeader(requireTenantId());
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica-Bold').fontSize(14).fillColor(DOC_BLUE).text(company.name.toUpperCase(), 40, 36);
      doc.font('Helvetica').fontSize(9).fillColor(DOC_BLUE).text(company.contactLine || '', 40, doc.y + 2);
      doc.rect(680, 36, 100, 24).fill(DOC_BLUE);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#ffffff')
        .text('LEAVE', 680, 42, { width: 100, align: 'center' });
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(DOC_BLUE)
        .text(`Leave balances — ${year}`, 40, 78);
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
      const colX = [40, 110, 230, 340, 400, 480, 530, 580, 640];
      const headers = ['Emp No', 'Name', 'Dept', 'Gender', 'Type', 'Year', 'Entitled', 'Used', 'Remaining'];
      const headerY = doc.y;
      doc.rect(40, headerY - 2, 740, 18).fill(DOC_BLUE);
      headers.forEach((h, i) => doc.fillColor('#ffffff').text(h, colX[i], headerY + 2, { width: 70 }));
      doc.moveDown(0.55);
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a');

      for (const r of rows) {
        if (doc.y > 520) {
          doc.addPage();
        }
        const y = doc.y;
        const vals = [
          r.employeeNo,
          r.name,
          r.department,
          r.gender,
          r.type.replace(/_/g, ' '),
          String(r.year),
          String(r.entitled),
          String(r.used),
          String(r.remaining),
        ];
        vals.forEach((v, i) => doc.text(v, colX[i], y, { width: 70, lineBreak: false }));
        doc.moveDown(0.55);
      }
      doc.end();
    });
  }
}
