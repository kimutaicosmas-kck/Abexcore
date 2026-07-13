import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { RawMaterial, Supplier } from '../../types';

const poItemSchema = z.object({
  rawMaterialId: z.string().optional(),
  description: z.string().min(1, 'Description is required'),
  quantity: z.coerce.number().min(0.001),
  unitPrice: z.coerce.number().min(0),
});

const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  expectedDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(poItemSchema).min(1, 'Add at least one item'),
});

type PurchaseOrderFormData = z.infer<typeof purchaseOrderSchema>;

interface PurchaseOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function PurchaseOrderForm({ onSuccess, onCancel }: PurchaseOrderFormProps) {
  const queryClient = useQueryClient();

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const supplierOptions = [
    { value: '', label: 'Select supplier...' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const materialOptions = [
    { value: '', label: 'Custom item...' },
    ...(materialsData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = useForm<PurchaseOrderFormData>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues: {
      items: [{ rawMaterialId: '', description: '', quantity: 1, unitPrice: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = watch('items');

  useEffect(() => {
    items.forEach((item, index) => {
      if (item.rawMaterialId) {
        const material = materialsData?.find((m) => m.id === item.rawMaterialId);
        if (material) {
          setValue(`items.${index}.description`, material.name);
          if (item.unitPrice === 0) {
            setValue(`items.${index}.unitPrice`, Number(material.unitCost));
          }
        }
      }
    });
  }, [items, materialsData, setValue]);

  const lineTotal = items.reduce(
    (sum, item) => sum + (item.quantity || 0) * (item.unitPrice || 0),
    0
  );

  const mutation = useMutation({
    mutationFn: (data: PurchaseOrderFormData) => {
      const payload = {
        ...data,
        expectedDate: data.expectedDate ? new Date(data.expectedDate).toISOString() : undefined,
        items: data.items.map((item) => ({
          ...item,
          rawMaterialId: item.rawMaterialId || undefined,
        })),
      };
      return inventoryApi.createPurchaseOrder(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create purchase order. Please check all fields.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Supplier *"
          options={supplierOptions}
          {...register('supplierId')}
          error={errors.supplierId?.message}
        />
        <Input label="Expected Date" type="date" {...register('expectedDate')} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Line Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ rawMaterialId: '', description: '', quantity: 1, unitPrice: 0 })}
          >
            <Plus className="h-3 w-3 mr-1" /> Add Item
          </Button>
        </div>

        {errors.items?.message && (
          <p className="text-sm text-red-600 mb-2">{errors.items.message}</p>
        )}

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="grid grid-cols-12 gap-2 items-end p-3 bg-gray-50 rounded-lg">
              <div className="col-span-3">
                <Select
                  label={index === 0 ? 'Material' : undefined}
                  options={materialOptions}
                  {...register(`items.${index}.rawMaterialId`)}
                />
              </div>
              <div className="col-span-4">
                <Input
                  label={index === 0 ? 'Description' : undefined}
                  {...register(`items.${index}.description`)}
                />
              </div>
              <div className="col-span-2">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" step="0.001" min={0.001} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-2">
                <Input label={index === 0 ? 'Price' : undefined} type="number" step="0.01" {...register(`items.${index}.unitPrice`)} />
              </div>
              <div className="col-span-1">
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
          <span>Total</span>
          <span>KES {lineTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Purchase Order</Button>
      </div>
    </form>
  );
}
