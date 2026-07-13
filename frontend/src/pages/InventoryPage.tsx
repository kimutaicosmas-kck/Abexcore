import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi } from '../services/api';
import { PageHeader, Table, Badge, Card, formatCurrency } from '../components/ui';

const tabs = ['Stock Levels', 'Raw Materials', 'Warehouses', 'Low Stock'];

export function InventoryPage() {
  const [activeTab, setActiveTab] = useState(0);

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
  ];

  return (
    <div>
      <PageHeader
        title="Inventory Management"
        subtitle="Track stock levels, raw materials, and warehouse operations"
      />

      <div className="flex gap-2 mb-6">
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
          <Table columns={materialColumns} data={materials?.data || []} loading={matLoading} />
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
    </div>
  );
}
