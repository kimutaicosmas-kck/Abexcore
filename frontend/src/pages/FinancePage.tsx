import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import {
  Plus,
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertCircle,
  FileText,
  FileSpreadsheet,
  CreditCard,
  BookOpen,
  Landmark,
  ArrowRight,
  Receipt,
  CircleDollarSign,
  Download,
} from 'lucide-react';
import { financeApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Card,
  Button,
  StatCard,
  StatGrid,
  Input,
  Select,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { InvoiceForm } from '../components/forms/InvoiceForm';
import { PaymentForm } from '../components/forms/PaymentForm';
import { JournalEntryForm } from '../components/forms/JournalEntryForm';
import { useAuth } from '../contexts/AuthContext';
import { downloadFile } from '../utils/download';
import { getApiErrorMessage } from '../utils/apiError';
import { FinanceStats, FinanceOverview, Invoice, Payment } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Plus Jakarta Sans', size: 11 } } },
  },
};

const CASH_FLOW_DAYS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

const AGING_BUCKETS = [
  { key: 'current' as const, label: 'Current', sub: 'Not yet due', color: 'bg-emerald-500', variant: 'success' as const },
  { key: 'days1_30' as const, label: '1–30 days', sub: 'Past due', color: 'bg-amber-500', variant: 'warning' as const },
  { key: 'days31_60' as const, label: '31–60 days', sub: 'Past due', color: 'bg-orange-500', variant: 'warning' as const },
  { key: 'days61_90' as const, label: '61–90 days', sub: 'Past due', color: 'bg-red-500', variant: 'danger' as const },
  { key: 'days90Plus' as const, label: '90+ days', sub: 'Critical', color: 'bg-rose-700', variant: 'danger' as const },
];

const tabs = ['Overview', 'Invoices', 'Payments', 'Journals', 'Accounts', 'Reconciliation'];

const TYPE_FILTER = [
  { value: '', label: 'All types' },
  { value: 'SALES', label: 'Sales' },
  { value: 'PURCHASE', label: 'Purchase' },
];

const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' },
];

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

function invoiceBalance(inv: Invoice) {
  return Math.max(0, Number(inv.totalAmount) - Number(inv.paidAmount));
}

