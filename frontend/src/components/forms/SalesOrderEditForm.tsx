import { useEffect, useMemo } from 'react';
import { Controller, useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { operationsApi } from '../../services/api';
import { Alert, Button, Input, formatCurrency } from '../ui';
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
          const qty = Number(line?.quantity || 0);
          const unitPrice = Number(line?.unitPrice || 0);
          const discount = Number(line?.discount || 0);
          const lineTotal = Math.round(qty * unitPrice * (1 - discount / 100));
          const isVatCustomer = order.customer?.vatStatus === 'VAT';

          return (
            <div
              key={field.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4 space-y-3"
            >
              <input type="hidden" {...register(`items.${index}.id`)} />
              <input type="hidden" {...register(`items.${index}.confirmedDeliveredQty`)} />

              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Item {index + 1}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="!px-2 !py-1 shrink-0"
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
                  aria-label={`Remove item ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>

              {isExistingLine ? (
                <>
                  <input type="hidden" {...register(`items.${index}.productId`)} />
                  <div>
                    <p className="text-sm font-medium text-slate-700 mb-1">Product</p>
                    <p className="text-sm font-medium text-slate-900 rounded-xl border border-slate-200 bg-white px-3 py-2">
                      {line?.productLabel || 'Product'}
                    </p>
                    {confirmed > 0 && (
                      <p className="text-xs text-amber-700 mt-1.5">
                        {confirmed} customer-delivered — cannot go below / cannot remove
                      </p>
                    )}
                  </div>
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

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Input
                  label="Qty"
                  type="number"
                  min={confirmed || 1}
                  inputMode="numeric"
                  {...register(`items.${index}.quantity`)}
                  error={errors.items?.[index]?.quantity?.message}
                />
                <Input
                  label={isVatCustomer ? 'Price*' : 'Price'}
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  title={isVatCustomer ? 'Price includes VAT' : undefined}
                  {...register(`items.${index}.unitPrice`)}
                  error={errors.items?.[index]?.unitPrice?.message}
                />
                <Input
                  label="Disc %"
                  type="number"
                  min={0}
                  max={100}
                  inputMode="decimal"
                  {...register(`items.${index}.discount`)}
                />
              </div>
              {isVatCustomer && (
                <p className="text-[11px] text-slate-500 -mt-1">* Price includes VAT</p>
              )}

              <div className="flex items-center justify-between border-t border-slate-200/80 pt-2">
                <span className="text-xs text-slate-500">Line total</span>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatCurrency(lineTotal)}
                </span>
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
