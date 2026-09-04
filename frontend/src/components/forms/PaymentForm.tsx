import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { financeApi } from '../../services/api';
import { Button, Input, Select, Alert, formatCurrency } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { Invoice } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const paymentSchema = z
  .object({
    paymentDate: z.string().min(1, 'Payment date is required'),
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'MPESA', 'CARD', 'CREDIT']).optional(),
    reference: z.string().optional(),
  })
  .refine((data) => data.method !== 'MPESA' || (data.reference && data.reference.length >= 6), {
    message: 'M-Pesa requires a transaction code in Reference',
    path: ['reference'],
  });

type PaymentFormData = z.infer<typeof paymentSchema>;

function todayInput() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const paymentDefaultValues: PaymentFormData = {
  paymentDate: todayInput(),
  method: undefined,
  reference: '',
};

const paymentMethodOptions = [
  { value: '', label: 'Select method...' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'CARD', label: 'Card' },
  { value: 'CREDIT', label: 'Credit' },
];

function invoiceBalance(inv: Invoice): number {
  if (inv.balanceDue != null) return Number(inv.balanceDue);
  return Math.max(
    0,
    Number(inv.totalAmount) - Number(inv.paidAmount) - Number(inv.creditedAmount || 0)
  );
}

interface PaymentFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  invoiceId?: string;
}

