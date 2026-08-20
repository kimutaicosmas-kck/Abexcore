import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, inventoryApi, productsApi } from '../../services/api';
import { Button, Card, EmptyState, Input, Select, Table } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { useAuth } from '../../contexts/AuthContext';

type BomRow = {
  id: string;
  version: string;
  product: { id: string; name: string; sku: string };
  items: Array<{
    rawMaterialId: string;
    quantity: number | string;
    wastePercent: number | string;
    unit: string;
    rawMaterial?: { name: string; code: string };
  }>;
};

type BomItemDraft = {
  rawMaterialId: string;
  quantity: string;
  wastePercent: string;
};

export function BomPanel() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('production:create') || hasPermission('production:update');
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState('');
  const [items, setItems] = useState<BomItemDraft[]>([
    { rawMaterialId: '', quantity: '1', wastePercent: '0' },
  ]);

  const { data: bomList, isLoading } = useQuery({
    queryKey: ['bom-list'],
    queryFn: () =>
      operationsApi.listBom({ limit: 50 }).then((r) => (r.data.data || []) as BomRow[]),
  });

  const { data: products } = useQuery({
    queryKey: ['bom-products'],
    queryFn: () =>
      productsApi.list({ page: 1, limit: 200, isActive: true }).then((r) => {
        const rows = (r.data as { data?: { id: string; name: string; sku: string }[] }).data || [];
        return rows;
      }),
  });

  const { data: materials } = useQuery({
    queryKey: ['bom-materials'],
    queryFn: () =>
      inventoryApi.materials({ page: 1, limit: 200 }).then((r) => {
        const rows =
          (r.data as { data?: { id: string; name: string; code: string }[] }).data || [];
        return rows;
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      operationsApi.upsertBom({
        productId,
        items: items
          .filter((i) => i.rawMaterialId && Number(i.quantity) > 0)
          .map((i) => ({
            rawMaterialId: i.rawMaterialId,
            quantity: Number(i.quantity),
            wastePercent: Number(i.wastePercent) || 0,
          })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom-list'] });
      setItems([{ rawMaterialId: '', quantity: '1', wastePercent: '0' }]);
      setProductId('');
    },
  });

  const columns = [
    {
      key: 'product',
      label: 'Finished product',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row.product as BomRow['product'];
        return `${product.name} (${product.sku})`;
      },
    },
    { key: 'version', label: 'Version' },
    {
      key: 'items',
      label: 'Components',
      render: (_: unknown, row: Record<string, unknown>) => {
        const items = row.items as BomRow['items'];
        return items
          .map(
            (i) =>
              `${i.rawMaterial?.name || i.rawMaterialId} × ${Number(i.quantity)}${
                Number(i.wastePercent) ? ` (+${Number(i.wastePercent)}% waste)` : ''
              }`
          )
          .join(', ');
      },
    },
  ];

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h3 className="font-semibold text-slate-900">Bill of Materials</h3>
        <p className="text-sm text-slate-600">
          Define raw materials per finished good. New production orders auto-plan consumption from the BOM.
        </p>
        {canEdit && (
          <div className="space-y-3">
            <Select
              label="Finished product"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={[
                { value: '', label: 'Select product…' },
                ...(products || []).map((p) => ({
                  value: p.id,
                  label: `${p.name} (${p.sku})`,
                })),
              ]}
            />
            {items.map((item, idx) => (
              <div key={idx} className="grid gap-2 sm:grid-cols-3">
                <Select
                  label={idx === 0 ? 'Raw material' : undefined}
                  value={item.rawMaterialId}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, rawMaterialId: e.target.value } : row
                      )
                    )
                  }
                  options={[
                    { value: '', label: 'Select material…' },
                    ...(materials || []).map((m) => ({
                      value: m.id,
                      label: `${m.name} (${m.code})`,
                    })),
                  ]}
                />
                <Input
                  label={idx === 0 ? 'Qty per unit' : undefined}
                  type="number"
                  min="0"
                  step="0.0001"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row))
                    )
                  }
                />
                <Input
                  label={idx === 0 ? 'Waste %' : undefined}
                  type="number"
                  min="0"
                  max="100"
                  value={item.wastePercent}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, wastePercent: e.target.value } : row
                      )
                    )
                  }
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  setItems((prev) => [...prev, { rawMaterialId: '', quantity: '1', wastePercent: '0' }])
                }
              >
                Add line
              </Button>
              <Button
                type="button"
                disabled={!productId || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save BOM'}
              </Button>
            </div>
            {saveMutation.isError && (
              <p className="text-sm text-red-600">{getApiErrorMessage(saveMutation.error)}</p>
            )}
          </div>
        )}
      </Card>

      {isLoading ? (
        <p className="text-slate-500">Loading BOMs…</p>
      ) : !(bomList || []).length ? (
        <EmptyState title="No BOMs yet" description="Create a bill of materials for a finished product." />
      ) : (
        <Table columns={columns} data={bomList || []} />
      )}
    </div>
  );
}
