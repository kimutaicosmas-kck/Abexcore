import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maintenanceApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Machine } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const maintenanceTypeOptions = [
  { value: 'PREVENTIVE', label: 'Preventive' },
  { value: 'CORRECTIVE', label: 'Corrective' },
  { value: 'EMERGENCY', label: 'Emergency' },
  { value: 'INSPECTION', label: 'Inspection' },
];

const maintenanceSchema = z.object({
  machineId: z.string().min(1, 'Machine is required'),
  type: z.string().min(1, 'Type is required'),
  description: z.string().min(1, 'Description is required'),
  scheduledDate: z.string().optional(),
  cost: z.coerce.number().min(0).optional(),
});

type MaintenanceFormData = z.infer<typeof maintenanceSchema>;

const maintenanceDefaultValues: MaintenanceFormData = {
  machineId: '',
  type: 'PREVENTIVE',
  description: '',
  cost: 0,
};

interface MaintenanceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function MaintenanceForm({ onSuccess, onCancel }: MaintenanceFormProps) {
  const queryClient = useQueryClient();

  const { data: machinesData } = useQuery({
    queryKey: ['maintenance-machines'],
    queryFn: () => maintenanceApi.machines().then((r) => r.data.data as Machine[]),
  });

  const machineOptions = [
    { value: '', label: 'Select machine...' },
    ...(machinesData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<MaintenanceFormData>({
    resolver: zodResolver(maintenanceSchema),
    defaultValues: maintenanceDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft, discardDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.maintenance,
    watch,
    getValues,
    reset,
    defaultValues: maintenanceDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.machineId) ||
      Boolean(data.description?.trim()) ||
      Boolean(data.scheduledDate) ||
      (data.cost != null && Number(data.cost) > 0),
  });

  const mutation = useMutation({
    mutationFn: (data: MaintenanceFormData) => maintenanceApi.createRequest(data),
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} onDiscard={discardDraft} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create maintenance request. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Machine *"
          options={machineOptions}
          {...register('machineId')}
          error={errors.machineId?.message}
        />
        <Select label="Type *" options={maintenanceTypeOptions} {...register('type')} error={errors.type?.message} />
        <Input label="Scheduled Date" type="date" {...register('scheduledDate')} />
        <Input label="Estimated Cost (KES)" type="number" step="0.01" {...register('cost')} />
      </div>
      <Input label="Description *" {...register('description')} error={errors.description?.message} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Request</Button>
      </div>
    </form>
  );
}
