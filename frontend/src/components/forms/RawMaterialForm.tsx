import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { MaterialTypeOption, RawMaterial, Supplier } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const optionalNonNeg = z.preprocess((v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().min(0).optional());

const rawMaterialSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  typeId: z.string().uuid('Select a material type'),
  unit: z.string().optional(),
  unitCost: optionalNonNeg,
  weight: optionalNonNeg,
  supplierId: z.string().optional(),
  minStockLevel: optionalNonNeg,
  reorderQty: optionalNonNeg,
  initialQuantity: optionalNonNeg,
});

type RawMaterialFormData = z.infer<typeof rawMaterialSchema>;

const rawMaterialDefaultValues: RawMaterialFormData = {
  name: '',
  typeId: '',
  unit: 'pcs',
  unitCost: 0,
  weight: undefined,
  supplierId: '',
  minStockLevel: 0,
  reorderQty: 0,
  initialQuantity: 0,
};

interface Warehouse {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface RawMaterialFormProps {
  material?: RawMaterial | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function asWarehouseList(value: unknown): Warehouse[] {
  if (Array.isArray(value)) return value as Warehouse[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: Warehouse[] }).data;
  }
  return [];
}

function sumOnHand(material?: RawMaterial | null): number {
  if (!material || !Array.isArray(material.stockLevels)) return 0;
  return material.stockLevels.reduce((s, l) => s + Number(l.quantity || 0), 0);
}

/** Recover qty mistakenly typed into Unit (e.g. "35pcs"). */
function normalizeUnitAndStock(unitRaw: string | undefined, stockRaw: number | undefined) {
  const stock = Number(stockRaw ?? 0);
  const unit = String(unitRaw || '').trim();
  const matched = unit.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z%]*)$/i);
  if (matched && (!stock || stock === 0)) {
    const qty = Number(matched[1]);
    const suffix = (matched[2] || 'pcs').toLowerCase();
    if (Number.isFinite(qty) && qty > 0) {
      return { unit: suffix || 'pcs', initialQuantity: qty };
    }
  }
  return { unit: unit || 'pcs', initialQuantity: Number.isFinite(stock) ? stock : 0 };
}

