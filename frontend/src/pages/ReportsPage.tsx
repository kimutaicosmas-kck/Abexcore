import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import {
  PageHeader,
  Button,
  StatCard,
  EmptyState,
  QuickActionCard,
  formatCurrency,
  PageToolbar,
} from '../components/ui';
import { BarChart3, Users, Factory, Truck, Download, FileSpreadsheet, ClipboardCheck } from 'lucide-react';
import { downloadFile } from '../utils/download';
import { FinancialStatementsPanel } from '../components/reports/FinancialStatementsPanel';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { ReportsOverview } from '../types';

export function ReportsPage() {
  const { hasPermission } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const sections = ['Overview', 'Financial Statements'];

  const canExport = hasPermission('reports:read');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => reportsApi.summary().then((r) => r.data.data as ReportsOverview),
  });

  const handleExport = async (type: 'sales' | 'inventory', filename: string) => {
    setDownloading(type);
    try {
      await downloadFile(`/finance/reports/${type}/excel`, filename);
    } finally {
      setDownloading(null);
    }
  };

  const reportTypes = [
    {
      name: 'Sales Report',
      description: 'Sales by period, customer, product',
      icon: BarChart3,
      color: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      exportType: 'sales' as const,
      filename: 'sales-report.xlsx',
    },
    {
      name: 'Inventory Report',
      description: 'Stock levels, movements, valuation',
      icon: Factory,
      color: 'bg-violet-50 text-violet-600 border-violet-100',
      exportType: 'inventory' as const,
      filename: 'inventory-report.xlsx',
    },
    {
      name: 'Purchase Report',
      description: 'Purchases by supplier, material',
      icon: Truck,
      color: 'bg-red-50 text-red-600 border-red-100',
      detailKey: 'purchase',
    },
    {
      name: 'Production Report',
      description: 'Output, consumption, efficiency',
      icon: Factory,
      color: 'bg-orange-50 text-orange-600 border-orange-100',
      detailKey: 'production',
    },
    {
      name: 'Financial Statements',
      description: 'P&L, Balance Sheet, Cash Flow',
      icon: FileSpreadsheet,
      color: 'bg-primary-50 text-primary-600 border-primary-100',
      onClick: () => setActiveSection(1),
    },
    {
      name: 'Customer Report',
      description: 'Customer activity, credit, aging',
      icon: Users,
      color: 'bg-sky-50 text-sky-600 border-sky-100',
      detailKey: 'customer',
    },
    {
      name: 'VAT Report',
      description: 'VAT input/output summary',
      icon: BarChart3,
      color: 'bg-amber-50 text-amber-600 border-amber-100',
      onClick: () => setActiveSection(1),
    },
    {
      name: 'Quality Report',
      description: 'Inspection results, defect trends',
      icon: ClipboardCheck,
      color: 'bg-teal-50 text-teal-600 border-teal-100',
      detailKey: 'quality',
    },
  ];

  const handleReportClick = (report: (typeof reportTypes)[number]) => {
    if ('exportType' in report && report.exportType && canExport) {
      handleExport(report.exportType, report.filename!);
    } else if ('onClick' in report && report.onClick) {
      report.onClick();
    } else if ('detailKey' in report && report.detailKey) {
      setDetailModal(report.detailKey);
    }
  };

  return (
    <div className="space-y-1">
      <PageHeader
        title="Reports"
        subtitle="Business intelligence and exportable reports"
        action={canExport ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={downloading === 'sales'} onClick={() => handleExport('sales', 'sales-report.xlsx')}>
              <Download className="h-4 w-4 mr-1" />Sales Excel
            </Button>
            <Button size="sm" variant="secondary" loading={downloading === 'inventory'} onClick={() => handleExport('inventory', 'inventory-report.xlsx')}>
              <Download className="h-4 w-4 mr-1" />Inventory Excel
            </Button>
          </div>
        ) : undefined}
      />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Total Sales" value={formatCurrency(summary.totalSales || 0)} icon={<BarChart3 className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Total Purchases" value={formatCurrency(summary.totalPurchases || 0)} icon={<Truck className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Customers" value={summary.totalCustomers || 0} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Production Done" value={summary.completedProduction || 0} icon={<Factory className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

      <PageToolbar tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />

      {activeSection === 1 ? (
        <FinancialStatementsPanel />
      ) : !summary && !isLoading ? (
        <EmptyState
          title="No report data available"
          description="Summary metrics will appear once your business has activity."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {reportTypes.map((report) => (
            <QuickActionCard
              key={report.name}
              label={report.name}
              desc={report.description}
              icon={report.icon}
              color={report.color}
              onClick={() => handleReportClick(report)}
            />
          ))}
        </div>
      )}

      <Modal open={detailModal !== null} onClose={() => setDetailModal(null)} title={
        detailModal === 'purchase' ? 'Purchase Report' :
        detailModal === 'production' ? 'Production Report' :
        detailModal === 'customer' ? 'Customer Report' : 'Quality Report'
      } size="lg">
        {detailModal === 'purchase' && summary && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">POs This Month</p><p className="text-xl font-semibold">{summary.purchaseOrdersMonth}</p></div>
              <div><p className="text-slate-500">Purchase Value</p><p className="text-xl font-semibold">{formatCurrency(summary.purchaseValueMonth)}</p></div>
              <div><p className="text-slate-500">Total Purchases (All Time)</p><p className="font-semibold">{formatCurrency(summary.totalPurchases)}</p></div>
              <div><p className="text-slate-500">Suppliers</p><p className="font-semibold">{summary.totalSuppliers}</p></div>
            </div>
          </div>
        )}
        {detailModal === 'production' && summary && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-500">Completed Orders</p><p className="text-xl font-semibold">{summary.completedProduction}</p></div>
            <div><p className="text-slate-500">Output This Month</p><p className="text-xl font-semibold">{summary.productionOutputMonth} units</p></div>
          </div>
        )}
        {detailModal === 'customer' && summary && (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600 mb-3">{summary.totalCustomers} active customers · {summary.unpaidInvoices} unpaid invoices</p>
            {summary.topCustomers?.map((c) => (
              <div key={c.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                <span>{c.name} ({c.code})</span>
                <span className="font-medium">{c.orderCount} orders</span>
              </div>
            ))}
          </div>
        )}
        {detailModal === 'quality' && summary && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-500">Passed Inspections</p><p className="text-xl font-semibold text-emerald-600">{summary.qualityPassed}</p></div>
            <div><p className="text-slate-500">Failed Inspections</p><p className="text-xl font-semibold text-red-600">{summary.qualityFailed}</p></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
