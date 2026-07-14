import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Package, Users, ShoppingCart, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchApi } from '../../services/api';

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
    <div ref={ref} className="relative hidden md:block">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <input
        type="text"
        placeholder="Search customers, products, orders..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="pl-10 pr-4 py-2 w-72 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
      />

      {open && query.length >= 2 && (
        <div className="absolute top-full mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {allResults.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No results for &quot;{query}&quot;</p>
          ) : (
            allResults.map((item: Record<string, unknown>) => {
              const type = item.type as keyof typeof icons;
              const Icon = icons[type] || Search;
              const label = (item.name as string) || (item.label as string) || (item.sku as string);
              const sub = (item.code as string) || (item.sublabel as string) || (item.sku as string);
              return (
                <button
                  key={`${type}-${item.id}`}
                  type="button"
                  onClick={() => handleSelect(item.href as string)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                >
                  <Icon className="h-4 w-4 text-gray-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{label}</p>
                    <p className="text-xs text-gray-500 capitalize">{type} · {sub}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
