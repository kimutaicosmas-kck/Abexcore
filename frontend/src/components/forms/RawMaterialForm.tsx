import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { MaterialTypeOption, RawMaterial, Supplier } from '../../types';

const rawMaterialSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  typeId: z.string().uuid('Select a material type'),
  unit: z.string().optional(),
  unitCost: z.coerce.number().min(0).optional(),
  weight: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().min(0).optional()
  ),
  supplierId: z.string().optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
  initialQuantity: z.coerce.number().min(0).optional(),
});

type RawMaterialFormData = z.infer<typeof rawMaterialSchema>;

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

  const defaultTypeId = material?.typeId || material?.materialType?.id || materialTypesData?.[0]?.id || '';

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<RawMaterialFormData>({
    resolver: zodResolver(rawMaterialSchema),
    defaultValues: {
      typeId: defaultTypeId,
      unit: 'pcs',
      unitCost: 0,
      weight: undefined,
      minStockLevel: 0,
      reorderQty: 0,
      initialQuantity: 0,
    },
  });

  useEffect(() => {
    if (material) {
      reset({
        name: material.name,
        typeId: material.typeId || material.materialType?.id || '',
        unit: material.unit || 'pcs',
        unitCost: Number(material.unitCost || 0),
        weight: material.weight != null ? Number(material.weight) : undefined,
        supplierId: material.supplier?.id || '',
        minStockLevel: Number(material.minStockLevel || 0),
        reorderQty: 0,
        initialQuantity: sumOnHand(material),
      });
    } else {
      reset({
        name: '',
        typeId: materialTypesData?.[0]?.id || '',
        unit: 'pcs',
        unitCost: 0,
        weight: undefined,
        supplierId: '',
        minStockLevel: 0,
        reorderQty: 0,
        initialQuantity: 0,
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
    mutationFn: (data: RawMaterialFormData) => {
      const payload = {
        name: data.name,
        typeId: data.typeId,
        unit: data.unit || 'pcs',
        unitCost: data.unitCost ?? 0,
        weight: data.weight === undefined ? null : Number(data.weight),
        supplierId: data.supplierId || undefined,
        minStockLevel: data.minStockLevel ?? 0,
        reorderQty: data.reorderQty ?? 0,
        initialQuantity: data.initialQuantity ?? 0,
      };
      return isEdit
        ? inventoryApi.updateMaterial(material!.id, payload)
        : inventoryApi.createMaterial(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-warehouses'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(mutation.error as AxiosError<{ message?: string }>)?.response?.data?.message ||
            'Failed to save raw material. Please try again.'}
        </div>
      )}

      {isEdit && material?.code && (
        <p className="text-xs text-slate-500">
          Material reference: <span className="font-mono font-medium text-slate-700">{material.code}</span>
        </p>
      )}

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

        <Input label="Unit" {...register('unit')} placeholder="kg, rolls, pcs…" />
        <Input
          label="Weight (kg)"
          type="number"
          step="0.001"
          min={0}
          {...register('weight')}
          error={errors.weight?.message}
          placeholder="e.g. 0.250"
        />
        <Input label="Unit Cost (KES)" type="number" step="0.01" {...register('unitCost')} />
        <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />

        <Input
          label="Stock on hand"
          type="number"
          step="0.001"
          min={0}
          {...register('initialQuantity')}
          error={errors.initialQuantity?.message}
          placeholder="Quantity in WH-RM"
        />
        <Input label="Min Stock Level" type="number" {...register('minStockLevel')} />
        <Input label="Reorder Qty" type="number" {...register('reorderQty')} />
      </div>

      <p className="text-xs text-slate-500">
        Weight and stock on hand can be edited anytime. Stock updates the raw materials warehouse
        {rawWarehouses[0] ? ` (${rawWarehouses[0].code})` : ''}.
      </p>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Material' : 'Create Material'}
        </Button>
      </div>
    </form>
  );
}
