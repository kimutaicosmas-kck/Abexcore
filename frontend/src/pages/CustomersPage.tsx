import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  AlertCircle,
  TrendingUp,
  Shield,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { customersApi, crmApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  StatCard,
  Alert,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { CustomerForm } from '../components/forms/CustomerForm';
import { ComplaintForm } from '../components/forms/ComplaintForm';
import { OpportunityForm } from '../components/forms/OpportunityForm';
import { ComplaintResolveForm } from '../components/forms/ComplaintResolveForm';
import { WarrantyForm } from '../components/forms/WarrantyForm';
import { ContactForm } from '../components/forms/ContactForm';
import { useAuth } from '../contexts/AuthContext';
import { Complaint, CrmStats, Customer, Opportunity, Warranty } from '../types';

const tabs = ['Customers', 'Complaints', 'Opportunities', 'Warranties'];

const CUSTOMER_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'DEALER', label: 'Dealer' },
  { value: 'RETAIL_SHOP', label: 'Retail Shop' },
  { value: 'INDUSTRY', label: 'Industry' },
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'NGO', label: 'NGO' },
];

const CUSTOMER_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

const COMPLAINT_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
];

const OPPORTUNITY_STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open pipeline' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

function isClosedStage(stage: string) {
  const s = stage.toUpperCase();
  return s === 'CLOSED_WON' || s === 'CLOSED_LOST';
}

