import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import { operationsApi, customersApi } from '../../services/api';
import { Alert, Button, Input, Select, formatCurrency, ModalFormBody } from '../ui';
import { Customer } from '../../types';
import { useAuth, useVatRate } from '../../contexts/AuthContext';
import { isSalesBookOwner } from '../../utils/salesTargets';
import { getApiErrorCode, getApiErrorMessage } from '../../utils/apiError';
import { ProductLineItemsEditor } from './ProductLineItemsEditor';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const orderItemSchema = z.object({
  productId: z.string().min(1, 'Product required'),
  quantity: z.coerce.number().int().min(1),
  unitPrice: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).optional(),
});

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgoLocal(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDateInput(d);
}

const salesOrderSchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  salesPersonId: z.string().optional(),
  orderDate: z.string().min(1, 'Order date is required'),
  requiredDate: z.string().min(1, 'Sale / required date is required'),
  customerPoNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Add at least one item'),
});

type SalesOrderFormData = z.infer<typeof salesOrderSchema>;

const salesOrderDefaultValues: SalesOrderFormData = {
  salesPersonId: '',
  customerId: '',
  orderDate: localDateInput(),
  requiredDate: localDateInput(),
  customerPoNumber: '',
  items: [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
};

interface SalesOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function SalesOrderForm({ onSuccess, onCancel }: SalesOrderFormProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canAssignSalesPerson = !isSalesBookOwner(user?.role?.name);
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customerListOpen, setCustomerListOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(customerSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  const { register, control, handleSubmit, watch, setValue, getValues, reset: resetForm, formState: { errors } } = useForm<SalesOrderFormData>({
    resolver: zodResolver(salesOrderSchema),
    defaultValues: salesOrderDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft, discardDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.salesOrder,
    watch,
    getValues,
    reset: resetForm,
    defaultValues: salesOrderDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.customerId) ||
      data.items.some((item) => Boolean(item.productId)) ||
      Boolean(data.notes?.trim()) ||
      Boolean(data.customerPoNumber?.trim()),
    getUiState: () => ({ customerSearch }),
    onRestoreUi: (ui) => {
      if (ui?.customerSearch && typeof ui.customerSearch === 'string') {
        setCustomerSearch(ui.customerSearch);
      }
    },
  });

  const salesPersonId = watch('salesPersonId') || '';
  const customerId = watch('customerId');
  const items = watch('items');
  const orderDate = watch('orderDate');

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
    enabled: canAssignSalesPerson,
  });

  const customerFilterKey = canAssignSalesPerson
    ? salesPersonId
      ? salesPersonId
      : 'none'
    : 'self';

  const { data: customersData, isFetching: customersLoading } = useQuery({
    queryKey: ['customers-for-order', customerFilterKey, debouncedSearch],
    queryFn: () =>
      customersApi
        .list({
          limit: 100,
          isActive: true,
          search: debouncedSearch || undefined,
          ...(canAssignSalesPerson
            ? salesPersonId
              ? { salesPersonId, includeUnassigned: true }
              : { salesPersonId: 'none' }
            : {}),
        })
        .then((r) => r.data.data as Customer[]),
  });

  const salesPersonOptions = [
    { value: '', label: 'Me — this sale stays under my name' },
    ...(salesOfficers || []).map((o) => ({
      value: o.id,
      label: o.name,
    })),
  ];

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canAssignSalesPerson) return;
    setValue('customerId', '');
    setCustomerSearch('');
    setCustomerListOpen(false);
  }, [salesPersonId, canAssignSalesPerson, setValue]);

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
  const creditLimit = Number(selectedCustomer?.creditLimit ?? 0);
  const creditUsed = Number(selectedCustomer?.creditUsed ?? 0);
  const hasCreditLimit = creditLimit > 0;
  const availableCredit = Math.max(0, creditLimit - creditUsed);
  const projectedExposure = creditUsed + total;
  const exceedsCreditLimit = hasCreditLimit && projectedExposure > creditLimit;

  const { mutate, reset, isPending, isError, error } = useMutation({
    mutationFn: (data: SalesOrderFormData) => {
      const lines = data.items.filter((item) => item.productId);
      if (!lines.length) {
        throw new Error('Add at least one product line');
      }
      return operationsApi.createSalesOrder({
        ...data,
        items: lines,
        salesPersonId: data.salesPersonId || undefined,
        requiredDate: data.requiredDate || data.orderDate,
      });
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSuccess();
    },
  });

  const errorMessage = isError ? getApiErrorMessage(error) : '';
  const isCreditLimitError = isError && getApiErrorCode(error) === 'CREDIT_LIMIT_EXCEEDED';

  useEffect(() => {
    if (isError) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isError, error]);

  useEffect(() => {
    reset();
  }, [customerId, total, reset]);

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

  const addItem = () => {
    append({ productId: '', quantity: 1, unitPrice: 0, discount: 0 });
  };

  return (
    <form onSubmit={handleSubmit((data) => mutate(data))}>
      <ModalFormBody
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button type="submit" loading={isPending}>
              Create Sales Order
            </Button>
          </div>
        }
      >
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} onDiscard={discardDraft} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canAssignSalesPerson && (
          <Select
            label="Sales Person"
            options={salesPersonOptions}
            {...register('salesPersonId')}
          />
        )}
        <Input
          label="Entry date *"
          type="date"
          max={localDateInput()}
          min={daysAgoLocal(365)}
          {...register('orderDate')}
          error={errors.orderDate?.message}
        />
        <Input
          label="Sale / required date *"
          type="date"
          max={localDateInput()}
          min={daysAgoLocal(365)}
          {...register('requiredDate')}
          error={errors.requiredDate?.message}
        />
        <Input
          label="LPO / Customer PO"
          placeholder="e.g. customer's purchase order number"
          {...register('customerPoNumber')}
          error={errors.customerPoNumber?.message}
        />
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
            <button type="button" onClick={clearCustomer} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Clear customer">
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
                              {vatTag}
                              {!c.salesPersonId ? ' · unassigned' : ''}
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

      {selectedCustomer && hasCreditLimit && (
        <div className="rounded-lg border border-border bg-surface-muted/40 p-3 text-sm space-y-1">
          <p className="font-medium text-slate-800">Customer credit</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
            <span>Limit: {formatCurrency(creditLimit)}</span>
            <span>Used: {formatCurrency(creditUsed)}</span>
            <span>Available: {formatCurrency(availableCredit)}</span>
          </div>
          <p className={exceedsCreditLimit ? 'text-amber-800 font-medium' : 'text-slate-600'}>
            After this order: {formatCurrency(projectedExposure)}
            {exceedsCreditLimit && ' — above credit limit (sale still allowed)'}
          </p>
        </div>
      )}

      {exceedsCreditLimit && (
        <Alert variant="warning">
          This order is above the customer&apos;s credit limit (available{' '}
          {formatCurrency(availableCredit)}, order {formatCurrency(total)}, limit{' '}
          {formatCurrency(creditLimit)}).
        </Alert>
      )}
      {isCreditLimitError && errorMessage && (
        <div ref={errorRef}>
          <Alert variant="error">{errorMessage}</Alert>
        </div>
      )}

      <ProductLineItemsEditor
        fields={fields}
        items={items}
        control={control as Control<any>}
        register={register as UseFormRegister<any>}
        setValue={setValue as UseFormSetValue<any>}
        errors={errors as FieldErrors<any>}
        onAppend={addItem}
        onRemove={remove}
        isVatCustomer={isVatCustomer}
        sectionLabel="Order Items"
      />

      <Input label="Notes" {...register('notes')} />

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

      {isError && !isCreditLimitError && (
        <div ref={errorRef}>
          <Alert variant="error">{errorMessage}</Alert>
        </div>
      )}
      </ModalFormBody>
    </form>
  );
}
