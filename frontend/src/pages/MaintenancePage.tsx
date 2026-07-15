import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Wrench, Cog, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { maintenanceApi } from '../services/api';
import {
  PageHeader, Table, Badge, Button, Input, Select, StatCard, Card,
  formatCurrency, formatDate, getStatusBadge, PageToolbar,
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

  const canCreate = hasPermission('maintenance:create');
  const canUpdate = hasPermission('maintenance:update');

  const { data: stats } = useQuery({
    queryKey: ['maintenance-stats'],
    queryFn: () => maintenanceApi.stats().then((r) => r.data.data as MaintenanceStats),
  });

  const { data: machines, isLoading: machLoading } = useQuery({
    queryKey: ['maintenance-machines', page, search],
    queryFn: () => maintenanceApi.machines({ page, limit: 12, search: search || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: requests, isLoading: reqLoading } = useQuery({
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
          <Button size="sm" loading={completeMutation.isPending} onClick={(e) => { e.stopPropagation(); completeMutation.mutate(row.id as string); }}>
            Complete
          </Button>
        );
      },
    },
  ];

  const renderPagination = (pagination: { page: number; totalPages: number } | undefined) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader subtitle="Machines, schedules, and repair requests" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Machines" value={stats.totalMachines} icon={<Cog className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Operational" value={stats.operational} icon={<CheckCircle2 className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Open Requests" value={stats.openRequests} icon={<Wrench className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Overdue" value={stats.overdueRequests} icon={<AlertTriangle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
        </div>
      )}

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => { setActiveTab(t); setPage(1); setSearch(''); setStatus(''); }}
        actions={canCreate ? (
          <Button onClick={() => (activeTab === 0 ? setMachineModalOpen(true) : setRequestModalOpen(true))}>
            <Plus className="h-4 w-4 mr-2" />{activeTab === 0 ? 'Add Machine' : 'Schedule Maintenance'}
          </Button>
        ) : undefined}
      />

      {activeTab === 0 && (
        <>
          <div className="mb-4 max-w-sm"><Input placeholder="Search machines…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
          {renderPagination(machines?.pagination)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search requests…" className="max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select options={STATUS_FILTER} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44" />
          </div>
          <Table
            columns={requestColumns}
            data={(requests?.data as MaintenanceRequest[]) || []}
            loading={reqLoading}
            onRowClick={(row) => { setSelected(row as unknown as MaintenanceRequest); setDetailOpen(true); }}
          />
          {renderPagination(requests?.pagination)}
        </>
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
                <Button loading={completeMutation.isPending} onClick={() => completeMutation.mutate(selected.id)}>Mark Complete</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
