import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, productsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Product, RawMaterial } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';

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

interface StockTransferFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function StockTransferForm({ onSuccess, onCancel }: StockTransferFormProps) {
  const queryClient = useQueryClient();

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data as { id: string; code: string; name: string }[]),
  });

  const { data: materials } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const { data: products } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list({ limit: 100 }).then((r) => r.data.data as Product[]),
  });

  const whOpts = [{ value: '', label: 'Select...' }, ...(warehouses || []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))];

  const { register, handleSubmit, formState: { errors } } = useForm<TransferFormData>({
    resolver: zodResolver(transferSchema),
    defaultValues: { quantity: 1 },
  });

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
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">Transfer failed. Check stock at source warehouse.</div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Select label="From Warehouse *" options={whOpts} {...register('fromWarehouseId')} error={errors.fromWarehouseId?.message} />
        <Select label="To Warehouse *" options={whOpts} {...register('toWarehouseId')} error={errors.toWarehouseId?.message} />
      </div>
      <Select
        label="Raw Material"
        options={[{ value: '', label: 'None' }, ...(materials || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` }))]}
        {...register('rawMaterialId')}
        error={errors.rawMaterialId?.message}
      />
      <Select
        label="Product"
        options={[{ value: '', label: 'None' }, ...(products || []).map((p) => ({ value: p.id, label: formatProductOptionLabel(p) }))]}
        {...register('productId')}
      />
      <Input label="Quantity *" type="number" step="0.001" min={0.001} {...register('quantity')} error={errors.quantity?.message} />
      <Input label="Batch Number" {...register('batchNumber')} />
      <Input label="Notes" {...register('notes')} />
      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Transfer Stock</Button>
      </div>
    </form>
  );
}
