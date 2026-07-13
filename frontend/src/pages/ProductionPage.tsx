import { useQuery } from '@tanstack/react-query';
import { Plus, Play, CheckCircle } from 'lucide-react';
import { operationsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatDate, getStatusBadge } from '../components/ui';

export function ProductionPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['production-orders'],
    queryFn: () => operationsApi.production().then((r) => r.data),
  });

  const handleStart = async (id: string) => {
    await operationsApi.startProduction(id);
    refetch();
  };

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
      render: (val: unknown) => val ? formatDate(val as string) : '-',
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const status = row.status as string;
        const id = row.id as string;
        if (status === 'PLANNED' || status === 'SCHEDULED') {
          return (
            <Button size="sm" onClick={() => handleStart(id)}>
              <Play className="h-3 w-3 mr-1" /> Start
            </Button>
          );
        }
        if (status === 'IN_PROGRESS') {
          return (
            <Button size="sm" variant="secondary">
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
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Production Order
          </Button>
        }
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
      </div>
    </div>
  );
}
