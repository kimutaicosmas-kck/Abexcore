import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Search } from 'lucide-react';
import { productsApi } from '../services/api';
import {
  Table,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  QueryErrorAlert,
  FilterBar,
  FilterField,
} from '../components/ui';
import { ProductCategoryOption } from '../types';
import { formatPartNumberLine } from '../utils/productDisplay';
import { downloadFile } from '../utils/download';

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

/** Sellable finished-goods list — used as a tab inside Products. */
export function AvailableProductsPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');

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

  const rows = (data?.data as AvailableProduct[]) || [];
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

  const downloadCatalogue = async (format: 'excel' | 'pdf') => {
    setExporting(format);
    try {
      const params = {
        search: search || undefined,
        category: category || undefined,
        inStockOnly: 'true',
      };
      if (format === 'excel') {
        await downloadFile(productsApi.catalogueExcelPath, 'product-catalogue.xlsx', params);
      } else {
        await downloadFile(productsApi.cataloguePdfPath, 'product-catalogue.pdf', params);
      }
    } finally {
      setExporting(null);
    }
  };

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
            <Badge variant="success">{qty} available</Badge>
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
      {isError && <QueryErrorAlert error={error} onRetry={() => refetch()} />}

      <DataPanel>
        <FilterBar>
          <FilterField span="full">
            <Input
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
          </FilterField>
          <FilterField>
            <Select
              aria-label="Category"
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
          </FilterField>
          <FilterField>
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
          </FilterField>
          <FilterField>
            <Button
              size="sm"
              variant="secondary"
              loading={exporting === 'excel'}
              disabled={!!exporting}
              onClick={() => downloadCatalogue('excel')}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              Excel
            </Button>
          </FilterField>
          <FilterField>
            <Button
              size="sm"
              variant="secondary"
              loading={exporting === 'pdf'}
              disabled={!!exporting}
              onClick={() => downloadCatalogue('pdf')}
            >
              <Download className="h-4 w-4 mr-1.5" />
              PDF
            </Button>
          </FilterField>
        </FilterBar>

        {rows.length === 0 && !isLoading ? (
          <EmptyState
            title="No products in stock"
            description="Only products with quantity greater than zero in finished-goods stores are listed here. Min stock is an alert only — you can still sell down to zero."
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

/** @deprecated Prefer Products module Available tab — kept for redirect compatibility. */
export function AvailableProductsPage() {
  return <AvailableProductsPanel />;
}
