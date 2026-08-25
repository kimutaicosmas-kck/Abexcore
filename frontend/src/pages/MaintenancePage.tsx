import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Cog, AlertTriangle, CheckCircle2, ChevronRight, Calendar } from 'lucide-react';
import { maintenanceApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  StatCard,
  StatGrid,
  Card,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
  ConfirmDialog,
  PageQueryStatus,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { MaintenanceForm } from '../components/forms/MaintenanceForm';
import { MachineForm } from '../components/forms/MachineForm';
import { useAuth } from '../contexts/AuthContext';
import { Machine, MaintenanceRequest, MaintenanceStats } from '../types';

const tabs = ['Machines', 'Requests'];

const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'OVERDUE', label: 'Overdue' },
];

export function MaintenancePage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [machineModalOpen, setMachineModalOpen] = useState(false);
  const [selected, setSelected] = useState<MaintenanceRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingCompleteId, setPendingCompleteId] = useState<string | null>(null);

  const canCreate = hasPermission('maintenance:create');
  const canUpdate = hasPermission('maintenance:update');
  const { data: stats } = useQuery({
    queryKey: ['maintenance-stats', search, status],
    queryFn: () =>
      maintenanceApi
        .stats({
          search: search || undefined,
          status: status || undefined,
        })
        .then((r) => r.data.data as MaintenanceStats),
  });

  const { data: machines, isLoading: machLoading, isError: machError, error: machErr, refetch: refetchMachines } = useQuery({
    queryKey: ['maintenance-machines', page, search],
    queryFn: () => maintenanceApi.machines({ page, limit: 12, search: search || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: requests, isLoading: reqLoading, isError: reqError, error: reqErr, refetch: refetchRequests } = useQuery({
    queryKey: ['maintenance-requests', page, search, status],
    queryFn: () =>
      maintenanceApi.requests({ page, limit: 15, search: search || undefined, status: status || undefined }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => maintenanceApi.completeRequest(id, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-stats'] });
      setDetailOpen(false);
      setSelected(null);
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const openDetail = (request: MaintenanceRequest) => {
    setSelected(request);
    setDetailOpen(true);
  };

  const requestColumns = [
    { key: 'machine', label: 'Machine', render: (_: unknown, row: Record<string, unknown>) => (row.machine as { name: string })?.name || '-' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description' },
    { key: 'scheduledDate', label: 'Scheduled', render: (v: unknown) => (v ? formatDate(v as string) : '-') },
    { key: 'status', label: 'Status', render: (v: unknown) => <Badge variant={getStatusBadge(v as string)}>{(v as string).replace(/_/g, ' ')}</Badge> },
    {
      key: 'actions', label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (!canUpdate || row.status === 'COMPLETED') return null;
        return (
          <Button size="sm" loading={completeMutation.isPending} onClick={(e) => { e.stopPropagation(); setPendingCompleteId(row.id as string); }}>
            Complete
          </Button>
        );
      },
    },
  ];

  const toolbarActions =
    canCreate &&
    (activeTab === 0 ? (
      <Button size="sm" onClick={() => setMachineModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Machine
      </Button>
    ) : activeTab === 1 ? (
      <Button size="sm" onClick={() => setRequestModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Schedule Maintenance
      </Button>
    ) : undefined);

  return (
    <div className="space-y-4">
      <PageQueryStatus
        isError={machError || reqError}
        error={machErr || reqErr}
        onRetry={() => {
          void refetchMachines();
          void refetchRequests();
        }}
      />
      {stats && (
        <StatGrid>
          <StatCard title="Machines" value={stats.totalMachines} icon={<Cog className="h-5 w-5 text-white" />} color="from-cyan-500 to-cyan-700" onClick={() => goToTab(0)} />
          <StatCard title="Operational" value={stats.operational} icon={<CheckCircle2 className="h-5 w-5 text-white" />} color="from-violet-500 to-violet-700" onClick={() => goToTab(0)} />
          <StatCard title="Open Requests" value={stats.openRequests} icon={<Wrench className="h-5 w-5 text-white" />} color="from-emerald-500 to-emerald-700" onClick={() => goToTab(1)} />
          <StatCard title="Overdue" value={stats.overdueRequests} icon={<AlertTriangle className="h-5 w-5 text-white" />} color="from-orange-500 to-orange-700" onClick={() => { setStatus('OVERDUE'); setPage(1); goToTab(1); }} className="hidden sm:flex" />
          <StatCard title="Completed (Month)" value={stats.completedMonth} icon={<Calendar className="h-5 w-5 text-white" />} color="from-rose-500 to-rose-700" onClick={() => goToTab(1)} />
        </StatGrid>
      )}

      <PageHeader action={
          stats && stats.overdueRequests > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('OVERDUE'); setPage(1); goToTab(1); }}>
              <AlertTriangle className="h-4 w-4 mr-1.5 text-red-500" />
              {stats.overdueRequests} overdue
            </Button>
          ) : stats && stats.openRequests > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <Wrench className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.openRequests} open requests
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => { setActiveTab(t); setPage(1); setSearch(''); setStatus(''); }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <DataPanel>
          <div className="panel-filters">
            <Input
              placeholder="Search machines…"
              className="sm:max-w-md"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          {(machines?.data?.length || 0) === 0 && !machLoading ? (
            <div className="p-6">
              <EmptyState
                title="No machines found"
                description="Register production equipment to track maintenance."
                action={
                  canCreate ? (
                    <Button onClick={() => setMachineModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Machine
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <div className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(machines?.data as Machine[] || []).map((machine) => (
                <Card key={machine.id}>
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <h3 className="font-semibold text-sm text-slate-900">{machine.name}</h3>
                    <Badge variant={machine.status === 'operational' ? 'success' : 'warning'}>{machine.status}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{machine.code} · {machine.type}</p>
                  {machine.capacity && <p className="text-xs text-slate-600 mt-1">Capacity: {machine.capacity}</p>}
                  {machine.location && <p className="text-xs text-slate-600">Location: {machine.location}</p>}
                </Card>
              ))}
            </div>
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={machines?.pagination} page={page} onPageChange={setPage} label="machines" />
          </div>
        </DataPanel>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="panel-filters">
            <Input
              placeholder="Search requests…"
              className="sm:max-w-md"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <Select
              options={STATUS_FILTER}
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(requests?.data?.length || 0) === 0 && !reqLoading ? (
            <div className="p-6">
              <EmptyState
                title="No maintenance requests found"
                description="Schedule maintenance for machines and equipment."
                action={
                  canCreate ? (
                    <Button onClick={() => setRequestModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Schedule Maintenance
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              {status === 'OVERDUE' && (stats?.overdueRequests ?? 0) > 0 && (
                <div className="px-4 pt-4">
                  <Alert variant="warning">
                    <strong>{stats?.overdueRequests}</strong> request(s) are overdue. Complete or reschedule them promptly.
                  </Alert>
                </div>
              )}
              <Table
                columns={requestColumns}
                data={(requests?.data as MaintenanceRequest[]) || []}
                loading={reqLoading}
                onRowClick={(row) => openDetail(row as unknown as MaintenanceRequest)}
                embedded
              />
            </>
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={requests?.pagination} page={page} onPageChange={setPage} label="requests" />
          </div>
        </DataPanel>
      )}

      <Modal open={requestModalOpen} onClose={() => setRequestModalOpen(false)} title="Schedule Maintenance" size="lg">
        <MaintenanceForm onSuccess={() => setRequestModalOpen(false)} onCancel={() => setRequestModalOpen(false)} />
      </Modal>

      <Modal open={machineModalOpen} onClose={() => setMachineModalOpen(false)} title="Add Machine" size="md">
        <MachineForm onSuccess={() => setMachineModalOpen(false)} onCancel={() => setMachineModalOpen(false)} />
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null); }} title="Maintenance Request" size="md">
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-slate-500">Machine</p><p className="font-semibold">{selected.machine?.name}</p></div>
              <div><p className="text-slate-500">Type</p><p className="font-semibold">{selected.type}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selected.status)}>{selected.status}</Badge></div>
              {selected.cost > 0 && <div><p className="text-slate-500">Cost</p><p className="font-semibold">{formatCurrency(Number(selected.cost))}</p></div>}
            </div>
            <Card title="Description"><p>{selected.description}</p></Card>
            {canUpdate && selected.status !== 'COMPLETED' && (
              <div className="flex justify-end">
                <Button loading={completeMutation.isPending} onClick={() => setPendingCompleteId(selected.id)}>Mark Complete</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingCompleteId}
        title="Complete maintenance request?"
        message="This marks the maintenance work as completed."
        confirmLabel="Mark Complete"
        loading={completeMutation.isPending}
        onCancel={() => setPendingCompleteId(null)}
        onConfirm={() => {
          if (!pendingCompleteId) return;
          completeMutation.mutate(pendingCompleteId, { onSettled: () => setPendingCompleteId(null) });
        }}
      />
    </div>
  );
}
