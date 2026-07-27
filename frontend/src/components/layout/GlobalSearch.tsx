import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, Users, ShoppingCart, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchApi } from '../../services/api';
import { formatPartNumberLine } from '../../utils/productDisplay';

const icons = {
  customer: Users,
  product: Package,
  order: ShoppingCart,
  supplier: Truck,
};

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data: results } = useQuery({
    queryKey: ['search', query],
    queryFn: () => searchApi.search(query).then((r) => r.data.data),
    enabled: query.length >= 2,
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const allResults = results
    ? [
        ...(results.customers || []),
        ...(results.products || []),
        ...(results.orders || []),
        ...(results.suppliers || []),
      ]
    : [];

  const handleSelect = (href: string) => {
    setOpen(false);
    setQuery('');
    navigate(href);
  };

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        type="text"
        placeholder="Search customers, products, orders..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="w-full pl-10 pr-3 py-2 rounded-xl border border-primary-100 bg-white text-sm text-primary-950 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all shadow-sm"
      />

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-2 w-full max-w-[calc(100vw-2rem)] bg-white border border-primary-100 rounded-2xl shadow-float z-50 max-h-80 overflow-hidden">
          {allResults.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-500">No results for &quot;{query}&quot;</p>
          ) : (
            <div className="py-1 max-h-80 overflow-y-auto">
              {allResults.map((item: Record<string, unknown>) => {
                const type = item.type as keyof typeof icons;
                const Icon = icons[type] || Search;
                const label = (item.name as string) || (item.label as string) || (item.sku as string);
                const sub =
                  type === 'product' && item.sku
                    ? formatPartNumberLine(item.sku as string)
                    : (item.code as string) || (item.sublabel as string) || (item.sku as string);
                return (
                  <button
                    key={`${type}-${item.id}`}
                    type="button"
                    onClick={() => handleSelect(item.href as string)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-primary-50/80 text-left transition-colors"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50 text-primary-600 shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{label}</p>
                      <p className="text-xs text-slate-500 capitalize">{type} · {sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
