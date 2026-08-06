import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi, reportsApi } from '../services/api';
import {
  EmptyState,
  QuickActionCard,
  PageToolbar,
  Alert,
  QueryErrorAlert,
  StatCard,
  StatGrid,
  formatCurrency,
  Badge,
  Button,
  Table,
} from '../components/ui';
import { BarChart3, Users, Factory, Truck, FileSpreadsheet, ClipboardCheck, TrendingUp, AlertCircle, Receipt, Package, Download, FileText } from 'lucide-react';
import { downloadFile } from '../utils/download';
import { FinancialStatementsPanel } from '../components/reports/FinancialStatementsPanel';
import { SalesByPersonPanel } from '../components/reports/SalesByPersonPanel';
import { ProductsSoldPanel } from '../components/reports/ProductsSoldPanel';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { ReportsOverview } from '../types';

type VatReportScope = 'VAT' | 'NON_VAT' | 'ALL';

type VatReport = {
  vatStatus: VatReportScope;
  count: number;
  totals: {
    invoicedTotal: number;
    vatTotal: number;
    paidTotal: number;
    outstanding: number;
  };
  sections?: {
    VAT: { count: number; totals: VatReport['totals'] };
    NON_VAT: { count: number; totals: VatReport['totals'] };
  };
  customers: {
    id: string;
    code: string;
    name: string;
    type: string;
    vatStatus?: 'VAT' | 'NON_VAT';
    taxPin?: string | null;
    city?: string | null;
    invoiceCount: number;
    invoicedTotal: number;
    vatTotal: number;
    paidTotal: number;
    outstanding: number;
    salesPersonName?: string | null;
  }[];
};

