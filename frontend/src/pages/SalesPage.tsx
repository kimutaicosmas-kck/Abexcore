import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ShoppingCart,
  FileText,
  TrendingUp,
  CalendarDays,
  Truck,
  Receipt,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { financeApi, operationsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  StatCard,
  Card,
  Alert,
  EmptyState,
  DataPanel,
  QuickActionCard,
  QuickActionGrid,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { SalesOrderForm } from '../components/forms/SalesOrderForm';
import { QuotationForm } from '../components/forms/QuotationForm';
import { useAuth } from '../contexts/AuthContext';
import { SalesOrder, SalesQuotation, SalesStats } from '../types';

const tabs = ['Overview', 'Sales Orders', 'Quotations'];

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

const NEXT_STATUS: Record<string, { status: string; label: string }> = {
  PENDING: { status: 'CONFIRMED', label: 'Confirm' },
  CONFIRMED: { status: 'IN_PRODUCTION', label: 'Start Production' },
  DELIVERED: { status: 'COMPLETED', label: 'Complete' },
};

const STATUS_HINTS: Record<string, string> = {
  PENDING: 'Confirming reserves finished goods stock. Ensure enough inventory is on hand.',
  CONFIRMED: 'Start production when manufacturing should begin. Create production orders in Production if needed.',
  IN_PRODUCTION: 'Complete production with a passed QC inspection in Quality. The order moves to Ready automatically.',
  READY: 'Create a delivery note in Delivery to dispatch goods and trigger invoicing.',
  PARTIALLY_DELIVERED: 'Finish remaining deliveries, then the order can be completed.',
};

function getApiErrorMessage(err: unknown): string {
  const axiosErr = err as { response?: { data?: { message?: string } } };
  return axiosErr.response?.data?.message || 'Unable to update order status';
}

export function SalesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [quotePage, setQuotePage] = useState(1);
  const [orderSearch, setOrderSearch] = useState('');
  const [quoteSearch, setQuoteSearch] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [quoteStatus, setQuoteStatus] = useState('');
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [quotationModalOpen, setQuotationModalOpen] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<SalesQuotation | null>(null);
  const [orderDetailOpen, setOrderDetailOpen] = useState(false);
  const [quoteDetailOpen, setQuoteDetailOpen] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const canCreate = hasPermission('sales:create');
  const canUpdate = hasPermission('sales:update');
  const canInvoice = hasPermission('finance:create');

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
  });

  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['sales-orders', orderPage, orderSearch, orderStatus],
    queryFn: () =>
      operationsApi
        .salesOrders({ page: orderPage, limit: 15, search: orderSearch || undefined, status: orderStatus || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const { data: quotations, isLoading: quotesLoading } = useQuery({
    queryKey: ['quotations', quotePage, quoteSearch, quoteStatus],
    queryFn: () =>
      operationsApi
        .quotations({ page: quotePage, limit: 15, search: quoteSearch || undefined, status: quoteStatus || undefined })
        .then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 2,
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => operationsApi.convertQuotation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      operationsApi.updateOrderStatus(id, status),
    onSuccess: () => {
      setStatusFeedback(null);
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
    },
    onError: (err) => setStatusFeedback(getApiErrorMessage(err)),
  });

  const invoiceMutation = useMutation({
    mutationFn: (orderId: string) => financeApi.createInvoiceFromOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const openOrderDetail = (order: SalesOrder) => {
    setStatusFeedback(null);
    setSelectedOrder(order);
    setOrderDetailOpen(true);
  };

  const openQuoteDetail = (quote: SalesQuotation) => {
    setSelectedQuote(quote);
    setQuoteDetailOpen(true);
  };

  const recentOrders = activeTab === 0 ? ((orders?.data as SalesOrder[]) || []).slice(0, 6) : [];
  const pendingQuotes = activeTab === 0
    ? ((quotations?.data as SalesQuotation[]) || []).filter((q) => ['DRAFT', 'PENDING'].includes(q.status)).slice(0, 5)
    : [];
  const openOrders = activeTab === 0
    ? ((orders?.data as SalesOrder[]) || []).filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status)).slice(0, 5)
    : [];

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
        if (!canUpdate) return null;
        const status = row.status as string;
        const next = NEXT_STATUS[status];
        if (!next || status === 'COMPLETED' || status === 'CANCELLED') return null;
        return (
          <Button
            size="sm"
            loading={statusMutation.isPending}
            disabled={statusMutation.isPending}
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
    canCreate &&
    (activeTab === 1 ? (
      <Button size="sm" onClick={() => setOrderModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New Sales Order
      </Button>
    ) : activeTab === 2 ? (
      <Button size="sm" onClick={() => setQuotationModalOpen(true)}>
        <Plus className="h-4 w-4 mr-1.5" />
        New Quotation
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        title="Sales"
        subtitle="Quotations, sales orders, and customer order tracking"
        action={
          stats && stats.pendingQuotations > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(2)}>
              <FileText className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pendingQuotations} pending quotes
            </Button>
          ) : stats && stats.openOrders > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <ShoppingCart className="h-4 w-4 mr-1.5 text-primary-500" />
              {stats.openOrders} open orders
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Open Orders" value={stats.openOrders} icon={<ShoppingCart className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Pipeline Value" value={formatCurrency(stats.pipelineValue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Pending Quotes" value={stats.pendingQuotations} icon={<FileText className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Orders This Month" value={stats.ordersThisMonth} icon={<CalendarDays className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

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
        <div className="space-y-4">
          {canCreate && (
            <QuickActionGrid>
              <QuickActionCard
                label="New sales order"
                desc="Create a customer order"
                icon={ShoppingCart}
                color="bg-primary-50 text-primary-600 border-primary-100"
                onClick={() => setOrderModalOpen(true)}
              />
              <QuickActionCard
                label="New quotation"
                desc="Send a price proposal"
                icon={FileText}
                color="bg-amber-50 text-amber-600 border-amber-100"
                onClick={() => setQuotationModalOpen(true)}
              />
              <QuickActionCard
                label="Open orders"
                desc="Track active sales pipeline"
                icon={TrendingUp}
                color="bg-emerald-50 text-emerald-600 border-emerald-100"
                onClick={() => goToTab(1)}
              />
            </QuickActionGrid>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Open orders"
              action={
                openOrders.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => goToTab(1)}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {openOrders.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No open orders" description="All sales orders are completed or cancelled." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {openOrders.map((order) => (
                    <li
                      key={order.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => openOrderDetail(order)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                        <ShoppingCart className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{order.orderNumber}</p>
                        <p className="text-xs text-slate-500">{order.customer?.name || '—'}</p>
                      </div>
                      <Badge variant={getStatusBadge(order.status)}>{order.status.replace(/_/g, ' ')}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Pending quotations"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(2)}>
                  All quotes
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              }
              padding={false}
            >
              {pendingQuotes.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No pending quotes" description="Draft and pending quotations appear here." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pendingQuotes.map((quote) => (
                    <li
                      key={quote.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/30 cursor-pointer"
                      onClick={() => openQuoteDetail(quote)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{quote.quotationNo}</p>
                        <p className="text-xs text-slate-500">{quote.customer?.name || '—'}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-700">
                        {formatCurrency(Number(quote.totalAmount))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {recentOrders.length > 0 && (
            <Card
              title="Orders snapshot"
              action={<Button variant="ghost" size="sm" onClick={() => goToTab(1)}>View all</Button>}
              padding={false}
            >
              <Table
                columns={orderColumns.filter((c) => c.key !== 'actions')}
                data={recentOrders}
                embedded
                onRowClick={(row) => openOrderDetail(row as unknown as SalesOrder)}
              />
            </Card>
          )}
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search orders…"
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
          </div>
          {statusFeedback && (
            <div className="px-4 pt-3">
              <Alert variant="error">{statusFeedback}</Alert>
            </div>
          )}
          {(orders?.data?.length || 0) === 0 && !ordersLoading ? (
            <div className="p-6">
              <EmptyState
                title="No sales orders found"
                description="Create a sales order or convert an approved quotation."
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
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={orders?.pagination} page={orderPage} onPageChange={setOrderPage} label="orders" />
          </div>
        </DataPanel>
      )}

      {activeTab === 2 && (
        <DataPanel>
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

      <Modal open={orderDetailOpen} onClose={() => { setOrderDetailOpen(false); setSelectedOrder(null); setStatusFeedback(null); }} title="Sales Order Details" size="lg">
        {activeOrder && (
          <div className="space-y-4 text-sm">
            {statusFeedback && <Alert variant="error">{statusFeedback}</Alert>}
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">Order #</p><p className="font-semibold">{activeOrder.orderNumber}</p></div>
              <div><p className="text-slate-500">Customer</p><p className="font-semibold">{activeOrder.customer?.name}</p></div>
              <div><p className="text-slate-500">Date</p><p className="font-semibold">{formatDate(activeOrder.orderDate)}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(activeOrder.status)}>{activeOrder.status.replace(/_/g, ' ')}</Badge></div>
              <div><p className="text-slate-500">Total</p><p className="font-semibold text-lg">{formatCurrency(Number(activeOrder.totalAmount))}</p></div>
            </div>
            {activeOrder.items?.length > 0 && (
              <Card title="Line Items">
                {activeOrder.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{item.product?.name || item.productId}</span>
                    <span>{item.quantity} × {formatCurrency(Number(item.unitPrice))}</span>
                  </div>
                ))}
              </Card>
            )}
            {activeOrder.invoices && activeOrder.invoices.length > 0 && (
              <Card title="Invoices">
                {activeOrder.invoices.map((inv) => (
                  <div key={inv.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{inv.invoiceNumber}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={getStatusBadge(inv.status)}>{inv.status}</Badge>
                      <span>{formatCurrency(Number(inv.totalAmount))}</span>
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
            {STATUS_HINTS[activeOrder.status] && (
              <Alert variant={activeOrder.status === 'IN_PRODUCTION' ? 'info' : 'warning'}>
                {STATUS_HINTS[activeOrder.status]}
              </Alert>
            )}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {canInvoice && !activeOrder.invoices?.length && !activeOrder.deliveries?.length && ['CONFIRMED', 'IN_PRODUCTION', 'READY'].includes(activeOrder.status) && (
                <Button
                  variant="secondary"
                  loading={invoiceMutation.isPending}
                  onClick={() => invoiceMutation.mutate(activeOrder.id)}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  Create Invoice
                </Button>
              )}
              {(activeOrder.status === 'READY' || activeOrder.status === 'PARTIALLY_DELIVERED') && (
                <Link to="/delivery">
                  <Button variant="secondary">
                    <Truck className="h-4 w-4 mr-2" />
                    Create Delivery
                  </Button>
                </Link>
              )}
              {canUpdate && NEXT_STATUS[activeOrder.status] && (
                <Button
                  loading={statusMutation.isPending}
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ id: activeOrder.id, status: NEXT_STATUS[activeOrder.status].status })}
                >
                  {NEXT_STATUS[activeOrder.status].label}
                </Button>
              )}
              {activeOrder.status === 'IN_PRODUCTION' && (
                <Link to="/production">
                  <Button variant="secondary">Open Production</Button>
                </Link>
              )}
            </div>
            {activeOrder.status === 'READY' && (
              <p className="text-xs text-slate-500 text-right">
                Dispatch via Delivery auto-creates a sales invoice when the delivery note is created.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={quoteDetailOpen} onClose={() => { setQuoteDetailOpen(false); setSelectedQuote(null); }} title="Quotation Details" size="lg">
        {selectedQuote && (
          <div className="space-y-4 text-sm">
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
    </div>
  );
}