function isOverdue(inv: Invoice) {
  if (!inv.dueDate || inv.status === 'PAID') return false;
  return new Date(inv.dueDate) < new Date() && invoiceBalance(inv) > 0;
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const [payPage, setPayPage] = useState(1);
  const [paySearch, setPaySearch] = useState('');
  const [payPeriod, setPayPeriod] = useState('this_week_taken_and_paid');
  const [payMethod, setPayMethod] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [payTo, setPayTo] = useState('');

  const [journalPage, setJournalPage] = useState(1);
  const [journalSearch, setJournalSearch] = useState('');

  const [downloading, setDownloading] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [journalDetailOpen, setJournalDetailOpen] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState<Record<string, unknown> | null>(null);
  const [paymentForInvoiceId, setPaymentForInvoiceId] = useState<string | undefined>();
  const [cashFlowDays, setCashFlowDays] = useState('30');

  const canCreate = hasPermission('finance:create');
  const canUpdate = hasPermission('finance:update');

  const { data: stats } = useQuery({
    queryKey: ['finance-stats'],
    queryFn: () => financeApi.stats().then((r) => r.data.data as FinanceStats),
  });

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['finance-overview', cashFlowDays],
    queryFn: () => financeApi.overview(Number(cashFlowDays)).then((r) => r.data.data as FinanceOverview),
    enabled: activeTab === 0,
  });

  const { data: invoices, isLoading: invLoading, isError: invError, refetch: refetchInvoices } = useQuery({
    queryKey: ['invoices', page, search, type, status],
    queryFn: () =>
      financeApi
        .invoices({ page, limit: 15, search: search || undefined, type: type || undefined, status: status || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const { data: invoiceDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['invoice-detail', selectedInvoiceId],
    queryFn: () => financeApi.getInvoice(selectedInvoiceId!).then((r) => r.data.data as Invoice),
    enabled: !!selectedInvoiceId && detailOpen,
  });

  const payPeriodPreset =
    payPeriod && payPeriod !== 'custom' ? payPeriod : undefined;

  const { data: payments, isLoading: payLoading } = useQuery({
    queryKey: ['payments', payPage, paySearch, payPeriod, payMethod, payFrom, payTo],
    queryFn: () =>
      financeApi
        .listPayments({
          page: payPage,
          limit: 15,
          search: paySearch || undefined,
          period: payPeriodPreset,
          method: payMethod || undefined,
          from: !payPeriodPreset && payFrom ? payFrom : undefined,
          to: !payPeriodPreset && payTo ? payTo : undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.accounts().then((r) => r.data.data as { id: string; code: string; name: string; type: string; balance: number }[]),
    enabled: activeTab === 0 || activeTab === 4,
  });

  const { data: journalEntries, isLoading: journalLoading } = useQuery({
    queryKey: ['journal-entries', journalPage, journalSearch],
    queryFn: () =>
      financeApi.journalEntries({ page: journalPage, limit: 15, search: journalSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: reconciliation } = useQuery({
    queryKey: ['bank-reconciliation'],
    queryFn: () => financeApi.bankReconciliation().then((r) => r.data.data),
    enabled: activeTab === 5,
  });

  const reconcileMutation = useMutation({
    mutationFn: (id: string) => financeApi.reconcilePayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
    },
  });

  const importStatementMutation = useMutation({
    mutationFn: (payload: { csvText?: string; pdfBase64?: string }) => {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return financeApi.importBankStatement({
        ...payload,
        periodStart: monthStart.toISOString().slice(0, 10),
        periodEnd: today.toISOString().slice(0, 10),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] }),
  });

  const autoMatchMutation = useMutation({
    mutationFn: (statementId: string) => financeApi.autoMatchBankStatement(statementId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] }),
  });

  const submitEtimsMutation = useMutation({
    mutationFn: (invoiceId: string) => financeApi.submitEtims(invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoice-detail'] });
    },
  });

  const openInvoiceDetail = (inv: Invoice) => {
    setSelectedInvoiceId(inv.id);
    setDetailOpen(true);
  };

  const openPaymentModal = (invoiceId?: string) => {
    setPaymentForInvoiceId(invoiceId);
    setPaymentModalOpen(true);
  };

  const handleExport = async (id: string, exportType: 'pdf' | 'excel', invoiceNumber: string) => {
    setDownloading(`${id}-${exportType}`);
    try {
      const path =
        exportType === 'pdf'
          ? `/finance/invoices/${id}/pdf`
          : `/finance/invoices/${id}/excel`;
      await downloadFile(path, `${invoiceNumber}.${exportType === 'pdf' ? 'pdf' : 'xlsx'}`);
    } finally {
      setDownloading(null);
    }
  };

  const goToTab = (index: number) => setActiveTab(index);

  const invoiceColumns = [
    {
      key: 'invoiceNumber',
      label: 'Invoice #',
      render: (val: unknown, row: Record<string, unknown>) => (
        <div>
          <span className="font-medium text-slate-900">{val as string}</span>
          {isOverdue(row as unknown as Invoice) && (
            <span className="ml-2"><Badge variant="danger">Overdue</Badge></span>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => (
        <Badge variant={val === 'SALES' ? 'success' : 'info'}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'party',
      label: 'Customer / Supplier',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || (row.supplier as { name: string })?.name || '—',
    },
    {
      key: 'customerPoNumber',
      label: 'LPO',
      render: (val: unknown, row: Record<string, unknown>) => {
        const fromOrder = (row.salesOrder as { customerPoNumber?: string | null } | null | undefined)
          ?.customerPoNumber;
        return (val as string) || fromOrder || '—';
      },
    },
    {
      key: 'salesPerson',
      label: 'Sales Person',
      render: (_: unknown, row: Record<string, unknown>) => {
        const order = row.salesOrder as Invoice['salesOrder'];
        const person = order?.salesPerson || order?.createdBy;
        if (!person) return <span className="text-slate-400">—</span>;
        return `${person.firstName} ${person.lastName}`.trim() || '—';
      },
    },
    { key: 'invoiceDate', label: 'Date', render: (val: unknown) => formatDate(val as string) },
    {
      key: 'dueDate',
      label: 'Due',
      render: (val: unknown) => (val ? formatDate(val as string) : '—'),
    },
    {
      key: 'totalAmount',
      label: 'Total',
      render: (val: unknown) => <span className="font-medium">{formatCurrency(val as number)}</span>,
    },
    {
      key: 'balance',
      label: 'Balance',
      render: (_: unknown, row: Record<string, unknown>) => {
        const bal = invoiceBalance(row as unknown as Invoice);
        return (
          <span className={bal > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}>
            {formatCurrency(bal)}
          </span>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => <Badge variant={getStatusBadge(val as string)}>{val as string}</Badge>,
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => {
        const inv = row as unknown as Invoice;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              variant="secondary"
              size="sm"
              loading={downloading === `${inv.id}-pdf`}
              onClick={() => handleExport(inv.id, 'pdf', inv.invoiceNumber)}
            >
              <Download className="h-4 w-4 mr-1" />
              PDF
            </Button>
          </div>
        );
      },
    },
  ];

  const paymentColumns = [
    { key: 'paymentNumber', label: 'Payment #' },
    {
      key: 'invoice',
      label: 'Invoice / Order',
      render: (val: unknown) => {
        const inv = val as Payment['invoice'];
        if (!inv) return '—';
        return (
          <div>
            <p className="font-medium text-slate-900">{inv.invoiceNumber}</p>
            {inv.salesOrder?.orderNumber && (
              <p className="text-xs text-slate-500">
                Order {inv.salesOrder.orderNumber}
                {inv.salesOrder.orderDate ? ` · ${formatDate(inv.salesOrder.orderDate)}` : ''}
              </p>
            )}
            {!inv.salesOrder?.orderNumber && inv.invoiceDate && (
              <p className="text-xs text-slate-500">Invoiced {formatDate(inv.invoiceDate)}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'party',
      label: 'Party',
      render: (_: unknown, row: Record<string, unknown>) => {
        const inv = row.invoice as Payment['invoice'];
        return inv?.customer?.name || inv?.supplier?.name || '—';
      },
    },
    {
      key: 'paymentDate',
      label: 'Paid on',
      render: (val: unknown, row: Record<string, unknown>) => {
        const pay = row as unknown as Payment;
        return (
          <div>
            <p>{formatDate(val as string)}</p>
            {pay.invoice?.invoiceDate && (
              <p className="text-xs text-slate-500">Invoice {formatDate(pay.invoice.invoiceDate)}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'timing',
      label: 'Timing',
      render: (_: unknown, row: Record<string, unknown>) => {
        const pay = row as unknown as Payment;
        if (pay.paidSameWeekAsInvoice) {
          return <Badge variant="success">Paid in invoice week</Badge>;
        }
        if (pay.paidSameMonthAsInvoice) {
          return <Badge variant="info">Paid in invoice month</Badge>;
        }
        return <Badge variant="default">Later payment</Badge>;
      },
    },
    {
      key: 'method',
      label: 'Method',
      render: (val: unknown) => (
        <Badge variant={val === 'MPESA' ? 'success' : 'default'}>{(val as string || '—').replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      render: (val: unknown) => <span className="font-semibold text-emerald-700">{formatCurrency(val as number)}</span>,
    },
    { key: 'reference', label: 'Reference', render: (val: unknown) => (val as string) || '—' },
  ];

  const PAY_PERIOD_OPTIONS = [
    { value: 'this_week_taken_and_paid', label: 'Taken & paid this week' },
    { value: 'this_month_taken_and_paid', label: 'Taken & paid this month' },
    { value: 'same_week_as_invoice', label: 'Paid in week invoice was taken' },
    { value: 'same_month_as_invoice', label: 'Paid in month invoice was taken' },
    { value: 'this_week', label: 'Paid this week (any invoice)' },
    { value: 'last_week', label: 'Paid last week (any invoice)' },
    { value: 'this_month', label: 'Paid this month (any invoice)' },
    { value: 'last_month', label: 'Paid last month (any invoice)' },
    { value: '', label: 'All payment dates' },
    { value: 'custom', label: 'Custom dates…' },
  ];

  const PAY_METHOD_OPTIONS = [
    { value: '', label: 'All methods' },
    { value: 'CASH', label: 'Cash' },
    { value: 'MPESA', label: 'M-Pesa' },
    { value: 'BANK_TRANSFER', label: 'Bank transfer' },
    { value: 'CHEQUE', label: 'Cheque' },
    { value: 'COOP_PAYBILL', label: 'Co-op Paybill' },
    { value: 'CARD', label: 'Card' },
    { value: 'CREDIT', label: 'Credit' },
  ];

  const unpaidInvoices = ((invoices?.data as Invoice[]) || []).filter((i) => invoiceBalance(i) > 0);

  const cashFlowChartData = overview
    ? {
        labels: overview.cashFlow.trend.map((d) => d.date.slice(5)),
        datasets: [
          {
            label: 'Cash In',
            data: overview.cashFlow.trend.map((d) => d.inflow),
            backgroundColor: 'rgba(16, 185, 129, 0.85)',
            borderRadius: 4,
            barPercentage: 0.7,
          },
          {
            label: 'Cash Out',
            data: overview.cashFlow.trend.map((d) => d.outflow),
            backgroundColor: 'rgba(244, 63, 94, 0.75)',
            borderRadius: 4,
            barPercentage: 0.7,
          },
        ],
      }
    : null;

  const netCashFlowChartData = overview
    ? {
        labels: overview.cashFlow.trend.map((d) => d.date.slice(5)),
        datasets: [
          {
            label: 'Net cash flow',
            data: overview.cashFlow.trend.map((d) => d.net),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 4,
            borderWidth: 2,
          },
        ],
      }
    : null;

  const agingChartData = overview
    ? {
        labels: AGING_BUCKETS.map((b) => b.label),
        datasets: [
          {
            label: 'Outstanding (KES)',
            data: AGING_BUCKETS.map((b) => overview.arAging.buckets[b.key].amount),
            backgroundColor: ['#10b981', '#f59e0b', '#f97316', '#ef4444', '#be123c'],
            borderRadius: 6,
            barThickness: 28,
          },
        ],
      }
    : null;

  const accountsByType = (accounts || []).reduce<Record<string, typeof accounts>>((acc, a) => {
    const t = a.type || 'OTHER';
    if (!acc[t]) acc[t] = [];
    acc[t]!.push(a);
    return acc;
  }, {});

  const toolbarActions = canCreate ? (
    <div className="flex flex-wrap gap-2">
      {activeTab === 1 && (
        <>
          <Button size="sm" variant="secondary" onClick={() => openPaymentModal()}>
            <CreditCard className="h-4 w-4 mr-1.5" /> Record Payment
          </Button>
          <Button size="sm" onClick={() => setInvoiceModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Invoice
          </Button>
        </>
      )}
      {activeTab === 2 && (
        <Button size="sm" onClick={() => openPaymentModal()}>
          <Plus className="h-4 w-4 mr-1.5" /> Record Payment
        </Button>
      )}
      {activeTab === 3 && (
        <Button size="sm" onClick={() => setJournalModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" /> Post Journal
        </Button>
      )}
    </div>
  ) : undefined;

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard title="Monthly Revenue" value={formatCurrency(stats.monthlyRevenue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Receivable" value={formatCurrency(stats.accountsReceivable)} icon={<Wallet className="h-5 w-5 text-white" />} color="from-primary-500 to-primary-700" />
          <StatCard title="Payable" value={formatCurrency(stats.accountsPayable)} icon={<TrendingDown className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Overdue" value={stats.overdueInvoices} icon={<AlertCircle className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Total Sales" value={formatCurrency(stats.totalSales)} icon={<Receipt className="h-5 w-5 text-white" />} color="from-primary-600 to-primary-800" />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.overdueInvoices > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <AlertCircle className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.overdueInvoices} overdue
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => {
          setActiveTab(t);
          setPage(1);
          setPayPage(1);
          setJournalPage(1);
        }}
        actions={toolbarActions}
      />

      {/* Overview */}
      {activeTab === 0 && stats && (
        <div className="space-y-4">
          <div className="space-y-4">
            {/* Cash flow */}
            <Card
              title="Cash flow"
              action={
                <Select
                  options={CASH_FLOW_DAYS}
                  value={cashFlowDays}
                  onChange={(e) => setCashFlowDays(e.target.value)}
                  className="w-28 text-sm"
                />
              }
              padding
            >
              {overviewLoading ? (
                <div className="h-48 flex items-center justify-center text-sm text-slate-500">Loading chart…</div>
              ) : overview && cashFlowChartData ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2.5 min-w-0">
                      <p className="text-xs text-emerald-700">Cash in</p>
                      <p className="mt-1 text-sm sm:text-base font-bold text-emerald-800 tabular-nums break-words">{formatCurrency(overview.cashFlow.totalInflow)}</p>
                    </div>
                    <div className="rounded-xl bg-red-50 border border-red-100 px-3 py-2.5 min-w-0">
                      <p className="text-xs text-red-700">Cash out</p>
                      <p className="mt-1 text-sm sm:text-base font-bold text-red-800 tabular-nums break-words">{formatCurrency(overview.cashFlow.totalOutflow)}</p>
                    </div>
                    <div className={`rounded-xl border px-3 py-2.5 min-w-0 ${overview.cashFlow.net >= 0 ? 'bg-primary-50 border-primary-100' : 'bg-amber-50 border-amber-100'}`}>
                      <p className={`text-xs ${overview.cashFlow.net >= 0 ? 'text-primary-700' : 'text-amber-700'}`}>Net</p>
                      <p className={`mt-1 text-sm sm:text-base font-bold tabular-nums break-words ${overview.cashFlow.net >= 0 ? 'text-primary-800' : 'text-amber-800'}`}>
                        {formatCurrency(overview.cashFlow.net)}
                      </p>
                    </div>
                  </div>
                  <div className="h-44 mb-3">
                    <Bar
                      data={cashFlowChartData}
                      options={{
                        ...chartDefaults,
                        scales: {
                          x: { grid: { display: false }, ticks: { maxTicksLimit: 10, font: { size: 10, family: 'Plus Jakarta Sans' } } },
                          y: { beginAtZero: true, ticks: { font: { size: 10, family: 'Plus Jakarta Sans' } } },
                        },
                        plugins: { ...chartDefaults.plugins, legend: { position: 'top' } },
                      }}
                    />
                  </div>
                  <div className="h-28">
                    <Line
                      data={netCashFlowChartData!}
                      options={{
                        ...chartDefaults,
                        scales: {
                          x: { display: false },
                          y: { ticks: { font: { size: 10, family: 'Plus Jakarta Sans' } } },
                        },
                        plugins: { ...chartDefaults.plugins, legend: { display: false } },
                      }}
                    />
                  </div>
                </>
              ) : (
                <EmptyState title="No payment activity" description="Record payments to see cash flow trends." />
              )}
            </Card>

            {/* AR Aging */}
            <Card title="Accounts receivable aging" padding>
              {overviewLoading ? (
                <div className="h-32 flex items-center justify-center text-sm text-slate-500">Loading aging…</div>
              ) : overview ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm text-slate-600">
                      Total outstanding:{' '}
                      <span className="font-bold text-slate-900">{formatCurrency(overview.arAging.totalOutstanding)}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                    {AGING_BUCKETS.map((b) => {
                      const bucket = overview.arAging.buckets[b.key];
                      const pct = overview.arAging.totalOutstanding
                        ? (bucket.amount / overview.arAging.totalOutstanding) * 100
                        : 0;
                      return (
                        <div key={b.key} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 min-w-0">
                          <div className={`h-1 w-full rounded-full ${b.color} mb-2`} style={{ opacity: Math.max(0.25, pct / 100) }} />
                          <p className="text-xs font-medium text-slate-700 line-clamp-2">{b.label}</p>
                          <p className="text-xs text-slate-400 mb-1">{b.sub}</p>
                          <p className="text-xs sm:text-sm font-bold text-slate-900 tabular-nums break-words">{formatCurrency(bucket.amount)}</p>
                          <p className="text-xs text-slate-500">{bucket.count} invoice{bucket.count !== 1 ? 's' : ''}</p>
                        </div>
                      );
                    })}
                  </div>
                  {agingChartData && overview.arAging.totalOutstanding > 0 && (
                    <div className="h-40">
                      <Bar
                        data={agingChartData}
                        options={{
                          indexAxis: 'y' as const,
                          ...chartDefaults,
                          scales: {
                            x: { beginAtZero: true, ticks: { font: { size: 10, family: 'Plus Jakarta Sans' } } },
                            y: { grid: { display: false }, ticks: { font: { size: 10, family: 'Plus Jakarta Sans' } } },
                          },
                          plugins: { ...chartDefaults.plugins, legend: { display: false } },
                        }}
                      />
                    </div>
                  )}
                  {overview.arAging.topOverdue.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Top overdue</p>
                      <div className="space-y-1">
                        {overview.arAging.topOverdue.slice(0, 5).map((row) => (
                          <button
                            key={row.id}
                            type="button"
                            className="w-full flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between py-2 text-sm hover:bg-slate-50 rounded-lg px-2 -mx-2 min-w-0"
                            onClick={() => {
                              setSelectedInvoiceId(row.id);
                              setDetailOpen(true);
                            }}
                          >
                            <span className="text-slate-800 truncate min-w-0">{row.invoiceNumber} · {row.customerName}</span>
                            <span className="flex items-center gap-2 shrink-0">
                              <Badge variant="danger">{row.daysPastDue}d</Badge>
                              <span className="font-semibold text-red-700 tabular-nums">{formatCurrency(row.balance)}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </Card>

            <Card
              title="Outstanding invoices"
              action={
                <Button size="sm" variant="ghost" onClick={() => setActiveTab(1)}>
                  View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              }
            >
              {unpaidInvoices.length === 0 ? (
                <EmptyState title="All caught up" description="No outstanding invoices in the current view." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {unpaidInvoices.slice(0, 6).map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      className="w-full flex items-start justify-between gap-3 py-3 text-left hover:bg-slate-50/80 px-2 -mx-2 rounded-lg transition-colors min-w-0"
                      onClick={() => openInvoiceDetail(inv)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-slate-900 truncate">{inv.invoiceNumber}</p>
                        <p className="text-xs text-slate-500 truncate">
                          {inv.customer?.name || inv.supplier?.name || '—'}
                          {inv.dueDate && ` · Due ${formatDate(inv.dueDate)}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-sm text-amber-700 tabular-nums">{formatCurrency(invoiceBalance(inv))}</p>
                        <Badge variant={getStatusBadge(inv.status)}>{inv.status}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Invoices */}
      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap items-end gap-3">
            <form
              className="flex-1 min-w-[200px] max-w-sm"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}
            >
              <Input placeholder="Search invoice # or party…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </form>
            <Select options={TYPE_FILTER} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-36" />
            <Select options={STATUS_FILTER} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-36" />
            <Button variant="secondary" size="sm" onClick={() => { setSearchInput(''); setSearch(''); setType(''); setStatus(''); setPage(1); }}>
              Clear
            </Button>
          </div>
          {invError && (
            <div className="px-4 pt-4">
              <Alert variant="error">
                Failed to load invoices. <button type="button" className="underline" onClick={() => refetchInvoices()}>Retry</button>
              </Alert>
            </div>
          )}
          {(invoices?.data?.length || 0) === 0 && !invLoading ? (
            <div className="p-6">
              <EmptyState
                title="No invoices found"
                description="Create a sales or purchase invoice to get started."
                action={
                  canCreate ? (
                    <Button onClick={() => setInvoiceModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Invoice
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={invoiceColumns}
              data={(invoices?.data as Invoice[]) || []}
              loading={invLoading}
              responsive
              onRowClick={(row) => openInvoiceDetail(row as unknown as Invoice)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={invoices?.pagination} page={page} onPageChange={setPage} label="invoices" />
          </div>
        </DataPanel>
      )}

      {/* Payments */}
      {activeTab === 2 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap items-end gap-3">
            <Input
              placeholder="Search payments…"
              value={paySearch}
              onChange={(e) => { setPaySearch(e.target.value); setPayPage(1); }}
              className="min-w-[200px] sm:max-w-xs"
            />
            <Select
              label="Paid period"
              options={PAY_PERIOD_OPTIONS}
              value={payPeriod}
              onChange={(e) => {
                const v = e.target.value;
                setPayPeriod(v);
                if (v !== 'custom') {
                  setPayFrom('');
                  setPayTo('');
                }
                setPayPage(1);
              }}
              className="w-48"
            />
            {payPeriod === 'custom' && (
              <>
                <Input
                  label="From"
                  type="date"
                  value={payFrom}
                  onChange={(e) => {
                    setPayFrom(e.target.value);
                    setPayPage(1);
                  }}
                  className="w-40"
                />
                <Input
                  label="To"
                  type="date"
                  value={payTo}
                  onChange={(e) => {
                    setPayTo(e.target.value);
                    setPayPage(1);
                  }}
                  className="w-40"
                />
              </>
            )}
            <Select
              label="Method"
              options={PAY_METHOD_OPTIONS}
              value={payMethod}
              onChange={(e) => { setPayMethod(e.target.value); setPayPage(1); }}
              className="w-40"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPaySearch('');
                setPayPeriod('this_week_taken_and_paid');
                setPayMethod('');
                setPayFrom('');
                setPayTo('');
                setPayPage(1);
              }}
            >
              Reset
            </Button>
          </div>
          <p className="px-4 pt-2 text-xs text-slate-500">
            “Taken & paid this week/month” = invoice issued and paid in that same period.
            “Paid in week/month invoice was taken” = payment landed in the invoice’s own week or month (any period).
            “Paid this week (any invoice)” also includes older invoices paid this week.
          </p>
          {(payments?.data?.length || 0) === 0 && !payLoading ? (
            <div className="p-6">
              <EmptyState
                title="No payments in this period"
                description="Try another paid period, or record a payment against an open invoice."
                action={
                  canCreate ? (
                    <Button onClick={() => openPaymentModal()}>
                      <CreditCard className="h-4 w-4 mr-2" />
                      Record Payment
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={paymentColumns} data={payments?.data || []} loading={payLoading} responsive embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={payments?.pagination} page={payPage} onPageChange={setPayPage} label="payments" />
          </div>
        </DataPanel>
      )}

      {/* Journals */}
      {activeTab === 3 && (
        <DataPanel>
          <div className="p-4 pb-0 max-w-sm">
            <Input placeholder="Search journals…" value={journalSearch} onChange={(e) => { setJournalSearch(e.target.value); setJournalPage(1); }} />
          </div>
          {(journalEntries?.data?.length || 0) === 0 && !journalLoading ? (
            <div className="p-6">
              <EmptyState
                title="No journal entries"
                description="Post manual adjustments and accruals to the general ledger."
                action={
                  canCreate ? (
                    <Button onClick={() => setJournalModalOpen(true)}>
                      <BookOpen className="h-4 w-4 mr-2" />
                      Journal Entry
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={[
                { key: 'entryNumber', label: 'Entry #' },
                { key: 'date', label: 'Date', render: (v: unknown) => formatDate(v as string) },
                { key: 'description', label: 'Description' },
                {
                  key: 'invoice',
                  label: 'Invoice',
                  render: (_: unknown, row: Record<string, unknown>) => {
                    const inv = row.invoice as { invoiceNumber?: string } | null | undefined;
                    return inv?.invoiceNumber || '—';
                  },
                },
                { key: 'reference', label: 'Reference', render: (v: unknown) => (v as string) || '—' },
                { key: 'lines', label: 'Lines', render: (v: unknown) => (v as unknown[])?.length || 0 },
                { key: 'isPosted', label: 'Status', render: (v: unknown) => <Badge variant={v ? 'success' : 'warning'}>{v ? 'Posted' : 'Draft'}</Badge> },
              ]}
              data={journalEntries?.data || []}
              loading={journalLoading}
              responsive
              onRowClick={(row) => { setSelectedJournal(row); setJournalDetailOpen(true); }}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={journalEntries?.pagination} page={journalPage} onPageChange={setJournalPage} label="entries" />
          </div>
        </DataPanel>
      )}

      {/* Accounts */}
      {activeTab === 4 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(accountsByType).map(([typeKey, accs]) => (
            <Card key={typeKey} title={ACCOUNT_TYPE_LABELS[typeKey] || typeKey} padding>
              <div className="space-y-0">
                {(accs || []).map((acc) => (
                  <div key={acc!.id} className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0 text-sm">
                    <div>
                      <span className="font-mono text-xs text-slate-400 mr-2">{acc!.code}</span>
                      <span className="text-slate-800">{acc!.name}</span>
                    </div>
                    <span className={`font-semibold tabular-nums ${Number(acc!.balance) < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                      {formatCurrency(Number(acc!.balance))}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {!accounts?.length && (
            <EmptyState title="No accounts" description="Chart of accounts is missing for this company. Contact your administrator or re-run tenant setup." />
          )}
        </div>
      )}

      {/* Reconciliation */}
      {activeTab === 5 && reconciliation && (
        <>
          <StatGrid>
            <StatCard title="Bank Balance (GL)" value={formatCurrency(reconciliation.bankBalance)} icon={<Landmark className="h-5 w-5 text-white" />} color="from-slate-600 to-slate-700" />
            <StatCard title="Statement Balance" value={formatCurrency(reconciliation.statementBalance ?? 0)} icon={<Landmark className="h-5 w-5 text-white" />} color="from-blue-600 to-indigo-700" />
            <StatCard title="Variance" value={formatCurrency(reconciliation.variance ?? 0)} icon={<CircleDollarSign className="h-5 w-5 text-white" />} color="from-rose-500 to-red-600" />
            <StatCard title="Unreconciled" value={formatCurrency(reconciliation.unreconciledTotal)} icon={<CircleDollarSign className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          </StatGrid>
          {canUpdate && (
            <div className="mb-4 p-4 bg-white rounded-xl border border-slate-200 space-y-3">
              <p className="text-sm font-medium text-slate-700">
                Import bank statement (CSV or PDF: date, description, reference, amount)
              </p>
              {(importStatementMutation.isError || autoMatchMutation.isError) && (
                <Alert variant="error">
                  {getApiErrorMessage(importStatementMutation.error || autoMatchMutation.error)}
                </Alert>
              )}
              <textarea
                className="w-full min-h-[80px] text-sm border border-slate-200 rounded-lg p-2 font-mono"
                placeholder="date,description,reference,amount&#10;2026-07-01,Deposit,REF001,1500"
                id="bank-csv-import"
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                  <input
                    type="file"
                    accept=".pdf,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const base64 = (reader.result as string).split(',')[1];
                        if (base64) importStatementMutation.mutate({ pdfBase64: base64 });
                      };
                      reader.readAsDataURL(file);
                      e.target.value = '';
                    }}
                  />
                  Import PDF
                </label>
                <Button
                  size="sm"
                  loading={importStatementMutation.isPending}
                  onClick={() => {
                    const el = document.getElementById('bank-csv-import') as HTMLTextAreaElement | null;
                    if (el?.value.trim()) importStatementMutation.mutate({ csvText: el.value.trim() });
                  }}
                >
                  Import CSV
                </Button>
                {reconciliation.latestStatement?.id && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={autoMatchMutation.isPending}
                    onClick={() => autoMatchMutation.mutate(reconciliation.latestStatement.id)}
                  >
                    Auto-match payments
                  </Button>
                )}
              </div>
            </div>
          )}
          {(reconciliation.unreconciled?.length || 0) === 0 ? (
            <EmptyState title="Fully reconciled" description="All payments match bank records." />
          ) : (
            <Table
              columns={[
                { key: 'paymentNumber', label: 'Payment #' },
                { key: 'method', label: 'Method', render: (v: unknown) => (v as string)?.replace(/_/g, ' ') },
                { key: 'paymentDate', label: 'Date', render: (v: unknown) => formatDate(v as string) },
                { key: 'amount', label: 'Amount', render: (v: unknown) => formatCurrency(v as number) },
                { key: 'reference', label: 'Reference', render: (v: unknown) => (v as string) || '—' },
                {
                  key: 'actions',
                  label: '',
                  render: (_: unknown, row: Record<string, unknown>) =>
                    canUpdate ? (
                      <Button size="sm" loading={reconcileMutation.isPending} onClick={() => reconcileMutation.mutate(row.id as string)}>
                        Mark reconciled
                      </Button>
                    ) : null,
                },
              ]}
              data={reconciliation.unreconciled || []}
            />
          )}
        </>
      )}

      {/* Modals */}
      <Modal open={invoiceModalOpen} onClose={() => setInvoiceModalOpen(false)} title="Create Invoice" size="xl">
        <InvoiceForm onSuccess={() => setInvoiceModalOpen(false)} onCancel={() => setInvoiceModalOpen(false)} />
      </Modal>

      <Modal
        open={paymentModalOpen}
        onClose={() => { setPaymentModalOpen(false); setPaymentForInvoiceId(undefined); }}
        title="Record Payment"
        size="md"
      >
        <PaymentForm
          invoiceId={paymentForInvoiceId}
          onSuccess={() => { setPaymentModalOpen(false); setPaymentForInvoiceId(undefined); }}
          onCancel={() => { setPaymentModalOpen(false); setPaymentForInvoiceId(undefined); }}
        />
      </Modal>

      <Modal open={journalModalOpen} onClose={() => setJournalModalOpen(false)} title="Post Journal Entry" size="xl">
        <JournalEntryForm onSuccess={() => { setJournalModalOpen(false); setActiveTab(3); }} onCancel={() => setJournalModalOpen(false)} />
      </Modal>

      {/* Invoice detail */}
      <Modal
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedInvoiceId(null); }}
        title={invoiceDetail ? `Invoice ${invoiceDetail.invoiceNumber}` : 'Invoice Details'}
        size="xl"
      >
        {detailLoading ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading invoice…</div>
        ) : invoiceDetail ? (
          <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant={invoiceDetail.type === 'SALES' ? 'success' : 'info'}>{invoiceDetail.type}</Badge>
                  <Badge variant={getStatusBadge(invoiceDetail.status)}>{invoiceDetail.status}</Badge>
                  {isOverdue(invoiceDetail) && <Badge variant="danger">Overdue</Badge>}
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {invoiceDetail.customer?.name || invoiceDetail.supplier?.name || '—'}
                </p>
                <p className="text-sm text-slate-500">
                  Sales Person:{' '}
                  {(() => {
                    const person =
                      invoiceDetail.salesOrder?.salesPerson ||
                      invoiceDetail.salesOrder?.createdBy;
                    return person
                      ? `${person.firstName} ${person.lastName}`.trim()
                      : '—';
                  })()}
                </p>
                <p className="text-sm text-slate-500">
                  Issued {formatDate(invoiceDetail.invoiceDate)}
                  {invoiceDetail.dueDate && ` · Due ${formatDate(invoiceDetail.dueDate)}`}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  LPO / Customer PO:{' '}
                  <span className="font-medium text-slate-900">
                    {invoiceDetail.customerPoNumber ||
                      invoiceDetail.salesOrder?.customerPoNumber ||
                      '—'}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Balance due</p>
                <p className="text-2xl font-bold text-slate-900">{formatCurrency(invoiceBalance(invoiceDetail))}</p>
              </div>
            </div>

            <Card title="Line items" padding={false}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-2 font-medium">Description</th>
                      <th className="px-4 py-2 font-medium text-right">Qty</th>
                      <th className="px-4 py-2 font-medium text-right">Unit price</th>
                      <th className="px-4 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invoiceDetail.items || []).map((item) => (
                      <tr key={item.id} className="border-t border-slate-100">
                        <td className="px-4 py-2.5">{item.description}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(item.unitPrice)}</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums">{formatCurrency(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card title="Totals" padding>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{formatCurrency(Number(invoiceDetail.subtotal || 0))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">VAT</span><span>{formatCurrency(Number(invoiceDetail.taxAmount || 0))}</span></div>
                  <div className="flex justify-between font-bold pt-2 border-t"><span>Total</span><span>{formatCurrency(Number(invoiceDetail.totalAmount))}</span></div>
                  <div className="flex justify-between text-emerald-700"><span>Paid</span><span>{formatCurrency(Number(invoiceDetail.paidAmount))}</span></div>
                </div>
              </Card>

              <Card title="Payment history" padding>
                {(invoiceDetail.payments || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No payments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {invoiceDetail.payments!.map((p) => (
                      <div key={p.id} className="flex justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                        <div>
                          <p className="font-medium">{p.paymentNumber}</p>
                          <p className="text-xs text-slate-500">{formatDate(p.paymentDate)} · {(p.method || '').replace(/_/g, ' ')}</p>
                        </div>
                        <span className="font-semibold text-emerald-700">{formatCurrency(Number(p.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {invoiceDetail.notes && (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Notes: </span>{invoiceDetail.notes}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-4 border-t">
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === `${invoiceDetail.id}-pdf`}
                onClick={() => handleExport(invoiceDetail.id, 'pdf', invoiceDetail.invoiceNumber)}
              >
                <FileText className="h-4 w-4 mr-1.5" /> PDF
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={downloading === `${invoiceDetail.id}-excel`}
                onClick={() => handleExport(invoiceDetail.id, 'excel', invoiceDetail.invoiceNumber)}
              >
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              {canCreate && invoiceBalance(invoiceDetail) > 0 && (
                <Button size="sm" onClick={() => { setDetailOpen(false); openPaymentModal(invoiceDetail.id); }}>
                  <CreditCard className="h-4 w-4 mr-1.5" /> Record Payment
                </Button>
              )}
              {canUpdate && invoiceDetail.type === 'SALES' && invoiceDetail.fiscalStatus !== 'SUBMITTED' && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={submitEtimsMutation.isPending}
                  onClick={() => submitEtimsMutation.mutate(invoiceDetail.id)}
                >
                  Submit to eTIMS
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Journal detail */}
      <Modal open={journalDetailOpen} onClose={() => { setJournalDetailOpen(false); setSelectedJournal(null); }} title="Journal Entry" size="lg">
        {selectedJournal && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div><p className="text-slate-500">Entry #</p><p className="font-semibold">{selectedJournal.entryNumber as string}</p></div>
              <div><p className="text-slate-500">Date</p><p className="font-semibold">{formatDate(selectedJournal.date as string)}</p></div>
              <div>
                <p className="text-slate-500">Invoice</p>
                <p className="font-semibold">
                  {(selectedJournal.invoice as { invoiceNumber?: string } | null | undefined)?.invoiceNumber || '—'}
                </p>
              </div>
              <div><p className="text-slate-500">Reference</p><p className="font-semibold">{(selectedJournal.reference as string) || '—'}</p></div>
              <div className="sm:col-span-2"><p className="text-slate-500">Description</p><p>{(selectedJournal.description as string) || '—'}</p></div>
            </div>
            <Card title="Lines" padding={false}>
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[20rem]">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-left">
                    <th className="px-4 py-2">Account</th>
                    <th className="px-4 py-2 text-right">Debit</th>
                    <th className="px-4 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {((selectedJournal.lines as { account: { code: string; name: string }; debit: number; credit: number }[]) || []).map((line, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2">{line.account.code} · {line.account.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Number(line.debit) > 0 ? formatCurrency(line.debit) : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Number(line.credit) > 0 ? formatCurrency(line.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </Card>
          </div>
        )}
      </Modal>
    </div>
  );
}
