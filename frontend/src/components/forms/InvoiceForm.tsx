import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financeApi, customersApi, inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Customer, Supplier } from '../../types';

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.001),
  unitPrice: z.coerce.number().min(0),
});

const invoiceSchema = z.object({
  type: z.enum(['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE']),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one item'),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;

const invoiceTypeOptions = [
  { value: 'SALES', label: 'Sales Invoice' },
  { value: 'PURCHASE', label: 'Purchase Invoice' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' },
  { value: 'DEBIT_NOTE', label: 'Debit Note' },
];

interface InvoiceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function InvoiceForm({ onSuccess, onCancel }: InvoiceFormProps) {
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
  });

  const customerOptions = [
    { value: '', label: 'Select customer...' },
    ...(customersData || []).map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })),
  ];

  const supplierOptions = [
    { value: '', label: 'Select supplier...' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      type: 'SALES',
      items: [{ description: '', quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const invoiceType = watch('type');
  const items = watch('items');
  const isCustomerType = invoiceType === 'SALES' || invoiceType === 'CREDIT_NOTE';

  const lineTotal = items.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
    0
  );

  const mutation = useMutation({
    mutationFn: (data: InvoiceFormData) => {
      const payload = {
        ...data,
        customerId: isCustomerType ? data.customerId || undefined : undefined,
        supplierId: !isCustomerType ? data.supplierId || undefined : undefined,
      };
      return financeApi.createInvoice(payload);
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
          Failed to create invoice. Please check all fields.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Type *" options={invoiceTypeOptions} {...register('type')} />
        {isCustomerType ? (
          <Select label="Customer" options={customerOptions} {...register('customerId')} />
        ) : (
          <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />
        )}
        <Input label="Due Date" type="date" {...register('dueDate')} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Line Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
              <div className="col-span-5">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  {...register(`items.${index}.description`)}
                />
              </div>
              <div className="col-span-3">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" step="0.001" min={0.001} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-3">
                <Input label={index === 0 ? 'Unit Price' : undefined} type="number" step="0.01" {...register(`items.${index}.unitPrice`)} />
              </div>
              <div className="col-span-1">
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

      <Input label="Notes" {...register('notes')} />

      <div className="bg-gray-50 rounded-lg p-4 text-sm">
        <div className="flex justify-between font-bold">
          <span>Total</span>
          <span>KES {lineTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Invoice</Button>
      </div>
    </form>
  );
}
