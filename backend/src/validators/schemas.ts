import { z } from 'zod';

export const loginSchema = z.object({
  companySlug: z.string().min(2, 'Company code is required').optional(),
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().length(6).optional(),
});

export const registerCompanySchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  companySlug: z.string().min(2).max(48).optional(),
  adminEmail: z.string().email('Invalid admin email'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
  adminFirstName: z.string().min(1, 'First name is required'),
  adminLastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
  country: z.string().optional(),
  currency: z.string().optional(),
  /** manufacturing | trading | custom */
  modulePreset: z.enum(['manufacturing', 'trading', 'custom']).optional(),
  /** JSON array or comma-separated module keys when preset is custom (or override). */
  enabledModules: z.union([z.array(z.string()), z.string()]).optional(),
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
  /** Module keys; when provided, stored as per-user access (can differ from role defaults). */
  modules: z.array(z.string().min(1)).optional(),
  /** When true, also create a linked HR employee profile for this login. */
  createEmployeeProfile: z.boolean().optional(),
  /** Link this new user to an existing unlinked employee instead of creating one. */
  employeeId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
});

export const updateUserSchema = createUserSchema.partial().omit({ password: true }).extend({
  password: z.string().min(8).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  /** Link / unlink HR employee from Users screen (null clears the link). */
  employeeId: z.preprocess(
    (v) => (v === '' ? null : v === undefined ? undefined : v),
    z.string().uuid().nullable().optional()
  ),
});

const customerFieldsSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  taxPin: z.string().optional(),
  /** Mandatory: VAT-registered vs Non-VAT (company still invoices Non-VAT at 0% tax). */
  vatStatus: z.enum(['VAT', 'NON_VAT']),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  /** Empty / null = unassigned customer (not owned by a sales officer). */
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().uuid().nullable().optional()
  ),
});

function refineCustomerVat(
  data: { vatStatus?: 'VAT' | 'NON_VAT'; taxPin?: string },
  ctx: z.RefinementCtx
) {
  if (data.vatStatus === 'VAT' && !data.taxPin?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Tax PIN is required for VAT customers',
      path: ['taxPin'],
    });
  }
}

export const createCustomerSchema = customerFieldsSchema.superRefine(refineCustomerVat);

export const updateCustomerSchema = customerFieldsSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .superRefine(refineCustomerVat);

export const createContactSchema = z.object({
  name: z.string().min(1),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

export const createProductSchema = z.object({
  sku: z.string().min(1),
  barcode: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),
  name: z.string().min(1),
  categoryId: z.string().uuid('Select a valid category'),
  description: z.string().optional(),
  weight: z.coerce.number().optional(),
  length: z.coerce.number().optional(),
  width: z.coerce.number().optional(),
  height: z.coerce.number().optional(),
  manufacturingCost: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  distributorPrice: z.coerce.number().min(0).optional(),
  retailPrice: z.coerce.number().min(0).optional(),
  minStockLevel: z.coerce.number().int().min(0).optional(),
  initialQuantity: z.coerce.number().int().min(0).optional(),
  warehouseId: z.string().uuid().optional(),
});

export const updateProductSchema = createProductSchema
  .partial()
  .extend({
    isActive: z.boolean().optional(),
  });

export const createRawMaterialSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  typeId: z.string().uuid('Select a valid material type'),
  description: z.string().optional(),
  unit: z.string().optional(),
  unitCost: z.number().min(0).optional(),
  supplierId: z.string().uuid().optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
  shelfLifeDays: z.number().int().optional(),
});

export const createMaterialTypeSchema = z.object({
  name: z.string().trim().min(1, 'Material type name is required').max(100),
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
  cursor: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  sortBy: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  sortOrder: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['asc', 'desc']).default('desc')
  ),
});

export const userListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional()
  ),
  roleId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
});

