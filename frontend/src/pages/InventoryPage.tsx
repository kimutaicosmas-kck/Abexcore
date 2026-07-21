import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { StockAdjustForm } from '../components/forms/StockAdjustForm';
import { StockTransferForm } from '../components/forms/StockTransferForm';
import { useAuth } from '../contexts/AuthContext';
import { OverviewHint } from '../components/layout/ModuleOverview';
import { InventoryStats, InventoryTransaction, RawMaterial } from '../types';
import { formatPartNumberLine } from '../utils/productDisplay';

const tabs = ['Overview', 'Stock Levels', 'Materials', 'Warehouses', 'Low Stock', 'Movements'];

const MATERIAL_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'STEEL', label: 'Steel' },
  { value: 'FILTER_PAPER', label: 'Filter Paper' },
  { value: 'RUBBER', label: 'Rubber' },
  { value: 'ADHESIVE', label: 'Adhesive' },
  { value: 'OTHER', label: 'Other' },
];

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
  RAW_MATERIAL: 'from-amber-500 to-orange-600',
  FINISHED_GOODS: 'from-emerald-500 to-teal-600',
  WIP: 'from-violet-500 to-purple-600',
  GENERAL: 'from-slate-500 to-slate-700',
};

function txTypeVariant(type: string): 'success' | 'danger' | 'warning' | 'info' {
  if (['RECEIPT', 'PRODUCTION_OUTPUT'].includes(type)) return 'success';
  if (['ISSUE', 'PRODUCTION_CONSUMPTION'].includes(type)) return 'danger';
  if (type === 'ADJUSTMENT') return 'warning';
  return 'info';
}

