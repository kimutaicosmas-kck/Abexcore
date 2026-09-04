import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { operationsApi } from '../../services/api';
import { Alert, Button, Input, Select } from '../ui';
import { SalesOrder } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';

interface SalesOrderReassignFormProps {
  order: SalesOrder;
  onSuccess: (updated: SalesOrder) => void;
}

export function SalesOrderReassignForm({ order, onSuccess }: SalesOrderReassignFormProps) {
  const queryClient = useQueryClient();
  const [salesPersonId, setSalesPersonId] = useState(order.salesPersonId || order.salesPerson?.id || '');
  const [reason, setReason] = useState('');

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
  });

  const options = [
    { value: '', label: 'Unassigned / house account' },
    ...(salesOfficers || []).map((o) => ({ value: o.id, label: o.name })),
  ];

  const mutation = useMutation({
    mutationFn: () =>
      operationsApi.updateOrderAssignment(order.id, {
        salesPersonId: salesPersonId || null,
        reason,
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order', order.id] });
      onSuccess(response.data.data as SalesOrder);
      setReason('');
    },
  });

  const currentId = order.salesPersonId || order.salesPerson?.id || '';
  const unchanged = (salesPersonId || '') === (currentId || '');

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900">Reassign sales person</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Move this order to the correct salesperson for reporting and commission tracking.
        </p>
      </div>
      <Select
        label="Sales person"
        options={options}
        value={salesPersonId}
        onChange={(e) => setSalesPersonId(e.target.value)}
      />
      <Input
        label="Reason *"
        placeholder="e.g. Order was created under the wrong account"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mutation.isError && (
        <Alert variant="error">{getApiErrorMessage(mutation.error)}</Alert>
      )}
      <Button
        type="button"
        size="sm"
        loading={mutation.isPending}
        disabled={unchanged || !reason.trim()}
        onClick={() => mutation.mutate()}
      >
        Save assignment
      </Button>
    </div>
  );
}
