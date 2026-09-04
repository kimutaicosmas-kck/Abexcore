import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, Trash2, X } from 'lucide-react';
import { operationsApi, customersApi } from '../../services/api';
import { Button, Input, Select, FormActions, ModalFormBody } from '../ui';
import { Customer, SalesQuotation } from '../../types';
import { useAuth, useVatRate } from '../../contexts/AuthContext';
import { isSalesBookOwner } from '../../utils/salesTargets';
import { ProductSearchSelect } from './ProductSearchSelect';
import {
  readStoredDraftId,
  useDocumentDraftAutosave,
} from '../../hooks/useDocumentDraftAutosave';

const quotationItemSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).optional(),
});

const quotationSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  salesPersonFilter: z.string().optional(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(quotationItemSchema).min(1, 'Add at least one item'),
});

type QuotationFormData = z.infer<typeof quotationSchema>;

const QUOTATION_DRAFT_STORAGE_KEY = 'abexcore:quotation-draft-id';

interface QuotationFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  draftId?: string;
}

function toQuotationDraftPayload(data: QuotationFormData) {
  const { salesPersonFilter: _filter, customerId, validUntil, notes, items } = data;
  return {
    customerId: customerId || undefined,
    validUntil: validUntil || undefined,
    notes: notes || undefined,
    items: items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
      })),
  };
}

function quotationHasDraftContent(data: QuotationFormData) {
  return (
    Boolean(data.customerId) ||
    data.items.some((item) => Boolean(item.productId)) ||
    Boolean(data.notes?.trim())
  );
}

function formatValidUntil(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 10);
}

