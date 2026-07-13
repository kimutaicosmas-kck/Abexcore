export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatar?: string;
  roleId: string;
  role: { id: string; name: string };
  department?: { id: string; name: string };
  branch?: { id: string; name: string; code: string };
  permissions: string[];
  status: string;
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
  topSellingFilters: { id: string; name: string; sku: string; quantitySold: number }[];
  recentOrders: { id: string; orderNumber: string; customer: string; total: number; status: string; date: string }[];
  productionStatus: { status: string; count: number }[];
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: string;
  email?: string;
  phone?: string;
  city?: string;
  creditLimit: number;
  creditUsed: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  sku: string;
  barcode?: string;
  name: string;
  category: string;
  manufacturingCost: number;
  sellingPrice: number;
  distributorPrice: number;
  retailPrice: number;
  minStockLevel: number;
  isActive: boolean;
  bom?: BillOfMaterial;
}

export interface BillOfMaterial {
  id: string;
  version: string;
  items: BOMItem[];
}

export interface BOMItem {
  id: string;
  rawMaterialId: string;
  quantity: number;
  unit: string;
  rawMaterial: RawMaterial;
}

export interface RawMaterial {
  id: string;
  code: string;
  name: string;
  type: string;
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
}

export interface SalesOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
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

export interface Invoice {
  id: string;
  invoiceNumber: string;
  type: string;
  customer?: Customer;
  supplier?: Supplier;
  invoiceDate: string;
  dueDate?: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
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
