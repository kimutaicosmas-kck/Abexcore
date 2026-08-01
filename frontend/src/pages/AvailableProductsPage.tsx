import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { productsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  PageToolbar,
  QueryErrorAlert,
} from '../components/ui';
import { ProductCategoryOption } from '../types';
import { formatPartNumberLine } from '../utils/productDisplay';

export interface AvailableProduct {
  id: string;
  sku: string;
  name: string;
  description?: string;
  sellingPrice: number;
  distributorPrice: number;
  retailPrice: number;
  minStockLevel: number;
  availableQty: number;
  onHand: number;
  reservedQty: number;
  inStock: boolean;
  category?: { id: string; name: string };
}

export function AvailableProductsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');
  const [stockFilter, setStockFilter] = useState('');

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data.data as ProductCategoryOption[]),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['available-products', page, search, category],
    queryFn: () =>
      productsApi
        .available({
          page,
          limit: 20,
          search: search || undefined,
          category: category || undefined,
        })
        .then((r) => r.data),
  });

  const rows = ((data?.data as AvailableProduct[]) || []).filter((p) => {
    if (stockFilter === 'in') return p.inStock;
    if (stockFilter === 'out') return !p.inStock;
    return true;
  });

  const columns = [
    {
      key: 'sku',
      label: 'Product',
      render: (_: unknown, row: Record<string, unknown>) => {
        const p = row as unknown as AvailableProduct;
        return (
          <div>
            <p className="font-medium text-slate-900">{p.name}</p>
            <p className="text-xs text-slate-500">{formatPartNumberLine(p.sku)}</p>
          </div>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row as unknown as AvailableProduct).category?.name || '—',
    },
    {
      key: 'availableQty',
      label: 'Available',
      render: (val: unknown, row: Record<string, unknown>) => {
        const p = row as unknown as AvailableProduct;
        const qty = Number(val);
        return (
          <div>
            <Badge variant={qty > 0 ? 'success' : 'danger'}>{qty} available</Badge>
            <p className="mt-1 text-xs text-slate-500">
              On hand {p.onHand} · Reserved {p.reservedQty}
            </p>
          </div>
        );
      },
    },
    {
      key: 'sellingPrice',
      label: 'Selling price',
      render: (val: unknown) => formatCurrency(Number(val)),
    },
    {
      key: 'retailPrice',
      label: 'Retail',
      render: (val: unknown) => formatCurrency(Number(val)),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader subtitle="Active catalog with finished-goods stock you can sell." />

      {isError && <QueryErrorAlert error={error} onRetry={() => refetch()} />}

      <PageToolbar
        actions={
          <div className="flex flex-wrap items-end gap-3 w-full">
            <div className="min-w-[180px] flex-1">
              <Input
                label="Search"
                placeholder="Name or part number…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearch(searchInput.trim());
                    setPage(1);
                  }
                }}
              />
            </div>
            <Select
              label="Category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All categories' },
                ...(categoriesData || []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              label="Stock"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              options={[
                { value: '', label: 'All' },
                { value: 'in', label: 'In stock' },
                { value: 'out', label: 'Out of stock' },
              ]}
            />
            <Button
              size="sm"
              onClick={() => {
                setSearch(searchInput.trim());
                setPage(1);
              }}
            >
              <Search className="h-4 w-4 mr-1.5" />
              Search
            </Button>
          </div>
        }
      />

      <DataPanel>
        {rows.length === 0 && !isLoading ? (
          <EmptyState
            title="No products found"
            description="Try another search, or check with warehouse if stock looks empty."
          />
        ) : (
          <Table columns={columns} data={rows} loading={isLoading} embedded />
        )}
        <TablePagination
          pagination={data?.pagination}
          page={page}
          onPageChange={setPage}
          label="products"
        />
      </DataPanel>
    </div>
  );
}
