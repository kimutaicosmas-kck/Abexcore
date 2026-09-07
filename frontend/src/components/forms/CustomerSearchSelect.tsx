import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { customersApi } from '../../services/api';
import { Customer } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function formatCustomerOptionLabel(customer: Pick<Customer, 'code' | 'name' | 'vatStatus'>) {
  const vatTag = customer.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
  return `${customer.code} — ${customer.name} (${vatTag})`;
}

export interface CustomerSearchSelectProps {
  label?: string;
  value?: string;
  onChange: (customerId: string) => void;
  onCustomerSelect?: (customer: Customer | null) => void;
  /** Persist search text for form drafts. */
  onSearchTextChange?: (text: string) => void;
  initialSearchText?: string;
  salesPersonId?: string;
  canAssignSalesPerson?: boolean;
  /** Sales order: empty = unassigned only. Quotation: empty = all customers. */
  salesPersonFilterMode?: 'order' | 'quotation';
  error?: string;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Customer picker with debounced search — keeps previous results visible while fetching. */
export function CustomerSearchSelect({
  label,
  value = '',
  onChange,
  onCustomerSelect,
  onSearchTextChange,
  initialSearchText = '',
  salesPersonId = '',
  canAssignSalesPerson = false,
  salesPersonFilterMode = 'order',
  error,
  placeholder = 'Search customer by name or code…',
  allowClear = true,
  disabled = false,
  className,
}: CustomerSearchSelectProps) {
  const { company } = useAuth();
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const prevSalesPersonIdRef = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState(initialSearchText);
  const [listOpen, setListOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  useEffect(() => {
    onSearchTextChange?.(query);
  }, [query, onSearchTextChange]);

  const customerFilterKey = canAssignSalesPerson
    ? `${salesPersonFilterMode}:${salesPersonId || 'all'}`
    : 'self';

  const { data: results = [], isFetching, isLoading } = useQuery({
    queryKey: ['customers', 'search-picker', company?.id, customerFilterKey, debouncedQuery],
    queryFn: () => {
      const params: Record<string, unknown> = {
        limit: 100,
        isActive: true,
        search: debouncedQuery || undefined,
      };
      if (canAssignSalesPerson) {
        if (salesPersonFilterMode === 'order') {
          if (salesPersonId) {
            params.salesPersonId = salesPersonId;
            params.includeUnassigned = true;
          } else {
            params.salesPersonId = 'none';
          }
        } else if (salesPersonId === 'none') {
          params.salesPersonId = 'none';
        } else if (salesPersonId) {
          params.salesPersonId = salesPersonId;
          params.includeUnassigned = true;
        }
      }
      return customersApi.list(params).then((r) => r.data.data as Customer[]);
    },
    enabled: !!company?.id,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const { data: selectedCustomer } = useQuery({
    queryKey: ['customers', 'selected', company?.id, value],
    queryFn: () => customersApi.get(value).then((r) => r.data.data as Customer),
    enabled: !!company?.id && !!value,
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of results) map.set(c.id, c);
    if (selectedCustomer?.id) map.set(selectedCustomer.id, selectedCustomer);
    return Array.from(map.values());
  }, [results, selectedCustomer]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!canAssignSalesPerson) return;
    const prev = prevSalesPersonIdRef.current;
    prevSalesPersonIdRef.current = salesPersonId;
    if (prev === undefined) return;
    if (prev === salesPersonId) return;
    onChange('');
    onCustomerSelect?.(null);
    setQuery('');
    setListOpen(false);
  }, [salesPersonId, canAssignSalesPerson, onChange, onCustomerSelect]);

  const handleSelect = (customer: Customer) => {
    onChange(customer.id);
    onCustomerSelect?.(customer);
    setQuery(formatCustomerOptionLabel(customer));
    setListOpen(false);
  };

  const handleClear = () => {
    onChange('');
    onCustomerSelect?.(null);
    setQuery('');
    setListOpen(true);
  };

  const showList = listOpen && !disabled;
  const showInitialLoad = (isLoading || isFetching) && options.length === 0;
  const showRefreshing = isFetching && options.length > 0;

  return (
    <div ref={rootRef} className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={searchId} className="block text-sm font-medium text-slate-800">
          {label}
        </label>
      )}

      {value && selectedCustomer && !listOpen ? (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm shadow-sm',
            error ? 'border-red-400' : 'border-primary-100'
          )}
        >
          <Check className="h-4 w-4 shrink-0 text-emerald-600" />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setListOpen(true);
              setQuery('');
            }}
            className="min-w-0 flex-1 truncate text-left font-medium text-slate-900 hover:text-primary-700 disabled:opacity-50"
            title="Change customer"
          >
            {formatCustomerOptionLabel(selectedCustomer)}
          </button>
          {allowClear && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear customer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            id={searchId}
            type="search"
            disabled={disabled}
            autoComplete="off"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setListOpen(true);
              if (value) {
                onChange('');
                onCustomerSelect?.(null);
              }
            }}
            onFocus={() => setListOpen(true)}
            className={clsx(
              'block w-full rounded-xl border bg-white py-2 pl-8 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
              error ? 'border-red-400 focus:border-red-400 focus:ring-red-500/15' : 'border-primary-100',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          />

          {showList && (
            <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-primary-100 bg-white shadow-float">
              {showInitialLoad ? (
                <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
              ) : options.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">
                  {debouncedQuery ? `No customers match “${debouncedQuery}”` : 'Type to search customers'}
                </p>
              ) : (
                <ul className="py-1">
                  {showRefreshing && (
                    <li className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-primary-600/80">
                      Updating…
                    </li>
                  )}
                  {options.map((customer) => {
                    const vatTag = customer.vatStatus === 'NON_VAT' ? 'Non-VAT' : 'VAT';
                    const active = customer.id === value;
                    return (
                      <li key={customer.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(customer)}
                          className={clsx(
                            'flex w-full flex-col px-3 py-2.5 text-left text-sm transition-colors',
                            active ? 'bg-primary-50 text-primary-900' : 'hover:bg-primary-50/80 text-slate-900'
                          )}
                        >
                          <span className="font-medium leading-snug">
                            {customer.code} — {customer.name}
                          </span>
                          <span className="text-xs text-slate-500">
                            {vatTag}
                            {!customer.salesPersonId ? ' · unassigned' : ''}
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

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
