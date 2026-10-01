import { useEffect, useMemo } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financeApi } from '../../services/api';
import { Alert, Button, Input, formatCurrency } from '../ui';
import { Invoice } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import { useVatRate } from '../../contexts/AuthContext';

const editItemSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.001),
  unitPrice: z.coerce.number().min(0),
});

const editInvoiceSchema = z.object({
  adjustmentReason: z.string().min(1, 'Reason is required'),
  items: z.array(editItemSchema).min(1, 'Keep at least one line item'),
});

type EditInvoiceFormData = z.infer<typeof editInvoiceSchema>;

interface InvoiceEditFormProps {
  invoice: Invoice;
  onSuccess: (updated: Invoice) => void;
  onCancel: () => void;
}

export function InvoiceEditForm({ invoice, onSuccess, onCancel }: InvoiceEditFormProps) {
  const queryClient = useQueryClient();
  const vatRate = useVatRate();
  const isSalesSide = invoice.type === 'SALES';
  const isVatCustomer = isSalesSide && invoice.customer?.vatStatus === 'VAT';

  const defaultItems = useMemo(
    () =>
      (invoice.items || []).map((item) => ({
        id: item.id,
        description: item.description,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    [invoice]
  );

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<EditInvoiceFormData>({
    resolver: zodResolver(editInvoiceSchema),
    defaultValues: {
      adjustmentReason: '',
      items: defaultItems,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  const previewTotal = (items || []).reduce(
    (sum, item) => sum + Number(item?.quantity || 0) * Number(item?.unitPrice || 0),
    0
  );

  const mutation = useMutation({
    mutationFn: (data: EditInvoiceFormData) =>
      financeApi.updateInvoiceItems(invoice.id, {
        adjustmentReason: data.adjustmentReason,
        items: data.items.map(({ id, description, quantity, unitPrice }) => ({
          id: id || undefined,
          description,
          quantity,
          unitPrice,
        })),
      }),
    onSuccess: async (res) => {
      const updated = res.data.data as Invoice;
      queryClient.setQueryData(['invoice-detail', updated.id], updated);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['invoices'] }),
        queryClient.refetchQueries({ queryKey: ['invoice-detail', updated.id] }),
        queryClient.refetchQueries({ queryKey: ['finance-stats'] }),
        queryClient.refetchQueries({ queryKey: ['finance-overview'] }),
        queryClient.refetchQueries({ queryKey: ['customers'] }),
        queryClient.refetchQueries({ queryKey: ['journal-entries'] }),
      ]);
      onSuccess(updated);
    },
  });

  useEffect(() => {
    mutation.reset();
  }, [invoice.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>}

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Adjusting <strong>{invoice.invoiceNumber}</strong> for{' '}
        <strong>{invoice.customer?.name || invoice.supplier?.name || '—'}</strong>.
        Changes update invoice totals and re-post the general ledger entry.
      </div>

      <Input
        label="Reason for adjustment *"
        placeholder="e.g. Wrong quantity invoiced / price correction agreed with customer"
        {...register('adjustmentReason')}
        error={errors.adjustmentReason?.message}
      />

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Line items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-xl border border-slate-100"
            >
              <input type="hidden" {...register(`items.${index}.id`)} />
              <div className="col-span-12 sm:col-span-5">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  {...register(`items.${index}.description`)}
                  error={errors.items?.[index]?.description?.message}
                />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Input
                  label={index === 0 ? 'Qty' : undefined}
                  type="number"
                  step="0.001"
                  min={0.001}
                  {...register(`items.${index}.quantity`)}
                  error={errors.items?.[index]?.quantity?.message}
                />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Input
                  label={
                    index === 0
                      ? isVatCustomer
                        ? 'Unit price (incl. VAT)'
                        : 'Unit price'
                      : undefined
                  }
                  type="number"
                  step="0.01"
                  min={0}
                  {...register(`items.${index}.unitPrice`)}
                  error={errors.items?.[index]?.unitPrice?.message}
                />
              </div>
              <div className="col-span-12 sm:col-span-1">
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <span className="text-slate-600">
          Line total{isVatCustomer ? ' (incl. VAT)' : ''}
          {isVatCustomer && vatRate > 0 ? ` · VAT ${vatRate}%` : ''}
        </span>
        <span className="font-semibold tabular-nums">{formatCurrency(previewTotal)}</span>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Save adjustments
        </Button>
      </div>
    </form>
  );
}
