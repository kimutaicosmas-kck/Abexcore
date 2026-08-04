import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Search, X } from 'lucide-react';
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

export function ProductSearchSelect({
  label,
  value = '',
  onChange,
  onProductSelect,
  error,
  placeholder = 'Search by name or SKU…',
  allowClear = true,
  disabled = false,
  className,
}: ProductSearchSelectProps) {
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['products', 'search-picker', debouncedQuery],
    queryFn: () =>
      productsApi
        .list({
          page: 1,
          limit: 40,
          isActive: true,
          search: debouncedQuery || undefined,
        })
        .then((r) => r.data.data as Product[]),
    enabled: open,
    staleTime: 30_000,
  });

  const { data: selectedProduct } = useQuery({
    queryKey: ['products', 'selected', value],
    queryFn: () => productsApi.get(value).then((r) => r.data.data as Product),
    enabled: !!value && !selectedLabel,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (selectedProduct?.id === value) {
      setSelectedLabel(formatProductOptionLabel(selectedProduct));
    }
  }, [selectedProduct, value]);

  useEffect(() => {
    if (!value) setSelectedLabel('');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const displayValue = open ? query : selectedLabel || (value ? 'Selected product' : '');

  const pick = (product: Product) => {
    onChange(product.id);
    onProductSelect?.(product);
    setSelectedLabel(formatProductOptionLabel(product));
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    onProductSelect?.(null);
    setSelectedLabel('');
    setQuery('');
  };

  return (
    <div ref={rootRef} className={clsx('relative space-y-1.5', className)}>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          type="text"
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => {
            setOpen(true);
            setQuery('');
          }}
          onChange={(e) => {
            setOpen(true);
            setQuery(e.target.value);
          }}
          className={clsx(
            'block w-full rounded-xl border bg-white py-2 pl-8 pr-16 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
            error ? 'border-red-400 focus:border-red-400 focus:ring-red-500/15' : 'border-primary-100',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {allowClear && value && !disabled && (
            <button
              type="button"
              aria-label="Clear product"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              onClick={clear}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Toggle product list"
            disabled={disabled}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {isFetching && (
            <p className="px-3 py-2 text-xs text-slate-500">Searching…</p>
          )}
          {!isFetching && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-500">
              {debouncedQuery ? 'No products match that search.' : 'Type to search products…'}
            </p>
          )}
          {results.map((product) => (
            <button
              key={product.id}
              type="button"
              className={clsx(
                'flex w-full flex-col items-start px-3 py-2 text-left hover:bg-primary-50',
                product.id === value && 'bg-primary-50'
              )}
              onClick={() => pick(product)}
            >
              <span className="text-sm font-medium text-slate-900">{product.name}</span>
              <span className="text-[11px] text-slate-500">
                {product.sku}
                {product.barcode ? ` · ${product.barcode}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
