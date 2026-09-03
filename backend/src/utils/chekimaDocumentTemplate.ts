/**
 * Chekima Kenya Ltd trading stationery (quotation / sales order / invoice).
 * Matches their requested Hanmak-style trading layout — AbexCore footer (not Hanmak).
 */

import PDFDocument from 'pdfkit';
import {
  PAGE_LEFT,
  PAGE_RIGHT,
  PAGE_WIDTH,
  type CompanyDocHeader,
  bindDocInk,
} from './documentTemplate';

export const CHEKIMA_COMPANY_SLUG = 'chekima';

/** Default dealer line when company has no custom tagline stored. */
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
  /** Free-text job / quote description (e.g. QUOTATION FOR CAT 966H…). */
  description?: string;
  lines: ChekimaDocLine[];
  /** Gross / payable total (VAT-inclusive selling total). */
  totalAmount: number;
  /** VAT portion included in the total. */
  taxAmount: number;
  discountAmount?: number;
  discountPercent?: number;
  paidAmount?: number;
  balanceDue?: number;
  vatRate: number;
  preparedBy?: string;
  authorizedBy?: string;
  terms?: string;
  plan?: string;
  comments?: string;
  currency?: string;
  /** Show diagonal AUTHORIZED watermark (quotes / approved docs). */
  showAuthorizedWatermark?: boolean;
};

