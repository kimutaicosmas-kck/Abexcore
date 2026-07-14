import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { productsApi, inventoryApi } from '../../services/api';
import { Button } from '../ui';

interface BOMItem {
  rawMaterialId: string;
  quantity: number;
  unit: string;
  wastePercent: number;
}

interface BOMFormProps {
  productId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function BOMForm({ productId, onSuccess, onCancel }: BOMFormProps) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<BOMItem[]>([
    { rawMaterialId: '', quantity: 1, unit: 'pcs', wastePercent: 0 },
  ]);
  const [version, setVersion] = useState('1.0');
  const [notes, setNotes] = useState('');

  const { data: product } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => productsApi.get(productId).then((r) => r.data.data),
  });

  const { data: materials } = useQuery({
    queryKey: ['materials-bom'],
    queryFn: () => inventoryApi.materials({ limit: 200 }).then((r) => r.data.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      productsApi.saveBOM(productId, {
        version,
        notes,
        items: items.filter((i) => i.rawMaterialId),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      onSuccess();
    },
  });

  const addRow = () =>
    setItems([...items, { rawMaterialId: '', quantity: 1, unit: 'pcs', wastePercent: 0 }]);

  const removeRow = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const updateItem = (idx: number, field: keyof BOMItem, value: string | number) => {
    const next = [...items];
    next[idx] = { ...next[idx], [field]: value };
    setItems(next);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      className="space-y-4"
    >
      <p className="text-sm text-gray-600">
        Bill of Materials for <strong>{product?.name}</strong> ({product?.sku})
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Version</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Components</label>
          <Button type="button" size="sm" variant="ghost" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Add line
          </Button>
        </div>

        {items.map((item, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <select
              value={item.rawMaterialId}
              onChange={(e) => updateItem(idx, 'rawMaterialId', e.target.value)}
              className="col-span-5 rounded-lg border border-gray-300 px-2 py-2 text-sm"
              required
            >
              <option value="">Select material</option>
              {(materials || []).map((m: { id: string; code: string; name: string }) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={item.quantity}
              onChange={(e) => updateItem(idx, 'quantity', parseFloat(e.target.value))}
              className="col-span-2 rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
            <input
              value={item.unit}
              onChange={(e) => updateItem(idx, 'unit', e.target.value)}
              className="col-span-2 rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={item.wastePercent}
              onChange={(e) => updateItem(idx, 'wastePercent', parseFloat(e.target.value))}
              className="col-span-2 rounded-lg border border-gray-300 px-2 py-2 text-sm"
              placeholder="Waste %"
            />
            <button
              type="button"
              onClick={() => removeRow(idx)}
              className="col-span-1 p-2 text-red-500 hover:bg-red-50 rounded"
              disabled={items.length === 1}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Save BOM
        </Button>
      </div>
    </form>
  );
}
