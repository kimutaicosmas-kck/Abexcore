import ExcelJS from 'exceljs';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { generateNumber } from '../utils/date';
import { injectTenantData, requireTenantId } from '../utils/tenant';
import { AccountingService } from './accounting.service';

export type ImportEntity = 'products' | 'customers' | 'materials' | 'suppliers' | 'employees';

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
}

type RowMap = Record<string, string>;

const TEMPLATES: Record<
  ImportEntity,
  { sheetName: string; headers: string[]; sample: (string | number)[]; notes: string[] }
> = {
  products: {
    sheetName: 'Products',
    headers: [
      'sku',
      'name',
      'category',
      'barcode',
      'description',
      'sellingPrice',
      'distributorPrice',
      'retailPrice',
      'manufacturingCost',
      'minStockLevel',
      'initialQuantity',
      'warehouseCode',
    ],
    sample: [
      'OF-100',
      'Oil Filter Sample',
      'Oil Filter',
      '',
      'Opening catalog row',
      150,
      120,
      180,
      85,
      50,
      100,
      'WH-FG',
    ],
    notes: [
      'sku and name are required. category is matched by name (created if missing).',
      'initialQuantity sets opening stock in the finished-goods warehouse (warehouseCode optional; defaults to first FG warehouse).',
      'Existing sku rows are updated (including opening stock when initialQuantity is provided).',
    ],
  },
  customers: {
    sheetName: 'Customers',
    headers: [
      'code',
      'name',
      'vatStatus',
      'type',
      'email',
      'phone',
      'address',
      'city',
      'taxPin',
      'creditLimit',
      'paymentTerms',
      'notes',
    ],
    sample: [
      'CUST-001',
      'Sample Dealer Ltd',
      'VAT',
      'DEALER',
      'orders@example.com',
      '0700000000',
      'Industrial Area',
      'Nairobi',
      'P051234567A',
      500000,
      30,
      '',
    ],
    notes: [
      'code, name, and vatStatus (VAT or NON_VAT) are required.',
      'taxPin is required when vatStatus is VAT.',
      'type: DEALER | RETAIL_SHOP | INDUSTRY | GOVERNMENT | NGO',
      'Existing customer codes are updated.',
    ],
  },
  materials: {
    sheetName: 'Materials',
    headers: [
      'code',
      'name',
      'type',
      'unit',
      'unitCost',
      'minStockLevel',
      'reorderQty',
      'supplierCode',
      'description',
      'initialQuantity',
      'warehouseCode',
    ],
    sample: ['RM-STEEL', 'Steel Shell', 'Steel', 'pcs', 45, 500, 1000, '', '', 200, 'WH-RM'],
    notes: [
      'name and type are required. type is matched by name (created if missing).',
      'code is optional — auto-generated when blank.',
      'initialQuantity posts opening stock to a raw_materials warehouse (warehouseCode optional).',
      'Existing material codes are updated.',
    ],
  },
  suppliers: {
    sheetName: 'Suppliers',
    headers: [
      'code',
      'name',
      'email',
      'phone',
      'address',
      'city',
      'taxPin',
      'paymentTerms',
      'leadTimeDays',
      'notes',
    ],
    sample: [
      'SUP-001',
      'Steel Supplies Ltd',
      'sales@example.com',
      '0700000001',
      'Mombasa Road',
      'Nairobi',
      '',
      30,
      14,
      '',
    ],
    notes: ['code and name are required. Existing supplier codes are updated.'],
  },
  employees: {
    sheetName: 'Employees',
    headers: [
      'employeeNo',
      'firstName',
      'lastName',
      'hireDate',
      'email',
      'phone',
      'gender',
      'position',
      'department',
      'branch',
      'salary',
    ],
    sample: [
      'EMP-001',
      'Jane',
      'Doe',
      '2026-01-15',
      'jane@example.com',
      '0700000002',
      'FEMALE',
      'Store Keeper',
      'Warehouse',
      'Head Office',
      45000,
    ],
    notes: [
      'employeeNo, firstName, lastName, and hireDate (YYYY-MM-DD) are required.',
      'department and branch are matched by name when provided.',
      'gender: MALE | FEMALE | UNSPECIFIED',
      'Existing employee numbers are updated.',
    ],
  },
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

const HEADER_ALIASES: Record<string, string> = {
  sku: 'sku',
  partnumber: 'sku',
  partno: 'sku',
  itemcode: 'sku',
  name: 'name',
  productname: 'name',
  materialname: 'name',
  customername: 'name',
  suppliername: 'name',
  category: 'category',
  categoryname: 'category',
  barcode: 'barcode',
  description: 'description',
  sellingprice: 'sellingPrice',
  price: 'sellingPrice',
  distributorprice: 'distributorPrice',
  retailprice: 'retailPrice',
  manufacturingcost: 'manufacturingCost',
  cost: 'manufacturingCost',
  minstocklevel: 'minStockLevel',
  minstock: 'minStockLevel',
  minimumstock: 'minStockLevel',
  initialquantity: 'initialQuantity',
  openingstock: 'initialQuantity',
  openingqty: 'initialQuantity',
  quantity: 'initialQuantity',
  qty: 'initialQuantity',
  warehousecode: 'warehouseCode',
  warehouse: 'warehouseCode',
  code: 'code',
  customercode: 'code',
  suppliercode: 'supplierCode',
  vatstatus: 'vatStatus',
  vat: 'vatStatus',
  type: 'type',
  email: 'email',
  phone: 'phone',
  address: 'address',
  city: 'city',
  taxpin: 'taxPin',
  pin: 'taxPin',
  creditlimit: 'creditLimit',
  paymentterms: 'paymentTerms',
  notes: 'notes',
  unit: 'unit',
  unitcost: 'unitCost',
  reorderqty: 'reorderQty',
  leadtimedays: 'leadTimeDays',
  employeeno: 'employeeNo',
  employeenumber: 'employeeNo',
  staffno: 'employeeNo',
  firstname: 'firstName',
  lastname: 'lastName',
  hiredate: 'hireDate',
  gender: 'gender',
  position: 'position',
  department: 'department',
  branch: 'branch',
  salary: 'salary',
  basicsalary: 'salary',
};

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('text' in value && value.text != null) return String(value.text).trim();
    if ('result' in value && value.result != null) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((t) => t.text).join('').trim();
    }
  }
  return String(value).trim();
}

function parseNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseIntQty(value: string | undefined): number | undefined {
  const n = parseNumber(value);
  if (n == null) return undefined;
  return Math.max(0, Math.round(n));
}

async function loadRows(buffer: Buffer): Promise<RowMap[]> {
  const workbook = new ExcelJS.Workbook();
  const lower = buffer.slice(0, 5).toString('utf8');
  if (lower.startsWith('sku') || lower.includes(',') || lower.includes(';')) {
    // Likely CSV — ExcelJS can still load many CSVs via xlsx; fall through.
  }
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError('Could not read spreadsheet. Upload an .xlsx Excel file.', 400);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError('Spreadsheet has no sheets', 400);

  const headerRow = sheet.getRow(1);
  const colMap = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = HEADER_ALIASES[normalizeHeader(cellToString(cell.value))];
    if (key) colMap.set(colNumber, key);
  });

  if (colMap.size === 0) {
    throw new AppError('No recognized column headers found in row 1', 400);
  }

  const rows: RowMap[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const mapped: RowMap = {};
    let hasValue = false;
    colMap.forEach((field, col) => {
      const text = cellToString(row.getCell(col).value);
      if (text) hasValue = true;
      mapped[field] = text;
    });
    if (hasValue) {
      mapped.__row = String(rowNumber);
      rows.push(mapped);
    }
  });

  return rows;
}

export class ExcelImportService {
  static async buildTemplate(entity: ImportEntity): Promise<Buffer> {
    const def = TEMPLATES[entity];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(def.sheetName);
    sheet.addRow(def.headers);
    sheet.getRow(1).font = { bold: true };
    sheet.addRow(def.sample);
    def.headers.forEach((_, i) => {
      sheet.getColumn(i + 1).width = Math.max(14, String(def.headers[i]).length + 4);
    });

    const notes = workbook.addWorksheet('Instructions');
    notes.addRow(['Import instructions']);
    notes.getRow(1).font = { bold: true };
    def.notes.forEach((line) => notes.addRow([line]));
    notes.getColumn(1).width = 100;

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  static async import(
    entity: ImportEntity,
    buffer: Buffer,
    userId: string
  ): Promise<ImportResult> {
    const rows = await loadRows(buffer);
    if (rows.length === 0) {
      return { created: 0, updated: 0, skipped: 0, errors: [{ row: 1, message: 'No data rows found' }] };
    }

    switch (entity) {
      case 'products':
        return this.importProducts(rows, userId);
      case 'customers':
        return this.importCustomers(rows);
      case 'materials':
        return this.importMaterials(rows, userId);
      case 'suppliers':
        return this.importSuppliers(rows);
      case 'employees':
        return this.importEmployees(rows);
      default:
        throw new AppError('Unsupported import type', 400);
    }
  }

  private static async resolveOrCreateCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('category is required');
    const existing = await prisma.productCategory.findFirst({
      where: { name: trimmed, isActive: true },
    });
    if (existing) return existing;
    return prisma.productCategory.create({
      data: injectTenantData({ name: trimmed }),
    });
  }

