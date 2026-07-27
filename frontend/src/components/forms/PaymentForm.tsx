import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { Button, Input, Select, Alert } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Invoice } from '../../types';
import { formatCurrency } from '../ui';

const paymentSchema = z
  .object({
    invoiceId: z.string().min(1, 'Invoice is required'),
    amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
    reference: z.string().optional(),
  })
  .refine((data) => data.method !== 'MPESA' || (data.reference && data.reference.length >= 6), {
    message: 'M-Pesa requires a transaction code in Reference',
    path: ['reference'],
  });

type PaymentFormData = z.infer<typeof paymentSchema>;

const paymentMethodOptions = [
  { value: '', label: 'Select method...' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'CARD', label: 'Card' },
  { value: 'CREDIT', label: 'Credit' },
];

interface PaymentFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  invoiceId?: string;
}

export function PaymentForm({ onSuccess, onCancel, invoiceId: preselectedId }: PaymentFormProps) {
  const queryClient = useQueryClient();

  const { data: invoicesData } = useQuery({
    queryKey: ['invoices-unpaid'],
    queryFn: () =>
      financeApi
        .invoices({ limit: 100, status: undefined })
        .then((r) => r.data.data as Invoice[]),
  });

  const unpaidInvoices = (invoicesData || []).filter(
    (inv) => inv.status !== 'PAID' && Number(inv.totalAmount) > Number(inv.paidAmount)
  );

  const invoiceOptions = [
    { value: '', label: 'Select invoice...' },
    ...unpaidInvoices.map((inv) => {
      const balance = Number(inv.totalAmount) - Number(inv.paidAmount);
      return {
        value: inv.id,
        label: `${inv.invoiceNumber} · Balance ${formatCurrency(balance)}`,
      };
    }),
  ];

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { invoiceId: preselectedId || '', method: undefined, reference: '' },
  });

  useEffect(() => {
    if (preselectedId) setValue('invoiceId', preselectedId);
  }, [preselectedId, setValue]);

  const selectedId = watch('invoiceId');
  const selectedInvoice = unpaidInvoices.find((i) => i.id === selectedId);
  const balance = selectedInvoice
    ? Number(selectedInvoice.totalAmount) - Number(selectedInvoice.paidAmount)
    : 0;

  const method = watch('method');

  const mutation = useMutation({
    mutationFn: (data: PaymentFormData) =>
      financeApi.payments({
        ...data,
        method: data.method || undefined,
        reference: data.reference || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-overview'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}

      <Select
        label="Invoice *"
        options={invoiceOptions}
        {...register('invoiceId')}
        error={errors.invoiceId?.message}
        disabled={!!preselectedId}
      />

      {selectedInvoice && (
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Outstanding balance</span>
            <span className="font-semibold text-slate-900">{formatCurrency(balance)}</span>
          </div>
          <button
            type="button"
            className="text-xs text-primary-600 mt-1 hover:underline"
            onClick={() => setValue('amount', balance)}
          >
            Pay full balance
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Amount (KES) *"
          type="number"
          step="0.01"
          min={0.01}
          {...register('amount')}
          error={errors.amount?.message}
        />
        <Select label="Payment Method" options={paymentMethodOptions} {...register('method')} />
        <Input
          label={method === 'MPESA' ? 'M-Pesa Code *' : 'Reference'}
          placeholder={method === 'MPESA' ? 'e.g. QHK7X2ABCD' : 'Bank ref / cheque no.'}
          {...register('reference')}
          error={errors.reference?.message}
          className="md:col-span-2"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Record Payment</Button>
      </div>
    </form>
  );
}
