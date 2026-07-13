import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { qualityApi } from '../services/api';
import { PageHeader, Table, Badge, Button, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { QualityForm } from '../components/forms/QualityForm';

export function QualityPage() {
  const [modalOpen, setModalOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['quality'],
    queryFn: () => qualityApi.list().then((r) => r.data),
  });

  const columns = [
    { key: 'inspectionNo', label: 'Inspection #' },
    { key: 'type', label: 'Type' },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{val as string}</Badge>
      ),
    },
    { key: 'defectsFound', label: 'Defects' },
    {
      key: 'inspectedAt',
      label: 'Inspected',
      render: (val: unknown) => (val ? new Date(val as string).toLocaleDateString() : 'Pending'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quality Control"
        subtitle="Incoming, production, and finished product inspections"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Inspection
          </Button>
        }
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add Inspection" size="lg">
        <QualityForm onSuccess={() => setModalOpen(false)} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
