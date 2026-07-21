import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Target } from 'lucide-react';
import { financeApi } from '../services/api';
import {
  Card,
  Button,
  Input,
  Alert,
  formatCurrency,
  EmptyState,
} from '../components/ui';
import { SalesTargetRow } from '../types';
import { useAuth } from '../contexts/AuthContext';

export function SalesTargetsPanel() {
  const { isSuperAdmin } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: targets, isLoading } = useQuery({
    queryKey: ['sales-targets', year, month],
    queryFn: () =>
      financeApi
        .salesTargets({ year: Number(year), month: Number(month) })
        .then((r) => r.data.data as SalesTargetRow[]),
    enabled: isSuperAdmin,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { salesPersonId: string; targetAmount: number }) =>
      financeApi.upsertSalesTarget({
        salesPersonId: payload.salesPersonId,
        year: Number(year),
        month: Number(month),
        targetAmount: payload.targetAmount,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-targets'] });
      queryClient.invalidateQueries({ queryKey: ['sales-performance'] });
      queryClient.invalidateQueries({ queryKey: ['my-sales'] });
    },
  });

  if (!isSuperAdmin) {
    return (
      <Alert variant="warning">Only Super Admin can assign sales targets.</Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
        <Input label="Year" type="number" value={year} onChange={(e) => setYear(e.target.value)} />
        <Input label="Month" type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <Card title="Sales Officers" padding={false}>
        {isLoading ? (
          <p className="px-4 py-8 text-sm text-slate-500">Loading…</p>
        ) : !targets?.length ? (
          <EmptyState title="No Sales Officers" description="Create Sales Officer users first." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {targets.map((row) => {
              const draft = drafts[row.salesPersonId] ?? String(row.targetAmount || '');
              return (
                <li key={row.salesPersonId} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="font-medium text-slate-900 flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary-600" />
                      {row.name}
                    </p>
                    <p className="text-xs text-slate-500">{row.email}</p>
                    {row.targetAmount > 0 && (
                      <p className="text-xs text-emerald-600 mt-1">
                        Current target: {formatCurrency(row.targetAmount)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-end gap-2 w-full sm:w-auto">
                    <Input
                      label="Target (KES)"
                      type="number"
                      min={0}
                      value={draft}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [row.salesPersonId]: e.target.value }))
                      }
                      className="sm:w-40"
                    />
                    <Button
                      size="sm"
                      loading={saveMutation.isPending}
                      onClick={() =>
                        saveMutation.mutate({
                          salesPersonId: row.salesPersonId,
                          targetAmount: Number(draft) || 0,
                        })
                      }
                    >
                      Save
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
