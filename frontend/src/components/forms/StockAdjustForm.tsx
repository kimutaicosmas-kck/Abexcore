import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { RawMaterial } from '../../types';
import { ProductSearchSelect } from './ProductSearchSelect';

const stockAdjustSchema = z.object({
  warehouseId: z.string().min(1, 'Warehouse is required'),
  rawMaterialId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.coerce.number().min(0.001, 'Quantity must be greater than 0'),
  type: z.enum(['add', 'remove']),
  notes: z.string().optional(),
}).refine((data) => data.rawMaterialId || data.productId, {
  message: 'Select either a raw material or a product',
  path: ['rawMaterialId'],
});

type StockAdjustFormData = z.infer<typeof stockAdjustSchema>;

const adjustTypeOptions = [
  { value: 'add', label: 'Add Stock' },
  { value: 'remove', label: 'Remove Stock' },
];

interface Warehouse {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface StockAdjustFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function StockAdjustForm({ onSuccess, onCancel }: StockAdjustFormProps) {
  const queryClient = useQueryClient();

  const asWarehouseList = (value: unknown): Warehouse[] => {
    if (Array.isArray(value)) return value as Warehouse[];
    if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
      return (value as { data: Warehouse[] }).data;
    }
    return [];
  };

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const body = (await inventoryApi.warehouses()).data;
      return asWarehouseList(body);
    },
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<StockAdjustFormData>({
    resolver: zodResolver(stockAdjustSchema),
    defaultValues: {
      warehouseId: '',
      rawMaterialId: '',
      productId: '',
      type: 'add',
      quantity: 1,
    },
  });

  const rawMaterialId = useWatch({ control, name: 'rawMaterialId' });
  const productId = useWatch({ control, name: 'productId' });

  const allowedType = rawMaterialId
    ? 'raw_materials'
    : productId
      ? 'finished_goods'
      : null;

  const filteredWarehouses = asWarehouseList(warehousesData).filter((w) =>
    allowedType ? w.type === allowedType : true
  );

  const warehouseOptions = [
    { value: '', label: allowedType ? 'Select warehouse...' : 'Select material or product first...' },
    ...filteredWarehouses.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
  ];

  const materialOptions = [
    { value: '', label: 'None' },
    ...(materialsData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  useEffect(() => {
    if (!allowedType) {
      setValue('warehouseId', '');
      return;
    }
    const preferred = filteredWarehouses[0];
    if (preferred) setValue('warehouseId', preferred.id);
  }, [allowedType, filteredWarehouses[0]?.id, setValue]);

  const mutation = useMutation({
    mutationFn: (data: StockAdjustFormData) => {
      const payload = {
        ...data,
        rawMaterialId: data.rawMaterialId || undefined,
        productId: data.productId || undefined,
        notes: data.notes || undefined,
      };
      return inventoryApi.adjustStock(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(mutation.error as AxiosError<{ message?: string }>)?.response?.data?.message ||
            'Failed to adjust stock. Please try again.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Raw Material"
          options={materialOptions}
          {...register('rawMaterialId', {
            onChange: () => setValue('productId', ''),
          })}
          error={errors.rawMaterialId?.message}
        />
        <Controller
          name="productId"
          control={control}
          render={({ field }) => (
            <ProductSearchSelect
              label="Product"
              value={field.value || ''}
              onChange={(id) => {
                field.onChange(id);
                if (id) setValue('rawMaterialId', '');
              }}
            />
          )}
        />
        <Select
          label="Warehouse *"
          options={warehouseOptions}
          {...register('warehouseId')}
          error={errors.warehouseId?.message}
          disabled={!allowedType}
        />
        <Select label="Adjustment Type *" options={adjustTypeOptions} {...register('type')} />
        <Input
          label="Quantity *"
          type="number"
          step="0.001"
          min={0.001}
          {...register('quantity')}
          error={errors.quantity?.message}
        />
      </div>
      {allowedType && (
        <p className="text-xs text-slate-500">
          {allowedType === 'raw_materials'
            ? 'Raw materials are adjusted in the raw materials warehouse only.'
            : 'Finished products are adjusted in the finished goods warehouse only.'}
        </p>
      )}
      <Input label="Notes" {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Adjust Stock</Button>
      </div>
    </form>
  );
}
