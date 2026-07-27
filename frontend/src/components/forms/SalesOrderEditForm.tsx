import { useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationsApi } from '../../services/api';
import { Alert, Button, Input } from '../ui';
import { SalesOrder } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { getApiErrorMessage } from '../../utils/apiError';

const editItemSchema = z.object({
  id: z.string().optional(),
  productId: z.string().min(1),
  productLabel: z.string().optional(),
  quantity: z.coerce.number().int().min(1),
  deliveredQty: z.coerce.number().int().min(0).optional(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).optional(),
});

const editOrderSchema = z.object({
  adjustmentReason: z.string().min(1, 'Reason is required'),
  items: z.array(editItemSchema).min(1),
});

type EditOrderFormData = z.infer<typeof editOrderSchema>;

interface SalesOrderEditFormProps {
  order: SalesOrder;
  onSuccess: (updated: SalesOrder) => void;
  onCancel: () => void;
}

export function SalesOrderEditForm({ order, onSuccess, onCancel }: SalesOrderEditFormProps) {
  const queryClient = useQueryClient();

  const { register, control, handleSubmit, formState: { errors } } = useForm<EditOrderFormData>({
    resolver: zodResolver(editOrderSchema),
    defaultValues: {
      adjustmentReason: '',
      items: (order.items || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        productLabel: item.product ? formatProductOptionLabel(item.product) : item.productId,
        quantity: item.quantity,
        deliveredQty: item.deliveredQty || 0,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount || 0),
      })),
    },
  });

  const { fields } = useFieldArray({ control, name: 'items' });

  const mutation = useMutation({
    mutationFn: (data: EditOrderFormData) =>
      operationsApi.updateOrderItems(order.id, {
        adjustmentReason: data.adjustmentReason,
        items: data.items.map(({ id, productId, quantity, unitPrice, discount }) => ({
          id,
          productId,
          quantity,
          unitPrice,
          discount,
        })),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders-deliverable'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSuccess(res.data.data as SalesOrder);
    },
  });

  useEffect(() => {
    mutation.reset();
  }, [order.id, mutation]);

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>}

      <Alert variant="info">
        Adjust quantities to match available stock or customer agreement. Quantity cannot go below what is already delivered.
        The assigned salesperson will be notified of changes.
      </Alert>

      <Input
        label="Reason for adjustment *"
        placeholder="e.g. Only 40 units in stock — customer agreed to 40"
        {...register('adjustmentReason')}
        error={errors.adjustmentReason?.message}
      />

      <div className="space-y-3">
        {fields.map((field, index) => {
          const delivered = field.deliveredQty || 0;
          return (
            <div key={field.id} className="rounded-lg border border-border p-3 grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input type="hidden" {...register(`items.${index}.id`)} />
              <input type="hidden" {...register(`items.${index}.productId`)} />
              <div className="sm:col-span-5">
                <p className="text-sm font-medium text-slate-900">{field.productLabel}</p>
                {delivered > 0 && (
                  <p className="text-xs text-amber-700 mt-1">{delivered} already delivered — minimum qty</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Qty"
                  type="number"
                  min={delivered || 1}
                  {...register(`items.${index}.quantity`)}
                />
              </div>
              <div className="sm:col-span-2">
                <Input label="Price" type="number" step="0.01" {...register(`items.${index}.unitPrice`)} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Disc %" type="number" min={0} max={100} {...register(`items.${index}.discount`)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Save adjustments</Button>
      </div>
    </form>
  );
}
