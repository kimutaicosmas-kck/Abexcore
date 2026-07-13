import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Product } from '../../types';

const productSchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  barcode: z.string().optional(),
  name: z.string().min(1, 'Name is required'),
  category: z.enum([
    'OIL_FILTER', 'FUEL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
    'HYDRAULIC_FILTER', 'WATER_FILTER', 'INDUSTRIAL_FILTER', 'CUSTOM_FILTER',
  ]),
  description: z.string().optional(),
  manufacturingCost: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  distributorPrice: z.coerce.number().min(0).optional(),
  retailPrice: z.coerce.number().min(0).optional(),
  minStockLevel: z.coerce.number().int().min(0).optional(),
});

type ProductFormData = z.infer<typeof productSchema>;

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

  const categoryOptions = (categoriesData || []).map((c) => ({
    value: c,
    label: c.replace(/_/g, ' '),
  }));

  const { register, handleSubmit, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          sku: product.sku,
          barcode: product.barcode || '',
          name: product.name,
          category: product.category as ProductFormData['category'],
          manufacturingCost: Number(product.manufacturingCost),
          sellingPrice: Number(product.sellingPrice),
          distributorPrice: Number(product.distributorPrice),
          retailPrice: Number(product.retailPrice),
          minStockLevel: product.minStockLevel,
        }
      : { category: 'OIL_FILTER', minStockLevel: 0 },
  });

  const mutation = useMutation({
    mutationFn: (data: ProductFormData) =>
      isEdit ? productsApi.update(product!.id, data) : productsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save product. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="SKU *" {...register('sku')} error={errors.sku?.message} disabled={isEdit} />
        <Input label="Barcode" {...register('barcode')} />
        <Input label="Product Name *" {...register('name')} error={errors.name?.message} className="md:col-span-2" />
        <Select label="Category *" options={categoryOptions} {...register('category')} error={errors.category?.message} />
        <Input label="Min Stock Level" type="number" {...register('minStockLevel')} />
        <Input label="Manufacturing Cost (KES)" type="number" step="0.01" {...register('manufacturingCost')} />
        <Input label="Selling Price (KES)" type="number" step="0.01" {...register('sellingPrice')} />
        <Input label="Distributor Price (KES)" type="number" step="0.01" {...register('distributorPrice')} />
        <Input label="Retail Price (KES)" type="number" step="0.01" {...register('retailPrice')} />
      </div>
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
