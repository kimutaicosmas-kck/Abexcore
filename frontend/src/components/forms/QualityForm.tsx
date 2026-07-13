import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qualityApi, inventoryApi, operationsApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { ProductionOrder } from '../../types';

const qualityTypeOptions = [
  { value: 'incoming', label: 'Incoming' },
  { value: 'production', label: 'Production' },
  { value: 'finished', label: 'Finished' },
];

const qualityStatusOptions = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'PASSED', label: 'Passed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CONDITIONAL', label: 'Conditional' },
];

const qualitySchema = z.object({
  type: z.string().min(1, 'Type is required'),
  goodsReceiptId: z.string().optional(),
  productionOrderId: z.string().optional(),
  status: z.enum(['PENDING', 'PASSED', 'FAILED', 'CONDITIONAL']).optional(),
  result: z.string().optional(),
  defectsFound: z.coerce.number().int().min(0).optional(),
});

type QualityFormData = z.infer<typeof qualitySchema>;

interface GoodsReceipt {
  id: string;
  grnNumber: string;
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
    ...(goodsReceiptsData || []).map((gr) => ({ value: gr.id, label: gr.grnNumber })),
  ];

  const productionOptions = [
    { value: '', label: 'None' },
    ...(productionData || []).map((po) => ({ value: po.id, label: po.orderNumber })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<QualityFormData>({
    resolver: zodResolver(qualitySchema),
    defaultValues: {
      type: 'incoming',
      status: 'PENDING',
      goodsReceiptId: '',
      productionOrderId: '',
      defectsFound: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: QualityFormData) => {
      const payload = {
        ...data,
        goodsReceiptId: data.goodsReceiptId || undefined,
        productionOrderId: data.productionOrderId || undefined,
      };
      return qualityApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
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
        <Select label="Goods Receipt" options={goodsReceiptOptions} {...register('goodsReceiptId')} />
        <Select label="Production Order" options={productionOptions} {...register('productionOrderId')} />
        <Input label="Defects Found" type="number" min={0} {...register('defectsFound')} />
      </div>
      <Input label="Result" {...register('result')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Create Inspection</Button>
      </div>
    </form>
  );
}
