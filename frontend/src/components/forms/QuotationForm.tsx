import { useCallback, useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi } from '../../services/api';
import { Button, Input, Select, FormActions, ModalFormBody } from '../ui';
import { Customer, SalesQuotation } from '../../types';
import { useAuth, useVatRate } from '../../contexts/AuthContext';
import { isSalesBookOwner } from '../../utils/salesTargets';
import { ProductLineItemsEditor } from './ProductLineItemsEditor';
import { FormDraftNotice } from './FormDraftNotice';
import { CustomerSearchSelect } from './CustomerSearchSelect';
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
  /** Edit a finalized quotation (PENDING / APPROVED, not yet converted). */
  editId?: string;
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

export function QuotationForm({ onSuccess, onCancel, draftId: initialDraftId, editId }: QuotationFormProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const myBook = isSalesBookOwner(user?.role?.name);
  const canFilterBySalesPerson = !myBook;

  const [draftId, setDraftId] = useState(
    () => initialDraftId || readStoredDraftId(QUOTATION_DRAFT_STORAGE_KEY)
  );
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftRestored, setDraftRestored] = useState(Boolean(initialDraftId));
  const [draftDiscarded, setDraftDiscarded] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const hydratedDraftIdRef = useRef<string | undefined>(undefined);
  const hydratedEditIdRef = useRef<string | undefined>(undefined);
  const isEditingPending = Boolean(editId);

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
    enabled: Boolean(draftId) && !editId,
  });

  const { data: existingEdit, isLoading: editLoading } = useQuery({
    queryKey: ['quotation-edit', editId],
    queryFn: () => operationsApi.getQuotation(editId!).then((r) => r.data.data as SalesQuotation),
    enabled: Boolean(editId),
  });

  const hydrateQuotation = useCallback(
    (quotation: SalesQuotation) => {
      reset({
        customerId: quotation.customer?.id || '',
        salesPersonFilter: '',
        validUntil: formatValidUntil(quotation.validUntil),
        notes: quotation.notes || '',
        items:
          quotation.items.length > 0
            ? quotation.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
                discount: Number(item.discount || 0),
              }))
            : [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
      });

      if (quotation.customer) {
        setSelectedCustomer(quotation.customer as Customer);
        const vatTag = quotation.customer.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
        setCustomerSearch(
          `${quotation.customer.code} — ${quotation.customer.name} (${vatTag})`
        );
      }
    },
    [reset]
  );

  useEffect(() => {
    if (!existingDraft || existingDraft.status !== 'DRAFT') return;
    if (hydratedDraftIdRef.current === existingDraft.id) return;
    hydratedDraftIdRef.current = existingDraft.id;
    hydrateQuotation(existingDraft);
    setDraftRestored(true);
  }, [existingDraft, hydrateQuotation]);

  useEffect(() => {
    if (!existingEdit || !['PENDING', 'APPROVED'].includes(existingEdit.status)) return;
    if (hydratedEditIdRef.current === existingEdit.id) return;
    hydratedEditIdRef.current = existingEdit.id;
    hydrateQuotation(existingEdit);
  }, [existingEdit, hydrateQuotation]);

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
    enabled: !draftLoading && !draftDiscarded && !isEditingPending,
  });

  const discardDraft = useCallback(async () => {
    setDiscarding(true);
    try {
      if (draftId) {
        await operationsApi.deleteQuotationDraft(draftId);
      }
      clearStoredDraft();
      setDraftId(undefined);
      setDraftSavedAt(null);
      setDraftRestored(false);
      setDraftDiscarded(true);
      hydratedDraftIdRef.current = undefined;
      reset({
        salesPersonFilter: '',
        items: [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
      });
      setCustomerSearch('');
      setSelectedCustomer(null);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      onCancel();
    } finally {
      setDiscarding(false);
    }
  }, [clearStoredDraft, draftId, onCancel, queryClient, reset]);

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

  const salesPersonFilterOptions = [
    { value: '', label: 'All salespeople (company-wide)' },
    { value: 'none', label: 'Unassigned customers only' },
    ...(salesOfficers || []).map((o) => ({
      value: o.id,
      label: o.name,
    })),
  ];

  const companyVatRate = useVatRate();
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
      if (editId) {
        return operationsApi.updateQuotation(editId, payload);
      }
      if (draftId) {
        return operationsApi.finalizeQuotation(draftId, payload);
      }
      return operationsApi.createQuotation(payload);
    },
    onSuccess: () => {
      if (!isEditingPending) {
        clearStoredDraft();
        setDraftId(undefined);
      }
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      if (editId) {
        queryClient.invalidateQueries({ queryKey: ['quotation-edit', editId] });
      }
      onSuccess();
    },
  });

  const handleCancel = () => {
    if (isEditingPending) {
      onCancel();
      return;
    }
    void saveDraft(getValues(), draftId).finally(onCancel);
  };

  const formLoading = draftLoading || editLoading;
  const submitLabel = isEditingPending
    ? 'Save Changes'
    : draftId
      ? 'Save Quotation'
      : 'Create Quotation';

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
      <ModalFormBody
        footer={
          <FormActions
            onCancel={handleCancel}
            submitLabel={submitLabel}
            loading={mutation.isPending}
          />
        }
      >
      {formLoading ? (
        <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">
          {isEditingPending ? 'Loading quotation…' : 'Loading draft…'}
        </div>
      ) : (
        !isEditingPending && (
          <FormDraftNotice
            show={Boolean(draftId || draftSavedAt || draftRestored)}
            draftSavedAt={draftSavedAt}
            draftRestored={draftRestored}
            onDiscard={discardDraft}
            discarding={discarding}
          />
        )
      )}

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {isEditingPending
            ? 'Failed to update quotation. Please check all fields.'
            : 'Failed to create quotation. Please check all fields.'}
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

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <CustomerSearchSelect
          label="Customer *"
          value={customerId || ''}
          onChange={(id) => setValue('customerId', id, { shouldValidate: true })}
          onCustomerSelect={setSelectedCustomer}
          onSearchTextChange={setCustomerSearch}
          initialSearchText={customerSearch}
          salesPersonId={salesPersonFilter === 'none' ? 'none' : salesPersonFilter}
          canAssignSalesPerson={canFilterBySalesPerson && !myBook}
          salesPersonFilterMode="quotation"
          error={errors.customerId?.message}
        />
      </div>

      <ProductLineItemsEditor
        fields={fields}
        items={items}
        control={control as Control<any>}
        register={register as UseFormRegister<any>}
        setValue={setValue as UseFormSetValue<any>}
        errors={errors as FieldErrors<any>}
        onAppend={() => append({ productId: '', quantity: 1, unitPrice: 0, discount: 0 })}
        onRemove={remove}
        isVatCustomer={isVatCustomer}
        sectionLabel="Quotation Items"
      />

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
