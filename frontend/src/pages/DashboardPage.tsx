import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  Filler,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  DollarSign,
  ShoppingCart,
  Package,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  Plus,
  FileText,
  Truck,
  Bell,
  Factory,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import {
  PageHeader,
  StatCard,
  StatGrid,
  Card,
  Badge,
  Button,
  Alert,
  EmptyState,
  QuickActionCard,
  QuickActionGrid,
  Select,
  LoadingSpinner,
  PageToolbar,
  formatCurrency,
  getStatusBadge,
} from '../components/ui';
import { DashboardCharts, DashboardKPIs } from '../types';
import { useDashboardNavigation } from '../components/dashboard/DashboardNav';
import { OverviewLayout, OverviewPreviewCard } from '../components/layout/ModuleOverview';
import { formatPartNumberLine } from '../utils/productDisplay';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler);

const TABS = ['Overview', 'Analytics'];

const CHART_DAYS_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const chartDefaults = {
  responsive: true,
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter' } } },
  },
};

const QUICK_ACTIONS = [
  { label: 'New sales order', desc: 'Create a customer order', icon: Plus, color: 'bg-emerald-50 text-emerald-600 border-emerald-100', href: '/sales' },
  { label: 'Invoices & payments', desc: 'Bill customers and record paybill', icon: FileText, color: 'bg-primary-50 text-primary-600 border-primary-100', href: '/finance' },
  { label: 'Delivery', desc: 'Dispatch confirmed orders', icon: Truck, color: 'bg-orange-50 text-orange-600 border-orange-100', href: '/delivery' },
  { label: 'Inventory', desc: 'Check stock levels', icon: Package, color: 'bg-violet-50 text-violet-600 border-violet-100', href: '/inventory' },
] as const;

export function DashboardPage() {
  const location = useLocation();
  const { canOpen, openModule } = useDashboardNavigation();
  const accessDenied = (location.state as { accessDenied?: boolean } | null)?.accessDenied;
  const [activeTab, setActiveTab] = useState(0);
  const [chartDays, setChartDays] = useState('1');

  const { data: kpis, isLoading, isError, refetch, isFetching } = useQuery({
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
    enabled: activeTab === 1,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Today at a glance" />
        <LoadingSpinner className="h-48" size="md" />
      </div>
    );
  }

  if (isError || !kpis) {
    return (
      <div className="space-y-4">
        <PageHeader title="Dashboard" subtitle="Today at a glance" />
        <Alert variant="error">
          Failed to load dashboard.{' '}
          <button type="button" onClick={() => refetch()} className="underline font-medium">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const lowStockCount = kpis.lowStockItems?.length ?? kpis.rawMaterialsLow ?? 0;
  const pendingActions = kpis.pendingActions?.filter((a) => canOpen(a.path)) || [];

  const salesTotal = charts?.salesTrend?.reduce((s, d) => s + d.amount, 0) || 0;
  const hasSalesTrend = salesTotal > 0;
  const hasCategories = (charts?.productCategories?.length || 0) > 0;
  const hasTopSellers = (kpis.topSellingFilters?.length || 0) > 0;

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

  const handleRefresh = () => {
    refetch();
    if (activeTab === 1) refetchCharts();
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
      <Button variant="secondary" size="sm" onClick={handleRefresh} loading={isFetching || chartsFetching}>
        <RefreshCw className="h-4 w-4 mr-1.5" />
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Dashboard" subtitle="Today at a glance" />

      <StatGrid>
        <StatCard title="Sales today" value={formatCurrency(kpis.salesToday)} icon={<DollarSign className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
        <StatCard title="Monthly revenue" value={formatCurrency(kpis.monthlyRevenue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
        <StatCard title="Production orders" value={kpis.productionOrders} icon={<Factory className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        <StatCard title="Inventory value" value={formatCurrency(kpis.inventoryValue)} icon={<Package className="h-5 w-5 text-white" />} color="from-orange-500 to-amber-600" />
        <StatCard title="Low stock" value={kpis.rawMaterialsLow} icon={<AlertTriangle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
      </StatGrid>

      {accessDenied && (
        <Alert variant="warning">
          That module is not assigned to your role. Use the sidebar or enabled shortcuts below.
        </Alert>
      )}

      <PageToolbar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <>
          <QuickActionGrid>
            {QUICK_ACTIONS.map((action) => (
              <QuickActionCard
                key={action.href}
                label={action.label}
                desc={action.desc}
                icon={action.icon}
                color={action.color}
                disabled={!canOpen(action.href)}
                onClick={() => openModule(action.href)}
              />
            ))}
          </QuickActionGrid>

          <OverviewLayout>
            <OverviewPreviewCard
              title="Needs attention"
              isEmpty={pendingActions.length === 0}
              emptyTitle="All caught up"
              emptyDescription="Nothing requires your action right now."
            >
              <ul className="divide-y divide-slate-100">
                {pendingActions.map((action) => (
                  <li key={action.type}>
                    <button
                      type="button"
                      onClick={() => openModule(action.path)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-amber-50/50 transition-colors"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        <Bell className="h-4 w-4 text-amber-500" />
                        {action.label}
                      </span>
                      <Badge variant="warning">{action.count}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </OverviewPreviewCard>

            <OverviewPreviewCard
              title="Recent sales orders"
              onViewAll={canOpen('/sales') ? () => openModule('/sales') : undefined}
              isEmpty={!kpis.recentOrders?.length}
              emptyTitle="No orders yet"
              emptyDescription="New sales orders will appear here."
            >
              <ul className="divide-y divide-slate-100">
                {kpis.recentOrders?.slice(0, 6).map((order) => (
                  <li key={order.id} className="flex items-center gap-3 px-4 py-3">
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
                  </li>
                ))}
              </ul>
            </OverviewPreviewCard>

            {lowStockCount > 0 && kpis.lowStockItems && (
              <Card title="Low stock" padding={false}>
                <ul className="divide-y divide-slate-100">
                  {kpis.lowStockItems.slice(0, 5).map((item) => (
                    <li key={item.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-slate-500">{item.code}</p>
                      </div>
                      <span className="font-semibold text-red-600">{item.currentStock} left</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </OverviewLayout>
        </>
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

          <Card title="Top selling products" padding={false}>
            {hasTopSellers ? (
              <ul className="divide-y divide-slate-100">
                {kpis.topSellingFilters.slice(0, 8).map((product, index) => (
                  <li key={product.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-semibold text-primary-600">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{product.name}</p>
                        <p className="text-xs text-slate-500">{formatPartNumberLine(product.sku)}</p>
                      </div>
                    </div>
                    <span className="font-semibold tabular-nums text-slate-800 shrink-0 ml-3">
                      {product.quantitySold} sold
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No sales data yet" description="Top sellers will appear after orders are invoiced." />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
