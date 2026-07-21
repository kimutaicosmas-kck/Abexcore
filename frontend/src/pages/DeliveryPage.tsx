import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Package, MapPin, Bike, Container, AlertTriangle, ChevronRight } from 'lucide-react';
import { deliveryApi } from '../services/api';
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
  EmptyState,
  DataPanel,
  TablePagination,
  formatDate,
  getStatusBadge,
  PageToolbar,
  ConfirmDialog,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { DeliveryForm } from '../components/forms/DeliveryForm';
import { VehicleForm } from '../components/forms/VehicleForm';
import { useAuth } from '../contexts/AuthContext';
import { DeliveryNote, DeliveryStats, Vehicle, VEHICLE_TYPE_OPTIONS, vehicleTypeLabel, VehicleType } from '../types';

const tabs = ['Overview', 'Deliveries', 'Vehicles'];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_TRANSIT', label: 'In Transit' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'RETURNED', label: 'Returned' },
];

const VEHICLE_TYPE_COLORS: Record<VehicleType, string> = {
  MOTORCYCLE: 'from-sky-500 to-cyan-600',
  TRUCK: 'from-primary-500 to-indigo-600',
  LORRY: 'from-amber-500 to-orange-600',
};

function vehicleTypeBadgeVariant(type: string): 'info' | 'success' | 'warning' {
  if (type === 'MOTORCYCLE') return 'info';
  if (type === 'LORRY') return 'warning';
  return 'success';
}

function formatVehicleLabel(vehicle?: { registration: string; type?: string; make?: string; model?: string }) {
  if (!vehicle) return 'Unassigned';
  const type = vehicle.type ? `${vehicleTypeLabel(vehicle.type)} · ` : '';
  const detail = vehicle.make ? ` (${vehicle.make}${vehicle.model ? ` ${vehicle.model}` : ''})` : '';
  return `${type}${vehicle.registration}${detail}`;
}

const NEXT_DELIVERY_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'ASSIGNED', label: 'Assign' },
  ASSIGNED: { status: 'IN_TRANSIT', label: 'Start Transit' },
  IN_TRANSIT: { status: 'DELIVERED', label: 'Mark Delivered' },
};

function getDeliveryActions(status: string, isDriver: boolean) {
  if (isDriver) {
    if (status === 'ASSIGNED') {
      return [
        { status: 'IN_TRANSIT', label: 'Start Trip' },
        { status: 'DELIVERED', label: 'Mark Delivered' },
      ];
    }
    if (status === 'IN_TRANSIT') {
      return [{ status: 'DELIVERED', label: 'Mark Delivered' }];
    }
    return [];
  }

  const next = NEXT_DELIVERY_STATUS[status];
  return next ? [next] : [];
}

