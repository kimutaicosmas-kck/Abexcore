import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { Alert, Button, Input, Select, formatCurrency } from '../ui';
import { Employee } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const payrollSchema = z.object({
  employeeId: z.string().min(1, 'Employee is required'),
  periodStart: z.string().min(1, 'Period start is required'),
  periodEnd: z.string().min(1, 'Period end is required'),
  basicSalary: z.coerce.number().min(0, 'Basic salary is required'),
  allowances: z.coerce.number().min(0).optional(),
});

type PayrollFormData = z.infer<typeof payrollSchema>;

const payrollDefaultValues: PayrollFormData = {
  employeeId: '',
  periodStart: '',
  periodEnd: '',
  basicSalary: 0,
  allowances: 0,
};

interface PayrollBreakdown {
  grossPay: number;
  paye: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  advanceDeduction: number;
  totalDeductions: number;
  netPay: number;
  advanceAllocations?: { advanceNo: string; amount: number }[];
}

interface PayrollFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function PayrollForm({ onSuccess, onCancel }: PayrollFormProps) {
  const queryClient = useQueryClient();

  const { data: employeesData } = useQuery({
    queryKey: ['employees'],
    queryFn: () => hrApi.employees({ limit: 100, isActive: true }).then((r) => r.data.data as Employee[]),
  });

  const employeeOptions = [
    { value: '', label: 'Select employee...' },
    ...(employeesData || []).map((e) => ({
      value: e.id,
      label: `${e.employeeNo} - ${e.firstName} ${e.lastName}`,
    })),
  ];

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<PayrollFormData>({
    resolver: zodResolver(payrollSchema),
    defaultValues: payrollDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.payroll,
    watch,
    getValues,
    reset,
    defaultValues: payrollDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.employeeId) ||
      Boolean(data.periodStart) ||
      Boolean(data.periodEnd) ||
      (data.basicSalary != null && data.basicSalary > 0) ||
      (data.allowances != null && data.allowances > 0),
  });

  const employeeId = watch('employeeId');
  const basicSalary = watch('basicSalary');
  const allowances = watch('allowances') || 0;
  const periodEnd = watch('periodEnd');

  useEffect(() => {
    const emp = employeesData?.find((e) => e.id === employeeId);
    if (emp) setValue('basicSalary', Number(emp.salary) || 0);
  }, [employeeId, employeesData, setValue]);

  const { data: preview } = useQuery({
    queryKey: ['payroll-preview', employeeId, basicSalary, allowances, periodEnd],
    queryFn: () =>
      hrApi
        .calculatePayroll({
          employeeId: employeeId || undefined,
          basicSalary: Number(basicSalary || 0),
          allowances: Number(allowances || 0),
          periodEnd: periodEnd || undefined,
        })
        .then((r) => r.data.data as PayrollBreakdown),
    enabled: Number(basicSalary || 0) >= 0 && !!employeeId,
  });

  const mutation = useMutation({
    mutationFn: (data: PayrollFormData) => hrApi.createPayroll(data),
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advance-stats'] });
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
      </div>

      {preview && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm space-y-2">
          <div className="flex justify-between"><span className="text-slate-500">Gross</span><span>{formatCurrency(preview.grossPay)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">PAYE</span><span>{formatCurrency(preview.paye)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">NSSF</span><span>{formatCurrency(preview.nssf)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">SHIF</span><span>{formatCurrency(preview.shif)}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Housing levy</span><span>{formatCurrency(preview.housingLevy)}</span></div>
          <div className="flex justify-between text-amber-800">
            <span>Salary advance recovery</span>
            <span className="font-medium">{formatCurrency(preview.advanceDeduction || 0)}</span>
          </div>
          {(preview.advanceAllocations || []).length > 0 && (
            <ul className="text-xs text-amber-700/90 pl-4 list-disc">
              {preview.advanceAllocations!.map((a) => (
                <li key={a.advanceNo}>{a.advanceNo}: {formatCurrency(a.amount)}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base">
            <span className="font-medium text-slate-700">Net pay</span>
            <span className="font-semibold text-primary-700">{formatCurrency(preview.netPay)}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Payroll</Button>
      </div>
    </form>
  );
}
