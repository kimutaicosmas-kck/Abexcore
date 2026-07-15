import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  ArcElement,
  Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import {
  DollarSign,
  ShoppingCart,
  Factory,
  Package,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Users,
  HeartHandshake,
  ClipboardList,
  Wallet,
  Bell,
  Plus,
  Truck,
  FileText,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import {
  PageHeader,
  StatCard,
  Card,
  Badge,
  Button,
  Select,
  Alert,
  EmptyState,
  QuickActionCard,
  QuickActionGrid,
  DataPanel,
  formatCurrency,
  getStatusBadge,
  LoadingSpinner,
  PageToolbar,
} from '../components/ui';
import { DashboardCharts, DashboardKPIs } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

const tabs = ['Overview', 'Analytics', 'Alerts'];

const chartDefaults = {
  responsive: true,
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter' } } },
  },
};

const PRODUCTION_COLORS: Record<string, string> = {
  PLANNED: '#6366f1',
  SCHEDULED: '#8b5cf6',
  IN_PROGRESS: '#f97316',
  ON_HOLD: '#eab308',
  COMPLETED: '#22c55e',
  CANCELLED: '#94a3b8',
};

const CHART_DAYS_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const MODULE_SNAPSHOT_COLORS: Record<string, string> = {
  hr: 'from-violet-500 to-purple-600',
  crm: 'from-pink-500 to-rose-600',
  procurement: 'from-blue-500 to-indigo-600',
  finance: 'from-emerald-500 to-teal-600',
};

