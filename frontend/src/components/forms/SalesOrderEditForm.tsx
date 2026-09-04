import { useEffect, useMemo } from 'react';
import { useForm, useFieldArray, Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationsApi } from '../../services/api';
import { Alert, Button, Input, formatCurrency } from '../ui';
import { SalesOrder } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { getApiErrorMessage } from '../../utils/apiError';
import { ProductLineItemsEditor } from './ProductLineItemsEditor';

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

      <ProductLineItemsEditor
        fields={fields}
        items={items}
        control={control as Control<any>}
        register={register as UseFormRegister<any>}
        setValue={setValue as UseFormSetValue<any>}
        errors={errors as FieldErrors<any>}
        allowAdd={canAddProducts}
        onAppend={() =>
          append({
            productId: '',
            productLabel: '',
            quantity: 1,
            confirmedDeliveredQty: 0,
            unitPrice: 0,
            discount: 0,
          })
        }
        onRemove={remove}
        isVatCustomer={order.customer?.vatStatus === 'VAT'}
        sectionLabel="Order items"
        canRemoveItem={(index, item) => {
          const confirmed = Number(item?.confirmedDeliveredQty || 0);
          return orderOpen && confirmed === 0 && fields.length > 1;
        }}
        isProductEditable={(_, item) => !Boolean(item?.id)}
        getProductLabel={(_, item) => item?.productLabel}
        getQuantityMin={(_, item) => {
          const confirmed = Number(item?.confirmedDeliveredQty || 0);
          return confirmed || 1;
        }}
        onProductSelected={(index, product) => {
          if (!product) {
            setValue(`items.${index}.productLabel`, '');
            setValue(`items.${index}.unitPrice`, 0);
            return;
          }
          setValue(`items.${index}.productLabel`, formatProductOptionLabel(product));
          setValue(`items.${index}.unitPrice`, Number(product.sellingPrice || 0));
        }}
        renderEditorExtras={(index, item) => {
          const confirmed = Number(item?.confirmedDeliveredQty || 0);
          const isExistingLine = Boolean(item?.id);
          return (
            <>
              <input type="hidden" {...register(`items.${index}.id`)} />
              <input type="hidden" {...register(`items.${index}.confirmedDeliveredQty`)} />
              <input type="hidden" {...register(`items.${index}.productLabel`)} />
              {isExistingLine && <input type="hidden" {...register(`items.${index}.productId`)} />}
              {confirmed > 0 && (
                <p className="text-xs text-amber-700">
                  {confirmed} customer-delivered — quantity cannot go below this / line cannot be removed
                </p>
              )}
            </>
          );
        }}
      />

      {typeof errors.items?.root?.message === 'string' && (
        <p className="text-sm text-red-600">{errors.items.root.message}</p>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Save adjustments</Button>
      </div>
    </form>
  );
}
