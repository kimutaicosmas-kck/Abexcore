import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Container, Trash2 } from 'lucide-react';
import { deliveryApi } from '../../services/api';
import { Alert, Button, Input, Select, formatCurrency } from '../ui';
import { DeliveryNote, DeliveryTrip, SalesOrder, Vehicle, vehicleTypeLabel } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { getApiErrorMessage } from '../../utils/apiError';
import { downloadFile } from '../../utils/download';

const tripSchema = z.object({
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  scheduledDate: z.string().optional(),
  waybillNo: z.string().max(100).optional(),
  notes: z.string().optional(),
});

type TripFormData = z.infer<typeof tripSchema>;

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
  const [orderSearch, setOrderSearch] = useState('');
  const [showHiredLorryForm, setShowHiredLorryForm] = useState(false);
  const [hiredRegistration, setHiredRegistration] = useState('');
  const [hiredCarrier, setHiredCarrier] = useState('');
  const [preselectedApplied, setPreselectedApplied] = useState(false);

  const { data: salesOrdersData, isLoading: ordersLoading } = useQuery({
    queryKey: ['sales-orders-deliverable'],
    queryFn: () => deliveryApi.readyOrders().then((r) => r.data.data as SalesOrder[]),
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

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<TripFormData>({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      vehicleId: '',
      driverId: '',
    },
  });

  const selectedVehicleId = watch('vehicleId');

  const toggleOrder = (order: SalesOrder, checked: boolean) => {
    if (checked) {
      const tripOrder = orderToTripOrder(order);
      if (!tripOrder) return;
      setTripOrders((prev) => [...prev.filter((o) => o.salesOrderId !== order.id), tripOrder]);
      return;
    }
    setTripOrders((prev) => prev.filter((o) => o.salesOrderId !== order.id));
  };

  const selectAllVisible = () => {
    const next = [...tripOrders];
    const ids = new Set(next.map((o) => o.salesOrderId));
    for (const order of filteredReadyOrders) {
      if (ids.has(order.id)) continue;
      const tripOrder = orderToTripOrder(order);
      if (tripOrder) next.push(tripOrder);
    }
    setTripOrders(next);
  };

  const clearSelection = () => setTripOrders([]);

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

  const mutation = useMutation({
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
    onSuccess: async (res) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-trips'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders-deliverable'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });

      const payload = res.data.data as DeliveryNote | DeliveryTrip;
      const notes: { id: string; deliveryNo: string }[] =
        'stops' in payload && Array.isArray(payload.stops) && payload.stops.length > 0
          ? payload.stops.map((stop) => ({ id: stop.id, deliveryNo: stop.deliveryNo }))
          : 'deliveryNo' in payload && payload.id
            ? [{ id: payload.id, deliveryNo: payload.deliveryNo }]
            : [];

      for (const note of notes) {
        try {
          await downloadFile(deliveryApi.pdfPath(note.id), `${note.deliveryNo}.pdf`);
        } catch {
          // Creation succeeded even if print download fails — user can reprint from Delivery details.
        }
      }

      onSuccess();
    },
  });

  const canSubmit = tripOrders.length > 0;
  const allVisibleSelected =
    filteredReadyOrders.length > 0 &&
    filteredReadyOrders.every((order) => selectedOrderIds.has(order.id));

  return (
    <form
      onSubmit={handleSubmit((data) => {
        if (!canSubmit) return;
        mutation.mutate(data);
      })}
      className="space-y-4"
    >
      {mutation.isError && <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>}

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
        <Select label="Driver" options={driverOptions} {...register('driverId')} />
        <Input label="Scheduled Date" type="date" {...register('scheduledDate')} />
        <Input
          label="Waybill no. (optional)"
          placeholder="Carrier / hired truck waybill"
          {...register('waybillNo')}
          error={errors.waybillNo?.message}
        />
      </div>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-800">Bulk delivery — select ready orders</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button type="button" variant="secondary" size="sm" onClick={selectAllVisible} disabled={allVisibleSelected || ordersLoading}>
              Select all ({filteredReadyOrders.length})
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={tripOrders.length === 0}>
              Clear
            </Button>
          </div>
        </div>

        <Input
          placeholder="Search ready orders by number or customer…"
          value={orderSearch}
          onChange={(e) => setOrderSearch(e.target.value)}
        />

        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {ordersLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading ready orders…</p>
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
          {tripOrders.length === 0
            ? 'No orders selected yet — tick the checkboxes above.'
            : `${tripOrders.length} order${tripOrders.length === 1 ? '' : 's'} selected for this trip.`}
        </p>

        {tripOrders.length > 0 && (
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

      <Input label="Notes" {...register('notes')} error={errors.notes?.message} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending} disabled={!canSubmit}>
          {tripOrders.length > 1
            ? `Create ${tripOrders.length} delivery notes (1 trip)`
            : 'Create Delivery Note'}
        </Button>
      </div>
    </form>
  );
}
