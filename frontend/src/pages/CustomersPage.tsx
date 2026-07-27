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
  UserPlus,
  MessageSquarePlus,
  Target,
} from 'lucide-react';
import { customersApi, crmApi, operationsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  StatCard,
  StatGrid,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
  ConfirmDialog,
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
import { formatProductOptionLabel } from '../utils/productDisplay';

const tabs = ['Overview', 'Customers', 'Complaints', 'Opportunities', 'Warranties'];

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
  const { hasPermission, isSalesOfficer } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const [custPage, setCustPage] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [custSearchInput, setCustSearchInput] = useState('');
  const [custType, setCustType] = useState('');
  const [custActive, setCustActive] = useState('');
  const [custSalesPerson, setCustSalesPerson] = useState('');

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
  const [pendingDeleteContact, setPendingDeleteContact] = useState<{ customerId: string; contactId: string; name: string } | null>(null);

  const canCreate = hasPermission('customers:create');
  const canUpdate = hasPermission('customers:update');
  const canDelete = hasPermission('customers:delete');

  const { data: stats } = useQuery({
    queryKey: ['crm-stats'],
    queryFn: () => crmApi.stats().then((r) => r.data.data as CrmStats),
  });

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
    enabled: !isSalesOfficer,
  });

  const { data: customersRes, isLoading: custLoading, isError: custError, refetch: refetchCustomers } = useQuery({
    queryKey: ['customers', custPage, custSearch, custType, custActive, custSalesPerson],
    queryFn: () =>
      customersApi
        .list({
          page: custPage,
          limit: 15,
          search: custSearch || undefined,
          type: custType || undefined,
          isActive: custActive === '' ? undefined : custActive === 'true',
          salesPersonId: custSalesPerson || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
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
    enabled: activeTab === 0 || activeTab === 2,
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
    enabled: activeTab === 0 || activeTab === 3,
  });

  const { data: warrantiesRes, isLoading: warrLoading } = useQuery({
    queryKey: ['warranties', warrPage, warrSearch],
    queryFn: () =>
      crmApi
        .warranties({ page: warrPage, limit: 15, search: warrSearch || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 4,
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

  const goToTab = (index: number) => setActiveTab(index);

  const openCreate = () => { setEditing(null); setCustomerModalOpen(true); };
  const openEdit = (customer: Customer) => { setEditing(customer); setCustomerModalOpen(true); setDetailModalOpen(false); };
  const openDetail = (customer: Customer) => { setSelectedCustomer(customer); setDetailModalOpen(true); };
  const openEditOpportunity = (opp: Opportunity) => { setEditingOpportunity(opp); setOpportunityModalOpen(true); };

  const recentCustomers = activeTab === 0 ? ((customersRes?.data as Customer[]) || []).slice(0, 6) : [];
  const openComplaints = activeTab === 0
    ? ((complaintsRes?.data as Complaint[]) || []).filter((c) => !c.resolvedAt).slice(0, 5)
    : [];
  const pipelineOpps = activeTab === 0
    ? ((opportunitiesRes?.data as Opportunity[]) || []).filter((o) => !isClosedStage(o.stage)).slice(0, 5)
    : [];

  const salesPersonFilterOptions = [
    { value: '', label: 'All sales people' },
    { value: 'none', label: 'Unassigned' },
    ...(salesOfficers || []).map((o) => ({ value: o.id, label: o.name })),
  ];

  const customerColumns = [
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'salesPerson',
      label: 'Sales Person',
      render: (_: unknown, row: Record<string, unknown>) => {
        const person = row.salesPerson as Customer['salesPerson'];
        if (!person) return <span className="text-slate-400">—</span>;
        return `${person.firstName} ${person.lastName}`.trim();
      },
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
          ? formatProductOptionLabel(row.product as { sku: string; name: string })
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

  const toolbarActions = canCreate
    ? activeTab === 0 || activeTab === 1 ? (
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Customer
        </Button>
      ) : activeTab === 2 ? (
        <Button size="sm" onClick={() => setComplaintModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Complaint
        </Button>
      ) : activeTab === 3 ? (
        <Button size="sm" onClick={() => { setEditingOpportunity(null); setOpportunityModalOpen(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Opportunity
        </Button>
      ) : activeTab === 4 ? (
        <Button size="sm" onClick={() => setWarrantyModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Register Warranty
        </Button>
      ) : undefined
    : undefined;

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard title="Customers" value={stats.customers.active} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-primary-700" />
          <StatCard title="Open Complaints" value={stats.complaints.open} icon={<AlertCircle className="h-5 w-5 text-white" />} color="from-red-500 to-rose-600" />
          <StatCard title="Pipeline Value" value={formatCurrency(stats.opportunities.pipelineValue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Warranties Expiring" value={stats.warranties.expiringSoon} icon={<Shield className="h-5 w-5 text-white" />} color="from-primary-600 to-primary-800" />
          <StatCard title="Open Opportunities" value={stats.opportunities.open} icon={<Target className="h-5 w-5 text-white" />} color="from-slate-600 to-slate-800" />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.complaints.open > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(2)}>
              <AlertCircle className="h-4 w-4 mr-1.5 text-red-500" />
              {stats.complaints.open} open complaints
            </Button>
          ) : undefined
        }
      />

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
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Open complaints"
              action={
                openComplaints.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => goToTab(2)}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {openComplaints.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No open complaints" description="Customer issues will appear here for resolution." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {openComplaints.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-red-50/30">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-600">
                        <AlertCircle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{c.subject}</p>
                        <p className="text-xs text-slate-500">{c.customer?.name || '—'} · {formatDate(c.createdAt)}</p>
                      </div>
                      <Badge variant={c.priority === 'high' || c.priority === 'urgent' ? 'danger' : 'info'}>
                        {c.priority}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Pipeline opportunities"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(3)}>
                  Full pipeline
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              }
              padding={false}
            >
              {pipelineOpps.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No open opportunities" description="Add deals to track your sales pipeline." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pipelineOpps.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                      <Badge variant="info">{o.stage.replace(/_/g, ' ')}</Badge>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">{o.title}</p>
                        <p className="text-xs text-slate-400">{o.customer?.name || '—'}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-emerald-600">
                        {formatCurrency(Number(o.value))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap items-end gap-3">
            <form
              className="flex-1 min-w-[200px] sm:max-w-md"
              onSubmit={(e) => { e.preventDefault(); setCustSearch(custSearchInput); setCustPage(1); }}
            >
              <Input placeholder="Search customers…" value={custSearchInput} onChange={(e) => setCustSearchInput(e.target.value)} />
            </form>
            <Select options={CUSTOMER_TYPE_OPTIONS} value={custType} onChange={(e) => { setCustType(e.target.value); setCustPage(1); }} className="w-40" />
            <Select options={CUSTOMER_STATUS_OPTIONS} value={custActive} onChange={(e) => { setCustActive(e.target.value); setCustPage(1); }} className="w-36" />
            {!isSalesOfficer && (
              <Select
                options={salesPersonFilterOptions}
                value={custSalesPerson}
                onChange={(e) => { setCustSalesPerson(e.target.value); setCustPage(1); }}
                className="w-48"
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCustSearchInput('');
                setCustSearch('');
                setCustType('');
                setCustActive('');
                setCustSalesPerson('');
                setCustPage(1);
              }}
            >
              Clear
            </Button>
          </div>
          {custError && (
            <div className="px-4">
              <Alert variant="error" className="mb-4">
                Failed to load customers.{' '}
                <button type="button" className="underline font-medium" onClick={() => refetchCustomers()}>Retry</button>
              </Alert>
            </div>
          )}
          {(customersRes?.data?.length || 0) === 0 && !custLoading ? (
            <div className="p-6">
              <EmptyState
                title="No customers found"
                description="Try a different search or add a new customer."
                action={
                  canCreate ? (
                    <Button onClick={openCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add customer
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={customerColumns}
              data={(customersRes?.data as Customer[]) || []}
              loading={custLoading}
              onRowClick={(row) => openDetail(row as unknown as Customer)}
              responsive
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={customersRes?.pagination} page={custPage} onPageChange={setCustPage} label="customers" />
          </div>
        </DataPanel>
      )}

      {activeTab === 2 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap gap-3">
            <Input placeholder="Search complaints…" className="sm:max-w-md" value={compSearch} onChange={(e) => { setCompSearch(e.target.value); setCompPage(1); }} />
            <Select options={COMPLAINT_STATUS_OPTIONS} value={compStatus} onChange={(e) => { setCompStatus(e.target.value); setCompPage(1); }} className="w-40" />
          </div>
          {(complaintsRes?.data?.length || 0) === 0 && !compLoading ? (
            <div className="p-6">
              <EmptyState
                title="No complaints found"
                description="Customer complaints will appear here for tracking and resolution."
                action={
                  canCreate ? (
                    <Button onClick={() => setComplaintModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add complaint
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={complaintColumns}
              data={(complaintsRes?.data as Complaint[]) || []}
              loading={compLoading}
              responsive
              onRowClick={(row) => { setSelectedComplaint(row as unknown as Complaint); setComplaintDetailOpen(true); }}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={complaintsRes?.pagination} page={compPage} onPageChange={setCompPage} label="complaints" />
          </div>
        </DataPanel>
      )}

      {activeTab === 3 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap gap-3">
            <Input placeholder="Search opportunities…" className="sm:max-w-md" value={oppSearch} onChange={(e) => { setOppSearch(e.target.value); setOppPage(1); }} />
            <Select options={OPPORTUNITY_STATUS_OPTIONS} value={oppStatus} onChange={(e) => { setOppStatus(e.target.value); setOppPage(1); }} className="w-44" />
          </div>
          {(opportunitiesRes?.data?.length || 0) === 0 && !oppLoading ? (
            <div className="p-6">
              <EmptyState
                title="No opportunities found"
                description="Track sales deals through your pipeline stages."
                action={
                  canCreate ? (
                    <Button onClick={() => { setEditingOpportunity(null); setOpportunityModalOpen(true); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add opportunity
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={opportunityColumns} data={(opportunitiesRes?.data as Opportunity[]) || []} loading={oppLoading} responsive embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={opportunitiesRes?.pagination} page={oppPage} onPageChange={setOppPage} label="opportunities" />
          </div>
        </DataPanel>
      )}

      {activeTab === 4 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input placeholder="Search warranties…" value={warrSearch} onChange={(e) => { setWarrSearch(e.target.value); setWarrPage(1); }} />
          </div>
          {(warrantiesRes?.data?.length || 0) === 0 && !warrLoading ? (
            <div className="p-6">
              <EmptyState
                title="No warranties found"
                description="Register product warranties for your customers."
                action={
                  canCreate ? (
                    <Button onClick={() => setWarrantyModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Register warranty
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={warrantyColumns} data={(warrantiesRes?.data as Warranty[]) || []} loading={warrLoading} responsive embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={warrantiesRes?.pagination} page={warrPage} onPageChange={setWarrPage} label="warranties" />
          </div>
        </DataPanel>
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
              <div>
                <p className="text-slate-500">Sales Person</p>
                <p className="font-semibold">
                  {customerDetail.salesPerson
                    ? `${customerDetail.salesPerson.firstName} ${customerDetail.salesPerson.lastName}`.trim()
                    : '—'}
                </p>
              </div>
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
                        <Button size="sm" variant="ghost" loading={deleteContactMutation.isPending} onClick={() => setPendingDeleteContact({ customerId: customerDetail.id, contactId: c.id, name: c.name })}>
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
                    <div key={o.id} className="grid grid-cols-2 gap-x-3 gap-y-1 py-2 text-sm sm:flex sm:items-center sm:justify-between">
                      <span className="font-medium truncate">{o.orderNumber}</span>
                      <span className="tabular-nums text-right sm:text-left">{formatCurrency(Number(o.totalAmount))}</span>
                      <span className="col-span-2 sm:col-span-1">
                        <Badge variant={getStatusBadge(o.status)}>{o.status.replace(/_/g, ' ')}</Badge>
                      </span>
                      <span className="text-slate-500 text-xs sm:text-sm col-span-2 sm:col-span-1">{formatDate(o.orderDate)}</span>
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

      <ConfirmDialog
        open={!!pendingDeleteContact}
        title="Delete contact?"
        message={`Remove ${pendingDeleteContact?.name || 'this contact'} from the customer record?`}
        confirmLabel="Delete"
        loading={deleteContactMutation.isPending}
        onCancel={() => setPendingDeleteContact(null)}
        onConfirm={() => {
          if (!pendingDeleteContact) return;
          deleteContactMutation.mutate(
            { customerId: pendingDeleteContact.customerId, contactId: pendingDeleteContact.contactId },
            { onSettled: () => setPendingDeleteContact(null) }
          );
        }}
      />
    </div>
  );
}
