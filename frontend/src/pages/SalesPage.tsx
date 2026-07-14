import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { operationsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { SalesOrderForm } from '../components/forms/SalesOrderForm';
import { QuotationForm } from '../components/forms/QuotationForm';

export function SalesPage() {
  const queryClient = useQueryClient();
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => operationsApi.salesOrders().then((r) => r.data),
  });

  const { data: quotations } = useQuery({
    queryKey: ['quotations'],
    queryFn: () => operationsApi.quotations().then((r) => r.data),
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => operationsApi.convertQuotation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      operationsApi.updateOrderStatus(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sales-orders'] }),
  });

  const NEXT_STATUS: Record<string, { status: string; label: string }> = {
    DRAFT: { status: 'CONFIRMED', label: 'Confirm' },
    PENDING: { status: 'CONFIRMED', label: 'Confirm' },
    CONFIRMED: { status: 'IN_PRODUCTION', label: 'Start Production' },
    IN_PRODUCTION: { status: 'READY', label: 'Mark Ready' },
    READY: { status: 'DISPATCHED', label: 'Dispatch' },
    DISPATCHED: { status: 'DELIVERED', label: 'Mark Delivered' },
    DELIVERED: { status: 'COMPLETED', label: 'Complete' },
  };

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
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const status = row.status as string;
        const next = NEXT_STATUS[status];
        if (!next || status === 'COMPLETED' || status === 'CANCELLED') return null;
        return (
          <Button
            size="sm"
            loading={statusMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              statusMutation.mutate({ id: row.id as string, status: next.status });
            }}
          >
            {next.label}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Sales Management"
        subtitle="Quotations, sales orders, and customer order tracking"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setQuotationModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Quotation
            </Button>
            <Button onClick={() => setOrderModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Sales Order
            </Button>
          </div>
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
              {
                key: 'actions',
                label: 'Actions',
                render: (_: unknown, row: Record<string, unknown>) => {
                  const status = row.status as string;
                  if (status === 'CONVERTED' || status === 'CANCELLED') return null;
                  return (
                    <Button
                      size="sm"
                      loading={convertMutation.isPending}
                      onClick={(e) => {
                        e.stopPropagation();
                        convertMutation.mutate(row.id as string);
                      }}
                    >
                      Convert
                    </Button>
                  );
                },
              },
            ]}
            data={quotations?.data || []}
          />
        </div>
      </div>

      <Modal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} title="New Sales Order" size="xl">
        <SalesOrderForm onSuccess={() => setOrderModalOpen(false)} onCancel={() => setOrderModalOpen(false)} />
      </Modal>

      <Modal open={quotationModalOpen} onClose={() => setQuotationModalOpen(false)} title="New Quotation" size="xl">
        <QuotationForm onSuccess={() => setQuotationModalOpen(false)} onCancel={() => setQuotationModalOpen(false)} />
      </Modal>
    </div>
  );
}
