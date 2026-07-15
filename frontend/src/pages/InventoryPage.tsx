import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Warehouse, AlertTriangle, Package, ArrowLeftRight } from 'lucide-react';
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
  Alert,
  formatCurrency,
  formatDate,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { RawMaterialForm } from '../components/forms/RawMaterialForm';
import { StockAdjustForm } from '../components/forms/StockAdjustForm';
import { StockTransferForm } from '../components/forms/StockTransferForm';
import { useAuth } from '../contexts/AuthContext';
import { InventoryStats, InventoryTransaction, RawMaterial } from '../types';

const tabs = ['Stock Levels', 'Raw Materials', 'Warehouses', 'Low Stock', 'Adjustments', 'Transfers', 'Transactions'];

const MATERIAL_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'STEEL', label: 'Steel' },
  { value: 'FILTER_PAPER', label: 'Filter Paper' },
  { value: 'RUBBER', label: 'Rubber' },
  { value: 'ADHESIVE', label: 'Adhesive' },
  { value: 'OTHER', label: 'Other' },
];

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
    queryFn: () => inventoryApi.stockLevels({ page: stockPage, limit: 15, search: stockSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: materials, isLoading: matLoading } = useQuery({
    queryKey: ['materials', matPage, matSearch, matType],
    queryFn: () =>
      inventoryApi.materials({ page: matPage, limit: 15, search: matSearch || undefined, type: matType || undefined }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data),
    enabled: activeTab === 2,
  });

  const { data: lowStock } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => inventoryApi.lowStock().then((r) => r.data.data),
    enabled: activeTab === 3,
  });

  const { data: transfers, isLoading: transferLoading } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => inventoryApi.transfers().then((r) => r.data.data),
    enabled: activeTab === 5,
  });

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['inventory-transactions', txPage, txSearch],
    queryFn: () =>
      inventoryApi.transactions({ page: txPage, limit: 20, search: txSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 6,
  });

  const openEditMaterial = (material: RawMaterial) => {
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  };

  const stockColumns = [
    {
      key: 'item',
      label: 'Item',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row.product as { name: string; sku: string } | undefined;
        const material = row.rawMaterial as { name: string; code: string } | undefined;
        return (
          <div>
            <p className="font-medium">{product?.name || material?.name || '-'}</p>
            <p className="text-xs text-slate-500">{product?.sku || material?.code}</p>
          </div>
        );
      },
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.warehouse as { name: string })?.name || '-',
    },
    { key: 'batchNumber', label: 'Batch', render: (v: unknown) => (v as string) || '—' },
    {
      key: 'quantity',
      label: 'Quantity',
      render: (val: unknown) => Number(val).toLocaleString(),
    },
    {
      key: 'unitCost',
      label: 'Unit Cost',
      render: (val: unknown) => formatCurrency(val as number),
    },
  ];

  const materialColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>,
    },
    { key: 'unit', label: 'Unit' },
    {
      key: 'unitCost',
      label: 'Unit Cost',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'minStockLevel',
      label: 'Min Level',
      render: (val: unknown) => Number(val).toLocaleString(),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) =>
        canUpdate ? (
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEditMaterial(row as unknown as RawMaterial); }}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null,
    },
  ];

  const txColumns = [
    {
      key: 'createdAt',
      label: 'Date',
      render: (v: unknown) => formatDate(v as string),
    },
    {
      key: 'type',
      label: 'Type',
      render: (v: unknown) => <Badge variant="info">{(v as string).replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.warehouse as { name: string })?.name || '-',
    },
    {
      key: 'quantity',
      label: 'Qty',
      render: (v: unknown) => Number(v).toLocaleString(),
    },
    { key: 'referenceType', label: 'Reference', render: (v: unknown) => (v as string) || '—' },
    { key: 'notes', label: 'Notes', render: (v: unknown) => (v as string)?.slice(0, 40) || '—' },
  ];

  const renderPagination = (
    pagination: { page: number; totalPages: number; total: number } | undefined,
    page: number,
    setPage: (fn: (p: number) => number) => void
  ) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader subtitle="Stock levels, materials, warehouses, and movement history" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Materials" value={stats.materialsCount} icon={<Package className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Inventory Value" value={formatCurrency(stats.inventoryValue)} icon={<Warehouse className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Low Stock Items" value={stats.lowStockCount} icon={<AlertTriangle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Movements Today" value={stats.transfersToday} icon={<ArrowLeftRight className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          canCreate ? (
            activeTab === 1 ? (
              <Button onClick={() => { setEditingMaterial(null); setMaterialModalOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />Add Material
              </Button>
            ) : activeTab === 4 ? (
              <Button onClick={() => setAdjustModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />Adjust Stock
              </Button>
            ) : activeTab === 5 ? (
              <Button onClick={() => setTransferModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />Transfer Stock
              </Button>
            ) : undefined
          ) : undefined
        }
      />

      {activeTab === 0 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search stock…" value={stockSearch} onChange={(e) => { setStockSearch(e.target.value); setStockPage(1); }} />
          </div>
          {stockError && <Alert variant="error" className="mb-4">Failed to load stock. <button type="button" className="underline" onClick={() => refetchStock()}>Retry</button></Alert>}
          <Table columns={stockColumns} data={stockLevels?.data || []} loading={stockLoading} />
          {renderPagination(stockLevels?.pagination, stockPage, setStockPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search materials…" className="max-w-sm" value={matSearch} onChange={(e) => { setMatSearch(e.target.value); setMatPage(1); }} />
            <Select options={MATERIAL_TYPE_OPTIONS} value={matType} onChange={(e) => { setMatType(e.target.value); setMatPage(1); }} className="w-40" />
          </div>
          <Table columns={materialColumns} data={materials?.data || []} loading={matLoading} onRowClick={(row) => openEditMaterial(row as unknown as RawMaterial)} />
          {renderPagination(materials?.pagination, matPage, setMatPage)}
        </>
      )}

      {activeTab === 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {warehouses?.map((wh: { id: string; code: string; name: string; type: string; address: string; stockLevels: unknown[] }) => (
            <Card key={wh.id} title={wh.name}>
              <div className="space-y-2 text-sm">
                <p><span className="text-slate-500">Code:</span> {wh.code}</p>
                <p><span className="text-slate-500">Type:</span> {wh.type.replace(/_/g, ' ')}</p>
                <p><span className="text-slate-500">Address:</span> {wh.address || '—'}</p>
                <p><span className="text-slate-500">Stock Items:</span> {wh.stockLevels?.length || 0}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 3 && (
        <Table
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Material' },
            {
              key: 'stock',
              label: 'Current Stock',
              render: (_: unknown, row: Record<string, unknown>) => {
                const levels = row.stockLevels as { quantity: number }[];
                return levels?.reduce((s, l) => s + Number(l.quantity), 0).toLocaleString() || '0';
              },
            },
            {
              key: 'minStockLevel',
              label: 'Min Level',
              render: (val: unknown) => Number(val).toLocaleString(),
            },
          ]}
          data={lowStock || []}
        />
      )}

      {activeTab === 4 && (
        <Card>
          <p className="text-sm text-slate-600">Use <strong>Adjust Stock</strong> to add or remove inventory quantities. All adjustments are logged in the Transactions tab.</p>
        </Card>
      )}

      {activeTab === 5 && (
        <Table
          columns={[
            {
              key: 'warehouse',
              label: 'Warehouse',
              render: (_: unknown, row: Record<string, unknown>) =>
                (row.warehouse as { name: string })?.name || '-',
            },
            { key: 'quantity', label: 'Qty', render: (v: unknown) => Number(v).toLocaleString() },
            { key: 'notes', label: 'Notes' },
            {
              key: 'createdAt',
              label: 'Date',
              render: (v: unknown) => formatDate(v as string),
            },
          ]}
          data={transfers || []}
          loading={transferLoading}
        />
      )}

      {activeTab === 6 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search transactions…" value={txSearch} onChange={(e) => { setTxSearch(e.target.value); setTxPage(1); }} />
          </div>
          <Table columns={txColumns} data={(transactions?.data as InventoryTransaction[]) || []} loading={txLoading} />
          {renderPagination(transactions?.pagination, txPage, setTxPage)}
        </>
      )}

      <Modal open={materialModalOpen} onClose={() => { setMaterialModalOpen(false); setEditingMaterial(null); }} title={editingMaterial ? 'Edit Raw Material' : 'Add Raw Material'} size="lg">
        <RawMaterialForm material={editingMaterial} onSuccess={() => { setMaterialModalOpen(false); setEditingMaterial(null); }} onCancel={() => { setMaterialModalOpen(false); setEditingMaterial(null); }} />
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
