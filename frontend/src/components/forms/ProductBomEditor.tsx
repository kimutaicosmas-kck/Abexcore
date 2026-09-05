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

type BomLineDraft = BomLine & {
  entryMode: 'yield' | 'direct';
  unitsPerBatch: string;
};

interface ProductBomEditorProps {
  productId: string;
}

/** qty per finished unit when 1 batch unit (bag, roll, etc.) yields N products */
export function qtyPerFinishedUnit(unitsPerBatch: number): number {
  if (!Number.isFinite(unitsPerBatch) || unitsPerBatch <= 0) return 0;
  return 1 / unitsPerBatch;
}

/** Reverse BOM qty into a friendly “units per batch” for the yield calculator */
export function inferUnitsPerBatch(quantity: number): string {
  if (!quantity || quantity <= 0) return '';
  const units = 1 / quantity;
  const rounded = Math.round(units);
  if (rounded > 0 && Math.abs(units - rounded) / rounded < 0.002) {
    return String(rounded);
  }
  const oneDecimal = Math.round(units * 10) / 10;
  return Number.isInteger(oneDecimal) ? String(oneDecimal) : oneDecimal.toFixed(1);
}

function formatQtyPerUnit(qty: number): string {
  if (qty <= 0) return '—';
  if (qty >= 0.01) return qty.toFixed(4);
  return qty.toFixed(6);
}

function emptyLine(): BomLineDraft {
  return {
    rawMaterialId: '',
    quantity: 0,
    unit: 'pcs',
    wastePercent: 0,
    entryMode: 'yield',
    unitsPerBatch: '',
  };
}

function bomItemToDraft(item: {
  rawMaterialId: string;
  quantity: number | string;
  unit: string;
  wastePercent?: number | string;
  notes?: string;
}): BomLineDraft {
  const quantity = Number(item.quantity);
  return {
    rawMaterialId: item.rawMaterialId,
    quantity,
    unit: item.unit || 'pcs',
    wastePercent: Number(item.wastePercent || 0),
    notes: item.notes || '',
    entryMode: 'yield',
    unitsPerBatch: inferUnitsPerBatch(quantity),
  };
}

interface BomLineRowProps {
  line: BomLineDraft;
  showLabels: boolean;
  material?: RawMaterial;
  onChange: (next: BomLineDraft) => void;
  onMaterialSelect: (material: RawMaterial | null) => void;
  onRemove?: () => void;
}

function BomLineRow({
  line,
  showLabels,
  material,
  onChange,
  onMaterialSelect,
  onRemove,
}: BomLineRowProps) {
  const batchUnit = line.unit || material?.unit || 'unit';
  const batchUnitLabel = batchUnit === 'pcs' ? 'unit' : batchUnit;

  const applyUnitsPerBatch = (raw: string) => {
    const units = Number(raw);
    const quantity = qtyPerFinishedUnit(units);
    onChange({
      ...line,
      unitsPerBatch: raw,
      quantity: quantity > 0 ? quantity : line.quantity,
    });
  };

  return (
    <div className="space-y-2 p-2 bg-white rounded-lg border border-slate-100">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-12 sm:col-span-5">
          <MaterialSearchSelect
            label={showLabels ? 'Raw material' : undefined}
            value={line.rawMaterialId}
            onChange={(id) => onChange({ ...line, rawMaterialId: id })}
            onMaterialSelect={(mat) => {
              onMaterialSelect(mat);
              if (!mat) return;
              onChange({
                ...line,
                rawMaterialId: mat.id,
                unit: mat.unit || line.unit,
              });
            }}
          />
        </div>

        <div className="col-span-9 sm:col-span-2">
          <Input
            label={showLabels ? 'Waste %' : undefined}
            type="number"
            min={0}
            max={100}
            value={line.wastePercent}
            onChange={(e) => onChange({ ...line, wastePercent: Number(e.target.value) })}
          />
        </div>

        <div className="col-span-3 sm:col-span-1 flex justify-end">
          {onRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      </div>

      {line.entryMode === 'yield' ? (
        <div className="rounded-lg border border-primary-100 bg-primary-50/40 px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
            <Input
              label={`1 ${batchUnitLabel} produces (finished units)`}
              type="number"
              step="1"
              min={1}
              placeholder="e.g. 180 for bags, 500 for paper rolls"
              value={line.unitsPerBatch}
              onChange={(e) => applyUnitsPerBatch(e.target.value)}
            />
            <div className="pb-2 text-sm text-slate-600 sm:text-right">
              <span className="block text-xs uppercase tracking-wide text-slate-500">Uses per finished unit</span>
              <span className="font-medium text-slate-800">
                {formatQtyPerUnit(line.quantity)} {batchUnitLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="text-xs text-primary-700 hover:text-primary-900 underline-offset-2 hover:underline"
            onClick={() => onChange({ ...line, entryMode: 'direct' })}
          >
            Enter quantity directly instead
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-6 sm:col-span-3">
            <Input
              label="Qty / finished unit"
              type="number"
              step="0.000001"
              min={0.000001}
              value={line.quantity || ''}
              onChange={(e) => {
                const quantity = Number(e.target.value);
                onChange({
                  ...line,
                  quantity,
                  unitsPerBatch: inferUnitsPerBatch(quantity),
                });
              }}
            />
          </div>
          <div className="col-span-6 sm:col-span-2">
            <Input
              label="Unit"
              value={line.unit}
              onChange={(e) => onChange({ ...line, unit: e.target.value })}
            />
          </div>
          <div className="col-span-12">
            <button
              type="button"
              className="text-xs text-primary-700 hover:text-primary-900 underline-offset-2 hover:underline"
              onClick={() => onChange({ ...line, entryMode: 'yield' })}
            >
              Calculate from “1 {batchUnitLabel} produces…” instead
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductBomEditor({ productId }: ProductBomEditorProps) {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<BomLineDraft[]>([]);
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
      setLines((bom.items || []).map(bomItemToDraft));
    } else {
      setLines([emptyLine()]);
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
        if (!line.rawMaterialId || !line.quantity) return sum;
        const mat = materialById[line.rawMaterialId];
        const wasteFactor = 1 + (line.wastePercent || 0) / 100;
        const unitCost = Number(mat?.effectiveUnitCost ?? mat?.unitCost ?? 0);
        return sum + line.quantity * wasteFactor * unitCost;
      }, 0),
    [lines, materialById]
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        version,
        notes: notes || undefined,
        items: lines
          .filter((l) => l.rawMaterialId && l.quantity > 0)
          .map((l) => ({
            rawMaterialId: l.rawMaterialId,
            quantity: l.quantity,
            unit: l.unit,
            wastePercent: l.wastePercent,
            notes: l.notes,
          })),
      };
      if (payload.items.length === 0) {
        throw new Error('Add at least one material line with a valid quantity');
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
          For each material, enter how many finished units one bag, roll, or batch produces. The system
          calculates usage per finished unit automatically.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="Recipe version" value={version} onChange={(e) => setVersion(e.target.value)} />
        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      <div className="space-y-2">
        {lines.map((line, index) => (
          <BomLineRow
            key={index}
            line={line}
            showLabels={index === 0}
            material={line.rawMaterialId ? materialById[line.rawMaterialId] : undefined}
            onChange={(next) =>
              setLines((prev) => prev.map((row, i) => (i === index ? next : row)))
            }
            onMaterialSelect={rememberMaterial}
            onRemove={lines.length > 1 ? () => setLines((prev) => prev.filter((_, i) => i !== index)) : undefined}
          />
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setLines((prev) => [...prev, emptyLine()])}
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
