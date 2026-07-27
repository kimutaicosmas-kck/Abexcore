export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  roleId: string;
  role: { id: string; name: string; permissions?: { permission: { module: string; action: string } }[] };
  department?: { id: string; name: string };
  branch?: { id: string; name: string; code: string };
  permissions: string[];
  status: string;
  lastLoginAt?: string;
  createdAt?: string;
  loginHistory?: LoginHistoryEntry[];
}

export interface LoginHistoryEntry {
  id: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  createdAt: string;
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  suspended: number;
  recentLogins: number;
  byRole: { roleId: string; roleName: string; count: number }[];
}

export interface RoleWithPermissions {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: { permission: { id: string; module: string; action: string; description?: string } }[];
  _count?: { users: number };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  createdAt: string;
  user?: { firstName: string; lastName: string; email: string };
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  pagination?: Pagination;
}

export interface DashboardKPIs {
  salesToday: number;
  salesThisMonth: number;
  ordersInPeriod?: number;
  purchaseOrders: number;
  productionOrders: number;
  ordersAwaitingProduction: number;
  inventoryValue: number;
  rawMaterialsLow: number;
  lowStockItems: { id: string; name: string; code: string; currentStock: number; minLevel: number }[];
  finishedGoods: number;
  monthlyRevenue: number;
  monthlyProfit: number;
  monthlyExpenses: number;
  topSellingProducts: { id: string; name: string; sku: string; quantitySold: number }[];
  recentOrders: { id: string; orderNumber: string; customer: string; total: number; status: string; date: string }[];
  productionStatus: { status: string; count: number }[];
  pendingActions: { type: string; label: string; count: number; path: string }[];
  moduleSnapshots: {
    hr: { attendanceToday: number; pendingLeave: number; activeEmployees: number };
    crm: { openComplaints: number; openOpportunities: number; pipelineValue: number };
    procurement: { pendingRequisitions: number; openRfqs: number; activePurchaseOrders: number };
    finance: { overdueInvoices: number; accountsReceivable: number; monthlyProfit: number };
  };
  lastUpdated: string;
  period?: { from: string; to: string };
}

export interface DashboardCharts {
  days: number;
  salesTrend: { date: string; amount: number }[];
  productCategories: { category: string; count: number }[];
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  taxPin?: string;
  creditLimit: number;
  creditUsed: number;
  paymentTerms?: number;
  notes?: string;
  isActive: boolean;
  contacts?: CustomerContact[];
  _count?: { salesOrders: number; invoices: number; complaints: number; opportunities: number };
}

export interface CustomerContact {
  id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  isPrimary: boolean;
}

export interface Complaint {
  id: string;
  customerId: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  resolution?: string;
  resolvedAt?: string;
  createdAt: string;
  customer?: { id: string; name: string; code: string };
}

export interface Opportunity {
  id: string;
  customerId: string;
  title: string;
  value: number;
  stage: string;
  probability: number;
  expectedCloseDate?: string;
  status: string;
  notes?: string;
  createdAt: string;
  customer?: { id: string; name: string; code: string };
}

export interface Warranty {
  id: string;
  customerId: string;
  productId: string;
  serialNumber?: string;
  startDate: string;
  endDate: string;
  notes?: string;
  customer?: { id: string; name: string; code: string };
  product?: { id: string; name: string; sku: string };
}

export interface CrmStats {
  customers: { total: number; active: number; inactive: number };
  complaints: { open: number; resolved: number };
  opportunities: { open: number; pipelineValue: number; won: number };
  warranties: { total: number; expiringSoon: number };
}

export interface ProductCategoryOption {
  id: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
  usageCount?: number;
}

export interface CatalogManageItem {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  usageCount?: number;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  categoryId: string;
  category?: { id: string; name: string };
  description?: string;
  imageUrl?: string;
  manufacturingCost: number;
  sellingPrice: number;
  distributorPrice: number;
  retailPrice: number;
  minStockLevel: number;
  isActive: boolean;
  stockLevels?: StockLevel[];
}

export interface ProductStats {
  total: number;
  active: number;
  inactive: number;
  finishedGoodsQty: number;
  byCategory: { categoryId: string; category: string; count: number }[];
}

