import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Container, Trash2 } from 'lucide-react';
import { deliveryApi } from '../../services/api';
import { Alert, Button, Input, Select, formatCurrency } from '../ui';
import { DeliveryNote, SalesOrder, Vehicle, vehicleTypeLabel } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { getApiErrorMessage } from '../../utils/apiError';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const tripSchema = z.object({
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  scheduledDate: z.string().optional(),
  waybillNo: z.string().max(100).optional(),
  notes: z.string().optional(),
});

type TripFormData = z.infer<typeof tripSchema>;

const deliveryDefaultValues: TripFormData = {
  vehicleId: '',
  driverId: '',
};

type TripOrder = {
  salesOrderId: string;
  orderNumber: string;
  customerName: string;
  items: { productId: string; quantity: number; label: string; remaining: number }[];
};

interface DeliveryFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  /** Pre-select these ready order IDs (e.g. bulk pick from Sales). */
  initialOrderIds?: string[];
}

function buildOrderItems(order: SalesOrder): TripOrder['items'] {
  return (order.items || [])
    .map((item) => {
      const remaining = item.quantity - (item.deliveredQty || 0);
      if (remaining <= 0) return null;
      return {
        productId: item.productId,
        quantity: remaining,
        remaining,
        label: item.product ? formatProductOptionLabel(item.product) : item.productId,
      };
    })
    .filter((item): item is TripOrder['items'][number] => item !== null);
}

function orderToTripOrder(order: SalesOrder): TripOrder | null {
  const items = buildOrderItems(order);
  if (items.length === 0) return null;
  return {
    salesOrderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customer.name,
    items,
  };
}

function formatVehicleOption(v: Vehicle) {
  const hired = v.isHired ? ' · Hired' : '';
  const detail = v.make ? ` (${v.make}${v.model ? ` ${v.model}` : ''})` : '';
  return `${vehicleTypeLabel(v.type)} · ${v.registration}${detail}${hired}`;
}

