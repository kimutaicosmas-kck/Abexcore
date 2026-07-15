import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { qualityApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { QualityInspection } from '../../types';

const updateSchema = z.object({
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']),
  result: z.string().optional(),
  defectsFound: z.coerce.number().int().min(0).optional(),
  correctiveAction: z.string().optional(),
});

type UpdateFormData = z.infer<typeof updateSchema>;

const statusOptions = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CONDITIONAL', label: 'Conditional' },
];

interface QualityUpdatePanelProps {
  inspection: QualityInspection;
  onSuccess: () => void;
  onCancel: () => void;
}

export function QualityUpdatePanel({ inspection, onSuccess, onCancel }: QualityUpdatePanelProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      status: inspection.status as UpdateFormData['status'],
      result: inspection.result || '',
      defectsFound: inspection.defectsFound,
      correctiveAction: inspection.correctiveAction || '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: UpdateFormData) => qualityApi.update(inspection.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      queryClient.invalidateQueries({ queryKey: ['quality-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">Failed to update inspection.</div>
      )}
      <Select label="Status *" options={statusOptions} {...register('status')} error={errors.status?.message} />
      <Input label="Result" {...register('result')} />
      <Input label="Defects Found" type="number" min={0} {...register('defectsFound')} />
      <Input label="Corrective Action" {...register('correctiveAction')} />
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Save Changes</Button>
      </div>
    </form>
  );
}
