import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  ClipboardCheck,
  CheckCircle,
  XCircle,
  Percent,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { qualityApi } from '../services/api';
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
  formatDate,
  getStatusBadge,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { QualityForm } from '../components/forms/QualityForm';
import { QualityUpdatePanel } from '../components/forms/QualityUpdatePanel';
import { useAuth } from '../contexts/AuthContext';
import { QualityInspection, QualityStats } from '../types';

const tabs = ['Overview', 'Inspections'];

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'production', label: 'Production' },
  { value: 'finished', label: 'Finished' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CONDITIONAL', label: 'Conditional' },
];

export function QualityPage() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<QualityInspection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const canCreate = hasPermission('quality:create');
  const canUpdate = hasPermission('quality:update');
  const { data: stats } = useQuery({
    queryKey: ['quality-stats'],
    queryFn: () => qualityApi.stats().then((r) => r.data.data as QualityStats),
  });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['quality', page, search, status, type],
    queryFn: () =>
      qualityApi
        .list({ page, limit: 15, search: search || undefined, status: status || undefined, type: type || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const goToTab = (index: number) => {
    setActiveTab(index);
  };

  const openDetail = (inspection: QualityInspection) => {
    setSelected(inspection);
    setDetailOpen(true);
  };

  const inspections = (data?.data as QualityInspection[]) || [];
  const recentInspections = activeTab === 0 ? inspections.slice(0, 6) : [];
  const pendingInspections = activeTab === 0 ? inspections.filter((i) => i.status === 'PENDING').slice(0, 5) : [];
  const failedInspections = activeTab === 0 ? inspections.filter((i) => i.status === 'FAILED').slice(0, 5) : [];

  const columns = [
    { key: 'inspectionNo', label: 'Inspection #' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => String(val).charAt(0).toUpperCase() + String(val).slice(1),
    },
    {
      key: 'reference',
      label: 'Reference',
      render: (_: unknown, row: Record<string, unknown>) => {
        const gr = row.goodsReceipt as { grnNumber: string } | undefined;
        const po = row.productionOrder as { orderNumber: string } | undefined;
        return gr?.grnNumber || po?.orderNumber || '—';
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{val as string}</Badge>
      ),
    },
    { key: 'defectsFound', label: 'Defects' },
    {
      key: 'inspectedAt',
      label: 'Inspected',
      render: (val: unknown) => (val ? formatDate(val as string) : 'Pending'),
    },
  ];

  const toolbarActions =
    canCreate &&
    (activeTab === 0 || activeTab === 1 ? (
      <Button size="sm" onClick={() => setModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Inspection
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        action={
          stats && stats.pending > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(1); }}>
              <ClipboardCheck className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pending} pending
            </Button>
          ) : stats && stats.failed > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('FAILED'); setPage(1); goToTab(1); }}>
              <XCircle className="h-4 w-4 mr-1.5 text-red-500" />
              {stats.failed} failed
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <StatGrid>
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={<ClipboardCheck className="h-5 w-5 text-white" />}
            color="from-amber-500 to-orange-600"
          />
          <StatCard
            title="Passed"
            value={stats.passed}
            icon={<CheckCircle className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-teal-600"
          />
          <StatCard
            title="Failed"
            value={stats.failed}
            icon={<XCircle className="h-5 w-5 text-white" />}
            color="from-red-500 to-rose-600"
          />
          <StatCard
            title="Pass Rate"
            value={`${stats.passRate}%`}
            icon={<Percent className="h-5 w-5 text-white" />}
            color="from-primary-500 to-indigo-600"
          />
        </StatGrid>
      )}

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Pending inspections"
              action={
                pendingInspections.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(1); }}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {pendingInspections.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No pending inspections" description="All inspections have been completed." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pendingInspections.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/30 cursor-pointer"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <ClipboardCheck className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{item.inspectionNo}</p>
                        <p className="text-xs text-slate-500 capitalize">{item.type}</p>
                      </div>
                      <Badge variant="warning">Pending</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Failed inspections"
              action={
                failedInspections.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => { setStatus('FAILED'); setPage(1); goToTab(1); }}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {failedInspections.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No failed inspections" description="Quality checks are passing." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {failedInspections.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/30 cursor-pointer"
                      onClick={() => openDetail(item)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{item.inspectionNo}</p>
                        <p className="text-xs text-slate-500">
                          {item.defectsFound} defect{item.defectsFound !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <Badge variant="danger">Failed</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search inspections…"
              className="sm:max-w-md"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <Select
              options={TYPE_OPTIONS}
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="sm:w-40"
            />
            <Select
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="sm:w-40"
            />
          </div>

          {isError && (
            <div className="px-4 pt-4">
              <Alert variant="error">
                Failed to load inspections.{' '}
                <button type="button" className="underline font-medium" onClick={() => refetch()}>
                  Retry
                </button>
              </Alert>
            </div>
          )}

          {(inspections.length || 0) === 0 && !isLoading && !isError ? (
            <div className="p-6">
              <EmptyState
                title="No inspections found"
                description="Try different filters or add a new inspection."
                action={
                  canCreate ? (
                    <Button onClick={() => setModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add inspection
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={columns}
              data={inspections}
              loading={isLoading}
              onRowClick={(row) => openDetail(row as unknown as QualityInspection)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={data?.pagination} page={page} onPageChange={setPage} label="inspections" />
          </div>
        </DataPanel>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Inspection" size="lg">
        <QualityForm onSuccess={() => setModalOpen(false)} onCancel={() => setModalOpen(false)} />
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null); }} title="Inspection Details" size="lg">
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Inspection #</p><p className="font-semibold">{selected.inspectionNo}</p></div>
              <div><p className="text-slate-500">Type</p><p className="font-semibold capitalize">{selected.type}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selected.status)}>{selected.status}</Badge></div>
              <div><p className="text-slate-500">Defects</p><p className="font-semibold">{selected.defectsFound}</p></div>
              {selected.goodsReceipt && (
                <div><p className="text-slate-500">Goods Receipt</p><p className="font-semibold">{selected.goodsReceipt.grnNumber}</p></div>
              )}
              {selected.productionOrder && (
                <div><p className="text-slate-500">Production Order</p><p className="font-semibold">{selected.productionOrder.orderNumber}</p></div>
              )}
            </div>
            {selected.result && (
              <Card title="Result"><p>{selected.result}</p></Card>
            )}
            {selected.correctiveAction && (
              <Card title="Corrective Action"><p>{selected.correctiveAction}</p></Card>
            )}
            {canUpdate && selected.status === 'PENDING' && (
              <div className="flex justify-end">
                <Button onClick={() => { setEditOpen(true); setDetailOpen(false); }}>Update Inspection</Button>
              </div>
            )}
            {canUpdate && selected.status !== 'PENDING' && (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => { setEditOpen(true); setDetailOpen(false); }}>Edit</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={editOpen} onClose={() => { setEditOpen(false); setSelected(null); }} title="Update Inspection" size="md">
        {selected && (
          <QualityUpdatePanel
            inspection={selected}
            onSuccess={() => { setEditOpen(false); setSelected(null); }}
            onCancel={() => { setEditOpen(false); setSelected(selected); setDetailOpen(true); }}
          />
        )}
      </Modal>
    </div>
  );
}
