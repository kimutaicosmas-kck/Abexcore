import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { financeApi, inventoryApi } from '../../services/api';
import { Button, Input, Select, Alert, FormActions, ModalFormBody } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Customer, Invoice, Supplier } from '../../types';
import { useVatRate } from '../../contexts/AuthContext';
import { CustomerSearchSelect } from './CustomerSearchSelect';
import {
  readStoredDraftId,
  useDocumentDraftAutosave,
} from '../../hooks/useDocumentDraftAutosave';
import { FormDraftNotice } from './FormDraftNotice';

const invoiceItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.001),
  unitPrice: z.coerce.number().min(0),
});

const invoiceSchema = z
  .object({
    type: z.enum(['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE']),
    customerId: z.string().optional(),
    supplierId: z.string().optional(),
    originalInvoiceId: z.string().optional(),
    dueDate: z.string().optional(),
    customerPoNumber: z.string().max(100).optional(),
    notes: z.string().optional(),
    items: z.array(invoiceItemSchema).min(1, 'Add at least one item'),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'CREDIT_NOTE' && !data.originalInvoiceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select the sales invoice to credit',
        path: ['originalInvoiceId'],
      });
    }
  });

type InvoiceFormData = z.infer<typeof invoiceSchema>;

const invoiceTypeOptions = [
  { value: 'SALES', label: 'Sales Invoice' },
  { value: 'PURCHASE', label: 'Purchase Invoice' },
  { value: 'CREDIT_NOTE', label: 'Credit Note' },
  { value: 'DEBIT_NOTE', label: 'Debit Note' },
];

const INVOICE_DRAFT_STORAGE_KEY = 'abexcore:invoice-draft-id';

function invoiceDraftStorageKey(type: InvoiceFormData['type']) {
  return `${INVOICE_DRAFT_STORAGE_KEY}:${type}`;
}

function isNotFoundError(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 404;
}

/** Draft PATCH/finalize failed because the stored id is missing or already posted. */
function isStaleInvoiceDraftError(err: unknown): boolean {
  if (isNotFoundError(err)) return true;
  if (!isAxiosError(err) || err.response?.status !== 400) return false;
  const msg = String(err.response?.data?.message ?? '').toLowerCase();
  return (
    msg.includes('only draft') ||
    msg.includes('can be finalized') ||
    msg.includes('can be updated this way')
  );
}

function clearInvoiceDraftSessionStorage() {
  sessionStorage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
  for (const t of ['SALES', 'PURCHASE', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const) {
    sessionStorage.removeItem(invoiceDraftStorageKey(t));
  }
}

interface InvoiceFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  draftId?: string;
  /** Pre-select document type when opening the form (e.g. credit note). */
  defaultType?: InvoiceFormData['type'];
}