export function InventoryPage() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [stockPage, setStockPage] = useState(1);
  const [matPage, setMatPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [stockSearch, setStockSearch] = useState('');
  const [matSearch, setMatSearch] = useState('');
  const [matType, setMatType] = useState('');
  const [txSearch, setTxSearch] = useState('');
  const [txType, setTxType] = useState('');

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);

  const canCreate = hasPermission('inventory:create');
  const canUpdate = hasPermission('inventory:update');

  const { data: stats } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: () => inventoryApi.stats().then((r) => r.data.data as InventoryStats),
  });

  const { data: stockLevels, isLoading: stockLoading, isError: stockError, refetch: refetchStock } = useQuery({
    queryKey: ['stock-levels', stockPage, stockSearch],
    queryFn: () =>
      inventoryApi.stockLevels({ page: stockPage, limit: 15, search: stockSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const { data: materials, isLoading: matLoading } = useQuery({
    queryKey: ['materials', matPage, matSearch, matType],
    queryFn: () =>
      inventoryApi
        .materials({ page: matPage, limit: 15, search: matSearch || undefined, type: matType || undefined })
        .then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data),
    enabled: activeTab === 0 || activeTab === 3,
  });

  const { data: lowStock } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => inventoryApi.lowStock().then((r) => r.data.data),
    enabled: activeTab === 0 || activeTab === 4,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['inventory-transactions', txPage, txSearch],
    queryFn: () =>
      inventoryApi.transactions({ page: txPage, limit: 20, search: txSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 5,
  });

  const openEditMaterial = (material: RawMaterial) => {
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  };

  const goToTab = (index: number) => {
    setActiveTab(index);
  };

  const filteredTransactions = (transactions?.data as InventoryTransaction[] | undefined)?.filter((tx) =>
    txType ? tx.type === txType : true
  );

  const recentStock = activeTab === 0 ? (stockLevels?.data || []).slice(0, 6) : [];
  const recentTx = activeTab === 0 ? (transactions?.data as InventoryTransaction[] | undefined)?.slice(0, 6) || [] : [];

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
      render: (val: unknown) => (
        <span className="font-semibold tabular-nums">{Number(val).toLocaleString()}</span>
      ),
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
    { key: 'code', label: 'Code', render: (v: unknown) => <span className="font-mono text-xs">{v as string}</span> },
    { key: 'name', label: 'Name', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>,
    },
    { key: 'unit', label: 'Unit' },
    {
      key: 'unitCost',
      label: 'Unit cost',
      render: (val: unknown) => formatCurrency(val as number),
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
    (activeTab === 0 || activeTab === 5 ? (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAdjustModalOpen(true)}>
          <SlidersHorizontal className="h-4 w-4 mr-1.5" />
          Adjust
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setTransferModalOpen(true)}>
          <ArrowLeftRight className="h-4 w-4 mr-1.5" />
          Transfer
        </Button>
        {activeTab === 0 && (
          <Button size="sm" onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
            <Plus className="h-4 w-4 mr-1.5" />
            Material
          </Button>
        )}
      </div>
    ) : activeTab === 2 ? (
      <Button onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
        <Plus className="h-4 w-4 mr-2" />
        Add Material
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        title="Inventory"
        subtitle="Monitor stock health, warehouses, materials, and every inventory movement"
        action={
          stats && stats.lowStockCount > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(4)}>
              <AlertTriangle className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.lowStockCount} low stock
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <StatGrid>
          <StatCard
            title="Inventory value"
            value={formatCurrency(stats.inventoryValue)}
            icon={<Boxes className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-teal-600"
          />
          <StatCard
            title="Raw materials"
            value={stats.materialsCount}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-primary-500 to-indigo-600"
          />
          <StatCard
            title="Warehouses"
            value={stats.warehouses}
            icon={<Warehouse className="h-5 w-5 text-white" />}
            color="from-slate-600 to-slate-800"
          />
          <StatCard
            title="Low stock"
            value={stats.lowStockCount}
            icon={<TrendingDown className="h-5 w-5 text-white" />}
            color="from-red-500 to-rose-600"
          />
          <StatCard
            title="Movements today"
            value={stats.transfersToday}
            icon={<Activity className="h-5 w-5 text-white" />}
            color="from-violet-500 to-purple-600"
          />
        </StatGrid>
      )}

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {/* Overview */}
      {activeTab === 0 && (
        <div className="space-y-4">
          <OverviewHint>Use the tabs above to manage records. Summary counts are shown at the top.</OverviewHint>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Low stock alerts"
              action={
                (lowStock?.length || 0) > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => goToTab(4)}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {(lowStock?.length || 0) === 0 ? (
                <div className="p-6">
                  <EmptyState title="All materials above minimum" description="No replenishment needed right now." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(lowStock as RawMaterial[]).slice(0, 5).map((item) => {
                    const onHand = item.stockLevels?.reduce((s, l) => s + Number(l.quantity), 0) ?? 0;
                    const min = Number(item.minStockLevel);
                    const deficit = Math.max(0, min - onHand);
                    return (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/30">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600">
                          <AlertTriangle className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-900 truncate">{item.name}</p>
                          <p className="text-xs text-slate-500">{item.code} · min {min.toLocaleString()} {item.unit}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold text-red-600 tabular-nums">{onHand.toLocaleString()}</p>
                          <p className="text-xs text-red-500">−{deficit.toLocaleString()} short</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card
              title="Recent movements"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(5)}>
                  Full ledger
                </Button>
              }
              padding={false}
            >
              {recentTx.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No movements yet" description="Receipts, transfers, and adjustments appear here." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentTx.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant={txTypeVariant(tx.type)}>{tx.type.replace(/_/g, ' ')}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">{tx.notes || tx.referenceType || 'Movement'}</p>
                        <p className="text-xs text-slate-400">{formatDate(tx.createdAt)}</p>
                      </div>
                      <span
                        className={`text-sm font-semibold tabular-nums ${
                          Number(tx.quantity) < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {Number(tx.quantity).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Stock levels */}
      {activeTab === 1 && (
        <DataPanel>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Input
              placeholder="Search by item, warehouse, batch…"
              value={stockSearch}
              onChange={(e) => { setStockSearch(e.target.value); setStockPage(1); }}
              className="sm:max-w-md"
            />
          </div>
          {stockError && (
            <Alert variant="error" className="mb-4">
              Failed to load stock.{' '}
              <button type="button" className="underline font-medium" onClick={() => refetchStock()}>
                Retry
              </button>
            </Alert>
          )}
          {(stockLevels?.data?.length || 0) === 0 && !stockLoading ? (
            <EmptyState title="No stock records" description="Try a different search or receive goods via Procurement." />
          ) : (
            <Table columns={stockColumns} data={stockLevels?.data || []} loading={stockLoading} embedded />
          )}
          {renderPagination(stockLevels?.pagination, stockPage, setStockPage)}
        </DataPanel>
      )}

      {/* Materials */}
      {activeTab === 2 && (
        <DataPanel>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <Input
              placeholder="Search materials…"
              className="sm:max-w-md"
              value={matSearch}
              onChange={(e) => { setMatSearch(e.target.value); setMatPage(1); }}
            />
            <Select
              options={MATERIAL_TYPE_OPTIONS}
              value={matType}
              onChange={(e) => { setMatType(e.target.value); setMatPage(1); }}
              className="sm:w-44"
            />
          </div>
          {(materials?.data?.length || 0) === 0 && !matLoading ? (
            <EmptyState
              title="No materials found"
              description="Add raw materials to track paper, steel, rubber, and other inputs."
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
            />
          )}
          {renderPagination(materials?.pagination, matPage, setMatPage)}
        </DataPanel>
      )}

      {/* Warehouses */}
      {activeTab === 3 && (
        <>
          {(warehouses?.length || 0) === 0 ? (
            <EmptyState title="No warehouses configured" description="Warehouses are set up during system seeding or in Settings." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {warehouses?.map(
                (wh: {
                  id: string;
                  code: string;
                  name: string;
                  type: string;
                  address: string;
                  stockLevels: unknown[];
                }) => {
                  const gradient = WAREHOUSE_TYPE_COLORS[wh.type] || WAREHOUSE_TYPE_COLORS.GENERAL;
                  const itemCount = wh.stockLevels?.length || 0;
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
                        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
                          <div>
                            <p className="text-2xl font-bold text-slate-900 tabular-nums">{itemCount}</p>
                            <p className="text-xs text-slate-500">stock lines</p>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
                            View stock
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </>
      )}

      {/* Low stock */}
      {activeTab === 4 && (
        <>
          {(lowStock?.length || 0) === 0 ? (
            <EmptyState
              title="Inventory levels are healthy"
              description="Every active material is above its minimum stock threshold."
            />
          ) : (
            <div className="space-y-3">
              <Alert variant="warning">
                <strong>{lowStock.length}</strong> material(s) are at or below minimum stock. Plan replenishment or
                adjust stock after a goods receipt.
              </Alert>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {(lowStock as (RawMaterial & { stockLevels?: { quantity: number }[] })[]).map((item) => {
                  const onHand = item.stockLevels?.reduce((s, l) => s + Number(l.quantity), 0) ?? 0;
                  const min = Number(item.minStockLevel);
                  const pct = min > 0 ? Math.min(100, Math.round((onHand / min) * 100)) : 0;
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50/80 to-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.code} · {item.type.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <Badge variant="danger">Low</Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-red-100">
                          <p className="text-lg font-bold text-red-600 tabular-nums">{onHand.toLocaleString()}</p>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">On hand</p>
                        </div>
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-slate-100">
                          <p className="text-lg font-bold text-slate-700 tabular-nums">{min.toLocaleString()}</p>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Minimum</p>
                        </div>
                        <div className="rounded-lg bg-white/80 px-2 py-2 border border-slate-100">
                          <p className="text-lg font-bold text-slate-700">{item.unit}</p>
                          <p className="text-[10px] uppercase tracking-wide text-slate-500">Unit</p>
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
      {activeTab === 5 && (
        <DataPanel>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
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

      <Modal open={adjustModalOpen} onClose={() => setAdjustModalOpen(false)} title="Stock Adjustment" size="lg">
        <StockAdjustForm onSuccess={() => setAdjustModalOpen(false)} onCancel={() => setAdjustModalOpen(false)} />
      </Modal>

      <Modal open={transferModalOpen} onClose={() => setTransferModalOpen(false)} title="Stock Transfer" size="lg">
        <StockTransferForm onSuccess={() => setTransferModalOpen(false)} onCancel={() => setTransferModalOpen(false)} />
      </Modal>
    </div>
  );
}
