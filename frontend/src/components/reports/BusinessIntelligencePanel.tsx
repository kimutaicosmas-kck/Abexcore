import { useQuery } from '@tanstack/react-query';
import { BarChart3, Wallet, AlertCircle, Package, ClipboardCheck, Receipt } from 'lucide-react';
import { platformApi } from '../../services/api';
import { Card, QueryErrorAlert, StatCard, StatGrid, formatCurrency } from '../ui';

type Summary = {
  kpis: {
    salesAmountMonth: number;
    salesOrdersMonth: number;
    salesTodayAmount: number;
    arOutstanding: number;
    openInvoiceCount: number;
    overdueInvoiceCount: number;
    collectionsMonth: number;
    lowStockSkuCount: number;
    pendingApprovals: number;
    fiscalPendingInvoices: number;
  };
};

type Aging = {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
};

export function BusinessIntelligencePanel() {
  const summaryQuery = useQuery({
    queryKey: ['bi-summary'],
    queryFn: () => platformApi.analyticsSummary().then((r) => r.data.data as Summary),
  });
  const agingQuery = useQuery({
    queryKey: ['bi-aging'],
    queryFn: () => platformApi.arAging().then((r) => r.data.data as Aging),
  });
  const trendQuery = useQuery({
    queryKey: ['bi-trend'],
    queryFn: () =>
      platformApi.salesTrend(30).then(
        (r) => r.data.data as { series: { date: string; amount: number; count: number }[] }
      ),
  });

  const kpis = summaryQuery.data?.kpis;
  const aging = agingQuery.data;
  const series = trendQuery.data?.series || [];
  const maxAmount = Math.max(1, ...series.map((s) => s.amount));

  return (
    <div className="space-y-4">
      {(summaryQuery.isError || agingQuery.isError || trendQuery.isError) && (
        <QueryErrorAlert
          error={summaryQuery.error || agingQuery.error || trendQuery.error}
          onRetry={() => {
            summaryQuery.refetch();
            agingQuery.refetch();
            trendQuery.refetch();
          }}
        />
      )}

      <StatGrid>
        <StatCard
          title="Sales this month"
          value={formatCurrency(kpis?.salesAmountMonth || 0)}
          icon={<Wallet className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Orders this month"
          value={kpis?.salesOrdersMonth || 0}
          icon={<BarChart3 className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Today's sales"
          value={formatCurrency(kpis?.salesTodayAmount || 0)}
          icon={<Receipt className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="AR outstanding"
          value={formatCurrency(kpis?.arOutstanding || 0)}
          icon={<Wallet className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Collections (month)"
          value={formatCurrency(kpis?.collectionsMonth || 0)}
          icon={<Wallet className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Overdue invoices"
          value={kpis?.overdueInvoiceCount || 0}
          icon={<AlertCircle className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Low stock SKUs"
          value={kpis?.lowStockSkuCount || 0}
          icon={<Package className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="Pending approvals"
          value={kpis?.pendingApprovals || 0}
          icon={<ClipboardCheck className="h-5 w-5" />}
          dense
        />
        <StatCard
          title="eTIMS pending"
          value={kpis?.fiscalPendingInvoices || 0}
          icon={<Receipt className="h-5 w-5" />}
          dense
        />
      </StatGrid>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="AR aging">
          {aging ? (
            <div className="space-y-2 text-sm">
              {(
                [
                  ['Current', aging.current],
                  ['1–30 days', aging.days1to30],
                  ['31–60 days', aging.days31to60],
                  ['61–90 days', aging.days61to90],
                  ['90+ days', aging.over90],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium text-slate-900">{formatCurrency(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Loading…</p>
          )}
        </Card>

        <Card title="Sales trend (30 days)">
          <div className="flex items-end gap-0.5 h-36">
            {series.map((point) => (
              <div
                key={point.date}
                title={`${point.date}: ${formatCurrency(point.amount)}`}
                className="flex-1 rounded-t bg-primary-500/80 min-w-0"
                style={{ height: `${Math.max(4, (point.amount / maxAmount) * 100)}%` }}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
