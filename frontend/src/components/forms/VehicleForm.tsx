import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { deliveryApi } from '../../services/api';
import { Alert, Button, Input, Select } from '../ui';
import { VEHICLE_TYPE_FORM_OPTIONS } from '../../types';

const vehicleSchema = z.object({
  registration: z.string().min(1, 'Registration is required'),
  type: z.enum(['MOTORCYCLE', 'TRUCK', 'LORRY']),
  make: z.string().optional(),
  model: z.string().optional(),
  capacity: z.string().optional(),
});

type VehicleFormData = z.infer<typeof vehicleSchema>;

const CAPACITY_HINTS: Record<string, string> = {
  MOTORCYCLE: 'e.g. 50 kg',
  TRUCK: 'e.g. 3 tons',
  LORRY: 'e.g. 10–26 tons',
};

interface VehicleFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function VehicleForm({ onSuccess, onCancel }: VehicleFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, watch, formState: { errors } } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: { type: 'TRUCK' },
  });

  const vehicleType = watch('type');

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
        <Alert variant="error">Failed to add vehicle. Registration may already exist.</Alert>
      )}
      <Select
        label="Fleet type *"
        options={VEHICLE_TYPE_FORM_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        {...register('type')}
        error={errors.type?.message}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Registration *" {...register('registration')} error={errors.registration?.message} />
        <Input label="Make" {...register('make')} />
        <Input label="Model" {...register('model')} />
        <Input
          label="Capacity"
          placeholder={CAPACITY_HINTS[vehicleType] || 'Load capacity'}
          {...register('capacity')}
        />
      </div>
      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Add Vehicle</Button>
      </div>
    </form>
  );
}
