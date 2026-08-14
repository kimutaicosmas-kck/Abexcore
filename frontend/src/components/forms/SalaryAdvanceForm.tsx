import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../../services/api';
import { Alert, Button, Input, Select, Textarea, formatCurrency } from '../ui';
import { Employee } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';

const advanceSchema = z
  .object({
    entryMode: z.enum(['ISSUE', 'RECORD_EXISTING']),
    employeeId: z.string().min(1, 'Employee is required'),
    amount: z.coerce.number().positive('Amount must be greater than zero'),
    monthlyDeduction: z.coerce.number().positive('Monthly deduction is required'),
    deductionStartDate: z.string().min(1, 'Deduction start date is required'),
    disbursedAt: z.string().optional(),
    alreadyRepaid: z.coerce.number().min(0).optional(),
    reason: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
    approveNow: z.boolean().optional(),
    disburseNow: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.entryMode === 'RECORD_EXISTING' && !d.disbursedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date given is required', path: ['disbursedAt'] });
    }
    const repaid = Number(d.alreadyRepaid || 0);
    if (repaid > d.amount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Already repaid cannot exceed the original amount',
        path: ['alreadyRepaid'],
      });
    }
    const remaining = d.entryMode === 'RECORD_EXISTING' ? d.amount - repaid : d.amount;
    if (d.monthlyDeduction > remaining && remaining > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          d.entryMode === 'RECORD_EXISTING'
            ? 'Monthly deduction cannot exceed the remaining balance'
            : 'Monthly deduction cannot exceed the advance amount',
        path: ['monthlyDeduction'],
      });
    }
  });

type AdvanceFormData = z.infer<typeof advanceSchema>;

interface SalaryAdvanceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  defaultEmployeeId?: string;
  defaultMode?: 'ISSUE' | 'RECORD_EXISTING';
}

