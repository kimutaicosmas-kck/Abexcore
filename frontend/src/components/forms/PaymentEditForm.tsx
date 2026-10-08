import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { Button, Input, Select, Alert, formatCurrency } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Invoice, Payment } from '../../types';

const paymentEditSchema = z
  .object({
    paymentDate: z.string().min(1, 'Payment date is required'),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
    reference: z.string().optional(),
    notes: z.string().optional(),
    adjustmentReason: z.string().min(1, 'Reason for adjustment is required'),
  })
  .refine((data) => data.method !== 'MPESA' || (data.reference && data.reference.length >= 6), {
    message: 'M-Pesa requires a transaction code in Reference',
    path: ['reference'],
  });

type PaymentEditFormData = z.infer<typeof paymentEditSchema>;

type PaymentWithAllocations = Payment & {
  notes?: string | null;
  isReconciled?: boolean;
  statementLine?: { id: string } | null;
  mpesaTransaction?: { id: string } | null;
  allocations?: {
    id: string;
    amount: number;
    invoice?: Invoice & {
      balanceDue?: number;
      creditedAmount?: number;
    };
  }[];
};

const paymentMethodOptions = [
  { value: '', label: 'Select method...' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'CARD', label: 'Card' },
  { value: 'CREDIT', label: 'Credit' },
];

function formatDateInput(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

function maxAllocatable(
  inv: Pick<Invoice, 'totalAmount' | 'paidAmount' | 'balanceDue' | 'creditedAmount'> | undefined,
  currentAmount: number
): number {
  if (!inv) return currentAmount;
  const balanceDue =
    inv.balanceDue != null
      ? Number(inv.balanceDue)
      : Math.max(
          0,
          Number(inv.totalAmount) - Number(inv.paidAmount) - Number(inv.creditedAmount || 0)
        );
  return balanceDue + currentAmount;
}

interface PaymentEditFormProps {
  paymentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function PaymentEditForm({ paymentId, onSuccess, onCancel }: PaymentEditFormProps) {
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, number>>({});

  const { data: payment, isLoading, isError, error } = useQuery({
    queryKey: ['payment-detail', paymentId],
    queryFn: () => financeApi.getPayment(paymentId).then((r) => r.data.data as PaymentWithAllocations),
  });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<PaymentEditFormData>({
    resolver: zodResolver(paymentEditSchema),
    defaultValues: {
      paymentDate: '',
      reference: '',
      notes: '',
      adjustmentReason: '',
    },
  });

  useEffect(() => {
    if (!payment) return;
    reset({
      paymentDate: formatDateInput(payment.paymentDate),
      method: (payment.method as PaymentEditFormData['method']) || undefined,
      reference: payment.reference || '',
      notes: payment.notes || '',
      adjustmentReason: '',
    });
    const next: Record<string, number> = {};
    for (const alloc of payment.allocations || []) {
      if (alloc.invoice?.id) {
        next[alloc.invoice.id] = Number(alloc.amount);
      }
    }
    setAmounts(next);
  }, [payment, reset]);

  const allocationRows = useMemo(
    () => (payment?.allocations || []).filter((a) => a.invoice?.id),
    [payment]
  );

  const totalAllocated = Object.values(amounts).reduce((sum, n) => sum + Number(n || 0), 0);
  const method = watch('method');

  const setAllocAmount = (invoiceId: string, value: string, max: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setAmounts((prev) => ({ ...prev, [invoiceId]: 0 }));
      return;
    }
    setAmounts((prev) => ({ ...prev, [invoiceId]: Math.min(n, max) }));
  };

  const mutation = useMutation({
    mutationFn: (data: PaymentEditFormData) => {
      const allocations = Object.entries(amounts)
        .filter(([, amount]) => Number(amount) > 0.009)
        .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) }));
      if (allocations.length === 0) {
        throw new Error('Enter at least one invoice amount');
      }
      return financeApi.updatePayment(paymentId, {
        paymentDate: data.paymentDate,
        method: data.method || undefined,
        reference: data.reference || undefined,
        notes: data.notes || undefined,
        adjustmentReason: data.adjustmentReason,
        allocations,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['payment-detail', paymentId] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-overview'] });
      queryClient.invalidateQueries({ queryKey: ['customer-balance-summary'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-statement'] });
      onSuccess();
    },
  });

  if (isLoading) {
    return <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">Loading payment…</div>;
  }

  if (isError || !payment) {
    return <Alert variant="error">{getApiErrorMessage(error)}</Alert>;
  }

  const blockedReason = payment.isReconciled
    ? 'This payment is bank-reconciled. Unreconcile it before editing.'
    : payment.statementLine
      ? 'This payment is linked to a bank statement line. Unmatch it before editing.'
      : payment.mpesaTransaction
        ? 'This payment is linked to an M-Pesa transaction and cannot be edited here.'
        : null;

  const amountError =
    totalAllocated <= 0.009 ? 'Enter amounts for the selected invoices' : null;

  return (
    <form
      onSubmit={handleSubmit((data) => {
        if (blockedReason || amountError) return;
        mutation.mutate(data);
      })}
      className="space-y-4"
    >
      {blockedReason && <Alert variant="warning">{blockedReason}</Alert>}
      {mutation.isError && <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>}

      <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm">
        <p className="font-medium text-slate-900">{payment.paymentNumber}</p>
        <p className="text-slate-500 mt-0.5">
          Currently recorded {formatCurrency(Number(payment.amount))}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Payment date *"
          type="date"
          {...register('paymentDate')}
          error={errors.paymentDate?.message}
        />
        <Select label="Payment Method" options={paymentMethodOptions} {...register('method')} />
        <Input
          label={method === 'MPESA' ? 'M-Pesa Code *' : 'Reference'}
          placeholder={method === 'MPESA' ? 'e.g. QHK7X2ABCD' : 'Bank ref / cheque no.'}
          {...register('reference')}
          error={errors.reference?.message}
          className="sm:col-span-2"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Invoice allocations *</label>
        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
          {allocationRows.map((alloc) => {
            const inv = alloc.invoice!;
            const current = Number(alloc.amount);
            const max = maxAllocatable(inv as Invoice, current);
            return (
              <div
                key={alloc.id}
                className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{inv.invoiceNumber}</p>
                  <p className="text-xs text-slate-500">
                    {inv.customer?.name || inv.supplier?.name || 'Party'} · max{' '}
                    {formatCurrency(max)}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:w-44 shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    max={max}
                    inputMode="decimal"
                    disabled={Boolean(blockedReason)}
                    value={amounts[inv.id] ?? ''}
                    onChange={(e) => setAllocAmount(inv.id, e.target.value, max)}
                    className="w-full rounded-lg border border-primary-100 px-2 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                    aria-label={`Amount for ${inv.invoiceNumber}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {amountError && <p className="text-sm text-red-600">{amountError}</p>}
      </div>

      <Input label="Notes" {...register('notes')} disabled={Boolean(blockedReason)} />

      <Input
        label="Reason for adjustment *"
        placeholder="e.g. Meant partial payment, not full invoice"
        {...register('adjustmentReason')}
        error={errors.adjustmentReason?.message}
        disabled={Boolean(blockedReason)}
      />

      <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm flex justify-between gap-3">
        <span className="text-slate-500">New payment total</span>
        <span className="font-semibold text-slate-900 tabular-nums">
          {formatCurrency(totalAllocated)}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={mutation.isPending}
          disabled={Boolean(blockedReason || amountError)}
        >
          Save Payment
        </Button>
      </div>
    </form>
  );
}
