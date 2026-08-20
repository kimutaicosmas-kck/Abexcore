import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Truck, Package, MapPin, Bike, Container, AlertTriangle, ChevronRight, Download } from 'lucide-react';
import { deliveryApi } from '../services/api';
import { downloadFile } from '../utils/download';
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
  PageQueryStatus,
  Alert,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { DeliveryForm } from '../components/forms/DeliveryForm';
import { VehicleForm } from '../components/forms/VehicleForm';
import { useAuth } from '../contexts/AuthContext';
import { DeliveryNote, DeliveryStats, DeliveryTrip, Vehicle, VEHICLE_TYPE_OPTIONS, vehicleTypeLabel, VehicleType } from '../types';
import { getApiErrorMessage } from '../utils/apiError';

type DriverOption = { id: string; firstName: string; lastName: string; email: string };

const tabs = ['Deliveries', 'Vehicles'];

type DeliveryListRow =
  | { kind: 'trip'; id: string; createdAt: string; trip: DeliveryTrip }
  | { kind: 'note'; id: string; createdAt: string; note: DeliveryNote };

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
  TRUCK: 'from-primary-500 to-primary-700',
  LORRY: 'from-amber-500 to-orange-600',
};

function deliveryRowTime(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortDeliveryRows(rows: DeliveryListRow[]): DeliveryListRow[] {
  return [...rows].sort((a, b) => deliveryRowTime(b.createdAt) - deliveryRowTime(a.createdAt));
}

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

function getDeliveryActions(status: string, isDriver: boolean) {
  // Shared lifecycle: completing a delivery (admin or driver) is the same status for everyone.
  if (status === 'DELIVERED' || status === 'FAILED' || status === 'RETURNED') return [];

  if (status === 'PENDING' && !isDriver) {
    return [{ status: 'ASSIGNED', label: 'Assign' }];
  }

  if (status === 'ASSIGNED') {
    return [
      { status: 'IN_TRANSIT', label: isDriver ? 'Start Trip' : 'Start Transit' },
      { status: 'DELIVERED', label: 'Mark Delivered' },
    ];
  }

  if (status === 'IN_TRANSIT') {
    return [{ status: 'DELIVERED', label: 'Mark Delivered' }];
  }

  return [];
}

function isOpenDeliveryStatus(status: string) {
  return status === 'PENDING' || status === 'ASSIGNED' || status === 'IN_TRANSIT';
}

function canMarkDeliveredStatus(status: string) {
  return status === 'ASSIGNED' || status === 'IN_TRANSIT';
}

function rowStatus(row: DeliveryListRow): string {
  return row.kind === 'trip' ? row.trip.status : row.note.status;
}

function rowTitle(row: DeliveryListRow): string {
  return row.kind === 'trip' ? row.trip.tripNo : row.note.deliveryNo;
}

function selectionKey(kind: 'note' | 'trip', id: string) {
  return `${kind}:${id}`;
}

export function DeliveryPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission, isDriver } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [vehPage, setVehPage] = useState(1);
  const [search, setSearch] = useState('');
  const [vehSearch, setVehSearch] = useState('');
  const [vehType, setVehType] = useState('');
  const [status, setStatus] = useState('');
  /** Empty string = all dates (keeps completions visible for admin and driver). */
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryModalOpen, setDeliveryModalOpen] = useState(false);
  const [prefillOrderIds, setPrefillOrderIds] = useState<string[]>([]);
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [selected, setSelected] = useState<DeliveryNote | null>(null);
  const [selectedTrip, setSelectedTrip] = useState<DeliveryTrip | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    id: string;
    kind: 'note' | 'trip';
    status: string;
    label: string;
    proofOfDelivery?: string;
  } | null>(null);
  const [assignDialog, setAssignDialog] = useState<{
    items: { id: string; kind: 'note' | 'trip'; title: string; status: string }[];
    mode: 'assign' | 'edit';
    driverId: string;
    vehicleId: string;
    scheduledDate: string;
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkDeliverConfirmOpen, setBulkDeliverConfirmOpen] = useState(false);
  const [deliverConfirm, setDeliverConfirm] = useState<{
    id: string;
    kind: 'note' | 'trip';
    label: string;
    stops: {
      deliveryNoteId: string;
      title: string;
      items: { productId: string; dispatchedQty: number }[];
    }[];
  } | null>(null);
  const [actualQtys, setActualQtys] = useState<Record<string, number>>({});
  const [printingId, setPrintingId] = useState<string | null>(null);

  const printDeliveryNote = async (id: string, deliveryNo: string) => {
    setPrintingId(id);
    try {
      await downloadFile(deliveryApi.pdfPath(id), `${deliveryNo}.pdf`);
    } finally {
      setPrintingId(null);
    }
  };

  const canCreate = hasPermission('delivery:create') && !isDriver;
  const canUpdate = hasPermission('delivery:update');
  const visibleTabs = isDriver ? ['My Deliveries'] : tabs;
  const showDeliveries = activeTab === 0;
  const showVehicles = !isDriver && activeTab === 1;

  useEffect(() => {
    if (!canCreate) return;
    const createFlag = searchParams.get('create') === '1';
    const orderIdsFromQuery = (searchParams.get('orders') || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (!createFlag && orderIdsFromQuery.length === 0) return;

    setPrefillOrderIds(orderIdsFromQuery);
    setDeliveryModalOpen(true);
    if (!isDriver) setActiveTab(0);
    // Keep query until modal open is applied; clear on next tick so Strict Mode remount still sees it once.
  }, [canCreate, isDriver, searchParams]);

  const closeDeliveryModal = () => {
    setDeliveryModalOpen(false);
    setPrefillOrderIds([]);
    if (searchParams.get('create') || searchParams.get('orders')) {
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      next.delete('orders');
      setSearchParams(next, { replace: true });
    }
  };

  const { data: stats } = useQuery({
    queryKey: ['delivery-stats'],
    queryFn: () => deliveryApi.stats().then((r) => r.data.data as DeliveryStats),
  });

  const { data: deliveries, isLoading, isError: deliveriesError, error: deliveriesErr, refetch: refetchDeliveries } = useQuery({
    queryKey: ['deliveries', page, search, status, deliveryDate],
    queryFn: () =>
      deliveryApi
        .list({
          page,
          limit: 15,
          search: search || undefined,
          status: status || undefined,
          date: deliveryDate || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: trips, isLoading: tripsLoading, isError: tripsError, error: tripsErr, refetch: refetchTrips } = useQuery({
    queryKey: ['delivery-trips', page, search, status, deliveryDate],
    queryFn: () =>
      deliveryApi
        .trips({
          page,
          limit: 15,
          search: search || undefined,
          status: status || undefined,
          date: deliveryDate || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const listRows: DeliveryListRow[] = sortDeliveryRows([
    ...(((trips?.data as DeliveryTrip[]) || []).map((trip) => ({
      kind: 'trip' as const,
      id: trip.id,
      createdAt: trip.createdAt || trip.stops[0]?.createdAt || '',
      trip,
    }))),
    ...(((deliveries?.data as DeliveryNote[]) || [])
      .filter((note) => !note.deliveryTripId)
      .map((note) => ({
        kind: 'note' as const,
        id: note.id,
        createdAt: note.createdAt || note.scheduledDate || '',
        note,
      }))),
  ]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [page, search, status, deliveryDate]);

  const { data: vehicles, isLoading: vehLoading, isError: vehiclesError, error: vehiclesErr, refetch: refetchVehicles } = useQuery({
    queryKey: ['vehicles', vehPage, vehSearch, vehType],
    queryFn: () =>
      deliveryApi
        .vehicles({ page: vehPage, limit: 15, search: vehSearch || undefined, type: vehType || undefined })
        .then((r) => r.data),
    enabled: !isDriver && activeTab === 1,
  });

  const { data: assignDrivers } = useQuery({
    queryKey: ['delivery-drivers'],
    queryFn: () => deliveryApi.drivers().then((r) => r.data.data as DriverOption[]),
    enabled: !!assignDialog,
  });

  const { data: assignVehicles } = useQuery({
    queryKey: ['vehicles', 'assign'],
    queryFn: () => deliveryApi.vehicles({ limit: 100 }).then((r) => r.data.data as Vehicle[]),
    enabled: !!assignDialog,
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      kind,
      status,
      proofOfDelivery,
      actualItems,
      tripActualItems,
      driverId,
      vehicleId,
      scheduledDate,
    }: {
      id: string;
      kind: 'note' | 'trip';
      status: string;
      proofOfDelivery?: string;
      actualItems?: { productId: string; quantity: number }[];
      tripActualItems?: { deliveryNoteId: string; items: { productId: string; quantity: number }[] }[];
      driverId?: string;
      vehicleId?: string;
      scheduledDate?: string;
    }) =>
      kind === 'trip'
        ? deliveryApi.updateTripStatus(id, {
            status,
            proofOfDelivery,
            actualItems: tripActualItems,
            driverId,
            vehicleId,
            scheduledDate,
          })
        : deliveryApi.updateStatus(id, {
            status,
            proofOfDelivery,
            actualItems,
            driverId,
            vehicleId,
            scheduledDate,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-trips'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setDetailOpen(false);
      setSelected(null);
      setSelectedTrip(null);
      setAssignDialog(null);
      setSelectedKeys([]);
    },
  });

  const bulkAssignMutation = useMutation({
    mutationFn: (payload: {
      items: { id: string; kind: 'note' | 'trip' }[];
      driverId: string;
      vehicleId?: string;
      scheduledDate?: string;
    }) => deliveryApi.bulkAssign(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-trips'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      setAssignDialog(null);
      setSelectedKeys([]);
    },
  });

  const bulkDeliverMutation = useMutation({
    mutationFn: (payload: {
      items: { id: string; kind: 'note' | 'trip' }[];
      proofOfDelivery?: string;
    }) => deliveryApi.bulkDeliver(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-trips'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setBulkDeliverConfirmOpen(false);
      setSelectedKeys([]);
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const buildDeliverStops = (note?: DeliveryNote | null, trip?: DeliveryTrip | null) => {
    if (note) {
      return [
        {
          deliveryNoteId: note.id,
          title: `${note.deliveryNo} · ${note.salesOrder?.orderNumber || 'Order'}`,
          items: (note.items || []).map((item) => ({
            productId: item.productId,
            dispatchedQty: item.quantity,
          })),
        },
      ];
    }
    if (trip) {
      return trip.stops.map((stop) => ({
        deliveryNoteId: stop.id,
        title: `${stop.deliveryNo} · ${stop.salesOrder.orderNumber}`,
        items: (stop.items || []).map((item) => ({
          productId: item.productId,
          dispatchedQty: item.quantity,
        })),
      }));
    }
    return [];
  };

  const openDeliverConfirm = (
    id: string,
    kind: 'note' | 'trip',
    label: string,
    note?: DeliveryNote | null,
    trip?: DeliveryTrip | null
  ) => {
    const stops = buildDeliverStops(note, trip);
    const initialQtys: Record<string, number> = {};
    for (const stop of stops) {
      for (const item of stop.items) {
        initialQtys[`${stop.deliveryNoteId}:${item.productId}`] = item.dispatchedQty;
      }
    }
    setActualQtys(initialQtys);
    setDeliverConfirm({ id, kind, label, stops });
  };

  const submitDeliverConfirm = () => {
    if (!deliverConfirm) return;
    if (deliverConfirm.kind === 'trip') {
      const tripActualItems = deliverConfirm.stops.map((stop) => ({
        deliveryNoteId: stop.deliveryNoteId,
        items: stop.items.map((item) => ({
          productId: item.productId,
          quantity: actualQtys[`${stop.deliveryNoteId}:${item.productId}`] ?? item.dispatchedQty,
        })),
      }));
      statusMutation.mutate(
        {
          id: deliverConfirm.id,
          kind: 'trip',
          status: 'DELIVERED',
          proofOfDelivery: 'Confirmed by driver',
          tripActualItems,
        },
        { onSettled: () => setDeliverConfirm(null) }
      );
      return;
    }

    const stop = deliverConfirm.stops[0];
    statusMutation.mutate(
      {
        id: deliverConfirm.id,
        kind: 'note',
        status: 'DELIVERED',
        proofOfDelivery: 'Confirmed by driver',
        actualItems: stop.items.map((item) => ({
          productId: item.productId,
          quantity: actualQtys[`${stop.deliveryNoteId}:${item.productId}`] ?? item.dispatchedQty,
        })),
      },
      { onSettled: () => setDeliverConfirm(null) }
    );
  };

  const requestStatusChange = (
    change: { id: string; kind: 'note' | 'trip'; status: string; label: string; proofOfDelivery?: string },
    note?: DeliveryNote | null,
    trip?: DeliveryTrip | null
  ) => {
    if (change.status === 'DELIVERED') {
      openDeliverConfirm(change.id, change.kind, change.label, note, trip);
      return;
    }
    if (change.status === 'ASSIGNED' && !isDriver) {
      const title =
        change.kind === 'trip'
          ? trip?.tripNo || 'Delivery trip'
          : note?.deliveryNo || 'Delivery note';
      const scheduled =
        (change.kind === 'trip' ? trip?.scheduledDate : note?.scheduledDate) || '';
      const currentStatus =
        change.kind === 'trip' ? trip?.status || 'PENDING' : note?.status || 'PENDING';
      setAssignDialog({
        items: [{ id: change.id, kind: change.kind, title, status: currentStatus }],
        mode: currentStatus === 'PENDING' ? 'assign' : 'edit',
        driverId: (change.kind === 'trip' ? trip?.driver?.id : note?.driverId || note?.driver?.id) || '',
        vehicleId: (change.kind === 'trip' ? trip?.vehicle?.id : note?.vehicle?.id) || '',
        scheduledDate: scheduled ? String(scheduled).slice(0, 10) : '',
      });
      return;
    }
    setPendingStatusChange(change);
  };

  const selectableRows = listRows.filter((row) => isOpenDeliveryStatus(rowStatus(row)));
  const selectedRows = listRows.filter((row) =>
    selectedKeys.includes(selectionKey(row.kind, row.id))
  );
  const selectedPending = selectedRows.filter((row) => rowStatus(row) === 'PENDING');
  const selectedDeliverable = selectedRows.filter((row) => canMarkDeliveredStatus(rowStatus(row)));
  const selectedEditable = selectedRows.filter(
    (row) => isOpenDeliveryStatus(rowStatus(row)) && !isDriver
  );
  const allSelectableSelected =
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedKeys.includes(selectionKey(row.kind, row.id)));

  const toggleSelection = (kind: 'note' | 'trip', id: string) => {
    const key = selectionKey(kind, id);
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const openBulkAssignDialog = (mode: 'assign' | 'edit' = 'assign') => {
    const source =
      mode === 'assign'
        ? selectedPending
        : selectedEditable.length
          ? selectedEditable
          : selectedRows.filter((row) => isOpenDeliveryStatus(rowStatus(row)));
    const items = source.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: rowTitle(row),
      status: rowStatus(row),
    }));
    if (!items.length) return;
    const first = source[0];
    const driverId =
      first.kind === 'trip'
        ? first.trip.driver?.id || ''
        : first.note.driverId || first.note.driver?.id || '';
    const vehicleId =
      first.kind === 'trip' ? first.trip.vehicle?.id || '' : first.note.vehicle?.id || '';
    const scheduled =
      (first.kind === 'trip' ? first.trip.scheduledDate : first.note.scheduledDate) || '';
    setAssignDialog({
      items,
      mode,
      driverId: mode === 'edit' ? driverId : '',
      vehicleId: mode === 'edit' ? vehicleId : '',
      scheduledDate: mode === 'edit' && scheduled ? String(scheduled).slice(0, 10) : '',
    });
  };

  const openEditDialog = (row: DeliveryListRow) => {
    const st = rowStatus(row);
    if (!isOpenDeliveryStatus(st) || isDriver) return;
    const scheduled =
      (row.kind === 'trip' ? row.trip.scheduledDate : row.note.scheduledDate) || '';
    setAssignDialog({
      items: [{ id: row.id, kind: row.kind, title: rowTitle(row), status: st }],
      mode: st === 'PENDING' ? 'assign' : 'edit',
      driverId:
        (row.kind === 'trip' ? row.trip.driver?.id : row.note.driverId || row.note.driver?.id) || '',
      vehicleId: (row.kind === 'trip' ? row.trip.vehicle?.id : row.note.vehicle?.id) || '',
      scheduledDate: scheduled ? String(scheduled).slice(0, 10) : '',
    });
  };

  const openDetail = (row: DeliveryListRow) => {
    if (row.kind === 'trip') {
      setSelectedTrip(row.trip);
      setSelected(null);
    } else {
      setSelected(row.note);
      setSelectedTrip(null);
    }
    setDetailOpen(true);
  };

  const deliveryColumns = [
    ...(canUpdate
      ? [
          {
            key: 'select',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => {
              const listRow = row as unknown as DeliveryListRow;
              if (!isOpenDeliveryStatus(rowStatus(listRow))) {
                return <span className="inline-block w-4" />;
              }
              const key = selectionKey(listRow.kind, listRow.id);
              return (
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  aria-label={`Select ${rowTitle(listRow)}`}
                  checked={selectedKeys.includes(key)}
                  onChange={(e) => {
                    e.stopPropagation();
                    toggleSelection(listRow.kind, listRow.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              );
            },
          },
        ]
      : []),
    {
      key: 'deliveryNo',
      label: 'Delivery #',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        if (listRow.kind === 'trip') return listRow.trip.tripNo;
        return listRow.note.deliveryNo;
      },
    },
    {
      key: 'customer',
      label: 'Customer / Orders',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        if (listRow.kind === 'trip') {
          const labels = listRow.trip.stops.map(
            (stop) => `${stop.salesOrder.orderNumber} (${stop.salesOrder.customer.name})`
          );
          return labels.join(' · ') || '-';
        }
        return listRow.note.salesOrder?.customer?.name || '-';
      },
    },
    {
      key: 'order',
      label: 'Stops',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        if (listRow.kind === 'trip') return `${listRow.trip.stops.length} orders`;
        return listRow.note.salesOrder?.orderNumber || '-';
      },
    },
    {
      key: 'vehicle',
      label: 'Vehicle',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        const vehicle = listRow.kind === 'trip' ? listRow.trip.vehicle : listRow.note.vehicle;
        return formatVehicleLabel(vehicle);
      },
    },
    {
      key: 'driver',
      label: 'Delivery Person',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        const driver = listRow.kind === 'trip' ? listRow.trip.driver : listRow.note.driver;
        if (!driver) return <span className="text-slate-400">—</span>;
        return `${driver.firstName} ${driver.lastName}`.trim() || '—';
      },
    },
    {
      key: 'scheduledDate',
      label: 'Scheduled',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        const date = listRow.kind === 'trip' ? listRow.trip.scheduledDate : listRow.note.scheduledDate;
        return date ? formatDate(date) : '-';
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, row: Record<string, unknown>) => {
        const listRow = row as unknown as DeliveryListRow;
        const st = listRow.kind === 'trip' ? listRow.trip.status : listRow.note.status;
        return <Badge variant={getStatusBadge(st)}>{st.replace(/_/g, ' ')}</Badge>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (!canUpdate) return null;
        const listRow = row as unknown as DeliveryListRow;
        const st = rowStatus(listRow);
        const actions = getDeliveryActions(st, isDriver);
        const editable = !isDriver && isOpenDeliveryStatus(st);
        if (!actions.length && !editable) return null;
        const primary = actions[actions.length - 1];
        return (
          <div className="flex flex-wrap gap-1 justify-end">
            {editable && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditDialog(listRow);
                }}
              >
                Edit
              </Button>
            )}
            {primary && (
              <Button
                size="sm"
                loading={statusMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  requestStatusChange(
                    {
                      id: listRow.id,
                      kind: listRow.kind,
                      status: primary.status,
                      label: primary.label,
                      proofOfDelivery:
                        primary.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
                    },
                    listRow.kind === 'note' ? listRow.note : null,
                    listRow.kind === 'trip' ? listRow.trip : null
                  );
                }}
              >
                {primary.label}
              </Button>
            )}
          </div>
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
    {
      key: 'isHired',
      label: 'Ownership',
      render: (val: unknown) =>
        val ? <Badge variant="warning">Hired</Badge> : <Badge variant="success">Company</Badge>,
    },
    { key: 'make', label: 'Make / Carrier' },
    { key: 'model', label: 'Model' },
    { key: 'capacity', label: 'Capacity' },
  ];

  const toolbarActions = (
    <div className="flex flex-wrap gap-2">
      {!isDriver && canUpdate && selectedPending.length > 0 && (
        <Button size="sm" variant="secondary" onClick={() => openBulkAssignDialog('assign')}>
          Assign selected ({selectedPending.length})
        </Button>
      )}
      {!isDriver && canUpdate && selectedEditable.length > 0 && selectedPending.length === 0 && (
        <Button size="sm" variant="secondary" onClick={() => openBulkAssignDialog('edit')}>
          Edit selected ({selectedEditable.length})
        </Button>
      )}
      {canUpdate && selectedDeliverable.length > 0 && (
        <Button size="sm" onClick={() => setBulkDeliverConfirmOpen(true)}>
          Mark delivered ({selectedDeliverable.length})
        </Button>
      )}
      {canCreate && showDeliveries && (
        <Button
          size="sm"
          onClick={() => {
            setPrefillOrderIds([]);
            setDeliveryModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Bulk Delivery Trip
        </Button>
      )}
      {canCreate && showVehicles && (
        <Button size="sm" onClick={() => setVehicleModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Vehicle
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <PageQueryStatus
        isError={deliveriesError || tripsError || vehiclesError}
        error={deliveriesErr || tripsErr || vehiclesErr}
        onRetry={() => {
          void refetchDeliveries();
          void refetchTrips();
          void refetchVehicles();
        }}
      />
      {stats && (
        <StatGrid>
          <StatCard title="Pending" value={stats.pending} icon={<Package className="h-5 w-5 text-white" />} color="from-emerald-500 to-emerald-700" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(0); }} />
          <StatCard title="In Transit" value={stats.inTransit} icon={<Truck className="h-5 w-5 text-white" />} color="from-sky-500 to-sky-700" onClick={() => { setStatus('IN_TRANSIT'); setPage(1); goToTab(0); }} />
          <StatCard title="Delivered Today" value={stats.deliveredToday} icon={<MapPin className="h-5 w-5 text-white" />} color="from-violet-500 to-violet-700" onClick={() => { setStatus('DELIVERED'); setPage(1); goToTab(0); }} />
          <StatCard title="Motorcycles" value={stats.motorcycles ?? 0} icon={<Bike className="h-5 w-5 text-white" />} color="from-amber-500 to-amber-700" onClick={() => goToTab(1)} />
          <StatCard title="Trucks" value={stats.trucks ?? 0} icon={<Truck className="h-5 w-5 text-white" />} color="from-rose-500 to-rose-700" onClick={() => goToTab(1)} />
        </StatGrid>
      )}

      {statusMutation.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {getApiErrorMessage(statusMutation.error)}
        </div>
      )}

      <PageHeader
        action={
          stats && stats.inTransit > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('IN_TRANSIT'); setPage(1); goToTab(0); }}>
              <Truck className="h-4 w-4 mr-1.5 text-primary-500" />
              {stats.inTransit} in transit
            </Button>
          ) : stats && stats.pending > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatus('PENDING'); setPage(1); goToTab(0); }}>
              <Package className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pending} pending
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={visibleTabs}
        activeTab={activeTab}
        onTabChange={(tab) => { setActiveTab(tab); setPage(1); setVehPage(1); }}
        actions={toolbarActions}
      />

      {showDeliveries && (
        <DataPanel>
          <div className="panel-filters">
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
            <Input
              type="date"
              label="Date"
              value={deliveryDate}
              onChange={(e) => { setDeliveryDate(e.target.value); setPage(1); }}
              className="sm:w-44"
            />
            <Button
              type="button"
              variant="secondary"
              className="sm:mb-0.5"
              onClick={() => {
                setDeliveryDate('');
                setPage(1);
              }}
            >
              All dates
            </Button>
            {!deliveryDate && (
              <Button
                type="button"
                variant="secondary"
                className="sm:mb-0.5"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, '0');
                  const d = String(now.getDate()).padStart(2, '0');
                  setDeliveryDate(`${y}-${m}-${d}`);
                  setPage(1);
                }}
              >
                Today
              </Button>
            )}
            {!isDriver && canUpdate && selectableRows.length > 0 && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 sm:mb-0.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  checked={allSelectableSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedKeys(
                        selectableRows.map((row) => selectionKey(row.kind, row.id))
                      );
                    } else {
                      setSelectedKeys([]);
                    }
                  }}
                />
                Select open ({selectableRows.length})
              </label>
            )}
            {canUpdate && selectableRows.length > 0 && isDriver && (
              <label className="inline-flex items-center gap-2 text-sm text-slate-600 sm:mb-0.5">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  checked={allSelectableSelected}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedKeys(
                        selectableRows.map((row) => selectionKey(row.kind, row.id))
                      );
                    } else {
                      setSelectedKeys([]);
                    }
                  }}
                />
                Select ({selectableRows.length})
              </label>
            )}
            {!isDriver && selectedPending.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="sm:mb-0.5"
                onClick={() => openBulkAssignDialog('assign')}
              >
                Assign ({selectedPending.length})
              </Button>
            )}
            {!isDriver && selectedEditable.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="sm:mb-0.5"
                onClick={() => openBulkAssignDialog('edit')}
              >
                Edit ({selectedEditable.length})
              </Button>
            )}
            {selectedDeliverable.length > 0 && (
              <Button
                type="button"
                size="sm"
                className="sm:mb-0.5"
                onClick={() => setBulkDeliverConfirmOpen(true)}
              >
                Mark delivered ({selectedDeliverable.length})
              </Button>
            )}
          </div>
          {(listRows.length || 0) === 0 && !isLoading && !tripsLoading ? (
            <div className="p-6">
              <EmptyState
                title="No deliveries found"
                description={
                  deliveryDate
                    ? 'No deliveries for this date. Pick another day or choose All dates.'
                    : isDriver
                      ? 'Assigned deliveries will appear here.'
                      : 'Create a delivery trip from one or more ready sales orders.'
                }
                action={
                  canCreate ? (
                    <Button
                      onClick={() => {
                        setPrefillOrderIds([]);
                        setDeliveryModalOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Bulk Delivery Trip
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={deliveryColumns}
              data={listRows}
              loading={isLoading || tripsLoading}
              onRowClick={(row) => openDetail(row as unknown as DeliveryListRow)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination
              pagination={{
                page,
                total: (deliveries?.pagination?.total || 0) + (trips?.pagination?.total || 0),
                totalPages: Math.max(
                  deliveries?.pagination?.totalPages || 1,
                  trips?.pagination?.totalPages || 1
                ),
              }}
              page={page}
              onPageChange={setPage}
              label="deliveries"
            />
          </div>
        </DataPanel>
      )}

      {showVehicles && (
        <DataPanel>
          <div className="panel-filters">
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

      <Modal
        open={deliveryModalOpen}
        onClose={closeDeliveryModal}
        title="Create Delivery Notes (bulk trip)"
        size="xl"
      >
        <DeliveryForm
          initialOrderIds={prefillOrderIds}
          onSuccess={closeDeliveryModal}
          onCancel={closeDeliveryModal}
        />
      </Modal>

      <Modal open={vehicleModalOpen} onClose={() => setVehicleModalOpen(false)} title="Add Vehicle" size="md">
        <VehicleForm onSuccess={() => setVehicleModalOpen(false)} onCancel={() => setVehicleModalOpen(false)} />
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null); setSelectedTrip(null); }} title={selectedTrip ? 'Delivery Trip Details' : 'Delivery Details'} size="lg">
        {selectedTrip && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Trip #</p><p className="font-semibold">{selectedTrip.tripNo}</p></div>
              <div><p className="text-slate-500">Orders</p><p className="font-semibold">{selectedTrip.stops.length}</p></div>
              <div><p className="text-slate-500">Vehicle</p><p className="font-semibold">{formatVehicleLabel(selectedTrip.vehicle)}</p></div>
              <div>
                <p className="text-slate-500">Delivery Person</p>
                <p className="font-semibold">
                  {selectedTrip.driver
                    ? `${selectedTrip.driver.firstName} ${selectedTrip.driver.lastName}`.trim()
                    : '—'}
                </p>
              </div>
              <div><p className="text-slate-500">Scheduled</p><p className="font-semibold">{selectedTrip.scheduledDate ? formatDate(selectedTrip.scheduledDate) : '-'}</p></div>
              <div><p className="text-slate-500">Waybill #</p><p className="font-semibold">{selectedTrip.waybillNo || '—'}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selectedTrip.status)}>{selectedTrip.status.replace(/_/g, ' ')}</Badge></div>
            </div>

            <Card title="Stops">
              {selectedTrip.stops.map((stop) => (
                <div key={stop.id} className="py-3 border-b border-border/60 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{stop.salesOrder.orderNumber}</p>
                      <p className="text-xs text-slate-500">{stop.salesOrder.customer.name} · {stop.deliveryNo}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={printingId === stop.id}
                        onClick={() => printDeliveryNote(stop.id, stop.deliveryNo)}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" />
                        Print DN
                      </Button>
                      <Badge variant={getStatusBadge(stop.status)}>{stop.status.replace(/_/g, ' ')}</Badge>
                    </div>
                  </div>
                  {stop.items?.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      {stop.items.map((item) => (
                        <div key={item.id} className="flex justify-between">
                          <span>Product {item.productId.slice(0, 8)}…</span>
                          <span>Qty: {item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {canUpdate && getDeliveryActions(stop.status, isDriver).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {getDeliveryActions(stop.status, isDriver).map((action) => (
                        <Button
                          key={`${stop.id}-${action.status}`}
                          size="sm"
                          variant={action.status === 'DELIVERED' ? 'primary' : 'secondary'}
                          loading={statusMutation.isPending}
                          onClick={() =>
                            requestStatusChange(
                              {
                                id: stop.id,
                                kind: 'note',
                                status: action.status,
                                label: action.label,
                                proofOfDelivery:
                                  action.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
                              },
                              stop
                            )
                          }
                        >
                          {action.label} stop
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Card>

            {canUpdate && (
              <div className="flex flex-wrap justify-end gap-2">
                {!isDriver && isOpenDeliveryStatus(selectedTrip.status) && (
                  <Button
                    variant="secondary"
                    onClick={() =>
                      openEditDialog({
                        kind: 'trip',
                        id: selectedTrip.id,
                        createdAt: selectedTrip.createdAt || '',
                        trip: selectedTrip,
                      })
                    }
                  >
                    Edit trip
                  </Button>
                )}
                {getDeliveryActions(selectedTrip.status, isDriver).map((action) => (
                  <Button
                    key={action.status}
                    variant={action.status === 'DELIVERED' ? 'primary' : 'secondary'}
                    loading={statusMutation.isPending}
                    onClick={() =>
                      requestStatusChange(
                        {
                          id: selectedTrip.id,
                          kind: 'trip',
                          status: action.status,
                          label: action.label,
                          proofOfDelivery:
                            action.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
                        },
                        null,
                        selectedTrip
                      )
                    }
                  >
                    {action.label} entire trip
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}
        {selected && !selectedTrip && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Delivery #</p><p className="font-semibold">{selected.deliveryNo}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{selected.salesOrder?.customer?.name}</p></div>
              <div><p className="text-slate-500">Sales Order</p><p className="font-semibold">{selected.salesOrder?.orderNumber}</p></div>
              <div><p className="text-slate-500">Vehicle</p><p className="font-semibold">{formatVehicleLabel(selected.vehicle)}</p></div>
              <div>
                <p className="text-slate-500">Delivery Person</p>
                <p className="font-semibold">
                  {selected.driver
                    ? `${selected.driver.firstName} ${selected.driver.lastName}`.trim()
                    : '—'}
                </p>
              </div>
              <div><p className="text-slate-500">Scheduled</p><p className="font-semibold">{selected.scheduledDate ? formatDate(selected.scheduledDate) : '-'}</p></div>
              <div><p className="text-slate-500">Waybill #</p><p className="font-semibold">{selected.waybillNo || selected.deliveryTrip?.waybillNo || '—'}</p></div>
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
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                loading={printingId === selected.id}
                onClick={() => printDeliveryNote(selected.id, selected.deliveryNo)}
              >
                <Download className="h-4 w-4 mr-2" />
                Print delivery note
              </Button>
              {canUpdate && !isDriver && isOpenDeliveryStatus(selected.status) && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    openEditDialog({
                      kind: 'note',
                      id: selected.id,
                      createdAt: selected.createdAt || '',
                      note: selected,
                    })
                  }
                >
                  Edit
                </Button>
              )}
              {canUpdate &&
                getDeliveryActions(selected.status, isDriver).map((action) => (
                  <Button
                    key={action.status}
                    variant={action.status === 'DELIVERED' ? 'primary' : 'secondary'}
                    loading={statusMutation.isPending}
                    onClick={() =>
                      requestStatusChange(
                        {
                          id: selected.id,
                          kind: 'note',
                          status: action.status,
                          label: action.label,
                          proofOfDelivery:
                            action.status === 'DELIVERED' ? 'Confirmed by driver' : undefined,
                        },
                        selected
                      )
                    }
                  >
                    {action.label}
                  </Button>
                ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!deliverConfirm}
        onClose={() => setDeliverConfirm(null)}
        title="Confirm delivered quantities"
        size="md"
      >
        {deliverConfirm && (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">
              Enter what the customer actually received. If less than dispatched, the difference returns to stock and the invoice is adjusted.
            </p>
            {deliverConfirm.stops.map((stop) => (
              <div key={stop.deliveryNoteId} className="rounded-lg border border-border p-3 space-y-2">
                <p className="font-medium text-slate-900">{stop.title}</p>
                {stop.items.map((item) => {
                  const key = `${stop.deliveryNoteId}:${item.productId}`;
                  return (
                    <div key={key} className="grid grid-cols-2 gap-2 items-end">
                      <div>
                        <p className="text-xs text-slate-500">Product</p>
                        <p className="font-mono text-xs">{item.productId.slice(0, 8)}…</p>
                        <p className="text-xs text-slate-500">Dispatched: {item.dispatchedQty}</p>
                      </div>
                      <Input
                        label="Delivered qty"
                        type="number"
                        min={0}
                        max={item.dispatchedQty}
                        value={actualQtys[key] ?? item.dispatchedQty}
                        onChange={(e) =>
                          setActualQtys((prev) => ({
                            ...prev,
                            [key]: Math.min(
                              item.dispatchedQty,
                              Math.max(0, Number(e.target.value) || 0)
                            ),
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setDeliverConfirm(null)}>
                Cancel
              </Button>
              <Button type="button" loading={statusMutation.isPending} onClick={submitDeliverConfirm}>
                {deliverConfirm.label}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!assignDialog}
        onClose={() => setAssignDialog(null)}
        title={
          assignDialog
            ? assignDialog.mode === 'edit'
              ? assignDialog.items.length > 1
                ? `Edit ${assignDialog.items.length} deliveries`
                : 'Edit delivery'
              : assignDialog.items.length > 1
                ? `Assign ${assignDialog.items.length} deliveries`
                : 'Assign delivery person'
            : 'Assign delivery person'
        }
        size="md"
      >
        {assignDialog && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {assignDialog.mode === 'edit' ? (
                assignDialog.items.length > 1 ? (
                  <>
                    Update driver, vehicle, or schedule for{' '}
                    <strong>{assignDialog.items.length} open deliveries</strong> (not yet
                    delivered).
                  </>
                ) : (
                  <>
                    Update driver, vehicle, or schedule for{' '}
                    <strong>{assignDialog.items[0]?.title}</strong> before it is marked delivered.
                  </>
                )
              ) : assignDialog.items.length > 1 ? (
                <>
                  Assign one delivery person to{' '}
                  <strong>{assignDialog.items.length} pending deliveries</strong>.
                </>
              ) : (
                <>
                  Assign a driver (and optional vehicle) to{' '}
                  <strong>{assignDialog.items[0]?.title}</strong> so it appears on their Delivery
                  list.
                </>
              )}
            </p>
            {assignDialog.items.length > 1 && (
              <ul className="max-h-28 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 space-y-1">
                {assignDialog.items.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    {item.kind === 'trip' ? 'Trip' : 'Note'} · {item.title} ·{' '}
                    {item.status.replace(/_/g, ' ')}
                  </li>
                ))}
              </ul>
            )}
            {(statusMutation.isError || bulkAssignMutation.isError) && (
              <Alert variant="error">
                {getApiErrorMessage(statusMutation.error || bulkAssignMutation.error)}
              </Alert>
            )}
            <Select
              label="Delivery person *"
              options={[
                { value: '', label: 'Select driver…' },
                ...(assignDrivers || []).map((d) => ({
                  value: d.id,
                  label: `${d.firstName} ${d.lastName}`.trim() || d.email,
                })),
              ]}
              value={assignDialog.driverId}
              onChange={(e) =>
                setAssignDialog((prev) => (prev ? { ...prev, driverId: e.target.value } : prev))
              }
            />
            <Select
              label="Vehicle (optional)"
              options={[
                { value: '', label: 'Unassigned — set later' },
                ...(assignVehicles || []).map((v) => ({
                  value: v.id,
                  label: `${vehicleTypeLabel(v.type)} · ${v.registration}`,
                })),
              ]}
              value={assignDialog.vehicleId}
              onChange={(e) =>
                setAssignDialog((prev) => (prev ? { ...prev, vehicleId: e.target.value } : prev))
              }
            />
            <Input
              label="Scheduled date (optional)"
              type="date"
              value={assignDialog.scheduledDate}
              onChange={(e) =>
                setAssignDialog((prev) =>
                  prev ? { ...prev, scheduledDate: e.target.value } : prev
                )
              }
            />
            <div className="flex justify-end gap-3 pt-2 border-t">
              <Button type="button" variant="secondary" onClick={() => setAssignDialog(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                loading={statusMutation.isPending || bulkAssignMutation.isPending}
                disabled={!assignDialog.driverId}
                onClick={() => {
                  const payload = {
                    driverId: assignDialog.driverId,
                    vehicleId: assignDialog.vehicleId || undefined,
                    scheduledDate: assignDialog.scheduledDate || undefined,
                  };
                  if (assignDialog.items.length === 1) {
                    const item = assignDialog.items[0];
                    const nextStatus =
                      item.status === 'PENDING' || assignDialog.mode === 'assign'
                        ? 'ASSIGNED'
                        : item.status;
                    statusMutation.mutate({
                      id: item.id,
                      kind: item.kind,
                      status: nextStatus,
                      ...payload,
                    });
                    return;
                  }
                  bulkAssignMutation.mutate({
                    items: assignDialog.items.map(({ id, kind }) => ({ id, kind })),
                    ...payload,
                  });
                }}
              >
                {assignDialog.mode === 'edit'
                  ? assignDialog.items.length > 1
                    ? `Save ${assignDialog.items.length} deliveries`
                    : 'Save changes'
                  : assignDialog.items.length > 1
                    ? `Assign ${assignDialog.items.length} to driver`
                    : 'Assign to driver'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={bulkDeliverConfirmOpen}
        title="Mark selected deliveries as delivered?"
        message={`This will mark ${selectedDeliverable.length} ${selectedDeliverable.length === 1 ? 'delivery' : 'deliveries'} as delivered using full dispatched quantities. Continue?`}
        confirmLabel="Mark delivered"
        variant="primary"
        loading={bulkDeliverMutation.isPending}
        onCancel={() => setBulkDeliverConfirmOpen(false)}
        onConfirm={() =>
          bulkDeliverMutation.mutate({
            items: selectedDeliverable.map((row) => ({ id: row.id, kind: row.kind })),
            proofOfDelivery: 'Bulk marked delivered',
          })
        }
      />
      <ConfirmDialog
        open={!!pendingStatusChange && pendingStatusChange.status !== 'DELIVERED'}
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
              kind: pendingStatusChange.kind,
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