export interface InventoryStats {
  materialsCount: number;
  warehouses: number;
  lowStockCount: number;
  inventoryValue: number;
  transfersToday: number;
}

export interface ProcurementStats {
  pendingRequisitions: number;
  openRfqs: number;
  activePurchaseOrders: number;
  activePoValue: number;
  goodsReceiptsMonth: number;
  suppliers: number;
}

export interface GoodsReceipt {
  id: string;
  grnNumber: string;
  receiptDate: string;
  status: string;
  inspectionStatus: string;
  notes?: string;
  supplier?: { name: string };
  purchaseOrder?: { poNumber: string };
  items?: {
    id: string;
    quantity: number;
    unit: string;
    unitCost: number;
    batchNumber?: string;
    rawMaterialId?: string;
  }[];
  inspections?: { id: string; inspectionNo: string; status: string }[];
}

export interface InventoryTransaction {
  id: string;
  type: string;
  quantity: number;
  batchNumber?: string;
  notes?: string;
  referenceType?: string;
  createdAt: string;
  warehouse?: { name: string; code: string };
}

export interface MaterialTypeOption {
  id: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
  usageCount?: number;
}

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  typeId: string;
  materialType?: { id: string; name: string };
  unit: string;
  unitCost: number;
  minStockLevel: number;
  supplier?: { id: string; name: string };
  stockLevels?: StockLevel[];
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  email?: string;
  phone?: string;
  city?: string;
  leadTimeDays: number;
  rating: number;
  isActive: boolean;
}

export interface StockLevel {
  id: string;
  quantity: number;
  unitCost: number;
  batchNumber?: string;
  warehouse: { id: string; name: string; code: string };
  product?: Product;
  rawMaterial?: RawMaterial;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customer: Customer;
  status: string;
  orderDate: string;
  totalAmount: number;
  items: SalesOrderItem[];
  invoices?: { id: string; invoiceNumber: string; status: string; totalAmount: number }[];
  deliveries?: { id: string; deliveryNo: string; status: string }[];
  productionOrders?: { id: string; orderNumber: string; status: string }[];
}

export interface SalesOrderItem {
  id: string;
  productId: string;
  quantity: number;
  deliveredQty?: number;
  unitPrice: number;
  discount?: number;
  totalPrice: number;
  product: Product;
}

export interface ProductionOrder {
  id: string;
  orderNumber: string;
  product: Product;
  quantity: number;
  completedQty: number;
  status: string;
  priority: string;
  scheduledStart?: string;
  machine?: { id: string; name: string };
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: Supplier;
  status: string;
  orderDate: string;
  totalAmount: number;
  items: { id: string; description: string; quantity: number; unitPrice: number }[];
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  totalPrice: number;
}

export interface Payment {
  id: string;
  paymentNumber: string;
  invoiceId?: string;
  amount: number;
  method?: string;
  reference?: string;
  paymentDate: string;
  isReconciled?: boolean;
  invoice?: {
    id: string;
    invoiceNumber: string;
    customer?: { name: string };
    supplier?: { name: string };
  };
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: string;
  customer?: Customer;
  supplier?: Supplier;
  invoiceDate: string;
  dueDate?: string;
  subtotal?: number;
  taxAmount?: number;
  totalAmount: number;
  paidAmount: number;
  status: string;
  fiscalStatus?: string;
  etimsControlCode?: string;
  etimsQrCode?: string;
  notes?: string;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export interface Employee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  email?: string;
  position?: string;
  department?: { name: string };
  salary: number;
  isActive: boolean;
}

export interface Machine {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  capacity?: string;
  location?: string;
}

export interface QualityStats {
  total: number;
  pending: number;
  passed: number;
  failed: number;
  conditional: number;
  passRate: number;
}

export interface QualityInspection {
  id: string;
  inspectionNo: string;
  type: string;
  status: string;
  result?: string;
  defectsFound: number;
  correctiveAction?: string;
  inspectedAt?: string;
  createdAt: string;
  goodsReceipt?: { grnNumber: string; supplier?: { name: string } };
  productionOrder?: { orderNumber: string; product?: { name: string; sku: string } };
  product?: { name: string; sku: string };
}

