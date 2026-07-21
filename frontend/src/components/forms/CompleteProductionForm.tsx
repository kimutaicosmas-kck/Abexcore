import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, inventoryApi, qualityApi } from '../../services/api';
import { Button, Input, Select, getApiErrorMessage } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { QualityInspection } from '../../types';

const completeProductionSchema = z.object({
  completedQty: z.coerce.number().int().min(1, 'Completed quantity must be at least 1'),
  rejectedQty: z.coerce.number().int().min(0).optional(),
  warehouseId: z.string().min(1, 'Warehouse is required'),
});

type CompleteProductionFormData = z.infer<typeof completeProductionSchema>;

interface Warehouse {
  id: string;
  name: string;
  code: string;
}

interface CompleteProductionFormProps {
  productionId: string;
  orderQuantity?: number;
  orderNumber?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CompleteProductionForm({
  productionId,
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
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data as Warehouse[]),
  });

  const {
    data: inspections,
    isLoading: inspectionsLoading,
    refetch: refetchInspections,
  } = useQuery({
    queryKey: ['quality', 'production', productionId],
    queryFn: () =>
      qualityApi
        .list({ productionOrderId: productionId, limit: 5 })
        .then((r) => r.data.data as QualityInspection[]),
  });

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
    if (inspections && inspections.length === 0) {
      ensureInspectionMutation.mutate();
    }
  }, [inspections, inspectionsLoading, ensureInspectionMutation.isPending, ensureInspectionMutation.isError]);

  const passedInspection = inspections?.find((i) => i.status === 'PASSED');
  const pendingInspection = inspections?.find((i) => i.status === 'PENDING');

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

  const warehouseOptions = [
    { value: '', label: 'Select warehouse...' },
    ...(warehousesData || []).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<CompleteProductionFormData>({
    resolver: zodResolver(completeProductionSchema),
    defaultValues: {
      completedQty: orderQuantity && orderQuantity > 0 ? orderQuantity : 1,
      rejectedQty: 0,
      warehouseId: '',
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
          <p>
            A passed quality check is required before production can be completed.
            {pendingInspection
              ? ' Mark the pending inspection as passed to continue.'
              : ' Create and pass a quality inspection to continue.'}
          </p>
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
          {!canPassQc && (
            <p className="text-xs">Ask a quality team member to pass the inspection in Quality.</p>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm">
          Quality check passed ({passedInspection?.inspectionNo}). You can complete production.
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
        <Select
          label="Warehouse *"
          options={warehouseOptions}
          {...register('warehouseId')}
          error={errors.warehouseId?.message}
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
