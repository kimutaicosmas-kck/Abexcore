import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
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
 * Product picker with both:
 * - a search box (name / SKU / barcode)
 * - a normal dropdown select to browse/pick results
 */
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
  const searchId = useId();
  const selectId = useId();
  const [query, setQuery] = useState('');
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
    enabled: !!value && !results.some((p) => p.id === value),
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of results) map.set(p.id, p);
    if (selectedProduct?.id) map.set(selectedProduct.id, selectedProduct);
    return Array.from(map.values());
  }, [results, selectedProduct]);

  const handleSelect = (productId: string) => {
    onChange(productId);
    if (!productId) {
      onProductSelect?.(null);
      return;
    }
    const product = options.find((p) => p.id === productId) || null;
    onProductSelect?.(product);
  };

  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          id={searchId}
          type="search"
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={clsx(
            'block w-full rounded-xl border border-primary-100 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
            disabled && 'opacity-50 cursor-not-allowed'
          )}
        />
      </div>

      <select
        id={selectId}
        disabled={disabled}
        value={value}
        onChange={(e) => handleSelect(e.target.value)}
        className={clsx(
          'block w-full rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
          error ? 'border-red-400 focus:border-red-400 focus:ring-red-500/15' : 'border-primary-100',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <option value="">{allowClear ? 'Select product...' : 'Select product...'}</option>
        {options.map((product) => (
          <option key={product.id} value={product.id}>
            {formatProductOptionLabel(product)}
          </option>
        ))}
      </select>

      <p className="text-[11px] text-slate-500">
        {isFetching
          ? 'Updating product list…'
          : debouncedQuery
            ? `${options.length} match${options.length === 1 ? '' : 'es'} — pick from the dropdown`
            : 'Search above, or open the dropdown to browse products'}
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
