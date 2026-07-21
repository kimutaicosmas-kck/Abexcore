import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { productsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Product } from '../../types';

const productSchema = z.object({
  sku: z.string().min(1, 'Part number is required'),
  barcode: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  category: z.enum([
    'OIL_FILTER', 'FUEL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
    'HYDRAULIC_FILTER', 'WATER_FILTER', 'INDUSTRIAL_FILTER', 'CUSTOM_FILTER',
  ]),
  description: z.string().optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  distributorPrice: z.coerce.number().min(0).optional(),
  retailPrice: z.coerce.number().min(0).optional(),
  minStockLevel: z.coerce.number().int().min(0).optional(),
  initialQuantity: z.coerce.number().int().min(0).optional(),
  warehouseId: z.string().optional(),
  isActive: z.boolean().optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

interface StockWarehouse {
  id: string;
  code: string;
  name: string;
}

interface ProductFormProps {
  product?: Product | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSuccess, onCancel }: ProductFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!product;

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data.data as string[]),
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['product-stock-warehouses'],
    queryFn: () => productsApi.stockWarehouses().then((r) => r.data.data as StockWarehouse[]),
    enabled: !isEdit,
  });

  const categoryOptions = (categoriesData || []).map((c) => ({
    value: c,
    label: c.replace(/_/g, ' '),
  }));

  const warehouseOptions = [
    { value: '', label: 'Default finished goods warehouse' },
    ...(warehousesData || []).map((w) => ({
      value: w.id,
      label: `${w.code} - ${w.name}`,
    })),
  ];

  const { register, handleSubmit, watch, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          sku: product.sku,
          barcode: product.barcode || '',
          name: product.name,
          category: product.category as ProductFormData['category'],
          sellingPrice: Number(product.sellingPrice),
          distributorPrice: Number(product.distributorPrice),
          retailPrice: Number(product.retailPrice),
          minStockLevel: product.minStockLevel,
          description: product.description || '',
          isActive: product.isActive,
        }
      : {
          category: 'OIL_FILTER',
          minStockLevel: 0,
          initialQuantity: 0,
          warehouseId: '',
          isActive: true,
        },
  });

  const initialQuantity = Number(watch('initialQuantity') || 0);

  const mutation = useMutation({
    mutationFn: (data: ProductFormData) => {
      const payload = {
        ...data,
        warehouseId: data.warehouseId || undefined,
      };
      return isEdit ? productsApi.update(product!.id, payload) : productsApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['product-detail', product!.id] });
      onSuccess();
    },
  });

  const getError = (err: unknown) =>
    (err as AxiosError<{ message?: string }>).response?.data?.message || 'Failed to save product.';

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{getError(mutation.error)}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Part number *" {...register('sku')} error={errors.sku?.message} disabled={isEdit} />
        <Input label="Barcode" {...register('barcode')} />
        <Input label="Product Name *" {...register('name')} error={errors.name?.message} className="md:col-span-2" />
        <Select label="Category *" options={categoryOptions} {...register('category')} error={errors.category?.message} />
        <Input label="Min Stock Level" type="number" {...register('minStockLevel')} />
        <Input label="Selling Price (KES)" type="number" step="0.01" {...register('sellingPrice')} />
        <Input label="Distributor Price (KES)" type="number" step="0.01" {...register('distributorPrice')} />
        <Input label="Retail Price (KES)" type="number" step="0.01" {...register('retailPrice')} />
        {!isEdit && (
          <>
            <Input
              label="Opening stock quantity"
              type="number"
              min={0}
              step={1}
              {...register('initialQuantity')}
              error={errors.initialQuantity?.message}
            />
            <Select
              label="Stock warehouse"
              options={warehouseOptions}
              {...register('warehouseId')}
              disabled={initialQuantity <= 0}
            />
          </>
        )}
        {isEdit && (
          <Select
            label="Status"
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
            {...register('isActive', { setValueAs: (v) => v === true || v === 'true' })}
          />
        )}
      </div>
      {!isEdit && (
        <p className="text-xs text-slate-500">
          Enter how many units you have on hand (e.g. 5000). Stock is recorded when the product is created.
          Use Inventory to adjust stock later.
        </p>
      )}
      <Input label="Description" {...register('description')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}
