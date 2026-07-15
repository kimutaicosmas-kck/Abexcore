import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Package, MapPin, Car } from 'lucide-react';
import { deliveryApi } from '../services/api';
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
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { DeliveryForm } from '../components/forms/DeliveryForm';
import { VehicleForm } from '../components/forms/VehicleForm';
import { useAuth } from '../contexts/AuthContext';
import { DeliveryNote, DeliveryStats, Vehicle } from '../types';

const tabs = ['Deliveries', 'Vehicles'];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'RETURNED', label: 'Returned' },
];

const NEXT_DELIVERY_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'ASSIGNED', label: 'Assign' },
  ASSIGNED: { status: 'IN_TRANSIT', label: 'Start Transit' },
  IN_TRANSIT: { status: 'DELIVERED', label: 'Mark Delivered' },
};

export function DeliveryPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [vehPage, setVehPage] = useState(1);
  const [search, setSearch] = useState('');
  const [vehSearch, setVehSearch] = useState('');
  const [status, setStatus] = useState('');
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [selected, setSelected] = useState<DeliveryNote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const canCreate = hasPermission('delivery:create');
  const canUpdate = hasPermission('delivery:update');

  const { data: stats } = useQuery({
    queryKey: ['delivery-stats'],
    queryFn: () => deliveryApi.stats().then((r) => r.data.data as DeliveryStats),
  });

  const { data: deliveries, isLoading } = useQuery({
    queryKey: ['deliveries', page, search, status],
    queryFn: () =>
      deliveryApi
        .list({ page, limit: 15, search: search || undefined, status: status || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: vehicles, isLoading: vehLoading } = useQuery({
    queryKey: ['vehicles', vehPage, vehSearch],
    queryFn: () =>
      deliveryApi
        .vehicles({ page: vehPage, limit: 15, search: vehSearch || undefined })
        .then((r) => r.data),
    enabled: activeTab === 1,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, proofOfDelivery }: { id: string; status: string; proofOfDelivery?: string }) =>
      deliveryApi.updateStatus(id, { status, proofOfDelivery }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setDetailOpen(false);
      setSelected(null);
    },
  });

  const deliveryColumns = [
    { key: 'deliveryNo', label: 'Delivery #' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.salesOrder as { customer: { name: string } })?.customer?.name || '-',
    },
    {
      key: 'order',
      label: 'Sales Order',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.salesOrder as { orderNumber: string })?.orderNumber || '-',
    },
    {
      key: 'vehicle',
      label: 'Vehicle',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.vehicle as { registration: string })?.registration || 'Unassigned',
    },
    {
      key: 'scheduledDate',
      label: 'Scheduled',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (!canUpdate) return null;
        const st = row.status as string;
        const next = NEXT_DELIVERY_STATUS[st];
        if (!next) return null;
        return (
          <Button
            size="sm"
            loading={statusMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({ id: row.id as string, status: next.status });
            }}
          >
            {next.label}
          </Button>
        );
      },
    },
  ];

  const vehicleColumns = [
    { key: 'registration', label: 'Registration' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'capacity', label: 'Capacity' },
  ];

  const renderPagination = (
    pagination: { page: number; totalPages: number } | undefined,
    pg: number,
    setPg: (fn: (p: number) => number) => void
  ) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={pg <= 1} onClick={() => setPg((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={pg >= pagination.totalPages} onClick={() => setPg((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader subtitle="Delivery notes, routes, vehicles, and proof of delivery" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Pending" value={stats.pending} icon={<Package className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="In Transit" value={stats.inTransit} icon={<Truck className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Delivered Today" value={stats.deliveredToday} icon={<MapPin className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Active Vehicles" value={stats.activeVehicles} icon={<Car className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); setVehPage(1); }}
        actions={
          canCreate ? (
            <Button onClick={() => (activeTab === 0 ? setDeliveryModalOpen(true) : setVehicleModalOpen(true))}>
              <Plus className="h-4 w-4 mr-2" />
              {activeTab === 0 ? 'Add Delivery' : 'Add Vehicle'}
            </Button>
          ) : undefined
        }
      />

      {activeTab === 0 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search deliveries…" className="max-w-sm" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select options={STATUS_OPTIONS} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44" />
          </div>
          <Table
            columns={deliveryColumns}
            data={(deliveries?.data as DeliveryNote[]) || []}
            loading={isLoading}
            onRowClick={(row) => { setSelected(row as unknown as DeliveryNote); setDetailOpen(true); }}
          />
          {renderPagination(deliveries?.pagination, page, setPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search vehicles…" value={vehSearch} onChange={(e) => { setVehSearch(e.target.value); setVehPage(1); }} />
          </div>
          <Table columns={vehicleColumns} data={(vehicles?.data as Vehicle[]) || []} loading={vehLoading} />
          {renderPagination(vehicles?.pagination, vehPage, setVehPage)}
        </>
      )}

      <Modal open={deliveryModalOpen} onClose={() => setDeliveryModalOpen(false)} title="Add Delivery" size="xl">
        <DeliveryForm onSuccess={() => setDeliveryModalOpen(false)} onCancel={() => setDeliveryModalOpen(false)} />
      </Modal>

      <Modal open={vehicleModalOpen} onClose={() => setVehicleModalOpen(false)} title="Add Vehicle" size="md">
        <VehicleForm onSuccess={() => setVehicleModalOpen(false)} onCancel={() => setVehicleModalOpen(false)} />
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null); }} title="Delivery Details" size="lg">
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Delivery #</p><p className="font-semibold">{selected.deliveryNo}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{selected.salesOrder?.customer?.name}</p></div>
              <div><p className="text-slate-500">Sales Order</p><p className="font-semibold">{selected.salesOrder?.orderNumber}</p></div>
              <div><p className="text-slate-500">Vehicle</p><p className="font-semibold">{selected.vehicle?.registration || 'Unassigned'}</p></div>
              <div><p className="text-slate-500">Scheduled</p><p className="font-semibold">{selected.scheduledDate ? formatDate(selected.scheduledDate) : '-'}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selected.status)}>{selected.status.replace(/_/g, ' ')}</Badge></div>
              {selected.deliveredAt && (
                <div><p className="text-slate-500">Delivered At</p><p className="font-semibold">{formatDate(selected.deliveredAt)}</p></div>
              )}
            </div>
            {selected.items?.length > 0 && (
              <Card title="Items">
                {selected.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>Product {item.productId.slice(0, 8)}…</span>
                    <span>Qty: {item.quantity}</span>
                  </div>
                ))}
              </Card>
            )}
            {canUpdate && NEXT_DELIVERY_STATUS[selected.status] && (
              <div className="flex justify-end gap-2">
                <Button
                  loading={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: selected.id,
                      status: NEXT_DELIVERY_STATUS[selected.status].status,
                    })
                  }
                >
                  {NEXT_DELIVERY_STATUS[selected.status].label}
                </Button>
              </div>
            )}
            {canUpdate && selected.status === 'IN_TRANSIT' && (
              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  loading={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: selected.id,
                      status: 'DELIVERED',
                      proofOfDelivery: 'Confirmed by customer',
                    })
                  }
                >
                  Mark Delivered with POD
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