  private static async resolveOrCreateMaterialType(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('type is required');
    const existing = await prisma.materialType.findFirst({
      where: { name: trimmed, isActive: true },
    });
    if (existing) return existing;
    const maxSort = await prisma.materialType.aggregate({ _max: { sortOrder: true } });
    return prisma.materialType.create({
      data: injectTenantData({
        name: trimmed,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      }),
    });
  }

  private static async resolveWarehouse(opts: {
    code?: string;
    preferredType: 'finished_goods' | 'raw_materials';
  }) {
    if (opts.code?.trim()) {
      const byCode = await prisma.warehouse.findFirst({
        where: {
          code: opts.code.trim(),
          isActive: true,
          deletedAt: null,
        },
      });
      if (byCode) return byCode;
    }
    const preferred = await prisma.warehouse.findFirst({
      where: { type: opts.preferredType, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (preferred) return preferred;
    return prisma.warehouse.findFirst({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static async postOpeningStock(opts: {
    warehouseId: string;
    productId?: string;
    rawMaterialId?: string;
    quantity: number;
    unitCost: number;
    userId: string;
    note: string;
  }) {
    if (opts.quantity <= 0) return;

    const existing = await prisma.stockLevel.findFirst({
      where: {
        warehouseId: opts.warehouseId,
        productId: opts.productId || null,
        rawMaterialId: opts.rawMaterialId || null,
        batchNumber: null,
      },
    });

    if (existing) {
      await prisma.stockLevel.update({
        where: { id: existing.id },
        data: {
          quantity: opts.quantity,
          unitCost: opts.unitCost || Number(existing.unitCost),
        },
      });
    } else {
      await prisma.stockLevel.create({
        data: {
          warehouseId: opts.warehouseId,
          productId: opts.productId,
          rawMaterialId: opts.rawMaterialId,
          quantity: opts.quantity,
          unitCost: opts.unitCost,
        },
      });
    }

    const invTx = await prisma.inventoryTransaction.create({
      data: {
        warehouseId: opts.warehouseId,
        type: 'RECEIPT',
        productId: opts.productId,
        rawMaterialId: opts.rawMaterialId,
        quantity: opts.quantity,
        unitCost: opts.unitCost,
        notes: opts.note,
        createdById: opts.userId,
      },
    });

    const glAmount = opts.quantity * opts.unitCost;
    if (glAmount > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await AccountingService.postInventoryAdjustment(tx, {
            reference: invTx.id,
            amount: glAmount,
            direction: 'increase',
            reason: opts.note,
          });
        });
      } catch {
        // Skip GL when chart of accounts is incomplete during bulk onboarding.
      }
    }
  }

  private static async importProducts(rows: RowMap[], userId: string): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const row of rows) {
      const rowNum = Number(row.__row || 0);
      try {
        const sku = row.sku?.trim();
        const name = row.name?.trim();
        if (!sku || !name) throw new Error('sku and name are required');

        const category = await this.resolveOrCreateCategory(row.category || 'Uncategorized');
        const barcode = row.barcode?.trim() || null;
        const payload = {
          sku,
          name,
          categoryId: category.id,
          barcode,
          description: row.description || undefined,
          sellingPrice: parseNumber(row.sellingPrice) ?? 0,
          distributorPrice: parseNumber(row.distributorPrice) ?? 0,
          retailPrice: parseNumber(row.retailPrice) ?? 0,
          manufacturingCost: parseNumber(row.manufacturingCost) ?? 0,
          minStockLevel: parseIntQty(row.minStockLevel) ?? 0,
          isImported: true,
          isActive: true,
        };

        if (barcode) {
          const taken = await prisma.product.findFirst({
            where: { barcode, NOT: { sku } },
          });
          if (taken) throw new Error(`Barcode already used by ${taken.sku}`);
        }

        const existing = await prisma.product.findFirst({ where: { sku } });
        let productId: string;
        if (existing) {
          const updated = await prisma.product.update({
            where: { id: existing.id },
            data: payload,
          });
          productId = updated.id;
          result.updated += 1;
        } else {
          const created = await prisma.product.create({
            data: injectTenantData(payload),
          });
          productId = created.id;
          result.created += 1;
        }

        const openingQty = parseIntQty(row.initialQuantity);
        if (openingQty != null && openingQty > 0) {
          const warehouse = await this.resolveWarehouse({
            code: row.warehouseCode,
            preferredType: 'finished_goods',
          });
          if (!warehouse) throw new Error('No warehouse available for opening stock');
          const unitCost =
            parseNumber(row.manufacturingCost) ??
            parseNumber(row.sellingPrice) ??
            0;
          await this.postOpeningStock({
            warehouseId: warehouse.id,
            productId,
            quantity: openingQty,
            unitCost,
            userId,
            note: `Opening stock from Excel import — ${sku}`,
          });
        }
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message : 'Failed to import row',
        });
        result.skipped += 1;
      }
    }

