import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { maintenanceApi } from '../../services/api';
import { Button, Input } from '../ui';

const machineSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  type: z.string().min(1, 'Type is required'),
  capacity: z.string().optional(),
  location: z.string().optional(),
});

type MachineFormData = z.infer<typeof machineSchema>;

interface MachineFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function MachineForm({ onSuccess, onCancel }: MachineFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors } } = useForm<MachineFormData>({
    resolver: zodResolver(machineSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: MachineFormData) => maintenanceApi.createMachine(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-machines'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">Failed to add machine. Code may already exist.</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Code *" {...register('code')} error={errors.code?.message} />
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Input label="Type *" placeholder="e.g. Press, Cutter" {...register('type')} error={errors.type?.message} />
        <Input label="Capacity" {...register('capacity')} />
        <Input label="Location" {...register('location')} />
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Add Machine</Button>
      </div>
    </form>
  );
}
