import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { config } from '../config';
import { getCompanySettings } from './company';
import { isPlatformCompanySlug } from './platform';
import { AppError } from '../middleware/errorHandler';

/** Medium blue matching classic Amazon Filtration delivery-note stationery. */
export const DOC_BLUE = '#1e6bb8';
export const DOC_BLUE_DARK = '#155a9c';
export const DOC_LINE = '#5b9fd4';
export const DOC_MUTED = '#3d6f99';

export const PAGE_LEFT = 48;
export const PAGE_RIGHT = 547;
export const PAGE_WIDTH = PAGE_RIGHT - PAGE_LEFT;

export type CompanyDocHeader = {
  name: string;
  legalName: string;
  addressLine: string;
  contactLine: string;
  phone: string;
  email: string;
  taxPin: string;
  paybillNumber: string;
  accountNumber: string;
  vatRate: number;
  logoPng: Buffer | null;
  /** Hex primary used for stationery (quotes, invoices, delivery notes). */
  primaryColor: string;
  primaryDark: string;
  mutedColor: string;
};

type DocInk = {
  primary: string;
  dark: string;
  line: string;
  muted: string;
};

const docInkByPdf = new WeakMap<object, DocInk>();

function inkFor(doc: PDFKit.PDFDocument): DocInk {
  return (
    docInkByPdf.get(doc) || {
      primary: DOC_BLUE,
      dark: DOC_BLUE_DARK,
      line: DOC_LINE,
      muted: DOC_MUTED,
    }
  );
}

export function bindDocInk(doc: PDFKit.PDFDocument, company: CompanyDocHeader): DocInk {
  const ink: DocInk = {
    primary: company.primaryColor || DOC_BLUE,
    dark: company.primaryDark || DOC_BLUE_DARK,
    muted: company.mutedColor || DOC_MUTED,
    line: lightenHex(company.primaryColor || DOC_BLUE, 0.28),
  };
  docInkByPdf.set(doc, ink);
  return ink;
}