export function SalaryAdvanceForm({
  onSuccess,
  onCancel,
  defaultEmployeeId,
  defaultMode = 'ISSUE',
}: SalaryAdvanceFormProps) {
  const queryClient = useQueryClient();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nextMonth = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const { data: employeesData } = useQuery({
    queryKey: ['employees-active-advances'],
    queryFn: () => hrApi.employees({ limit: 100, isActive: true }).then((r) => r.data.data as Employee[]),
  });

  const employeeOptions = [
    { value: '', label: 'Select employee...' },
    ...(employeesData || []).map((e) => ({
      value: e.id,
      label: `${e.employeeNo} — ${e.firstName} ${e.lastName} (${formatCurrency(Number(e.salary))})`,
    })),
  ];

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<AdvanceFormData>({
    resolver: zodResolver(advanceSchema),
    defaultValues: {
      entryMode: defaultMode,
      employeeId: defaultEmployeeId || '',
      amount: undefined,
      monthlyDeduction: undefined,
      deductionStartDate: nextMonth,
      disbursedAt: today,
      alreadyRepaid: 0,
      reason: '',
      notes: '',
      approveNow: true,
      disburseNow: true,
    },
  });

  const entryMode = watch('entryMode');
  const amount = Number(watch('amount') || 0);
  const monthly = Number(watch('monthlyDeduction') || 0);
  const alreadyRepaid = Number(watch('alreadyRepaid') || 0);
  const employeeId = watch('employeeId');
  const disburseNow = watch('disburseNow');
  const selected = employeesData?.find((e) => e.id === employeeId);
  const remaining = Math.max(0, amount - (entryMode === 'RECORD_EXISTING' ? alreadyRepaid : 0));
  const installments = remaining > 0 && monthly > 0 ? Math.ceil(remaining / monthly) : 0;
  const salaryCap = selected ? Number(selected.salary) * 0.5 : 0;

  useEffect(() => {
    if (entryMode === 'RECORD_EXISTING') {
      setValue('approveNow', true);
      setValue('disburseNow', false);
      setValue('disbursedAt', today);
    } else {
      setValue('disburseNow', true);
      setValue('approveNow', true);
    }
  }, [entryMode, setValue, today]);

  const mutation = useMutation({
    mutationFn: (data: AdvanceFormData) => {
      const payload =
        data.entryMode === 'RECORD_EXISTING'
          ? {
              entryMode: 'RECORD_EXISTING' as const,
              employeeId: data.employeeId,
              amount: data.amount,
              monthlyDeduction: data.monthlyDeduction,
              deductionStartDate: data.deductionStartDate,
              disbursedAt: data.disbursedAt,
              alreadyRepaid: Number(data.alreadyRepaid || 0),
              remainingBalance: Math.max(0, data.amount - Number(data.alreadyRepaid || 0)),
              reason: data.reason || undefined,
              notes: data.notes || undefined,
            }
          : {
              entryMode: 'ISSUE' as const,
              employeeId: data.employeeId,
              amount: data.amount,
              monthlyDeduction: data.monthlyDeduction,
              deductionStartDate: data.deductionStartDate,
              reason: data.reason || undefined,
              notes: data.notes || undefined,
              approveNow: data.approveNow || data.disburseNow,
              disburseNow: data.disburseNow,
            };
      return hrApi.createAdvance(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
      onSuccess();
    },
  });

  const isRecord = entryMode === 'RECORD_EXISTING';

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            !isRecord ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setValue('entryMode', 'ISSUE')}
        >
          Issue new advance
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            isRecord ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
          onClick={() => setValue('entryMode', 'RECORD_EXISTING')}
        >
          Record existing advance
        </button>
      </div>

      <Select
        label="Employee *"
        options={employeeOptions}
        {...register('employeeId')}
        error={errors.employeeId?.message}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label={isRecord ? 'Original advance amount (KES) *' : 'Advance amount (KES) *'}
          type="number"
          step="0.01"
          min={1}
          {...register('amount')}
          error={errors.amount?.message}
        />
        <Input
          label="Monthly deduction (KES) *"
          type="number"
          step="0.01"
          min={1}
          {...register('monthlyDeduction')}
          error={errors.monthlyDeduction?.message}
        />

        {isRecord && (
          <>
            <Input
              label="Date given *"
              type="date"
              {...register('disbursedAt')}
              error={errors.disbursedAt?.message}
            />
            <Input
              label="Already repaid (KES)"
              type="number"
              step="0.01"
              min={0}
              {...register('alreadyRepaid')}
              error={errors.alreadyRepaid?.message}
            />
          </>
        )}

        <Input
          label="Deductions start *"
          type="date"
          {...register('deductionStartDate')}
          error={errors.deductionStartDate?.message}
        />

        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          {isRecord ? (
            <>
              <p className="text-slate-500">Remaining balance</p>
              <p className="text-lg font-semibold text-emerald-700">{formatCurrency(remaining)}</p>
              <p className="mt-1 text-xs text-slate-500">{installments || '—'} installment(s) left</p>
            </>
          ) : (
            <>
              <p className="text-slate-500">Estimated installments</p>
              <p className="text-lg font-semibold text-slate-900">{installments || '—'}</p>
            </>
          )}
          {selected && salaryCap > 0 && monthly > salaryCap && (
            <p className="mt-1 text-xs text-amber-700">
              Warning: above 50% of basic salary ({formatCurrency(salaryCap)}).
            </p>
          )}
        </div>
      </div>

      <Textarea label="Reason" rows={2} {...register('reason')} placeholder="e.g. Emergency medical support" />
      <Textarea label="Internal notes" rows={2} {...register('notes')} />

      {!isRecord && (
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-teal-50/40 p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              checked={!!watch('approveNow') || !!disburseNow}
              onChange={(e) => setValue('approveNow', e.target.checked)}
            />
            <span className="font-medium text-slate-900">Approve immediately</span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 rounded border-slate-300"
              {...register('disburseNow')}
            />
            <span className="font-medium text-slate-900">Disburse now (post to ledger)</span>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isRecord ? 'Record Advance' : 'Issue Advance'}
        </Button>
      </div>
    </form>
  );
}
