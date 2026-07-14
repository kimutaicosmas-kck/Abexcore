import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  roleId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export const createCustomerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  taxPin: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.string().optional(),
  name: z.string().min(1),
  category: z.enum([
    'OIL_FILTER', 'FUEL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
    'HYDRAULIC_FILTER', 'WATER_FILTER', 'INDUSTRIAL_FILTER', 'CUSTOM_FILTER',
  ]),
  description: z.string().optional(),
  weight: z.number().optional(),
  length: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  manufacturingCost: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  distributorPrice: z.number().min(0).optional(),
  retailPrice: z.number().min(0).optional(),
  minStockLevel: z.number().int().min(0).optional(),
});

export const createRawMaterialSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'STEEL', 'FILTER_PAPER', 'RUBBER', 'MESH', 'ADHESIVE',
    'PLASTIC', 'END_CAP', 'THREAD_PLATE', 'PACKAGING_BOX', 'LABEL', 'OTHER',
  ]),
  description: z.string().optional(),
  unit: z.string().optional(),
  unitCost: z.number().min(0).optional(),
  supplierId: z.string().uuid().optional(),
  minStockLevel: z.number().min(0).optional(),
  reorderQty: z.number().min(0).optional(),
  shelfLifeDays: z.number().int().optional(),
});

export const createSupplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  taxPin: z.string().optional(),
  paymentTerms: z.number().int().optional(),
  leadTimeDays: z.number().int().optional(),
  notes: z.string().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  sortBy: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  sortOrder: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['asc', 'desc']).default('desc')
  ),
});

const optionalDateString = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().optional()
);

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  quotationId: z.string().uuid().optional(),
  requiredDate: optionalDateString,
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().min(0),
    discount: z.coerce.number().min(0).max(100).optional(),
  })).min(1),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  expectedDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    rawMaterialId: z.string().uuid().optional(),
    description: z.string(),
    quantity: z.number().min(0.001),
    unit: z.string().optional(),
    unitPrice: z.number().min(0),
  })).min(1),
});

export const createProductionOrderSchema = z.object({
  productId: z.string().uuid(),
  salesOrderId: z.string().uuid().optional(),
  machineId: z.string().uuid().optional(),
  quantity: z.number().int().min(1),
  priority: z.string().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const companySettingsSchema = z.object({
  name: z.string().min(1),
  legalName: z.string().optional(),
  registrationNo: z.string().optional(),
  taxPin: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  website: z.string().optional(),
  currency: z.string().optional(),
  vatRate: z.number().min(0).max(100).optional(),
});

export const createQuotationSchema = z.object({
  customerId: z.string().uuid(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0),
    discount: z.number().min(0).max(100).optional(),
  })).min(1),
});

export const createInvoiceSchema = z.object({
  type: z.enum(['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('SALES'),
  customerId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  salesOrderId: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number().min(0.001),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).optional(),
  })).min(1),
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().min(0.01),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const createEmployeeSchema = z.object({
  employeeNo: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  position: z.string().optional(),
  hireDate: z.string(),
  salary: z.number().min(0).optional(),
});

export const createDeliverySchema = z.object({
  salesOrderId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
  })).min(1),
});

export const createQualityInspectionSchema = z.object({
  type: z.string().min(1),
  goodsReceiptId: z.string().uuid().optional(),
  productionOrderId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
  result: z.string().optional(),
  defectsFound: z.number().int().min(0).optional(),
  correctiveAction: z.string().optional(),
});

export const createMaintenanceSchema = z.object({
  machineId: z.string().uuid(),
  type: z.string().min(1),
  description: z.string().min(1),
  scheduledDate: z.string().optional(),
  cost: z.number().min(0).optional(),
  notes: z.string().optional(),
});

export const createRequisitionSchema = z.object({
  department: z.string().optional(),
  priority: z.string().optional(),
  requiredDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    rawMaterialId: z.string().uuid().optional(),
    description: z.string(),
    quantity: z.number().min(0.001),
    unit: z.string().optional(),
    estimatedCost: z.number().min(0).optional(),
  })).min(1),
});

export const createGoodsReceiptSchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    rawMaterialId: z.string().uuid().optional(),
    batchNumber: z.string().optional(),
    quantity: z.number().min(0.001),
    unit: z.string().optional(),
    unitCost: z.number().min(0),
    expiryDate: z.string().optional(),
  })).min(1),
});

export const createComplaintSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: z.string().optional(),
});

export const createOpportunitySchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(1),
  value: z.number().min(0),
  stage: z.string().optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export const stockAdjustSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  rawMaterialId: z.string().uuid().optional(),
  quantity: z.number().min(0.001),
  type: z.enum(['add', 'remove']),
  notes: z.string().optional(),
  batchNumber: z.string().optional(),
});

export const stockTransferSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  rawMaterialId: z.string().uuid().optional(),
  quantity: z.coerce.number().min(0.001),
  notes: z.string().optional(),
  batchNumber: z.string().optional(),
}).refine((d) => d.rawMaterialId || d.productId, {
  message: 'Select either a raw material or a product',
  path: ['rawMaterialId'],
}).refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
  message: 'Source and destination warehouses must differ',
  path: ['toWarehouseId'],
});

export const updateSupplierQuotationSchema = z.object({
  totalAmount: z.coerce.number().min(0),
  notes: z.string().optional(),
  validUntil: optionalDateString,
});