    return result;
  }

  private static async importCustomers(rows: RowMap[]): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const companyId = requireTenantId();
    const types = new Set(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']);

    for (const row of rows) {
      const rowNum = Number(row.__row || 0);
      try {
        const code = row.code?.trim();
        const name = row.name?.trim();
        const vatRaw = (row.vatStatus || 'NON_VAT').trim().toUpperCase().replace(/[\s-]+/g, '_');
        const vatStatus = vatRaw === 'VAT' ? 'VAT' : vatRaw === 'NON_VAT' || vatRaw === 'NONVAT' ? 'NON_VAT' : null;
        if (!code || !name) throw new Error('code and name are required');
        if (!vatStatus) throw new Error('vatStatus must be VAT or NON_VAT');
        const taxPin = row.taxPin?.trim() || undefined;
        if (vatStatus === 'VAT' && !taxPin) throw new Error('taxPin is required for VAT customers');

        const typeRaw = row.type?.trim().toUpperCase().replace(/[\s-]+/g, '_');
        const type = typeRaw && types.has(typeRaw) ? typeRaw : undefined;

        const payload = {
          code,
          name,
          vatStatus: vatStatus as 'VAT' | 'NON_VAT',
          type: type as 'DEALER' | 'RETAIL_SHOP' | 'INDUSTRY' | 'GOVERNMENT' | 'NGO' | undefined,
          email: row.email || undefined,
          phone: row.phone || undefined,
          address: row.address || undefined,
          city: row.city || undefined,
          taxPin,
          creditLimit: parseNumber(row.creditLimit),
          paymentTerms: parseIntQty(row.paymentTerms),
          notes: row.notes || undefined,
          isActive: true,
        };

        const existing = await prisma.customer.findUnique({
          where: { companyId_code: { companyId, code } },
        });
        if (existing) {
          await prisma.customer.update({ where: { id: existing.id }, data: payload });
          result.updated += 1;
        } else {
          await prisma.customer.create({ data: injectTenantData(payload) });
          result.created += 1;
        }
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message : 'Failed to import row',
        });
        result.skipped += 1;
      }
    }

    return result;
  }

  private static async importMaterials(rows: RowMap[], userId: string): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const companyId = requireTenantId();

    for (const row of rows) {
      const rowNum = Number(row.__row || 0);
      try {
        const name = row.name?.trim();
        if (!name) throw new Error('name is required');
        const materialType = await this.resolveOrCreateMaterialType(row.type || 'General');

        let supplierId: string | undefined;
        if (row.supplierCode?.trim()) {
          const supplier = await prisma.supplier.findFirst({
            where: { code: row.supplierCode.trim(), deletedAt: null },
          });
          if (!supplier) throw new Error(`Unknown supplierCode ${row.supplierCode}`);
          supplierId = supplier.id;
        }

        let code = row.code?.trim();
        if (!code) {
          const count = await prisma.rawMaterial.count();
          code = generateNumber('RM', count + 1);
        }

        const payload = {
          code,
          name,
          typeId: materialType.id,
          unit: row.unit?.trim() || 'pcs',
          unitCost: parseNumber(row.unitCost) ?? 0,
          minStockLevel: parseNumber(row.minStockLevel) ?? 0,
          reorderQty: parseNumber(row.reorderQty) ?? 0,
          description: row.description || undefined,
          supplierId,
          isActive: true,
        };

        const existing = await prisma.rawMaterial.findUnique({
          where: { companyId_code: { companyId, code } },
        });

        let materialId: string;
        if (existing) {
          const updated = await prisma.rawMaterial.update({
            where: { id: existing.id },
            data: payload,
          });
          materialId = updated.id;
          result.updated += 1;
        } else {
          const created = await prisma.rawMaterial.create({
            data: injectTenantData(payload),
          });
          materialId = created.id;
          result.created += 1;
        }

        const openingQty = parseIntQty(row.initialQuantity);
        if (openingQty != null && openingQty > 0) {
          const warehouse = await this.resolveWarehouse({
            code: row.warehouseCode,
            preferredType: 'raw_materials',
          });
          if (!warehouse) throw new Error('No warehouse available for opening stock');
          await this.postOpeningStock({
            warehouseId: warehouse.id,
            rawMaterialId: materialId,
            quantity: openingQty,
            unitCost: payload.unitCost,
            userId,
            note: `Opening stock from Excel import — ${code}`,
          });
        }
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message : 'Failed to import row',
        });
        result.skipped += 1;
      }
    }

    return result;
  }

  private static async importSuppliers(rows: RowMap[]): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const companyId = requireTenantId();

    for (const row of rows) {
      const rowNum = Number(row.__row || 0);
      try {
        const code = row.code?.trim();
        const name = row.name?.trim();
        if (!code || !name) throw new Error('code and name are required');

        const payload = {
          code,
          name,
          email: row.email || undefined,
          phone: row.phone || undefined,
          address: row.address || undefined,
          city: row.city || undefined,
          taxPin: row.taxPin || undefined,
          paymentTerms: parseIntQty(row.paymentTerms),
          leadTimeDays: parseIntQty(row.leadTimeDays),
          notes: row.notes || undefined,
          isActive: true,
        };

        const existing = await prisma.supplier.findUnique({
          where: { companyId_code: { companyId, code } },
        });
        if (existing) {
          await prisma.supplier.update({ where: { id: existing.id }, data: payload });
          result.updated += 1;
        } else {
          await prisma.supplier.create({ data: injectTenantData(payload) });
          result.created += 1;
        }
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message : 'Failed to import row',
        });
        result.skipped += 1;
      }
    }

    return result;
  }

  private static async importEmployees(rows: RowMap[]): Promise<ImportResult> {
    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    const companyId = requireTenantId();

    for (const row of rows) {
      const rowNum = Number(row.__row || 0);
      try {
        const employeeNo = row.employeeNo?.trim();
        const firstName = row.firstName?.trim();
        const lastName = row.lastName?.trim();
        const hireDate = row.hireDate?.trim();
        if (!employeeNo || !firstName || !lastName || !hireDate) {
          throw new Error('employeeNo, firstName, lastName, and hireDate are required');
        }

        let departmentId: string | undefined;
        if (row.department?.trim()) {
          const dept = await prisma.department.findFirst({
            where: { name: row.department.trim(), isActive: true },
          });
          if (!dept) throw new Error(`Unknown department ${row.department}`);
          departmentId = dept.id;
        }

        let branchId: string | undefined;
        if (row.branch?.trim()) {
          const branch = await prisma.branch.findFirst({
            where: { name: row.branch.trim(), isActive: true },
          });
          if (!branch) throw new Error(`Unknown branch ${row.branch}`);
          branchId = branch.id;
        }

        const genderRaw = row.gender?.trim().toUpperCase();
        const gender =
          genderRaw === 'MALE' || genderRaw === 'FEMALE' || genderRaw === 'UNSPECIFIED'
            ? genderRaw
            : undefined;

        const payload = {
          employeeNo,
          firstName,
          lastName,
          hireDate: new Date(hireDate),
          email: row.email || undefined,
          phone: row.phone || undefined,
          gender: gender as 'MALE' | 'FEMALE' | 'UNSPECIFIED' | undefined,
          position: row.position || undefined,
          departmentId: departmentId || undefined,
          branchId: branchId || undefined,
          salary: parseNumber(row.salary),
          isActive: true,
        };

        if (Number.isNaN(payload.hireDate.getTime())) {
          throw new Error('hireDate must be a valid date (YYYY-MM-DD)');
        }

        const existing = await prisma.employee.findUnique({
          where: { companyId_employeeNo: { companyId, employeeNo } },
        });
        if (existing) {
          await prisma.employee.update({
            where: { id: existing.id },
            data: {
              firstName: payload.firstName,
              lastName: payload.lastName,
              hireDate: payload.hireDate,
              email: payload.email,
              phone: payload.phone,
              gender: payload.gender,
              position: payload.position,
              departmentId: departmentId ?? null,
              branchId: branchId ?? null,
              salary: payload.salary,
              isActive: true,
            },
          });
          result.updated += 1;
        } else {
          await prisma.employee.create({
            data: injectTenantData({
              employeeNo: payload.employeeNo,
              firstName: payload.firstName,
              lastName: payload.lastName,
              hireDate: payload.hireDate,
              email: payload.email,
              phone: payload.phone,
              gender: payload.gender,
              position: payload.position,
              departmentId,
              branchId,
              salary: payload.salary,
              isActive: true,
            }),
          });
          result.created += 1;
        }
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message : 'Failed to import row',
        });
        result.skipped += 1;
      }
    }

    return result;
  }
}
