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
import { RefreshCw } from 'lucide-react';
import { dashboardApi } from '../services/api';
import {
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, Filler);

const CHART_DAYS_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const chartDefaults = {
  responsive: true,
  plugins: {
    legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Plus Jakarta Sans', size: 11 } } },
  },
};

export function DashboardPage() {
  const location = useLocation();
  const accessDenied = (location.state as { accessDenied?: boolean } | null)?.accessDenied;
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
    enabled: true,
  });

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

  const salesChartData = {
    labels: charts?.salesTrend?.map((d) => d.date.slice(5)) || [],
    datasets: [
      {
        label: 'Sales (KES)',
        data: charts?.salesTrend?.map((d) => d.amount) || [],
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.12)',
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
      },
    ],
  };

  const categoryData = {
    labels: charts?.productCategories?.map((c) => c.category) || [],
    datasets: [
      {
        data: charts?.productCategories?.map((c) => c.count) || [],
        backgroundColor: ['#2563eb', '#3b82f6', '#0ea5e9', '#0284c7', '#1d4ed8', '#0369a1', '#1e40af', '#0891b2'],
        borderWidth: 0,
        hoverOffset: 6,
      },
    ],
  };

  const handleRefresh = () => {
    refetch();
    refetchCharts();
  };

  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        options={CHART_DAYS_OPTIONS}
        value={chartDays}
        onChange={(e) => setChartDays(e.target.value)}
        className="w-36"
      />
      <Button variant="secondary" size="sm" onClick={handleRefresh} loading={isFetching || chartsFetching}>
        <RefreshCw className="h-4 w-4 mr-1.5" />
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="space-y-5">
      <PageToolbar actions={toolbarActions} />

      {accessDenied && (
        <Alert variant="warning">
          That module is not assigned to your role. Use the sidebar or enabled shortcuts below.
        </Alert>
      )}

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
                    x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 10, font: { size: 11, family: 'Plus Jakarta Sans' } } },
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', font: { size: 11, family: 'Plus Jakarta Sans' } } },
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
            <EmptyState title="No sales data yet" description="Top sellers will appear after orders are invoiced." />
          )}
        </Card>
      </div>
    </div>
  );
}
