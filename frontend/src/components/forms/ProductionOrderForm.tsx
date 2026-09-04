import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, productsApi } from '../../services/api';
import { Button, Input, Select, formatCurrency } from '../ui';
import { Machine } from '../../types';
import { ProductSearchSelect } from './ProductSearchSelect';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const priorityOptions = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

const productionOrderSchema = z.object({
  productId: z.string().min(1, 'Product is required'),
  machineId: z.string().optional(),
  quantity: z.coerce.number().int().min(1),
  priority: z.string().optional(),
  scheduledStart: z.string().optional(),
  notes: z.string().optional(),
});

type ProductionOrderFormData = z.infer<typeof productionOrderSchema>;

const productionOrderDefaultValues: ProductionOrderFormData = {
  quantity: 1,
  priority: 'NORMAL',
  productId: '',
  machineId: '',
};

interface ProductionOrderFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function ProductionOrderForm({ onSuccess, onCancel }: ProductionOrderFormProps) {
  const queryClient = useQueryClient();

  const { data: machinesData } = useQuery({
    queryKey: ['machines'],
    queryFn: () => operationsApi.machines().then((r) => r.data.data as Machine[]),
  });

  const machineOptions = [
    { value: '', label: 'None' },
    ...(machinesData || []).map((m) => ({ value: m.id, label: `${m.code} - ${m.name}` })),
  ];

  const { register, control, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<ProductionOrderFormData>({
    resolver: zodResolver(productionOrderSchema),
    defaultValues: productionOrderDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.productionOrder,
    watch,
    getValues,
    reset,
    defaultValues: productionOrderDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.productId) ||
      Boolean(data.machineId) ||
      Number(data.quantity) !== 1 ||
      Boolean(data.scheduledStart) ||
      Boolean(data.notes?.trim()),
  });

  const mutation = useMutation({
    mutationFn: (data: ProductionOrderFormData) => {
      const payload = {
        ...data,
        machineId: data.machineId || undefined,
        scheduledStart: data.scheduledStart ? new Date(data.scheduledStart).toISOString() : undefined,
      };
      return operationsApi.createProduction(payload);
    },
    onSuccess: () => {
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['production'] });
      onSuccess();
    },
  });

  const productId = watch('productId');
  const quantity = watch('quantity') || 1;

  const { data: bomPreview } = useQuery({
    queryKey: ['bom-preview', productId, quantity],
    queryFn: () =>
      productsApi.getBomPreview(productId, quantity).then((r) => r.data.data as {
        lines: Array<{
          rawMaterialCode: string;
          rawMaterialName: string;
          plannedQty: number;
          unit: string;
          lineCost: number;
          onHand: number;
        }>;
        estimatedCost: number;
      }),
    enabled: Boolean(productId) && quantity > 0,
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} />
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create production order. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Controller
          name="productId"
          control={control}
          render={({ field }) => (
            <ProductSearchSelect
              label="Product *"
              value={field.value}
              onChange={field.onChange}
              error={errors.productId?.message}
            />
          )}
        />
        <Select label="Machine" options={machineOptions} {...register('machineId')} />
        <Input label="Quantity *" type="number" min={1} {...register('quantity')} error={errors.quantity?.message} />
        <Select label="Priority" options={priorityOptions} {...register('priority')} />
        <Input label="Scheduled Start" type="datetime-local" {...register('scheduledStart')} />
      </div>
      <Input label="Notes" {...register('notes')} placeholder="Optional — e.g. batch run, shift notes" />

      {productId && bomPreview && (
        <div className="rounded-xl border border-slate-200 p-3 text-sm space-y-2">
          <p className="font-medium text-slate-900">Materials required</p>
          {(bomPreview.lines?.length || 0) === 0 ? (
            <p className="text-amber-700 text-xs">
              No BOM for this product. Add a materials recipe under Products before production can track usage.
            </p>
          ) : (
            <>
              <ul className="space-y-1 text-slate-600">
                {bomPreview.lines.map((line) => (
                  <li key={line.rawMaterialCode} className="flex justify-between gap-2">
                    <span>{line.rawMaterialCode} — {line.rawMaterialName}: {line.plannedQty.toFixed(3)} {line.unit}</span>
                    <span className="tabular-nums shrink-0">{formatCurrency(line.lineCost)}</span>
                  </li>
                ))}
              </ul>
              <p className="font-medium text-slate-800 pt-1 border-t border-slate-100">
                Est. material cost: {formatCurrency(bomPreview.estimatedCost)}
              </p>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Production Order</Button>
      </div>
    </form>
  );
}
