import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Target, TrendingUp, Wallet, ShoppingCart, AlertCircle } from 'lucide-react';
import { financeApi } from '../services/api';
import {
  Alert,
  Card,
  DataPanel,
  EmptyState,
  PageToolbar,
  StatCard,
  StatGrid,
  Table,
  formatCurrency,
  formatDate,
} from '../components/ui';
import { SalesTeamPerformance } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { canManageSalesTargets } from '../utils/salesTargets';
import { SalesTargetsPanel } from './SalesTargetsPage';

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonth(date = new Date()) {
  return localDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
}

function useSalesPerformancePeriod() {
  const today = localDateInput();
  return { from: startOfMonth(), to: today };
}

function SalesPerformanceSummary({ data }: { data: SalesTeamPerformance }) {
  return (
    <StatGrid>
      <StatCard
        title="Team invoiced"
        value={formatCurrency(data.summary.invoiced)}
        icon={<TrendingUp className="h-5 w-5 text-white" />}
        color="from-cyan-500 to-cyan-700"
        to="/finance"
      />
      <StatCard
        title="Collected"
        value={formatCurrency(data.summary.collected)}
        icon={<Wallet className="h-5 w-5 text-white" />}
        color="from-violet-500 to-violet-700"
        to="/finance"
      />
      <StatCard
        title="Orders"
        value={data.summary.orderCount}
        icon={<ShoppingCart className="h-5 w-5 text-white" />}
        color="from-emerald-500 to-emerald-700"
        to="/sales"
      />
      <StatCard
        title="Avg target hit"
        value={data.summary.avgAchievement != null ? `${data.summary.avgAchievement}%` : '—'}
        icon={<Target className="h-5 w-5 text-white" />}
        color="from-orange-500 to-orange-700"
        to="/sales-performance?tab=targets"
      />
      <StatCard
        title="Outstanding"
        value={formatCurrency(data.summary.outstanding)}
        icon={<AlertCircle className="h-5 w-5 text-white" />}
        color="from-rose-500 to-rose-700"
        to="/finance"
      />
    </StatGrid>
  );
}

