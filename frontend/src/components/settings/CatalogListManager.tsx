import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { ChevronDown, ChevronUp, Pencil, Check, X, Trash2 } from 'lucide-react';
import { Alert, Badge, Button, EmptyState, Input } from '../ui';
import { CatalogManageItem } from '../../types';

interface CatalogListManagerProps {
  description: string;
  items: CatalogManageItem[];
  loading: boolean;
  canEdit: boolean;
  addLabel: string;
  emptyLabel: string;
  usageLabel: string;
  queryKey: string[];
  invalidateKeys?: string[][];
  onAdd: (name: string) => Promise<unknown>;
  onUpdate: (id: string, data: { name?: string; isActive?: boolean }) => Promise<unknown>;
  onReorder: (ids: string[]) => Promise<unknown>;
  canDeactivate?: boolean;
  onDeactivate?: (id: string) => Promise<unknown>;
}

export function CatalogListManager({
  description,
  items,
  loading,
  canEdit,
  addLabel,
  emptyLabel,
  usageLabel,
  queryKey,
  invalidateKeys = [],
  onAdd,
  onUpdate,
  onReorder,
  canDeactivate = false,
  onDeactivate,
}: CatalogListManagerProps) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [items]
  );

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey });
    for (const key of invalidateKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const getErrorMessage = (err: unknown, fallback: string) =>
    (err as AxiosError<{ message?: string }>).response?.data?.message || fallback;

  const addMutation = useMutation({
    mutationFn: (name: string) => onAdd(name),
    onSuccess: () => {
      setNewName('');
      setError('');
      invalidateAll();
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Failed to add item.')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; isActive?: boolean } }) => onUpdate(id, data),
    onSuccess: () => {
      setEditingId(null);
      setEditName('');
      setError('');
      invalidateAll();
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Failed to update item.')),
    onSettled: () => setUpdatingId(null),
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => onReorder(ids),
    onSuccess: () => {
      setError('');
      invalidateAll();
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Failed to reorder items.')),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => {
      if (!onDeactivate) return Promise.reject(new Error('Deactivate is not available'));
      return onDeactivate(id);
    },
    onSuccess: () => {
      setError('');
      invalidateAll();
    },
    onError: (err: unknown) => setError(getErrorMessage(err, 'Failed to deactivate item.')),
    onSettled: () => setDeactivatingId(null),
  });

  const startEdit = (item: CatalogManageItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setError('');
  };

  const saveEdit = (id: string) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setUpdatingId(id);
    updateMutation.mutate({ id, data: { name: trimmed } });
  };

  const toggleActive = (item: CatalogManageItem) => {
    const nextActive = !item.isActive;
    const action = nextActive ? 'reactivate' : 'deactivate';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${item.name}"?`)) {
      return;
    }
    setUpdatingId(item.id);
    updateMutation.mutate({ id: item.id, data: { isActive: nextActive } });
  };

  const moveItem = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedItems.length) return;
    const ids = sortedItems.map((item) => item.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    reorderMutation.mutate(ids);
  };

  const deactivateItem = (item: CatalogManageItem) => {
    if (!item.isActive) return;
    const inUse = (item.usageCount ?? 0) > 0;
    const message = inUse
      ? `Deactivate "${item.name}"? Existing products keep this category, but it will be hidden when creating new products.`
      : `Deactivate "${item.name}"? It will be hidden when creating new products.`;
    if (!window.confirm(message)) return;
    setDeactivatingId(item.id);
    deactivateMutation.mutate(item.id);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{description}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {canEdit && (
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            label={addLabel}
            placeholder={emptyLabel}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button
            type="button"
            className="sm:mt-6"
            loading={addMutation.isPending}
            disabled={!newName.trim()}
            onClick={() => addMutation.mutate(newName.trim())}
          >
            Add
          </Button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : sortedItems.length ? (
        <div className="table-scroll-x -mx-1">
          <table className="min-w-max w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 px-2 font-medium w-16">Order</th>
                <th className="py-2 px-2 font-medium">Name</th>
                <th className="py-2 px-2 font-medium">In use</th>
                <th className="py-2 px-2 font-medium">Status</th>
                {(canEdit || canDeactivate) && <th className="py-2 px-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map((item, index) => (
                <tr key={item.id} className={!item.isActive ? 'opacity-70' : undefined}>
                  <td className="py-3 px-2 text-slate-500 tabular-nums">{index + 1}</td>
                  <td className="py-3 px-2">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="min-w-[180px]"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={updatingId === item.id}
                          onClick={() => saveEdit(item.id)}
                          aria-label="Save name"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(null);
                            setEditName('');
                          }}
                          aria-label="Cancel edit"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium text-slate-900">{item.name}</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-slate-600">
                    {item.usageCount ?? 0} {usageLabel}
                  </td>
                  <td className="py-3 px-2">
                    <Badge variant={item.isActive ? 'success' : 'default'}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  {(canEdit || canDeactivate) && (
                    <td className="py-3 px-2">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={index === 0 || reorderMutation.isPending}
                              onClick={() => moveItem(index, -1)}
                              aria-label="Move up"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={index === sortedItems.length - 1 || reorderMutation.isPending}
                              onClick={() => moveItem(index, 1)}
                              aria-label="Move down"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                            {editingId !== item.id && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => startEdit(item)}
                                aria-label="Rename"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant={item.isActive ? 'ghost' : 'secondary'}
                              size="sm"
                              loading={updatingId === item.id}
                              onClick={() => toggleActive(item)}
                            >
                              {item.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                          </>
                        )}
                        {canDeactivate && onDeactivate && item.isActive && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            loading={deactivatingId === item.id}
                            onClick={() => deactivateItem(item)}
                            title="Deactivate category"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          title="Nothing configured yet"
          description={canEdit ? `Use the form above to add your first entry.` : 'No entries yet.'}
        />
      )}
    </div>
  );
}
