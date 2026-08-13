import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ShoppingCart,
  FileText,
  TrendingUp,
  CalendarDays,
  Receipt,
  AlertTriangle,
  ChevronRight,
  Download,
  Target,
  Pencil,
  XCircle,
  Truck,
} from 'lucide-react';
import { operationsApi } from '../services/api';
import { downloadFile } from '../utils/download';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  StatCard,
  StatGrid,
  Card,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
  ConfirmDialog,
  getApiErrorMessage,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { SalesOrderForm } from '../components/forms/SalesOrderForm';
import { SalesOrderEditForm } from '../components/forms/SalesOrderEditForm';
import { QuotationForm } from '../components/forms/QuotationForm';
import { useAuth } from '../contexts/AuthContext';
import { canManageSalesTargets, isSalesBookOwner } from '../utils/salesTargets';
import { SalesOrder, SalesQuotation, SalesStats } from '../types';

const COMPANY_TABS = ['Sales Orders', 'Quotations'];
const MY_BOOK_TABS = ['My Orders', 'Quotations'];

const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'IN_PRODUCTION', label: 'In Production' },
  { value: 'READY', label: 'Ready' },
  { value: 'PARTIALLY_DELIVERED', label: 'Partially Delivered' },
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const QUOTE_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const EDITABLE_ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY',
  'PARTIALLY_DELIVERED',
  'DISPATCHED',
];

const CANCELLABLE_ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'IN_PRODUCTION', 'READY'];

const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'CONFIRMED', label: 'Confirm' },
  DISPATCHED: { status: 'COMPLETED', label: 'Complete' },
  DELIVERED: { status: 'COMPLETED', label: 'Complete' },
};

function canCancelOrder(status: string, isSalesOfficer: boolean): boolean {
  if (!CANCELLABLE_ORDER_STATUSES.includes(status)) return false;
  if (isSalesOfficer) return ['PENDING', 'CONFIRMED'].includes(status);
  return true;
}

function getNextOrderAction(
  status: string,
  isSalesOfficer: boolean
): { status: string; label: string } | null {
  if (isSalesOfficer && status === 'CONFIRMED') return null;
  if (!isSalesOfficer && status === 'CONFIRMED') {
    return { status: 'READY', label: 'Mark Ready for Delivery' };
  }
  const next = NEXT_STATUS[status];
  if (!next) return null;
  if (status === 'CONFIRMED') return null;
  return next;
}