function formatLastUpdated(iso?: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-KE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [chartDays, setChartDays] = useState('30');

  const goToTab = (index: number) => setActiveTab(index);

  const {
    data: kpis,
    isLoading: kpisLoading,
    isError: kpisError,
    refetch: refetchKpis,
    isFetching: kpisFetching,
  } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => dashboardApi.getKPIs().then((r) => r.data.data as DashboardKPIs),
  });

  const {
    data: charts,
    isLoading: chartsLoading,
    isError: chartsError,
    refetch: refetchCharts,
    isFetching: chartsFetching,
  } = useQuery({
    queryKey: ['dashboard-charts', chartDays],
    queryFn: () => dashboardApi.getCharts(Number(chartDays)).then((r) => r.data.data as DashboardCharts),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const isRefreshing = kpisFetching || chartsFetching;
  const pendingTotal = kpis?.pendingActions?.reduce((s, a) => s + a.count, 0) ?? 0;

  const handleRefresh = () => {
    refetchKpis();
    refetchCharts();
    queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-charts', chartDays] });
  };

  if (kpisLoading) {
    return (
      <div className="space-y-1">
        <PageHeader title="Dashboard" subtitle="Business overview, analytics, and items needing attention" />
        <DataPanel>
          <LoadingSpinner className="h-64 py-16" size="md" />
        </DataPanel>
      </div>
    );
  }

  if (kpisError || !kpis) {
    return (
      <div className="space-y-1">
        <PageHeader title="Dashboard" subtitle="Business overview, analytics, and items needing attention" />
        <Alert variant="error">
          Failed to load dashboard data.{' '}
          <button type="button" onClick={() => refetchKpis()} className="underline font-medium">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const salesTotal = charts?.salesTrend?.reduce((s, d) => s + d.amount, 0) || 0;
  const hasSalesTrend = salesTotal > 0;
  const hasCategories = (charts?.productCategories?.length || 0) > 0;
  const hasProductionStatus = (kpis.productionStatus?.length || 0) > 0;
  const hasTopSellers = (kpis.topSellingFilters?.length || 0) > 0;
  const snapshots = kpis.moduleSnapshots;

  const salesChartData = {
    labels: charts?.salesTrend?.map((d) => d.date.slice(5)) || [],
    datasets: [
      {
        label: 'Sales (KES)',
        data: charts?.salesTrend?.map((d) => d.amount) || [],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ],
  };

  const categoryData = {
    labels: charts?.productCategories?.map((c) => c.category.replace(/_/g, ' ')) || [],
    datasets: [
      {
        data: charts?.productCategories?.map((c) => c.count) || [],
        backgroundColor: ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4', '#4f46e5', '#db2777'],
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  };

  const productionChartData = {
    labels: kpis.productionStatus?.map((p) => p.status.replace(/_/g, ' ')) || [],
    datasets: [
      {
        label: 'Orders',
        data: kpis.productionStatus?.map((p) => p.count) || [],
        backgroundColor: kpis.productionStatus?.map((p) => PRODUCTION_COLORS[p.status] || '#6366f1') || [],
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };

  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      {activeTab === 1 && (
        <Select
          options={CHART_DAYS_OPTIONS}
          value={chartDays}
          onChange={(e) => setChartDays(e.target.value)}
          className="w-36"
        />
      )}
      {kpis.lastUpdated && activeTab !== 2 && (
        <span className="hidden sm:inline text-xs text-slate-500">
          Updated {formatLastUpdated(kpis.lastUpdated)}
        </span>
      )}
      <Button variant="secondary" size="sm" onClick={handleRefresh} loading={isRefreshing}>
        <RefreshCw className="h-4 w-4 mr-1.5" />
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="space-y-1">
      <PageHeader
        title="Dashboard"
        subtitle="Business overview, analytics, and items needing attention"
        action={
          pendingTotal > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(2)}>
              <Bell className="h-4 w-4 mr-1.5 text-amber-500" />
              {pendingTotal} pending
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <StatCard
          title="Sales today"
          value={formatCurrency(kpis.salesToday)}
          icon={<DollarSign className="h-5 w-5 text-white" />}
          color="from-emerald-500 to-teal-600"
        />
        <StatCard
          title="Monthly revenue"
          value={formatCurrency(kpis.monthlyRevenue)}
          icon={<TrendingUp className="h-5 w-5 text-white" />}
          color="from-primary-500 to-indigo-600"
        />
        <StatCard
          title="Production orders"
          value={kpis.productionOrders}
          icon={<Factory className="h-5 w-5 text-white" />}
          color="from-violet-500 to-purple-600"
        />
        <StatCard
          title="Inventory value"
          value={formatCurrency(kpis.inventoryValue)}
          icon={<Package className="h-5 w-5 text-white" />}
          color="from-orange-500 to-amber-600"
        />
        <StatCard
          title="Low stock"
          value={kpis.rawMaterialsLow}
          icon={<AlertTriangle className="h-5 w-5 text-white" />}
          color="from-red-500 to-rose-600"
        />
      </div>

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <div className="space-y-4">
          <QuickActionGrid>
            <QuickActionCard
              label="New sales order"
              desc="Create a customer order"
              icon={Plus}
              color="bg-emerald-50 text-emerald-600 border-emerald-100"
              onClick={() => navigate('/sales')}
            />
            <QuickActionCard
              label="Production schedule"
              desc="View and manage manufacturing"
              icon={Factory}
              color="bg-orange-50 text-orange-600 border-orange-100"
              onClick={() => navigate('/production')}
            />
            <QuickActionCard
              label="Inventory & stock"
              desc="Monitor materials and warehouses"
              icon={Package}
              color="bg-violet-50 text-violet-600 border-violet-100"
              onClick={() => navigate('/inventory')}
            />
          </QuickActionGrid>

          {snapshots && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {[
                {
                  key: 'hr',
                  path: '/hr',
                  icon: Users,
                  label: 'HR',
                  headline: `${snapshots.hr.attendanceToday} present`,
                  sub: `${snapshots.hr.pendingLeave} leave pending · ${snapshots.hr.activeEmployees} staff`,
                },
                {
                  key: 'crm',
                  path: '/customers',
                  icon: HeartHandshake,
                  label: 'CRM',
                  headline: `${snapshots.crm.openComplaints} complaints`,
                  sub: `${snapshots.crm.openOpportunities} deals · ${formatCurrency(snapshots.crm.pipelineValue)} pipeline`,
                },
                {
                  key: 'procurement',
                  path: '/procurement',
                  icon: ClipboardList,
                  label: 'Procurement',
                  headline: `${snapshots.procurement.pendingRequisitions} requisitions`,
                  sub: `${snapshots.procurement.openRfqs} RFQs · ${snapshots.procurement.activePurchaseOrders} active POs`,
                },
                {
                  key: 'finance',
                  path: '/finance',
                  icon: Wallet,
                  label: 'Finance',
                  headline: `${snapshots.finance.overdueInvoices} overdue`,
                  sub: `${formatCurrency(snapshots.finance.accountsReceivable)} receivable · ${formatCurrency(snapshots.finance.monthlyProfit)} profit`,
                },
              ].map((mod) => (
                <Link key={mod.key} to={mod.path} className="block group">
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow h-full">
                    <div className={`h-1.5 bg-gradient-to-r ${MODULE_SNAPSHOT_COLORS[mod.key]}`} />
                    <div className="p-4 flex items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${MODULE_SNAPSHOT_COLORS[mod.key]} text-white shadow-sm`}>
                        <mod.icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{mod.label}</p>
                        <p className="text-base font-bold text-slate-900 mt-0.5">{mod.headline}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{mod.sub}</p>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Recent orders"
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/sales')}>
                  View all
                </Button>
              }
              padding={false}
            >
              {kpis.recentOrders?.length ? (
                <ul className="divide-y divide-slate-100">
                  {kpis.recentOrders.slice(0, 6).map((order) => (
                    <li key={order.id}>
                      <Link
                        to="/sales"
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                          <ShoppingCart className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">{order.orderNumber}</p>
                          <p className="text-xs text-slate-500">{order.customer}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold tabular-nums">{formatCurrency(order.total)}</p>
                          <Badge variant={getStatusBadge(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-6">
                  <EmptyState
                    title="No recent orders"
                    description="Sales orders will appear here once created."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => navigate('/sales')}>
                        Go to Sales
                      </Button>
                    }
                  />
                </div>
              )}
            </Card>

            <Card title="Financial snapshot" padding={false}>
              <div className="p-4 space-y-3">
                <div className="flex justify-between items-center rounded-xl bg-emerald-50/80 px-4 py-3 ring-1 ring-emerald-100">
                  <span className="text-sm text-emerald-800">Monthly revenue</span>
                  <span className="font-bold text-emerald-700">{formatCurrency(kpis.monthlyRevenue)}</span>
                </div>
                <div className="flex justify-between items-center rounded-xl bg-red-50/80 px-4 py-3 ring-1 ring-red-100">
                  <span className="text-sm text-red-800">Monthly expenses</span>
                  <span className="font-bold text-red-700">{formatCurrency(kpis.monthlyExpenses)}</span>
                </div>
                <div className="rounded-xl bg-primary-50 px-4 py-4 ring-1 ring-primary-100">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-900 font-semibold">Net profit</span>
                    <span className="font-bold text-xl text-primary-700">{formatCurrency(kpis.monthlyProfit)}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Sales minus purchases (month to date)</p>
                </div>
              </div>
              <div className="px-4 pb-4 grid grid-cols-2 gap-2">
                <Link to="/procurement" className="block">
                  <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-900">{kpis.purchaseOrders}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Purchase orders</p>
                  </div>
                </Link>
                <Link to="/production" className="block">
                  <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-900">{kpis.ordersAwaitingProduction}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Awaiting production</p>
                  </div>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title={`Sales trend (${chartDays} days)`} className="lg:col-span-2">
              {chartsLoading ? (
                <LoadingSpinner className="h-52" size="sm" />
              ) : chartsError ? (
                <Alert variant="error">
                  Failed to load chart.{' '}
                  <button type="button" onClick={() => refetchCharts()} className="underline">
                    Retry
                  </button>
                </Alert>
              ) : hasSalesTrend ? (
                <Line
                  data={salesChartData}
                  options={{
                    ...chartDefaults,
                    plugins: { ...chartDefaults.plugins, legend: { display: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 10 } },
                      y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { color: '#64748b' } },
                    },
                  }}
                />
              ) : (
                <EmptyState title="No sales in this period" description="Sales invoices will appear here once recorded." />
              )}
            </Card>

            <Card title="Sales mix by category">
              {chartsLoading ? (
                <LoadingSpinner className="h-52" size="sm" />
              ) : chartsError ? (
                <Alert variant="error">Chart unavailable</Alert>
              ) : hasCategories ? (
                <div className="h-52 flex items-center justify-center">
                  <Doughnut
                    data={categoryData}
                    options={{
                      ...chartDefaults,
                      maintainAspectRatio: false,
                      plugins: { ...chartDefaults.plugins, legend: { position: 'bottom' } },
                    }}
                  />
                </div>
              ) : (
                <EmptyState title="No products yet" description="Add products to see category breakdown." />
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Production status">
              {hasProductionStatus ? (
                <div className="h-48">
                  <Bar
                    data={productionChartData}
                    options={{
                      ...chartDefaults,
                      indexAxis: 'y' as const,
                      plugins: { ...chartDefaults.plugins, legend: { display: false } },
                      scales: {
                        x: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { stepSize: 1 } },
                        y: { grid: { display: false } },
                      },
                    }}
                  />
                </div>
              ) : (
                <EmptyState
                  title="No production orders"
                  description="Production orders will show status breakdown here."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => navigate('/production')}>
                      Go to Production
                    </Button>
                  }
                />
              )}
            </Card>

            <Card title="Top delivered products" padding={false}>
              {hasTopSellers ? (
                <ul className="divide-y divide-slate-100">
                  {kpis.topSellingFilters.map((product, idx) => (
                    <li key={product.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-xs font-bold text-primary-700">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{product.name}</p>
                        <p className="text-xs text-slate-500">{product.sku}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-700 shrink-0">
                        {product.quantitySold.toLocaleString()} sold
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="p-6">
                  <EmptyState
                    title="No sales data yet"
                    description="Top sellers appear after orders are fulfilled."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => navigate('/sales')}>
                        Create sales order
                      </Button>
                    }
                  />
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 2 && (
        <div className="space-y-4">
          {kpis.pendingActions && kpis.pendingActions.length > 0 ? (
            <Card
              title="Pending actions"
              action={
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <Bell className="h-3.5 w-3.5" />
                  {pendingTotal} items need attention
                </span>
              }
              padding={false}
            >
              <ul className="divide-y divide-slate-100">
                {kpis.pendingActions.map((action) => (
                  <li key={action.type}>
                    <Link
                      to={action.path}
                      className="flex items-center justify-between px-4 py-3 hover:bg-amber-50/40 transition-colors"
                    >
                      <span className="text-sm font-medium text-slate-800">{action.label}</span>
                      <Badge variant="warning">{action.count}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <DataPanel>
              <div className="p-6">
                <EmptyState title="All caught up" description="No pending actions require your attention right now." />
              </div>
            </DataPanel>
          )}

          {kpis.lowStockItems && kpis.lowStockItems.length > 0 ? (
            <Card
              title="Low stock materials"
              action={
                <Button variant="ghost" size="sm" onClick={() => navigate('/inventory')}>
                  View inventory
                </Button>
              }
              padding={false}
            >
              <ul className="divide-y divide-slate-100">
                {kpis.lowStockItems.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/inventory"
                      className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/30 transition-colors"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.code}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-red-600 tabular-nums">{item.currentStock}</p>
                        <p className="text-xs text-red-500">min {item.minLevel}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            <Card title="Low stock materials" padding={false}>
              <div className="p-6">
                <EmptyState title="Stock levels healthy" description="All materials are above minimum thresholds." />
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <QuickActionCard
              label="Review finance"
              desc="Invoices, payments, overdue items"
              icon={Wallet}
              color="bg-emerald-50 text-emerald-600 border-emerald-100"
              onClick={() => navigate('/finance')}
            />
            <QuickActionCard
              label="Check procurement"
              desc="Requisitions, POs, goods receipts"
              icon={Truck}
              color="bg-blue-50 text-blue-600 border-blue-100"
              onClick={() => navigate('/procurement')}
            />
            <QuickActionCard
              label="View reports"
              desc="Exports and financial statements"
              icon={FileText}
              color="bg-violet-50 text-violet-600 border-violet-100"
              onClick={() => navigate('/reports')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
