import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';

const rfqSchema = z.object({
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  supplierIds: z.array(z.string()).min(1, 'Select at least one supplier'),
});

type RfqFormData = z.infer<typeof rfqSchema>;

interface RfqFormProps {
  requisitionId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function RfqForm({ requisitionId, onSuccess, onCancel }: RfqFormProps) {
  const queryClient = useQueryClient();

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as { id: string; code: string; name: string }[]),
  });

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<RfqFormData>({
    resolver: zodResolver(rfqSchema),
    defaultValues: { supplierIds: [], notes: '' },
  });

  const selectedIds = watch('supplierIds') || [];

  const toggleSupplier = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
    setValue('supplierIds', next, { shouldValidate: true });
  };

  const mutation = useMutation({
    mutationFn: (data: RfqFormData) => inventoryApi.createRfq(requisitionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">Failed to create RFQ.</div>
      )}

      <Input label="Due Date" type="date" {...register('dueDate')} />
      <Input label="Notes" {...register('notes')} />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Invite Suppliers *</label>
        {errors.supplierIds && (
          <p className="text-sm text-red-600 mb-2">{errors.supplierIds.message}</p>
        )}
        <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
          {(suppliersData || []).map((s) => (
            <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(s.id)}
                onChange={() => toggleSupplier(s.id)}
              />
              <span className="text-sm">{s.code} — {s.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create RFQ</Button>
      </div>
    </form>
  );
}
