import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Table, Badge, getStatusBadge } from '../components/ui';

export function QualityPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['quality'],
    queryFn: () => financeApi.quality().then((r) => r.data),
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
      render: (val: unknown) => val ? new Date(val as string).toLocaleDateString() : 'Pending',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Quality Control"
        subtitle="Incoming, production, and finished product inspections"
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
      </div>
    </div>
  );
}
