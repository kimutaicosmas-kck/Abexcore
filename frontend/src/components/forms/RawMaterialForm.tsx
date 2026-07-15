import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { RawMaterial, Supplier } from '../../types';

const materialTypes = [
  { value: 'STEEL', label: 'Steel' },
  { value: 'FILTER_PAPER', label: 'Filter Paper' },
  { value: 'RUBBER', label: 'Rubber' },
  { value: 'MESH', label: 'Mesh' },
  { value: 'ADHESIVE', label: 'Adhesive' },
  { value: 'PLASTIC', label: 'Plastic' },
  { value: 'END_CAP', label: 'End Cap' },
  { value: 'THREAD_PLATE', label: 'Thread Plate' },
  { value: 'PACKAGING_BOX', label: 'Packaging Box' },
  { value: 'LABEL', label: 'Label' },
  { value: 'OTHER', label: 'Other' },
];

const rawMaterialSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  type: z.enum([
    'STEEL', 'FILTER_PAPER', 'RUBBER', 'MESH', 'ADHESIVE',
    'PLASTIC', 'END_CAP', 'THREAD_PLATE', 'PACKAGING_BOX', 'LABEL', 'OTHER',
  ]),
  unit: z.string().optional(),
  unitCost: z.coerce.number().min(0).optional(),
  supplierId: z.string().optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  reorderQty: z.coerce.number().min(0).optional(),
});

type RawMaterialFormData = z.infer<typeof rawMaterialSchema>;

interface RawMaterialFormProps {
  material?: RawMaterial | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function RawMaterialForm({ material, onSuccess, onCancel }: RawMaterialFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!material;

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
  });

  const supplierOptions = [
    { value: '', label: 'None' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<RawMaterialFormData>({
    resolver: zodResolver(rawMaterialSchema),
    defaultValues: material
      ? {
          code: material.code,
          name: material.name,
          type: material.type as RawMaterialFormData['type'],
          unit: material.unit,
          unitCost: Number(material.unitCost),
          supplierId: material.supplier?.id || '',
          minStockLevel: material.minStockLevel,
          reorderQty: 0,
        }
      : { type: 'OTHER', unit: 'kg', minStockLevel: 0, reorderQty: 0 },
  });

  const mutation = useMutation({
    mutationFn: (data: RawMaterialFormData) => {
      const payload = { ...data, supplierId: data.supplierId || undefined };
      return isEdit
        ? inventoryApi.updateMaterial(material!.id, payload)
        : inventoryApi.createMaterial(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['materials'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save raw material. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Code *" {...register('code')} error={errors.code?.message} disabled={isEdit} />
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Select label="Type *" options={materialTypes} {...register('type')} error={errors.type?.message} />
        <Input label="Unit" {...register('unit')} />
        <Input label="Unit Cost (KES)" type="number" step="0.01" {...register('unitCost')} />
        <Select label="Supplier" options={supplierOptions} {...register('supplierId')} />
        <Input label="Min Stock Level" type="number" {...register('minStockLevel')} />
        <Input label="Reorder Qty" type="number" {...register('reorderQty')} />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Material' : 'Create Material'}
        </Button>
      </div>
    </form>
  );
}
