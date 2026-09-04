/**
 * Chekima trading layout on standard AbexCore stationery.
 * Paginated items table — footer/totals stay together on the last page (no blank pages).
 */

import PDFDocument from 'pdfkit';
import {
  PAGE_LEFT,
  PAGE_RIGHT,
  PAGE_WIDTH,
  bindDocInk,
  drawAmazonStyleHeader,
  type CompanyDocHeader,
  type DocRefField,
} from './documentTemplate';

export const CHEKIMA_COMPANY_SLUG = 'chekima';

export const CHEKIMA_DEFAULT_TAGLINE =
  'Dealers in Oil, Lubricants & Spare Part for: Shantui, Hitachi, Hyundai, Liugong, Caterpillar, Case, Doosan, XCMG, Komatsu, Sany, Zoomlion, Cummins Engine Parts, Perkins Parts & Bell Equipment.';

const REF_X = 330;
const LEFT_COL_W = REF_X - PAGE_LEFT - 14;

const TABLE_COLS = [
  { key: 'no', label: 'No', width: 32, align: 'center' as const },
  { key: 'item', label: 'Item', width: 228, align: 'left' as const },
  { key: 'qty', label: 'Qty', width: 52, align: 'right' as const },
  { key: 'rate', label: 'Rate', width: 88, align: 'right' as const },
  { key: 'amount', label: 'Amount', width: 92, align: 'right' as const },
];
const TABLE_W = TABLE_COLS.reduce((s, c) => s + c.width, 0);
const ROW_H = 18;
const TABLE_HEADER_H = 22;

export function isChekimaDocCompany(slug?: string | null): boolean {
  const s = (slug || '').trim().toLowerCase();
  return s === CHEKIMA_COMPANY_SLUG || s.startsWith(`${CHEKIMA_COMPANY_SLUG}-`);
}

export type ChekimaDocLine = {
  item: string;
  qty: string;
  rate: string;
  amount: string;
};

export type ChekimaDocInput = {
  company: CompanyDocHeader & { tagline?: string };
  docTitle: 'Quotation' | 'Sales Order' | 'Invoice';
  docNo: string;
  docDate: Date | string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerEmail?: string;
  contactPerson?: string;
  description?: string;
  lines: ChekimaDocLine[];
  totalAmount: number;
  taxAmount: number;
  discountAmount?: number;
  discountPercent?: number;
  paidAmount?: number;
  balanceDue?: number;
  vatRate: number;
  preparedBy?: string;
  authorizedBy?: string;
  refs?: DocRefField[];
  terms?: string;
  comments?: string;
  currency?: string;
};