function normalizeHexColor(raw: string | null | undefined, fallback: string): string {
  const v = String(raw || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v.toLowerCase();
  return fallback;
}

function darkenHex(hex: string, amount = 0.18): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function lightenHex(hex: string, amount = 0.35): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amount));
  const g = Math.min(255, Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amount));
  const b = Math.min(255, Math.round((n & 255) + (255 - (n & 255)) * amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

async function buildPlatformLogoPng(): Promise<Buffer> {
  const faviconCandidates = [
    path.resolve(process.cwd(), '../frontend/public/favicon.svg'),
    path.resolve(process.cwd(), 'frontend/public/favicon.svg'),
    path.resolve(__dirname, '../../../frontend/public/favicon.svg'),
  ];
  for (const candidate of faviconCandidates) {
    if (fs.existsSync(candidate)) {
      return sharp(candidate)
        .resize(384, 384, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    }
  }
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" rx="48" fill="${DOC_BLUE}"/>
      <text x="128" y="168" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-size="120" font-weight="700" fill="#ffffff">A</text>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function companyLogoDiskPath(logo: string | null | undefined): string | null {
  if (!logo) return null;
  const filename = path.basename(logo);
  if (!filename || filename === '.' || filename === '..') return null;
  return path.resolve(config.uploadDir, 'companies', filename);
}

async function resolveCompanyLogoPng(company: {
  logo: string | null;
  slug: string;
}): Promise<Buffer | null> {
  const diskPath = companyLogoDiskPath(company.logo);
  if (diskPath && fs.existsSync(diskPath)) {
    try {
      return await sharp(diskPath)
        .resize(384, 384, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();
    } catch {
      // fall through
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

export async function resolveCompanyDocHeader(companyId: string): Promise<CompanyDocHeader> {
  const company = await getCompanySettings(companyId);
  if (!company) throw new AppError('Company not found for this document', 404);

  const { ensureCompanyBrandColors } = await import('./ensureCompanyBrand');
  const brand = await ensureCompanyBrandColors({
    id: company.id,
    slug: company.slug,
    brandMode: (company as { brandMode?: string | null }).brandMode,
    brandPrimary: (company as { brandPrimary?: string | null }).brandPrimary,
    brandAccent: (company as { brandAccent?: string | null }).brandAccent,
    docPrimaryColor: (company as { docPrimaryColor?: string | null }).docPrimaryColor,
  });

  const displayName = company.name?.trim() || company.legalName?.trim() || 'Company';
  const legalName = company.legalName?.trim() || displayName;
  const addressParts = [company.address?.trim(), company.city?.trim()].filter(Boolean) as string[];
  const addressLine =
    addressParts.length === 2 &&
    addressParts[0]!.toLowerCase().includes(addressParts[1]!.toLowerCase())
      ? addressParts[0]!
      : addressParts.join(', ');

  const phone = company.phone?.trim() || '';
  const email = company.email?.trim() || '';
  const contactBits = [
    addressLine || undefined,
    phone ? `Tel: ${phone}` : undefined,
    email ? `Email: ${email}` : undefined,
  ].filter(Boolean);

  const paybillNumber = company.coopPaybillNumber?.trim() || '';
  const accountNumber = company.mpesaAccountNumber?.trim() || '';
  const primaryColor = normalizeHexColor(brand.docPrimaryColor || brand.brandPrimary, DOC_BLUE);

  return {
    name: displayName,
    legalName,
    addressLine,
    contactLine: contactBits.join(' | '),
    phone,
    email,
    taxPin: company.taxPin?.trim() || '',
    paybillNumber,
    accountNumber,
    vatRate: Number(company.vatRate),
    logoPng: await resolveCompanyLogoPng({ logo: company.logo, slug: company.slug }),
    primaryColor,
    primaryDark: darkenHex(primaryColor),
    mutedColor: lightenHex(primaryColor, 0.25),
  };
}

export type DocRefField = { label: string; value: string };

const DOC_LOGO_SIZE = 72;
const DOC_BADGE_MIN_W = 118;
const DOC_BADGE_MAX_W = 150;

/** Split long doc-type labels so they fit inside the header badge (e.g. PURCHASE / ORDER). */
function docTypeBadgeLines(label: string): string[] {
  const upper = label.toUpperCase().trim();
  if (!upper.includes(' ')) return [upper];
  const parts = upper.split(/\s+/).filter(Boolean);
  if (parts.length === 2) return parts;
  if (parts.length > 2) {
    const mid = Math.ceil(parts.length / 2);
    return [parts.slice(0, mid).join(' '), parts.slice(mid).join(' ')];
  }
  return [upper];
}

/**
 * Classic stationery letterhead:
 * logo + company name, contact strip, optional Lipa na M-Pesa block, blue doc-type badge.
 * Returns Y position below the header.
 */
export function drawAmazonStyleHeader(
  doc: PDFKit.PDFDocument,
  company: CompanyDocHeader,
  docTypeBadge: string,
  options?: { showPaybill?: boolean }
): number {
  const top = 40;
  const logoSize = DOC_LOGO_SIZE;
  const ink = bindDocInk(doc, company);
  const primary = ink.primary;
  const muted = ink.muted;

  if (company.logoPng) {
    try {
      doc.image(company.logoPng, PAGE_LEFT, top, {
        fit: [logoSize, logoSize],
        align: 'center',
        valign: 'center',
      });
    } catch {
      // continue without logo
    }
  }

  const nameX = company.logoPng ? PAGE_LEFT + logoSize + 12 : PAGE_LEFT;
  const nameWidth = PAGE_RIGHT - nameX - DOC_BADGE_MAX_W - 8;

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor(primary)
    .text(company.name.toUpperCase(), nameX, top + 6, { width: Math.max(nameWidth, 180), align: 'left' });

  let y = doc.y + 2;
  if (company.contactLine) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(muted)
      .text(company.contactLine, nameX, y, { width: Math.max(nameWidth, 180), align: 'left' });
    y = doc.y;
  }

  // Document type badge (top-right blue box) — supports two-line labels.
  const badgeLines = docTypeBadgeLines(docTypeBadge);
  const badgeFontSize = badgeLines.length > 1 ? 10 : 12;
  const badgeLineHeight = badgeLines.length > 1 ? 12 : 14;
  const badgePadY = 7;
  const badgeH = badgePadY * 2 + badgeLines.length * badgeLineHeight;
  const longestLine = badgeLines.reduce((max, line) => Math.max(max, line.length), 0);
  const badgeW = Math.min(DOC_BADGE_MAX_W, Math.max(DOC_BADGE_MIN_W, longestLine * 7.2));
  const badgeX = PAGE_RIGHT - badgeW;
  const badgeY = top + 4;
  doc.rect(badgeX, badgeY, badgeW, badgeH).fill(primary);
  badgeLines.forEach((line, index) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(badgeFontSize)
      .fillColor('#ffffff')
      .text(line, badgeX, badgeY + badgePadY + index * badgeLineHeight, {
        width: badgeW,
        align: 'center',
        lineBreak: false,
      });
  });

  // Payment / M-Pesa block — customer-facing docs only (invoices, delivery notes, customer statements).
  y = Math.max(y, top + logoSize) + 10;
  const showPaybill = options?.showPaybill === true && !!company.paybillNumber;
  if (showPaybill) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(primary).text('LIPA NA MPESA', PAGE_LEFT, y);
    y = doc.y + 1;
    doc.font('Helvetica').fontSize(8).fillColor(primary);
    doc.text(`PAYBILL NUMBER: ${company.paybillNumber}`, PAGE_LEFT, y);
    y = doc.y;
    if (company.accountNumber) {
      doc.text(`ACC. NO: ${company.accountNumber}`, PAGE_LEFT, y);
      y = doc.y;
    }
    doc.text(`B/S NAME: ${company.legalName.toUpperCase()}`, PAGE_LEFT, y);
    y = doc.y + 6;
  } else if (company.taxPin) {
    doc.font('Helvetica').fontSize(8).fillColor(primary).text(`TAX PIN: ${company.taxPin}`, PAGE_LEFT, y);
    y = doc.y + 6;
  }

  return y + 4;
}

/** M/s party block (left) + Date / Doc No / Order No refs (right). */
export function drawPartyAndRefs(
  doc: PDFKit.PDFDocument,
  startY: number,
  partyName: string,
  partyAddress: string,
  refs: DocRefField[]
): number {
  let y = startY;
  const ink = inkFor(doc);

  doc.font('Helvetica-Bold').fontSize(10).fillColor(ink.primary).text('M/s', PAGE_LEFT, y);
  const nameLineX = PAGE_LEFT + 28;
  doc
    .moveTo(nameLineX, y + 12)
    .lineTo(300, y + 12)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(partyName || '—', nameLineX + 2, y, {
    width: 270,
  });
  y = Math.max(doc.y, y + 16) + 2;

  doc
    .moveTo(PAGE_LEFT, y + 12)
    .lineTo(300, y + 12)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();
  if (partyAddress) {
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text(partyAddress, PAGE_LEFT + 2, y, {
      width: 298,
    });
  }
  y = Math.max(doc.y, y + 16);

  // Right-side refs
  let refY = startY;
  const refX = 330;
  const refW = PAGE_RIGHT - refX;
  for (const ref of refs) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text(ref.label, refX, refY, {
      width: 70,
      continued: false,
    });
    doc
      .moveTo(refX + 72, refY + 11)
      .lineTo(PAGE_RIGHT, refY + 11)
      .strokeColor(ink.line)
      .lineWidth(0.8)
      .stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(ref.value || '—', refX + 74, refY, {
      width: refW - 74,
    });
    refY += 18;
  }

  return Math.max(y, refY) + 10;
}

export function drawInstructionLine(doc: PDFKit.PDFDocument, y: number, text: string): number {
  const ink = inkFor(doc);
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor(ink.primary)
    .text(text, PAGE_LEFT, y, { width: PAGE_WIDTH, align: 'left' });
  return doc.y + 8;
}

type TableColumn = {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
};

/** Colored-header table matching the delivery note Qty | Description layout. */
export function drawDocTable(
  doc: PDFKit.PDFDocument,
  startY: number,
  columns: TableColumn[],
  rows: Record<string, string>[],
  opts?: { minBodyRows?: number; footerLeft?: string; footerCenter?: string }
): number {
  const ink = inkFor(doc);
  const headerH = 22;
  const rowH = 18;
  const minRows = opts?.minBodyRows ?? Math.max(rows.length, 8);
  const tableW = columns.reduce((s, c) => s + c.width, 0);
  const tableX = PAGE_LEFT;
  let y = startY;

  // Outer border
  const bodyH = minRows * rowH;
  const totalH = headerH + bodyH;

  doc.rect(tableX, y, tableW, totalH).strokeColor(ink.primary).lineWidth(1.2).stroke();

  // Header bar
  doc.rect(tableX, y, tableW, headerH).fill(ink.primary);
  let x = tableX;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff');
  for (const col of columns) {
    doc.text(col.label, x + 4, y + 6, {
      width: col.width - 8,
      align: col.align || 'left',
    });
    x += col.width;
  }

  // Vertical column dividers + horizontal row lines
  y += headerH;
  x = tableX;
  for (let i = 0; i < columns.length - 1; i++) {
    x += columns[i].width;
    doc
      .moveTo(x, startY)
      .lineTo(x, startY + totalH)
      .strokeColor(ink.primary)
      .lineWidth(0.8)
      .stroke();
  }

  for (let r = 1; r < minRows; r++) {
    const ly = y + r * rowH;
    doc
      .moveTo(tableX, ly)
      .lineTo(tableX + tableW, ly)
      .strokeColor(ink.line)
      .lineWidth(0.5)
      .stroke();
  }

  // Row content
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
  for (let i = 0; i < rows.length; i++) {
    const rowY = y + i * rowH + 4;
    if (rowY + rowH > startY + totalH - 4) break;
    let cx = tableX;
    for (const col of columns) {
      doc.text(rows[i][col.key] || '', cx + 4, rowY, {
        width: col.width - 8,
        align: col.align || 'left',
        lineBreak: false,
        ellipsis: true,
      });
      cx += col.width;
    }
  }

  // Footer inside table bottom
  const footerY = startY + totalH - 16;
  if (opts?.footerLeft) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text(opts.footerLeft, tableX + 6, footerY);
  }
  if (opts?.footerCenter) {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#b91c1c')
      .text(opts.footerCenter, tableX, footerY, { width: tableW, align: 'center' });
  }

  return startY + totalH + 10;
}

export function drawSignatureBlock(
  doc: PDFKit.PDFDocument,
  y: number,
  opts?: {
    confirmLabel?: string;
    /** Pre-filled name on the Confirmed by line (e.g. sales person). */
    confirmName?: string;
    receiveLabel?: string;
    receiveName?: string;
    instruction?: string;
  }
): number {
  const ink = inkFor(doc);
  if (opts?.instruction) {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(ink.primary)
      .text(opts.instruction, PAGE_LEFT, y, { width: PAGE_WIDTH, align: 'center' });
    y = doc.y + 12;
  }

  const confirm = opts?.confirmLabel || 'Confirmed by:';
  const receive = opts?.receiveLabel || 'Received by:';

  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary);
  doc.text(confirm, PAGE_LEFT, y);
  doc
    .moveTo(PAGE_LEFT + 80, y + 11)
    .lineTo(260, y + 11)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();
  if (opts?.confirmName) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#0f172a')
      .text(opts.confirmName, PAGE_LEFT + 82, y, { width: 175 });
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('Sign:', 270, y);
  doc
    .moveTo(300, y + 11)
    .lineTo(PAGE_RIGHT, y + 11)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();

  y += 22;
  doc.text(receive, PAGE_LEFT, y);
  doc
    .moveTo(PAGE_LEFT + 80, y + 11)
    .lineTo(260, y + 11)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();
  if (opts?.receiveName) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#0f172a')
      .text(opts.receiveName, PAGE_LEFT + 82, y, { width: 175 });
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ink.primary).text('Sign:', 270, y);
  doc
    .moveTo(300, y + 11)
    .lineTo(PAGE_RIGHT, y + 11)
    .strokeColor(ink.line)
    .lineWidth(0.8)
    .stroke();

  return y + 24;
}

/** Totals block for invoices / POs (right-aligned under table). */
export function drawMoneyTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  lines: { label: string; value: string; bold?: boolean }[]
): number {
  const ink = inkFor(doc);
  for (const line of lines) {
    doc
      .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(line.bold ? 11 : 9)
      .fillColor(ink.primary)
      .text(line.label, 320, y, { width: 100, align: 'right' });
    doc
      .font(line.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fillColor('#0f172a')
      .text(line.value, 430, y, { width: PAGE_RIGHT - 430, align: 'right' });
    y += line.bold ? 16 : 14;
  }
  return y;
}

export function createDocPdf(): PDFKit.PDFDocument {
  return new PDFDocument({
    margin: 40,
    size: 'A4',
    info: { Author: 'AbexCore ERP' },
  });
}

export function bufferFromPdf(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}
