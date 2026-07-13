import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { inventoryApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';

export function ProcurementPage() {
  const { data: purchaseOrders, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => inventoryApi.purchaseOrders().then((r) => r.data),
  });

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers().then((r) => r.data),
  });

  const poColumns = [
    { key: 'poNumber', label: 'PO Number' },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.supplier as { name: string })?.name || '-',
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

  const supplierColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Supplier Name' },
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    {
      key: 'leadTimeDays',
      label: 'Lead Time',
      render: (val: unknown) => `${val} days`,
    },
    {
      key: 'rating',
      label: 'Rating',
      render: (val: unknown) => `${val}/5`,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Procurement"
        subtitle="Purchase requisitions, RFQs, purchase orders, and supplier management"
        action={
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Purchase Order
          </Button>
        }
      />

      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Purchase Orders</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={poColumns} data={purchaseOrders?.data || []} loading={isLoading} />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Suppliers</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={supplierColumns} data={suppliers?.data || []} />
        </div>
      </div>
    </div>
  );
}