export const customerListQuerySchema = paginationSchema.extend({
  type: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']).optional()
  ),
  vatStatus: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['VAT', 'NON_VAT']).optional()
  ),
  isActive: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
  /** UUID of sales officer, or "none" for unassigned customers. */
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.union([z.string().uuid(), z.literal('none')]).optional()
  ),
  /** When filtering by a sales person, also include customers with no owner (for assignment). */
  includeUnassigned: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional()
  ),
});

export const customerStatementQuerySchema = z.object({
  from: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().optional()),
  to: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().optional()),
  /** FULL = ledger with payments; OUTSTANDING = open invoices / amount due */
  mode: z.preprocess(
    (v) => (v === '' || v === undefined ? 'FULL' : v),
    z.enum(['FULL', 'OUTSTANDING']).default('FULL')
  ),
});

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(1, 'Category name is required').max(100),
});

export const updateCatalogItemSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => data.name !== undefined || data.isActive !== undefined, {
    message: 'Provide a name or active status to update',
  });

export const reorderCatalogSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one item is required'),
});

export const deleteCompanySchema = z.object({
  confirmSlug: z.string().min(1, 'Company code confirmation is required'),
});

export const resetDemoWorkspaceSchema = z.object({
  confirmSlug: z.string().min(1, 'Company code confirmation is required'),
});

export const productListQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(20),
  category: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  isActive: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
});

export const materialListQuerySchema = paginationSchema.extend({
  type: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
});

export const procurementListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
});

const optionalDateString = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().optional()
);

export const updateSalesOrderItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        discount: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .min(1),
  adjustmentReason: z.string().min(1, 'Reason for adjustment is required'),
  notes: z.string().optional(),
});

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  quotationId: z.string().uuid().optional(),
  /** Omit / empty = unassigned (admins). Sales Officers are always assigned to themselves. */
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  /** Business date of the sale (`YYYY-MM-DD`). May be in the past (backdated orders). */
  orderDate: optionalDateString,
  requiredDate: optionalDateString,
  /** Customer's own PO / LPO number (appears on the sales invoice). */
  customerPoNumber: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(100).optional()
  ),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1),
    unitPrice: z.coerce.number().min(0),
    discount: z.coerce.number().min(0).max(100).optional(),
  })).min(1),
});

export const upsertSalesTargetSchema = z.object({
  salesPersonId: z.string().uuid(),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  targetAmount: z.coerce.number().min(0),
});

export const mySalesQuerySchema = paginationSchema.extend({
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  from: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  to: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
});

export const salesPerformanceQuerySchema = z.object({
  from: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  to: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
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

export const completeProductionSchema = z.object({
  completedQty: z.coerce.number().int().min(1),
  rejectedQty: z.coerce.number().int().min(0).optional(),
  /** Ignored unless it matches finished goods — output always posts to FG warehouse. */
  warehouseId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
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
  qualityModuleEnabled: z.boolean().optional(),
  coopPaybillNumber: z.string().max(40).optional().nullable(),
  mpesaAccountNumber: z.string().max(40).optional().nullable(),
  welcomeMessage: z.string().max(280).optional().nullable(),
  storefrontEnabled: z.boolean().optional(),
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
  /** Customer's PO / LPO number — included on the sales invoice document. */
  customerPoNumber: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(100).optional()
  ),
  notes: z.string().optional(),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number().min(0.001),
    unitPrice: z.number().min(0),
    taxRate: z.number().min(0).optional(),
  })).min(1),
});

export const createPaymentSchema = z
  .object({
    invoiceId: z.string().uuid(),
    amount: z.number().min(0.01),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
    reference: z.string().optional(),
    notes: z.string().optional(),
    mpesaPhone: z.string().optional(),
  })
  .refine((data) => data.method !== 'MPESA' || (data.reference && data.reference.length >= 6), {
    message: 'M-Pesa payments require a transaction reference code',
    path: ['reference'],
  });

