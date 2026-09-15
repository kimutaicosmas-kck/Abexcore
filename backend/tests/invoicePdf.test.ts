import { describe, expect, it } from 'vitest';
import PDFDocument from 'pdfkit';
import {
  drawAmazonStyleHeader,
  drawPartyAndRefs,
  drawInstructionLine,
  drawDocTable,
  drawMoneyTotals,
  drawSignatureBlock,
  ensureDocSpace,
} from '../src/utils/documentTemplate';

const company = {
  slug: 'amazon-filtration-k-ltd',
  name: 'AMAZON FILTRATION (K) LTD',
  legalName: 'AMAZON FILTRATION (K) LTD',
  addressLine: 'Nairobi',
  contactLine: 'Tel: 0720799363',
  phone: '0720799363',
  email: 'filters@example.com',
  taxPin: 'P123',
  paybillNumber: '400200',
  accountNumber: '40098634',
  vatRate: 16,
  logoPng: null,
  primaryColor: '#1e6bb8',
  primaryDark: '#155a9c',
  mutedColor: '#3d6f99',
};

const INV_45454_ITEMS = [
  ['7', '1-14215153-0 Air Filter (FRR OLD)', '1,050', '7,350'],
  ['10', 'Air Filter 17801-50060', '160', '1,600'],
  ['50', '87139-12010 Cabin Filter', '150', '7,500'],
  ['2', 'K2845', '3,000', '6,000'],
  ['17', '27277-4M400 Cabin Filter', '180', '3,060'],
  ['200', '90915-03002 Oil Filter', '100', '20,000'],
  ['200', '17801-21050 AIR FILTER', '93', '18,600'],
  ['100', '90915-10004 Oil Filter', '100', '10,000'],
  ['50', '87139-47010 Cabin Filter', '150', '7,500'],
  ['2', 'K2841 AIR FILTER', '2,800', '5,600'],
  ['100', '16546-ED500 AIR FILTER', '180', '18,000'],
  ['50', 'Air Filter 17801-23030', '93', '4,650'],
  ['2', 'K2640 AIR FILTER', '3,500', '7,000'],
  ['5', '885409052516 (2516) AIR FILTER', '2,000', '10,000'],
  ['10', '8-98092481-1 Water Separator', '430', '4,300'],
  ['100', '17801-21060 AIR FILTER', '180', '18,000'],
  ['2', 'K3046S AIR FILTER', '3,300', '6,600'],
  ['26', '04152-38010 Oil Filter', '100', '2,600'],
  ['30', 'Air Filter 17801-31120', '170', '5,100'],
  ['30', '17801-30070 AIR FILTER', '340', '10,200'],
  ['14', 'Air Filter ZJ01-13-Z40', '160', '2,240'],
  ['50', '87139-06050 Cabin Filter', '150', '7,500'],
  ['100', 'Air Filter 17801-21030', '93', '9,300'],
  ['300', '90915-10001 Oil Filter', '100', '30,000'],
  ['36', '16546-V0100 AIR FILTER', '180', '6,480'],
  ['30', 'ME035829 Fuel Filter', '250', '7,500'],
];

function countPages(buf: Buffer): number {
  const m = buf.toString('latin1').match(/\/Type\s*\/Page\b/g);
  return m ? m.length : 0;
}

function renderInvoicePdf(itemCount: number): Promise<Buffer> {
  const rows = INV_45454_ITEMS.slice(0, itemCount).map(([qty, description, unit, total]) => ({
    qty,
    description,
    unit,
    total,
  }));
  const closingH = 5 * 14 + 16 + 16 + 72;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  let y = drawAmazonStyleHeader(doc, company as never, 'INVOICE', { showPaybill: true });
  y = drawPartyAndRefs(doc, y, 'Hazon Investments Ltd', 'Eldoret', [
    { label: 'Date', value: '14/09/2026' },
    { label: 'Invoice No.', value: 'INV-2026-00454' },
    { label: 'Order / LPO', value: '—' },
  ]);
  y = drawInstructionLine(doc, y, 'Please receive the following goods in good order and condition');
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
      minBodyRows: 3,
      footerLeft: 'E.& O.E',
      footerCenter: 'No. INV-2026-00454',
      closingBlockHeight: closingH,
    }
  );
  y = ensureDocSpace(doc, y, closingH);
  y = drawMoneyTotals(doc, y, [
    { label: 'Subtotal', value: 'KES 204,034' },
    { label: 'VAT (16%)', value: 'KES 32,646' },
    { label: 'Total', value: 'KES 236,680', bold: true },
    { label: 'Paid', value: 'KES 0' },
    { label: 'Balance due', value: 'KES 236,680', bold: true },
  ]);
  drawSignatureBlock(doc, y + 8, {
    instruction: 'Please receive the following goods in good order and condition.',
    confirmLabel: 'Confirmed by:',
    receiveLabel: 'Received by:',
  });
  doc.end();
  return done;
}

describe('invoice PDF pagination', () => {
  it('INV-2026-00454 (26 lines) must not produce 8 blank-style pages', async () => {
    const buf = await renderInvoicePdf(26);
    const pages = countPages(buf);
    expect(pages).toBeLessThanOrEqual(2);
    expect(pages).toBeGreaterThan(0);
  });

  it('long invoice (45 lines) stays within a few pages', async () => {
    const buf = await renderInvoicePdf(45);
    expect(countPages(buf)).toBeLessThanOrEqual(3);
  });

  it('wraps long line descriptions without extra blank pages', async () => {
    const longRows = [
      {
        qty: '1',
        description: '2065234 / 35 AIR CLEANER — 2065234 / 35 AIR CLEANER',
        unit: '1,050',
        total: '1,050',
      },
      {
        qty: '1',
        description: '4600310 FUEL WATER SEPARATOR — 4600310 FUEL WATER SEPARATOR',
        unit: '430',
        total: '430',
      },
      {
        qty: '1',
        description: '1R1804 — 1R1804 FUEL FILTER',
        unit: '250',
        total: '250',
      },
    ];
    const closingH = 5 * 14 + 16 + 16 + 72;
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

    let y = drawInstructionLine(doc, 40, 'We are pleased to quote the following goods and prices');
    y = drawDocTable(
      doc,
      y,
      [
        { key: 'qty', label: 'Qty', width: 50, align: 'center' },
        { key: 'description', label: 'Description', width: 265 },
        { key: 'unit', label: 'Unit Price', width: 92, align: 'right' },
        { key: 'total', label: 'Amount', width: 92, align: 'right' },
      ],
      longRows,
      {
        minBodyRows: 3,
        footerLeft: 'E.& O.E',
        footerCenter: 'No. QT-2026-00001',
        closingBlockHeight: closingH,
      }
    );
    doc.end();
    const buf = await done;
    expect(countPages(buf)).toBe(1);
  });
});