export function DeliveryPage() {
  const queryClient = useQueryClient();
  const { hasPermission, isDriver } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [vehPage, setVehPage] = useState(1);
  const [search, setSearch] = useState('');
  const [vehSearch, setVehSearch] = useState('');
  const [vehType, setVehType] = useState('');
  const [status, setStatus] = useState('');
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [selected, setSelected] = useState<DeliveryNote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    id: string;
    status: string;
    label: string;
    proofOfDelivery?: string;
  } | null>(null);

  const canCreate = hasPermission('delivery:create') && !isDriver;
  const canUpdate = hasPermission('delivery:update');
  const visibleTabs = isDriver ? ['My Deliveries'] : tabs;
  const showOverview = !isDriver && activeTab === 0;
  const showDeliveries = isDriver ? activeTab === 0 : activeTab === 1;
  const showVehicles = !isDriver && activeTab === 2;

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
    enabled: isDriver ? activeTab === 0 : activeTab === 0 || activeTab === 1,
  });

  const { data: vehicles, isLoading: vehLoading } = useQuery({
    queryKey: ['vehicles', vehPage, vehSearch, vehType],
    queryFn: () =>
      deliveryApi
        .vehicles({ page: vehPage, limit: 15, search: vehSearch || undefined, type: vehType || undefined })
        .then((r) => r.data),
    enabled: !isDriver && (activeTab === 0 || activeTab === 2),
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

  const goToTab = (index: number) => setActiveTab(index);

  const openDetail = (note: DeliveryNote) => {
    setSelected(note);
    setDetailOpen(true);
  };

  const recentDeliveries = showOverview ? ((deliveries?.data as DeliveryNote[]) || []).slice(0, 6) : [];
  const activeDeliveries = showOverview
    ? ((deliveries?.data as DeliveryNote[]) || []).filter((d) => ['PENDING', 'ASSIGNED', 'IN_TRANSIT'].includes(d.status)).slice(0, 5)
    : [];

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
      render: (_: unknown, row: Record<string, unknown>) => {
        const vehicle = row.vehicle as { registration: string; type?: string; make?: string; model?: string } | undefined;
        return formatVehicleLabel(vehicle);
      },
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
        const actions = getDeliveryActions(st, isDriver);
        if (!actions.length) return null;
        const primary = actions[actions.length - 1];
        return (
          <Button
            size="sm"
            loading={statusMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              setPendingStatusChange({
                id: row.id as string,
                status: primary.status,
                label: primary.label,
                proofOfDelivery: primary.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
              });
            }}
          >
            {primary.label}
          </Button>
        );
      },
    },
  ];

  const vehicleColumns = [
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => (
        <Badge variant={vehicleTypeBadgeVariant(val as string)}>{vehicleTypeLabel(val as string)}</Badge>
      ),
    },
    { key: 'registration', label: 'Registration' },
    { key: 'make', label: 'Make' },
    { key: 'model', label: 'Model' },
    { key: 'capacity', label: 'Capacity' },
  ];

  const toolbarActions =
    canCreate &&
    (showDeliveries ? (
      <Button size="sm" onClick={() => setDeliveryModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Delivery
      </Button>
    ) : showVehicles ? (
      <Button size="sm" onClick={() => setVehicleModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Vehicle
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        action={
          stats && stats.inTransit > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('IN_TRANSIT'); setPage(1); goToTab(1); }}>
              <Truck className="h-4 w-4 mr-1.5 text-primary-500" />
              {stats.inTransit} in transit
            </Button>
          ) : stats && stats.pending > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(1); }}>
              <Package className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pending} pending
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <StatGrid>
          <StatCard title="Pending" value={stats.pending} icon={<Package className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="In Transit" value={stats.inTransit} icon={<Truck className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Delivered Today" value={stats.deliveredToday} icon={<MapPin className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Motorcycles" value={stats.motorcycles ?? 0} icon={<Bike className="h-5 w-5 text-white" />} color="from-sky-500 to-cyan-600" />
          <StatCard title="Trucks" value={stats.trucks ?? 0} icon={<Truck className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
          <StatCard title="Lorries" value={stats.lorries ?? 0} icon={<Container className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
        </StatGrid>
      )}

      <PageToolbar
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); setVehPage(1); }}
        actions={toolbarActions}
      />

      {showOverview && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Active deliveries"
              action={
                activeDeliveries.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => goToTab(1)}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {activeDeliveries.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No active deliveries" description="Pending and in-transit notes appear here." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {activeDeliveries.map((note) => (
                    <li
                      key={note.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => openDetail(note)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{note.deliveryNo}</p>
                        <p className="text-xs text-slate-500">{note.salesOrder?.customer?.name || '—'}</p>
                      </div>
                      <Badge variant={getStatusBadge(note.status)}>{note.status.replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Recent deliveries"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(1)}>
                  Full list
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              }
              padding={false}
            >
              {recentDeliveries.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No deliveries yet" description="Create a delivery note from a ready sales order." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentDeliveries.map((note) => (
                    <li
                      key={note.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => openDetail(note)}
                    >
                      <Badge variant={getStatusBadge(note.status)}>{note.status.replace(/_/g, ' ')}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">{note.deliveryNo}</p>
                        <p className="text-xs text-slate-400">{note.salesOrder?.orderNumber || '—'}</p>
                      </div>
                      <span className="text-xs text-slate-500 shrink-0">
                        {note.scheduledDate ? formatDate(note.scheduledDate) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {stats && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { type: 'MOTORCYCLE' as VehicleType, label: 'Motorcycles', count: stats.motorcycles ?? 0, icon: Bike, desc: 'City & express runs' },
                { type: 'TRUCK' as VehicleType, label: 'Trucks', count: stats.trucks ?? 0, icon: Truck, desc: 'Medium regional loads' },
                { type: 'LORRY' as VehicleType, label: 'Lorries', count: stats.lorries ?? 0, icon: Container, desc: 'Bulk & long haul' },
              ]).map((fleet) => (
                <button
                  key={fleet.type}
                  type="button"
                  onClick={() => { setVehType(fleet.type); setVehPage(1); goToTab(2); }}
                  className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow text-left"
                >
                  <div className={`h-1.5 bg-gradient-to-r ${VEHICLE_TYPE_COLORS[fleet.type]}`} />
                  <div className="p-4 flex items-start gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${VEHICLE_TYPE_COLORS[fleet.type]} text-white`}>
                      <fleet.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{fleet.label}</p>
                      <p className="text-2xl font-bold text-slate-900 tabular-nums">{fleet.count}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{fleet.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {showDeliveries && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search deliveries…"
              className="sm:max-w-md"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            <Select
              options={STATUS_OPTIONS}
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(deliveries?.data?.length || 0) === 0 && !isLoading ? (
            <div className="p-6">
              <EmptyState
                title="No deliveries found"
                description={isDriver ? 'Assigned deliveries will appear here.' : 'Create a delivery note from a ready sales order.'}
                action={
                  canCreate ? (
                    <Button onClick={() => setDeliveryModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Delivery
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={deliveryColumns}
              data={(deliveries?.data as DeliveryNote[]) || []}
              loading={isLoading}
              onRowClick={(row) => openDetail(row as unknown as DeliveryNote)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={deliveries?.pagination} page={page} onPageChange={setPage} label="deliveries" />
          </div>
        </DataPanel>
      )}

      {showVehicles && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search vehicles…"
              className="sm:max-w-md"
              value={vehSearch}
              onChange={(e) => { setVehSearch(e.target.value); setVehPage(1); }}
            />
            <Select
              options={VEHICLE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              value={vehType}
              onChange={(e) => { setVehType(e.target.value); setVehPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(vehicles?.data?.length || 0) === 0 && !vehLoading ? (
            <div className="p-6">
              <EmptyState
                title="No vehicles found"
                description="Register motorcycles, trucks, or lorries to assign deliveries."
                action={
                  canCreate ? (
                    <Button onClick={() => setVehicleModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Vehicle
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={vehicleColumns} data={(vehicles?.data as Vehicle[]) || []} loading={vehLoading} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={vehicles?.pagination} page={vehPage} onPageChange={setVehPage} label="vehicles" />
          </div>
        </DataPanel>
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
              <div><p className="text-slate-500">Vehicle</p><p className="font-semibold">{formatVehicleLabel(selected.vehicle)}</p></div>
              {selected.driver && (
                <div><p className="text-slate-500">Driver</p><p className="font-semibold">{selected.driver.firstName} {selected.driver.lastName}</p></div>
              )}
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
            {canUpdate && getDeliveryActions(selected.status, isDriver).length > 0 && (
              <div className="flex flex-wrap justify-end gap-2">
                {getDeliveryActions(selected.status, isDriver).map((action) => (
                  <Button
                    key={action.status}
                    variant={action.status === 'DELIVERED' ? 'primary' : 'secondary'}
                    loading={statusMutation.isPending}
                    onClick={() =>
                      setPendingStatusChange({
                        id: selected.id,
                        status: action.status,
                        label: action.label,
                        proofOfDelivery:
                          action.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
                      })
                    }
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingStatusChange}
        title="Update delivery status?"
        message={
          pendingStatusChange
            ? `This will change the delivery to "${pendingStatusChange.status.replace(/_/g, ' ')}". Continue?`
            : ''
        }
        confirmLabel={pendingStatusChange?.label || 'Confirm'}
        loading={statusMutation.isPending}
        onCancel={() => setPendingStatusChange(null)}
        onConfirm={() => {
          if (!pendingStatusChange) return;
          statusMutation.mutate(
            {
              id: pendingStatusChange.id,
              status: pendingStatusChange.status,
              proofOfDelivery: pendingStatusChange.proofOfDelivery,
            },
            { onSettled: () => setPendingStatusChange(null) }
          );
        }}
      />
    </div>
  );
}
