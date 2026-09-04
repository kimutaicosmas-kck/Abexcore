import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { RawMaterial } from '../../types';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const requisitionItemSchema = z.object({
  rawMaterialId: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.001),
  unit: z.string().optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
});

const requisitionSchema = z.object({
  department: z.string().optional(),
  priority: z.string().optional(),
  requiredDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(requisitionItemSchema).min(1, 'Add at least one item'),
});

type RequisitionFormData = z.infer<typeof requisitionSchema>;

const requisitionDefaultValues: RequisitionFormData = {
  priority: 'NORMAL',
  items: [{ rawMaterialId: '', description: '', quantity: 1, unit: '', estimatedCost: 0 }],
};

const priorityOptions = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

interface RequisitionFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function RequisitionForm({ onSuccess, onCancel }: RequisitionFormProps) {
  const queryClient = useQueryClient();

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const materialOptions = [
    { value: '', label: 'Custom item...' },
    ...(materialsData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, control, handleSubmit, watch, setValue, getValues, reset, formState: { errors } } = useForm<RequisitionFormData>({
    resolver: zodResolver(requisitionSchema),
    defaultValues: requisitionDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.requisition,
    watch,
    getValues,
    reset,
    defaultValues: requisitionDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.department?.trim()) ||
      Boolean(data.notes?.trim()) ||
      Boolean(data.requiredDate) ||
      data.items.some((item) => Boolean(item.description?.trim())),
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  const handleMaterialChange = (index: number, materialId: string) => {
    const material = materialsData?.find((m) => m.id === materialId);
    if (material) {
      setValue(`items.${index}.description`, material.name);
      setValue(`items.${index}.unit`, material.unit);
      setValue(`items.${index}.estimatedCost`, Number(material.unitCost));
    }
  };

  const mutation = useMutation({
    mutationFn: (data: RequisitionFormData) => {
      const payload = {
        ...data,
        items: data.items.map((item) => ({
          ...item,
          rawMaterialId: item.rawMaterialId || undefined,
        })),
      };
      return inventoryApi.createRequisition(payload);
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create requisition. Please check all fields.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input label="Department" {...register('department')} />
        <Select label="Priority" options={priorityOptions} {...register('priority')} />
        <Input label="Required Date" type="date" {...register('requiredDate')} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Line Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ rawMaterialId: '', description: '', quantity: 1, unit: '', estimatedCost: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
              <div className="col-span-12 sm:col-span-3">
                <Select
                  label={index === 0 ? 'Material' : undefined}
                  options={materialOptions}
                  {...register(`items.${index}.rawMaterialId`, {
                    onChange: (e) => handleMaterialChange(index, e.target.value),
                  })}
                />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Input label={index === 0 ? 'Description' : undefined} {...register(`items.${index}.description`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" step="0.001" min={0.001} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-12 sm:col-span-1">
                <Input label={index === 0 ? 'Unit' : undefined} {...register(`items.${index}.unit`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Est. Cost' : undefined} type="number" step="0.01" {...register(`items.${index}.estimatedCost`)} />
              </div>
              <div className="col-span-12 sm:col-span-1">
                {fields.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => remove(index)}>
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Input label="Notes" {...register('notes')} />

      <div className="bg-gray-50 rounded-lg p-4 text-sm">
        <div className="flex justify-between font-bold">
          <span>Estimated Total</span>
          <span>
            KES {items.reduce((sum, item) => sum + (item.estimatedCost || 0) * (item.quantity || 0), 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Requisition</Button>
      </div>
    </form>
  );
}
