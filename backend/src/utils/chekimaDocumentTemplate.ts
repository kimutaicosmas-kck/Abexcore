/**
 * Chekima trading layout on standard AbexCore stationery.
 * Same modern header, colours, and table as other tenants — plus From/To, Description,
 * and trading-style totals from their requested format.
 */

import PDFDocument from 'pdfkit';
import {
  PAGE_LEFT,
  PAGE_RIGHT,
  PAGE_WIDTH,
  bindDocInk,
  drawAmazonStyleHeader,
  drawDocTable,
  drawSignatureBlock,
  type CompanyDocHeader,
  type DocRefField,
} from './documentTemplate';

export const CHEKIMA_COMPANY_SLUG = 'chekima';

export const CHEKIMA_DEFAULT_TAGLINE =
  'Dealers in Oil, Lubricants & Spare Part for: Shantui, Hitachi, Hyundai, Liugong, Caterpillar, Case, Doosan, XCMG, Komatsu, Sany, Zoomlion, Cummins Engine Parts, Perkins Parts & Bell Equipment.';

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

function drawSectionLabel(doc: PDFKit.PDFDocument, label: string, y: number, color: string): number {
  doc.font('Helvetica-Bold').fontSize(9).fillColor(color).text(label, PAGE_LEFT, y, { underline: true });
  return doc.y + 4;
}

/** From / To block — replaces the standard M/s party section for Chekima. */
function drawChekimaFromTo(
  doc: PDFKit.PDFDocument,
  startY: number,
  company: CompanyDocHeader & { tagline?: string },
  input: Pick<
    ChekimaDocInput,
    'customerName' | 'customerAddress' | 'customerPhone' | 'customerEmail' | 'contactPerson'
  >
): number {
  const ink = bindDocInk(doc, company);
  const tagline = (company.tagline || CHEKIMA_DEFAULT_TAGLINE).trim();
  const colW = PAGE_WIDTH / 2 - 8;
  const rightX = PAGE_LEFT + PAGE_WIDTH / 2 + 8;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('From', PAGE_LEFT, startY);
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(company.name, PAGE_LEFT, startY + 14, { width: colW });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor('#475569')
    .text(tagline, PAGE_LEFT, doc.y + 2, { width: colW });
  const fromBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('To', rightX, startY, {
    width: colW,
    align: 'left',
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#0f172a')
    .text(input.customerName || '—', rightX, startY + 14, { width: colW });

  let toY = doc.y + 2;
  const toLines = [
    input.customerAddress ? `Address: ${input.customerAddress}` : null,
    input.customerPhone ? `Telephone: ${input.customerPhone}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    input.contactPerson ? `Contact Person: ${input.contactPerson}` : null,
  ].filter(Boolean) as string[];

  doc.font('Helvetica').fontSize(8).fillColor('#475569');
  for (const line of toLines) {
    doc.text(line, rightX, toY, { width: colW, lineBreak: false });
    toY += 11;
  }

  return Math.max(fromBottom, toY) + 10;
}

/** Right-side refs — same pattern as standard invoices (Date, Doc No, etc.). */
function drawChekimaRefs(
  doc: PDFKit.PDFDocument,
  company: CompanyDocHeader,
  startY: number,
  refs: DocRefField[]
): number {
  const ink = bindDocInk(doc, company);
  const refX = 330;
  const refW = PAGE_RIGHT - refX;
  let refY = startY;

  for (const ref of refs) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text(ref.label, refX, refY, {
      width: 72,
    });
    doc
      .moveTo(refX + 74, refY + 11)
      .lineTo(PAGE_RIGHT, refY + 11)
      .strokeColor(ink.line)
      .lineWidth(0.8)
      .stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(ref.value || '—', refX + 76, refY, {
      width: refW - 76,
      lineBreak: false,
    });
    refY += 18;
  }
  return refY + 4;
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
  const totX = 320;
  const labelW = 105;
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
      .text(row.value, totX + labelW + 4, totY, {
        width: PAGE_RIGHT - totX - labelW - 4,
        align: 'right',
        lineBreak: false,
      });
    totY += row.bold ? 16 : 14;
  }
  return totY;
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

  const partyTop = y;
  y = drawChekimaFromTo(doc, y, company, input);
  const refsBottom = drawChekimaRefs(doc, company, partyTop, refs);
  y = Math.max(y, refsBottom);

  const description = (input.description || '').trim();
  if (description) {
    y = drawSectionLabel(doc, 'Description', y, ink.primary);
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(description, PAGE_LEFT, y, {
      width: PAGE_WIDTH,
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

  y = drawDocTable(
    doc,
    y,
    [
      { key: 'no', label: 'No', width: 32, align: 'center' },
      { key: 'item', label: 'Item', width: 228 },
      { key: 'qty', label: 'Qty', width: 52, align: 'right' },
      { key: 'rate', label: 'Rate', width: 88, align: 'right' },
      { key: 'amount', label: 'Amount', width: 92, align: 'right' },
    ],
    tableRows,
    {
      minBodyRows: Math.max(tableRows.length + 1, 3),
      footerLeft: 'E.& O.E',
      footerCenter: `No. ${input.docNo}`,
    }
  );

  const sigY = y + 6;
  drawChekimaTradingTotals(doc, sigY, company, input);
  drawSignatureBlock(doc, sigY, {
    confirmLabel: 'Prepared By:',
    confirmName: input.preparedBy,
    receiveLabel: 'Authorized By:',
    receiveName: input.authorizedBy || input.preparedBy,
  });

  y = Math.max(sigY + 72, doc.y) + 6;

  if (input.terms?.trim()) {
    y = drawSectionLabel(doc, 'Terms and Conditions', y, ink.primary);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(input.terms.trim(), PAGE_LEFT, y, {
      width: PAGE_WIDTH,
    });
    y = doc.y + 8;
  }
  if (input.comments?.trim()) {
    y = drawSectionLabel(doc, 'Comments', y, ink.primary);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(input.comments.trim(), PAGE_LEFT, y, {
      width: PAGE_WIDTH,
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
