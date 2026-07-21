import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Target, TrendingUp, Wallet, Receipt } from 'lucide-react';
import { financeApi } from '../services/api';
import {
  PageHeader,
  StatCard,
  StatGrid,
  Card,
  Badge,
  Table,
  DataPanel,
  TablePagination,
  Input,
  Button,
  formatCurrency,
  formatDate,
  getStatusBadge,
  EmptyState,
} from '../components/ui';
import { MySalesDashboard } from '../types';
import { useAuth } from '../contexts/AuthContext';

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfWeek(date: Date) {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  return start;
}

function periodLabel(from: string, to: string) {
  if (from === to) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function MySalesPage() {
  const { user } = useAuth();
  const today = localDateInput();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('today');

  const applyPreset = (preset: Exclude<PeriodPreset, 'custom'>) => {
    const now = new Date();
    setPeriodPreset(preset);
    setPage(1);

    if (preset === 'today') {
      const value = localDateInput(now);
      setFrom(value);
      setTo(value);
      return;
    }

    if (preset === 'week') {
      setFrom(localDateInput(startOfWeek(now)));
      setTo(localDateInput(now));
      return;
    }

    setFrom(localDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
    setTo(localDateInput(now));
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-sales', page, from, to],
    queryFn: () =>
      financeApi
        .mySales({ page, limit: 15, from, to })
        .then((r) => r.data.data as MySalesDashboard),
  });

  const summary = data?.summary;
  const achievement = summary?.achievementPercent;
  const showingToday = from === to && from === today;

  const columns = [
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'orderDate',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium">{row.customerName as string}</p>
          <p className="text-xs text-slate-500">{row.customerCode as string}</p>
        </div>
      ),
    },
    {
      key: 'totalAmount',
      label: 'Order value',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'invoicedAmount',
      label: 'Invoiced',
      render: (val: unknown, row: Record<string, unknown>) => {
        const invoiced = val as number;
        const orderValue = row.totalAmount as number;
        const over = row.isOverInvoiced as boolean;
        return (
          <div>
            <p className={over ? 'text-amber-700 font-medium' : undefined}>{formatCurrency(invoiced)}</p>
            {over && (
              <p className="text-xs text-amber-600">Duplicate invoices — see Finance</p>
            )}
            {!over && invoiced > orderValue + 0.01 && (
              <p className="text-xs text-slate-500">Partial deliveries</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'paidAmount',
      label: 'Paid',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{String(val).replace(/_/g, ' ')}</Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Sales"
        subtitle={
          showingToday
            ? `Today's sales for ${user?.firstName || 'you'}`
            : `Sales for ${periodLabel(from, to)}`
        }
      />

      <Card title="Date range">
        <div className="flex flex-wrap gap-2 mb-4">
          {(
            [
              { id: 'today' as const, label: 'Today' },
              { id: 'week' as const, label: 'This week' },
              { id: 'month' as const, label: 'This month' },
            ] as const
          ).map((preset) => (
            <Button
              key={preset.id}
              size="sm"
              variant={periodPreset === preset.id ? 'primary' : 'secondary'}
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="From"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPeriodPreset('custom');
              setPage(1);
            }}
          />
          <Input
            label="To"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPeriodPreset('custom');
              setPage(1);
            }}
          />
        </div>
      </Card>

      {summary && (
        <>
          <StatGrid>
            <StatCard
              title={showingToday ? "Today's sales" : 'Total sales'}
              value={formatCurrency(summary.totalSales)}
              icon={<TrendingUp className="h-5 w-5 text-white" />}
              color="from-emerald-500 to-teal-600"
            />
            <StatCard
              title="Invoiced"
              value={formatCurrency(summary.totalInvoiced)}
              icon={<Receipt className="h-5 w-5 text-white" />}
              color="from-primary-500 to-indigo-600"
            />
            <StatCard
              title="Collected"
              value={formatCurrency(summary.totalPaid)}
              icon={<Wallet className="h-5 w-5 text-white" />}
              color="from-violet-500 to-purple-600"
            />
            <StatCard
              title="Monthly target"
              value={summary.monthlyTarget > 0 ? `${achievement ?? 0}%` : 'Not set'}
              icon={<Target className="h-5 w-5 text-white" />}
              color="from-amber-500 to-orange-600"
            />
          </StatGrid>

          {summary.monthlyTarget > 0 && (
            <Card title="Target progress">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">
                    Invoiced {formatCurrency(summary.monthInvoiced ?? summary.totalInvoiced)} of {formatCurrency(summary.monthlyTarget)} this month
                  </span>
                  <span className="font-semibold text-slate-900">{achievement ?? 0}%</span>
                </div>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary-600 transition-all"
                    style={{ width: `${Math.min(100, achievement ?? 0)}%` }}
                  />
                </div>
              </div>
            </Card>
          )}

          {summary.ordersByStatus.length > 0 && (
            <Card title="Orders by status" padding={false}>
              <ul className="divide-y divide-slate-100">
                {summary.ordersByStatus.map((row) => (
                  <li key={row.status} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="font-medium">{row.status.replace(/_/g, ' ')}</span>
                    <span className="text-slate-600">
                      {row.count} · {formatCurrency(row.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <DataPanel>
        <div className="px-4 pt-4 pb-2 border-b border-border/60">
          <h3 className="text-sm font-semibold text-slate-900">
            {showingToday ? "Today's orders" : `Orders (${periodLabel(from, to)})`}
          </h3>
        </div>
        {isError ? (
          <EmptyState
            title="Could not load your sales"
            description="Try again in a moment."
            action={<button type="button" className="text-primary-600 underline" onClick={() => refetch()}>Retry</button>}
          />
        ) : (
          <>
            <Table
              columns={columns}
              data={(data?.orders || []) as unknown as Record<string, unknown>[]}
              loading={isLoading}
              embedded
            />
            {data && (
              <TablePagination
                pagination={data.pagination}
                page={page}
                onPageChange={setPage}
                label="orders"
              />
            )}
          </>
        )}
      </DataPanel>
    </div>
  );
}
