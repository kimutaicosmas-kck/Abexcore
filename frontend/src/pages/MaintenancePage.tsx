import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Card, Badge, getStatusBadge } from '../components/ui';

export function MaintenancePage() {
  const { data: machines } = useQuery({
    queryKey: ['machines'],
    queryFn: () => financeApi.machines().then((r) => r.data.data),
  });

  const { data: maintenance } = useQuery({
    queryKey: ['maintenance'],
    queryFn: () => financeApi.maintenance().then((r) => r.data.data),
  });

  return (
    <div>
      <PageHeader title="Machine Maintenance" subtitle="Track machines, schedules, repairs, and service history" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {machines?.map((machine: { id: string; code: string; name: string; type: string; status: string; capacity: string; location: string }) => (
          <Card key={machine.id}>
            <div className="space-y-2">
              <div className="flex justify-between items-start">
                <h3 className="font-semibold">{machine.name}</h3>
                <Badge variant={machine.status === 'operational' ? 'success' : 'warning'}>
                  {machine.status}
                </Badge>
              </div>
              <p className="text-sm text-gray-500">{machine.code} &middot; {machine.type}</p>
              <p className="text-sm">Capacity: {machine.capacity}</p>
              <p className="text-sm">Location: {machine.location}</p>
            </div>
          </Card>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-4">Maintenance Requests</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {maintenance?.length ? maintenance.map((req: { id: string; type: string; description: string; status: string; machine: { name: string } }) => (
          <Card key={req.id}>
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium">{req.machine?.name}</span>
              <Badge variant={getStatusBadge(req.status)}>{req.status}</Badge>
            </div>
            <p className="text-sm text-gray-600">{req.type}: {req.description}</p>
          </Card>
        )) : (
          <p className="text-gray-500">No maintenance requests</p>
        )}
      </div>
    </div>
  );
}