export interface SalesStats {
  openOrders: number;
  pipelineValue: number;
  pendingQuotations: number;
  quotationValue: number;
  ordersThisMonth: number;
  monthlyRevenue: number;
}

export interface SalesQuotation {
  id: string;
  quotationNo: string;
  customer: Customer;
  status: string;
  validUntil?: string;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  notes?: string;
  items: SalesOrderItem[];
  salesOrders?: { id: string; orderNumber: string; status: string }[];
}

export interface DeliveryStats {
  pending: number;
  inTransit: number;
  deliveredToday: number;
  deliveredMonth: number;
  activeVehicles: number;
  motorcycles: number;
  trucks: number;
  lorries: number;
}

export type VehicleType = 'MOTORCYCLE' | 'TRUCK' | 'LORRY';

export const VEHICLE_TYPE_OPTIONS = [
  { value: '', label: 'All fleet types' },
  { value: 'MOTORCYCLE', label: 'Motorcycle' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'LORRY', label: 'Lorry' },
] as const;

export const VEHICLE_TYPE_FORM_OPTIONS = [
  { value: 'MOTORCYCLE', label: 'Motorcycle — small parcels & city runs' },
  { value: 'TRUCK', label: 'Truck — medium loads' },
  { value: 'LORRY', label: 'Lorry — bulk & long haul' },
] as const;

export function vehicleTypeLabel(type: VehicleType | string): string {
  const map: Record<string, string> = {
    MOTORCYCLE: 'Motorcycle',
    TRUCK: 'Truck',
    LORRY: 'Lorry',
  };
  return map[type] || type;
}

export interface Vehicle {
  id: string;
  registration: string;
  type: VehicleType;
  make?: string;
  model?: string;
  capacity?: string;
  isHired?: boolean;
  isActive: boolean;
}

export interface DeliveryNote {
  id: string;
  deliveryNo: string;
  status: string;
  driverId?: string | null;
  deliveryTripId?: string | null;
  stopSequence?: number | null;
  scheduledDate?: string;
  deliveredAt?: string;
  createdAt?: string;
  proofOfDelivery?: string;
  notes?: string;
  salesOrder: SalesOrder & { customer: Customer };
  vehicle?: Vehicle;
  driver?: { id: string; firstName: string; lastName: string; email: string };
  deliveryTrip?: Pick<DeliveryTrip, 'id' | 'tripNo' | 'status'>;
  items: { id: string; productId: string; quantity: number }[];
}

