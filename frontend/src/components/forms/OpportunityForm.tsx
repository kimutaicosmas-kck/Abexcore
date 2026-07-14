import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, customersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Customer } from '../../types';

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

const stageOptions = [
  { value: 'PROSPECTING', label: 'Prospecting' },
  { value: 'QUALIFICATION', label: 'Qualification' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'NEGOTIATION', label: 'Negotiation' },
  { value: 'CLOSED_WON', label: 'Closed Won' },
  { value: 'CLOSED_LOST', label: 'Closed Lost' },
];

interface OpportunityFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function OpportunityForm({ onSuccess, onCancel }: OpportunityFormProps) {
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const customerOptions = [
    { value: '', label: 'Select customer...' },
    ...(customersData || []).map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<OpportunityFormData>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: { customerId: '', stage: 'PROSPECTING', probability: 25, notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: OpportunityFormData) =>
      crmApi.createOpportunity({
        ...data,
        stage: data.stage || 'PROSPECTING',
        expectedCloseDate: data.expectedCloseDate || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create opportunity. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Customer *"
          options={customerOptions}
          {...register('customerId')}
          error={errors.customerId?.message}
        />
        <Input label="Title *" {...register('title')} error={errors.title?.message} />
        <Input label="Value (KES) *" type="number" step="0.01" {...register('value')} error={errors.value?.message} />
        <Select label="Stage" options={stageOptions} {...register('stage')} />
        <Input label="Probability (%)" type="number" min={0} max={100} {...register('probability')} />
        <Input label="Expected Close Date" type="date" {...register('expectedCloseDate')} />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Notes</label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          rows={3}
          {...register('notes')}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Opportunity</Button>
      </div>
    </form>
  );
}
