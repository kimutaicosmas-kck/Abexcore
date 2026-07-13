import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, customersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Customer } from '../../types';

const complaintSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  subject: z.string().min(1, 'Subject is required'),
  description: z.string().min(1, 'Description is required'),
  priority: z.string().optional(),
});

type ComplaintFormData = z.infer<typeof complaintSchema>;

const priorityOptions = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
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

  const { register, handleSubmit, formState: { errors } } = useForm<ComplaintFormData>({
    resolver: zodResolver(complaintSchema),
    defaultValues: { customerId: '', priority: 'NORMAL' },
  });

  const mutation = useMutation({
    mutationFn: (data: ComplaintFormData) => crmApi.createComplaint(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
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
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Description *</label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          rows={4}
          {...register('description')}
        />
        {errors.description?.message && (
          <p className="text-sm text-red-600">{errors.description.message}</p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Complaint</Button>
      </div>
    </form>
  );
}
