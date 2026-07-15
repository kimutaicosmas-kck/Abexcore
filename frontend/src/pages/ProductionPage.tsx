import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, CheckCircle } from 'lucide-react';
import { operationsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductionOrderForm } from '../components/forms/ProductionOrderForm';
import { CompleteProductionForm } from '../components/forms/CompleteProductionForm';

export function ProductionPage() {
  const queryClient = useQueryClient();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['production'],
    queryFn: () => operationsApi.production().then((r) => r.data),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => operationsApi.startProduction(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['production'] }),
  });

  const columns = [
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'product',
      label: 'Product',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.product as { name: string })?.name || '-',
    },
    { key: 'quantity', label: 'Qty' },
    { key: 'completedQty', label: 'Completed' },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'machine',
      label: 'Machine',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.machine as { name: string })?.name || 'Unassigned',
    },
    {
      key: 'scheduledStart',
      label: 'Scheduled',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const status = row.status as string;
        const id = row.id as string;
        if (status === 'PLANNED' || status === 'SCHEDULED') {
          return (
            <Button size="sm" loading={startMutation.isPending} onClick={() => startMutation.mutate(id)}>
              <Play className="h-3 w-3 mr-1" /> Start
            </Button>
          );
        }
        if (status === 'IN_PROGRESS') {
          return (
            <Button size="sm" variant="secondary" onClick={() => setCompletingId(id)}>
              <CheckCircle className="h-3 w-3 mr-1" /> Complete
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Production Planning"
        subtitle="Manage production orders, scheduling, and manufacturing execution"
        action={
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Production Order
          </Button>
        }
      />
      <Table columns={columns} data={data?.data || []} loading={isLoading} />

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New Production Order" size="lg">
        <ProductionOrderForm onSuccess={() => setCreateModalOpen(false)} onCancel={() => setCreateModalOpen(false)} />
      </Modal>

      <Modal
        open={completingId !== null}
        onClose={() => setCompletingId(null)}
        title="Complete Production"
        size="md"
      >
        {completingId && (
          <CompleteProductionForm
            productionId={completingId}
            onSuccess={() => setCompletingId(null)}
            onCancel={() => setCompletingId(null)}
          />
        )}
      </Modal>
    </div>
  );
}
