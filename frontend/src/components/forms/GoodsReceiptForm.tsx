import { useFieldArray, useForm } from 'react-hook-form';
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { inventoryApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { RawMaterial, Supplier, PurchaseOrder } from '../../types';

const grItemSchema = z.object({
  rawMaterialId: z.string().optional(),
  batchNumber: z.string().optional(),
  quantity: z.coerce.number().min(0.001),
  unit: z.string().optional(),
  unitCost: z.coerce.number().min(0),
  expiryDate: z.string().optional(),
});

const goodsReceiptSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  warehouseId: z.string().min(1, 'Warehouse is required'),
  purchaseOrderId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(grItemSchema).min(1, 'Add at least one item'),
});

type GoodsReceiptFormData = z.infer<typeof goodsReceiptSchema>;

interface Warehouse {
  id: string;
  name: string;
  code: string;
  type?: string;
}

interface GoodsReceiptFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function GoodsReceiptForm({ onSuccess, onCancel }: GoodsReceiptFormProps) {
  const queryClient = useQueryClient();

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers({ limit: 100 }).then((r) => r.data.data as Supplier[]),
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
  });

  const { data: purchaseOrdersData } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => inventoryApi.purchaseOrders({ limit: 100 }).then((r) => r.data.data as PurchaseOrder[]),
  });

  const { data: materialsData } = useQuery({
    queryKey: ['materials'],
    queryFn: () => inventoryApi.materials({ limit: 100 }).then((r) => r.data.data as RawMaterial[]),
  });

  const supplierOptions = [
    { value: '', label: 'Select supplier...' },
    ...(suppliersData || []).map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })),
  ];

  const warehouseOptions = [
    { value: '', label: 'Select warehouse...' },
    ...asWarehouseList(warehousesData)
      .filter((w) => w.type === 'raw_materials')
      .map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
  ];

  const poOptions = [
    { value: '', label: 'None' },
    ...(purchaseOrdersData || []).map((po) => ({ value: po.id, label: po.poNumber })),
  ];

  const materialOptions = [
    { value: '', label: 'Custom item...' },
    ...(materialsData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<GoodsReceiptFormData>({
    resolver: zodResolver(goodsReceiptSchema),
    defaultValues: {
      supplierId: '',
      warehouseId: '',
      purchaseOrderId: '',
      items: [{ rawMaterialId: '', quantity: 1, unitCost: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  useEffect(() => {
    const rm = asWarehouseList(warehousesData).find((w) => w.type === 'raw_materials');
    if (rm) setValue('warehouseId', rm.id);
  }, [warehousesData, setValue]);

  const handleMaterialChange = (index: number, materialId: string) => {
    const material = materialsData?.find((m) => m.id === materialId);
    if (material) {
      setValue(`items.${index}.unit`, material.unit);
      setValue(`items.${index}.unitCost`, Number(material.unitCost));
    }
  };

  const mutation = useMutation({
    mutationFn: (data: GoodsReceiptFormData) => {
      const payload = {
        supplierId: data.supplierId,
        warehouseId: data.warehouseId,
        purchaseOrderId: data.purchaseOrderId || undefined,
        notes: data.notes?.trim() || undefined,
        items: data.items.map((item) => ({
          rawMaterialId: item.rawMaterialId || undefined,
          batchNumber: item.batchNumber?.trim() || undefined,
          quantity: item.quantity,
          unit: item.unit || undefined,
          unitCost: item.unitCost,
          expiryDate: item.expiryDate?.trim() || undefined,
        })),
      };
      return inventoryApi.createGoodsReceipt(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {(mutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
            'Failed to create goods receipt. Please check all fields.'}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Select
          label="Supplier *"
          options={supplierOptions}
          {...register('supplierId')}
          error={errors.supplierId?.message}
        />
        <Select
          label="Warehouse *"
          options={warehouseOptions}
          {...register('warehouseId')}
          error={errors.warehouseId?.message}
        />
        <p className="md:col-span-3 -mt-2 text-xs text-slate-500">
          Goods receipts for materials post to the raw materials warehouse only.
        </p>
        <Select label="Purchase Order" options={poOptions} {...register('purchaseOrderId')} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-gray-700">Receipt Items *</label>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => append({ rawMaterialId: '', quantity: 1, unitCost: 0 })}
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
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Batch No' : undefined} {...register(`items.${index}.batchNumber`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Qty' : undefined} type="number" step="0.001" min={0.001} {...register(`items.${index}.quantity`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Unit Cost' : undefined} type="number" step="0.01" {...register(`items.${index}.unitCost`)} />
              </div>
              <div className="col-span-12 sm:col-span-2">
                <Input label={index === 0 ? 'Expiry' : undefined} type="date" {...register(`items.${index}.expiryDate`)} />
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

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Goods Receipt</Button>
      </div>
    </form>
  );
}
