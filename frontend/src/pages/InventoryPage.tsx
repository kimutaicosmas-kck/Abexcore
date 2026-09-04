import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Warehouse,
  AlertTriangle,
  Package,
  ArrowLeftRight,
  Boxes,
  TrendingDown,
  SlidersHorizontal,
  MapPin,
  Activity,
  ChevronRight,
  PackagePlus,
  FileSpreadsheet,
} from 'lucide-react';
import { inventoryApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Card,
  Button,
  Input,
  Select,
  StatCard,
  StatGrid,
  Alert,
  EmptyState,
  DataPanel,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
  TablePagination,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { RawMaterialForm } from '../components/forms/RawMaterialForm';
import { ExcelImportModal } from '../components/forms/ExcelImportModal';
import { StockAdjustForm } from '../components/forms/StockAdjustForm';
import { StockTransferForm } from '../components/forms/StockTransferForm';
import { useAuth } from '../contexts/AuthContext';
import { InventoryStats, InventoryTransaction, MaterialTypeOption, RawMaterial } from '../types';
import { formatPartNumberLine } from '../utils/productDisplay';

const tabs = ['Stock Levels', 'Materials', 'Warehouses', 'Low Stock', 'Movements'];

const TX_TYPE_FILTER = [
  { value: '', label: 'All movement types' },
  { value: 'RECEIPT', label: 'Receipts' },
  { value: 'ISSUE', label: 'Issues' },
  { value: 'TRANSFER', label: 'Transfers' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
  { value: 'PRODUCTION_CONSUMPTION', label: 'Production use' },
  { value: 'PRODUCTION_OUTPUT', label: 'Production output' },
];

const WAREHOUSE_TYPE_COLORS: Record<string, string> = {
  raw_materials: 'from-amber-500 to-orange-600',
  finished_goods: 'from-emerald-500 to-teal-600',
  RAW_MATERIAL: 'from-amber-500 to-orange-600',
  FINISHED_GOODS: 'from-emerald-500 to-teal-600',
  WIP: 'from-primary-600 to-primary-800',
  general: 'from-slate-500 to-slate-700',
  GENERAL: 'from-slate-500 to-slate-700',
};

function txTypeVariant(type: string): 'success' | 'danger' | 'warning' | 'info' {
  if (['RECEIPT', 'PRODUCTION_OUTPUT'].includes(type)) return 'success';
  if (['ISSUE', 'PRODUCTION_CONSUMPTION'].includes(type)) return 'danger';
  if (type === 'ADJUSTMENT') return 'warning';
  return 'info';
}

export function InventoryPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [stockPage, setStockPage] = useState(1);
  const [matPage, setMatPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [stockSearch, setStockSearch] = useState('');
  const [stockWarehouseId, setStockWarehouseId] = useState('');
  const [matSearch, setMatSearch] = useState('');
  const [matType, setMatType] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [txType, setTxType] = useState('');

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);

  const canCreate = hasPermission('inventory:create');
  const canUpdate = hasPermission('inventory:update');

  const { data: stats } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: () => inventoryApi.stats().then((r) => r.data.data as InventoryStats),
  });

  const { data: materialTypesData } = useQuery({
    queryKey: ['material-types'],
    queryFn: () => inventoryApi.materialTypes().then((r) => r.data.data as MaterialTypeOption[]),
    enabled: activeTab === 1,
  });

  const materialTypeOptions = [
    { value: '', label: 'All types' },
    ...(materialTypesData || []).map((t) => ({ value: t.id, label: t.name })),
  ];

  const { data: stockLevels, isLoading: stockLoading, isError: stockError, refetch: refetchStock } = useQuery({
    queryKey: ['stock-levels', stockPage, stockSearch, stockWarehouseId],
    queryFn: () =>
      inventoryApi
        .stockLevels({
          page: stockPage,
          limit: 15,
          search: stockSearch || undefined,
          warehouseId: stockWarehouseId || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: materials, isLoading: matLoading } = useQuery({
    queryKey: ['materials', matPage, matSearch, matType],
    queryFn: () =>
      inventoryApi
        .materials({ page: matPage, limit: 15, search: matSearch || undefined, type: matType || undefined })
        .then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: warehousesResponse } = useQuery({
    queryKey: ['inventory-warehouses'],
    queryFn: () =>
      inventoryApi.warehouses().then(
        (r) =>
          r.data as {
            data: {
              id: string;
              code: string;
              name: string;
              type: string;
              address?: string;
              stockLevels: { quantity?: number }[];
              materialsCount?: number;
            }[];
            meta?: { relocated?: number; materialsCount?: number };
          }
      ),
    enabled: activeTab === 0 || activeTab === 2,
  });
  const warehouseList = warehousesResponse?.data || [];
  const relocatedCount = warehousesResponse?.meta?.relocated ?? 0;

  const { data: lowStock } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => inventoryApi.lowStock().then((r) => r.data.data),
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['inventory-transactions', txPage, txSearch],
    queryFn: () =>
      inventoryApi.transactions({ page: txPage, limit: 20, search: txSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 4,
  });

  const openEditMaterial = (material: RawMaterial) => {
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  };

  const goToTab = (index: number) => {
    setActiveTab(index);
  };

  const viewWarehouseStock = (warehouseId: string) => {
    setStockWarehouseId(warehouseId);
    setStockPage(1);
    setStockSearch('');
    setActiveTab(0);
  };

  const viewWarehouseMaterials = () => {
    setMatPage(1);
    setMatSearch('');
    setActiveTab(1);
  };

  const filteredTransactions = (transactions?.data as InventoryTransaction[] | undefined)?.filter((tx) =>
    txType ? tx.type === txType : true
  );

  const stockColumns = [
    {
      key: 'item',
      label: 'Item',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row.product as { name: string; sku: string } | undefined;
        const material = row.rawMaterial as { name: string; code: string } | undefined;
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-slate-900">{product?.name || material?.name || '—'}</p>
              <p className="text-xs text-slate-500">
                {product?.sku ? formatPartNumberLine(product.sku) : material?.code || '—'}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.warehouse as { name: string; code?: string })?.name || '—',
    },
    { key: 'batchNumber', label: 'Batch', render: (v: unknown) => (v as string) || '—' },
    {
      key: 'quantity',
      label: 'On hand',
      render: (val: unknown, row: Record<string, unknown>) => {
        const qty = Number(val);
        const product = row.product as { minStockLevel?: number } | undefined;
        const material = row.rawMaterial as { minStockLevel?: number } | undefined;
        const min = Number(product?.minStockLevel ?? material?.minStockLevel ?? 0);
        const low = qty <= 0 || qty <= min;
        return (
          <span className={`font-semibold tabular-nums ${low ? 'text-red-600' : ''}`}>
            {qty.toLocaleString()}
            {low ? <span className="ml-1 text-xs font-medium">{qty <= 0 ? 'Out' : 'Low'}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'unitCost',
      label: 'Unit cost',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'lineValue',
      label: 'Value',
      render: (_: unknown, row: Record<string, unknown>) =>
        formatCurrency(Number(row.quantity) * Number(row.unitCost || 0)),
    },
  ];

  const materialColumns = [
    { key: 'code', label: 'Ref', render: (v: unknown) => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'name', label: 'Name', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    {
      key: 'type',
      label: 'Type',
      render: (_: unknown, row: Record<string, unknown>) => {
        const material = row as unknown as RawMaterial;
        return <Badge variant="info">{material.materialType?.name || 'Uncategorized'}</Badge>;
      },
    },
    {
      key: 'onHand',
      label: 'On hand',
      render: (_: unknown, row: Record<string, unknown>) => {
        const rawLevels = row.stockLevels;
        const levels = Array.isArray(rawLevels)
          ? (rawLevels as { quantity?: number; warehouse?: { code?: string } }[])
          : [];
        const total = levels.reduce((s, l) => s + Number(l.quantity || 0), 0);
        const warehouses = [
          ...new Set(
            levels
              .filter((l) => Number(l.quantity) !== 0)
              .map((l) => l.warehouse?.code)
              .filter(Boolean)
          ),
        ];
        return (
          <div>
            <span className={`font-semibold tabular-nums ${total <= 0 ? 'text-red-600' : ''}`}>
              {total.toLocaleString()}
            </span>
            {warehouses.length > 0 && (
              <p className="text-xs text-slate-500">{warehouses.join(', ')}</p>
            )}
          </div>
        );
      },
    },
    {
      key: 'weight',
      label: 'Weight (kg)',
      render: (val: unknown) =>
        val === null || val === undefined || val === '' ? (
          <span className="text-slate-400">—</span>
        ) : (
          <span className="tabular-nums">{Number(val).toLocaleString(undefined, { maximumFractionDigits: 3 })}</span>
        ),
    },
    { key: 'unit', label: 'Unit' },
    {
      key: 'unitCost',
      label: 'Unit cost',
      render: (_: unknown, row: Record<string, unknown>) => {
        const effective = Number(
          (row as { effectiveUnitCost?: number }).effectiveUnitCost ?? row.unitCost ?? 0
        );
        const catalog = Number(row.unitCost || 0);
        const onHand = Number((row as { onHandTotal?: number }).onHandTotal ?? 0);
        if (effective <= 0 && onHand > 0) {
          return <span className="text-amber-700 font-medium">Ksh 0 — set cost</span>;
        }
        return (
          <span>
            {formatCurrency(effective)}
            {catalog > 0 && effective !== catalog && (
              <span className="block text-xs text-slate-500">Catalog: {formatCurrency(catalog)}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'stockValue',
      label: 'Stock value',
      render: (_: unknown, row: Record<string, unknown>) => {
        const stockValue = Number((row as { stockValue?: number }).stockValue ?? 0);
        const onHand = Number((row as { onHandTotal?: number }).onHandTotal ?? 0);
        if (onHand > 0 && stockValue <= 0) {
          return <span className="text-amber-700 text-sm">No cost set</span>;
        }
        return (
          <span className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(stockValue)}
          </span>
        );
      },
    },
    {
      key: 'minStockLevel',
      label: 'Min level',
      render: (val: unknown) => Number(val).toLocaleString(),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) =>
        canUpdate ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              openEditMaterial(row as unknown as RawMaterial);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ];

  const txColumns = [
    {
      key: 'createdAt',
      label: 'Date',
      render: (v: unknown) => <span className="text-slate-600">{formatDate(v as string)}</span>,
    },
    {
      key: 'type',
      label: 'Type',
      render: (v: unknown) => (
        <Badge variant={txTypeVariant(v as string)}>{(v as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'item',
      label: 'Item / ref',
      render: (_: unknown, row: Record<string, unknown>) => {
        const notes = row.notes as string | undefined;
        const ref = row.referenceType as string | undefined;
        return (
          <div>
            <p className="text-sm text-slate-800">{notes?.slice(0, 36) || ref || '—'}</p>
            {ref && notes && <p className="text-xs text-slate-400">{ref}</p>}
          </div>
        );
      },
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.warehouse as { name: string })?.name || '—',
    },
    {
      key: 'quantity',
      label: 'Qty',
      render: (v: unknown, row: Record<string, unknown>) => {
        const qty = Number(v);
        const isOut = qty < 0 || ['ISSUE', 'PRODUCTION_CONSUMPTION'].includes(row.type as string);
        return (
          <span className={`font-semibold tabular-nums ${isOut ? 'text-red-600' : 'text-emerald-600'}`}>
            {isOut ? '' : '+'}{qty.toLocaleString()}
          </span>
        );
      },
    },
  ];

  const renderPagination = (
    pagination: { page: number; totalPages: number; total: number } | undefined,
    page: number,
    setPage: (fn: (p: number) => number) => void,
    label = 'records'
  ) => (
    <TablePagination pagination={pagination} page={page} onPageChange={setPage} label={label} />
  );

  const toolbarActions =
    canCreate &&
    (activeTab === 4 ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAdjustModalOpen(true)}>
          <SlidersHorizontal className="h-4 w-4 mr-1.5" />
          Adjust
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setTransferModalOpen(true)}>
          <ArrowLeftRight className="h-4 w-4 mr-1.5" />
          Transfer
        </Button>
        {activeTab === 4 && (
          <Button size="sm" onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Material
          </Button>
        )}
      </div>
    ) : activeTab === 1 ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Import Excel
        </Button>
        <Button onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" />
          Add Material
        </Button>
      </div>
    ) : undefined);

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard
            title="Raw material value"
            value={formatCurrency(stats.rawMaterialValue ?? stats.inventoryValue)}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-amber-500 to-orange-600"
            onClick={() => goToTab(1)}
          />
          <StatCard
            title="Materials in stock"
            value={stats.rawMaterialsInStock ?? stats.materialsCount}
            icon={<Boxes className="h-5 w-5 text-white" />}
            color="from-violet-500 to-violet-700"
            onClick={() => goToTab(1)}
          />
          <StatCard
            title="Total inventory value"
            value={formatCurrency(stats.inventoryValue)}
            icon={<Boxes className="h-5 w-5 text-white" />}
            color="from-cyan-500 to-cyan-700"
            onClick={() => goToTab(0)}
            className="hidden sm:flex"
          />
          <StatCard
            title="Low stock"
            value={stats.lowStockCount}
            icon={<TrendingDown className="h-5 w-5 text-white" />}
            color="from-orange-500 to-orange-700"
            onClick={() => goToTab(3)}
          />
        </StatGrid>
      )}

      <Alert variant="info">
        <strong>Material cost &amp; stock:</strong> the <strong>Materials</strong> tab shows on-hand quantity,
        unit cost, and stock value. If unit cost shows <strong>Ksh 0 — set cost</strong>, edit the material or
        receive stock via <strong>Procurement → Goods Receipt</strong> with a unit price. The top{' '}
        <strong>Inventory value</strong> includes finished goods too — open <strong>Stock Levels</strong> and filter
        WH-RM for raw materials only.
      </Alert>

      <PageHeader
        action={
          stats && stats.lowStockCount > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(3)}>
              <AlertTriangle className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.lowStockCount} low stock
            </Button>
          ) : undefined
        }
      />

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {/* Stock levels */}
      {activeTab === 0 && (
        <DataPanel>
          <div className="panel-filters mb-4">
            <Input
              placeholder="Search by item, warehouse, batch…"
              value={stockSearch}
              onChange={(e) => { setStockSearch(e.target.value); setStockPage(1); }}
              className="sm:max-w-md"
            />
            <Select
              options={[
                { value: '', label: 'All warehouses' },
                ...warehouseList.map((wh) => ({
                  value: wh.id,
                  label: `${wh.code} · ${wh.name}`,
                })),
              ]}
              value={stockWarehouseId}
              onChange={(e) => { setStockWarehouseId(e.target.value); setStockPage(1); }}
              className="sm:w-64"
            />
          </div>
          {stockWarehouseId && (
            <Alert variant="info" className="mb-4">
              {warehouseList.find((w) => w.id === stockWarehouseId)?.type === 'raw_materials'
                ? 'Showing raw materials for this warehouse (on-hand qty may be 0 until you receive or adjust stock). '
                : 'Showing stock for one warehouse. '}
              <button
                type="button"
                className="underline font-medium"
                onClick={() => { setStockWarehouseId(''); setStockPage(1); }}
              >
                Clear filter
              </button>
            </Alert>
          )}
          {stockError && (
            <Alert variant="error" className="mb-4">
              Failed to load stock.{' '}
              <button type="button" className="underline font-medium" onClick={() => refetchStock()}>
                Retry
              </button>
            </Alert>
          )}
          {(stockLevels?.data?.length || 0) === 0 && !stockLoading ? (
            <EmptyState
              title="No stock records"
              description={
                stockWarehouseId
                  ? warehouseList.find((w) => w.id === stockWarehouseId)?.type === 'raw_materials'
                    ? 'No raw materials in the catalog yet. Add them under Materials, then receive or adjust stock into WH-RM.'
                    : 'This warehouse has no on-hand stock lines yet.'
                  : 'Try a different search or receive goods via Procurement.'
              }
            />
          ) : (
            <Table columns={stockColumns} data={stockLevels?.data || []} loading={stockLoading} embedded />
          )}
          {renderPagination(stockLevels?.pagination, stockPage, setStockPage)}
        </DataPanel>
      )}

      {/* Materials */}
      {activeTab === 1 && (
        <DataPanel>
          <div className="panel-filters mb-4">
            <Input
              placeholder="Search materials…"
              className="sm:max-w-md"
              value={matSearch}
              onChange={(e) => { setMatSearch(e.target.value); setMatPage(1); }}
            />
            <Select
              options={materialTypeOptions}
              value={matType}
              onChange={(e) => { setMatType(e.target.value); setMatPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(materials?.data?.length || 0) === 0 && !matLoading ? (
            <EmptyState
              title="No materials found"
              description="Add raw materials and define types that match how your company works."
              action={
                canCreate ? (
                  <Button onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add material
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table
              columns={materialColumns}
              data={materials?.data || []}
              loading={matLoading}
              onRowClick={(row) => openEditMaterial(row as unknown as RawMaterial)}
              embedded
              responsive
              mobileSummaryCount={5}
            />
          )}
          {renderPagination(materials?.pagination, matPage, setMatPage)}
        </DataPanel>
      )}

      {/* Warehouses */}
      {activeTab === 2 && (
        <>
          {relocatedCount > 0 && (
            <Alert variant="success" className="mb-4">
              Moved {relocatedCount} raw material stock line(s) into the Raw Materials warehouse.
            </Alert>
          )}
          {(warehouseList.length || 0) === 0 ? (
            <EmptyState title="No warehouses configured" description="Warehouses are set up during system seeding or in Settings." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {warehouseList.map((wh) => {
                  const gradient = WAREHOUSE_TYPE_COLORS[wh.type] || WAREHOUSE_TYPE_COLORS.GENERAL;
                  const isRaw = wh.type === 'raw_materials';
                  const stockLines = (Array.isArray(wh.stockLevels) ? wh.stockLevels : []).filter(
                    (l) => Number(l.quantity) !== 0
                  ).length;
                  const itemCount = isRaw ? (wh.materialsCount ?? stockLines) : stockLines;
                  const countLabel = isRaw ? 'materials' : 'stock lines';
                  return (
                    <div
                      key={wh.id}
                      className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                    >
                      <div className={`h-1.5 bg-gradient-to-r ${gradient}`} />
                      <div className="p-5">
                        <div className="flex items-start justify-between gap-3 mb-4">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} text-white shadow-sm`}>
                            <Warehouse className="h-6 w-6" />
                          </div>
                          <Badge variant="info">{wh.type.replace(/_/g, ' ')}</Badge>
                        </div>
                        <h3 className="text-lg font-bold text-slate-900">{wh.name}</h3>
                        <p className="text-sm font-mono text-slate-500 mt-0.5">{wh.code}</p>
                        {wh.address && (
                          <p className="flex items-start gap-1.5 text-xs text-slate-500 mt-3">
                            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            {wh.address}
                          </p>
                        )}
                        {isRaw && (
                          <p className="text-xs text-slate-500 mt-3">
                            {stockLines} stock line{stockLines === 1 ? '' : 's'} with quantity on hand
                          </p>
                        )}
                        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-2xl font-bold text-slate-900 tabular-nums">{itemCount}</p>
                            <p className="text-xs text-slate-500">{countLabel}</p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2">
                            {isRaw && (
                              <Button variant="secondary" size="sm" onClick={() => viewWarehouseMaterials()}>
                                View materials
                              </Button>
                            )}
                            <Button variant="secondary" size="sm" onClick={() => viewWarehouseStock(wh.id)}>
                              View stock
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {/* Low stock */}
      {activeTab === 3 && (
        <>
          {(lowStock?.length || 0) === 0 ? (
            <EmptyState
              title="Inventory levels are healthy"
              description="No items are at zero stock or at/below their minimum stock level."
            />
          ) : (
            <div className="space-y-3">
              <Alert variant="warning">
                <strong>{lowStock.length}</strong> item(s) at or below minimum
              </Alert>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(
                  lowStock as {
                    id: string;
                    name: string;
                    code: string;
                    unit: string;
                    itemType?: 'RAW_MATERIAL' | 'PRODUCT';
                    minStockLevel: number;
                    currentStock?: number;
                    stockLevels?: { quantity: number }[];
                    materialType?: { name: string } | null;
                    category?: { name: string } | null;
                  }[]
                ).map((item) => {
                  const onHand =
                    item.currentStock ??
                    item.stockLevels?.reduce((s, l) => s + Number(l.quantity), 0) ??
                    0;
                  const min = Number(item.minStockLevel);
                  const pct = min > 0 ? Math.min(100, Math.round((onHand / min) * 100)) : onHand <= 0 ? 0 : 100;
                  const kind = item.itemType === 'PRODUCT' ? 'Product' : 'Material';
                  const subtype =
                    item.itemType === 'PRODUCT'
                      ? item.category?.name || 'Finished good'
                      : item.materialType?.name || 'Uncategorized';
                  return (
                    <div
                      key={`${item.itemType || 'RAW_MATERIAL'}-${item.id}`}
                      className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50/80 to-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.code} · {kind} · {subtype}
                          </p>
                        </div>
                        <Badge variant="danger">{onHand <= 0 ? 'Out' : 'Low'}</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-red-100">
                          <p className="text-lg font-bold text-red-600 tabular-nums">{onHand.toLocaleString()}</p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">On hand</p>
                        </div>
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-slate-100">
                          <p className="text-lg font-bold text-slate-700 tabular-nums">{min.toLocaleString()}</p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Minimum</p>
                        </div>
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-slate-100">
                          <p className="text-lg font-bold text-slate-700">{item.unit}</p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Unit</p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Stock vs minimum</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-red-500 to-amber-400 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      {canCreate && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="mt-4 w-full"
                          onClick={() => setAdjustModalOpen(true)}
                        >
                          Adjust stock
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Movements */}
      {activeTab === 4 && (
        <DataPanel>
          <div className="panel-filters mb-4">
            <Input
              placeholder="Search movements…"
              value={txSearch}
              onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }}
              className="sm:max-w-md"
            />
            <Select
              options={TX_TYPE_FILTER}
              value={txType}
              onChange={(e) => setTxType(e.target.value)}
              className="sm:w-52"
            />
          </div>
          {(filteredTransactions?.length || 0) === 0 && !txLoading ? (
            <EmptyState
              title="No movements found"
              description="Inventory receipts, transfers, and adjustments will appear in this ledger."
              action={
                canCreate ? (
                  <Button variant="secondary" onClick={() => setAdjustModalOpen(true)}>
                    Record adjustment
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table columns={txColumns} data={filteredTransactions || []} loading={txLoading} embedded />
          )}
          {renderPagination(transactions?.pagination, txPage, setTxPage)}
        </DataPanel>
      )}

      <Modal
        open={materialModalOpen}
        onClose={() => { setMaterialModalOpen(false); setEditingMaterial(null); }}
        title={editingMaterial ? 'Edit Raw Material' : 'Add Raw Material'}
        size="lg"
      >
        <RawMaterialForm
          material={editingMaterial}
          onSuccess={() => { setMaterialModalOpen(false); setEditingMaterial(null); }}
          onCancel={() => { setMaterialModalOpen(false); setEditingMaterial(null); }}
        />
      </Modal>

      <ExcelImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        entity="materials"
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['materials'] });
          queryClient.invalidateQueries({ queryKey: ['material-types'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
          queryClient.invalidateQueries({ queryKey: ['inventory-warehouses'] });
          queryClient.invalidateQueries({ queryKey: ['warehouses'] });
          queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
          queryClient.invalidateQueries({ queryKey: ['low-stock'] });
        }}
      />

      <Modal open={adjustModalOpen} onClose={() => setAdjustModalOpen(false)} title="Stock Adjustment" size="lg">
        <StockAdjustForm onSuccess={() => setAdjustModalOpen(false)} onCancel={() => setAdjustModalOpen(false)} />
      </Modal>

      <Modal open={transferModalOpen} onClose={() => setTransferModalOpen(false)} title="Stock Transfer" size="lg">
        <StockTransferForm onSuccess={() => setTransferModalOpen(false)} onCancel={() => setTransferModalOpen(false)} />
      </Modal>
    </div>
  );
}
