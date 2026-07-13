import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deliveryApi, operationsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { SalesOrder } from '../../types';

const deliveryItemSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  quantity: z.coerce.number().int().min(1),
});

const deliverySchema = z.object({
  salesOrderId: z.string().min(1, 'Sales order is required'),
  vehicleId: z.string().optional(),
  scheduledDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(deliveryItemSchema).min(1, 'Add at least one item'),
});

type DeliveryFormData = z.infer<typeof deliverySchema>;

interface Vehicle {
  id: string;
  registrationNo: string;
  make?: string;
}

interface DeliveryFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function DeliveryForm({ onSuccess, onCancel }: DeliveryFormProps) {
  const queryClient = useQueryClient();

  const { data: salesOrdersData } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => operationsApi.salesOrders({ limit: 100 }).then((r) => r.data.data as SalesOrder[]),
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => deliveryApi.vehicles().then((r) => r.data.data as Vehicle[]),
  });

  const salesOrderOptions = [
    { value: '', label: 'Select sales order...' },
    ...(salesOrdersData || []).map((o) => ({
      value: o.id,
      label: `${o.orderNumber} - ${o.customer.name}`,
    })),
  ];

  const vehicleOptions = [
    { value: '', label: 'None' },
    ...(vehiclesData || []).map((v) => ({
      value: v.id,
      label: v.registrationNo + (v.make ? ` (${v.make})` : ''),
    })),
  ];

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<DeliveryFormData>({
    resolver: zodResolver(deliverySchema),
    defaultValues: {
      salesOrderId: '',
      vehicleId: '',
      items: [{ productId: '', quantity: 1 }],
    },
  });

  const { fields, replace } = useFieldArray({ control, name: 'items' });
  const salesOrderId = watch('salesOrderId');

  useEffect(() => {
    if (salesOrderId && salesOrdersData) {
      const order = salesOrdersData.find((o) => o.id === salesOrderId);
      if (order?.items?.length) {
        replace(
          order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          }))
        );
      }
    }
  }, [salesOrderId, salesOrdersData, replace]);

  const mutation = useMutation({
    mutationFn: (data: DeliveryFormData) => {
      const payload = {
        ...data,
        vehicleId: data.vehicleId || undefined,
      };
      return deliveryApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create delivery. Please check all fields.
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
        <Input label="Scheduled Date" type="date" {...register('scheduledDate')} />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">Delivery Items *</label>
        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => {
            const order = salesOrdersData?.find((o) => o.id === salesOrderId);
            const orderItem = order?.items[index];
            const productLabel = orderItem?.product
              ? `${orderItem.product.sku} - ${orderItem.product.name}`
              : 'Product';

            return (
              <div key={field.id} className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-lg">
                <input type="hidden" {...register(`items.${index}.productId`)} />
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Product</label>
                  <p className="text-sm font-medium">{productLabel}</p>
                </div>
                <Input
                  label={index === 0 ? 'Quantity' : undefined}
                  type="number"
                  min={1}
                  {...register(`items.${index}.quantity`)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <Input label="Notes" {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Delivery</Button>
      </div>
    </form>
  );
}
