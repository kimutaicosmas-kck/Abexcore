import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Invoice } from '../../types';

const paymentSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
  reference: z.string().optional(),
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
}

export function PaymentForm({ onSuccess, onCancel }: PaymentFormProps) {
  const queryClient = useQueryClient();

  const { data: invoicesData } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => financeApi.invoices({ limit: 100 }).then((r) => r.data.data as Invoice[]),
  });

  const invoiceOptions = [
    { value: '', label: 'Select invoice...' },
    ...(invoicesData || []).map((inv) => ({
      value: inv.id,
      label: `${inv.invoiceNumber} - KES ${Number(inv.totalAmount).toLocaleString('en-KE')}`,
    })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: { invoiceId: '', method: undefined, reference: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: PaymentFormData) => {
      const payload = {
        ...data,
        method: data.method || undefined,
        reference: data.reference || undefined,
      };
      return financeApi.payments(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to record payment. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Invoice *"
          options={invoiceOptions}
          {...register('invoiceId')}
          error={errors.invoiceId?.message}
        />
        <Input
          label="Amount (KES) *"
          type="number"
          step="0.01"
          min={0.01}
          {...register('amount')}
          error={errors.amount?.message}
        />
        <Select label="Payment Method" options={paymentMethodOptions} {...register('method')} />
        <Input label="Reference" {...register('reference')} />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Record Payment</Button>
      </div>
    </form>
  );
}
