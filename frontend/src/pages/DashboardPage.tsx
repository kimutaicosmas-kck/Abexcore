import { useQuery } from '@tanstack/react-query';
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
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import {
  DollarSign,
  ShoppingCart,
  Factory,
  Package,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import { StatCard, Card, Badge, formatCurrency, formatDate, getStatusBadge, PageHeader } from '../components/ui';
import { DashboardKPIs } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement);

export function DashboardPage() {
  const { data: kpis, isLoading } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => dashboardApi.getKPIs().then((r) => r.data.data as DashboardKPIs),
  });

  const { data: charts } = useQuery({
    queryKey: ['dashboard-charts'],
    queryFn: () => dashboardApi.getCharts().then((r) => r.data.data),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  const salesChartData = {
    labels: charts?.salesTrend?.map((d: { date: string }) => d.date.slice(5)) || [],
    datasets: [
      {
        label: 'Sales (KES)',
        data: charts?.salesTrend?.map((d: { amount: number }) => d.amount) || [],
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const categoryData = {
    labels: charts?.productCategories?.map((c: { category: string }) =>
      c.category.replace(/_/g, ' ')
    ) || [],
    datasets: [
      {
        data: charts?.productCategories?.map((c: { count: number }) => c.count) || [],
        backgroundColor: ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#be185d'],
      },
    ],
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your filter manufacturing operations"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          title="Sales Today"
          value={formatCurrency(kpis?.salesToday || 0)}
          icon={<DollarSign className="h-6 w-6 text-white" />}
          color="bg-green-500"
        />
        <StatCard
          title="Monthly Revenue"
          value={formatCurrency(kpis?.monthlyRevenue || 0)}
          icon={<TrendingUp className="h-6 w-6 text-white" />}
          color="bg-primary-500"
        />
        <StatCard
          title="Production Orders"
          value={kpis?.productionOrders || 0}
          icon={<Factory className="h-6 w-6 text-white" />}
          color="bg-purple-500"
        />
        <StatCard
          title="Inventory Value"
          value={formatCurrency(kpis?.inventoryValue || 0)}
          icon={<Package className="h-6 w-6 text-white" />}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          title="Purchase Orders"
          value={kpis?.purchaseOrders || 0}
          icon={<ShoppingCart className="h-6 w-6 text-white" />}
          color="bg-indigo-500"
        />
        <StatCard
          title="Awaiting Production"
          value={kpis?.ordersAwaitingProduction || 0}
          icon={<Factory className="h-6 w-6 text-white" />}
          color="bg-yellow-500"
        />
        <StatCard
          title="Finished Goods"
          value={kpis?.finishedGoods?.toLocaleString() || 0}
          icon={<Package className="h-6 w-6 text-white" />}
          color="bg-teal-500"
        />
        <StatCard
          title="Low Stock Alerts"
          value={kpis?.rawMaterialsLow || 0}
          icon={<AlertTriangle className="h-6 w-6 text-white" />}
          color="bg-red-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card title="Sales Trend (30 Days)" className="lg:col-span-2">
          <Line
            data={salesChartData}
            options={{
              responsive: true,
              plugins: { legend: { display: false } },
              scales: { y: { beginAtZero: true } },
            }}
          />
        </Card>

        <Card title="Product Categories">
          <div className="h-64 flex items-center justify-center">
            <Doughnut
              data={categoryData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } },
              }}
            />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Recent Orders">
          <div className="space-y-3">
            {kpis?.recentOrders?.map((order) => (
              <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="font-medium text-sm">{order.orderNumber}</p>
                  <p className="text-xs text-gray-500">{order.customer}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-sm">{formatCurrency(order.total)}</p>
                  <Badge variant={getStatusBadge(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            )) || <p className="text-gray-500 text-sm">No recent orders</p>}
          </div>
        </Card>

        <Card title="Financial Summary">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Monthly Revenue</span>
              <span className="font-bold text-green-600">{formatCurrency(kpis?.monthlyRevenue || 0)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Monthly Expenses</span>
              <span className="font-bold text-red-600">{formatCurrency(kpis?.monthlyExpenses || 0)}</span>
            </div>
            <hr />
            <div className="flex justify-between items-center">
              <span className="text-gray-900 font-medium">Net Profit</span>
              <span className="font-bold text-lg text-primary-600">{formatCurrency(kpis?.monthlyProfit || 0)}</span>
            </div>
          </div>

          {kpis?.lowStockItems && kpis.lowStockItems.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <h4 className="text-sm font-medium text-gray-900 mb-3">Low Stock Materials</h4>
              {kpis.lowStockItems.map((item) => (
                <div key={item.id} className="flex justify-between text-sm py-1">
                  <span className="text-gray-600">{item.name}</span>
                  <span className="text-red-600 font-medium">{item.currentStock} / {item.minLevel}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
