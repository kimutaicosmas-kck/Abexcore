import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financeApi } from '../../services/api';
import { Button, Input, Select, formatCurrency } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Invoice } from '../../types';

const lineSchema = z.object({
  accountId: z.string().min(1, 'Account is required'),
  debit: z.coerce.number().min(0),
  credit: z.coerce.number().min(0),
  description: z.string().optional(),
});

const journalSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  description: z.string().min(1, 'Description is required'),
  reference: z.string().optional(),
  invoiceId: z.string().optional(),
  lines: z.array(lineSchema).min(2, 'At least two lines are required'),
}).refine(
  (data) => {
    const totalDebit = data.lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = data.lines.reduce((s, l) => s + Number(l.credit), 0);
    return Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;
  },
  { message: 'Total debits must equal total credits', path: ['lines'] }
);

type JournalFormData = z.infer<typeof journalSchema>;

interface Account {
  id: string;
  code: string;
  name: string;
}

interface JournalEntryFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function invoiceLabel(inv: Invoice): string {
  const party = inv.customer?.name || inv.supplier?.name || inv.type;
  return `${inv.invoiceNumber} · ${party} · ${formatCurrency(Number(inv.totalAmount))} · ${inv.status}`;
}

export function JournalEntryForm({ onSuccess, onCancel }: JournalEntryFormProps) {
  const queryClient = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.accounts().then((r) => r.data.data as Account[]),
  });

  const { data: invoices } = useQuery({
    queryKey: ['invoices-for-journal'],
    queryFn: () =>
      financeApi.invoices({ limit: 100, sortBy: 'invoiceDate', sortOrder: 'desc' }).then(
        (r) => r.data.data as Invoice[]
      ),
  });

  const accountOptions = [
    { value: '', label: 'Select account...' },
    ...(accounts || []).map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })),
  ];

  const invoiceOptions = [
    { value: '', label: 'No invoice (general entry)' },
    ...(invoices || []).map((inv) => ({ value: inv.id, label: invoiceLabel(inv) })),
  ];

  const today = new Date().toISOString().slice(0, 10);

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<JournalFormData>({
    resolver: zodResolver(journalSchema),
    defaultValues: {
      date: today,
      description: '',
      reference: '',
      invoiceId: '',
      lines: [
        { accountId: '', debit: 0, credit: 0, description: '' },
        { accountId: '', debit: 0, credit: 0, description: '' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });
  const lines = watch('lines');
  const selectedInvoiceId = watch('invoiceId');
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);

  const selectedInvoice = (invoices || []).find((inv) => inv.id === selectedInvoiceId);

  const onInvoiceChange = (invoiceId: string) => {
    setValue('invoiceId', invoiceId);
    if (!invoiceId) return;
    const inv = (invoices || []).find((row) => row.id === invoiceId);
    if (!inv) return;
    const party = inv.customer?.name || inv.supplier?.name || '';
    setValue('reference', inv.invoiceNumber);
    const currentDesc = watch('description')?.trim();
    if (!currentDesc) {
      setValue(
        'description',
        `Journal against ${inv.invoiceNumber}${party ? ` (${party})` : ''}`
      );
    }
  };

  const mutation = useMutation({
    mutationFn: (data: JournalFormData) =>
      financeApi.createJournalEntry({
        date: data.date,
        description: data.description,
        reference: data.reference || undefined,
        invoiceId: data.invoiceId || undefined,
        lines: data.lines.map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description || undefined,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiErrorMessage(mutation.error)}
        </div>
      )}
      {errors.lines?.message && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{errors.lines.message}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Date *" type="date" {...register('date')} error={errors.date?.message} />
        <Select
          label="Invoice (optional)"
          options={invoiceOptions}
          value={selectedInvoiceId || ''}
          onChange={(e) => onInvoiceChange(e.target.value)}
        />
        <Input label="Reference" {...register('reference')} placeholder="Defaults to invoice # if linked" />
        <Input label="Description *" {...register('description')} error={errors.description?.message} />
      </div>

      {selectedInvoice && (
        <p className="text-xs text-slate-600 rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2">
          Linked to <strong>{selectedInvoice.invoiceNumber}</strong>
          {selectedInvoice.customer?.name || selectedInvoice.supplier?.name
            ? ` · ${selectedInvoice.customer?.name || selectedInvoice.supplier?.name}`
            : ''}
          {' · '}
          {formatCurrency(Number(selectedInvoice.totalAmount))} ({selectedInvoice.status})
        </p>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Journal Lines</h3>
          <Button type="button" size="sm" variant="secondary" onClick={() => append({ accountId: '', debit: 0, credit: 0, description: '' })}>
            <Plus className="h-4 w-4 mr-1" /> Add Line
          </Button>
        </div>

        {fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start p-3 bg-gray-50 rounded-lg">
            <div className="col-span-12 sm:col-span-12 md:col-span-5">
              <Select
                label="Account"
                options={accountOptions}
                {...register(`lines.${index}.accountId`)}
                error={errors.lines?.[index]?.accountId?.message}
              />
            </div>
            <div className="col-span-12 sm:col-span-6 md:col-span-2">
              <Input label="Debit" type="number" step="0.01" {...register(`lines.${index}.debit`)} />
            </div>
            <div className="col-span-12 sm:col-span-6 md:col-span-2">
              <Input label="Credit" type="number" step="0.01" {...register(`lines.${index}.credit`)} />
            </div>
            <div className="col-span-12 sm:col-span-10 md:col-span-2">
              <Input label="Line Note" {...register(`lines.${index}.description`)} />
            </div>
            <div className="col-span-12 sm:col-span-2 flex items-end pb-1">
              {fields.length > 2 && (
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(index)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between text-sm p-3 rounded-lg bg-primary-50">
        <span>Total Debit: <strong>KES {totalDebit.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></span>
        <span>Total Credit: <strong>KES {totalCredit.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></span>
        <span className={Math.abs(totalDebit - totalCredit) < 0.01 ? 'text-green-600' : 'text-red-600'}>
          {Math.abs(totalDebit - totalCredit) < 0.01 ? 'Balanced' : 'Out of balance'}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Post Entry</Button>
      </div>
    </form>
  );
}
