import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { productsApi } from '../../services/api';
import { Button, Input, Select, NumberInput } from '../ui';
import { Product, ProductCategoryOption } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';
import { ProductBomEditor } from './ProductBomEditor';

const productSchema = z.object({
  sku: z.string().min(1, 'Part number is required'),
  name: z.string().min(1, 'Name is required'),
  categoryId: z.string().uuid('Select a category'),
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

const productDefaultValues: ProductFormData = {
  sku: '',
  name: '',
  categoryId: '',
  minStockLevel: 0,
  initialQuantity: 0,
  warehouseId: '',
  isActive: true,
};

interface StockWarehouse {
  id: string;
  code: string;
  name: string;
}

type ProductWithStock = Product & {
  onHand?: number;
  warehouses?: { id: string; quantity: number }[];
};

function resolveOnHand(product: ProductWithStock): number {
  if (typeof product.onHand === 'number') return product.onHand;
  if (product.warehouses?.length) {
    return product.warehouses.reduce((sum, w) => sum + Number(w.quantity || 0), 0);
  }
  return (product.stockLevels || []).reduce((sum, sl) => sum + Number(sl.quantity || 0), 0);
}

interface ProductFormProps {
  product?: Product | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSuccess, onCancel }: ProductFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!product;
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data.data as ProductCategoryOption[]),
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['product-stock-warehouses'],
    queryFn: () => productsApi.stockWarehouses().then((r) => r.data.data as StockWarehouse[]),
  });

  const categoryOptions = (categoriesData || []).map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const warehouseOptions = [
    { value: '', label: 'Default finished goods warehouse' },
    ...(warehousesData || []).map((w) => ({
      value: w.id,
      label: `${w.code} - ${w.name}`,
    })),
  ];

  const defaultCategoryId = product?.categoryId || product?.category?.id || categoriesData?.[0]?.id || '';
  const currentOnHand = product ? resolveOnHand(product as ProductWithStock) : 0;

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? {
          sku: product.sku,
          name: product.name,
          categoryId: defaultCategoryId,
          sellingPrice: Number(product.sellingPrice),
          distributorPrice: Number(product.distributorPrice),
          retailPrice: Number(product.retailPrice),
          minStockLevel: product.minStockLevel,
          description: product.description || '',
          isActive: product.isActive,
          initialQuantity: currentOnHand,
          warehouseId: '',
        }
      : { ...productDefaultValues, categoryId: defaultCategoryId },
  });

  const { draftSavedAt, draftRestored, clearDraft, discardDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.product,
    watch,
    getValues,
    reset,
    defaultValues: productDefaultValues,
    enabled: !isEdit,
    isMeaningful: (data) =>
      Boolean(data.sku?.trim()) ||
      Boolean(data.name?.trim()) ||
      Boolean(data.description?.trim()) ||
      Boolean(data.categoryId) ||
      (data.sellingPrice != null && data.sellingPrice > 0) ||
      (data.initialQuantity != null && data.initialQuantity > 0),
  });

  const initialQuantity = Number(watch('initialQuantity') || 0);

  useEffect(() => {
    if (!isEdit && categoriesData?.[0]?.id) {
      setValue('categoryId', categoriesData[0].id, { shouldValidate: true });
    }
  }, [categoriesData, isEdit, setValue]);

  const createCategoryMutation = useMutation({
    mutationFn: (name: string) => productsApi.createCategory({ name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      setValue('categoryId', res.data.data.id, { shouldValidate: true });
      setNewCategoryName('');
      setCategoryError('');
    },
    onError: (err: unknown) => {
      setCategoryError(
        (err as AxiosError<{ message?: string }>).response?.data?.message || 'Failed to add category.'
      );
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProductFormData) => {
      const { isActive, warehouseId, ...rest } = data;
      const payload = {
        ...rest,
        warehouseId: warehouseId?.trim() || undefined,
        ...(isEdit ? { isActive } : {}),
      };
      return isEdit ? productsApi.update(product!.id, payload) : productsApi.create(payload);
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['product-detail', product!.id] });
      onSuccess();
    },
  });

  const getError = (err: unknown) => getApiErrorMessage(err);

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} onDiscard={discardDraft} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{getError(mutation.error)}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Part number *" {...register('sku')} error={errors.sku?.message} disabled={isEdit} className="md:col-span-2" />
        <Input label="Product Name *" {...register('name')} error={errors.name?.message} className="md:col-span-2" />
        <div className="md:col-span-2 space-y-2">
          <Select
            label="Category *"
            options={categoryOptions.length ? categoryOptions : [{ value: '', label: 'No categories yet' }]}
            {...register('categoryId')}
            error={errors.categoryId?.message}
            disabled={!categoryOptions.length}
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              label="Add category"
              placeholder="e.g. Electronics, Clothing, Food"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              error={categoryError}
            />
            <Button
              type="button"
              variant="secondary"
              className="sm:mt-6"
              loading={createCategoryMutation.isPending}
              disabled={!newCategoryName.trim()}
              onClick={() => createCategoryMutation.mutate(newCategoryName.trim())}
            >
              Add category
            </Button>
          </div>
        </div>
        <NumberInput
          label="Min Stock Level"
          min={0}
          step={1}
          value={watch('minStockLevel') ?? 0}
          onChange={(v) => setValue('minStockLevel', v, { shouldValidate: true })}
          error={errors.minStockLevel?.message}
        />
        <Input label="Selling Price (KES)" type="number" step="0.01" {...register('sellingPrice')} />
        <Input label="Distributor Price (KES)" type="number" step="0.01" {...register('distributorPrice')} />
        <Input label="Retail Price (KES)" type="number" step="0.01" {...register('retailPrice')} />
        <NumberInput
          label={isEdit ? 'Opening / on-hand quantity' : 'Opening stock quantity'}
          min={0}
          step={1}
          value={watch('initialQuantity') ?? 0}
          onChange={(v) => setValue('initialQuantity', v, { shouldValidate: true })}
          error={errors.initialQuantity?.message}
        />
        <Select
          label="Stock warehouse"
          options={warehouseOptions}
          {...register('warehouseId')}
          disabled={!isEdit && initialQuantity <= 0}
        />
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
      <Input label="Description" {...register('description')} />

      {isEdit && product?.id && <ProductBomEditor productId={product.id} />}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Product' : 'Create Product'}
        </Button>
      </div>
    </form>
  );
}