export const createExpenseSchema = z.object({
  expenseDate: z.string().optional(),
  categoryAccountId: z.string().uuid(),
  payeeName: z.string().min(1).max(200),
  supplierId: z.string().uuid().optional().nullable(),
  description: z.string().min(2).max(2000),
  amount: z.number().positive(),
  vatAmount: z.number().min(0).optional(),
  paymentMethod: z
    .enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'CHEQUE', 'CARD', 'PETTY_CASH'])
    .optional(),
  reference: z.string().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  receiptUrl: z.string().max(500).optional().nullable(),
  submit: z.boolean().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const expenseDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(1000).optional(),
});

export const createEmployeeSchema = z.object({
  employeeNo: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
  departmentId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  position: z.string().optional(),
  hireDate: z.string(),
  salary: z.number().min(0).optional(),
  /** System login for this employee (one user ↔ one employee). Empty/null = unlinked. */
  userId: z.preprocess(
    (v) => (v === '' ? null : v === undefined ? undefined : v),
    z.string().uuid().nullable().optional()
  ),
});

export const updateLeaveBalanceSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.string().min(1).max(50),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  entitledDays: z.coerce.number().min(0).max(366),
  usedDays: z.coerce.number().min(0).max(366).optional(),
  notes: z.string().max(2000).optional(),
});

export const linkEmployeeUserSchema = z.object({
  userId: z.preprocess(
    (v) => (v === '' ? null : v),
    z.string().uuid().nullable()
  ),
});

const deliveryItemInputSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const deliveryOrderInputSchema = z.object({
  salesOrderId: z.string().uuid(),
  items: z.array(deliveryItemInputSchema).min(1),
});

export const createDeliverySchema = z
  .object({
    salesOrderId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    scheduledDate: z.string().optional(),
    notes: z.string().optional(),
    /** Optional carrier waybill / consignment no. (hired truck or other transport). */
    waybillNo: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().max(100).optional()
    ),
    items: z.array(deliveryItemInputSchema).optional(),
    orders: z.array(deliveryOrderInputSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.orders?.length) return true;
      return !!(data.salesOrderId && data.items?.length);
    },
    { message: 'Provide orders[] or salesOrderId with items[]' }
  );

export const updateDeliveryTripStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']),
  proofOfDelivery: z.string().optional(),
  driverId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  vehicleId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  scheduledDate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().optional()
  ),
  actualItems: z
    .array(
      z.object({
        deliveryNoteId: z.string().uuid(),
        items: z.array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.coerce.number().int().min(0),
          })
        ),
      })
    )
    .optional(),
});

const optionalUuid = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().uuid().optional()
);

export const createQualityInspectionSchema = z
  .object({
    type: z.string().min(1),
    goodsReceiptId: optionalUuid,
    productionOrderId: optionalUuid,
    productId: optionalUuid,
    status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
    result: z.string().optional(),
    defectsFound: z.number().int().min(0).optional(),
    correctiveAction: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'incoming' && !data.goodsReceiptId && !data.productId) {
      return;
    }
    if ((data.type === 'production' || data.type === 'finished') && !data.productionOrderId && !data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a product for surplus-stock inspections, or link a production order',
        path: ['productId'],
      });
    }
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
  purchaseOrderId: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.string().uuid().optional()
  ),
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  notes: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : v),
    z.string().optional()
  ),
  items: z.array(z.object({
    rawMaterialId: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.string().uuid().optional()
    ),
    batchNumber: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.string().optional()
    ),
    quantity: z.number().min(0.001),
    unit: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.string().optional()
    ),
    unitCost: z.number().min(0),
    expiryDate: z.preprocess(
      (v) => (v === '' || v === undefined || v === null ? undefined : v),
      z.string().optional()
    ),
  })).min(1),
});

export const createComplaintSchema = z.object({
  customerId: z.string().uuid(),
  subject: z.string().min(1),
  description: z.string().min(1),
  priority: z.string().optional(),
});

export const resolveComplaintSchema = z.object({
  resolution: z.string().min(1),
  status: z.enum(['APPROVED', 'REJECTED']).optional(),
});

export const crmListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  priority: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  customerId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  stage: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
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

export const updateOpportunitySchema = createOpportunitySchema.partial().extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
});

export const createWarrantySchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  serialNumber: z.string().optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  notes: z.string().optional(),
});

