import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  ClipboardCheck,
  CheckCircle,
  XCircle,
  Percent,
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

const tabs = ['Inspections'];

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
    enabled: activeTab === 0,
  });

  const goToTab = (index: number) => {
    setActiveTab(index);
  };

  const openDetail = (inspection: QualityInspection) => {
    setSelected(inspection);
    setDetailOpen(true);
  };

  const inspections = (data?.data as QualityInspection[]) || [];

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
        const product = row.product as { name: string; sku: string } | undefined;
        if (gr?.grnNumber) return gr.grnNumber;
        if (po?.orderNumber) return po.orderNumber;
        if (product?.name) return product.sku ? `${product.sku} — ${product.name}` : product.name;
        return '—';
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
    canCreate && activeTab === 0 ? (
      <Button size="sm" onClick={() => setModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Inspection
      </Button>
    ) : undefined;

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard
            title="Pending"
            value={stats.pending}
            icon={<ClipboardCheck className="h-5 w-5 text-white" />}
            color="from-cyan-500 to-cyan-700"
            onClick={() => { setStatus('PENDING'); setPage(1); goToTab(0); }}
          />
          <StatCard
            title="Passed"
            value={stats.passed}
            icon={<CheckCircle className="h-5 w-5 text-white" />}
            color="from-violet-500 to-violet-700"
            onClick={() => { setStatus('PASSED'); setPage(1); goToTab(0); }}
          />
          <StatCard
            title="Failed"
            value={stats.failed}
            icon={<XCircle className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-emerald-700"
            onClick={() => { setStatus('FAILED'); setPage(1); goToTab(0); }}
          />
          <StatCard
            title="Pass Rate"
            value={`${stats.passRate}%`}
            icon={<Percent className="h-5 w-5 text-white" />}
            color="from-orange-500 to-orange-700"
            onClick={() => { setStatus(''); setPage(1); goToTab(0); }}
          />
          <StatCard
            title="Total Inspections"
            value={stats.total}
            icon={<ClipboardCheck className="h-5 w-5 text-white" />}
            color="from-rose-500 to-rose-700"
            onClick={() => { setStatus(''); setPage(1); goToTab(0); }}
          />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.pending > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(0); }}>
              <ClipboardCheck className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pending} pending
            </Button>
          ) : stats && stats.failed > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('FAILED'); setPage(1); goToTab(0); }}>
              <XCircle className="h-4 w-4 mr-1.5 text-red-500" />
              {stats.failed} failed
            </Button>
          ) : undefined
        }
      />

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <DataPanel>
          <div className="panel-filters">
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
              {selected.product && !selected.productionOrder && (
                <div><p className="text-slate-500">Product</p><p className="font-semibold">{selected.product.sku} — {selected.product.name}</p></div>
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
