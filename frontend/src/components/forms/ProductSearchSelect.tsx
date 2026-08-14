import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Search, X } from 'lucide-react';
import clsx from 'clsx';
import { productsApi } from '../../services/api';
import { Product } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';

function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface ProductSearchSelectProps {
  label?: string;
  value?: string;
  onChange: (productId: string) => void;
  /** Fired when a product is chosen (useful for auto-filling price). */
  onProductSelect?: (product: Product | null) => void;
  error?: string;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Product picker: type to search; matching products appear in a list below
 * (no need to open a separate dropdown).
 */
export function ProductSearchSelect({
  label,
  value = '',
  onChange,
  onProductSelect,
  error,
  placeholder = 'Search product…',
  allowClear = true,
  disabled = false,
  className,
}: ProductSearchSelectProps) {
  const searchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['products', 'search-picker', debouncedQuery],
    queryFn: () =>
      productsApi
        .list({
          page: 1,
          limit: 100,
          isActive: true,
          search: debouncedQuery || undefined,
        })
        .then((r) => r.data.data as Product[]),
    staleTime: 30_000,
  });

  const { data: selectedProduct } = useQuery({
    queryKey: ['products', 'selected', value],
    queryFn: () => productsApi.get(value).then((r) => r.data.data as Product),
    enabled: !!value,
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of results) map.set(p.id, p);
    if (selectedProduct?.id && !debouncedQuery) map.set(selectedProduct.id, selectedProduct);
    return Array.from(map.values());
  }, [results, selectedProduct, debouncedQuery]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (product: Product) => {
    onChange(product.id);
    onProductSelect?.(product);
    setQuery('');
    setListOpen(false);
  };

  const handleClear = () => {
    onChange('');
    onProductSelect?.(null);
    setQuery('');
    setListOpen(true);
  };

  const showList = listOpen && !disabled;
  const selectedLabel = selectedProduct ? formatProductOptionLabel(selectedProduct) : '';

  return (
    <div ref={rootRef} className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={searchId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}

      {value && selectedProduct && !listOpen ? (
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
            title="Change product"
          >
            {selectedLabel}
          </button>
          {allowClear && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Clear product"
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
              {isFetching && options.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">Searching…</p>
              ) : options.length === 0 ? (
                <p className="px-3 py-3 text-sm text-slate-500">
                  {debouncedQuery ? `No products match “${debouncedQuery}”` : 'No products found'}
                </p>
              ) : (
                <ul className="py-1">
                  {options.map((product) => {
                    const active = product.id === value;
                    return (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => handleSelect(product)}
                          className={clsx(
                            'flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm transition-colors',
                            active ? 'bg-primary-50 text-primary-900' : 'hover:bg-primary-50/80 text-slate-900'
                          )}
                        >
                          {active && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary-600" />}
                          <span className={clsx('min-w-0 flex-1', !active && 'pl-5')}>
                            <span className="block font-medium leading-snug">
                              {formatProductOptionLabel(product)}
                            </span>
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