export function QuotationForm({ onSuccess, onCancel, draftId: initialDraftId }: QuotationFormProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const myBook = isSalesBookOwner(user?.role?.name);
  const canFilterBySalesPerson = !myBook;

  const [draftId, setDraftId] = useState(
    () => initialDraftId || readStoredDraftId(QUOTATION_DRAFT_STORAGE_KEY)
  );
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customerListOpen, setCustomerListOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);
  const hydratedDraftIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(customerSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  const { register, control, handleSubmit, watch, setValue, reset, getValues, formState: { errors } } =
    useForm<QuotationFormData>({
      resolver: zodResolver(quotationSchema),
      defaultValues: {
        salesPersonFilter: '',
        items: [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
      },
    });

  const { data: existingDraft, isLoading: draftLoading } = useQuery({
    queryKey: ['quotation-draft', draftId],
    queryFn: () => operationsApi.getQuotation(draftId!).then((r) => r.data.data as SalesQuotation),
    enabled: Boolean(draftId),
  });

  useEffect(() => {
    if (!existingDraft || existingDraft.status !== 'DRAFT') return;
    if (hydratedDraftIdRef.current === existingDraft.id) return;
    hydratedDraftIdRef.current = existingDraft.id;

    reset({
      customerId: existingDraft.customer?.id || '',
      salesPersonFilter: '',
      validUntil: formatValidUntil(existingDraft.validUntil),
      notes: existingDraft.notes || '',
      items:
        existingDraft.items.length > 0
          ? existingDraft.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
              discount: Number(item.discount || 0),
            }))
          : [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
    });

    if (existingDraft.customer) {
      const vatTag = existingDraft.customer.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
      setCustomerSearch(
        `${existingDraft.customer.code} — ${existingDraft.customer.name} (${vatTag})`
      );
    }
  }, [existingDraft, reset]);

  const saveDraft = useCallback(
    async (data: QuotationFormData, currentDraftId?: string) => {
      const payload = toQuotationDraftPayload(data);
      const response = currentDraftId
        ? await operationsApi.updateQuotationDraft(currentDraftId, payload)
        : await operationsApi.saveQuotationDraft(payload);
      setDraftSavedAt(new Date());
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
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
    isMeaningful: quotationHasDraftContent,
    storageKey: QUOTATION_DRAFT_STORAGE_KEY,
    enabled: !draftLoading,
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');
  const customerId = watch('customerId');
  const salesPersonFilter = watch('salesPersonFilter') || '';

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
    enabled: canFilterBySalesPerson,
  });

  const customerFilterKey = myBook
    ? 'self'
    : salesPersonFilter === 'none'
      ? 'none'
      : salesPersonFilter || 'all';

  const { data: customersData, isFetching: customersLoading } = useQuery({
    queryKey: ['customers-for-quotation', customerFilterKey, debouncedSearch],
    queryFn: () =>
      customersApi
        .list({
          limit: 100,
          isActive: true,
          search: debouncedSearch || undefined,
          ...(myBook
            ? {}
            : salesPersonFilter === 'none'
              ? { salesPersonId: 'none' }
              : salesPersonFilter
                ? { salesPersonId: salesPersonFilter, includeUnassigned: true }
                : {}),
        })
        .then((r) => r.data.data as Customer[]),
  });

  const salesPersonFilterOptions = [
    { value: '', label: 'All salespeople (company-wide)' },
    { value: 'none', label: 'Unassigned customers only' },
    ...(salesOfficers || []).map((o) => ({
      value: o.id,
      label: o.name,
    })),
  ];

  useEffect(() => {
    if (!canFilterBySalesPerson) return;
    setValue('customerId', '');
    setCustomerSearch('');
    setCustomerListOpen(false);
  }, [salesPersonFilter, canFilterBySalesPerson, setValue]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target as Node)) {
        setCustomerListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const companyVatRate = useVatRate();
  const selectedCustomer =
    customersData?.find((c) => c.id === customerId) ||
    existingDraft?.customer ||
    (customerId
      ? ({ id: customerId, name: customerSearch, code: '', vatStatus: 'VAT' } as Customer)
      : undefined);
  const vatRate = selectedCustomer?.vatStatus === 'NON_VAT' ? 0 : companyVatRate;
  const isVatCustomer = selectedCustomer?.vatStatus === 'VAT';

  const keyedTotal = Math.round(
    items.reduce((sum, item) => {
      const discount = item.discount || 0;
      return sum + (item.quantity || 0) * (item.unitPrice || 0) * (1 - discount / 100);
    }, 0)
  );
  const tax = vatRate > 0 ? Math.round(keyedTotal * (vatRate / (100 + vatRate))) : 0;
  const net = keyedTotal - tax;
  const total = keyedTotal;

  const mutation = useMutation({
    mutationFn: async (data: QuotationFormData) => {
      const { salesPersonFilter: _filter, ...payload } = data;
      if (draftId) {
        return operationsApi.finalizeQuotation(draftId, payload);
      }
      return operationsApi.createQuotation(payload);
    },
    onSuccess: () => {
      clearStoredDraft();
      setDraftId(undefined);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      onSuccess();
    },
  });

  const pickCustomer = (c: Customer) => {
    setValue('customerId', c.id, { shouldValidate: true });
    const vatTag = c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
    setCustomerSearch(`${c.code} — ${c.name} (${vatTag})`);
    setCustomerListOpen(false);
  };

  const clearCustomer = () => {
    setValue('customerId', '', { shouldValidate: true });
    setCustomerSearch('');
    setCustomerListOpen(true);
  };

  const handleCancel = () => {
    void saveDraft(getValues(), draftId).finally(onCancel);
  };

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
      <ModalFormBody
        footer={
          <FormActions
            onCancel={handleCancel}
            submitLabel={draftId ? 'Save Quotation' : 'Create Quotation'}
            loading={mutation.isPending}
          />
        }
      >
      {draftLoading ? (
        <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">Loading draft…</div>
      ) : draftSavedAt ? (
        <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">
          Draft saved — you can leave and continue later from the Drafts list.
        </div>
      ) : null}

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create quotation. Please check all fields.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canFilterBySalesPerson && (
          <Select
            label="Filter by sales person"
            options={salesPersonFilterOptions}
            {...register('salesPersonFilter')}
          />
        )}
        <Input label="Valid Until" type="date" {...register('validUntil')} />
      </div>

      <div ref={customerBoxRef} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
        <p className="text-sm font-medium text-slate-800">Customer *</p>
        {customerId && selectedCustomer && !customerListOpen ? (
          <div className="flex items-center gap-2 rounded-xl border border-primary-100 bg-white px-3 py-2 text-sm shadow-sm">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" />
            <button
              type="button"
              onClick={() => {
                setCustomerListOpen(true);
                setCustomerSearch('');
              }}
              className="min-w-0 flex-1 truncate text-left font-medium text-slate-900"
            >
              {customerSearch || selectedCustomer.name}
            </button>
            <button
              type="button"
              onClick={clearCustomer}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              aria-label="Clear customer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              autoComplete="off"
              placeholder="Search customer by name or code…"
              value={customerSearch}
              onChange={(e) => {
                setCustomerSearch(e.target.value);
                setCustomerListOpen(true);
                if (customerId) setValue('customerId', '');
              }}
              onFocus={() => setCustomerListOpen(true)}
              className="block w-full rounded-xl border border-primary-100 bg-white py-2 pl-8 pr-3 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            {customerListOpen && (
              <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-primary-100 bg-white shadow-float">
                {customersLoading ? (
                  <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
                ) : (customersData?.length || 0) === 0 ? (
                  <p className="px-3 py-3 text-sm text-slate-500">No matching customers</p>
                ) : (
                  <ul className="py-1">
                    {(customersData || []).map((c) => {
                      const vatTag = c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
                      const owner =
                        c.salesPerson
                          ? `${c.salesPerson.firstName} ${c.salesPerson.lastName}`.trim()
                          : 'unassigned';
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => pickCustomer(c)}
                            className="flex w-full flex-col px-3 py-2.5 text-left text-sm hover:bg-primary-50/80"
                          >
                            <span className="font-medium text-slate-900">
                              {c.code} — {c.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              {vatTag} · {owner}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
        {errors.customerId?.message && (
          <p className="text-sm text-red-600">{errors.customerId.message}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Quotation Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ productId: '', quantity: 1, unitPrice: 0, discount: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
              <div className="col-span-12 sm:col-span-5">
                <Controller
                  name={`items.${index}.productId`}
                  control={control}
                  render={({ field: productField }) => (
                    <ProductSearchSelect
                      label={index === 0 ? 'Product' : undefined}
                      value={productField.value}
                      onChange={productField.onChange}
                      onProductSelect={(product) => {
                        if (product && (!items[index]?.unitPrice || items[index].unitPrice === 0)) {
                          setValue(`items.${index}.unitPrice`, Number(product.sellingPrice));
                        }
                      }}
                      error={errors.items?.[index]?.productId?.message}
                    />
                  )}
                />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" min={1} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input
                  label={index === 0 ? (isVatCustomer ? 'Price (incl. VAT)' : 'Price') : undefined}
                  type="number"
                  step="0.01"
                  {...register(`items.${index}.unitPrice`)}
                />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Disc %' : undefined} type="number" min={0} max={100} {...register(`items.${index}.discount`)} />
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

      <Input
        label="Description (shown on PDF)"
        placeholder="e.g. QUOTATION FOR CAT 966H Wheel Loader, C11 Engine"
        {...register('notes')}
      />

      <div className="bg-gray-50 rounded-lg p-4 space-y-1 text-sm">
        <div className="flex justify-between">
          <span>{isVatCustomer ? 'Net (excl. VAT)' : 'Subtotal'}</span>
          <span>KES {net.toLocaleString('en-KE')}</span>
        </div>
        <div className="flex justify-between">
          <span>
            VAT ({vatRate}%)
            {selectedCustomer?.vatStatus === 'NON_VAT'
              ? ' · Non-VAT (not added)'
              : isVatCustomer
                ? ' · included in prices'
                : ''}
          </span>
          <span>KES {tax.toLocaleString('en-KE')}</span>
        </div>
        <div className="flex justify-between font-bold text-base pt-1 border-t"><span>Total</span><span>KES {total.toLocaleString('en-KE')}</span></div>
      </div>
      </ModalFormBody>
    </form>
  );
}

export { QUOTATION_DRAFT_STORAGE_KEY };
