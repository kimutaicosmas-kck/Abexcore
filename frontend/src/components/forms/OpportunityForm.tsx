import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, customersApi } from '../../services/api';
import { Button, Input, Select, Textarea } from '../ui';
import { Customer, Opportunity } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const opportunitySchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  title: z.string().min(1, 'Title is required'),
  value: z.coerce.number().min(0, 'Value must be positive'),
  stage: z.string().optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

type OpportunityFormData = z.infer<typeof opportunitySchema>;

const opportunityDefaultValues: OpportunityFormData = {
  customerId: '',
  title: '',
  value: 0,
  stage: 'PROSPECTING',
  probability: 25,
  notes: '',
};

const stageOptions = [
  { value: 'PROSPECTING', label: 'Prospecting' },
  { value: 'QUALIFICATION', label: 'Qualification' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'CLOSED_WON', label: 'Closed Won' },
  { value: 'CLOSED_LOST', label: 'Closed Lost' },
];

interface OpportunityFormProps {
  opportunity?: Opportunity | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function OpportunityForm({ opportunity, onSuccess, onCancel }: OpportunityFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!opportunity;

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const customerOptions = [
    { value: '', label: 'Select customer...' },
    ...(customersData || []).map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })),
  ];

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<OpportunityFormData>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: opportunity
      ? {
          customerId: opportunity.customerId,
          title: opportunity.title,
          value: Number(opportunity.value),
          stage: (opportunity.stage || 'PROSPECTING').toUpperCase(),
          probability: opportunity.probability,
          expectedCloseDate: opportunity.expectedCloseDate?.slice(0, 10) || '',
          notes: opportunity.notes || '',
        }
      : opportunityDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.opportunity,
    watch,
    getValues,
    reset,
    defaultValues: opportunityDefaultValues,
    enabled: !isEdit,
    isMeaningful: (data) =>
      Boolean(data.customerId) ||
      Boolean(data.title?.trim()) ||
      (data.value != null && data.value > 0) ||
      Boolean(data.expectedCloseDate) ||
      Boolean(data.notes?.trim()),
  });

  const mutation = useMutation({
    mutationFn: (data: OpportunityFormData) => {
      const payload = {
        ...data,
        stage: data.stage || 'PROSPECTING',
        expectedCloseDate: data.expectedCloseDate || undefined,
        notes: data.notes || undefined,
      };
      return isEdit
        ? crmApi.updateOpportunity(opportunity!.id, payload)
        : crmApi.createOpportunity(payload);
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save opportunity. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Customer *"
          options={customerOptions}
          {...register('customerId')}
          error={errors.customerId?.message}
          disabled={isEdit}
        />
        <Input label="Title *" {...register('title')} error={errors.title?.message} />
        <Input label="Value (KES) *" type="number" step="0.01" {...register('value')} error={errors.value?.message} />
        <Select label="Stage" options={stageOptions} {...register('stage')} />
        <Input label="Probability (%)" type="number" min={0} max={100} {...register('probability')} />
        <Input label="Expected Close Date" type="date" {...register('expectedCloseDate')} />
      </div>
      <Textarea label="Notes" rows={3} {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Opportunity' : 'Create Opportunity'}
        </Button>
      </div>
    </form>
  );
}
