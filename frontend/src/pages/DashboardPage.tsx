import { useMemo, useRef, useState } from 'react';
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
  type ChartOptions,
  type Plugin,
  type ScriptableContext,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  DollarSign,
  Package,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  StatCard,
  StatGrid,
  Card,
  Button,
  Alert,
  EmptyState,
  Select,
  LoadingSpinner,
  PageToolbar,
  formatCurrency,
} from '../components/ui';
import { DashboardCharts, DashboardKPIs } from '../types';
import { formatPartNumberLine } from '../utils/productDisplay';
import { resolveCompanyModules } from '../utils/companyModules';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler);

const TABS = ['Analytics'];

const CHART_DAYS_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const CATEGORY_CHART_COLORS = [
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#f43f5e', // rose
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
];

const FONT = 'Inter';

const chartDefaults = {
  responsive: true,
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: FONT, size: 11 } } },
  },
};

/** Soft vertical guide under the hovered point */
const salesHoverLine: Plugin<'line'> = {
  id: 'salesHoverLine',
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements()?.[0];
    if (!active) return;
    const { ctx, chartArea } = chart;
    const x = active.element.x;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

function formatChartDateLabel(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate.slice(5);
  return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
}

export function DashboardPage() {
  const location = useLocation();
  const { canAccessRoute, company } = useAuth();
  const accessDenied = (location.state as { accessDenied?: boolean } | null)?.accessDenied;
  const [activeTab, setActiveTab] = useState(0);
  const [chartDays, setChartDays] = useState('7');
  const salesChartRef = useRef<ChartJS<'line'> | null>(null);

  // Dashboard is view-all for every employee; links only open modules the user can access.
  const companyModules = resolveCompanyModules(company?.enabledModules);
  const companyHas = (module: string) => companyModules.includes(module);
  const linkTo = (path: string) => (canAccessRoute(path) ? path : undefined);
  const monthSalesLink = linkTo('/finance') || linkTo('/sales');
  const showSalesKpis = companyHas('sales') || companyHas('finance') || companyHas('pos');
  const showInventoryKpis = companyHas('inventory');

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
    enabled: activeTab === 0,
  });

  const salesFill = (ctx: ScriptableContext<'line'>) => {
    const chart = ctx.chart;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return 'rgba(14, 165, 233, 0.12)';
    const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(14, 165, 233, 0.38)');
    gradient.addColorStop(0.55, 'rgba(37, 99, 235, 0.12)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.02)');
    return gradient;
  };

  const salesChartData = useMemo(
    () => ({
      labels: charts?.salesTrend?.map((d) => formatChartDateLabel(d.date)) || [],
      datasets: [
        {
          label: 'Sales',
          data: charts?.salesTrend?.map((d) => d.amount) || [],
          borderColor: '#0ea5e9',
          backgroundColor: salesFill,
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: '#0ea5e9',
          pointBorderWidth: 2.5,
          pointHoverBackgroundColor: '#0ea5e9',
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 3,
          cubicInterpolationMode: 'monotone' as const,
        },
      ],
    }),
    [charts?.salesTrend]
  );

  const salesChartOptions: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      hover: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          titleColor: '#e2e8f0',
          bodyColor: '#fff',
          titleFont: { family: FONT, size: 12, weight: 500 },
          bodyFont: { family: FONT, size: 14, weight: 700 },
          padding: { top: 10, right: 14, bottom: 10, left: 14 },
          cornerRadius: 12,
          caretSize: 6,
          caretPadding: 8,
          borderColor: 'rgba(148, 163, 184, 0.25)',
          borderWidth: 1,
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (item) => formatCurrency(Number(item.raw) || 0),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: '#64748b',
            maxTicksLimit: chartDays === '90' ? 8 : 10,
            font: { size: 11, family: FONT, weight: 500 },
            padding: 8,
          },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            font: { size: 11, family: FONT },
            padding: 10,
            callback: (value) => {
              const n = Number(value);
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
              if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}k`;
              return String(n);
            },
          },
        },
      },
    }),
    [chartDays]
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <LoadingSpinner className="h-48" size="md" />
      </div>
    );
  }

  if (isError || !kpis) {
    return (
      <div className="space-y-4">
        <Alert variant="error">
          Failed to load dashboard.{' '}
          <button type="button" onClick={() => refetch()} className="underline font-medium">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const salesTotal = charts?.salesTrend?.reduce((s, d) => s + d.amount, 0) || 0;
  const hasSalesTrend = salesTotal > 0;
  const hasCategories = (charts?.productCategories?.length || 0) > 0;
  const hasTopSellers = (kpis.topSellingProducts?.length || 0) > 0;
  const daysLabel = CHART_DAYS_OPTIONS.find((o) => o.value === chartDays)?.label || `Last ${chartDays} days`;

  const categoryData = {
    labels: charts?.productCategories?.map((c) => c.category) || [],
    datasets: [
      {
        data: charts?.productCategories?.map((c) => c.count) || [],
        backgroundColor: (charts?.productCategories || []).map(
          (_, i) => CATEGORY_CHART_COLORS[i % CATEGORY_CHART_COLORS.length]
        ),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 6,
      },
    ],
  };

  const handleRefresh = () => {
    refetch();
    if (activeTab === 0) refetchCharts();
  };

  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      {activeTab === 0 && (
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
    <div className="space-y-6">
      <StatGrid>
        {showSalesKpis && (
          <StatCard
            title="Sales today"
            value={formatCurrency(kpis.salesToday)}
            icon={<DollarSign className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-emerald-700"
            to={linkTo('/sales')}
          />
        )}
        {showSalesKpis && (
          <StatCard
            title="This month sales"
            value={formatCurrency(kpis.monthlyRevenue)}
            icon={<TrendingUp className="h-5 w-5 text-white" />}
            color="from-primary-500 to-primary-700"
            to={monthSalesLink}
          />
        )}
        {showInventoryKpis && (
          <StatCard
            title="Stock value"
            value={formatCurrency(kpis.inventoryValue ?? 0)}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-amber-500 to-orange-600"
            to={linkTo('/inventory')}
          />
        )}
        {showInventoryKpis && (
          <StatCard
            title="Low stock"
            value={kpis.rawMaterialsLow}
            icon={<AlertTriangle className="h-5 w-5 text-white" />}
            color="from-rose-500 to-rose-700"
            to={linkTo('/inventory')}
          />
        )}
      </StatGrid>

      <PageToolbar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {accessDenied && (
        <Alert variant="warning">
          That module is not assigned to your role. Use the sidebar to open a module you can access.
        </Alert>
      )}

      {activeTab === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card
              title="Sales trend"
              action={
                <span className="text-xs font-medium text-slate-500 tabular-nums">
                  {daysLabel}
                  {hasSalesTrend ? ` · ${formatCurrency(salesTotal)}` : ''}
                </span>
              }
              className="lg:col-span-2"
            >
              {chartsLoading ? (
                <LoadingSpinner className="h-64" size="sm" />
              ) : chartsError ? (
                <Alert variant="error">
                  Failed to load chart.{' '}
                  <button type="button" onClick={() => refetchCharts()} className="underline">
                    Retry
                  </button>
                </Alert>
              ) : hasSalesTrend ? (
                <div className="h-64 sm:h-72 -mx-1">
                  <Line
                    ref={salesChartRef}
                    data={salesChartData}
                    options={salesChartOptions}
                    plugins={[salesHoverLine]}
                  />
                </div>
              ) : (
                <EmptyState title="No sales in this period" />
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
                      plugins: {
                        ...chartDefaults.plugins,
                        legend: { position: 'bottom' },
                        tooltip: {
                          backgroundColor: 'rgba(15, 23, 42, 0.94)',
                          titleFont: { family: FONT, size: 12 },
                          bodyFont: { family: FONT, size: 13, weight: 600 },
                          padding: 12,
                          cornerRadius: 10,
                          callbacks: {
                            label: (item) => {
                              const label = item.label || '';
                              const value = Number(item.raw) || 0;
                              return ` ${label}: ${value}`;
                            },
                          },
                        },
                      },
                    }}
                  />
                </div>
              ) : (
                <EmptyState title="No products yet" />
              )}
            </Card>
          </div>

          <Card title="Top selling products" padding={false}>
            {hasTopSellers ? (
              <ul className="divide-y divide-slate-100">
                {kpis.topSellingProducts.filter((product) => product.id).slice(0, 8).map((product, index) => (
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
              <EmptyState title="No sales data yet" />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