function toInvoiceDraftPayload(data: InvoiceFormData) {
  const isCustomerType = data.type === 'SALES' || data.type === 'CREDIT_NOTE';
  return {
    type: data.type,
    customerId: isCustomerType ? data.customerId || undefined : undefined,
    supplierId: !isCustomerType ? data.supplierId || undefined : undefined,
    originalInvoiceId:
      data.type === 'CREDIT_NOTE' ? data.originalInvoiceId || undefined : undefined,
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
    Boolean(data.originalInvoiceId) ||
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

export function InvoiceForm({
  onSuccess,
  onCancel,
  draftId: initialDraftId,
  defaultType = 'SALES',
}: InvoiceFormProps) {
  const queryClient = useQueryClient();
  const draftStorageKey = useMemo(() => invoiceDraftStorageKey(defaultType), [defaultType]);
  const [draftId, setDraftId] = useState(() => {
    if (initialDraftId) return initialDraftId;
    const scoped = readStoredDraftId(draftStorageKey);
    if (scoped) return scoped;
    if (defaultType === 'SALES') {
      return readStoredDraftId(INVOICE_DRAFT_STORAGE_KEY);
    }
    return undefined;
  });
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftRestored, setDraftRestored] = useState(Boolean(initialDraftId));
  const [draftDiscarded, setDraftDiscarded] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const hydratedDraftIdRef = useRef<string | undefined>(undefined);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const { register, control, handleSubmit, watch, reset, getValues, setValue, formState: { errors } } =
    useForm<InvoiceFormData>({
      resolver: zodResolver(invoiceSchema),
      defaultValues: {
        type: defaultType,
        items: [{ description: '', quantity: 1, unitPrice: 0 }],
      },
    });

  const releaseStaleDraftId = useCallback(
    (lostId?: string) => {
      clearInvoiceDraftSessionStorage();
      setDraftId(undefined);
      setDraftRestored(false);
      setDraftSavedAt(null);
      hydratedDraftIdRef.current = undefined;
      if (lostId) {
        queryClient.removeQueries({ queryKey: ['invoice-draft', lostId] });
      }
    },
    [queryClient]
  );

  const { data: existingDraft, isLoading: draftLoading, isError: draftLoadFailed } = useQuery({
    queryKey: ['invoice-draft', draftId],
    queryFn: () => financeApi.getInvoice(draftId!).then((r) => r.data.data as Invoice),
    enabled: Boolean(draftId),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!draftLoadFailed || !draftId) return;
    releaseStaleDraftId(draftId);
  }, [draftLoadFailed, draftId, releaseStaleDraftId]);

  useEffect(() => {
    if (!existingDraft || existingDraft.status === 'DRAFT') return;
    releaseStaleDraftId(existingDraft.id);
  }, [existingDraft, releaseStaleDraftId]);

  useEffect(() => {
    if (!existingDraft || existingDraft.status !== 'DRAFT') return;
    if (hydratedDraftIdRef.current === existingDraft.id) return;
    hydratedDraftIdRef.current = existingDraft.id;

    reset({
      type: existingDraft.type as InvoiceFormData['type'],
      customerId: existingDraft.customer?.id || '',
      supplierId: existingDraft.supplier?.id || '',
      originalInvoiceId:
        existingDraft.originalInvoice?.id || existingDraft.originalInvoiceId || '',
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
    if (existingDraft.customer) {
      setSelectedCustomer(existingDraft.customer as Customer);
    }
    setDraftRestored(true);
  }, [existingDraft, reset]);

  const saveDraft = useCallback(
    async (data: InvoiceFormData, currentDraftId?: string) => {
      const payload = toInvoiceDraftPayload(data);
      try {
        const response = currentDraftId
          ? await financeApi.updateInvoiceDraft(currentDraftId, payload)
          : await financeApi.saveInvoiceDraft(payload);
        setDraftSavedAt(new Date());
        return { id: response.data.data.id as string };
      } catch (err) {
        if (currentDraftId && isStaleInvoiceDraftError(err)) {
          releaseStaleDraftId(currentDraftId);
          const response = await financeApi.saveInvoiceDraft(payload);
          setDraftSavedAt(new Date());
          const newId = response.data.data.id as string;
          sessionStorage.setItem(draftStorageKey, newId);
          return { id: newId };
        }
        throw err;
      }
    },
    [draftStorageKey, releaseStaleDraftId]
  );

  const { clearStoredDraft } = useDocumentDraftAutosave({
    watch,
    getValues,
    draftId,
    onDraftId: setDraftId,
    saveDraft,
    isMeaningful: invoiceHasDraftContent,
    storageKey: draftStorageKey,
    enabled: !draftLoading && !draftDiscarded && !draftLoadFailed,
  });

  const discardDraft = useCallback(async () => {
    setDiscarding(true);
    try {
      if (draftId) {
        await financeApi.deleteInvoiceDraft(draftId);
      }
      clearStoredDraft();
      setDraftId(undefined);
      setDraftSavedAt(null);
      setDraftRestored(false);
      setDraftDiscarded(true);
      hydratedDraftIdRef.current = undefined;
      reset({
        type: defaultType,
        items: [{ description: '', quantity: 1, unitPrice: 0 }],
      });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      onCancel();
    } finally {
      setDiscarding(false);
    }
  }, [clearStoredDraft, defaultType, draftId, onCancel, queryClient, reset]);

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const invoiceType = watch('type');
  const customerId = watch('customerId');
  const originalInvoiceId = watch('originalInvoiceId');
  const items = watch('items');
  const isCustomerType = invoiceType === 'SALES' || invoiceType === 'CREDIT_NOTE';
  const isCreditNote = invoiceType === 'CREDIT_NOTE';
  const needsSupplier = invoiceType === 'PURCHASE' || invoiceType === 'DEBIT_NOTE';

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
    enabled: needsSupplier,
    retry: false,
  });

  const supplierOptions = [
    { value: '', label: 'Select supplier...' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const { data: customerInvoicesData, isLoading: customerInvoicesLoading } = useQuery({
    queryKey: ['credit-note-source-invoices', customerId],
    queryFn: () =>
      financeApi
        .invoices({ type: 'SALES', customerId, limit: 500 })
        .then((r) => r.data.data as Invoice[]),
    enabled: isCreditNote && Boolean(customerId),
    retry: false,
  });

  const creditableInvoices = (customerInvoicesData || []).filter(
    (inv) =>
      inv.status !== 'DRAFT' &&
      inv.status !== 'REFUNDED' &&
      (inv.balanceDue ?? Number(inv.totalAmount) - Number(inv.paidAmount)) > 0.009
  );

  const invoiceOptions = [
    { value: '', label: customerInvoicesLoading ? 'Loading invoices…' : 'Select sales invoice…' },
    ...creditableInvoices.map((inv) => {
      const balance = inv.balanceDue ?? Number(inv.totalAmount) - Number(inv.paidAmount);
      return {
        value: inv.id,
        label: `${inv.invoiceNumber} · balance KES ${balance.toLocaleString('en-KE', { minimumFractionDigits: 2 })}`,
      };
    }),
  ];

  const selectedSourceInvoice = creditableInvoices.find((inv) => inv.id === originalInvoiceId);

  useEffect(() => {
    if (!isCreditNote || !originalInvoiceId) return;
    if (selectedSourceInvoice) return;
    if (customerInvoicesLoading) return;
    setValue('originalInvoiceId', '', { shouldValidate: true });
  }, [customerInvoicesLoading, isCreditNote, originalInvoiceId, selectedSourceInvoice, setValue]);

  const companyVatRate = useVatRate();
  const vatCustomer = selectedCustomer || existingDraft?.customer;
  const vatRate =
    isCustomerType && vatCustomer?.vatStatus === 'NON_VAT' ? 0 : companyVatRate;
  const isVatCustomer = isCustomerType && vatCustomer?.vatStatus === 'VAT';
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
        originalInvoiceId:
          data.type === 'CREDIT_NOTE' ? data.originalInvoiceId || undefined : undefined,
      };
      let activeDraftId = draftId;
      if (activeDraftId) {
        try {
          const saved = await saveDraft(data, activeDraftId);
          activeDraftId = saved.id;
          setDraftId(activeDraftId);
          try {
            return await financeApi.finalizeInvoice(activeDraftId, payload);
          } catch (finalizeErr) {
            if (isStaleInvoiceDraftError(finalizeErr)) {
              releaseStaleDraftId(activeDraftId);
              return financeApi.createInvoice(payload);
            }
            throw finalizeErr;
          }
        } catch (err) {
          if (isStaleInvoiceDraftError(err)) {
            releaseStaleDraftId(activeDraftId);
            return financeApi.createInvoice(payload);
          }
          throw err;
        }
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
      ) : (
        <FormDraftNotice
          show={Boolean(draftId || draftSavedAt || draftRestored)}
          draftSavedAt={draftSavedAt}
          draftRestored={draftRestored}
          onDiscard={discardDraft}
          discarding={discarding}
        />
      )}

      {draftLoadFailed && (
        <Alert variant="warning">
          A saved draft could not be loaded (it may have been posted or removed). Continue with a
          fresh credit note and save again.
        </Alert>
      )}

      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Type *" options={invoiceTypeOptions} {...register('type')} />
        {!isCustomerType && (
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

      {isCustomerType && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <CustomerSearchSelect
            label="Customer *"
            value={customerId || ''}
            onChange={(id) => {
              setValue('customerId', id, { shouldValidate: true });
              if (isCreditNote) {
                setValue('originalInvoiceId', '', { shouldValidate: true });
              }
            }}
            onCustomerSelect={setSelectedCustomer}
            onSearchTextChange={setCustomerSearch}
            initialSearchText={customerSearch}
            salesPersonFilterMode="quotation"
            autoFocus={invoiceType === 'CREDIT_NOTE'}
            placeholder="Search customer by name or code…"
          />
          {isCreditNote && customerId && (
            <div className="mt-3">
              <Select
                label="Sales invoice to credit *"
                options={invoiceOptions}
                {...register('originalInvoiceId')}
                error={errors.originalInvoiceId?.message}
              />
              {creditableInvoices.length === 0 && !customerInvoicesLoading && (
                <p className="mt-1 text-xs text-amber-700">
                  No open sales invoices with a balance due for this customer.
                </p>
              )}
              {selectedSourceInvoice && (
                <p className="mt-1 text-xs text-slate-600">
                  Max credit: KES{' '}
                  {(selectedSourceInvoice.balanceDue ??
                    Number(selectedSourceInvoice.totalAmount) -
                      Number(selectedSourceInvoice.paidAmount)
                  ).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
