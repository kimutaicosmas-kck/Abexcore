import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qualityApi, inventoryApi, operationsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { ProductionOrder } from '../../types';
import { ProductSearchSelect } from './ProductSearchSelect';

const qualityTypeOptions = [
  { value: 'incoming', label: 'Incoming (procurement)' },
  { value: 'production', label: 'Production output' },
  { value: 'finished', label: 'Finished goods' },
];

const qualityStatusOptions = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CONDITIONAL', label: 'Conditional' },
];

const qualitySchema = z
  .object({
    type: z.string().min(1, 'Type is required'),
    goodsReceiptId: z.string().optional(),
    productionOrderId: z.string().optional(),
    productId: z.string().optional(),
    status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
    result: z.string().optional(),
    defectsFound: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.type === 'production' || data.type === 'finished') && !data.productionOrderId && !data.productId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select a product for surplus-stock inspections, or link a production order',
        path: ['productId'],
      });
    }
  });

type QualityFormData = z.infer<typeof qualitySchema>;

interface GoodsReceipt {
  id: string;
  grnNumber: string;
  status?: string;
}

interface QualityFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function QualityForm({ onSuccess, onCancel }: QualityFormProps) {
  const queryClient = useQueryClient();

  const { data: goodsReceiptsData } = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => inventoryApi.goodsReceipts().then((r) => r.data.data as GoodsReceipt[]),
  });

  const { data: productionData } = useQuery({
    queryKey: ['production'],
    queryFn: () => operationsApi.production({ limit: 100 }).then((r) => r.data.data as ProductionOrder[]),
  });

  const goodsReceiptOptions = [
    { value: '', label: 'None' },
    ...(goodsReceiptsData || [])
      .filter((gr) => gr.status !== 'APPROVED')
      .map((gr) => ({ value: gr.id, label: gr.grnNumber })),
  ];

  const productionOptions = [
    { value: '', label: 'None — surplus / batch inspection' },
    ...(productionData || []).map((po) => ({ value: po.id, label: po.orderNumber })),
  ];

  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<QualityFormData>({
    resolver: zodResolver(qualitySchema),
    defaultValues: {
      type: 'production',
      status: 'PENDING',
      goodsReceiptId: '',
      productionOrderId: '',
      productId: '',
      defectsFound: 0,
    },
  });

  const inspectionType = watch('type');
  const isIncoming = inspectionType === 'incoming';
  const isProductionOutput = inspectionType === 'production' || inspectionType === 'finished';

  const mutation = useMutation({
    mutationFn: (data: QualityFormData) => {
      const payload = {
        ...data,
        goodsReceiptId: data.goodsReceiptId || undefined,
        productionOrderId: data.productionOrderId || undefined,
        productId: data.productId || undefined,
      };
      return qualityApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
      queryClient.invalidateQueries({ queryKey: ['quality-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to create quality inspection. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Type *" options={qualityTypeOptions} {...register('type')} error={errors.type?.message} />
        <Select label="Status" options={qualityStatusOptions} {...register('status')} />
        {isIncoming && (
          <Select label="Goods Receipt" options={goodsReceiptOptions} {...register('goodsReceiptId')} />
        )}
        {isProductionOutput && (
          <>
            <Controller
              name="productId"
              control={control}
              render={({ field }) => (
                <ProductSearchSelect
                  label="Product"
                  value={field.value || ''}
                  onChange={field.onChange}
                  error={errors.productId?.message}
                />
              )}
            />
            <Select label="Production Order (optional)" options={productionOptions} {...register('productionOrderId')} />
          </>
        )}
        <Input label="Defects Found" type="number" min={0} {...register('defectsFound')} />
      </div>
      <Input label="Result" {...register('result')} placeholder="Inspection notes, batch reference, etc." />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Inspection</Button>
      </div>
    </form>
  );
}
