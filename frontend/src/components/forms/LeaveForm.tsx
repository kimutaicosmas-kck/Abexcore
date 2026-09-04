import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Employee } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const leaveSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  type: z.string().min(1, 'Leave type is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  reason: z.string().optional(),
});

type LeaveFormData = z.infer<typeof leaveSchema>;

const leaveDefaultValues: LeaveFormData = {
  employeeId: '',
  type: '',
  startDate: '',
  endDate: '',
  reason: '',
};

const leaveTypeOptions = [
  { value: '', label: 'Select type...' },
  { value: 'ANNUAL', label: 'Annual Leave' },
  { value: 'SICK', label: 'Sick Leave' },
  { value: 'MATERNITY', label: 'Maternity Leave' },
  { value: 'PATERNITY', label: 'Paternity Leave' },
  { value: 'UNPAID', label: 'Unpaid Leave' },
  { value: 'COMPASSIONATE', label: 'Compassionate Leave' },
];

interface LeaveFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function LeaveForm({ onSuccess, onCancel }: LeaveFormProps) {
  const queryClient = useQueryClient();

  const { data: employeesData } = useQuery({
    queryKey: ['employees'],
    queryFn: () => hrApi.employees({ limit: 100 }).then((r) => r.data.data as Employee[]),
  });

  const employeeOptions = [
    { value: '', label: 'Select employee...' },
    ...(employeesData || []).map((e) => ({
      value: e.id,
      label: `${e.employeeNo} - ${e.firstName} ${e.lastName}`,
    })),
  ];

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<LeaveFormData>({
    resolver: zodResolver(leaveSchema),
    defaultValues: leaveDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.leave,
    watch,
    getValues,
    reset,
    defaultValues: leaveDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.employeeId) ||
      Boolean(data.type) ||
      Boolean(data.startDate) ||
      Boolean(data.endDate) ||
      Boolean(data.reason?.trim()),
  });

  const mutation = useMutation({
    mutationFn: (data: LeaveFormData) =>
      hrApi.createLeave({ ...data, reason: data.reason || undefined }),
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to submit leave request. Please try again.
        </div>
      )}

      <Select
        label="Employee *"
        options={employeeOptions}
        {...register('employeeId')}
        error={errors.employeeId?.message}
      />
      <Select
        label="Leave Type *"
        options={leaveTypeOptions}
        {...register('type')}
        error={errors.type?.message}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Start Date *" type="date" {...register('startDate')} error={errors.startDate?.message} />
        <Input label="End Date *" type="date" {...register('endDate')} error={errors.endDate?.message} />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Reason</label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          rows={3}
          {...register('reason')}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Submit Leave Request</Button>
      </div>
    </form>
  );
}
