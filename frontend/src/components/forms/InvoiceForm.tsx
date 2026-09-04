import { useCallback, useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financeApi, customersApi, inventoryApi } from '../../services/api';
import { Button, Input, Select, Alert, FormActions, ModalFormBody } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Customer, Invoice, Supplier } from '../../types';
import { useVatRate } from '../../contexts/AuthContext';
import {
  readStoredDraftId,
  useDocumentDraftAutosave,
} from '../../hooks/useDocumentDraftAutosave';

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
  customerPoNumber: z.string().max(100).optional(),
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

const INVOICE_DRAFT_STORAGE_KEY = 'abexcore:invoice-draft-id';

interface InvoiceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  draftId?: string;
}

function toInvoiceDraftPayload(data: InvoiceFormData) {
  const isCustomerType = data.type === 'SALES' || data.type === 'CREDIT_NOTE';
  return {
    type: data.type,
    customerId: isCustomerType ? data.customerId || undefined : undefined,
    supplierId: !isCustomerType ? data.supplierId || undefined : undefined,
    dueDate: data.dueDate || undefined,
    customerPoNumber: data.customerPoNumber || undefined,
    notes: data.notes || undefined,
    items: data.items
      .filter((item) => item.description?.trim())
      .map((item) => ({
        description: item.description.trim(),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
  };
}

function invoiceHasDraftContent(data: InvoiceFormData) {
  const isCustomerType = data.type === 'SALES' || data.type === 'CREDIT_NOTE';
  return (
    (isCustomerType ? Boolean(data.customerId) : Boolean(data.supplierId)) ||
    data.items.some((item) => Boolean(item.description?.trim())) ||
    Boolean(data.notes?.trim()) ||
    Boolean(data.dueDate) ||
    Boolean(data.customerPoNumber?.trim())
  );
}

function formatDueDate(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function InvoiceForm({ onSuccess, onCancel, draftId: initialDraftId }: InvoiceFormProps) {
  const queryClient = useQueryClient();
  const [draftId, setDraftId] = useState(
    () => initialDraftId || readStoredDraftId(INVOICE_DRAFT_STORAGE_KEY)
  );
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const hydratedDraftIdRef = useRef<string | undefined>(undefined);

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
    ...(customersData || []).map((c) => ({
      value: c.id,
      label: `${c.code} - ${c.name} (${c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT'})`,
    })),
  ];

  const supplierOptions = [
    { value: '', label: 'Select supplier...' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const { register, control, handleSubmit, watch, reset, getValues, formState: { errors } } =
    useForm<InvoiceFormData>({
      resolver: zodResolver(invoiceSchema),
      defaultValues: {
        type: 'SALES',
        items: [{ description: '', quantity: 1, unitPrice: 0 }],
      },
    });

  const { data: existingDraft, isLoading: draftLoading } = useQuery({
    queryKey: ['invoice-draft', draftId],
    queryFn: () => financeApi.getInvoice(draftId!).then((r) => r.data.data as Invoice),
    enabled: Boolean(draftId),
  });

  useEffect(() => {
    if (!existingDraft || existingDraft.status !== 'DRAFT') return;
    if (hydratedDraftIdRef.current === existingDraft.id) return;
    hydratedDraftIdRef.current = existingDraft.id;

    reset({
      type: existingDraft.type as InvoiceFormData['type'],
      customerId: existingDraft.customer?.id || '',
      supplierId: existingDraft.supplier?.id || '',
      dueDate: formatDueDate(existingDraft.dueDate),
      customerPoNumber: existingDraft.customerPoNumber || '',
      notes: existingDraft.notes || '',
      items:
        existingDraft.items && existingDraft.items.length > 0
          ? existingDraft.items.map((item) => ({
              description: item.description,
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
            }))
          : [{ description: '', quantity: 1, unitPrice: 0 }],
    });
  }, [existingDraft, reset]);

  const saveDraft = useCallback(
    async (data: InvoiceFormData, currentDraftId?: string) => {
      const payload = toInvoiceDraftPayload(data);
      const response = currentDraftId
        ? await financeApi.updateInvoiceDraft(currentDraftId, payload)
        : await financeApi.saveInvoiceDraft(payload);
      setDraftSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      return { id: response.data.data.id as string };
    },
    [queryClient]
  );

  const { clearStoredDraft } = useDocumentDraftAutosave({
    watch,
    getValues,
    draftId,
    onDraftId: setDraftId,
    saveDraft,
    isMeaningful: invoiceHasDraftContent,
    storageKey: INVOICE_DRAFT_STORAGE_KEY,
    enabled: !draftLoading,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const invoiceType = watch('type');
  const customerId = watch('customerId');
  const items = watch('items');
  const isCustomerType = invoiceType === 'SALES' || invoiceType === 'CREDIT_NOTE';

  const companyVatRate = useVatRate();
  const selectedCustomer = customersData?.find((c) => c.id === customerId) || existingDraft?.customer;
  const vatRate =
    isCustomerType && selectedCustomer?.vatStatus === 'NON_VAT' ? 0 : companyVatRate;
  const isVatCustomer = isCustomerType && selectedCustomer?.vatStatus === 'VAT';
  const keyedTotal = items.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
    0
  );
  const roundedKeyed = Math.round(keyedTotal);
  const taxAmount = isCustomerType
    ? vatRate > 0
      ? Math.round(roundedKeyed * (vatRate / (100 + vatRate)))
      : 0
    : Math.round(roundedKeyed * (vatRate / 100));
  const net = isCustomerType ? roundedKeyed - taxAmount : roundedKeyed;
  const grandTotal = isCustomerType ? roundedKeyed : roundedKeyed + taxAmount;

  const mutation = useMutation({
    mutationFn: async (data: InvoiceFormData) => {
      const payload = {
        ...data,
        customerId: isCustomerType ? data.customerId || undefined : undefined,
        supplierId: !isCustomerType ? data.supplierId || undefined : undefined,
      };
      if (draftId) {
        return financeApi.finalizeInvoice(draftId, payload);
      }
      return financeApi.createInvoice(payload);
    },
    onSuccess: () => {
      clearStoredDraft();
      setDraftId(undefined);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      onSuccess();
    },
  });

  const handleCancel = () => {
    void saveDraft(getValues(), draftId).finally(onCancel);
  };

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
      <ModalFormBody
        footer={
          <FormActions
            onCancel={handleCancel}
            submitLabel={draftId ? 'Save Invoice' : 'Create Invoice'}
            loading={mutation.isPending}
          />
        }
      >
      {draftLoading ? (
        <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">Loading draft…</div>
      ) : draftSavedAt ? (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">
          Draft saved — you can leave and continue later from the Drafts filter.
        </div>
      ) : null}

      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Type *" options={invoiceTypeOptions} {...register('type')} />
        {isCustomerType ? (
          <Select label="Customer" options={customerOptions} {...register('customerId')} />
        ) : (
          <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />
        )}
        <Input label="Due Date" type="date" {...register('dueDate')} />
        {isCustomerType && (
          <Input
            label="LPO / Customer PO"
            placeholder="e.g. customer's purchase order number"
            {...register('customerPoNumber')}
            error={errors.customerPoNumber?.message}
          />
        )}
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
            <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="col-span-12 sm:col-span-5">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  {...register(`items.${index}.description`)}
                />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" step="0.001" min={0.001} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Input
                  label={
                    index === 0
                      ? isVatCustomer
                        ? 'Unit Price (incl. VAT)'
                        : 'Unit Price'
                      : undefined
                  }
                  type="number"
                  step="0.01"
                  {...register(`items.${index}.unitPrice`)}
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

      <Input label="Notes" {...register('notes')} />

      <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 text-sm space-y-2">
        <div className="flex justify-between text-slate-600">
          <span>{isVatCustomer ? 'Net (excl. VAT)' : 'Subtotal'}</span>
          <span>KES {net.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>
            VAT ({vatRate}%)
            {isCustomerType && selectedCustomer?.vatStatus === 'NON_VAT'
              ? ' · Non-VAT (not added)'
              : isVatCustomer
                ? ' · included in prices'
                : ''}
          </span>
          <span>KES {taxAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
        </div>
        <div className="flex justify-between font-bold text-slate-900 pt-2 border-t border-slate-200">
          <span>Total</span>
          <span>KES {grandTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>
      </ModalFormBody>
    </form>
  );
}

export { INVOICE_DRAFT_STORAGE_KEY };
