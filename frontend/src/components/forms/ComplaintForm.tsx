import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, customersApi } from '../../services/api';
import { Button, Input, Select, Textarea } from '../ui';
import { Customer } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const complaintSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  subject: z.string().min(1, 'Subject is required'),
  description: z.string().min(1, 'Description is required'),
  priority: z.string().optional(),
});

type ComplaintFormData = z.infer<typeof complaintSchema>;

const complaintDefaultValues: ComplaintFormData = {
  customerId: '',
  subject: '',
  description: '',
  priority: 'medium',
};

const priorityOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

interface ComplaintFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function ComplaintForm({ onSuccess, onCancel }: ComplaintFormProps) {
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const customerOptions = [
    { value: '', label: 'Select customer...' },
    ...(customersData || []).map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })),
  ];

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<ComplaintFormData>({
    resolver: zodResolver(complaintSchema),
    defaultValues: complaintDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft, discardDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.complaint,
    watch,
    getValues,
    reset,
    defaultValues: complaintDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.customerId) ||
      Boolean(data.subject?.trim()) ||
      Boolean(data.description?.trim()),
  });

  const mutation = useMutation({
    mutationFn: (data: ComplaintFormData) => crmApi.createComplaint(data),
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} onDiscard={discardDraft} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create complaint. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Customer *"
          options={customerOptions}
          {...register('customerId')}
          error={errors.customerId?.message}
        />
        <Select label="Priority" options={priorityOptions} {...register('priority')} />
      </div>
      <Input label="Subject *" {...register('subject')} error={errors.subject?.message} />
      <Textarea label="Description *" rows={4} {...register('description')} error={errors.description?.message} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Complaint</Button>
      </div>
    </form>
  );
}
