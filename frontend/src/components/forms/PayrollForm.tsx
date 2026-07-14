import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Employee } from '../../types';

const payrollSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  periodStart: z.string().min(1, 'Period start is required'),
  periodEnd: z.string().min(1, 'Period end is required'),
  basicSalary: z.coerce.number().min(0, 'Basic salary is required'),
  allowances: z.coerce.number().min(0).optional(),
  deductions: z.coerce.number().min(0).optional(),
});

type PayrollFormData = z.infer<typeof payrollSchema>;

interface PayrollFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function PayrollForm({ onSuccess, onCancel }: PayrollFormProps) {
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

  const { register, handleSubmit, watch, formState: { errors } } = useForm<PayrollFormData>({
    resolver: zodResolver(payrollSchema),
    defaultValues: { employeeId: '', allowances: 0, deductions: 0 },
  });

  const basicSalary = watch('basicSalary') || 0;
  const allowances = watch('allowances') || 0;
  const deductions = watch('deductions') || 0;
  const netPay = Number(basicSalary) + Number(allowances) - Number(deductions);

  const mutation = useMutation({
    mutationFn: (data: PayrollFormData) => hrApi.createPayroll(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create payroll record. Please try again.
        </div>
      )}

      <Select
        label="Employee *"
        options={employeeOptions}
        {...register('employeeId')}
        error={errors.employeeId?.message}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Period Start *" type="date" {...register('periodStart')} error={errors.periodStart?.message} />
        <Input label="Period End *" type="date" {...register('periodEnd')} error={errors.periodEnd?.message} />
        <Input label="Basic Salary (KES) *" type="number" step="0.01" {...register('basicSalary')} error={errors.basicSalary?.message} />
        <Input label="Allowances (KES)" type="number" step="0.01" {...register('allowances')} />
        <Input label="Deductions (KES)" type="number" step="0.01" {...register('deductions')} />
      </div>

      <div className="p-3 rounded-lg bg-gray-50 text-sm">
        <span className="text-gray-600">Net Pay: </span>
        <span className="font-semibold text-primary-600">
          KES {netPay.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Payroll</Button>
      </div>
    </form>
  );
}
