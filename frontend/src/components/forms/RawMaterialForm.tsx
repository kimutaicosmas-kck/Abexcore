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

  const asWarehouseList = (value: unknown): Warehouse[] => {
    if (Array.isArray(value)) return value as Warehouse[];
    if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
      return (value as { data: Warehouse[] }).data;
    }
    return [];
  };

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => asWarehouseList((await inventoryApi.warehouses()).data),
    enabled: !isEdit,
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

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<RawMaterialFormData>({
    resolver: zodResolver(rawMaterialSchema),
    defaultValues: material
      ? {
          name: material.name,
          typeId: defaultTypeId,
          unit: material.unit,
          unitCost: Number(material.unitCost),
          supplierId: material.supplier?.id || '',
          minStockLevel: material.minStockLevel,
          reorderQty: 0,
        }
      : { typeId: defaultTypeId, unit: 'pcs', minStockLevel: 0, reorderQty: 0, initialQuantity: 0 },
  });

  useEffect(() => {
    if (!isEdit && materialTypesData?.[0]?.id) {
      setValue('typeId', materialTypesData[0].id, { shouldValidate: true });
    }
  }, [materialTypesData, isEdit, setValue]);

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
        ...data,
        supplierId: data.supplierId || undefined,
        initialQuantity: isEdit ? undefined : data.initialQuantity || undefined,
      };
      return isEdit
        ? inventoryApi.updateMaterial(material!.id, payload)
        : inventoryApi.createMaterial(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <div className="md:col-span-2 space-y-2">
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
        <Input label="Unit Cost (KES)" type="number" step="0.01" {...register('unitCost')} />
        <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />
        <Input label="Min Stock Level" type="number" {...register('minStockLevel')} />
        <Input label="Reorder Qty" type="number" {...register('reorderQty')} />
      </div>

      {!isEdit && (
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-4 space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Opening stock</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Posted to the raw materials warehouse
              {rawWarehouses[0] ? ` (${rawWarehouses[0].code})` : ' (created automatically if needed)'}.
            </p>
          </div>
          <Input
            label="Initial quantity"
            type="number"
            step="0.001"
            {...register('initialQuantity')}
            error={errors.initialQuantity?.message}
          />
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Material' : 'Create Material'}
        </Button>
      </div>
    </form>
  );
}
