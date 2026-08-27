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

const transferSchema = z.object({
  fromWarehouseId: z.string().min(1, 'Source warehouse required'),
  toWarehouseId: z.string().min(1, 'Destination warehouse required'),
  rawMaterialId: z.string().optional(),
  productId: z.string().optional(),
  quantity: z.coerce.number().min(0.001),
  batchNumber: z.string().optional(),
  notes: z.string().optional(),
}).refine((d) => d.rawMaterialId || d.productId, {
  message: 'Select a raw material or product',
  path: ['rawMaterialId'],
}).refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
  message: 'Warehouses must be different',
  path: ['toWarehouseId'],
});

type TransferFormData = z.infer<typeof transferSchema>;

interface Warehouse {
  id: string;
  code: string;
  name: string;
  type?: string;
}

interface StockTransferFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function StockTransferForm({ onSuccess, onCancel }: StockTransferFormProps) {
  const queryClient = useQueryClient();

  const asWarehouseList = (value: unknown): Warehouse[] => {
    if (Array.isArray(value)) return value as Warehouse[];
    if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
      return (value as { data: Warehouse[] }).data;
    }
    return [];
  };

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => asWarehouseList((await inventoryApi.warehouses()).data),
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: { quantity: 1, productId: '', rawMaterialId: '' },
  });

  const rawMaterialId = useWatch({ control, name: 'rawMaterialId' });
  const productId = useWatch({ control, name: 'productId' });
  const allowedType = rawMaterialId
    ? 'raw_materials'
    : productId
      ? 'finished_goods'
      : null;

  const filtered = asWarehouseList(warehouses).filter((w) =>
    allowedType ? w.type === allowedType : true
  );
  const whOpts = [
    { value: '', label: allowedType ? 'Select...' : 'Select material or product first...' },
    ...filtered.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
  ];

  useEffect(() => {
    if (!allowedType) {
      setValue('fromWarehouseId', '');
      setValue('toWarehouseId', '');
      return;
    }
    if (filtered[0]) setValue('fromWarehouseId', filtered[0].id);
    if (filtered[1]) setValue('toWarehouseId', filtered[1].id);
    else if (filtered[0]) setValue('toWarehouseId', '');
  }, [allowedType, filtered[0]?.id, filtered[1]?.id, setValue]);

  const mutation = useMutation({
    mutationFn: (data: TransferFormData) => inventoryApi.transferStock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(mutation.error as AxiosError<{ message?: string }>)?.response?.data?.message ||
            'Transfer failed. Check stock at source warehouse.'}
        </div>
      )}
      <Select
        label="Raw Material"
        options={[{ value: '', label: 'None' }, ...(materials || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` }))]}
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
      <div className="grid grid-cols-2 gap-4">
        <Select label="From Warehouse *" options={whOpts} {...register('fromWarehouseId')} error={errors.fromWarehouseId?.message} disabled={!allowedType} />
        <Select label="To Warehouse *" options={whOpts} {...register('toWarehouseId')} error={errors.toWarehouseId?.message} disabled={!allowedType} />
      </div>
      {allowedType && (
        <p className="text-xs text-slate-500">
          Transfers stay within the same warehouse type ({allowedType === 'raw_materials' ? 'raw materials' : 'finished goods'}).
        </p>
      )}
      <Input label="Quantity *" type="number" step="0.001" {...register('quantity')} error={errors.quantity?.message} />
      <Input label="Batch No" {...register('batchNumber')} />
      <Input label="Notes" {...register('notes')} />
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Transfer</Button>
      </div>
    </form>
  );
}