export function PaymentForm({ onSuccess, onCancel, invoiceId: preselectedId }: PaymentFormProps) {
  const queryClient = useQueryClient();
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(invoiceSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [invoiceSearch]);

  const { data: invoicesData, isFetching } = useQuery({
    queryKey: ['invoices-for-payment', debouncedSearch],
    queryFn: () =>
      financeApi
        .invoices({
          page: 1,
          limit: 50,
          search: debouncedSearch || undefined,
          type: 'SALES',
        })
        .then((r) => r.data.data as Invoice[]),
  });

  const unpaidInvoices = useMemo(
    () =>
      (invoicesData || []).filter((inv) => {
        if (inv.type === 'CREDIT_NOTE' || inv.type === 'PURCHASE') return false;
        return invoiceBalance(inv) > 0.009;
      }),
    [invoicesData]
  );

  const { data: preselectedInvoice } = useQuery({
    queryKey: ['invoice-for-payment', preselectedId],
    queryFn: () => financeApi.getInvoice(preselectedId!).then((r) => r.data.data as Invoice),
    enabled: Boolean(preselectedId),
  });

  useEffect(() => {
    if (!preselectedInvoice) return;
    const bal = invoiceBalance(preselectedInvoice);
    if (bal > 0.009) {
      setSelected((prev) =>
        prev[preselectedInvoice.id] != null ? prev : { ...prev, [preselectedInvoice.id]: bal }
      );
    }
  }, [preselectedInvoice]);

  const selectedInvoices = useMemo(() => {
    const byId = new Map<string, Invoice>();
    for (const inv of unpaidInvoices) byId.set(inv.id, inv);
    if (preselectedInvoice) byId.set(preselectedInvoice.id, preselectedInvoice);
    return Object.keys(selected)
      .map((id) => byId.get(id))
      .filter((inv): inv is Invoice => Boolean(inv));
  }, [selected, unpaidInvoices, preselectedInvoice]);

  const selectedCustomerId = selectedInvoices.find((inv) => inv.customer?.id)?.customer?.id;

  const visibleInvoices = useMemo(() => {
    const list = [...unpaidInvoices];
    if (preselectedInvoice && !list.some((i) => i.id === preselectedInvoice.id)) {
      list.unshift(preselectedInvoice);
    }
    if (!selectedCustomerId) return list;
    return list.filter(
      (inv) => !inv.customer?.id || inv.customer.id === selectedCustomerId || selected[inv.id] != null
    );
  }, [unpaidInvoices, preselectedInvoice, selectedCustomerId, selected]);

  const totalAllocated = Object.values(selected).reduce((sum, n) => sum + Number(n || 0), 0);

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    reset,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: paymentDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.payment,
    watch,
    getValues,
    reset,
    defaultValues: paymentDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.method) ||
      Boolean(data.reference?.trim()) ||
      Object.keys(selected).length > 0 ||
      Boolean(invoiceSearch.trim()),
    getUiState: () => ({ selected, invoiceSearch }),
    onRestoreUi: (ui) => {
      if (ui?.selected && typeof ui.selected === 'object') {
        setSelected(ui.selected as Record<string, number>);
      }
      if (typeof ui?.invoiceSearch === 'string') setInvoiceSearch(ui.invoiceSearch);
    },
  });

  const method = watch('method');

  const toggleInvoice = (inv: Invoice) => {
    setSelected((prev) => {
      if (prev[inv.id] != null) {
        const next = { ...prev };
        delete next[inv.id];
        return next;
      }
      if (selectedCustomerId && inv.customer?.id && inv.customer.id !== selectedCustomerId) {
        return prev;
      }
      return { ...prev, [inv.id]: invoiceBalance(inv) };
    });
  };

  const setAllocAmount = (invoiceId: string, value: string, max: number) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      setSelected((prev) => ({ ...prev, [invoiceId]: 0 }));
      return;
    }
    setSelected((prev) => ({ ...prev, [invoiceId]: Math.min(n, max) }));
  };

  const selectAllVisibleForCustomer = () => {
    const anchor =
      selectedCustomerId ||
      visibleInvoices.find((i) => i.customer?.id)?.customer?.id;
    const next: Record<string, number> = {};
    for (const inv of visibleInvoices) {
      if (anchor && inv.customer?.id && inv.customer.id !== anchor) continue;
      next[inv.id] = invoiceBalance(inv);
    }
    setSelected(next);
  };

  const mutation = useMutation({
    mutationFn: (data: PaymentFormData) => {
      const allocations = Object.entries(selected)
        .filter(([, amount]) => Number(amount) > 0.009)
        .map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) }));
      if (allocations.length === 0) {
        throw new Error('Select at least one invoice');
      }
      return financeApi.payments({
        paymentDate: data.paymentDate,
        method: data.method || undefined,
        reference: data.reference || undefined,
        allocations,
      });
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['invoice-detail'] });
      queryClient.invalidateQueries({ queryKey: ['invoices-for-payment'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
      queryClient.invalidateQueries({ queryKey: ['finance-overview'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] });
      onSuccess();
    },
  });

  const selectionError =
    Object.keys(selected).length === 0
      ? 'Select one or more invoices'
      : totalAllocated <= 0.009
        ? 'Enter amounts for the selected invoices'
        : null;

  return (
    <form
      onSubmit={handleSubmit((data) => {
        if (selectionError) return;
        mutation.mutate(data);
      })}
      className="space-y-4"
    >
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Payment date *"
          type="date"
          {...register('paymentDate')}
          error={errors.paymentDate?.message}
        />
        <Select label="Payment Method" options={paymentMethodOptions} {...register('method')} />
        <Input
          label={method === 'MPESA' ? 'M-Pesa Code *' : 'Reference'}
          placeholder={method === 'MPESA' ? 'e.g. QHK7X2ABCD' : 'Bank ref / cheque no.'}
          {...register('reference')}
          error={errors.reference?.message}
          className="sm:col-span-2"
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm font-medium text-slate-700">Invoices *</label>
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={selectAllVisibleForCustomer}
          >
            Select all shown
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={invoiceSearch}
            onChange={(e) => setInvoiceSearch(e.target.value)}
            placeholder="Search invoice # or customer…"
            className="w-full rounded-xl border border-primary-100 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        {selectedCustomerId && (
          <p className="text-xs text-slate-500">
            Showing invoices for the selected customer only (one payment, multiple invoices).
          </p>
        )}
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
          {isFetching && visibleInvoices.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">Searching invoices…</p>
          ) : visibleInvoices.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">
              No unpaid sales invoices found. Try another search.
            </p>
          ) : (
            visibleInvoices.map((inv) => {
              const bal = invoiceBalance(inv);
              const checked = selected[inv.id] != null;
              const lockedOut =
                Boolean(selectedCustomerId) &&
                Boolean(inv.customer?.id) &&
                inv.customer!.id !== selectedCustomerId &&
                !checked;
              return (
                <div
                  key={inv.id}
                  className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${
                    lockedOut ? 'opacity-40' : ''
                  }`}
                >
                  <label className="flex items-start gap-2 min-w-0 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-slate-300"
                      checked={checked}
                      disabled={lockedOut}
                      onChange={() => toggleInvoice(inv)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900 truncate">
                        {inv.invoiceNumber}
                      </span>
                      <span className="block text-xs text-slate-500 truncate">
                        {inv.customer?.name || 'Customer'} · Balance {formatCurrency(bal)}
                      </span>
                    </span>
                  </label>
                  {checked && (
                    <div className="flex items-center gap-2 sm:w-40 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min={0.01}
                        max={bal}
                        inputMode="decimal"
                        value={selected[inv.id] ?? ''}
                        onChange={(e) => setAllocAmount(inv.id, e.target.value, bal)}
                        className="w-full rounded-lg border border-primary-100 px-2 py-1.5 text-sm tabular-nums"
                        aria-label={`Amount for ${inv.invoiceNumber}`}
                      />
                      <button
                        type="button"
                        className="text-[11px] text-primary-600 whitespace-nowrap hover:underline"
                        onClick={() =>
                          setSelected((prev) => ({ ...prev, [inv.id]: bal }))
                        }
                      >
                        Full
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {selectionError && <p className="text-sm text-red-600">{selectionError}</p>}
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm flex justify-between gap-3">
        <span className="text-slate-500">
          {Object.keys(selected).length} invoice{Object.keys(selected).length === 1 ? '' : 's'} · one payment
        </span>
        <span className="font-semibold text-slate-900 tabular-nums">
          Total {formatCurrency(totalAllocated)}
        </span>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending} disabled={Boolean(selectionError)}>
          Record Payment
        </Button>
      </div>
    </form>
  );
}
