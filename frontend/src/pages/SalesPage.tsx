import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { operationsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { SalesOrderForm } from '../components/forms/SalesOrderForm';

export function SalesPage() {
  const [modalOpen, setModalOpen] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => operationsApi.salesOrders().then((r) => r.data),
  });

  const { data: quotations } = useQuery({
    queryKey: ['quotations'],
    queryFn: () => operationsApi.quotations().then((r) => r.data),
  });

  const orderColumns = [
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || '-',
    },
    {
      key: 'orderDate',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'totalAmount',
      label: 'Total',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales Management"
        subtitle="Quotations, sales orders, and customer order tracking"
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Sales Order
          </Button>
        }
      />

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Sales Orders</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={orderColumns} data={orders?.data || []} loading={isLoading} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Quotations</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={[
              { key: 'quotationNo', label: 'Quote #' },
              {
                key: 'customer',
                label: 'Customer',
                render: (_: unknown, row: Record<string, unknown>) =>
                  (row.customer as { name: string })?.name || '-',
              },
              {
                key: 'totalAmount',
                label: 'Amount',
                render: (val: unknown) => formatCurrency(val as number),
              },
              {
                key: 'status',
                label: 'Status',
                render: (val: unknown) => (
                  <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
                ),
              },
            ]}
            data={quotations?.data || []}
          />
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New Sales Order" size="xl">
        <SalesOrderForm onSuccess={() => setModalOpen(false)} onCancel={() => setModalOpen(false)} />
      </Modal>
    </div>
  );
}
