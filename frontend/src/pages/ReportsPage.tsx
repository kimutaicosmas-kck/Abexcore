import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../services/api';
import { PageHeader, Card, Button, StatCard, TabGroup, formatCurrency } from '../components/ui';
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

  const { data: summary } = useQuery({
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
    { name: 'Sales Report', description: 'Sales by period, customer, product', icon: BarChart3, exportType: 'sales' as const, filename: 'sales-report.xlsx' },
    { name: 'Inventory Report', description: 'Stock levels, movements, valuation', icon: Factory, exportType: 'inventory' as const, filename: 'inventory-report.xlsx' },
    { name: 'Purchase Report', description: 'Purchases by supplier, material', icon: Truck, detailKey: 'purchase' },
    { name: 'Production Report', description: 'Output, consumption, efficiency', icon: Factory, detailKey: 'production' },
    { name: 'Financial Statements', description: 'P&L, Balance Sheet, Cash Flow', icon: FileSpreadsheet, onClick: () => setActiveSection(1) },
    { name: 'Customer Report', description: 'Customer activity, credit, aging', icon: Users, detailKey: 'customer' },
    { name: 'VAT Report', description: 'VAT input/output summary', icon: BarChart3, onClick: () => setActiveSection(1) },
    { name: 'Quality Report', description: 'Inspection results, defect trends', icon: ClipboardCheck, detailKey: 'quality' },
  ];

  return (
    <div>
      <PageHeader
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

      <TabGroup tabs={sections} activeIndex={activeSection} onChange={setActiveSection} className="mb-4" />

      {activeSection === 1 ? (
        <FinancialStatementsPanel />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <StatCard title="Total Sales" value={formatCurrency(summary?.totalSales || 0)} icon={<BarChart3 className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
            <StatCard title="Total Purchases" value={formatCurrency(summary?.totalPurchases || 0)} icon={<Truck className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
            <StatCard title="Customers" value={summary?.totalCustomers || 0} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
            <StatCard title="Production Done" value={summary?.completedProduction || 0} icon={<Factory className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {reportTypes.map((report) => (
              <Card key={report.name} className="hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary-50 rounded-lg shrink-0">
                    <report.icon className="h-4 w-4 text-primary-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm text-slate-900">{report.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{report.description}</p>
                    {'exportType' in report && report.exportType && canExport && (
                      <Button size="sm" variant="ghost" className="mt-1 -ml-2 h-7" loading={downloading === report.exportType} onClick={() => handleExport(report.exportType!, report.filename!)}>
                        <Download className="h-3 w-3 mr-1" /> Excel
                      </Button>
                    )}
                    {'onClick' in report && report.onClick && (
                      <Button size="sm" variant="ghost" className="mt-1 -ml-2 h-7" onClick={report.onClick}>Open</Button>
                    )}
                    {'detailKey' in report && report.detailKey && (
                      <Button size="sm" variant="ghost" className="mt-1 -ml-2 h-7" onClick={() => setDetailModal(report.detailKey!)}>View</Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
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
