import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';

const completeProductionSchema = z.object({
  completedQty: z.coerce.number().int().min(0),
  rejectedQty: z.coerce.number().int().min(0).optional(),
  warehouseId: z.string().min(1, 'Warehouse is required'),
});

type CompleteProductionFormData = z.infer<typeof completeProductionSchema>;

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface CompleteProductionFormProps {
  productionId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CompleteProductionForm({ productionId, onSuccess, onCancel }: CompleteProductionFormProps) {
  const queryClient = useQueryClient();

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data as Warehouse[]),
  });

  const warehouseOptions = [
    { value: '', label: 'Select warehouse...' },
    ...(warehousesData || []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<CompleteProductionFormData>({
    resolver: zodResolver(completeProductionSchema),
    defaultValues: { completedQty: 0, rejectedQty: 0, warehouseId: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: CompleteProductionFormData) =>
      operationsApi.completeProduction(productionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to complete production. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Completed Quantity *"
          type="number"
          min={0}
          {...register('completedQty')}
          error={errors.completedQty?.message}
        />
        <Input label="Rejected Quantity" type="number" min={0} {...register('rejectedQty')} />
        <Select
          label="Warehouse *"
          options={warehouseOptions}
          {...register('warehouseId')}
          error={errors.warehouseId?.message}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Complete Production</Button>
      </div>
    </form>
  );
}