export function SalesPage() {
  const queryClient = useQueryClient();
  const { hasPermission, isSalesOfficer, user } = useAuth();
  const myBook = isSalesBookOwner(user?.role?.name);
  const tabs = myBook ? MY_BOOK_TABS : COMPANY_TABS;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdFromUrl = searchParams.get('orderId');
  const [activeTab, setActiveTab] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [quotePage, setQuotePage] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [quoteStatus, setQuoteStatus] = useState('');
  /** Empty string = all dates. Sales officers see all their orders by default. */
  const [orderDate, setOrderDate] = useState('');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<SalesQuotation | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [quoteDetailOpen, setQuoteDetailOpen] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ text: string; variant: 'error' | 'info' } | null>(null);
  const [quoteFeedback, setQuoteFeedback] = useState<{ text: string; variant: 'error' | 'info' } | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ id: string; status: string; label: string } | null>(null);
  const [orderEditMode, setOrderEditMode] = useState(false);
  const [selectedDeliveryOrderIds, setSelectedDeliveryOrderIds] = useState<string[]>([]);

  const canCreate = hasPermission('sales:create');
  const canUpdate = hasPermission('sales:update');
  const canReadSales = hasPermission('sales:read');
  const canCreateDelivery = hasPermission('delivery:create');

  const isDeliverableStatus = (status: string) =>
    status === 'READY' || status === 'PARTIALLY_DELIVERED';

  const toggleDeliveryOrder = (orderId: string, checked: boolean) => {
    setSelectedDeliveryOrderIds((prev) => {
      if (checked) return prev.includes(orderId) ? prev : [...prev, orderId];
      return prev.filter((id) => id !== orderId);
    });
  };

  const startBulkDelivery = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const unique = [...new Set(orderIds.filter(Boolean))];
    if (unique.length === 0) return;
    setSelectedDeliveryOrderIds([]);
    // Query params survive remounts; router state alone was getting cleared before the modal opened.
    const params = new URLSearchParams({
      create: '1',
      orders: unique.join(','),
    });
    navigate(`/delivery?${params.toString()}`);
  };
  const canViewPerformance = hasPermission('reports:read') || hasPermission('finance:read');
  const canManageTargets = canManageSalesTargets(user?.role?.name, hasPermission);
  const canDownloadInvoice = hasPermission('finance:read');
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderIdFromUrl) return;

    setActiveTab(0);
    operationsApi
      .getSalesOrder(orderIdFromUrl)
      .then((r) => {
        const order = r.data.data as SalesOrder;
        setStatusFeedback(null);
        setSelectedOrder(order);
        setOrderDetailOpen(true);
      })
      .catch(() => {
        setStatusFeedback({
          text: 'Could not open the sales order from this notification.',
          variant: 'error',
        });
      });
  }, [orderIdFromUrl]);

  const { data: orderDetail } = useQuery({
    queryKey: ['sales-order', selectedOrder?.id],
    queryFn: () =>
      operationsApi.getSalesOrder(selectedOrder!.id).then((r) => r.data.data as SalesOrder),
    enabled: orderDetailOpen && !!selectedOrder?.id,
  });

  const activeOrder = orderDetail ?? selectedOrder;

  const { data: stats } = useQuery({
    queryKey: ['sales-stats'],
    queryFn: () => operationsApi.stats().then((r) => r.data.data as SalesStats),
    enabled: canReadSales,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['sales-orders', orderPage, orderSearch, orderStatus, orderDate],
    queryFn: () =>
      operationsApi
        .salesOrders({
          page: orderPage,
          limit: 15,
          search: orderSearch || undefined,
          status: orderStatus || undefined,
          date: orderDate || undefined,
        })
        .then((r) => r.data),
    enabled: canReadSales && activeTab === 0,
  });

  const { data: quotations, isLoading: quotesLoading } = useQuery({
    queryKey: ['quotations', quotePage, quoteSearch, quoteStatus],
    queryFn: () =>
      operationsApi
        .quotations({ page: quotePage, limit: 15, search: quoteSearch || undefined, status: quoteStatus || undefined })
        .then((r) => r.data),
    enabled: canReadSales && activeTab === 1,
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => operationsApi.convertQuotation(id),
    onSuccess: () => {
      setQuoteFeedback(null);
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setQuoteDetailOpen(false);
      setSelectedQuote(null);
    },
    onError: (err) => setQuoteFeedback({ text: getApiErrorMessage(err), variant: 'error' }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      operationsApi.updateOrderStatus(id, status),
    onSuccess: (res, variables) => {
      const fulfillment = res.data?.fulfillment as { type?: string; shortages?: { productName: string; required: number; available: number }[] } | undefined;
      const newStatus = (res.data?.data as SalesOrder | undefined)?.status;

      if (variables.status === 'CONFIRMED') {
        if (fulfillment?.type === 'stock' || newStatus === 'READY') {
          setStatusFeedback({ text: 'Order confirmed — stock reserved.', variant: 'info' });
        } else {
          const firstShort = fulfillment?.shortages?.[0];
          const detail = firstShort
            ? ` (${firstShort.productName}: need ${firstShort.required}, in stock ${firstShort.available})`
            : '';
          setStatusFeedback({
            text: `Out of stock${detail}. Production notified.`,
            variant: 'info',
          });
        }
      } else if (variables.status === 'READY') {
        setStatusFeedback({ text: 'Order marked ready.', variant: 'info' });
      } else if (variables.status === 'CANCELLED') {
        setStatusFeedback({ text: 'Order cancelled.', variant: 'info' });
      } else {
        setStatusFeedback(null);
      }
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      if (variables.status === 'CANCELLED') {
        queryClient.invalidateQueries({ queryKey: ['sales-orders-deliverable'] });
      }
    },
    onError: (err) => setStatusFeedback({ text: getApiErrorMessage(err), variant: 'error' }),
  });

  const downloadInvoice = async (invoiceId: string, invoiceNumber: string) => {
    setDownloadingInvoiceId(invoiceId);
    try {
      await downloadFile(`/finance/invoices/${invoiceId}/pdf`, `${invoiceNumber}.pdf`);
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const goToTab = (index: number) => setActiveTab(index);

  const openOrderDetail = (order: SalesOrder) => {
    setStatusFeedback(null);
    setOrderEditMode(false);
    setSelectedOrder(order);
    setOrderDetailOpen(true);
  };

  const closeOrderDetail = () => {
    setOrderDetailOpen(false);
    setOrderEditMode(false);
    setSelectedOrder(null);
    setStatusFeedback(null);
    if (orderIdFromUrl) {
      navigate('/sales', { replace: true });
    }
  };

  const openQuoteDetail = (quote: SalesQuotation) => {
    setSelectedQuote(quote);
    setQuoteDetailOpen(true);
  };

  const orderColumns = [
    ...(canCreateDelivery
      ? [
          {
            key: 'select',
            label: '',
            render: (_: unknown, row: Record<string, unknown>) => {
              const status = row.status as string;
              if (!isDeliverableStatus(status)) {
                return <span className="inline-block w-4" />;
              }
              const id = row.id as string;
              const checked = selectedDeliveryOrderIds.includes(id);
              return (
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                  checked={checked}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => toggleDeliveryOrder(id, e.target.checked)}
                  aria-label={`Select ${row.orderNumber as string} for delivery`}
                />
              );
            },
          },
        ]
      : []),
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'customer',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name || '-',
    },
    {
      key: 'salesPerson',
      label: 'Sales Person',
      render: (_: unknown, row: Record<string, unknown>) => {
        const person =
          (row.salesPerson as { firstName?: string; lastName?: string } | null | undefined) ||
          (row.createdBy as { firstName?: string; lastName?: string } | null | undefined);
        if (!person) return <span className="text-slate-400">—</span>;
        return `${person.firstName || ''} ${person.lastName || ''}`.trim() || '—';
      },
    },
    {
      key: 'orderDate',
      label: 'Sale date',
      render: (_val: unknown, row: Record<string, unknown>) =>
        formatDate((row.requiredDate as string) || (row.orderDate as string)),
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
        if (!canUpdate) return null;
        const status = row.status as string;
        const next = getNextOrderAction(status, isSalesOfficer);
        const showCancel = canCancelOrder(status, isSalesOfficer);
        if (!next && !showCancel) return null;
        return (
          <div className="flex flex-wrap gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
            {next && (
              <Button
                size="sm"
                loading={statusMutation.isPending}
                disabled={statusMutation.isPending}
                onClick={() =>
                  setPendingStatusChange({ id: row.id as string, status: next.status, label: next.label })
                }
              >
                {next.label}
              </Button>
            )}
            {showCancel && (
              <Button
                size="sm"
                variant="secondary"
                loading={statusMutation.isPending}
                disabled={statusMutation.isPending}
                onClick={() =>
                  setPendingStatusChange({ id: row.id as string, status: 'CANCELLED', label: 'Cancel order' })
                }
              >
                Cancel
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const quoteColumns = [
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
      key: 'validUntil',
      label: 'Valid Until',
      render: (val: unknown) => (val ? formatDate(val as string) : '-'),
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
        if (!canCreate) return null;
        const status = row.status as string;
        if (status === 'APPROVED' || status === 'CANCELLED' || status === 'REJECTED') return null;
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
  ];

  const toolbarActions =
    activeTab === 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {canCreateDelivery && selectedDeliveryOrderIds.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => startBulkDelivery(selectedDeliveryOrderIds)}
          >
            <Truck className="h-4 w-4 mr-1.5" />
            Create delivery ({selectedDeliveryOrderIds.length})
          </Button>
        )}
        {canCreate && (
          <Button size="sm" onClick={() => setOrderModalOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Sales Order
          </Button>
        )}
      </div>
    ) : activeTab === 1 && canCreate ? (
      <Button size="sm" onClick={() => setQuotationModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New Quotation
      </Button>
    ) : undefined;

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard
            title={myBook ? "Today's sales" : 'Open Orders'}
            value={myBook ? formatCurrency(stats.todaySales ?? 0) : stats.openOrders}
            icon={<TrendingUp className="h-5 w-5 text-white" />}
            color="from-teal-500 to-teal-700"
            to={myBook ? '/my-sales' : undefined}
            onClick={myBook ? undefined : () => goToTab(0)}
          />
          <StatCard
            title={myBook ? 'My Open Orders' : 'Pipeline Value'}
            value={myBook ? stats.openOrders : formatCurrency(stats.pipelineValue)}
            icon={<ShoppingCart className="h-5 w-5 text-white" />}
            color="from-indigo-500 to-indigo-700"
            onClick={() => goToTab(0)}
          />
          {!myBook && (
            <StatCard
              title="Pending Quotes"
              value={stats.pendingQuotations}
              icon={<FileText className="h-5 w-5 text-white" />}
              color="from-orange-500 to-orange-700"
              onClick={() => goToTab(1)}
            />
          )}
          {myBook && (
            <StatCard
              title="My Pipeline Value"
              value={formatCurrency(stats.pipelineValue)}
              icon={<FileText className="h-5 w-5 text-white" />}
              color="from-orange-500 to-orange-700"
              onClick={() => goToTab(0)}
            />
          )}
          <StatCard
            title={myBook ? 'My Orders This Month' : 'Orders This Month'}
            value={stats.ordersThisMonth}
            icon={<CalendarDays className="h-5 w-5 text-white" />}
            color="from-fuchsia-500 to-fuchsia-700"
            onClick={() => goToTab(0)}
          />
          <StatCard
            title={myBook ? 'My Monthly Revenue' : 'Monthly Revenue'}
            value={formatCurrency(stats.monthlyRevenue)}
            icon={<Receipt className="h-5 w-5 text-white" />}
            color="from-cyan-500 to-cyan-700"
            to={myBook ? '/my-sales' : '/finance'}
          />
        </StatGrid>
      )}

      <PageHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            {myBook && (
              <Link to="/my-sales">
                <Button variant="secondary" size="sm">
                  <Target className="h-4 w-4 mr-1.5" />
                  My dashboard
                </Button>
              </Link>
            )}
            {canViewPerformance && (
              <Link to="/sales-performance">
                <Button variant="secondary" size="sm">
                  <Target className="h-4 w-4 mr-1.5" />
                  Team performance
                </Button>
              </Link>
            )}
            {canManageTargets && (
              <Link to="/sales-performance?tab=targets">
                <Button variant="secondary" size="sm">
                  <Target className="h-4 w-4 mr-1.5" />
                  Set targets
                </Button>
              </Link>
            )}
            {stats && stats.pendingQuotations > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
                <FileText className="h-4 w-4 mr-1.5 text-amber-500" />
                {stats.pendingQuotations} pending quotes
              </Button>
            ) : stats && stats.openOrders > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => goToTab(0)}>
                <ShoppingCart className="h-4 w-4 mr-1.5 text-primary-500" />
                {stats.openOrders} open orders
              </Button>
            ) : null}
          </div>
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setOrderPage(1);
          setQuotePage(1);
        }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <DataPanel className="min-w-0 overflow-hidden">
          <div className="px-4 pt-4 pb-0 flex flex-col sm:flex-row gap-3 sm:items-end">
            {myBook && (
              <p className="text-sm text-slate-600 sm:mr-auto sm:mb-2">
                Showing <strong>your orders</strong>. Filter by date or status below.
              </p>
            )}
            <Input
              placeholder={myBook ? 'Search my orders…' : 'Search orders…'}
              className="sm:max-w-md"
              value={orderSearch}
              onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1); }}
            />
            <Select
              options={ORDER_STATUS_OPTIONS}
              value={orderStatus}
              onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }}
              className="sm:w-44"
            />
            <Input
              type="date"
              label="Sale date"
              value={orderDate}
              onChange={(e) => { setOrderDate(e.target.value); setOrderPage(1); }}
              className="sm:w-44"
            />
            <Button
              type="button"
              variant="secondary"
              className="sm:mb-0.5"
              onClick={() => {
                setOrderDate('');
                setOrderPage(1);
              }}
            >
              All dates
            </Button>
            {!orderDate && (
              <Button
                type="button"
                variant="secondary"
                className="sm:mb-0.5"
                onClick={() => {
                  const now = new Date();
                  const y = now.getFullYear();
                  const m = String(now.getMonth() + 1).padStart(2, '0');
                  const d = String(now.getDate()).padStart(2, '0');
                  setOrderDate(`${y}-${m}-${d}`);
                  setOrderPage(1);
                }}
              >
                Today
              </Button>
            )}
          </div>
          {statusFeedback && (
            <div className="px-4 pt-3">
              <Alert variant={statusFeedback.variant}>{statusFeedback.text}</Alert>
            </div>
          )}
          {canCreateDelivery && (
            <div className="px-4 pt-3 space-y-3">
              <Alert variant="info">
                Tick Ready / Partially Delivered orders below, then click{' '}
                <strong>Create delivery</strong> (top right, or the button under this message).
              </Alert>
              {selectedDeliveryOrderIds.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5">
                  <p className="text-sm text-primary-900">
                    <strong>{selectedDeliveryOrderIds.length}</strong> order
                    {selectedDeliveryOrderIds.length === 1 ? '' : 's'} selected for one delivery trip.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedDeliveryOrderIds([])}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => startBulkDelivery(selectedDeliveryOrderIds)}
                    >
                      <Truck className="h-4 w-4 mr-1.5" />
                      Create delivery ({selectedDeliveryOrderIds.length})
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {(orders?.data?.length || 0) === 0 && !ordersLoading ? (
            <div className="p-6">
              <EmptyState
                title={myBook ? 'No orders in your book yet' : 'No sales orders found'}
                description={
                  orderDate
                    ? myBook
                      ? 'No orders for this date. Pick another day or choose All dates.'
                      : 'No sales orders for this date. Pick another day or choose All dates.'
                    : myBook
                      ? 'Create a sales order to get started — it will appear here automatically.'
                      : 'Create a sales order or convert an approved quotation.'
                }
                action={
                  canCreate ? (
                    <Button onClick={() => setOrderModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Sales Order
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={orderColumns}
              data={(orders?.data as SalesOrder[]) || []}
              loading={ordersLoading}
              onRowClick={(row) => openOrderDetail(row as unknown as SalesOrder)}
              embedded
              responsive
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={orders?.pagination} page={orderPage} onPageChange={setOrderPage} label="orders" />
          </div>
        </DataPanel>
      )}

      {activeTab === 1 && (
        <DataPanel className="min-w-0 overflow-hidden">
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search quotations…"
              className="sm:max-w-md"
              value={quoteSearch}
              onChange={(e) => { setQuoteSearch(e.target.value); setQuotePage(1); }}
            />
            <Select
              options={QUOTE_STATUS_OPTIONS}
              value={quoteStatus}
              onChange={(e) => { setQuoteStatus(e.target.value); setQuotePage(1); }}
              className="sm:w-44"
            />
          </div>
          {(quotations?.data?.length || 0) === 0 && !quotesLoading ? (
            <div className="p-6">
              <EmptyState
                title="No quotations found"
                description="Create a quotation to send pricing to customers."
                action={
                  canCreate ? (
                    <Button onClick={() => setQuotationModalOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      New Quotation
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={quoteColumns}
              data={(quotations?.data as SalesQuotation[]) || []}
              loading={quotesLoading}
              onRowClick={(row) => openQuoteDetail(row as unknown as SalesQuotation)}
              embedded
              responsive
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={quotations?.pagination} page={quotePage} onPageChange={setQuotePage} label="quotations" />
          </div>
        </DataPanel>
      )}

      <Modal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} title="New Sales Order" size="xl">
        <SalesOrderForm onSuccess={() => setOrderModalOpen(false)} onCancel={() => setOrderModalOpen(false)} />
      </Modal>

      <Modal open={quotationModalOpen} onClose={() => setQuotationModalOpen(false)} title="New Quotation" size="xl">
        <QuotationForm onSuccess={() => setQuotationModalOpen(false)} onCancel={() => setQuotationModalOpen(false)} />
      </Modal>

      <Modal
        open={orderDetailOpen}
        onClose={closeOrderDetail}
        title={orderEditMode ? 'Adjust Sales Order' : 'Sales Order Details'}
        size="lg"
      >
        {activeOrder && orderEditMode ? (
          <SalesOrderEditForm
            order={activeOrder}
            onSuccess={(updated) => {
              setSelectedOrder(updated);
              setOrderEditMode(false);
              setStatusFeedback({
                text: 'Order updated. The salesperson has been notified of the changes.',
                variant: 'info',
              });
              queryClient.setQueryData(['sales-order', updated.id], updated);
            }}
            onCancel={() => setOrderEditMode(false)}
          />
        ) : activeOrder && (
          <div className="space-y-4 text-sm">
            {statusFeedback && <Alert variant={statusFeedback.variant}>{statusFeedback.text}</Alert>}
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Order #</p><p className="font-semibold">{activeOrder.orderNumber}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{activeOrder.customer?.name}</p></div>
              <div>
                <p className="text-slate-500">LPO / Customer PO</p>
                <p className="font-semibold">{activeOrder.customerPoNumber || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Sales Person</p>
                <p className="font-semibold">
                  {(() => {
                    const person = activeOrder.salesPerson || activeOrder.createdBy;
                    return person
                      ? `${person.firstName} ${person.lastName}`.trim()
                      : '—';
                  })()}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Sale date</p>
                <p className="font-semibold">
                  {formatDate((activeOrder as { requiredDate?: string }).requiredDate || activeOrder.orderDate)}
                </p>
              </div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(activeOrder.status)}>{activeOrder.status.replace(/_/g, ' ')}</Badge></div>
              <div><p className="text-slate-500">Total</p><p className="font-semibold text-lg">{formatCurrency(Number(activeOrder.totalAmount))}</p></div>
            </div>
            {activeOrder.items?.length > 0 && (
              <Card title="Line Items">
                {activeOrder.items.map((item) => {
                  const delivered = item.deliveredQty || 0;
                  const remaining = Math.max(0, item.quantity - delivered);
                  return (
                  <div key={item.id} className="py-2 border-b border-border/60 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span>{item.product?.name || item.productId}</span>
                      <span>{item.quantity} × {formatCurrency(Number(item.unitPrice))}</span>
                    </div>
                    {(delivered > 0 || activeOrder.status.includes('PARTIAL') || activeOrder.status === 'DISPATCHED') && (
                      <p className="text-xs text-slate-500 mt-1">
                        Delivered {delivered} of {item.quantity}
                        {remaining > 0 ? ` · ${remaining} remaining` : ' · complete'}
                      </p>
                    )}
                  </div>
                  );
                })}
              </Card>
            )}
            {activeOrder.invoices && activeOrder.invoices.length > 0 && (
              <Card title="Invoices">
                <p className="text-xs text-slate-500 mb-2">
                  Invoices are created with each delivery note and cover the products on that dispatch.
                </p>
                {activeOrder.invoices.map((inv) => (
                  <div key={inv.id} className="flex justify-between items-center py-2 border-b border-border/60 last:border-0 gap-2">
                    <span>{inv.invoiceNumber}</span>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <Badge variant={getStatusBadge(inv.status)}>{inv.status}</Badge>
                      <span>{formatCurrency(Number(inv.totalAmount))}</span>
                      {canDownloadInvoice && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={downloadingInvoiceId === inv.id}
                          onClick={() => downloadInvoice(inv.id, inv.invoiceNumber)}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          PDF
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            )}
            {activeOrder.deliveries && activeOrder.deliveries.length > 0 && (
              <Card title="Delivery Notes">
                {activeOrder.deliveries.map((dn) => (
                  <div key={dn.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{dn.deliveryNo}</span>
                    <Badge variant={getStatusBadge(dn.status)}>{dn.status.replace(/_/g, ' ')}</Badge>
                  </div>
                ))}
              </Card>
            )}
            {activeOrder.productionOrders && activeOrder.productionOrders.length > 0 && (
              <Card title="Production Orders">
                {activeOrder.productionOrders.map((po) => (
                  <div key={po.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{po.orderNumber}</span>
                    <Badge variant={getStatusBadge(po.status)}>{po.status.replace(/_/g, ' ')}</Badge>
                  </div>
                ))}
              </Card>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {canUpdate
                && EDITABLE_ORDER_STATUSES.includes(activeOrder.status)
                && (!isSalesOfficer || activeOrder.status === 'PENDING') && (
                <Button variant="secondary" onClick={() => setOrderEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Adjust order
                </Button>
              )}
              {canCreateDelivery
                && (activeOrder.status === 'READY' || activeOrder.status === 'PARTIALLY_DELIVERED') && (
                <Button
                  variant="secondary"
                  onClick={() => startBulkDelivery([activeOrder.id])}
                >
                  <Truck className="h-4 w-4 mr-2" />
                  Create delivery note
                </Button>
              )}
              {canUpdate && canCancelOrder(activeOrder.status, isSalesOfficer) && (
                <Button
                  variant="secondary"
                  loading={statusMutation.isPending}
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    setPendingStatusChange({
                      id: activeOrder.id,
                      status: 'CANCELLED',
                      label: 'Cancel order',
                    })
                  }
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel order
                </Button>
              )}
              {(() => {
                const nextAction = getNextOrderAction(activeOrder.status, isSalesOfficer);
                if (!canUpdate || !nextAction) return null;
                return (
                  <Button
                    loading={statusMutation.isPending}
                    disabled={statusMutation.isPending}
                    onClick={() =>
                      setPendingStatusChange({
                        id: activeOrder.id,
                        status: nextAction.status,
                        label: nextAction.label,
                      })
                    }
                  >
                    {nextAction.label}
                  </Button>
                );
              })()}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={quoteDetailOpen} onClose={() => { setQuoteDetailOpen(false); setSelectedQuote(null); setQuoteFeedback(null); }} title="Quotation Details" size="lg">
        {selectedQuote && (
          <div className="space-y-4 text-sm">
            {quoteFeedback && <Alert variant={quoteFeedback.variant}>{quoteFeedback.text}</Alert>}
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Quote #</p><p className="font-semibold">{selectedQuote.quotationNo}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{selectedQuote.customer?.name}</p></div>
              <div><p className="text-slate-500">Valid Until</p><p className="font-semibold">{selectedQuote.validUntil ? formatDate(selectedQuote.validUntil) : '-'}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selectedQuote.status)}>{selectedQuote.status}</Badge></div>
              <div><p className="text-slate-500">Total</p><p className="font-semibold text-lg">{formatCurrency(Number(selectedQuote.totalAmount))}</p></div>
            </div>
            {selectedQuote.items?.length > 0 && (
              <Card title="Line Items">
                {selectedQuote.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{item.product?.name || item.productId}</span>
                    <span>{item.quantity} × {formatCurrency(Number(item.unitPrice))}</span>
                  </div>
                ))}
              </Card>
            )}
            {canCreate && !['APPROVED', 'CANCELLED', 'REJECTED'].includes(selectedQuote.status) && (
              <div className="flex justify-end">
                <Button loading={convertMutation.isPending} onClick={() => convertMutation.mutate(selectedQuote.id)}>
                  Convert to Sales Order
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!pendingStatusChange}
        title={pendingStatusChange?.status === 'CANCELLED' ? 'Cancel this order?' : 'Change order status?'}
        message={
          pendingStatusChange
            ? pendingStatusChange.status === 'CANCELLED'
              ? 'This will cancel the order and release any reserved stock. This cannot be undone. Continue?'
              : `This will move the order to "${pendingStatusChange.status.replace(/_/g, ' ')}". Continue?`
            : ''
        }
        confirmLabel={pendingStatusChange?.label || 'Confirm'}
        variant={pendingStatusChange?.status === 'CANCELLED' ? 'danger' : 'primary'}
        loading={statusMutation.isPending}
        onCancel={() => setPendingStatusChange(null)}
        onConfirm={() => {
          if (!pendingStatusChange) return;
          statusMutation.mutate(
            { id: pendingStatusChange.id, status: pendingStatusChange.status },
            { onSettled: () => setPendingStatusChange(null) }
          );
        }}
      />
    </div>
  );
}