function money(n: number) {
  return Number(n || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDocDate(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function pageBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

function pageTop(doc: PDFKit.PDFDocument): number {
  return doc.page.margins.top;
}

/** Move to a new page when the remaining content will not fit. */
function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number): number {
  if (y + needed > pageBottom(doc)) {
    doc.addPage();
    return pageTop(doc);
  }
  return y;
}

function drawSectionLabel(doc: PDFKit.PDFDocument, label: string, y: number, color: string): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(color).text(label, PAGE_LEFT, y, {
    underline: true,
    lineBreak: false,
  });
  return y + 14;
}

function drawChekimaPartySection(
  doc: PDFKit.PDFDocument,
  startY: number,
  company: CompanyDocHeader & { tagline?: string },
  input: Pick<
    ChekimaDocInput,
    'customerName' | 'customerAddress' | 'customerPhone' | 'customerEmail' | 'contactPerson'
  >,
  refs: DocRefField[]
): number {
  const ink = bindDocInk(doc, company);
  const tagline = (company.tagline || CHEKIMA_DEFAULT_TAGLINE).trim();
  const refW = PAGE_RIGHT - REF_X;

  let leftY = startY;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('From', PAGE_LEFT, leftY, {
    lineBreak: false,
  });
  leftY += 14;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(company.name, PAGE_LEFT, leftY, { width: LEFT_COL_W, lineBreak: true });
  leftY = doc.y + 2;
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#475569')
    .text(tagline, PAGE_LEFT, leftY, { width: LEFT_COL_W, lineBreak: true });
  leftY = doc.y + 10;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('To', PAGE_LEFT, leftY, {
    lineBreak: false,
  });
  leftY += 14;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(input.customerName || '—', PAGE_LEFT, leftY, { width: LEFT_COL_W, lineBreak: false });
  leftY += 12;

  const toLines = [
    input.customerAddress ? `Address: ${input.customerAddress}` : null,
    input.customerPhone ? `Telephone: ${input.customerPhone}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    input.contactPerson ? `Contact Person: ${input.contactPerson}` : null,
  ].filter(Boolean) as string[];

  doc.font('Helvetica').fontSize(8).fillColor('#475569');
  for (const line of toLines) {
    doc.text(line, PAGE_LEFT, leftY, { width: LEFT_COL_W, lineBreak: false });
    leftY += 11;
  }

  let refY = startY;
  for (const ref of refs) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text(ref.label, REF_X, refY, {
      width: 70,
      lineBreak: false,
    });
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(ref.value || '—', REF_X + 74, refY, {
      width: refW - 74,
      lineBreak: false,
    });
    doc
      .moveTo(REF_X + 74, refY + 12)
      .lineTo(PAGE_RIGHT, refY + 12)
      .strokeColor(ink.line)
      .lineWidth(0.8)
      .stroke();
    refY += 20;
  }

  return Math.max(leftY, refY) + 10;
}

function drawTableColumnHeader(doc: PDFKit.PDFDocument, y: number, company: CompanyDocHeader): number {
  const ink = bindDocInk(doc, company);
  doc.rect(PAGE_LEFT, y, TABLE_W, TABLE_HEADER_H).fill(ink.primary);
  let x = PAGE_LEFT;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  for (const col of TABLE_COLS) {
    doc.text(col.label, x + 4, y + 6, {
      width: col.width - 8,
      align: col.align,
      lineBreak: false,
    });
    x += col.width;
  }
  x = PAGE_LEFT;
  for (let i = 0; i < TABLE_COLS.length - 1; i++) {
    x += TABLE_COLS[i].width;
    doc
      .moveTo(x, y)
      .lineTo(x, y + TABLE_HEADER_H)
      .strokeColor('#ffffff')
      .lineWidth(0.4)
      .stroke();
  }
  return y + TABLE_HEADER_H;
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  y: number,
  company: CompanyDocHeader,
  row: Record<string, string>
): number {
  const ink = bindDocInk(doc, company);
  doc.rect(PAGE_LEFT, y, TABLE_W, ROW_H).strokeColor(ink.line).lineWidth(0.5).stroke();
  let x = PAGE_LEFT;
  doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
  for (const col of TABLE_COLS) {
    doc.text(row[col.key] || '', x + 4, y + 5, {
      width: col.width - 8,
      align: col.align,
      lineBreak: false,
      ellipsis: true,
    });
    x += col.width;
  }
  return y + ROW_H;
}

/** Items table that continues across pages; reserves space for closing block on last page. */
function drawChekimaPaginatedTable(
  doc: PDFKit.PDFDocument,
  startY: number,
  company: CompanyDocHeader,
  docNo: string,
  rows: Record<string, string>[],
  closingBlockHeight: number
): number {
  let y = startY;
  let headerDrawn = false;

  const paintHeader = () => {
    y = drawTableColumnHeader(doc, y, company);
    headerDrawn = true;
  };

  paintHeader();

  for (let i = 0; i < rows.length; i++) {
    const isLast = i === rows.length - 1;
    const needed = isLast ? ROW_H + 22 + closingBlockHeight : ROW_H;
    const nextY = ensureSpace(doc, y, needed);
    if (nextY !== y) {
      y = nextY;
      paintHeader();
    } else if (!headerDrawn) {
      paintHeader();
    }
    headerDrawn = true;
    y = drawTableRow(doc, y, company, rows[i]);
  }

  y = ensureSpace(doc, y, 18);
  const ink = bindDocInk(doc, company);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(ink.primary)
    .text('E.& O.E', PAGE_LEFT + 6, y + 2, { lineBreak: false });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#b91c1c')
    .text(`No. ${docNo}`, PAGE_LEFT, y + 2, { width: TABLE_W, align: 'center', lineBreak: false });

  return y + 18;
}

function drawChekimaTradingTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  company: CompanyDocHeader,
  input: Pick<
    ChekimaDocInput,
    | 'totalAmount'
    | 'taxAmount'
    | 'discountAmount'
    | 'discountPercent'
    | 'paidAmount'
    | 'balanceDue'
    | 'currency'
  >
): number {
  const ink = bindDocInk(doc, company);
  const currency = input.currency || 'KES';
  const total = Number(input.totalAmount) || 0;
  const tax = Number(input.taxAmount) || 0;
  const discountAmt = Number(input.discountAmount) || 0;
  const discountPct = Number(input.discountPercent) || 0;
  const afterDiscount = Math.max(0, total - discountAmt);

  const rows: { label: string; value: string; bold?: boolean; muted?: boolean }[] = [
    { label: 'Total Amount', value: `${currency} ${money(total)}` },
    {
      label: 'Less Discount',
      value: `${discountPct.toFixed(2)} % | ${currency} ${money(discountAmt)}`,
    },
    { label: 'After Discount', value: `${currency} ${money(afterDiscount)}` },
    { label: 'VAT Inclusive', value: `${currency} ${money(tax)}`, muted: true },
    { label: 'Amount Payable', value: `${currency} ${money(total)}`, bold: true },
  ];
  if (input.paidAmount != null) {
    rows.push({ label: 'Paid', value: `${currency} ${money(Number(input.paidAmount))}` });
  }
  if (input.balanceDue != null) {
    rows.push({
      label: 'Balance Due',
      value: `${currency} ${money(Number(input.balanceDue))}`,
      bold: true,
    });
  }

  let totY = y;
  const totX = 300;
  const labelW = 118;
  for (const row of rows) {
    doc
      .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(row.bold ? 10 : 9)
      .fillColor(row.muted ? '#94a3b8' : ink.primary)
      .text(`${row.label}:`, totX, totY, { width: labelW, align: 'right', lineBreak: false });
    doc
      .font(row.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(row.bold ? 10 : 9)
      .fillColor('#0f172a')
      .text(row.value, totX + labelW + 6, totY, {
        width: PAGE_RIGHT - totX - labelW - 6,
        align: 'right',
        lineBreak: false,
      });
    totY += row.bold ? 16 : 14;
  }
  return totY;
}

function drawChekimaSignatures(
  doc: PDFKit.PDFDocument,
  y: number,
  company: CompanyDocHeader,
  preparedBy?: string,
  authorizedBy?: string
): number {
  const ink = bindDocInk(doc, company);

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(ink.primary)
    .text('Prepared By:', PAGE_LEFT, y, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#0f172a')
    .text((preparedBy || '—').toUpperCase(), PAGE_LEFT + 72, y, { width: 210, lineBreak: false });

  y += 20;
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(ink.primary)
    .text('Authorized By:', PAGE_LEFT, y, { lineBreak: false });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#0f172a')
    .text((authorizedBy || preparedBy || '—').toUpperCase(), PAGE_LEFT + 82, y, {
      width: 200,
      lineBreak: false,
    });

  return y + 22;
}

function estimateClosingHeight(input: ChekimaDocInput): number {
  let h = 44 + 90;
  if (input.terms?.trim()) h += 36;
  if (input.comments?.trim()) h += 36;
  return h;
}

export function drawChekimaTradingDocument(doc: PDFKit.PDFDocument, input: ChekimaDocInput): void {
  const company = input.company;
  const ink = bindDocInk(doc, company);
  const badge =
    input.docTitle === 'Sales Order' ? 'SALES ORDER' : input.docTitle.toUpperCase();

  let y = drawAmazonStyleHeader(doc, company, badge, { showPaybill: true });

  const refs: DocRefField[] = input.refs ?? [
    { label: 'Date', value: formatDocDate(input.docDate) },
    {
      label: input.docTitle === 'Quotation' ? 'Quote No.' : `${input.docTitle} No.`,
      value: input.docNo,
    },
  ];

  y = drawChekimaPartySection(doc, y, company, input, refs);

  const description = (input.description || '').trim();
  if (description) {
    y = drawSectionLabel(doc, 'Description', y, ink.primary);
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(description, PAGE_LEFT, y, {
      width: PAGE_WIDTH,
      lineBreak: true,
    });
    y = doc.y + 10;
  }

  y = drawSectionLabel(doc, `${input.docTitle} Items`, y, ink.primary) + 4;

  const tableRows = input.lines.map((line, i) => ({
    no: `${i + 1}.`,
    item: line.item,
    qty: line.qty,
    rate: line.rate,
    amount: line.amount,
  }));

  const closingH = estimateClosingHeight(input);
  y = drawChekimaPaginatedTable(doc, y, company, input.docNo, tableRows, closingH);

  y = ensureSpace(doc, y, closingH);
  const footerTop = y;
  drawChekimaSignatures(doc, footerTop, company, input.preparedBy, input.authorizedBy);
  y = drawChekimaTradingTotals(doc, footerTop, company, input);
  y = Math.max(footerTop + 52, y) + 8;

  if (input.terms?.trim()) {
    y = ensureSpace(doc, y, 36);
    y = drawSectionLabel(doc, 'Terms and Conditions', y, ink.primary);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(input.terms.trim(), PAGE_LEFT, y, {
      width: PAGE_WIDTH,
      lineBreak: true,
    });
    y = doc.y + 8;
  }
  if (input.comments?.trim()) {
    y = ensureSpace(doc, y, 36);
    y = drawSectionLabel(doc, 'Comments', y, ink.primary);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(input.comments.trim(), PAGE_LEFT, y, {
      width: PAGE_WIDTH,
      lineBreak: true,
    });
  }
}

export function renderChekimaPdf(input: ChekimaDocInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', info: { Author: 'AbexCore ERP' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawChekimaTradingDocument(doc, input);
    doc.end();
  });
}

/** Avoid duplicated SKU in Chekima line items (e.g. "809/00152 LINER BEARING 809/00152…"). */
export function chekimaProductLineLabel(product?: {
  name?: string | null;
  sku?: string | null;
} | null): string {
  if (!product) return 'Item';
  const name = (product.name || '').trim();
  const sku = (product.sku || '').trim();
  if (!name) return sku || 'Item';
  if (!sku || name.includes(sku)) return name;
  return `${sku} — ${name}`;
}
