import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Package, AlertTriangle, Boxes } from 'lucide-react';
import { reportsApi } from '../../services/api';
import {
  Alert,
  Badge,
  Button,
  DataPanel,
  Input,
  Select,
  StatCard,
  StatGrid,
  Table,
  TablePagination,
  EmptyState,
  QueryErrorAlert,
} from '../ui';
import { ProductsSoldReport } from '../../types';
import { downloadFile } from '../../utils/download';
import { formatPartNumberLine } from '../../utils/productDisplay';

function localDateInput(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function ProductsSoldPanel({ toolbar }: { toolbar?: ReactNode }) {
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState(startOfMonthInput);
  const [endDate, setEndDate] = useState(() => localDateInput());
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [needsRestockOnly, setNeedsRestockOnly] = useState(false);
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(
    () => ({
      page,
      limit: 25,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      search: search || undefined,
      needsRestockOnly: needsRestockOnly || undefined,
    }),
    [page, startDate, endDate, search, needsRestockOnly]
  );

  const { data: report, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products-sold-report', queryParams],
    queryFn: () =>
      reportsApi.productsSold(queryParams).then((r) => r.data.data as ProductsSoldReport),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/finance/reports/products-sold/excel', 'products-sold-statement.xlsx', {
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        search: search || undefined,
        needsRestockOnly: needsRestockOnly ? 'true' : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    {
      key: 'sku',
      label: 'Product',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium text-slate-900">{row.name as string}</p>
          <p className="text-xs text-slate-500">{formatPartNumberLine(row.sku as string)}</p>
        </div>
      ),
    },
    { key: 'category', label: 'Category' },
    {
      key: 'qtySold',
      label: 'Qty sold',
      render: (val: unknown) => <span className="font-semibold tabular-nums">{val as number}</span>,
    },
    {
      key: 'availableQty',
      label: 'Available',
      render: (val: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="tabular-nums font-medium">{val as number}</p>
          <p className="text-xs text-slate-500">
            On hand {row.onHand as number} · Reserved {row.reservedQty as number}
          </p>
        </div>
      ),
    },
    {
      key: 'minStockLevel',
      label: 'Min',
      render: (val: unknown) => <span className="tabular-nums">{val as number}</span>,
    },
    {
      key: 'needsRestock',
      label: 'Restock',
      render: (val: unknown, row: Record<string, unknown>) =>
        val ? (
          <div>
            <Badge variant="warning">Restock</Badge>
            <p className="mt-1 text-xs text-amber-800">
              Suggest {(row.suggestedRestockQty as number) || 0} units
            </p>
          </div>
        ) : (
          <Badge variant="success">OK</Badge>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      {toolbar}

      {report && (
        <StatGrid>
          <StatCard
            title="Products sold"
            value={report.summary.productCount}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-teal-500 to-teal-700"
            to="/products"
          />
          <StatCard
            title="Total qty sold"
            value={report.summary.totalQtySold}
            icon={<Boxes className="h-5 w-5 text-white" />}
            color="from-indigo-500 to-indigo-700"
            to="/sales"
          />
          <StatCard
            title="Need restock"
            value={report.summary.needsRestockCount}
            icon={<AlertTriangle className="h-5 w-5 text-white" />}
            color="from-orange-500 to-orange-700"
            to="/inventory"
          />
        </StatGrid>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-primary-100 bg-white p-3">
        <Input
          label="From"
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            setPage(1);
          }}
        />
        <Input
          label="To"
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            setPage(1);
          }}
        />
        <div className="min-w-[180px] flex-1">
          <Input
            label="Product search"
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
          label="Restock filter"
          value={needsRestockOnly ? 'yes' : ''}
          onChange={(e) => {
            setNeedsRestockOnly(e.target.value === 'yes');
            setPage(1);
          }}
          options={[
            { value: '', label: 'All products sold' },
            { value: 'yes', label: 'Needs restock only' },
          ]}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          Apply
        </Button>
        <Button size="sm" loading={exporting} onClick={handleExport}>
          <Download className="h-4 w-4 mr-1.5" />
          Excel
        </Button>
      </div>

      <Alert variant="info">
        Qty sold is based on deliveries in the selected period (excluding failed/returned). Use this
        with available stock and min levels to plan restocking.
      </Alert>

      {isError && <QueryErrorAlert error={error} onRetry={() => refetch()} />}

      <DataPanel>
        {(report?.rows.length || 0) === 0 && !isLoading ? (
          <EmptyState
            title="No products sold in this period"
            description="Widen the date range or clear the product search."
          />
        ) : (
          <Table
            columns={columns}
            data={(report?.rows as unknown as Record<string, unknown>[]) || []}
            loading={isLoading}
            embedded
          />
        )}
        <TablePagination
          pagination={report?.pagination}
          page={page}
          onPageChange={setPage}
          label="products"
        />
      </DataPanel>
    </div>
  );
}
