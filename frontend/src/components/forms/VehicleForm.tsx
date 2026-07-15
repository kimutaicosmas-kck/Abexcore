import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { deliveryApi } from '../../services/api';
import { Button, Input } from '../ui';

const vehicleSchema = z.object({
  registration: z.string().min(1, 'Registration is required'),
  make: z.string().optional(),
  model: z.string().optional(),
  capacity: z.string().optional(),
});

type VehicleFormData = z.infer<typeof vehicleSchema>;

interface VehicleFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function VehicleForm({ onSuccess, onCancel }: VehicleFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors } } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
  });

  const mutation = useMutation({
    mutationFn: (data: VehicleFormData) => deliveryApi.createVehicle(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to add vehicle. Registration may already exist.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Registration *" {...register('registration')} error={errors.registration?.message} />
        <Input label="Make" {...register('make')} />
        <Input label="Model" {...register('model')} />
        <Input label="Capacity" placeholder="e.g. 3 tons" {...register('capacity')} />
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Add Vehicle</Button>
      </div>
    </form>
  );
}
