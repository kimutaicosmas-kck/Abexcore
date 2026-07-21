import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { operationsApi, customersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Customer } from '../../types';
import { useVatRate } from '../../contexts/AuthContext';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { useProductPicker } from '../../hooks/useProductPicker';

const orderItemSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).optional(),
});

const salesOrderSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  requiredDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Add at least one item'),
});

type SalesOrderFormData = z.infer<typeof salesOrderSchema>;

interface SalesOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function SalesOrderForm({ onSuccess, onCancel }: SalesOrderFormProps) {
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const { data: productsData, isError: productsError, refetch: refetchProducts } = useProductPicker();

  const customerOptions = (customersData || []).map((c) => ({
    value: c.id,
    label: `${c.code} - ${c.name}`,
  }));

  const productOptions = [
    { value: '', label: 'Select product...' },
    ...(productsData || []).map((p) => ({
      value: p.id,
      label: formatProductOptionLabel(p),
    })),
  ];

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<SalesOrderFormData>({
    resolver: zodResolver(salesOrderSchema),
    defaultValues: {
      items: [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  useEffect(() => {
    items.forEach((item, index) => {
      if (item.productId) {
        const product = productsData?.find((p) => p.id === item.productId);
        if (product && item.unitPrice === 0) {
          setValue(`items.${index}.unitPrice`, Number(product.sellingPrice));
        }
      }
    });
  }, [items, productsData, setValue]);

  const vatRate = useVatRate();
  const vatMultiplier = vatRate / 100;

  const lineTotal = items.reduce((sum, item) => {
    const discount = item.discount || 0;
    return sum + (item.quantity || 0) * (item.unitPrice || 0) * (1 - discount / 100);
  }, 0);
  const tax = lineTotal * vatMultiplier;
  const total = lineTotal + tax;

  const mutation = useMutation({
    mutationFn: (data: SalesOrderFormData) => operationsApi.createSalesOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      onSuccess();
    },
  });

  const apiError = mutation.error as { response?: { data?: { message?: string } } } | null;

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {productsError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Could not load products.{' '}
          <button type="button" className="underline font-medium" onClick={() => refetchProducts()}>
            Retry
          </button>
        </div>
      )}

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {apiError?.response?.data?.message || 'Failed to create order. Please check all fields.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Customer *"
          options={[{ value: '', label: 'Select customer...' }, ...customerOptions]}
          {...register('customerId')}
          error={errors.customerId?.message}
        />
        <Input label="Required Date" type="date" {...register('requiredDate')} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Order Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ productId: '', quantity: 1, unitPrice: 0, discount: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
              <div className="col-span-12 sm:col-span-5">
                <Select
                  label={index === 0 ? 'Product' : undefined}
                  options={productOptions}
                  {...register(`items.${index}.productId`)}
                />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" min={1} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Price' : undefined} type="number" step="0.01" {...register(`items.${index}.unitPrice`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Disc %' : undefined} type="number" min={0} max={100} {...register(`items.${index}.discount`)} />
              </div>
              <div className="col-span-12 sm:col-span-1">
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Input label="Notes" {...register('notes')} />

      <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>KES {lineTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span></div>
        <div className="flex justify-between"><span>VAT ({vatRate}%)</span><span>KES {tax.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span></div>
        <div className="flex justify-between font-bold text-base pt-1 border-t"><span>Total</span><span>KES {total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span></div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Sales Order</Button>
      </div>
    </form>
  );
}
