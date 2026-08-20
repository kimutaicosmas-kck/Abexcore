import { useEffect, useMemo } from 'react';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { operationsApi } from '../../services/api';
import { Alert, Button, Input } from '../ui';
import { SalesOrder } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { getApiErrorMessage } from '../../utils/apiError';
import { ProductSearchSelect } from './ProductSearchSelect';

const editItemSchema = z.object({
  id: z.string().optional(),
  productId: z.string().min(1, 'Product required'),
  productLabel: z.string().optional(),
  quantity: z.coerce.number().int().min(1),
  /** Qty confirmed on DELIVERED delivery notes — hard floor. */
  confirmedDeliveredQty: z.coerce.number().int().min(0).optional(),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).optional(),
});

const editOrderSchema = z.object({
  adjustmentReason: z.string().min(1, 'Reason is required'),
  items: z.array(editItemSchema).min(1, 'Keep at least one item'),
});

type EditOrderFormData = z.infer<typeof editOrderSchema>;

interface SalesOrderEditFormProps {
  order: SalesOrder;
  onSuccess: (updated: SalesOrder) => void;
  onCancel: () => void;
}

function confirmedQtyForProduct(order: SalesOrder, productId: string): number {
  const deliveries = order.deliveries || [];
  let sum = 0;
  for (const dn of deliveries) {
    if (dn.status !== 'DELIVERED') continue;
    for (const item of dn.items || []) {
      if (item.productId === productId) sum += Number(item.quantity || 0);
    }
  }
  return sum;
}

export function SalesOrderEditForm({ order, onSuccess, onCancel }: SalesOrderEditFormProps) {
  const queryClient = useQueryClient();
  const orderOpen = !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status);
  const canAddProducts = orderOpen;

  const defaultItems = useMemo(
    () =>
      (order.items || []).map((item) => ({
        id: item.id,
        productId: item.productId,
        productLabel: item.product ? formatProductOptionLabel(item.product) : item.productId,
        quantity: item.quantity,
        confirmedDeliveredQty: confirmedQtyForProduct(order, item.productId),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount || 0),
      })),
    [order]
  );

  const { register, control, handleSubmit, setValue, watch, formState: { errors } } = useForm<EditOrderFormData>({
    resolver: zodResolver(editOrderSchema),
    defaultValues: {
      adjustmentReason: '',
      items: defaultItems,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  const mutation = useMutation({
    mutationFn: (data: EditOrderFormData) =>
      operationsApi.updateOrderItems(order.id, {
        adjustmentReason: data.adjustmentReason,
        items: data.items.map(({ id, productId, quantity, unitPrice, discount }) => ({
          id: id || undefined,
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
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      onSuccess(res.data.data as SalesOrder);
    },
  });

  useEffect(() => {
    mutation.reset();
  }, [order.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>}

      <Input
        label="Reason for adjustment *"
        placeholder="e.g. Customer requested an extra product / remove unavailable item"
        {...register('adjustmentReason')}
        error={errors.adjustmentReason?.message}
      />

      <p className="text-xs text-slate-600">
        You can add or remove lines until the order is marked delivered. Open dispatches are reversed
        automatically when you reduce or remove undelivered quantities.
      </p>

      <div className="space-y-3">
        {fields.map((field, index) => {
          const line = items?.[index];
          const confirmed = Number(line?.confirmedDeliveredQty || 0);
          const isExistingLine = Boolean(line?.id);
          const canRemove = orderOpen && confirmed === 0 && fields.length > 1;

          return (
            <div key={field.id} className="rounded-lg border border-border p-3 grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input type="hidden" {...register(`items.${index}.id`)} />
              <input type="hidden" {...register(`items.${index}.confirmedDeliveredQty`)} />

              <div className="sm:col-span-5">
                {isExistingLine ? (
                  <>
                    <input type="hidden" {...register(`items.${index}.productId`)} />
                    <p className="text-sm font-medium text-slate-900">
                      {line?.productLabel || 'Product'}
                    </p>
                    {confirmed > 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        {confirmed} customer-delivered — cannot go below / cannot remove
                      </p>
                    )}
                  </>
                ) : (
                  <Controller
                    control={control}
                    name={`items.${index}.productId`}
                    render={({ field: productField }) => (
                      <ProductSearchSelect
                        label="Product"
                        value={productField.value}
                        onChange={productField.onChange}
                        onProductSelect={(product) => {
                          if (!product) {
                            setValue(`items.${index}.productLabel`, '');
                            setValue(`items.${index}.unitPrice`, 0);
                            return;
                          }
                          setValue(`items.${index}.productLabel`, formatProductOptionLabel(product));
                          setValue(`items.${index}.unitPrice`, Number(product.sellingPrice || 0));
                        }}
                        error={errors.items?.[index]?.productId?.message}
                      />
                    )}
                  />
                )}
              </div>

              <div className="sm:col-span-2">
                <Input
                  label="Qty"
                  type="number"
                  min={confirmed || 1}
                  {...register(`items.${index}.quantity`)}
                  error={errors.items?.[index]?.quantity?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  label={order.customer?.vatStatus === 'VAT' ? 'Price (incl. VAT)' : 'Price'}
                  type="number"
                  step="0.01"
                  {...register(`items.${index}.unitPrice`)}
                  error={errors.items?.[index]?.unitPrice?.message}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Disc %"
                  type="number"
                  min={0}
                  max={100}
                  {...register(`items.${index}.discount`)}
                />
              </div>
              <div className="sm:col-span-1 flex items-end justify-end pb-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canRemove}
                  title={
                    !canRemove
                      ? confirmed > 0
                        ? 'Cannot remove — already customer-delivered'
                        : !orderOpen
                          ? 'Order is closed'
                          : 'Keep at least one item'
                      : 'Remove item'
                  }
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {errors.items?.message && (
        <p className="text-sm text-red-600">{errors.items.message}</p>
      )}
      {typeof errors.items?.root?.message === 'string' && (
        <p className="text-sm text-red-600">{errors.items.root.message}</p>
      )}

      {canAddProducts && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            append({
              productId: '',
              productLabel: '',
              quantity: 1,
              confirmedDeliveredQty: 0,
              unitPrice: 0,
              discount: 0,
            })
          }
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add item
        </Button>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Save adjustments</Button>
      </div>
    </form>
  );
}
