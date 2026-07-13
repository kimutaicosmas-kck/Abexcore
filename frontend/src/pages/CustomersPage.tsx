import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { customersApi, crmApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { CustomerForm } from '../components/forms/CustomerForm';
import { ComplaintForm } from '../components/forms/ComplaintForm';
import { Customer } from '../types';

const tabs = ['Customers', 'Complaints', 'Opportunities'];

export function CustomersPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [complaintModalOpen, setComplaintModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);

  const { data: customers, isLoading: custLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list().then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: complaints, isLoading: compLoading } = useQuery({
    queryKey: ['complaints'],
    queryFn: () => crmApi.complaints().then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: opportunities, isLoading: oppLoading } = useQuery({
    queryKey: ['opportunities'],
    queryFn: () => crmApi.opportunities().then((r) => r.data),
    enabled: activeTab === 2,
  });

  const openCreate = () => {
    setEditing(null);
    setCustomerModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setCustomerModalOpen(true);
  };

  const closeCustomerModal = () => {
    setCustomerModalOpen(false);
    setEditing(null);
  };

  const customerColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => (
        <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    {
      key: 'creditLimit',
      label: 'Credit Limit',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val ? 'success' : 'danger'}>{val ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(row as unknown as Customer); }}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const complaintColumns = [
    { key: 'subject', label: 'Subject' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || '-',
    },
    {
      key: 'priority',
      label: 'Priority',
      render: (val: unknown) => (
        <Badge variant={val === 'high' || val === 'URGENT' ? 'danger' : 'info'}>{val as string}</Badge>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
  ];

  const opportunityColumns = [
    { key: 'title', label: 'Title' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || '-',
    },
    {
      key: 'value',
      label: 'Value',
      render: (val: unknown) => formatCurrency(val as number),
    },
    { key: 'stage', label: 'Stage' },
    {
      key: 'probability',
      label: 'Probability',
      render: (val: unknown) => `${val}%`,
    },
    {
      key: 'expectedCloseDate',
      label: 'Expected Close',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customer Management"
        subtitle="Manage dealers, retail shops, industries, and other customers"
        action={
          activeTab === 0 ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          ) : activeTab === 1 ? (
            <Button onClick={() => setComplaintModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Complaint
            </Button>
          ) : undefined
        }
      />

      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === i
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={customerColumns}
            data={(customers?.data as Customer[]) || []}
            loading={custLoading}
            onRowClick={(row) => openEdit(row as unknown as Customer)}
          />
        </div>
      )}

      {activeTab === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={complaintColumns} data={complaints?.data || []} loading={compLoading} />
        </div>
      )}

      {activeTab === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={opportunityColumns} data={opportunities?.data || []} loading={oppLoading} />
        </div>
      )}

      <Modal
        open={customerModalOpen}
        onClose={closeCustomerModal}
        title={editing ? 'Edit Customer' : 'Add Customer'}
        size="lg"
      >
        <CustomerForm customer={editing} onSuccess={closeCustomerModal} onCancel={closeCustomerModal} />
      </Modal>

      <Modal open={complaintModalOpen} onClose={() => setComplaintModalOpen(false)} title="Add Complaint" size="lg">
        <ComplaintForm onSuccess={() => setComplaintModalOpen(false)} onCancel={() => setComplaintModalOpen(false)} />
      </Modal>
    </div>
  );
}
