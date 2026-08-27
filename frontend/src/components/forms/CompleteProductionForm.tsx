import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, inventoryApi, qualityApi } from '../../services/api';
import { Button, Input, getApiErrorMessage } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { QualityInspection } from '../../types';

const completeProductionSchema = z.object({
  completedQty: z.coerce.number().int().min(1, 'Completed quantity must be at least 1'),
  rejectedQty: z.coerce.number().int().min(0).optional(),
});

type CompleteProductionFormData = z.infer<typeof completeProductionSchema>;

interface Warehouse {
  id: string;
  name: string;
  code: string;
  type: string;
}

interface CompleteProductionFormProps {
  productionId: string;
  productId: string;
  orderQuantity?: number;
  orderNumber?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CompleteProductionForm({
  productionId,
  productId,
  orderQuantity,
  orderNumber,
  onSuccess,
  onCancel,
}: CompleteProductionFormProps) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canPassQc = hasPermission('quality:update') || hasPermission('production:update');

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const body = (await inventoryApi.warehouses()).data as { data?: Warehouse[] } | Warehouse[];
      if (Array.isArray(body)) return body;
      if (Array.isArray(body?.data)) return body.data;
      return [] as Warehouse[];
    },
  });

  const finishedGoodsWarehouse = (Array.isArray(warehousesData) ? warehousesData : []).find(
    (w) => w.type === 'finished_goods'
  );

  const {
    data: linkedInspections,
    isLoading: linkedLoading,
    refetch: refetchLinked,
  } = useQuery({
    queryKey: ['quality', 'production', productionId],
    queryFn: () =>
      qualityApi
        .list({ productionOrderId: productionId, limit: 5 })
        .then((r) => r.data.data as QualityInspection[]),
  });

  const {
    data: standaloneInspections,
    isLoading: standaloneLoading,
    refetch: refetchStandalone,
  } = useQuery({
    queryKey: ['quality', 'product', productId, 'standalone'],
    queryFn: () =>
      qualityApi
        .list({ productId, limit: 10 })
        .then((r) =>
          (r.data.data as QualityInspection[]).filter((i) => !i.productionOrder && (i.type === 'production' || i.type === 'finished'))
        ),
    enabled: !!productId,
  });

  const inspections = [...(linkedInspections || []), ...(standaloneInspections || [])];
  const inspectionsLoading = linkedLoading || standaloneLoading;

  const refetchInspections = () => {
    refetchLinked();
    refetchStandalone();
  };

  const ensureInspectionMutation = useMutation({
    mutationFn: () =>
      qualityApi.create({
        type: 'production',
        productionOrderId: productionId,
        status: 'PENDING',
      }),
    onSuccess: () => {
      refetchInspections();
    },
  });

  useEffect(() => {
    if (inspectionsLoading || ensureInspectionMutation.isPending || ensureInspectionMutation.isError) {
      return;
    }
    const hasLinked = linkedInspections && linkedInspections.length > 0;
    const hasStandalonePassed = standaloneInspections?.some((i) => i.status === 'PASSED');
    if (!hasLinked && !hasStandalonePassed) {
      ensureInspectionMutation.mutate();
    }
  }, [
    linkedInspections,
    standaloneInspections,
    inspectionsLoading,
    ensureInspectionMutation.isPending,
    ensureInspectionMutation.isError,
  ]);

  const passedInspection = inspections.find((i) => i.status === 'PASSED');
  const pendingInspection = inspections.find((i) => i.status === 'PENDING');

  const passQcMutation = useMutation({
    mutationFn: (inspectionId: string) =>
      qualityApi.update(inspectionId, {
        status: 'PASSED',
        result: 'Production output approved',
        defectsFound: 0,
      }),
    onSuccess: () => {
      refetchInspections();
      queryClient.invalidateQueries({ queryKey: ['quality'] });
    },
  });

  const { register, handleSubmit, formState: { errors } } = useForm<CompleteProductionFormData>({
    resolver: zodResolver(completeProductionSchema),
    defaultValues: {
      completedQty: orderQuantity && orderQuantity > 0 ? orderQuantity : 1,
      rejectedQty: 0,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CompleteProductionFormData) =>
      operationsApi.completeProduction(productionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onSuccess();
    },
  });

  const qcBlocked = !passedInspection;

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {orderNumber && (
        <p className="text-sm text-slate-600">
          Completing production for <span className="font-medium text-slate-900">{orderNumber}</span>
        </p>
      )}

      {inspectionsLoading || ensureInspectionMutation.isPending ? (
        <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">Loading quality check…</div>
      ) : qcBlocked ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-2">
          <p className="font-medium">Quality inspection required</p>
          {pendingInspection && (
            <p>Mark the pending inspection as passed to continue.</p>
          )}
          {canPassQc && pendingInspection && (
            <Button
              type="button"
              size="sm"
              loading={passQcMutation.isPending}
              onClick={() => passQcMutation.mutate(pendingInspection.id)}
            >
              Mark quality check as passed
            </Button>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          Quality check passed ({passedInspection?.inspectionNo}
          {passedInspection?.productionOrder ? '' : ' — surplus stock'}).
        </div>
      )}

      {passQcMutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiErrorMessage(passQcMutation.error)}
        </div>
      )}

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiErrorMessage(mutation.error)}
        </div>
      )}

      <div className="p-3 rounded-lg bg-primary-50/80 border border-primary-100 text-sm text-primary-900">
        <p className="font-medium">Output warehouse</p>
        <p className="text-primary-800/90 mt-0.5">
          {finishedGoodsWarehouse
            ? `${finishedGoodsWarehouse.code} — ${finishedGoodsWarehouse.name}`
            : 'Finished goods warehouse'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Completed Quantity *"
          type="number"
          min={1}
          {...register('completedQty')}
          error={errors.completedQty?.message}
          disabled={qcBlocked}
        />
        <Input
          label="Rejected Quantity"
          type="number"
          min={0}
          {...register('rejectedQty')}
          disabled={qcBlocked}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending} disabled={qcBlocked}>
          Complete Production
        </Button>
      </div>
    </form>
  );
}
