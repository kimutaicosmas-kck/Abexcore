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
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export const createSalesOrderSchema = z.object({
  customerId: z.string().uuid(),
  quotationId: z.string().uuid().optional(),
  requiredDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().min(0),
    discount: z.number().min(0).max(100).optional(),
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