export function ReportsPage() {
  const { hasPermission } = useAuth();
  const [activeSection, setActiveSection] = useState(0);
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const sections = ['Overview', 'Sales by Person', 'Products Sold', 'Financial Statements'];

  const canExport = hasPermission('reports:read');

  const [exportError, setExportError] = useState<string | null>(null);
  const [vatExporting, setVatExporting] = useState<string | null>(null);

  const { data: summary, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => reportsApi.summary().then((r) => r.data.data as ReportsOverview),
  });

  const vatModalStatus: VatReportScope | null =
    detailModal === 'vat-customers'
      ? 'VAT'
      : detailModal === 'non-vat-customers'
        ? 'NON_VAT'
        : detailModal === 'vat-combined'
          ? 'ALL'
          : null;

  const { data: vatReport, isLoading: vatReportLoading, isError: vatReportError } = useQuery({
    queryKey: ['customers-vat-report', vatModalStatus],
    queryFn: () => customersApi.vatReport(vatModalStatus!).then((r) => r.data.data as VatReport),
    enabled: !!vatModalStatus,
  });

  const handleExport = async (type: 'sales' | 'inventory', filename: string) => {
    setExportError(null);
    try {
      await downloadFile(`/finance/reports/${type}/excel`, filename);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    }
  };

  const handleVatExport = async (scope: VatReportScope, format: 'pdf' | 'excel') => {
    const key = `${scope}-${format}`;
    setVatExporting(key);
    setExportError(null);
    try {
      const filename =
        scope === 'ALL'
          ? `vat-and-non-vat-customers.${format === 'pdf' ? 'pdf' : 'xlsx'}`
          : scope === 'VAT'
            ? `vat-customers.${format === 'pdf' ? 'pdf' : 'xlsx'}`
            : `non-vat-customers.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      const path =
        format === 'pdf'
          ? '/customers/reports/vat-status/pdf'
          : '/customers/reports/vat-status/excel';
      await downloadFile(path, filename, { vatStatus: scope });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setVatExporting(null);
    }
  };

  const reportTypes = [
    { name: 'Sales Report', description: 'Export all sales invoices with salesperson', icon: BarChart3, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', exportType: 'sales' as const, filename: 'sales-report.xlsx' },
    { name: 'Sales by Person', description: 'Filter, paginate, and export by salesperson', icon: Users, color: 'bg-sky-50 text-sky-600 border-sky-100', onClick: () => setActiveSection(1) },
    { name: 'Products Sold Statement', description: 'Qty sold by product with stock for restocking', icon: Package, color: 'bg-violet-50 text-violet-700 border-violet-100', onClick: () => setActiveSection(2) },
    { name: 'Inventory Report', description: 'Export stock levels and valuation', icon: Factory, color: 'bg-primary-50 text-primary-600 border-primary-100', exportType: 'inventory' as const, filename: 'inventory-report.xlsx' },
    { name: 'Purchase Report', description: 'Purchases by supplier and material', icon: Truck, color: 'bg-red-50 text-red-600 border-red-100', detailKey: 'purchase' },
    { name: 'Production Report', description: 'Output and efficiency summary', icon: Factory, color: 'bg-orange-50 text-orange-600 border-orange-100', detailKey: 'production' },
    { name: 'Financial Statements', description: 'P&L, Balance Sheet, Cash Flow', icon: FileSpreadsheet, color: 'bg-primary-50 text-primary-600 border-primary-100', onClick: () => setActiveSection(3) },
    { name: 'Customer Report', description: 'Customer activity and credit', icon: Users, color: 'bg-primary-50 text-primary-600 border-primary-100', detailKey: 'customer' },
    { name: 'VAT Customers', description: 'VAT-only report — view and export PDF/Excel', icon: Receipt, color: 'bg-emerald-50 text-emerald-700 border-emerald-100', detailKey: 'vat-customers' },
    { name: 'Non-VAT Customers', description: 'Non-VAT-only report — view and export PDF/Excel', icon: Receipt, color: 'bg-slate-50 text-slate-700 border-slate-200', detailKey: 'non-vat-customers' },
    { name: 'VAT & Non-VAT Combined', description: 'Both customer types in one PDF/Excel export', icon: FileSpreadsheet, color: 'bg-indigo-50 text-indigo-700 border-indigo-100', detailKey: 'vat-combined' },
    { name: 'Quality Report', description: 'Inspection results and defects', icon: ClipboardCheck, color: 'bg-teal-50 text-teal-600 border-teal-100', detailKey: 'quality' },
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

  const modalTitle =
    detailModal === 'purchase' ? 'Purchase Report' :
    detailModal === 'production' ? 'Production Report' :
    detailModal === 'customer' ? 'Customer Report' :
    detailModal === 'vat-customers' ? 'VAT Customers Report' :
    detailModal === 'non-vat-customers' ? 'Non-VAT Customers Report' :
    detailModal === 'vat-combined' ? 'VAT & Non-VAT Combined Report' :
    'Quality Report';

  const isVatModal =
    detailModal === 'vat-customers' ||
    detailModal === 'non-vat-customers' ||
    detailModal === 'vat-combined';

  return (
    <div className="space-y-4">
      {activeSection === 0 && summary && (
        <StatGrid>
          <StatCard
            title="Total sales"
            value={formatCurrency(summary.totalSales)}
            icon={<TrendingUp className="h-5 w-5 text-white" />}
            color="from-teal-500 to-teal-700"
            to="/sales"
          />
          <StatCard
            title="Total purchases"
            value={formatCurrency(summary.totalPurchases)}
            icon={<Truck className="h-5 w-5 text-white" />}
            color="from-indigo-500 to-indigo-700"
            to="/procurement"
          />
          <StatCard
            title="Customers"
            value={summary.totalCustomers}
            icon={<Users className="h-5 w-5 text-white" />}
            color="from-orange-500 to-orange-700"
            to="/customers"
          />
          <StatCard
            title="Production completed"
            value={summary.completedProduction}
            icon={<Factory className="h-5 w-5 text-white" />}
            color="from-fuchsia-500 to-fuchsia-700"
            to="/production"
          />
          <StatCard
            title="Unpaid invoices"
            value={summary.unpaidInvoices}
            icon={<AlertCircle className="h-5 w-5 text-white" />}
            color="from-cyan-500 to-cyan-700"
            to="/finance"
          />
        </StatGrid>
      )}

      {activeSection === 1 ? (
        <SalesByPersonPanel
          toolbar={<PageToolbar tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />}
        />
      ) : activeSection === 2 ? (
        <ProductsSoldPanel
          toolbar={<PageToolbar tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />}
        />
      ) : (
        <>
          <PageToolbar tabs={sections} activeTab={activeSection} onTabChange={setActiveSection} />

          <QueryErrorAlert error={isError ? error : null} onRetry={() => refetch()} />
          {exportError && <Alert variant="error">{exportError}</Alert>}

          {activeSection === 3 ? (
            <FinancialStatementsPanel />
          ) : !summary && !isLoading ? (
            <EmptyState title="No report data available" description="Summary metrics will appear once your business has activity." />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {reportTypes.map((report) => (
                  <QuickActionCard
                    key={report.name}
                    label={report.name}
                    desc={report.description}
                    icon={report.icon}
                    color={report.color}
                    disabled={'exportType' in report && !!report.exportType && !canExport}
                    onClick={() => handleReportClick(report)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={detailModal !== null} onClose={() => setDetailModal(null)} title={modalTitle} size="xl">
        {detailModal === 'purchase' && summary && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">POs This Month</p><p className="text-xl font-semibold">{summary.purchaseOrdersMonth}</p></div>
              <div><p className="text-slate-500">Purchase Value</p><p className="text-xl font-semibold">{summary.purchaseValueMonth}</p></div>
              <div><p className="text-slate-500">Total Purchases (All Time)</p><p className="font-semibold">{summary.totalPurchases}</p></div>
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
            <div className="flex flex-wrap gap-2 pt-3">
              <Button size="sm" variant="secondary" onClick={() => setDetailModal('vat-customers')}>VAT customers</Button>
              <Button size="sm" variant="secondary" onClick={() => setDetailModal('non-vat-customers')}>Non-VAT customers</Button>
              <Button size="sm" variant="secondary" onClick={() => setDetailModal('vat-combined')}>Combined</Button>
            </div>
          </div>
        )}
        {detailModal === 'quality' && summary && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-slate-500">Passed Inspections</p><p className="text-xl font-semibold text-emerald-600">{summary.qualityPassed}</p></div>
            <div><p className="text-slate-500">Failed Inspections</p><p className="text-xl font-semibold text-red-600">{summary.qualityFailed}</p></div>
          </div>
        )}
        {isVatModal && (
          <div className="space-y-4">
            {detailModal === 'non-vat-customers' && (
              <p className="text-sm text-slate-600">
                Non-VAT customers still receive company sales invoices; VAT on those invoices is 0%.
              </p>
            )}
            {detailModal === 'vat-combined' && (
              <p className="text-sm text-slate-600">
                Combined view of VAT and Non-VAT customers. Excel export includes a combined sheet plus separate VAT / Non-VAT sheets.
              </p>
            )}
            {vatModalStatus && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={vatExporting === `${vatModalStatus}-pdf`}
                  onClick={() => handleVatExport(vatModalStatus, 'pdf')}
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Export PDF
                </Button>
                <Button
                  size="sm"
                  loading={vatExporting === `${vatModalStatus}-excel`}
                  onClick={() => handleVatExport(vatModalStatus, 'excel')}
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  Export Excel
                </Button>
                {detailModal !== 'vat-customers' && (
                  <Button size="sm" variant="ghost" onClick={() => handleVatExport('VAT', 'pdf')}>
                    VAT PDF
                  </Button>
                )}
                {detailModal !== 'non-vat-customers' && (
                  <Button size="sm" variant="ghost" onClick={() => handleVatExport('NON_VAT', 'pdf')}>
                    Non-VAT PDF
                  </Button>
                )}
                {detailModal !== 'vat-combined' && (
                  <Button size="sm" variant="ghost" onClick={() => handleVatExport('ALL', 'excel')}>
                    Combined Excel
                  </Button>
                )}
              </div>
            )}
            {vatReportLoading && <p className="text-sm text-slate-500 py-6 text-center">Loading report…</p>}
            {vatReportError && <Alert variant="error">Failed to load VAT customer report.</Alert>}
            {vatReport && !vatReportLoading && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-muted/60 px-3 py-2">
                    <p className="text-slate-500 text-xs">Customers</p>
                    <p className="text-xl font-semibold">{vatReport.count}</p>
                  </div>
                  <div className="rounded-xl bg-surface-muted/60 px-3 py-2">
                    <p className="text-slate-500 text-xs">Invoiced</p>
                    <p className="font-semibold tabular-nums">{formatCurrency(vatReport.totals.invoicedTotal)}</p>
                  </div>
                  <div className="rounded-xl bg-surface-muted/60 px-3 py-2">
                    <p className="text-slate-500 text-xs">VAT total</p>
                    <p className="font-semibold tabular-nums">{formatCurrency(vatReport.totals.vatTotal)}</p>
                  </div>
                  <div className="rounded-xl bg-surface-muted/60 px-3 py-2">
                    <p className="text-slate-500 text-xs">Outstanding</p>
                    <p className="font-semibold tabular-nums">{formatCurrency(vatReport.totals.outstanding)}</p>
                  </div>
                </div>
                {vatReport.sections && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2">
                      <p className="text-xs text-emerald-800">VAT customers</p>
                      <p className="font-semibold">{vatReport.sections.VAT.count}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-xs text-slate-600">Non-VAT customers</p>
                      <p className="font-semibold">{vatReport.sections.NON_VAT.count}</p>
                    </div>
                  </div>
                )}
                {vatReport.customers.length === 0 ? (
                  <EmptyState
                    title={
                      detailModal === 'vat-customers'
                        ? 'No VAT customers'
                        : detailModal === 'non-vat-customers'
                          ? 'No Non-VAT customers'
                          : 'No customers'
                    }
                    description="Customers appear here once classified on the Customers page."
                  />
                ) : (
                  <div className="max-h-[55vh] overflow-y-auto border border-border/60 rounded-xl">
                    <Table
                      embedded
                      data={vatReport.customers}
                      columns={[
                        { key: 'name', label: 'Name' },
                        { key: 'code', label: 'Code' },
                        {
                          key: 'type',
                          label: 'Type',
                          render: (val: unknown) => (
                            <Badge variant="info">{String(val).replace(/_/g, ' ')}</Badge>
                          ),
                        },
                        ...((detailModal === 'vat-customers' || detailModal === 'vat-combined')
                          ? [
                              {
                                key: 'status',
                                label: 'Status',
                                render: (_: unknown, row: Record<string, unknown>) => (
                                  <Badge variant={row.vatStatus === 'NON_VAT' ? 'default' : 'success'}>
                                    {row.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT'}
                                  </Badge>
                                ),
                              },
                              {
                                key: 'taxPin',
                                label: 'Tax PIN',
                                render: (val: unknown) => (
                                  <span className="text-slate-600">{(val as string) || '—'}</span>
                                ),
                              },
                            ]
                          : []),
                        {
                          key: 'invoiceCount',
                          label: 'Invoices',
                          render: (val: unknown) => (
                            <span className="tabular-nums">{val as number}</span>
                          ),
                        },
                        {
                          key: 'invoicedTotal',
                          label: 'Invoiced',
                          render: (val: unknown) => (
                            <span className="tabular-nums">{formatCurrency(val as number)}</span>
                          ),
                        },
                        {
                          key: 'vatTotal',
                          label: 'VAT',
                          render: (val: unknown) => (
                            <span className="tabular-nums">{formatCurrency(val as number)}</span>
                          ),
                        },
                        {
                          key: 'outstanding',
                          label: 'Outstanding',
                          render: (val: unknown) => (
                            <span className="tabular-nums font-medium">
                              {formatCurrency(val as number)}
                            </span>
                          ),
                        },
                      ]}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
