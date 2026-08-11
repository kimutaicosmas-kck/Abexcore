import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2, Search } from 'lucide-react';
import { trashApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatDateTime,
  PageToolbar,
  ConfirmDialog,
  getApiErrorMessage,
} from '../components/ui';
import { useAuth } from '../contexts/AuthContext';

type TrashResource =
  | 'users'
  | 'customers'
  | 'products'
  | 'employees'
  | 'suppliers'
  | 'raw-materials';

type TrashItem = {
  id: string;
  resource: TrashResource;
  label: string;
  name: string;
  deletedAt: string | null;
};

type TrashSummary = { resource: TrashResource; label: string; total: number };

const RESOURCE_MODULE: Record<TrashResource, string> = {
  users: 'users',
  customers: 'customers',
  products: 'products',
  employees: 'hr',
  suppliers: 'procurement',
  'raw-materials': 'inventory',
};

export function RecycleBinPage() {
  const queryClient = useQueryClient();
  const { hasPermission, isSuperAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [resource, setResource] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<TrashItem | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashItem | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trash', page, search, resource],
    queryFn: () =>
      trashApi
        .list({
          page,
          limit: 20,
          search: search || undefined,
          resource: resource || undefined,
        })
        .then((r) => r.data),
  });

  const items = (data?.data as TrashItem[]) || [];
  const summary = (data?.summary as TrashSummary[]) || [];
  const resources = (data?.resources as { key: TrashResource; label: string }[]) || [];
  const pagination = data?.pagination as
    | { page: number; limit: number; total: number; totalPages: number }
    | undefined;

  const canRestore = (item: TrashItem) => {
    const mod = RESOURCE_MODULE[item.resource];
    return hasPermission(`${mod}:update`) || hasPermission(`${mod}:delete`);
  };

  const restoreMutation = useMutation({
    mutationFn: (item: TrashItem) => trashApi.restore(item.resource, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setRestoreTarget(null);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (item: TrashItem) => trashApi.purge(item.resource, item.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setPurgeTarget(null);
    },
  });

  const resourceOptions = [
    { value: '', label: 'All types' },
    ...resources.map((r) => ({ value: r.key, label: r.label })),
  ];

  const columns = [
    {
      key: 'name',
      label: 'Item',
      render: (val: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium text-slate-900">{String(val || '—')}</p>
          <p className="text-xs text-slate-500">{String(row.label || '')}</p>
        </div>
      ),
    },
    {
      key: 'label',
      label: 'Type',
      render: (val: unknown) => <Badge variant="default">{String(val)}</Badge>,
    },
    {
      key: 'deletedAt',
      label: 'Deleted',
      render: (val: unknown) => formatDateTime(String(val || '')),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => {
        const item = row as unknown as TrashItem;
        return (
          <div className="flex justify-end gap-2">
            {canRestore(item) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRestoreTarget(item)}
                title="Restore"
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Restore
              </Button>
            )}
            {isSuperAdmin && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setPurgeTarget(item)}
                title="Delete permanently"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete forever
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader subtitle="Soft-deleted records. Restore them, or permanently remove them if you are a Super Admin." />

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.map((s) => (
            <button
              key={s.resource}
              type="button"
              onClick={() => {
                setResource(s.resource === resource ? '' : s.resource);
                setPage(1);
              }}
              className={`rounded-xl border px-3 py-1.5 text-sm ${
                resource === s.resource
                  ? 'border-primary-300 bg-primary-50 text-primary-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s.label}{' '}
              <span className="font-semibold text-slate-900">{s.total}</span>
            </button>
          ))}
        </div>
      )}

      <PageToolbar
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSearch(searchInput.trim());
                    setPage(1);
                  }
                }}
                placeholder="Search trash…"
                className="pl-9 w-64"
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSearch(searchInput.trim());
                setPage(1);
              }}
            >
              Search
            </Button>
            <Select
              options={resourceOptions}
              value={resource}
              onChange={(e) => {
                setResource(e.target.value);
                setPage(1);
              }}
              className="w-48"
            />
          </div>
        }
      />

      {isError && (
        <Alert variant="error">
          {getApiErrorMessage(error)}{' '}
          <button type="button" className="underline font-medium" onClick={() => refetch()}>
            Retry
          </button>
        </Alert>
      )}

      <DataPanel>
        {!isLoading && items.length === 0 ? (
          <EmptyState
            title="Recycle bin is empty"
            description="Deleted users, customers, products, employees, suppliers, and raw materials appear here."
          />
        ) : (
          <Table columns={columns} data={items as unknown as Record<string, unknown>[]} loading={isLoading} />
        )}
        <TablePagination
          pagination={pagination}
          page={page}
          onPageChange={setPage}
          label="items"
        />
      </DataPanel>

      {!isSuperAdmin && (
        <p className="text-xs text-slate-500">
          Permanent deletion is limited to Super Admins. You can restore items you manage.
        </p>
      )}

      <ConfirmDialog
        open={!!restoreTarget}
        title="Restore item?"
        message={`Restore “${restoreTarget?.name || 'this item'}” (${restoreTarget?.label || ''}) from the recycle bin?`}
        confirmLabel="Restore"
        variant="primary"
        loading={restoreMutation.isPending}
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget)}
      />

      <ConfirmDialog
        open={!!purgeTarget}
        title="Delete permanently?"
        message={`Permanently delete “${purgeTarget?.name || 'this item'}”? This cannot be undone.`}
        confirmLabel="Delete forever"
        loading={purgeMutation.isPending}
        onCancel={() => setPurgeTarget(null)}
        onConfirm={() => purgeTarget && purgeMutation.mutate(purgeTarget)}
      />
    </div>
  );
}