export function SalesPerformancePanel() {
  const { from, to } = useSalesPerformancePeriod();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-performance', from, to],
    queryFn: () =>
      financeApi.salesPerformance({ from, to }).then((r) => r.data.data as SalesTeamPerformance),
  });

  const columns = [
    {
      key: 'rank',
      label: '#',
      render: (val: unknown) => <span className="font-semibold text-slate-700">{val as number}</span>,
    },
    {
      key: 'name',
      label: 'Sales person',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium text-slate-900">{row.name as string}</p>
          <p className="text-xs text-slate-500">{row.email as string}</p>
        </div>
      ),
    },
    {
      key: 'orderCount',
      label: 'Orders',
      render: (val: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium">{val as number}</p>
          <p className="text-xs text-slate-500">{formatCurrency(row.orderValue as number)}</p>
        </div>
      ),
    },
    {
      key: 'invoiced',
      label: 'Invoiced',
      render: (val: unknown) => <span className="font-semibold tabular-nums">{formatCurrency(val as number)}</span>,
    },
    {
      key: 'collected',
      label: 'Collected',
      render: (val: unknown) => <span className="tabular-nums">{formatCurrency(val as number)}</span>,
    },
    {
      key: 'monthlyTarget',
      label: 'Target',
      render: (val: unknown, row: Record<string, unknown>) =>
        (val as number) > 0 ? (
          <div>
            <p className="font-medium tabular-nums">{formatCurrency(val as number)}</p>
            <p className="text-xs text-slate-500">
              Month {formatCurrency(row.monthInvoiced as number)}
            </p>
          </div>
        ) : (
          <span className="text-slate-400">Not set</span>
        ),
    },
    {
      key: 'achievementPercent',
      label: 'Achievement',
      render: (val: unknown) =>
        val == null ? (
          <span className="text-slate-400">—</span>
        ) : (
          <div className="min-w-[7rem]">
            <div className="flex justify-between text-xs mb-1">
              <span className="font-semibold">{val as number}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary-600"
                style={{ width: `${Math.min(100, val as number)}%` }}
              />
            </div>
          </div>
        ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Link
          to={`/my-sales?salesPersonId=${row.salesPersonId as string}&from=${from}&to=${to}`}
          className="text-xs font-medium text-primary-600 hover:underline"
        >
          Details
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataPanel>
        {isError ? (
          <Alert variant="error">
            Failed to load sales performance.{' '}
            <button type="button" onClick={() => refetch()} className="underline font-medium">
              Retry
            </button>
          </Alert>
        ) : !isLoading && data && data.performers.length === 0 ? (
          <EmptyState
            title="No sales officers found"
            description="Add Sales Officer or Sales Executive users under Users, then set monthly targets on the Targets tab."
          />
        ) : (
          <>
            {data && (
              <div className="px-4 pt-4 pb-2 border-b border-border/60 text-xs text-slate-500">
                Period: {formatDate(data.period.from)} – {formatDate(data.period.to)} ·{' '}
                {data.summary.salesPeople} salespeople
              </div>
            )}
            <Table
              columns={columns}
              data={(data?.performers || []) as unknown as Record<string, unknown>[]}
              loading={isLoading}
              responsive
              embedded
            />
          </>
        )}
      </DataPanel>

      {data && data.performers.length > 0 && (
        <Card title="Top performers" padding={false}>
          <ul className="divide-y divide-slate-100">
            {data.performers.slice(0, 3).map((person) => (
              <li key={person.salesPersonId} className="flex items-center justify-between px-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm">
                    {person.rank}
                  </span>
                  <div>
                    <p className="font-medium text-slate-900">{person.name}</p>
                    <p className="text-xs text-slate-500">
                      {person.orderCount} orders · {person.invoiceCount} invoices
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatCurrency(person.invoiced)}</p>
                  {person.achievementPercent != null && (
                    <p className="text-xs text-emerald-600">{person.achievementPercent}% of target</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function SalesPerformancePage() {
  const { hasPermission, user, isSuperAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const canViewPerformance = hasPermission('reports:read') || hasPermission('finance:read');
  const canManageTargets =
    isSuperAdmin || canManageSalesTargets(user?.role?.name, hasPermission);
  const { from, to } = useSalesPerformancePeriod();

  const { data: summaryData } = useQuery({
    queryKey: ['sales-performance', from, to],
    queryFn: () =>
      financeApi.salesPerformance({ from, to }).then((r) => r.data.data as SalesTeamPerformance),
    enabled: canViewPerformance,
  });

  const tabs = useMemo(() => {
    const items: string[] = [];
    if (canViewPerformance) items.push('Performance');
    if (canManageTargets) items.push('Set targets');
    return items;
  }, [canViewPerformance, canManageTargets]);

  const wantTargets =
    (searchParams.get('tab') === 'targets' || searchParams.get('tab') === 'Set targets') &&
    canManageTargets;
  const initialTab = wantTargets ? 'Set targets' : tabs[0] || 'Performance';
  const [activeTabName, setActiveTabName] = useState(initialTab);
  const activeTab = Math.max(0, tabs.indexOf(activeTabName));

  if (tabs.length === 0) {
    return <Alert variant="warning">You do not have access to sales performance or targets.</Alert>;
  }

  return (
    <div className="space-y-4">
      {canViewPerformance && summaryData && <SalesPerformanceSummary data={summaryData} />}
      <PageToolbar
        tabs={tabs}
        activeTab={activeTab >= 0 ? activeTab : 0}
        onTabChange={(index) => setActiveTabName(tabs[index])}
      />
      {activeTabName === 'Performance' && canViewPerformance && <SalesPerformancePanel />}
      {activeTabName === 'Set targets' && canManageTargets && <SalesTargetsPanel />}
    </div>
  );
}
