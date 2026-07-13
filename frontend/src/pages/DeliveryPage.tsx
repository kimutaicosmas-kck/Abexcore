import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { deliveryApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { DeliveryForm } from '../components/forms/DeliveryForm';

export function DeliveryPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => deliveryApi.list().then((r) => r.data),
  });

  const markDeliveredMutation = useMutation({
    mutationFn: (id: string) => deliveryApi.updateStatus(id, { status: 'DELIVERED' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deliveries'] }),
  });

  const columns = [
    { key: 'deliveryNo', label: 'Delivery #' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.salesOrder as { customer: { name: string } })?.customer?.name || '-',
    },
    {
      key: 'vehicle',
      label: 'Vehicle',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.vehicle as { registrationNo: string })?.registrationNo || 'Unassigned',
    },
    {
      key: 'scheduledDate',
      label: 'Scheduled',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const status = row.status as string;
        if (status === 'DELIVERED' || status === 'CANCELLED') return null;
        return (
          <Button
            size="sm"
            loading={markDeliveredMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              markDeliveredMutation.mutate(row.id as string);
            }}
          >
            Mark Delivered
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Delivery Management"
        subtitle="Delivery notes, routes, drivers, and proof of delivery"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Delivery
          </Button>
        }
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Delivery" size="xl">
        <DeliveryForm onSuccess={() => setModalOpen(false)} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
