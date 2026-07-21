import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deliveryApi, operationsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { SalesOrder, Vehicle, vehicleTypeLabel } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';

const deliveryItemSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().min(1),
});

const deliverySchema = z.object({
  salesOrderId: z.string().min(1, 'Sales order is required'),
  vehicleId: z.string().optional(),
  driverId: z.string().optional(),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(deliveryItemSchema).min(1, 'Add at least one item'),
});

type DeliveryFormData = z.infer<typeof deliverySchema>;

interface DeliveryFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function DeliveryForm({ onSuccess, onCancel }: DeliveryFormProps) {
  const queryClient = useQueryClient();

  const { data: salesOrdersData } = useQuery({
    queryKey: ['sales-orders-deliverable'],
    queryFn: async () => {
      const [ready, partial] = await Promise.all([
        operationsApi.salesOrders({ limit: 100, status: 'READY' }).then((r) => r.data.data as SalesOrder[]),
        operationsApi.salesOrders({ limit: 100, status: 'PARTIALLY_DELIVERED' }).then((r) => r.data.data as SalesOrder[]),
      ]);
      return [...ready, ...partial];
    },
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => deliveryApi.vehicles().then((r) => r.data.data as Vehicle[]),
  });

  const { data: driversData } = useQuery({
    queryKey: ['delivery-drivers'],
    queryFn: () =>
      deliveryApi.drivers().then(
        (r) => r.data.data as { id: string; firstName: string; lastName: string; email: string }[]
      ),
  });

  const salesOrderOptions = [
    { value: '', label: 'Select sales order...' },
    ...(salesOrdersData || []).map((o) => ({
      value: o.id,
      label: `${o.orderNumber} - ${o.customer.name} (${o.status.replace(/_/g, ' ')})`,
    })),
  ];

  const vehicleOptions = [
    { value: '', label: 'Unassigned — assign motorcycle, truck, or lorry later' },
    ...(vehiclesData || []).map((v) => ({
      value: v.id,
      label: `${vehicleTypeLabel(v.type)} · ${v.registration}${v.make ? ` (${v.make}${v.model ? ` ${v.model}` : ''})` : ''}`,
    })),
  ];

  const driverOptions = [
    { value: '', label: 'Select driver…' },
    ...(driversData || []).map((d) => ({
      value: d.id,
      label: `${d.firstName} ${d.lastName}`.trim(),
    })),
  ];

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<DeliveryFormData>({
    resolver: zodResolver(deliverySchema),
    defaultValues: {
      salesOrderId: '',
      vehicleId: '',
      driverId: '',
      items: [{ productId: '', quantity: 1 }],
    },
  });

  const { fields, replace } = useFieldArray({ control, name: 'items' });
  const salesOrderId = watch('salesOrderId');

  const selectedOrder = useMemo(
    () => salesOrdersData?.find((o) => o.id === salesOrderId),
    [salesOrderId, salesOrdersData]
  );

  useEffect(() => {
    if (selectedOrder?.items?.length) {
      replace(
        selectedOrder.items.map((item) => ({
          productId: item.productId,
          quantity: Math.max(1, item.quantity - (item.deliveredQty || 0)),
        }))
      );
    }
  }, [selectedOrder, replace]);

  const mutation = useMutation({
    mutationFn: (data: DeliveryFormData) => {
      const payload = {
        ...data,
        vehicleId: data.vehicleId || undefined,
        driverId: data.driverId || undefined,
      };
      return deliveryApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders-deliverable'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create delivery. Check quantities against remaining order balance.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Sales Order *"
          options={salesOrderOptions}
          {...register('salesOrderId')}
          error={errors.salesOrderId?.message}
        />
        <Select label="Vehicle" options={vehicleOptions} {...register('vehicleId')} />
        <Select label="Driver" options={driverOptions} {...register('driverId')} />
        <Input label="Scheduled Date" type="date" {...register('scheduledDate')} />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Delivery Items *</label>
        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => {
            const orderItem = selectedOrder?.items.find(
              (item) => item.productId === watch(`items.${index}.productId`)
            );
            const remaining = orderItem
              ? orderItem.quantity - (orderItem.deliveredQty || 0)
              : null;
            const productLabel = orderItem?.product
              ? formatProductOptionLabel(orderItem.product)
              : 'Product';

            return (
              <div key={field.id} className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
                <input type="hidden" {...register(`items.${index}.productId`)} />
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Product</label>
                  <p className="text-sm font-medium">{productLabel}</p>
                  {remaining !== null && (
                    <p className="text-xs text-slate-500 mt-1">Remaining: {remaining}</p>
                  )}
                </div>
                <Input
                  label={index === 0 ? 'Quantity' : undefined}
                  type="number"
                  min={1}
                  max={remaining ?? undefined}
                  {...register(`items.${index}.quantity`)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <Input label="Notes" {...register('notes')} />

      <p className="text-xs text-slate-500">
        A sales invoice is auto-created for the quantities on this delivery note.
      </p>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Delivery</Button>
      </div>
    </form>
  );
}