export const cycleCountSchema = z.object({
  warehouseId: z.string().uuid(),
  counts: z.array(
    z.object({
      productId: z.string().uuid().optional(),
      rawMaterialId: z.string().uuid().optional(),
      physicalQty: z.number().min(0),
      batchNumber: z.string().optional(),
    })
  ).min(1),
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

export const qualityListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional()
  ),
  type: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  productionOrderId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  productId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
});

export const updateQualityInspectionSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
  result: z.string().optional(),
  defectsFound: z.coerce.number().int().min(0).optional(),
  correctiveAction: z.string().optional(),
});

export const salesListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  /** Local calendar day `YYYY-MM-DD` — filter by requiredDate (fallback orderDate). */
  date: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  ),
});

export const productionListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
});

export const deliveryListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']).optional()
  ),
  /** Local calendar day `YYYY-MM-DD` — filter by scheduledDate (fallback createdAt). */
  date: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  ),
});

export const salesByPersonQuerySchema = paginationSchema.extend({
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  startDate: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  endDate: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
});

export const productsSoldQuerySchema = paginationSchema.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  startDate: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  endDate: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  search: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().max(100).optional()
  ),
  productId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  needsRestockOnly: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional()
  ),
});

export const salesReportQuerySchema = z.object({
  startDate: optionalDateString,
  endDate: optionalDateString,
  salesPersonId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['PAID', 'UNPAID', 'PARTIAL', 'OVERDUE', 'DRAFT', 'CANCELLED']).optional()
  ),
});

export const inventoryReportQuerySchema = z.object({
  warehouseId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  itemType: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['ALL', 'PRODUCT', 'RAW_MATERIAL']).optional()
  ),
  lowStockOnly: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional()
  ),
});

export const summaryReportQuerySchema = z.object({
  startDate: optionalDateString,
  endDate: optionalDateString,
  qualityStatus: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['ALL', 'PASSED', 'FAILED']).optional()
  ),
});

export const updateDeliveryStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']),
  proofOfDelivery: z.string().optional(),
  driverId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  vehicleId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  scheduledDate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().optional()
  ),
  actualItems: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().min(0),
      })
    )
    .optional(),
});

export const bulkAssignDeliveriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        kind: z.enum(['note', 'trip']),
      })
    )
    .min(1)
    .max(50),
  driverId: z.string().uuid(),
  vehicleId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  scheduledDate: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().optional()
  ),
});

export const bulkDeliverDeliveriesSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        kind: z.enum(['note', 'trip']),
      })
    )
    .min(1)
    .max(50),
  proofOfDelivery: z.string().max(500).optional(),
});

export const vehicleListQuerySchema = paginationSchema.extend({
  type: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['MOTORCYCLE', 'TRUCK', 'LORRY']).optional()
  ),
});

export const createVehicleSchema = z.object({
  registration: z.string().min(1),
  type: z.enum(['MOTORCYCLE', 'TRUCK', 'LORRY']).default('TRUCK'),
  make: z.string().optional(),
  model: z.string().optional(),
  capacity: z.string().optional(),
  isHired: z.boolean().optional(),
});

export const financeListQuerySchema = paginationSchema.extend({
  type: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE']).optional()
  ),
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERDUE', 'REFUNDED']).optional()
  ),
});

/** Payments list: filter by when money was received and/or vs invoice date. */
export const paymentListQuerySchema = paginationSchema.extend({
  period: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z
      .enum([
        'this_week',
        'last_week',
        'this_month',
        'last_month',
        /** Payment fell in the same week the invoice was issued */
        'same_week_as_invoice',
        /** Payment fell in the same month the invoice was issued */
        'same_month_as_invoice',
        /** Invoice issued this week and paid this week */
        'this_week_taken_and_paid',
        /** Invoice issued this month and paid this month */
        'this_month_taken_and_paid',
      ])
      .optional()
  ),
  from: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().optional()),
  to: z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().optional()),
  method: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z
      .enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'COOP_PAYBILL', 'CARD', 'CREDIT'])
      .optional()
  ),
});

