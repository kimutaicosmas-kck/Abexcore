import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customersApi, reportsApi } from '../services/api';
import {
  EmptyState,
  PageToolbar,
  Alert,
  QueryErrorAlert,
  StatCard,
  StatGrid,
  formatCurrency,
  Badge,
  Button,
  Table,
  Input,
} from '../components/ui';
import { BarChart3, ChevronRight, Search, Sparkles, TrendingUp, AlertCircle, Users, Factory, Truck } from 'lucide-react';
import { downloadFile } from '../utils/download';
import { FinancialStatementsPanel } from '../components/reports/FinancialStatementsPanel';
import { SalesByPersonPanel } from '../components/reports/SalesByPersonPanel';
import { ProductsSoldPanel } from '../components/reports/ProductsSoldPanel';
import { ReportExportDrawer } from '../components/reports/ReportExportDrawer';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { ReportsOverview } from '../types';
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  ReportCategory,
  ReportDefinition,
  getReportById,
} from '../config/reportCatalog';

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
  const [activeSection, setActiveSection] = useState<number | null>(null);
  const [detailModal, setDetailModal] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | 'all'>('all');
  const sections = ['Sales by Person', 'Products Sold', 'Financial Statements'];

  const canExport = hasPermission('reports:read');
  const selectedReport = selectedReportId ? getReportById(selectedReportId) ?? null : null;

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

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return REPORT_CATALOG.filter((report) => {
      const categoryMatch = activeCategory === 'all' || report.category === activeCategory;
      const searchMatch =
        !q ||
        report.name.toLowerCase().includes(q) ||
        report.description.toLowerCase().includes(q) ||
        report.category.includes(q);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, searchQuery]);

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

  const openReport = (report: ReportDefinition) => {
    setSelectedReportId(report.id);
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

  const sectionToolbar = (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => setActiveSection(null)}>
        ← Back to all reports
      </Button>
      <PageToolbar tabs={sections} activeTab={activeSection ?? 0} onTabChange={setActiveSection} />
    </div>
  );

  return (
    <div className="space-y-5">
      {activeSection === 0 ? (
        <SalesByPersonPanel toolbar={sectionToolbar} />
      ) : activeSection === 1 ? (
        <ProductsSoldPanel toolbar={sectionToolbar} />
      ) : activeSection === 2 ? (
        <>
          {sectionToolbar}
          <FinancialStatementsPanel />
        </>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 via-white to-sky-50 p-5 sm:p-6">
            <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2 max-w-2xl">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-primary-700 border border-primary-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  Reports & analytics
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  Build and export business reports
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                  Choose a report, set your filters, then download as PDF or Excel. All {REPORT_CATALOG.length} reports remain available.
                </p>
              </div>
              <div className="w-full lg:max-w-sm">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-[2.35rem] h-4 w-4 text-slate-400" />
                  <Input
                    label="Search reports"
                    placeholder="Sales, VAT, inventory, quality…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
            </div>
            <BarChart3 className="absolute -right-4 -bottom-4 h-32 w-32 text-primary-100/70 pointer-events-none" />
          </div>

          <div className="flex flex-wrap gap-2">
            {REPORT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  activeCategory === cat.id
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <QueryErrorAlert error={isError ? error : null} onRetry={() => refetch()} />
          {exportError && <Alert variant="error">{exportError}</Alert>}

          {summary && (
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

          {!summary && !isLoading ? (
            <EmptyState title="No report data available" description="Summary metrics will appear once your business has activity." />
          ) : filteredReports.length === 0 ? (
            <EmptyState title="No reports match your search" description="Try another keyword or clear the category filter." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredReports.map((report) => {
                const Icon = report.icon;
                return (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => openReport(report)}
                    className={`group flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition hover:shadow-md hover:-translate-y-0.5 ${report.color}`}
                  >
                    <div className="flex w-full items-start justify-between gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/80 shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-primary-600 transition mt-1" />
                    </div>
                    <div className="min-w-0 w-full">
                      <p className="font-semibold text-slate-900">{report.name}</p>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-2">{report.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {report.filters.length > 0 && (
                        <Badge variant="info">{report.filters.length} filters</Badge>
                      )}
                      {report.formats.map((f) => (
                        <Badge key={f} variant="default">{f.toUpperCase()}</Badge>
                      ))}
                      {report.panelSection !== undefined && (
                        <Badge variant="success">Interactive</Badge>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      <ReportExportDrawer
        report={selectedReport}
        open={selectedReportId !== null}
        onClose={() => setSelectedReportId(null)}
        canExport={canExport}
        onOpenPanel={(section) => {
          setActiveSection(section);
          setSelectedReportId(null);
        }}
        onOpenDetail={(detailKey) => {
          setDetailModal(detailKey);
          setSelectedReportId(null);
        }}
      />

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
                  Export PDF
                </Button>
                <Button
                  size="sm"
                  loading={vatExporting === `${vatModalStatus}-excel`}
                  onClick={() => handleVatExport(vatModalStatus, 'excel')}
                >
                  Export Excel
                </Button>
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
                {vatReport.customers.length === 0 ? (
                  <EmptyState title="No customers" description="Customers appear here once classified on the Customers page." />
                ) : (
                  <div className="max-h-[55vh] overflow-y-auto border border-border/60 rounded-xl">
                    <Table
                      embedded
                      data={vatReport.customers}
                      columns={[
                        { key: 'name', label: 'Name' },
                        { key: 'code', label: 'Code' },
                        {
                          key: 'invoiceCount',
                          label: 'Invoices',
                          render: (val: unknown) => <span className="tabular-nums">{val as number}</span>,
                        },
                        {
                          key: 'invoicedTotal',
                          label: 'Invoiced',
                          render: (val: unknown) => (
                            <span className="tabular-nums">{formatCurrency(val as number)}</span>
                          ),
                        },
                        {
                          key: 'outstanding',
                          label: 'Outstanding',
                          render: (val: unknown) => (
                            <span className="tabular-nums font-medium">{formatCurrency(val as number)}</span>
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
