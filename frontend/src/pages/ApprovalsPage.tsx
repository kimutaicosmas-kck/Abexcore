import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '../services/api';
import { Alert, Badge, Button, Card, EmptyState, QueryErrorAlert, formatDateTime } from '../components/ui';
import { getApiErrorMessage } from '../utils/apiError';
import { useState } from 'react';

type ApprovalRow = {
  id: string;
  title: string;
  entityType: string;
  entityId: string;
  status: string;
  decisionNote?: string | null;
  createdAt: string;
  decidedAt?: string | null;
  requestedBy?: { firstName: string; lastName: string; email: string };
  decidedBy?: { firstName: string; lastName: string } | null;
};

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [error, setError] = useState('');

  const { data, isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ['approvals', filter],
    queryFn: () =>
      platformApi
        .listApprovals(filter === 'PENDING' ? { status: 'PENDING' } : undefined)
        .then((r) => r.data.data as ApprovalRow[]),
  });

  const decideMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'APPROVED' | 'REJECTED' }) =>
      platformApi.decideApproval(id, { decision }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Approvals</h1>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={filter === 'PENDING' ? 'primary' : 'secondary'}
          onClick={() => setFilter('PENDING')}
        >
          Pending
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'ALL' ? 'primary' : 'secondary'}
          onClick={() => setFilter('ALL')}
        >
          All
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {isError && <QueryErrorAlert error={queryError} onRetry={() => refetch()} />}

      <Card title="Workflow queue">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : data?.length ? (
          <div className="divide-y divide-slate-100">
            {data.map((row) => (
              <div key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{row.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {row.entityType} · requested by{' '}
                    {row.requestedBy
                      ? `${row.requestedBy.firstName} ${row.requestedBy.lastName}`
                      : '—'}{' '}
                    · {formatDateTime(row.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant={
                      row.status === 'APPROVED'
                        ? 'success'
                        : row.status === 'REJECTED'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {row.status}
                  </Badge>
                  {row.status === 'PENDING' && (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        loading={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: row.id, decision: 'APPROVED' })}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        loading={decideMutation.isPending}
                        onClick={() => decideMutation.mutate({ id: row.id, decision: 'REJECTED' })}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No approval requests" description="Workflow items will appear here when submitted." />
        )}
      </Card>
    </div>
  );
}