export function RawMaterialForm({ material, onSuccess, onCancel }: RawMaterialFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!material;
  const [newTypeName, setNewTypeName] = useState('');
  const [typeError, setTypeError] = useState('');

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
  });

  const { data: materialTypesData } = useQuery({
    queryKey: ['material-types'],
    queryFn: () => inventoryApi.materialTypes().then((r) => r.data.data as MaterialTypeOption[]),
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => asWarehouseList((await inventoryApi.warehouses()).data),
  });

  const rawWarehouses = asWarehouseList(warehousesData).filter((w) => w.type === 'raw_materials');

  const supplierOptions = [
    { value: '', label: 'None' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const typeOptions = (materialTypesData || []).map((t) => ({
    value: t.id,
    label: t.name,
  }));

  const { register, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<RawMaterialFormData>({
    resolver: zodResolver(rawMaterialSchema),
    defaultValues: rawMaterialDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.rawMaterial,
    watch,
    getValues,
    reset,
    defaultValues: rawMaterialDefaultValues,
    enabled: !isEdit,
    isMeaningful: (data) =>
      Boolean(data.name?.trim()) ||
      Boolean(data.typeId) ||
      Boolean(data.supplierId) ||
      (data.unitCost != null && data.unitCost > 0) ||
      (data.initialQuantity != null && data.initialQuantity > 0) ||
      (data.weight != null && data.weight > 0),
  });

  useEffect(() => {
    if (material) {
      const onHand = sumOnHand(material);
      const recovered = normalizeUnitAndStock(material.unit, onHand);
      reset({
        name: material.name,
        typeId: material.typeId || material.materialType?.id || '',
        unit: recovered.unit,
        unitCost: Number(material.unitCost || 0),
        weight: material.weight != null ? Number(material.weight) : undefined,
        supplierId: material.supplier?.id || '',
        minStockLevel: Number(material.minStockLevel || 0),
        reorderQty: 0,
        initialQuantity: recovered.initialQuantity,
      });
    } else {
      reset({
        ...rawMaterialDefaultValues,
        typeId: materialTypesData?.[0]?.id || '',
      });
    }
  }, [material, material?.id, materialTypesData, reset]);

  const createTypeMutation = useMutation({
    mutationFn: (name: string) => inventoryApi.createMaterialType({ name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['material-types'] });
      setValue('typeId', res.data.data.id, { shouldValidate: true });
      setNewTypeName('');
      setTypeError('');
    },
    onError: (err: unknown) => {
      setTypeError(
        (err as AxiosError<{ message?: string }>).response?.data?.message || 'Failed to add material type.'
      );
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: RawMaterialFormData) => {
      const recovered = normalizeUnitAndStock(data.unit, data.initialQuantity);
      const payload = {
        name: data.name.trim(),
        typeId: data.typeId,
        unit: recovered.unit,
        unitCost: Number(data.unitCost ?? 0),
        weight: data.weight === undefined || data.weight === null ? null : Number(data.weight),
        supplierId: data.supplierId || undefined,
        minStockLevel: Number(data.minStockLevel ?? 0),
        reorderQty: Number(data.reorderQty ?? 0),
        initialQuantity: recovered.initialQuantity,
      };
      if (!payload.typeId) {
        throw new Error('Select a material type');
      }
      return isEdit
        ? inventoryApi.updateMaterial(material!.id, payload)
        : inventoryApi.createMaterial(payload);
    },
    onSuccess: async () => {
      void clearDraft();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['materials'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-stats'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-warehouses'] }),
        queryClient.invalidateQueries({ queryKey: ['low-stock'] }),
        queryClient.invalidateQueries({ queryKey: ['stock-levels'] }),
        queryClient.invalidateQueries({ queryKey: ['warehouses'] }),
      ]);
      await queryClient.refetchQueries({ queryKey: ['materials'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(mutation.error as AxiosError<{ message?: string }>)?.response?.data?.message ||
            (mutation.error as Error)?.message ||
            'Failed to save raw material. Please try again.'}
        </div>
      )}

      {isEdit && material?.code && (
        <p className="text-xs text-slate-500">
          Material reference: <span className="font-mono font-medium text-slate-700">{material.code}</span>
        </p>
      )}

      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 space-y-3">
        <p className="text-sm font-semibold text-slate-800">Stock &amp; weight</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Stock on hand"
            type="number"
            step="any"
            min={0}
            {...register('initialQuantity')}
            error={errors.initialQuantity?.message}
            placeholder="e.g. 35"
          />
          <Input
            label="Weight (kg)"
            type="number"
            step="any"
            min={0}
            {...register('weight')}
            error={errors.weight?.message}
            placeholder="e.g. 0.250"
          />
        </div>
        <p className="text-xs text-slate-600">
          Stock on hand updates quantity in{' '}
          {rawWarehouses[0] ? rawWarehouses[0].code : 'WH-RM'}. Weight is saved on the material record.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <Input label="Name *" {...register('name')} error={errors.name?.message} />
        </div>
        <div className="sm:col-span-2 space-y-2">
          <Select
            label="Type *"
            options={typeOptions.length ? typeOptions : [{ value: '', label: 'No types yet' }]}
            {...register('typeId')}
            error={errors.typeId?.message}
            disabled={!typeOptions.length}
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              label="Add type"
              placeholder="e.g. Fabric, Chemical, Hardware"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              error={typeError}
            />
            <Button
              type="button"
              variant="secondary"
              className="sm:mt-6"
              loading={createTypeMutation.isPending}
              disabled={!newTypeName.trim()}
              onClick={() => createTypeMutation.mutate(newTypeName.trim())}
            >
              Add type
            </Button>
          </div>
        </div>

        <Input
          label="Unit (pcs, kg, rolls…)"
          {...register('unit')}
          placeholder="pcs"
          error={errors.unit?.message}
        />
        <Input label="Unit Cost (KES)" type="number" step="any" min={0} {...register('unitCost')} />
        <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />
        <Input label="Min Stock Level" type="number" step="any" min={0} {...register('minStockLevel')} />
        <Input label="Reorder Qty" type="number" step="any" min={0} {...register('reorderQty')} />
      </div>

      <p className="text-xs text-slate-500">
        Unit is the measurement label only (e.g. pcs) — put quantity in <strong>Stock on hand</strong>, not in Unit.
      </p>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Save changes' : 'Create Material'}
        </Button>
      </div>
    </form>
  );
}
