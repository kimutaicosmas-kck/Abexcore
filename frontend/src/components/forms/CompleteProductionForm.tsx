import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi, inventoryApi, qualityApi } from '../../services/api';
import { Button, Input, getApiErrorMessage, formatCurrency } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { QualityInspection, ProductionOrder } from '../../types';

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

  const { data: productionOrder, isLoading: orderLoading } = useQuery({
    queryKey: ['production-order', productionId],
    queryFn: () => operationsApi.getProductionOrder(productionId).then((r) => r.data.data as ProductionOrder),
  });

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const body: unknown = (await inventoryApi.warehouses()).data;
      if (Array.isArray(body)) return body as Warehouse[];
      if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
        return (body as { data: Warehouse[] }).data;
      }
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

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CompleteProductionFormData>({
    resolver: zodResolver(completeProductionSchema),
    defaultValues: {
      completedQty: orderQuantity && orderQuantity > 0 ? orderQuantity : 1,
      rejectedQty: 0,
    },
  });

  const completedQty = watch('completedQty') || 1;
  const orderQty = productionOrder?.quantity || orderQuantity || 1;
  const scale = orderQty > 0 ? completedQty / orderQty : 1;

  const [actualByMaterial, setActualByMaterial] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!productionOrder?.consumption?.length) return;
    setActualByMaterial((prev) => {
      const next = { ...prev };
      for (const line of productionOrder.consumption || []) {
        if (next[line.rawMaterialId] !== undefined) continue;
        const planned = Number(line.plannedQty) * scale;
        next[line.rawMaterialId] = planned.toFixed(3);
      }
      return next;
    });
  }, [productionOrder, scale]);

  const materialLines = useMemo(() => {
    return (productionOrder?.consumption || []).map((line) => {
      const planned = Number(line.plannedQty) * scale;
      const actual = Number(actualByMaterial[line.rawMaterialId] ?? planned);
      const rm = line.rawMaterial;
      const unitCost = Number(rm?.unitCost || 0);
      return {
        rawMaterialId: line.rawMaterialId,
        name: rm?.name || line.rawMaterialId,
        code: rm?.code || '',
        unit: line.unit || rm?.unit || 'pcs',
        planned,
        actual,
        lineCost: actual * unitCost,
        unitCost,
      };
    });
  }, [productionOrder, scale, actualByMaterial]);

  const totalMaterialCost = materialLines.reduce((sum, l) => sum + l.lineCost, 0);

  const mutation = useMutation({
    mutationFn: (data: CompleteProductionFormData) =>
      operationsApi.completeProduction(productionId, {
        ...data,
        consumption: materialLines.map((line) => ({
          rawMaterialId: line.rawMaterialId,
          actualQty: line.actual,
        })),
      }),
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
  const noBom = !orderLoading && (productionOrder?.consumption?.length || 0) === 0;

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {orderNumber && (
        <p className="text-sm text-slate-600">
          Completing production for <span className="font-medium text-slate-900">{orderNumber}</span>
        </p>
      )}

      {orderLoading ? (
        <div className="p-3 rounded-lg bg-slate-50 text-slate-600 text-sm">Loading production order…</div>
      ) : noBom ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm">
          <p className="font-medium">No material recipe (BOM)</p>
          <p className="mt-1">
            Add a bill of materials to this product in Products → edit product → Materials recipe, then create a new production order.
          </p>
        </div>
      ) : null}

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

      {materialLines.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 border-b border-slate-200">
            <p className="text-sm font-medium text-slate-900">Materials to consume</p>
            <p className="text-xs text-slate-500">Adjust actual usage if production used more or less than planned.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Planned</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2 text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {materialLines.map((line) => (
                  <tr key={line.rawMaterialId} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-medium text-slate-900">{line.code} — {line.name}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{line.planned.toFixed(3)} {line.unit}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.001"
                        min={0}
                        disabled={qcBlocked || noBom}
                        value={actualByMaterial[line.rawMaterialId] ?? line.planned.toFixed(3)}
                        onChange={(e) =>
                          setActualByMaterial((prev) => ({
                            ...prev,
                            [line.rawMaterialId]: e.target.value,
                          }))
                        }
                        className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                      />
                      <span className="ml-1 text-slate-500">{line.unit}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(line.lineCost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-medium">
                  <td colSpan={3} className="px-3 py-2 text-right text-slate-700">Total material cost</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totalMaterialCost)}</td>
                </tr>
                {completedQty > 0 && (
                  <tr className="bg-slate-50 text-slate-600 text-xs">
                    <td colSpan={3} className="px-3 py-2 text-right">Unit cost (FG)</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(totalMaterialCost / completedQty)}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
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
          max={orderQty}
          {...register('completedQty')}
          error={errors.completedQty?.message}
          disabled={qcBlocked || noBom}
        />
        <Input
          label="Rejected Quantity"
          type="number"
          min={0}
          {...register('rejectedQty')}
          disabled={qcBlocked || noBom}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending} disabled={qcBlocked || noBom}>
          Complete Production
        </Button>
      </div>
    </form>
  );
}
