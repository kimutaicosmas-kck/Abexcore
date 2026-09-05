import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { productsApi } from '../../services/api';
import { Button, Input, formatCurrency } from '../ui';
import { RawMaterial } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';
import { MaterialSearchSelect } from './MaterialSearchSelect';

type BomLine = {
  rawMaterialId: string;
  quantity: number;
  unit: string;
  wastePercent: number;
  notes?: string;
};

interface ProductBomEditorProps {
  productId: string;
}

export function ProductBomEditor({ productId }: ProductBomEditorProps) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<BomLine[]>([]);
  const [version, setVersion] = useState('1.0');
  const [notes, setNotes] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [materialById, setMaterialById] = useState<Record<string, RawMaterial>>({});

  const { data: bomData, isLoading } = useQuery({
    queryKey: ['product-bom', productId],
    queryFn: () => productsApi.getBom(productId).then((r) => r.data.data),
    enabled: !!productId,
  });

  useEffect(() => {
    if (!bomData || hydrated) return;
    const bom = bomData.bom as {
      version?: string;
      notes?: string;
      items?: Array<{
        rawMaterialId: string;
        quantity: number | string;
        unit: string;
        wastePercent?: number | string;
        notes?: string;
        rawMaterial?: RawMaterial;
      }>;
    } | null;

    const seededMaterials: Record<string, RawMaterial> = {};
    if (bom?.items) {
      for (const item of bom.items) {
        if (item.rawMaterial) {
          seededMaterials[item.rawMaterialId] = item.rawMaterial as RawMaterial;
        }
      }
    }
    setMaterialById(seededMaterials);

    if (bom) {
      setVersion(bom.version || '1.0');
      setNotes(bom.notes || '');
      setLines(
        (bom.items || []).map((item) => ({
          rawMaterialId: item.rawMaterialId,
          quantity: Number(item.quantity),
          unit: item.unit || 'pcs',
          wastePercent: Number(item.wastePercent || 0),
          notes: item.notes || '',
        }))
      );
    } else {
      setLines([{ rawMaterialId: '', quantity: 1, unit: 'pcs', wastePercent: 0 }]);
    }
    setHydrated(true);
  }, [bomData, hydrated]);

  const rememberMaterial = (material: RawMaterial | null) => {
    if (!material) return;
    setMaterialById((prev) => ({ ...prev, [material.id]: material }));
  };

  const estimatedUnitCost = useMemo(
    () =>
      lines.reduce((sum, line) => {
        if (!line.rawMaterialId) return sum;
        const mat = materialById[line.rawMaterialId];
        const wasteFactor = 1 + (line.wastePercent || 0) / 100;
        const unitCost = Number(mat?.effectiveUnitCost ?? mat?.unitCost ?? 0);
        return sum + (line.quantity || 0) * wasteFactor * unitCost;
      }, 0),
    [lines, materialById]
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        version,
        notes: notes || undefined,
        items: lines
          .filter((l) => l.rawMaterialId)
          .map((l) => ({
            rawMaterialId: l.rawMaterialId,
            quantity: l.quantity,
            unit: l.unit,
            wastePercent: l.wastePercent,
            notes: l.notes,
          })),
      };
      if (payload.items.length === 0) {
        throw new Error('Add at least one material line');
      }
      return productsApi.upsertBom(productId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-bom', productId] });
    },
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading materials recipe…</p>;
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-4 bg-slate-50/50">
      <div>
        <p className="text-sm font-medium text-slate-900">Materials recipe (BOM)</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Define raw materials per finished unit. Search by code or name to find any material in your catalog.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Recipe version" value={version} onChange={(e) => setVersion(e.target.value)} />
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-12 gap-2 items-end p-2 bg-white rounded-lg border border-slate-100">
            <div className="col-span-12 sm:col-span-5">
              <MaterialSearchSelect
                label={index === 0 ? 'Raw material' : undefined}
                value={line.rawMaterialId}
                onChange={(id) => {
                  setLines((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, rawMaterialId: id } : row))
                  );
                }}
                onMaterialSelect={(material) => {
                  rememberMaterial(material);
                  if (!material) return;
                  setLines((prev) =>
                    prev.map((row, i) =>
                      i === index
                        ? { ...row, rawMaterialId: material.id, unit: material.unit || row.unit }
                        : row
                    )
                  );
                }}
              />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Input
                label={index === 0 ? 'Qty / unit' : undefined}
                type="number"
                step="0.0001"
                min={0.0001}
                value={line.quantity}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, i) =>
                      i === index ? { ...row, quantity: Number(e.target.value) } : row
                    )
                  )
                }
              />
            </div>
            <div className="col-span-4 sm:col-span-2">
              <Input
                label={index === 0 ? 'Unit' : undefined}
                value={line.unit}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, i) => (i === index ? { ...row, unit: e.target.value } : row))
                  )
                }
              />
            </div>
            <div className="col-span-3 sm:col-span-2">
              <Input
                label={index === 0 ? 'Waste %' : undefined}
                type="number"
                min={0}
                max={100}
                value={line.wastePercent}
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((row, i) =>
                      i === index ? { ...row, wastePercent: Number(e.target.value) } : row
                    )
                  )
                }
              />
            </div>
            <div className="col-span-1">
              {lines.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() =>
          setLines((prev) => [...prev, { rawMaterialId: '', quantity: 1, unit: 'pcs', wastePercent: 0 }])
        }
      >
        <Plus className="h-3 w-3 mr-1" /> Add material
      </Button>

      <p className="text-sm text-slate-600">
        Estimated material cost per unit: <span className="font-semibold">{formatCurrency(estimatedUnitCost)}</span>
      </p>

      {saveMutation.isError && (
        <p className="text-sm text-red-600">{getApiErrorMessage(saveMutation.error)}</p>
      )}

      <Button type="button" size="sm" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
        Save materials recipe
      </Button>
    </div>
  );
}
