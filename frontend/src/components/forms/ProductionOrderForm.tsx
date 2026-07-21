import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, productsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Machine, Product } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';

const priorityOptions = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const productionOrderSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  machineId: z.string().optional(),
  quantity: z.coerce.number().int().min(1),
  priority: z.string().optional(),
  scheduledStart: z.string().optional(),
  notes: z.string().optional(),
});

type ProductionOrderFormData = z.infer<typeof productionOrderSchema>;

interface ProductionOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProductionOrderForm({ onSuccess, onCancel }: ProductionOrderFormProps) {
  const queryClient = useQueryClient();

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list({ limit: 100 }).then((r) => r.data.data as Product[]),
  });

  const { data: machinesData } = useQuery({
    queryKey: ['machines'],
    queryFn: () => operationsApi.machines().then((r) => r.data.data as Machine[]),
  });

  const productOptions = [
    { value: '', label: 'Select product...' },
    ...(productsData || []).map((p) => ({ value: p.id, label: formatProductOptionLabel(p) })),
  ];

  const machineOptions = [
    { value: '', label: 'None' },
    ...(machinesData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<ProductionOrderFormData>({
    resolver: zodResolver(productionOrderSchema),
    defaultValues: { quantity: 1, priority: 'NORMAL', productId: '', machineId: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: ProductionOrderFormData) => {
      const payload = {
        ...data,
        machineId: data.machineId || undefined,
        scheduledStart: data.scheduledStart ? new Date(data.scheduledStart).toISOString() : undefined,
      };
      return operationsApi.createProduction(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create production order. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Product *"
          options={productOptions}
          {...register('productId')}
          error={errors.productId?.message}
        />
        <Select label="Machine" options={machineOptions} {...register('machineId')} />
        <Input label="Quantity *" type="number" min={1} {...register('quantity')} error={errors.quantity?.message} />
        <Select label="Priority" options={priorityOptions} {...register('priority')} />
        <Input label="Scheduled Start" type="datetime-local" {...register('scheduledStart')} />
      </div>
      <Input label="Notes" {...register('notes')} placeholder="Optional — e.g. batch run, shift notes" />

      <p className="text-xs text-slate-500">
        Production is independent of sales orders. Completed goods are recorded as finished stock ready for sale.
      </p>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Production Order</Button>
      </div>
    </form>
  );
}