export const hrListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().optional()
  ),
  isActive: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined),
    z.boolean().optional()
  ),
});

export const salaryAdvanceListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'WRITTEN_OFF']).optional()
  ),
  employeeId: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
});

export const createSalaryAdvanceSchema = z
  .object({
    employeeId: z.string().uuid(),
    amount: z.coerce.number().positive(),
    monthlyDeduction: z.coerce.number().positive(),
    deductionStartDate: z.string().min(1),
    reason: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
    /**
     * ISSUE = new cash advance (optional GL disburse).
     * RECORD_EXISTING = already paid out outside the system (no cash GL).
     */
    entryMode: z.enum(['ISSUE', 'RECORD_EXISTING']).optional().default('ISSUE'),
    /** Approve immediately (skip PENDING). Implied when disburseNow / RECORD_EXISTING. */
    approveNow: z.boolean().optional(),
    /** Disburse cash and post GL immediately (ISSUE only). */
    disburseNow: z.boolean().optional(),
    /** Date the money was given (required for RECORD_EXISTING). */
    disbursedAt: z.string().optional(),
    /** Still owed; defaults to full amount. Must be <= amount. */
    remainingBalance: z.coerce.number().min(0).optional(),
    /** Already recovered before recording; alternative to remainingBalance. */
    alreadyRepaid: z.coerce.number().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.entryMode === 'RECORD_EXISTING' && !data.disbursedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date given is required when recording an existing advance',
        path: ['disbursedAt'],
      });
    }
    if (data.remainingBalance !== undefined && data.remainingBalance > data.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Remaining balance cannot exceed the original amount',
        path: ['remainingBalance'],
      });
    }
    if (data.alreadyRepaid !== undefined && data.alreadyRepaid > data.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Already repaid cannot exceed the original amount',
        path: ['alreadyRepaid'],
      });
    }
  });

export const updateSalaryAdvanceSchema = z.object({
  monthlyDeduction: z.coerce.number().positive().optional(),
  reason: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  deductionStartDate: z.string().optional(),
});

export const approveSalaryAdvanceSchema = z.object({
  disburseNow: z.boolean().optional().default(true),
});

export const rejectSalaryAdvanceSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const repaySalaryAdvanceSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MPESA', 'MANUAL']).optional(),
  notes: z.string().max(2000).optional(),
  paidAt: z.string().optional(),
});

export const cancelSalaryAdvanceSchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const createPayrollSchema = z.object({
  employeeId: z.string().uuid(),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  basicSalary: z.coerce.number().min(0),
  allowances: z.coerce.number().min(0).optional(),
});

export const maintenanceListQuerySchema = paginationSchema.extend({
  status: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']).optional()
  ),
});

export const createMachineSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  capacity: z.string().optional(),
  location: z.string().optional(),
  status: z.string().optional(),
});

export const createJournalEntrySchema = z.object({
  date: z.string().optional(),
  description: z.string().min(1),
  reference: z.string().optional(),
  /** Optional link to a sales/purchase invoice (stored as sourceType=INVOICE). */
  invoiceId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  ),
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    description: z.string().optional(),
  })).min(2),
}).superRefine((data, ctx) => {
  const totalDebit = data.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = data.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.009) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`,
      path: ['lines'],
    });
  }
});

export const createLeaveSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.string().min(1).max(50),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

export const createMyLeaveSchema = z.object({
  type: z.string().min(1).max(50),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().max(2000).optional(),
});

export const leaveBalancesQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  employeeId: z.string().uuid().optional(),
});

export const approveLeaveSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'CANCELLED']),
  decisionNote: z.string().max(2000).optional(),
});

export const searchQuerySchema = z.object({
  // Short queries return empty results in the route handler (min 2 chars searched).
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().max(100).optional()),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const grnIdParamSchema = z.object({
  grnId: z.string().uuid(),
});

export const orderIdParamSchema = z.object({
  orderId: z.string().uuid(),
});
