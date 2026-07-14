import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Employee } from '../../types';

const attendanceSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  date: z.string().min(1, 'Date is required'),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: z.enum(['present', 'absent', 'late', 'half_day', 'leave']),
  notes: z.string().optional(),
});

type AttendanceFormData = z.infer<typeof attendanceSchema>;

const statusOptions = [
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'half_day', label: 'Half Day' },
  { value: 'leave', label: 'On Leave' },
];

interface AttendanceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function AttendanceForm({ onSuccess, onCancel }: AttendanceFormProps) {
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

  const today = new Date().toISOString().slice(0, 10);

  const { register, handleSubmit, formState: { errors } } = useForm<AttendanceFormData>({
    resolver: zodResolver(attendanceSchema),
    defaultValues: { employeeId: '', date: today, status: 'present', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: AttendanceFormData) => {
      const payload = {
        ...data,
        checkIn: data.checkIn ? `${data.date}T${data.checkIn}:00` : undefined,
        checkOut: data.checkOut ? `${data.date}T${data.checkOut}:00` : undefined,
        notes: data.notes || undefined,
      };
      return hrApi.recordAttendance(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to record attendance. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Employee *"
          options={employeeOptions}
          {...register('employeeId')}
          error={errors.employeeId?.message}
        />
        <Input label="Date *" type="date" {...register('date')} error={errors.date?.message} />
        <Input label="Check In" type="time" {...register('checkIn')} />
        <Input label="Check Out" type="time" {...register('checkOut')} />
        <Select label="Status *" options={statusOptions} {...register('status')} />
      </div>
      <Input label="Notes" {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Record Attendance</Button>
      </div>
    </form>
  );
}
