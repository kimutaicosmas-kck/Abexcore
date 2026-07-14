import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { inventoryApi } from '../services/api';
import { PageHeader, Table, Badge, Card, Button, formatCurrency } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { RawMaterialForm } from '../components/forms/RawMaterialForm';
import { StockAdjustForm } from '../components/forms/StockAdjustForm';
import { StockTransferForm } from '../components/forms/StockTransferForm';
import { RawMaterial } from '../types';

const tabs = ['Stock Levels', 'Raw Materials', 'Warehouses', 'Low Stock', 'Stock Adjust', 'Transfers'];

export function InventoryPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);

  const { data: stockLevels, isLoading: stockLoading } = useQuery({
    queryKey: ['stock-levels'],
    queryFn: () => inventoryApi.stockLevels().then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: materials, isLoading: matLoading } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials().then((r) => r.data),
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

  const openCreateMaterial = () => {
    setEditingMaterial(null);
    setMaterialModalOpen(true);
  };

  const openEditMaterial = (material: RawMaterial) => {
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  };

  const closeMaterialModal = () => {
    setMaterialModalOpen(false);
    setEditingMaterial(null);
  };

  const stockColumns = [
    {
      key: 'item',
      label: 'Item',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row.product as { name: string; sku: string } | undefined;
        const material = row.rawMaterial as { name: string; code: string } | undefined;
        return product?.name || material?.name || '-';
      },
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.warehouse as { name: string })?.name || '-',
    },
    { key: 'batchNumber', label: 'Batch' },
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
      render: (val: unknown) => (
        <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>
      ),
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
      render: (_: unknown, row: Record<string, unknown>) => (
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
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Inventory Management"
        subtitle="Track stock levels, raw materials, and warehouse operations"
        action={
          activeTab === 1 ? (
            <Button onClick={openCreateMaterial}>
              <Plus className="h-4 w-4 mr-2" />
              Add Material
            </Button>
          ) : activeTab === 4 ? (
            <Button onClick={() => setAdjustModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Adjust Stock
            </Button>
          ) : activeTab === 5 ? (
            <Button onClick={() => setTransferModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Transfer Stock
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === i
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={stockColumns} data={stockLevels?.data || []} loading={stockLoading} />
        </div>
      )}

      {activeTab === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={materialColumns}
            data={materials?.data || []}
            loading={matLoading}
            onRowClick={(row) => openEditMaterial(row as unknown as RawMaterial)}
          />
        </div>
      )}

      {activeTab === 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {warehouses?.map((wh: { id: string; code: string; name: string; type: string; address: string; stockLevels: unknown[] }) => (
            <Card key={wh.id} title={wh.name}>
              <div className="space-y-2 text-sm">
                <p><span className="text-gray-500">Code:</span> {wh.code}</p>
                <p><span className="text-gray-500">Type:</span> {wh.type.replace(/_/g, ' ')}</p>
                <p><span className="text-gray-500">Address:</span> {wh.address}</p>
                <p><span className="text-gray-500">Stock Items:</span> {wh.stockLevels?.length || 0}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
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
        </div>
      )}

      {activeTab === 4 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center text-gray-500">
          <p>Use the Adjust Stock button to add or remove inventory quantities.</p>
        </div>
      )}

      {activeTab === 5 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={[
              {
                key: 'warehouse',
                label: 'To Warehouse',
                render: (_: unknown, row: Record<string, unknown>) =>
                  (row.warehouse as { name: string })?.name || '-',
              },
              { key: 'quantity', label: 'Qty', render: (v: unknown) => Number(v).toLocaleString() },
              { key: 'notes', label: 'Notes' },
              {
                key: 'createdAt',
                label: 'Date',
                render: (v: unknown) => new Date(v as string).toLocaleDateString(),
              },
            ]}
            data={transfers || []}
            loading={transferLoading}
          />
        </div>
      )}

      <Modal
        open={materialModalOpen}
        onClose={closeMaterialModal}
        title={editingMaterial ? 'Edit Raw Material' : 'Add Raw Material'}
        size="lg"
      >
        <RawMaterialForm material={editingMaterial} onSuccess={closeMaterialModal} onCancel={closeMaterialModal} />
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
