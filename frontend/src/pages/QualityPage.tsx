import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, ClipboardCheck, CheckCircle, XCircle, Percent } from 'lucide-react';
import { qualityApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  StatCard,
  Card,
  formatDate,
  getStatusBadge,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { QualityForm } from '../components/forms/QualityForm';
import { QualityUpdatePanel } from '../components/forms/QualityUpdatePanel';
import { useAuth } from '../contexts/AuthContext';
import { QualityInspection, QualityStats } from '../types';

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
  });

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
        return gr?.grnNumber || po?.orderNumber || '-';
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

  const renderPagination = () =>
    data?.pagination && data.pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {data.pagination.page} of {data.pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader
        subtitle="Incoming, production, and finished product inspections"
        action={
          canCreate ? (
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Inspection
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Pending" value={stats.pending} icon={<ClipboardCheck className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Passed" value={stats.passed} icon={<CheckCircle className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Failed" value={stats.failed} icon={<XCircle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Pass Rate" value={`${stats.passRate}%`} icon={<Percent className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <Input placeholder="Search inspections…" className="max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select options={TYPE_OPTIONS} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-40" />
        <Select options={STATUS_OPTIONS} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40" />
      </div>

      {isError ? (
        <Card>
          <p className="text-red-600 text-sm mb-3">Failed to load inspections.</p>
          <Button size="sm" onClick={() => refetch()}>Retry</Button>
        </Card>
      ) : (
        <>
          <Table
            columns={columns}
            data={(data?.data as QualityInspection[]) || []}
            loading={isLoading}
            onRowClick={(row) => { setSelected(row as unknown as QualityInspection); setDetailOpen(true); }}
          />
          {renderPagination()}
        </>
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
