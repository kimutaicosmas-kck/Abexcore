import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle, Factory, Calendar, Clock, ChevronRight, Package } from 'lucide-react';
import { dashboardApi, operationsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Card,
  Input,
  Select,
  StatCard,
  EmptyState,
  DataPanel,
  QuickActionCard,
  QuickActionGrid,
  TablePagination,
  formatDate,
  getStatusBadge,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductionOrderForm } from '../components/forms/ProductionOrderForm';
import { CompleteProductionForm } from '../components/forms/CompleteProductionForm';
import { useAuth } from '../contexts/AuthContext';
import { DashboardKPIs } from '../types';

const tabs = ['Overview', 'Production Orders'];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PLANNED', label: 'Planned' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function statusCount(kpis: DashboardKPIs | undefined, status: string) {
  return kpis?.productionStatus?.find((s) => s.status === status)?.count ?? 0;
}

export function ProductionPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const canCreate = hasPermission('production:create');

  const { data: kpis } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: () => dashboardApi.getKPIs().then((r) => r.data.data as DashboardKPIs),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['production', page, search, statusFilter],
    queryFn: () =>
      operationsApi
        .production({ page, limit: 15, search: search || undefined, status: statusFilter || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => operationsApi.startProduction(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const recentOrders = activeTab === 0 ? (data?.data || []).slice(0, 6) : [];
  const inProgressOrders = (data?.data || []).filter((o: { status: string }) => o.status === 'IN_PROGRESS').slice(0, 5);

  const columns = [
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'product',
      label: 'Product',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.product as { name: string })?.name || '—',
    },
    { key: 'quantity', label: 'Qty' },
    { key: 'completedQty', label: 'Completed' },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'machine',
      label: 'Machine',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.machine as { name: string })?.name || 'Unassigned',
    },
    {
      key: 'scheduledStart',
      label: 'Scheduled',
      render: (val: unknown) => (val ? formatDate(val as string) : '—'),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const st = row.status as string;
        const id = row.id as string;
        if (st === 'PLANNED' || st === 'SCHEDULED') {
          return (
            <Button size="sm" loading={startMutation.isPending} onClick={() => startMutation.mutate(id)}>
              <Play className="h-3 w-3 mr-1" /> Start
            </Button>
          );
        }
        if (st === 'IN_PROGRESS') {
          return (
            <Button size="sm" variant="secondary" onClick={() => setCompletingId(id)}>
              <CheckCircle className="h-3 w-3 mr-1" /> Complete
            </Button>
          );
        }
        return null;
      },
    },
  ];

  const toolbarActions =
    canCreate &&
    (activeTab === 0 || activeTab === 1 ? (
      <Button size="sm" onClick={() => setCreateModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New Order
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        title="Production"
        subtitle="Manage production orders, scheduling, and manufacturing execution"
        action={
          statusCount(kpis, 'IN_PROGRESS') > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <Factory className="h-4 w-4 mr-1.5 text-orange-500" />
              {statusCount(kpis, 'IN_PROGRESS')} in progress
            </Button>
          ) : undefined
        }
      />

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard
            title="Active orders"
            value={kpis.productionOrders}
            icon={<Factory className="h-5 w-5 text-white" />}
            color="from-primary-500 to-indigo-600"
          />
          <StatCard
            title="In progress"
            value={statusCount(kpis, 'IN_PROGRESS')}
            icon={<Clock className="h-5 w-5 text-white" />}
            color="from-orange-500 to-amber-600"
          />
          <StatCard
            title="Scheduled"
            value={statusCount(kpis, 'SCHEDULED')}
            icon={<Calendar className="h-5 w-5 text-white" />}
            color="from-violet-500 to-purple-600"
          />
          <StatCard
            title="Awaiting production"
            value={kpis.ordersAwaitingProduction}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-teal-600"
          />
        </div>
      )}

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <div className="space-y-4">
          {canCreate && (
            <QuickActionGrid>
              <QuickActionCard
                label="New production order"
                desc="Schedule manufacturing run"
                icon={Plus}
                color="bg-emerald-50 text-emerald-600 border-emerald-100"
                onClick={() => setCreateModalOpen(true)}
              />
              <QuickActionCard
                label="View in progress"
                desc="Orders currently on the floor"
                icon={Factory}
                color="bg-orange-50 text-orange-600 border-orange-100"
                onClick={() => { setStatusFilter('IN_PROGRESS'); setPage(1); goToTab(1); }}
              />
              <QuickActionCard
                label="All orders"
                desc="Full production schedule"
                icon={Calendar}
                color="bg-violet-50 text-violet-600 border-violet-100"
                onClick={() => goToTab(1)}
              />
            </QuickActionGrid>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="In progress"
              action={
                inProgressOrders.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('IN_PROGRESS'); goToTab(1); }}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {inProgressOrders.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No active production" description="Start a planned order to begin manufacturing." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {inProgressOrders.map((order: { id: string; orderNumber: string; product?: { name: string }; quantity: number; completedQty: number }) => (
                    <li key={order.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-600">
                        <Factory className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{order.orderNumber}</p>
                        <p className="text-xs text-slate-500">{order.product?.name || '—'}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-700">
                        {order.completedQty}/{order.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Recent orders"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(1)}>
                  Full schedule
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              }
              padding={false}
            >
              {recentOrders.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No production orders" description="Create an order to start manufacturing." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentOrders.map((order: { id: string; orderNumber: string; status: string; product?: { name: string } }) => (
                    <li key={order.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant={getStatusBadge(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">{order.orderNumber}</p>
                        <p className="text-xs text-slate-400">{order.product?.name || '—'}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {recentOrders.length > 0 && (
            <Card title="Schedule snapshot" action={<Button variant="ghost" size="sm" onClick={() => goToTab(1)}>View all</Button>} padding={false}>
              <Table columns={columns.filter((c) => c.key !== 'actions')} data={recentOrders} embedded />
            </Card>
          )}
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search orders…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="sm:max-w-md"
            />
            <Select
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(data?.data?.length || 0) === 0 && !isLoading ? (
            <div className="p-6">
              <EmptyState
                title="No production orders"
                description="Create a production order from sales or manually."
                action={
                  canCreate ? (
                    <Button onClick={() => setCreateModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      New production order
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={columns} data={data?.data || []} loading={isLoading} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={data?.pagination} page={page} onPageChange={setPage} label="orders" />
          </div>
        </DataPanel>
      )}

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New Production Order" size="lg">
        <ProductionOrderForm onSuccess={() => setCreateModalOpen(false)} onCancel={() => setCreateModalOpen(false)} />
      </Modal>

      <Modal open={completingId !== null} onClose={() => setCompletingId(null)} title="Complete Production" size="md">
        {completingId && (
          <CompleteProductionForm
            productionId={completingId}
            onSuccess={() => setCompletingId(null)}
            onCancel={() => setCompletingId(null)}
          />
        )}
      </Modal>
    </div>
  );
}