function warrantyStatus(endDate: string) {
  const end = new Date(endDate);
  const now = new Date();
  if (end < now) return { label: 'Expired', variant: 'danger' as const };
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 30) return { label: 'Expiring soon', variant: 'warning' as const };
  return { label: 'Active', variant: 'success' as const };
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const [custPage, setCustPage] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [custSearchInput, setCustSearchInput] = useState('');
  const [custType, setCustType] = useState('');
  const [custActive, setCustActive] = useState('');

  const [compPage, setCompPage] = useState(1);
  const [compSearch, setCompSearch] = useState('');
  const [compStatus, setCompStatus] = useState('');

  const [oppPage, setOppPage] = useState(1);
  const [oppSearch, setOppSearch] = useState('');
  const [oppStatus, setOppStatus] = useState('');

  const [warrPage, setWarrPage] = useState(1);
  const [warrSearch, setWarrSearch] = useState('');

  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [complaintModalOpen, setComplaintModalOpen] = useState(false);
  const [opportunityModalOpen, setOpportunityModalOpen] = useState(false);
  const [warrantyModalOpen, setWarrantyModalOpen] = useState(false);
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [complaintDetailOpen, setComplaintDetailOpen] = useState(false);

  const [editing, setEditing] = useState<Customer | null>(null);
  const [editingOpportunity, setEditingOpportunity] = useState<Opportunity | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedComplaint, setSelectedComplaint] = useState<Complaint | null>(null);
  const [resolvingComplaint, setResolvingComplaint] = useState<{ id: string; subject: string } | null>(null);

  const canCreate = hasPermission('customers:create');
  const canUpdate = hasPermission('customers:update');
  const canDelete = hasPermission('customers:delete');

  const { data: stats } = useQuery({
    queryKey: ['crm-stats'],
    queryFn: () => crmApi.stats().then((r) => r.data.data as CrmStats),
  });

  const { data: customersRes, isLoading: custLoading, isError: custError, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers', custPage, custSearch, custType, custActive],
    queryFn: () =>
      customersApi
        .list({
          page: custPage,
          limit: 15,
          search: custSearch || undefined,
          type: custType || undefined,
          isActive: custActive === '' ? undefined : custActive === 'true',
        })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: complaintsRes, isLoading: compLoading } = useQuery({
    queryKey: ['complaints', compPage, compSearch, compStatus],
    queryFn: () =>
      crmApi
        .complaints({
          page: compPage,
          limit: 15,
          search: compSearch || undefined,
          status: compStatus || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: opportunitiesRes, isLoading: oppLoading } = useQuery({
    queryKey: ['opportunities', oppPage, oppSearch, oppStatus],
    queryFn: () =>
      crmApi
        .opportunities({
          page: oppPage,
          limit: 15,
          search: oppSearch || undefined,
          status: oppStatus || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: warrantiesRes, isLoading: warrLoading } = useQuery({
    queryKey: ['warranties', warrPage, warrSearch],
    queryFn: () =>
      crmApi
        .warranties({ page: warrPage, limit: 15, search: warrSearch || undefined })
        .then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: customerDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['customer-detail', selectedCustomer?.id],
    queryFn: () => customersApi.get(selectedCustomer!.id).then((r) => r.data.data as Customer),
    enabled: !!selectedCustomer && detailModalOpen,
  });

  const { data: customerOrders } = useQuery({
    queryKey: ['customer-orders', selectedCustomer?.id],
    queryFn: () => customersApi.orders(selectedCustomer!.id).then((r) => r.data.data),
    enabled: !!selectedCustomer && detailModalOpen,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      setDeactivateModalOpen(false);
      setDetailModalOpen(false);
      setSelectedCustomer(null);
    },
  });

  const advanceMutation = useMutation({
    mutationFn: (id: string) => crmApi.advanceOpportunity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: ({ customerId, contactId }: { customerId: string; contactId: string }) =>
      customersApi.deleteContact(customerId, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-detail', selectedCustomer?.id] });
    },
  });

  const openCreate = () => { setEditing(null); setCustomerModalOpen(true); };
  const openEdit = (customer: Customer) => { setEditing(customer); setCustomerModalOpen(true); setDetailModalOpen(false); };
  const openDetail = (customer: Customer) => { setSelectedCustomer(customer); setDetailModalOpen(true); };
  const openEditOpportunity = (opp: Opportunity) => { setEditingOpportunity(opp); setOpportunityModalOpen(true); };

  const customerColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>,
    },
    { key: 'city', label: 'City' },
    { key: 'phone', label: 'Phone' },
    {
      key: 'creditLimit',
      label: 'Credit',
      render: (_: unknown, row: Record<string, unknown>) => (
        <span className="text-sm">
          {formatCurrency(Number(row.creditUsed))} / {formatCurrency(Number(row.creditLimit))}
        </span>
      ),
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
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canUpdate && (
            <Button size="sm" variant="ghost" onClick={() => openEdit(row as unknown as Customer)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
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
        <Badge variant={val === 'high' || val === 'urgent' ? 'danger' : 'info'}>{val as string}</Badge>
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
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (row.status === 'APPROVED' || row.resolvedAt) return null;
        return canUpdate ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setResolvingComplaint({ id: row.id as string, subject: row.subject as string });
              setResolveModalOpen(true);
            }}
          >
            Resolve
          </Button>
        ) : null;
      },
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
    {
      key: 'stage',
      label: 'Stage',
      render: (val: unknown) => (
        <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'probability',
      label: 'Prob.',
      render: (val: unknown) => `${val}%`,
    },
    {
      key: 'expectedCloseDate',
      label: 'Expected Close',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canUpdate && (
            <>
              <Button size="sm" variant="ghost" onClick={() => openEditOpportunity(row as unknown as Opportunity)}>
                <Pencil className="h-4 w-4" />
              </Button>
              {!isClosedStage(row.stage as string) && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={advanceMutation.isPending}
                  onClick={() => advanceMutation.mutate(row.id as string)}
                  title="Advance stage"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  const warrantyColumns = [
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || '-',
    },
    {
      key: 'product',
      label: 'Product',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.product as { name: string; sku: string })
          ? `${(row.product as { sku: string }).sku} - ${(row.product as { name: string }).name}`
          : '-',
    },
    { key: 'serialNumber', label: 'Serial #', render: (val: unknown) => (val as string) || '—' },
    {
      key: 'startDate',
      label: 'Start',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'endDate',
      label: 'End',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, row: Record<string, unknown>) => {
        const s = warrantyStatus(row.endDate as string);
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
  ];

  const renderPagination = (
    pagination: { page: number; totalPages: number; total: number } | undefined,
    page: number,
    setPage: (fn: (p: number) => number) => void
  ) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} records)</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader subtitle="Customer relationships, complaints, pipeline, and warranties" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Customers" value={stats.customers.active} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Open Complaints" value={stats.complaints.open} icon={<AlertCircle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Pipeline Value" value={formatCurrency(stats.opportunities.pipelineValue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Warranties Expiring" value={stats.warranties.expiringSoon} icon={<Shield className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setCustPage(1);
          setCompPage(1);
          setOppPage(1);
          setWarrPage(1);
        }}
        actions={
          canCreate ? (
            activeTab === 0 ? (
              <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" />Add Customer</Button>
            ) : activeTab === 1 ? (
              <Button onClick={() => setComplaintModalOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Complaint</Button>
            ) : activeTab === 2 ? (
              <Button onClick={() => { setEditingOpportunity(null); setOpportunityModalOpen(true); }}>
                <Plus className="h-4 w-4 mr-2" />Add Opportunity
              </Button>
            ) : (
              <Button onClick={() => setWarrantyModalOpen(true)}><Plus className="h-4 w-4 mr-2" />Register Warranty</Button>
            )
          ) : undefined
        }
      />

      {activeTab === 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <form
              className="flex-1 min-w-[200px] max-w-sm"
              onSubmit={(e) => { e.preventDefault(); setCustSearch(custSearchInput); setCustPage(1); }}
            >
              <Input placeholder="Search customers…" value={custSearchInput} onChange={(e) => setCustSearchInput(e.target.value)} />
            </form>
            <Select options={CUSTOMER_TYPE_OPTIONS} value={custType} onChange={(e) => { setCustType(e.target.value); setCustPage(1); }} className="w-40" />
            <Select options={CUSTOMER_STATUS_OPTIONS} value={custActive} onChange={(e) => { setCustActive(e.target.value); setCustPage(1); }} className="w-36" />
            <Button variant="secondary" size="sm" onClick={() => { setCustSearchInput(''); setCustSearch(''); setCustType(''); setCustActive(''); setCustPage(1); }}>Clear</Button>
          </div>
          {custError && (
            <Alert variant="error" className="mb-4">
              Failed to load customers. <button type="button" className="underline" onClick={() => refetchCustomers()}>Retry</button>
            </Alert>
          )}
          <Table columns={customerColumns} data={(customersRes?.data as Customer[]) || []} loading={custLoading} onRowClick={(row) => openDetail(row as unknown as Customer)} />
          {renderPagination(customersRes?.pagination, custPage, setCustPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search complaints…" className="max-w-sm" value={compSearch} onChange={(e) => { setCompSearch(e.target.value); setCompPage(1); }} />
            <Select options={COMPLAINT_STATUS_OPTIONS} value={compStatus} onChange={(e) => { setCompStatus(e.target.value); setCompPage(1); }} className="w-40" />
          </div>
          <Table
            columns={complaintColumns}
            data={(complaintsRes?.data as Complaint[]) || []}
            loading={compLoading}
            onRowClick={(row) => { setSelectedComplaint(row as unknown as Complaint); setComplaintDetailOpen(true); }}
          />
          {renderPagination(complaintsRes?.pagination, compPage, setCompPage)}
        </>
      )}

      {activeTab === 2 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search opportunities…" className="max-w-sm" value={oppSearch} onChange={(e) => { setOppSearch(e.target.value); setOppPage(1); }} />
            <Select options={OPPORTUNITY_STATUS_OPTIONS} value={oppStatus} onChange={(e) => { setOppStatus(e.target.value); setOppPage(1); }} className="w-44" />
          </div>
          <Table columns={opportunityColumns} data={(opportunitiesRes?.data as Opportunity[]) || []} loading={oppLoading} />
          {renderPagination(opportunitiesRes?.pagination, oppPage, setOppPage)}
        </>
      )}

      {activeTab === 3 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search warranties…" value={warrSearch} onChange={(e) => { setWarrSearch(e.target.value); setWarrPage(1); }} />
          </div>
          <Table columns={warrantyColumns} data={(warrantiesRes?.data as Warranty[]) || []} loading={warrLoading} />
          {renderPagination(warrantiesRes?.pagination, warrPage, setWarrPage)}
        </>
      )}

      <Modal open={customerModalOpen} onClose={() => { setCustomerModalOpen(false); setEditing(null); }} title={editing ? 'Edit Customer' : 'Add Customer'} size="lg">
        <CustomerForm customer={editing} onSuccess={() => { setCustomerModalOpen(false); setEditing(null); }} onCancel={() => { setCustomerModalOpen(false); setEditing(null); }} />
      </Modal>

      <Modal open={complaintModalOpen} onClose={() => setComplaintModalOpen(false)} title="Add Complaint" size="lg">
        <ComplaintForm onSuccess={() => setComplaintModalOpen(false)} onCancel={() => setComplaintModalOpen(false)} />
      </Modal>

      <Modal open={opportunityModalOpen} onClose={() => { setOpportunityModalOpen(false); setEditingOpportunity(null); }} title={editingOpportunity ? 'Edit Opportunity' : 'Add Opportunity'} size="lg">
        <OpportunityForm opportunity={editingOpportunity} onSuccess={() => { setOpportunityModalOpen(false); setEditingOpportunity(null); }} onCancel={() => { setOpportunityModalOpen(false); setEditingOpportunity(null); }} />
      </Modal>

      <Modal open={warrantyModalOpen} onClose={() => setWarrantyModalOpen(false)} title="Register Warranty" size="lg">
        <WarrantyForm onSuccess={() => setWarrantyModalOpen(false)} onCancel={() => setWarrantyModalOpen(false)} />
      </Modal>

      <Modal open={resolveModalOpen} onClose={() => { setResolveModalOpen(false); setResolvingComplaint(null); }} title="Resolve Complaint" size="md">
        {resolvingComplaint && (
          <ComplaintResolveForm complaintId={resolvingComplaint.id} subject={resolvingComplaint.subject} onSuccess={() => { setResolveModalOpen(false); setResolvingComplaint(null); }} onCancel={() => { setResolveModalOpen(false); setResolvingComplaint(null); }} />
        )}
      </Modal>

      <Modal open={contactModalOpen} onClose={() => setContactModalOpen(false)} title="Add Contact" size="md">
        {selectedCustomer && (
          <ContactForm customerId={selectedCustomer.id} onSuccess={() => setContactModalOpen(false)} onCancel={() => setContactModalOpen(false)} />
        )}
      </Modal>

      <Modal open={detailModalOpen} onClose={() => { setDetailModalOpen(false); setSelectedCustomer(null); }} title="Customer Details" size="xl">
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : customerDetail ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div><p className="text-slate-500">Code</p><p className="font-semibold">{customerDetail.code}</p></div>
              <div><p className="text-slate-500">Name</p><p className="font-semibold">{customerDetail.name}</p></div>
              <div><p className="text-slate-500">Type</p><Badge variant="info">{customerDetail.type.replace(/_/g, ' ')}</Badge></div>
              <div><p className="text-slate-500">Email</p><p className="font-semibold">{customerDetail.email || '—'}</p></div>
              <div><p className="text-slate-500">Phone</p><p className="font-semibold">{customerDetail.phone || '—'}</p></div>
              <div><p className="text-slate-500">City</p><p className="font-semibold">{customerDetail.city || '—'}</p></div>
              <div><p className="text-slate-500">Credit Used</p><p className="font-semibold">{formatCurrency(Number(customerDetail.creditUsed))}</p></div>
              <div><p className="text-slate-500">Credit Limit</p><p className="font-semibold">{formatCurrency(Number(customerDetail.creditLimit))}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={customerDetail.isActive ? 'success' : 'danger'}>{customerDetail.isActive ? 'Active' : 'Inactive'}</Badge></div>
            </div>

            <Card title="Contacts" action={canUpdate ? <Button size="sm" onClick={() => setContactModalOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add</Button> : undefined}>
              {customerDetail.contacts?.length ? (
                <div className="space-y-2">
                  {customerDetail.contacts.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-2 border-b border-border/60 last:border-0">
                      <div>
                        <p className="font-medium text-sm">{c.name}{c.isPrimary && <span className="ml-2"><Badge variant="info">Primary</Badge></span>}</p>
                        <p className="text-xs text-slate-500">{c.title || '—'} · {c.email || c.phone || 'No contact info'}</p>
                      </div>
                      {canUpdate && (
                        <Button size="sm" variant="ghost" loading={deleteContactMutation.isPending} onClick={() => deleteContactMutation.mutate({ customerId: customerDetail.id, contactId: c.id })}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No contacts yet.</p>
              )}
            </Card>

            <Card title="Recent Orders">
              {Array.isArray(customerOrders) && customerOrders.length > 0 ? (
                <div className="space-y-2">
                  {(customerOrders as { id: string; orderNumber: string; totalAmount: number; status: string; orderDate: string }[]).slice(0, 5).map((o) => (
                    <div key={o.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="font-medium">{o.orderNumber}</span>
                      <span>{formatCurrency(Number(o.totalAmount))}</span>
                      <Badge variant={getStatusBadge(o.status)}>{o.status.replace(/_/g, ' ')}</Badge>
                      <span className="text-slate-500">{formatDate(o.orderDate)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No orders yet.</p>
              )}
            </Card>

            {customerDetail._count && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Orders', value: customerDetail._count.salesOrders },
                  { label: 'Invoices', value: customerDetail._count.invoices },
                  { label: 'Complaints', value: customerDetail._count.complaints },
                  { label: 'Opportunities', value: customerDetail._count.opportunities },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl bg-surface-muted/60 px-3 py-2 text-center">
                    <p className="text-lg font-bold text-slate-900">{item.value}</p>
                    <p className="text-xs text-slate-500">{item.label}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              {canUpdate && <Button variant="secondary" onClick={() => openEdit(customerDetail)}><Pencil className="h-4 w-4 mr-1.5" />Edit</Button>}
              {canDelete && customerDetail.isActive && (
                <Button variant="danger" onClick={() => setDeactivateModalOpen(true)}><Trash2 className="h-4 w-4 mr-1.5" />Deactivate</Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={complaintDetailOpen} onClose={() => { setComplaintDetailOpen(false); setSelectedComplaint(null); }} title="Complaint Details" size="lg">
        {selectedComplaint && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Subject</p><p className="font-semibold">{selectedComplaint.subject}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{selectedComplaint.customer?.name}</p></div>
              <div><p className="text-slate-500">Priority</p><Badge variant={selectedComplaint.priority === 'high' ? 'danger' : 'info'}>{selectedComplaint.priority}</Badge></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selectedComplaint.status)}>{selectedComplaint.status}</Badge></div>
            </div>
            <div><p className="text-slate-500 mb-1">Description</p><p className="text-slate-800 whitespace-pre-wrap">{selectedComplaint.description}</p></div>
            {selectedComplaint.resolution && (
              <div className="rounded-xl bg-emerald-50 p-3 ring-1 ring-emerald-100">
                <p className="text-emerald-800 font-medium mb-1">Resolution</p>
                <p className="text-emerald-900">{selectedComplaint.resolution}</p>
                {selectedComplaint.resolvedAt && <p className="text-xs text-emerald-700 mt-2">Resolved {formatDate(selectedComplaint.resolvedAt)}</p>}
              </div>
            )}
            {!selectedComplaint.resolvedAt && canUpdate && (
              <div className="flex justify-end pt-2">
                <Button onClick={() => { setResolvingComplaint({ id: selectedComplaint.id, subject: selectedComplaint.subject }); setComplaintDetailOpen(false); setResolveModalOpen(true); }}>
                  Resolve Complaint <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={deactivateModalOpen} onClose={() => setDeactivateModalOpen(false)} title="Deactivate Customer" size="md">
        <p className="text-sm text-slate-600 mb-4">
          Deactivate <strong>{selectedCustomer?.name || customerDetail?.name}</strong>? Their record will be archived.
        </p>
        {deactivateMutation.isError && <Alert variant="error" className="mb-4">Failed to deactivate customer.</Alert>}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeactivateModalOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={deactivateMutation.isPending} onClick={() => (selectedCustomer || customerDetail) && deactivateMutation.mutate((selectedCustomer || customerDetail)!.id)}>
            Deactivate
          </Button>
        </div>
      </Modal>
    </div>
  );
}
