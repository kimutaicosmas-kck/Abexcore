import { useEffect, useRef, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { operationsApi, customersApi } from '../../services/api';
import { Alert, Button, Input, Select, formatCurrency, ModalFormBody } from '../ui';
import { Customer } from '../../types';
import { useAuth, useVatRate } from '../../contexts/AuthContext';
import { getApiErrorCode, getApiErrorMessage } from '../../utils/apiError';
import { ProductSearchSelect } from './ProductSearchSelect';

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
  requiredDate: z.string().optional(),
  customerPoNumber: z.string().max(100).optional(),
  notes: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'Add at least one item'),
});

type SalesOrderFormData = z.infer<typeof salesOrderSchema>;

interface SalesOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function SalesOrderForm({ onSuccess, onCancel }: SalesOrderFormProps) {
  const queryClient = useQueryClient();
  const { isSalesOfficer } = useAuth();
  const canAssignSalesPerson = !isSalesOfficer;
  const [customerSearch, setCustomerSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(customerSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [customerSearch]);

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<SalesOrderFormData>({
    resolver: zodResolver(salesOrderSchema),
    defaultValues: {
      salesPersonId: '',
      customerId: '',
      orderDate: localDateInput(),
      customerPoNumber: '',
      items: [{ productId: '', quantity: 1, unitPrice: 0, discount: 0 }],
    },
  });

  const salesPersonId = watch('salesPersonId') || '';
  const customerId = watch('customerId');
  const items = watch('items');

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
    enabled: canAssignSalesPerson,
  });

  // Filter customers by selected sales person (or unassigned). Sales officers are scoped by API.
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

  const customerOptions = [
    { value: '', label: customersLoading ? 'Loading customers…' : 'Select customer…' },
    ...(customersData || []).map((c) => {
      const vatTag = c.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
      const base = `${c.code} - ${c.name} (${vatTag})`;
      return {
        value: c.id,
        label: !c.salesPersonId ? `${base} (unassigned — open to sales)` : base,
      };
    }),
  ];

  const salesPersonOptions = [
    { value: '', label: 'Me — this sale stays under my name' },
    ...(salesOfficers || []).map((o) => ({
      value: o.id,
      label: o.name,
    })),
  ];

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const errorRef = useRef<HTMLDivElement>(null);

  // When sales person changes, clear customer (list is a different set).
  useEffect(() => {
    if (!canAssignSalesPerson) return;
    setValue('customerId', '');
    setCustomerSearch('');
  }, [salesPersonId, canAssignSalesPerson, setValue]);

  const companyVatRate = useVatRate();
  const selectedCustomer = customersData?.find((c) => c.id === customerId);
  const vatRate = selectedCustomer?.vatStatus === 'NON_VAT' ? 0 : companyVatRate;
  const isVatCustomer = selectedCustomer?.vatStatus === 'VAT';

  // Keyed prices already include VAT for VAT customers — extract, do not add on top.
  // All amounts are whole KES (no decimals).
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
    mutationFn: (data: SalesOrderFormData) =>
      operationsApi.createSalesOrder({
        ...data,
        salesPersonId: data.salesPersonId || undefined,
      }),
    onSuccess: () => {
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {canAssignSalesPerson && (
          <Select
            label="Sales Person"
            options={salesPersonOptions}
            {...register('salesPersonId')}
          />
        )}
        <Input
          label="Order Date *"
          type="date"
          max={localDateInput()}
          min={daysAgoLocal(365)}
          {...register('orderDate')}
          error={errors.orderDate?.message}
        />
        <Input label="Required Date" type="date" {...register('requiredDate')} />
        <Input
          label="LPO / Customer PO"
          placeholder="e.g. customer's purchase order number"
          {...register('customerPoNumber')}
          error={errors.customerPoNumber?.message}
        />
      </div>

      {canAssignSalesPerson && (
        <p className="-mt-2 text-xs text-slate-500">
          Choose a sales officer, or leave as Me — the order stays under the account that created it.
        </p>
      )}
      <p className="-mt-1 text-xs text-slate-500">
        Order date can be today or a past day (e.g. yesterday) so late-entered sales still count on the correct day.
      </p>
      <p className="-mt-1 text-xs text-slate-500">
        Enter the customer&apos;s LPO / purchase order number — it is copied onto the sales invoice.
      </p>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-3">
        <p className="text-sm font-medium text-slate-800">Customer</p>
        <Input
          label="Search customer"
          placeholder="Search by name or code…"
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
        />
        <Select
          label="Customer *"
          options={customerOptions}
          {...register('customerId')}
          error={errors.customerId?.message}
        />
        <p className="text-xs text-slate-500">
          {canAssignSalesPerson
            ? salesPersonId
              ? 'Showing this officer’s customers plus unassigned ones. Choosing an unassigned customer assigns them to that officer.'
              : 'Showing unassigned customers. This order stays under your account name.'
            : 'Showing your customers and unassigned (free) customers. Anyone with sales rights can sell to unassigned accounts.'}
          {(customersData?.length ?? 0) === 0 && !customersLoading
            ? ' No matching customers found.'
            : ''}
        </p>
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
          {formatCurrency(creditLimit)}). Credit limit is optional — you can still create the order.
        </Alert>
      )}
      {isCreditLimitError && errorMessage && (
        <div ref={errorRef}>
          <Alert variant="error">{errorMessage}</Alert>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Order Items *</label>
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
                  render={({ field }) => (
                    <ProductSearchSelect
                      label={index === 0 ? 'Product' : undefined}
                      value={field.value}
                      onChange={field.onChange}
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
