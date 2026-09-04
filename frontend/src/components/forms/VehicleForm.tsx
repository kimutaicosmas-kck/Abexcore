import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { deliveryApi } from '../../services/api';
import { Alert, Button, Input, Select } from '../ui';
import { VEHICLE_TYPE_FORM_OPTIONS } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const vehicleSchema = z.object({
  registration: z.string().min(1, 'Registration is required'),
  type: z.enum(['MOTORCYCLE', 'TRUCK', 'LORRY']),
  make: z.string().optional(),
  model: z.string().optional(),
  capacity: z.string().optional(),
  isHired: z.boolean().optional(),
});

type VehicleFormData = z.infer<typeof vehicleSchema>;

const vehicleDefaultValues: VehicleFormData = {
  registration: '',
  type: 'TRUCK',
  isHired: false,
};

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

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<VehicleFormData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: vehicleDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.vehicle,
    watch,
    getValues,
    reset,
    defaultValues: vehicleDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.registration?.trim()) ||
      Boolean(data.make?.trim()) ||
      Boolean(data.model?.trim()) ||
      Boolean(data.capacity?.trim()) ||
      data.type !== 'TRUCK' ||
      Boolean(data.isHired),
  });

  const vehicleType = watch('type');
  const isHired = watch('isHired');

  const mutation = useMutation({
    mutationFn: (data: VehicleFormData) =>
      deliveryApi.createVehicle({
        ...data,
        make: data.make?.trim() || undefined,
        model: data.model?.trim() || undefined,
        capacity: data.capacity?.trim() || undefined,
      }),
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}
      <Select
        label="Fleet type *"
        options={VEHICLE_TYPE_FORM_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        {...register('type')}
        error={errors.type?.message}
      />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
          {...register('isHired')}
        />
        <span>Hired / external vehicle</span>
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Registration *"
          placeholder={isHired ? 'e.g. KCA 456B' : undefined}
          {...register('registration')}
          error={errors.registration?.message}
        />
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