export function DeliveryForm({ onSuccess, onCancel, initialOrderIds = [] }: DeliveryFormProps) {
  const queryClient = useQueryClient();
  const [tripOrders, setTripOrders] = useState<TripOrder[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [showHiredLorryForm, setShowHiredLorryForm] = useState(false);
  const [hiredRegistration, setHiredRegistration] = useState('');
  const [hiredCarrier, setHiredCarrier] = useState('');
  const [preselectedApplied, setPreselectedApplied] = useState(false);
  const [formError, setFormError] = useState('');

  const { data: salesOrdersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['sales-orders-deliverable'],
    queryFn: () => deliveryApi.readyOrders().then((r) => r.data.data as SalesOrder[]),
  });

  const { data: pendingNotesData, isLoading: notesLoading } = useQuery({
    queryKey: ['delivery-notes-unassigned-pending'],
    queryFn: () =>
      deliveryApi
        .list({ status: 'PENDING', limit: 100 })
        .then((r) => (r.data.data as DeliveryNote[]).filter((n) => !n.deliveryTripId)),
  });

  useEffect(() => {
    if (preselectedApplied || !salesOrdersData?.length || initialOrderIds.length === 0) return;
    const wanted = new Set(initialOrderIds);
    const selected = salesOrdersData
      .filter((order) => wanted.has(order.id))
      .map(orderToTripOrder)
      .filter((order): order is TripOrder => order !== null);
    if (selected.length > 0) setTripOrders(selected);
    setPreselectedApplied(true);
  }, [salesOrdersData, initialOrderIds, preselectedApplied]);

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => deliveryApi.vehicles({ limit: 100 }).then((r) => r.data.data as Vehicle[]),
  });

  const { data: driversData } = useQuery({
    queryKey: ['delivery-drivers'],
    queryFn: () =>
      deliveryApi.drivers().then(
        (r) => r.data.data as { id: string; firstName: string; lastName: string; email: string }[]
      ),
  });

  const selectedOrderIds = useMemo(() => new Set(tripOrders.map((o) => o.salesOrderId)), [tripOrders]);
  const selectedNoteIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const filteredReadyOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    if (!q) return salesOrdersData || [];
    return (salesOrdersData || []).filter(
      (order) =>
        order.orderNumber.toLowerCase().includes(q) ||
        order.customer.name.toLowerCase().includes(q) ||
        order.customer.code?.toLowerCase().includes(q)
    );
  }, [salesOrdersData, orderSearch]);

  const filteredPendingNotes = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    const notes = pendingNotesData || [];
    if (!q) return notes;
    return notes.filter(
      (note) =>
        note.deliveryNo?.toLowerCase().includes(q) ||
        note.salesOrder?.orderNumber?.toLowerCase().includes(q) ||
        note.salesOrder?.customer?.name?.toLowerCase().includes(q)
    );
  }, [pendingNotesData, orderSearch]);

  const hasReadyOrders = (salesOrdersData || []).length > 0;
  /** Existing unassigned notes — use assign mode when there is nothing left to create from. */
  const assignMode = !ordersLoading && !hasReadyOrders;
  const companyVehicles = (vehiclesData || []).filter((v) => !v.isHired);
  const hiredVehicles = (vehiclesData || []).filter((v) => v.isHired);

  const vehicleOptions = [
    { value: '', label: 'Unassigned — assign vehicle later' },
    ...companyVehicles.map((v) => ({ value: v.id, label: formatVehicleOption(v) })),
    ...hiredVehicles.map((v) => ({ value: v.id, label: formatVehicleOption(v) })),
  ];

  const driverOptions = [
    { value: '', label: 'Select driver…' },
    ...(driversData || []).map((d) => ({
      value: d.id,
      label: `${d.firstName} ${d.lastName}`.trim(),
    })),
  ];

  const { register, handleSubmit, setValue, watch, getValues, reset, formState: { errors } } = useForm<TripFormData>({
    resolver: zodResolver(tripSchema),
    defaultValues: deliveryDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.delivery,
    watch,
    getValues,
    reset,
    defaultValues: deliveryDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.vehicleId) ||
      Boolean(data.driverId) ||
      Boolean(data.scheduledDate) ||
      Boolean(data.waybillNo?.trim()) ||
      Boolean(data.notes?.trim()) ||
      tripOrders.length > 0 ||
      selectedNoteIds.length > 0,
    getUiState: () => ({ tripOrders, selectedNoteIds, orderSearch }),
    onRestoreUi: (ui) => {
      if (Array.isArray(ui?.tripOrders)) setTripOrders(ui.tripOrders as TripOrder[]);
      if (Array.isArray(ui?.selectedNoteIds)) setSelectedNoteIds(ui.selectedNoteIds as string[]);
      if (typeof ui?.orderSearch === 'string') setOrderSearch(ui.orderSearch);
    },
  });

  const selectedVehicleId = watch('vehicleId');

  const toggleOrder = (order: SalesOrder, checked: boolean) => {
    setSelectedNoteIds([]);
    if (checked) {
      const tripOrder = orderToTripOrder(order);
      if (!tripOrder) return;
      setTripOrders((prev) => [...prev.filter((o) => o.salesOrderId !== order.id), tripOrder]);
      return;
    }
    setTripOrders((prev) => prev.filter((o) => o.salesOrderId !== order.id));
  };

  const toggleNote = (noteId: string, checked: boolean) => {
    setTripOrders([]);
    setSelectedNoteIds((prev) =>
      checked ? [...prev.filter((id) => id !== noteId), noteId] : prev.filter((id) => id !== noteId)
    );
  };

  const selectAllVisible = () => {
    if (assignMode) {
      setTripOrders([]);
      setSelectedNoteIds(filteredPendingNotes.map((n) => n.id));
      return;
    }
    setSelectedNoteIds([]);
    const next = [...tripOrders];
    const ids = new Set(next.map((o) => o.salesOrderId));
    for (const order of filteredReadyOrders) {
      if (ids.has(order.id)) continue;
      const tripOrder = orderToTripOrder(order);
      if (tripOrder) next.push(tripOrder);
    }
    setTripOrders(next);
  };

  const clearSelection = () => {
    setTripOrders([]);
    setSelectedNoteIds([]);
  };

  const removeOrder = (salesOrderId: string) => {
    setTripOrders((prev) => prev.filter((o) => o.salesOrderId !== salesOrderId));
  };

  const updateItemQty = (salesOrderId: string, productId: string, quantity: number) => {
    setTripOrders((prev) =>
      prev.map((order) => {
        if (order.salesOrderId !== salesOrderId) return order;
        return {
          ...order,
          items: order.items.map((item) =>
            item.productId === productId
              ? { ...item, quantity: Math.min(Math.max(1, quantity), item.remaining) }
              : item
          ),
        };
      })
    );
  };

  const addHiredLorryMutation = useMutation({
    mutationFn: () =>
      deliveryApi.createVehicle({
        registration: hiredRegistration.trim(),
        type: 'LORRY',
        make: hiredCarrier.trim() || 'Hired carrier',
        isHired: true,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      setValue('vehicleId', res.data.data.id);
      setShowHiredLorryForm(false);
      setHiredRegistration('');
      setHiredCarrier('');
    },
  });

  const invalidateDeliveryQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-trips'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
    queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    queryClient.invalidateQueries({ queryKey: ['sales-orders-deliverable'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-notes-unassigned-pending'] });
    queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: TripFormData) => {
      const payload = {
        vehicleId: data.vehicleId || undefined,
        driverId: data.driverId || undefined,
        scheduledDate: data.scheduledDate || undefined,
        waybillNo: data.waybillNo?.trim() || undefined,
        notes: data.notes || undefined,
        orders: tripOrders.map((order) => ({
          salesOrderId: order.salesOrderId,
          items: order.items.map(({ productId, quantity }) => ({ productId, quantity })),
        })),
      };
      return deliveryApi.create(payload);
    },
    onSuccess: () => {
      void clearDraft();
      invalidateDeliveryQueries();
      onSuccess();
    },
  });

  const assignMutation = useMutation({
    mutationFn: (data: TripFormData) => {
      if (!data.driverId) {
        throw new Error('Select a driver to assign these delivery notes.');
      }
      return deliveryApi.bulkAssign({
        items: selectedNoteIds.map((id) => ({ id, kind: 'note' as const })),
        driverId: data.driverId,
        vehicleId: data.vehicleId || undefined,
        scheduledDate: data.scheduledDate || undefined,
      });
    },
    onSuccess: () => {
      void clearDraft();
      invalidateDeliveryQueries();
      onSuccess();
    },
  });

  const mutation = assignMode ? assignMutation : createMutation;
  const canSubmit = assignMode ? selectedNoteIds.length > 0 : tripOrders.length > 0;
  const allVisibleSelected = assignMode
    ? filteredPendingNotes.length > 0 &&
      filteredPendingNotes.every((note) => selectedNoteIdSet.has(note.id))
    : filteredReadyOrders.length > 0 &&
      filteredReadyOrders.every((order) => selectedOrderIds.has(order.id));

  const listLoading = assignMode ? notesLoading : ordersLoading;
  const listCount = assignMode ? filteredPendingNotes.length : filteredReadyOrders.length;

  return (
    <form
      onSubmit={handleSubmit((data) => {
        setFormError('');
        if (!canSubmit) return;
        if (assignMode && !data.driverId) {
          setFormError('Select a driver to assign these unassigned delivery notes.');
          return;
        }
        mutation.mutate(data);
      })}
      className="space-y-4"
    >
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {(mutation.isError || formError) && (
        <Alert variant="error">
          {formError || getApiErrorMessage(mutation.error)}
        </Alert>
      )}

      {assignMode && (
        <Alert variant="info">
          No ready sales orders left to create notes from — stock was already dispatched onto delivery
          notes. Select the unassigned notes below and assign a driver (and optional vehicle) in one
          step.
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Select label="Vehicle" options={vehicleOptions} {...register('vehicleId')} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setShowHiredLorryForm((v) => !v)}
          >
            <Container className="h-4 w-4 mr-1.5" />
            {showHiredLorryForm ? 'Cancel hired lorry' : 'Add hired lorry'}
          </Button>
          {showHiredLorryForm && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2">
              <Input
                label="Lorry registration *"
                placeholder="e.g. KCA 456B"
                value={hiredRegistration}
                onChange={(e) => setHiredRegistration(e.target.value)}
              />
              <Input
                label="Carrier / owner (optional)"
                placeholder="e.g. TransEast Logistics"
                value={hiredCarrier}
                onChange={(e) => setHiredCarrier(e.target.value)}
              />
              {addHiredLorryMutation.isError && (
                <Alert variant="error">{getApiErrorMessage(addHiredLorryMutation.error)}</Alert>
              )}
              <Button
                type="button"
                size="sm"
                loading={addHiredLorryMutation.isPending}
                disabled={!hiredRegistration.trim()}
                onClick={() => addHiredLorryMutation.mutate()}
              >
                Save & select lorry
              </Button>
            </div>
          )}
          {selectedVehicleId && hiredVehicles.some((v) => v.id === selectedVehicleId) && (
            <p className="text-xs text-amber-800">Selected vehicle is marked as a hired lorry.</p>
          )}
        </div>
        <Select
          label={assignMode ? 'Driver *' : 'Driver'}
          options={driverOptions}
          {...register('driverId')}
        />
        <Input label="Scheduled Date" type="date" {...register('scheduledDate')} />
        {!assignMode && (
          <Input
            label="Waybill no. (optional)"
            placeholder="Carrier / hired truck waybill"
            {...register('waybillNo')}
            error={errors.waybillNo?.message}
          />
        )}
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-800">
              {assignMode
                ? 'Bulk assign — select unassigned delivery notes'
                : 'Bulk delivery — select ready orders'}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={selectAllVisible}
              disabled={allVisibleSelected || listLoading || listCount === 0}
            >
              Select all ({listCount})
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={tripOrders.length === 0 && selectedNoteIds.length === 0}
            >
              Clear
            </Button>
          </div>
        </div>

        <Input
          placeholder={
            assignMode
              ? 'Search unassigned notes by delivery #, order, or customer…'
              : 'Search ready orders by number or customer…'
          }
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
        />

        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {listLoading ? (
            <p className="p-4 text-sm text-slate-500">
              {assignMode ? 'Loading unassigned notes…' : 'Loading ready orders…'}
            </p>
          ) : assignMode ? (
            filteredPendingNotes.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                No unassigned pending delivery notes found.
              </p>
            ) : (
              filteredPendingNotes.map((note) => {
                const checked = selectedNoteIdSet.has(note.id);
                return (
                  <label
                    key={note.id}
                    className="flex items-start gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      checked={checked}
                      onChange={(e) => toggleNote(note.id, e.target.checked)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900">{note.deliveryNo}</p>
                      <p className="text-xs text-slate-500">
                        {note.salesOrder?.orderNumber || 'Order'} ·{' '}
                        {note.salesOrder?.customer?.name || 'Customer'} · PENDING · Unassigned
                      </p>
                    </div>
                  </label>
                );
              })
            )
          ) : filteredReadyOrders.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No ready orders available for delivery.</p>
          ) : (
            filteredReadyOrders.map((order) => {
              const checked = selectedOrderIds.has(order.id);
              const remainingLines = buildOrderItems(order).length;
              const totalRemaining = (order.items || []).reduce(
                (sum, item) => sum + Math.max(0, item.quantity - (item.deliveredQty || 0)),
                0
              );
              const totalOrdered = (order.items || []).reduce((sum, item) => sum + item.quantity, 0);
              const partial = totalRemaining < totalOrdered;
              return (
                <label
                  key={order.id}
                  className="flex items-start gap-3 p-3 hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    checked={checked}
                    onChange={(e) => toggleOrder(order, e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900">{order.orderNumber}</p>
                    <p className="text-xs text-slate-500">
                      {order.customer.name} · {order.status.replace(/_/g, ' ')} · {remainingLines} line
                      {remainingLines === 1 ? '' : 's'} · {formatCurrency(Number(order.totalAmount))}
                    </p>
                    {partial && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        Partial delivery — {totalRemaining} of {totalOrdered} units still to deliver
                      </p>
                    )}
                  </div>
                </label>
              );
            })
          )}
        </div>

        <p className="text-sm text-slate-600">
          {assignMode
            ? selectedNoteIds.length === 0
              ? 'No notes selected yet — tick the checkboxes above.'
              : `${selectedNoteIds.length} note${selectedNoteIds.length === 1 ? '' : 's'} selected to assign.`
            : tripOrders.length === 0
              ? 'No orders selected yet — tick the checkboxes above.'
              : `${tripOrders.length} order${tripOrders.length === 1 ? '' : 's'} selected for this trip.`}
        </p>

        {!assignMode && tripOrders.length > 0 && (
          <div className="space-y-3">
            {tripOrders.map((order) => (
              <div key={order.salesOrderId} className="rounded-lg bg-slate-50 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">{order.orderNumber}</p>
                    <p className="text-xs text-slate-500">{order.customerName}</p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeOrder(order.salesOrderId)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div key={item.productId} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-end">
                      <div>
                        <p className="text-sm">{item.label}</p>
                        <p className="text-xs text-slate-500">Remaining: {item.remaining}</p>
                      </div>
                      <Input
                        label="Qty"
                        type="number"
                        min={1}
                        max={item.remaining}
                        value={item.quantity}
                        onChange={(e) =>
                          updateItemQty(order.salesOrderId, item.productId, Number(e.target.value))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!assignMode && <Input label="Notes" {...register('notes')} error={errors.notes?.message} />}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canSubmit}>
          {assignMode
            ? selectedNoteIds.length > 1
              ? `Assign ${selectedNoteIds.length} delivery notes`
              : 'Assign delivery note'
            : tripOrders.length > 1
              ? `Create ${tripOrders.length} delivery notes (1 trip)`
              : 'Create Delivery Note'}
        </Button>
      </div>
    </form>
  );
}