function money(n: number) {
  return Number(n || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDocDateTime(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function shortDocNo(docNo: string) {
  const digits = String(docNo).replace(/\D/g, '');
  if (digits.length >= 4) return digits.slice(-4).replace(/^0+/, '') || digits.slice(-4);
  return docNo;
}

function dashOr(value?: string | null) {
  const v = (value || '').trim();
  return v || '-';
}

function drawUnderlinedHeading(doc: PDFKit.PDFDocument, text: string, x: number, y: number) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(text, x, y, { underline: true });
  return doc.y;
}

/**
 * Draw full Chekima trading document. Returns when drawing is complete (caller ends doc).
 */
export function drawChekimaTradingDocument(doc: PDFKit.PDFDocument, input: ChekimaDocInput): void {
  const company = input.company;
  bindDocInk(doc, company);
  const tagline = (company.tagline || CHEKIMA_DEFAULT_TAGLINE).trim();
  const total = Number(input.totalAmount) || 0;
  const tax = Number(input.taxAmount) || 0;
  const discountAmt = Number(input.discountAmount) || 0;
  const discountPct = Number(input.discountPercent) || 0;
  const afterDiscount = Math.max(0, total - discountAmt);

  let y = 40;

  // —— Header: logo left, title + meta right ——
  const logoSize = 64;
  if (company.logoPng) {
    try {
      doc.image(company.logoPng, PAGE_LEFT, y, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // ignore broken logo
    }
  }

  const titleRight = PAGE_RIGHT;
  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor('#111827')
    .text(input.docTitle, PAGE_LEFT, y + 4, { width: PAGE_WIDTH, align: 'right' });

  let metaY = y + 40;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111827')
    .text(`${input.docTitle} No:  ${shortDocNo(input.docNo)}`, PAGE_LEFT, metaY, {
      width: PAGE_WIDTH,
      align: 'right',
    });
  metaY = doc.y + 2;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111827')
    .text(`${input.docTitle} Date:  ${formatDocDateTime(input.docDate)}`, PAGE_LEFT, metaY, {
      width: PAGE_WIDTH,
      align: 'right',
    });
  metaY = doc.y;

  y = Math.max(y + logoSize, metaY + 18) + 18;

  // —— From / To (open layout, no boxes) ——
  const mid = PAGE_LEFT + PAGE_WIDTH / 2;
  const leftW = PAGE_WIDTH / 2 - 16;
  const rightW = PAGE_WIDTH / 2 - 8;
  const fromTop = y;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('From', PAGE_LEFT, fromTop);
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text(company.name, PAGE_LEFT, fromTop + 16, { width: leftW });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#374151')
    .text(tagline, PAGE_LEFT, doc.y + 4, { width: leftW, align: 'left' });
  const fromBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('To', mid + 8, fromTop, {
    width: rightW,
    align: 'right',
  });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor('#111827')
    .text(input.customerName || '-', mid + 8, fromTop + 16, { width: rightW, align: 'right' });
  let toY = doc.y + 4;
  const toLines = [
    input.customerAddress ? `Address: ${input.customerAddress}` : null,
    input.customerPhone ? `Telephone: ${input.customerPhone}` : null,
    input.customerEmail ? `Email: ${input.customerEmail}` : null,
    input.contactPerson ? `Contact Person: ${input.contactPerson}` : null,
  ].filter(Boolean) as string[];
  doc.font('Helvetica').fontSize(9).fillColor('#374151');
  for (const line of toLines) {
    doc.text(line, mid + 8, toY, { width: rightW, align: 'right' });
    toY = doc.y + 1;
  }

  y = Math.max(fromBottom, toY) + 20;

  // —— Description ——
  y = drawUnderlinedHeading(doc, 'Description', PAGE_LEFT, y) + 4;
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111827')
    .text(dashOr(input.description), PAGE_LEFT, y, { width: PAGE_WIDTH });
  y = doc.y + 16;

  // —— Items table ——
  y = drawUnderlinedHeading(doc, `${input.docTitle} Items`, PAGE_LEFT, y) + 8;

  const cols = [
    { label: 'No', width: 32, align: 'center' as const },
    { label: 'Item', width: 230, align: 'left' as const },
    { label: 'Qty', width: 55, align: 'right' as const },
    { label: 'Rate', width: 90, align: 'right' as const },
    { label: 'Amount ()', width: 102, align: 'right' as const },
  ];
  const tableW = cols.reduce((s, c) => s + c.width, 0);
  const headerH = 22;
  const rowH = 28;

  const tableTop = y;
  doc.rect(PAGE_LEFT, y, tableW, headerH).strokeColor('#9ca3af').lineWidth(0.7).stroke();
  let x = PAGE_LEFT;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827');
  for (const col of cols) {
    doc.text(col.label, x + 4, y + 7, { width: col.width - 8, align: col.align });
    x += col.width;
  }
  // vertical rules in header
  x = PAGE_LEFT;
  for (let i = 0; i < cols.length - 1; i++) {
    x += cols[i].width;
    doc
      .moveTo(x, y)
      .lineTo(x, y + headerH)
      .strokeColor('#9ca3af')
      .lineWidth(0.5)
      .stroke();
  }
  y += headerH;

  const bodyRows = Math.max(input.lines.length, 2);
  for (let i = 0; i < bodyRows; i++) {
    const line = input.lines[i];
    doc.rect(PAGE_LEFT, y, tableW, rowH).strokeColor('#9ca3af').lineWidth(0.5).stroke();
    x = PAGE_LEFT;
    for (let c = 0; c < cols.length - 1; c++) {
      x += cols[c].width;
      doc
        .moveTo(x, y)
        .lineTo(x, y + rowH)
        .strokeColor('#9ca3af')
        .lineWidth(0.5)
        .stroke();
    }
    if (line) {
      const cells = [`${i + 1}.`, line.item, line.qty, line.rate, line.amount];
      x = PAGE_LEFT;
      cols.forEach((col, idx) => {
        if (idx === 1) {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#111827')
            .text(cells[idx], x + 4, y + 5, {
              width: col.width - 8,
              align: 'left',
              lineBreak: false,
              ellipsis: true,
            });
          doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text('-', x + 4, y + 16, {
            width: col.width - 8,
          });
        } else {
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#111827')
            .text(cells[idx], x + 4, y + 9, {
              width: col.width - 8,
              align: col.align,
              lineBreak: false,
            });
        }
        x += col.width;
      });
    }
    y += rowH;
  }

  doc
    .rect(PAGE_LEFT, tableTop, tableW, headerH + bodyRows * rowH)
    .strokeColor('#6b7280')
    .lineWidth(0.9)
    .stroke();

  y += 22;

  // —— AUTHORIZED watermark behind signatures ——
  if (input.showAuthorizedWatermark !== false) {
    doc.save();
    doc.opacity(0.12);
    doc.rotate(-28, { origin: [PAGE_LEFT + 110, y + 40] });
    doc
      .font('Helvetica-Bold')
      .fontSize(36)
      .fillColor('#9ca3af')
      .text('AUTHORIZED', PAGE_LEFT + 20, y + 10, { width: 260, align: 'left' });
    doc.restore();
  }

  // —— Prepared / Authorized (left) + totals (right) ——
  const sigY = y;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Prepared By:', PAGE_LEFT, sigY);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111827')
    .text((input.preparedBy || '-').toUpperCase(), PAGE_LEFT + 85, sigY);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Authorized By:', PAGE_LEFT, sigY + 18);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#111827')
    .text((input.authorizedBy || input.preparedBy || '-').toUpperCase(), PAGE_LEFT + 95, sigY + 18);

  const totX = 330;
  const totLabelW = 110;
  const totValW = PAGE_RIGHT - totX - totLabelW;
  let totY = sigY - 4;

  const drawTotalRow = (
    label: string,
    value: string,
    opts?: { bold?: boolean; muted?: boolean; rule?: boolean }
  ) => {
    if (opts?.rule) {
      doc
        .moveTo(totX + totLabelW, totY - 2)
        .lineTo(PAGE_RIGHT, totY - 2)
        .strokeColor('#9ca3af')
        .lineWidth(0.6)
        .stroke();
    }
    doc
      .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10)
      .fillColor(opts?.muted ? '#9ca3af' : '#111827')
      .text(label, totX, totY, { width: totLabelW, align: 'left' });
    doc
      .font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(10)
      .fillColor(opts?.muted ? '#9ca3af' : '#111827')
      .text(value, totX + totLabelW, totY, { width: totValW, align: 'right' });
    totY += 16;
  };

  drawTotalRow('Total Amount:', money(total));
  drawTotalRow('Less Discount:', `${discountPct.toFixed(2)} % | ${money(discountAmt)}`);
  drawTotalRow('After Discount:', money(afterDiscount), { rule: true });
  drawTotalRow('VAT Inclusive:', money(tax), { muted: true, rule: true });
  drawTotalRow('Amount Payable:', money(total), { bold: true, rule: true });

  if (input.paidAmount != null) {
    drawTotalRow('Paid:', money(Number(input.paidAmount)));
  }
  if (input.balanceDue != null) {
    drawTotalRow('Balance Due:', money(Number(input.balanceDue)), { bold: true });
  }

  y = Math.max(sigY + 50, totY) + 18;

  // —— Terms / Plan / Comments ——
  const footerSections: { label: string; value?: string }[] = [
    { label: 'Terms and Conditions', value: input.terms },
    { label: 'Plan', value: input.plan },
    { label: 'Comments', value: input.comments },
  ];
  for (const section of footerSections) {
    y = drawUnderlinedHeading(doc, section.label, PAGE_LEFT, y) + 3;
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(dashOr(section.value), PAGE_LEFT, y);
    y = doc.y + 12;
  }

  // —— Page footer ——
  const footerY = 800;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6b7280');
  doc.text(stamp, PAGE_LEFT, footerY, { width: 120, align: 'left' });
  doc.text('Page 1', PAGE_LEFT, footerY, { width: PAGE_WIDTH, align: 'center' });
  doc.text('ERP By AbexCore Technologies', PAGE_LEFT, footerY, {
    width: PAGE_WIDTH,
    align: 'right',
  });
}

export function renderChekimaPdf(input: ChekimaDocInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawChekimaTradingDocument(doc, input);
    doc.end();
  });
}
