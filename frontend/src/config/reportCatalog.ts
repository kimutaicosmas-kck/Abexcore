import {
  BarChart3,
  Users,
  Factory,
  Truck,
  FileSpreadsheet,
  ClipboardCheck,
  Receipt,
  Package,
  type LucideIcon,
} from 'lucide-react';

export type ReportCategory = 'sales' | 'inventory' | 'finance' | 'customers' | 'operations' | 'quality';

export type ReportFilterField =
  | 'startDate'
  | 'endDate'
  | 'salesPersonId'
  | 'status'
  | 'search'
  | 'needsRestockOnly'
  | 'warehouseId'
  | 'itemType'
  | 'lowStockOnly'
  | 'qualityStatus'
  | 'vatScope';

export type ReportExportFormat = 'pdf' | 'excel';

export type ReportDefinition = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  category: ReportCategory;
  filters: ReportFilterField[];
  formats: ReportExportFormat[];
  exportPaths?: Partial<Record<ReportExportFormat, string>>;
  exportFilename?: Partial<Record<ReportExportFormat, string>>;
  /** Opens an interactive panel instead of immediate download */
  panelSection?: 0 | 1 | 2 | 3;
  /** Opens detail modal with live preview */
  detailKey?: string;
  vatScope?: 'VAT' | 'NON_VAT' | 'ALL';
};

