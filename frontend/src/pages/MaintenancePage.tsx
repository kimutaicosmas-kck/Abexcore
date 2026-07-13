import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CheckCircle } from 'lucide-react';
import { maintenanceApi } from '../services/api';
import { PageHeader, Card, Badge, Button, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { MaintenanceForm } from '../components/forms/MaintenanceForm';

export function MaintenancePage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: machines } = useQuery({
    queryKey: ['maintenance-machines'],
    queryFn: () => maintenanceApi.machines().then((r) => r.data.data),
  });

  const { data: requests } = useQuery({
    queryKey: ['maintenance-requests'],
    queryFn: () => maintenanceApi.requests().then((r) => r.data.data),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => maintenanceApi.completeRequest(id, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['maintenance-requests'] }),
  });

  return (
    <div>
      <PageHeader
        title="Machine Maintenance"
        subtitle="Track machines, schedules, repairs, and service history"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Schedule Maintenance
          </Button>
        }
      />

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
        {requests?.length ? requests.map((req: { id: string; type: string; description: string; status: string; machine: { name: string } }) => (
          <Card key={req.id}>
            <div className="flex justify-between items-start mb-2">
              <span className="font-medium">{req.machine?.name}</span>
              <Badge variant={getStatusBadge(req.status)}>{req.status}</Badge>
            </div>
            <p className="text-sm text-gray-600 mb-3">{req.type}: {req.description}</p>
            {req.status !== 'COMPLETED' && (
              <Button
                size="sm"
                variant="secondary"
                loading={completeMutation.isPending}
                onClick={() => completeMutation.mutate(req.id)}
              >
                <CheckCircle className="h-3 w-3 mr-1" /> Complete
              </Button>
            )}
          </Card>
        )) : (
          <p className="text-gray-500">No maintenance requests</p>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Schedule Maintenance" size="lg">
        <MaintenanceForm onSuccess={() => setModalOpen(false)} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
