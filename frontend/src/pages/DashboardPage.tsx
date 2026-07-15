import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  ChevronRight,
  Bell,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import {
  StatCard,
  Card,
  Badge,
  Button,
  Select,
  Alert,
  EmptyState,
  formatCurrency,
  getStatusBadge,
  LoadingSpinner,
} from '../components/ui';
import { DashboardCharts, DashboardKPIs } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement, Filler);

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
  const queryClient = useQueryClient();
  const [chartDays, setChartDays] = useState('30');

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
  });

  const isRefreshing = kpisFetching || chartsFetching;

  const handleRefresh = () => {
    refetchKpis();
    refetchCharts();
    queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard-charts', chartDays] });
  };

  if (kpisLoading) {
    return <LoadingSpinner className="h-64" size="md" />;
  }

  if (kpisError) {
    return (
      <Alert variant="error">
        Failed to load dashboard data.{' '}
        <button type="button" onClick={() => refetchKpis()} className="underline font-medium">
          Retry
        </button>
      </Alert>
    );
  }

  const salesTotal = charts?.salesTrend?.reduce((s, d) => s + d.amount, 0) || 0;
  const hasSalesTrend = salesTotal > 0;
  const hasCategories = (charts?.productCategories?.length || 0) > 0;
  const hasProductionStatus = (kpis?.productionStatus?.length || 0) > 0;
  const hasTopSellers = (kpis?.topSellingFilters?.length || 0) > 0;

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
    labels: kpis?.productionStatus?.map((p) => p.status.replace(/_/g, ' ')) || [],
    datasets: [
      {
        label: 'Orders',
        data: kpis?.productionStatus?.map((p) => p.count) || [],
        backgroundColor: kpis?.productionStatus?.map((p) => PRODUCTION_COLORS[p.status] || '#6366f1') || [],
        borderRadius: 6,
        borderSkipped: false,
      },
    ],
  };

  const snapshots = kpis?.moduleSnapshots;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Select
            options={CHART_DAYS_OPTIONS}
            value={chartDays}
            onChange={(e) => setChartDays(e.target.value)}
            className="w-40"
          />
          {kpis?.lastUpdated && (
            <span className="text-xs text-slate-500">Updated {formatLastUpdated(kpis.lastUpdated)}</span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={handleRefresh} loading={isRefreshing}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatCard
          title="Sales Today"
          value={formatCurrency(kpis?.salesToday || 0)}
          icon={<DollarSign className="h-5 w-5 text-white" />}
          color="from-emerald-500 to-teal-600"
        />
        <StatCard
          title="Monthly Revenue"
          value={formatCurrency(kpis?.monthlyRevenue || 0)}
          icon={<TrendingUp className="h-5 w-5 text-white" />}
          color="from-primary-500 to-indigo-600"
        />
        <StatCard
          title="Production Orders"
          value={kpis?.productionOrders || 0}
          icon={<Factory className="h-5 w-5 text-white" />}
          color="from-violet-500 to-purple-600"
        />
        <Link to="/inventory" className="block">
          <StatCard
            title="Inventory Value"
            value={formatCurrency(kpis?.inventoryValue || 0)}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-orange-500 to-amber-600"
          />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Link to="/procurement" className="block">
          <StatCard
            title="Purchase Orders"
            value={kpis?.purchaseOrders || 0}
            icon={<ShoppingCart className="h-5 w-5 text-white" />}
            color="from-indigo-500 to-blue-600"
          />
        </Link>
        <Link to="/production" className="block">
          <StatCard
            title="Orders Awaiting Production"
            value={kpis?.ordersAwaitingProduction || 0}
            icon={<Factory className="h-5 w-5 text-white" />}
            color="from-amber-500 to-orange-600"
          />
        </Link>
        <StatCard
          title="Finished Goods"
          value={kpis?.finishedGoods?.toLocaleString() || 0}
          icon={<Package className="h-5 w-5 text-white" />}
          color="from-cyan-500 to-sky-600"
        />
        <Link to="/inventory" className="block">
          <StatCard
            title="Low Stock Alerts"
            value={kpis?.rawMaterialsLow || 0}
            icon={<AlertTriangle className="h-5 w-5 text-white" />}
            color="from-red-500 to-rose-600"
          />
        </Link>
      </div>

      {snapshots && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Link to="/hr">
            <Card className="hover:ring-2 hover:ring-primary-100 transition-all cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center">
                  <Users className="h-4 w-4 text-violet-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">HR</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">{snapshots.hr.attendanceToday} present</p>
                  <p className="text-xs text-slate-500">{snapshots.hr.pendingLeave} leave pending · {snapshots.hr.activeEmployees} staff</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            </Card>
          </Link>
          <Link to="/customers">
            <Card className="hover:ring-2 hover:ring-primary-100 transition-all cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-pink-100 flex items-center justify-center">
                  <HeartHandshake className="h-4 w-4 text-pink-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">CRM</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">{snapshots.crm.openComplaints} complaints</p>
                  <p className="text-xs text-slate-500">{snapshots.crm.openOpportunities} deals · {formatCurrency(snapshots.crm.pipelineValue)} pipeline</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            </Card>
          </Link>
          <Link to="/procurement">
            <Card className="hover:ring-2 hover:ring-primary-100 transition-all cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-blue-100 flex items-center justify-center">
                  <ClipboardList className="h-4 w-4 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Procurement</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">{snapshots.procurement.pendingRequisitions} requisitions</p>
                  <p className="text-xs text-slate-500">{snapshots.procurement.openRfqs} RFQs · {snapshots.procurement.activePurchaseOrders} active POs</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            </Card>
          </Link>
          <Link to="/finance">
            <Card className="hover:ring-2 hover:ring-primary-100 transition-all cursor-pointer h-full">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Finance</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">{snapshots.finance.overdueInvoices} overdue</p>
                  <p className="text-xs text-slate-500">{formatCurrency(snapshots.finance.accountsReceivable)} receivable · {formatCurrency(snapshots.finance.monthlyProfit)} profit</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
              </div>
            </Card>
          </Link>
        </div>
      )}

      {kpis?.pendingActions && kpis.pendingActions.length > 0 && (
        <Card
          title="Pending Actions"
          className="mb-4"
          action={
            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              <Bell className="h-3.5 w-3.5" />
              {kpis.pendingActions.reduce((s, a) => s + a.count, 0)} items need attention
            </span>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {kpis.pendingActions.map((action) => (
              <Link
                key={action.type}
                to={action.path}
                className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-amber-50/80 ring-1 ring-amber-100 hover:bg-amber-100/80 transition-colors"
              >
                <span className="text-sm text-amber-900">{action.label}</span>
                <Badge variant="warning">{action.count}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <Card
          title={`Sales Trend (${chartDays} Days)`}
          className="lg:col-span-2"
        >
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
            <EmptyState
              title="No sales in this period"
              description="Sales invoices will appear here once recorded."
            />
          )}
        </Card>

        <Card title="Sales Mix by Category">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <Card title="Production Status">
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
                <Link to="/production">
                  <Button variant="secondary" size="sm">Go to Production</Button>
                </Link>
              }
            />
          )}
        </Card>

        <Card title="Top Delivered Products">
          {hasTopSellers ? (
            <div className="space-y-1">
              {kpis!.topSellingFilters.map((product, idx) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between py-2.5 px-2 rounded-xl hover:bg-surface-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-xs font-bold text-primary-700">
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">{product.name}</p>
                      <p className="text-xs text-slate-500">{product.sku}</p>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-slate-700 shrink-0 ml-2">
                    {product.quantitySold.toLocaleString()} sold
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No sales data yet"
              description="Top sellers appear after sales orders are fulfilled."
              action={
                <Link to="/sales">
                  <Button variant="secondary" size="sm">Create Sales Order</Button>
                </Link>
              }
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card
          title="Recent Orders"
          action={
            <Link to="/sales" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all
            </Link>
          }
        >
          <div className="space-y-1">
            {kpis?.recentOrders?.length ? (
              kpis.recentOrders.map((order) => (
                <Link
                  key={order.id}
                  to="/sales"
                  className="flex items-center justify-between py-3 px-2 rounded-xl hover:bg-surface-muted/60 transition-colors"
                >
                  <div>
                    <p className="font-semibold text-sm text-slate-900">{order.orderNumber}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{order.customer}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm text-slate-900">{formatCurrency(order.total)}</p>
                    <Badge variant={getStatusBadge(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState title="No recent orders" description="Sales orders will appear here." />
            )}
          </div>
        </Card>

        <Card title="Financial Summary">
          <div className="space-y-4">
            <div className="flex justify-between items-center rounded-xl bg-emerald-50/80 px-4 py-3 ring-1 ring-emerald-100">
              <span className="text-sm text-emerald-800">Monthly Revenue</span>
              <span className="font-bold text-emerald-700">{formatCurrency(kpis?.monthlyRevenue || 0)}</span>
            </div>
            <div className="flex justify-between items-center rounded-xl bg-red-50/80 px-4 py-3 ring-1 ring-red-100">
              <span className="text-sm text-red-800">Monthly Expenses</span>
              <span className="font-bold text-red-700">{formatCurrency(kpis?.monthlyExpenses || 0)}</span>
            </div>
            <div className="flex justify-between items-center rounded-xl bg-primary-50 px-4 py-4 ring-1 ring-primary-100">
              <span className="text-slate-900 font-semibold">Net Profit</span>
              <span className="font-bold text-xl text-primary-700">{formatCurrency(kpis?.monthlyProfit || 0)}</span>
              <p className="text-xs text-slate-500 mt-1">Sales invoices minus purchase invoices (MTD)</p>
            </div>
          </div>

          {kpis?.lowStockItems && kpis.lowStockItems.length > 0 && (
            <div className="mt-6 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-900">Low Stock Materials</h4>
                <Link to="/inventory" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                  View inventory
                </Link>
              </div>
              {kpis.lowStockItems.map((item) => (
                <Link
                  key={item.id}
                  to="/inventory"
                  className="flex justify-between text-sm py-2 border-b border-border/60 last:border-0 hover:bg-surface-muted/40 px-1 rounded"
                >
                  <span className="text-slate-600">{item.name}</span>
                  <span className="text-red-600 font-semibold">
                    {item.currentStock} / {item.minLevel}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