export interface DeliveryTrip {
  id: string;
  tripNo: string;
  status: string;
  scheduledDate?: string;
  createdAt?: string;
  notes?: string;
  vehicle?: Vehicle;
  driver?: { id: string; firstName: string; lastName: string; email: string };
  stops: DeliveryNote[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface FinanceStats {
  totalSales: number;
  totalPurchases: number;
  accountsReceivable: number;
  accountsPayable: number;
  overdueInvoices: number;
  monthlyRevenue: number;
  journalEntries: number;
}

export interface FinanceOverview {
  arAging: {
    buckets: {
      current: { amount: number; count: number };
      days1_30: { amount: number; count: number };
      days31_60: { amount: number; count: number };
      days61_90: { amount: number; count: number };
      days90Plus: { amount: number; count: number };
    };
    totalOutstanding: number;
    topOverdue: {
      id: string;
      invoiceNumber: string;
      customerName: string;
      balance: number;
      daysPastDue: number;
      bucket: string;
    }[];
  };
  cashFlow: {
    days: number;
    trend: { date: string; inflow: number; outflow: number; net: number }[];
    totalInflow: number;
    totalOutflow: number;
    net: number;
  };
}

export interface HrStats {
  totalEmployees: number;
  activeEmployees: number;
  pendingLeave: number;
  unpaidPayroll: number;
  payrollDue: number;
  attendanceToday: number;
}

export interface MaintenanceStats {
  totalMachines: number;
  operational: number;
  openRequests: number;
  completedMonth: number;
  overdueRequests: number;
}

export interface ReportsOverview {
  totalSales: number;
  totalPurchases: number;
  completedProduction: number;
  totalCustomers: number;
  totalSuppliers: number;
  purchaseOrdersMonth: number;
  purchaseValueMonth: number;
  productionOutputMonth: number;
  unpaidInvoices: number;
  qualityPassed: number;
  qualityFailed: number;
  topCustomers: { id: string; name: string; code: string; orderCount: number }[];
}

export interface SalesOfficerOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface SalesByPersonSummary {
  invoiceCount: number;
  totalSales: number;
  totalPaid: number;
  outstanding: number;
  bySalesPerson: {
    id: string;
    name: string;
    invoiceCount: number;
    totalSales: number;
    totalPaid: number;
  }[];
}

export interface SalesByPersonRow {
  id: string;
  invoiceNumber: string;
  orderNumber: string;
  orderId: string | null;
  invoiceDate: string;
  customerId: string | null;
  customerName: string;
  customerCode: string;
  salesPersonId: string | null;
  salesPersonName: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  status: string;
}

export interface SalesByPersonReport {
  summary: SalesByPersonSummary;
  rows: SalesByPersonRow[];
  pagination: Pagination;
}

export interface SalesPerformerRow {
  rank: number;
  salesPersonId: string;
  name: string;
  email: string;
  orderCount: number;
  orderValue: number;
  invoiceCount: number;
  invoiced: number;
  collected: number;
    outstanding: number;
    monthlyTarget: number;
  monthInvoiced: number;
  achievementPercent: number | null;
}

export interface SalesTeamPerformance {
  period: { from: string; to: string };
  summary: {
    salesPeople: number;
    orderCount: number;
    orderValue: number;
    invoiceCount: number;
    invoiced: number;
    collected: number;
    outstanding: number;
    avgAchievement: number | null;
  };
  performers: SalesPerformerRow[];
}

export interface MaintenanceRequest {
  id: string;
  type: string;
  description: string;
  status: string;
  scheduledDate?: string;
  completedDate?: string;
  cost: number;
  notes?: string;
  machine: Machine;
}

export interface CompanySettings {
  id: string;
  slug?: string;
  name: string;
  legalName?: string;
  registrationNo?: string;
  taxPin?: string;
  email?: string;
  phone?: string;
  address?: string;
  currency?: string;
  vatRate: number;
  logo?: string | null;
  qualityModuleEnabled?: boolean;
  branches?: { id: string; name: string; code: string; city: string }[];
  taxRates?: { id: string; name: string; rate: number; isDefault: boolean }[];
}

export interface WorkspaceSettings {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  qualityModuleEnabled: boolean;
  logo?: string | null;
  currency: string;
  vatRate: number;
  userCount: number;
  activeUsers: number;
}

export interface RegisteredCompany {
  id: string;
  slug: string;
  name: string;
  logo?: string | null;
  email?: string | null;
  isActive: boolean;
  userCount: number;
  createdAt: string;
}

export interface TenantTeamMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  lastLoginAt?: string | null;
  role: { name: string };
}

export interface LeaveRequest {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  reason?: string;
  status: string;
  employee: { firstName: string; lastName: string; employeeNo: string };
}

export interface PayrollRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  netPay: number;
  isPaid: boolean;
  employee: { firstName: string; lastName: string; employeeNo: string };
}

export interface MySalesSummary {
  totalSales: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  invoiceCount: number;
  monthlyTarget: number;
  monthInvoiced?: number;
  achievementPercent: number | null;
  ordersByStatus: { status: string; count: number; value: number }[];
}

export interface MySalesOrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  customerCode: string;
  orderDate: string;
  status: string;
  totalAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  invoiceCount?: number;
  isOverInvoiced?: boolean;
}

export interface MySalesDashboard {
  salesPerson: { id: string; name: string; email: string };
  period: { from: string; to: string };
  summary: MySalesSummary;
  orders: MySalesOrderRow[];
  pagination: Pagination;
}

export interface SalesTargetRow {
  salesPersonId: string;
  name: string;
  email: string;
  year: number;
  month: number;
  targetAmount: number;
}