export const REPORT_CATEGORIES: { id: ReportCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All reports' },
  { id: 'sales', label: 'Sales' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'finance', label: 'Finance' },
  { id: 'customers', label: 'Customers' },
  { id: 'operations', label: 'Operations' },
  { id: 'quality', label: 'Quality' },
];

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: 'business-intelligence',
    name: 'Business Intelligence',
    description: 'Executive KPIs, AR aging, and sales trend',
    icon: BarChart3,
    color: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    category: 'finance',
    filters: [],
    formats: [],
    panelSection: 0,
  },
  {
    id: 'sales',
    name: 'Sales Report',
    description: 'Export sales invoices with salesperson and payment status',
    icon: BarChart3,
    color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    category: 'sales',
    filters: ['startDate', 'endDate', 'salesPersonId', 'status'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/sales/excel',
      pdf: '/finance/reports/sales/pdf',
    },
    exportFilename: { excel: 'sales-report.xlsx', pdf: 'sales-report.pdf' },
  },
  {
    id: 'sales-by-person',
    name: 'Sales by Person',
    description: 'Filter, paginate, and export by salesperson',
    icon: Users,
    color: 'bg-sky-50 text-sky-600 border-sky-100',
    category: 'sales',
    filters: ['startDate', 'endDate', 'salesPersonId'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/sales-by-person/excel',
      pdf: '/finance/reports/sales-by-person/pdf',
    },
    exportFilename: { excel: 'sales-by-salesperson.xlsx', pdf: 'sales-by-salesperson.pdf' },
    panelSection: 1,
  },
  {
    id: 'products-sold',
    name: 'Products Sold Statement',
    description: 'Qty sold by product with stock for restocking',
    icon: Package,
    color: 'bg-violet-50 text-violet-700 border-violet-100',
    category: 'sales',
    filters: ['startDate', 'endDate', 'search', 'needsRestockOnly'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/products-sold/excel',
      pdf: '/finance/reports/products-sold/pdf',
    },
    exportFilename: { excel: 'products-sold-statement.xlsx', pdf: 'products-sold-statement.pdf' },
    panelSection: 2,
  },
  {
    id: 'inventory',
    name: 'Inventory Report',
    description: 'Export stock levels and valuation by warehouse',
    icon: Factory,
    color: 'bg-primary-50 text-primary-600 border-primary-100',
    category: 'inventory',
    filters: ['warehouseId', 'itemType', 'lowStockOnly'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/inventory/excel',
      pdf: '/finance/reports/inventory/pdf',
    },
    exportFilename: { excel: 'inventory-report.xlsx', pdf: 'inventory-report.pdf' },
  },
  {
    id: 'purchase',
    name: 'Purchase Report',
    description: 'Purchases by supplier and material',
    icon: Truck,
    color: 'bg-red-50 text-red-600 border-red-100',
    category: 'operations',
    filters: ['startDate', 'endDate'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/purchase/excel',
      pdf: '/finance/reports/purchase/pdf',
    },
    exportFilename: { excel: 'purchase-report.xlsx', pdf: 'purchase-report.pdf' },
    detailKey: 'purchase',
  },
  {
    id: 'production',
    name: 'Production Report',
    description: 'Output and efficiency summary',
    icon: Factory,
    color: 'bg-orange-50 text-orange-600 border-orange-100',
    category: 'operations',
    filters: ['startDate', 'endDate'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/production/excel',
      pdf: '/finance/reports/production/pdf',
    },
    exportFilename: { excel: 'production-report.xlsx', pdf: 'production-report.pdf' },
    detailKey: 'production',
  },
  {
    id: 'financial-statements',
    name: 'Financial Statements',
    description: 'P&L, Balance Sheet, Cash Flow',
    icon: FileSpreadsheet,
    color: 'bg-primary-50 text-primary-600 border-primary-100',
    category: 'finance',
    filters: ['startDate', 'endDate'],
    formats: ['excel'],
    panelSection: 3,
  },
  {
    id: 'customer',
    name: 'Customer Report',
    description: 'Customer activity and credit',
    icon: Users,
    color: 'bg-primary-50 text-primary-600 border-primary-100',
    category: 'customers',
    filters: ['startDate', 'endDate'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/customer/excel',
      pdf: '/finance/reports/customer/pdf',
    },
    exportFilename: { excel: 'customer-report.xlsx', pdf: 'customer-report.pdf' },
    detailKey: 'customer',
  },
  {
    id: 'vat-customers',
    name: 'VAT Customers',
    description: 'VAT-only report — view and export PDF/Excel',
    icon: Receipt,
    color: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    category: 'customers',
    filters: [],
    formats: ['pdf', 'excel'],
    exportPaths: {
      pdf: '/customers/reports/vat-status/pdf',
      excel: '/customers/reports/vat-status/excel',
    },
    exportFilename: { pdf: 'vat-customers.pdf', excel: 'vat-customers.xlsx' },
    detailKey: 'vat-customers',
    vatScope: 'VAT',
  },
  {
    id: 'non-vat-customers',
    name: 'Non-VAT Customers',
    description: 'Non-VAT-only report — view and export PDF/Excel',
    icon: Receipt,
    color: 'bg-slate-50 text-slate-700 border-slate-200',
    category: 'customers',
    filters: [],
    formats: ['pdf', 'excel'],
    exportPaths: {
      pdf: '/customers/reports/vat-status/pdf',
      excel: '/customers/reports/vat-status/excel',
    },
    exportFilename: { pdf: 'non-vat-customers.pdf', excel: 'non-vat-customers.xlsx' },
    detailKey: 'non-vat-customers',
    vatScope: 'NON_VAT',
  },
  {
    id: 'vat-combined',
    name: 'VAT & Non-VAT Combined',
    description: 'Both customer types in one PDF/Excel export',
    icon: FileSpreadsheet,
    color: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    category: 'customers',
    filters: [],
    formats: ['pdf', 'excel'],
    exportPaths: {
      pdf: '/customers/reports/vat-status/pdf',
      excel: '/customers/reports/vat-status/excel',
    },
    exportFilename: { pdf: 'vat-and-non-vat-customers.pdf', excel: 'vat-and-non-vat-customers.xlsx' },
    detailKey: 'vat-combined',
    vatScope: 'ALL',
  },
  {
    id: 'quality',
    name: 'Quality Report',
    description: 'Inspection results and defects',
    icon: ClipboardCheck,
    color: 'bg-teal-50 text-teal-600 border-teal-100',
    category: 'quality',
    filters: ['startDate', 'endDate', 'qualityStatus'],
    formats: ['excel', 'pdf'],
    exportPaths: {
      excel: '/finance/reports/quality/excel',
      pdf: '/finance/reports/quality/pdf',
    },
    exportFilename: { excel: 'quality-report.xlsx', pdf: 'quality-report.pdf' },
    detailKey: 'quality',
  },
];

export function getReportById(id: string) {
  return REPORT_CATALOG.find((r) => r.id === id);
}
