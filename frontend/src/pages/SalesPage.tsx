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
} from 'lucide-react';
import { financeApi, operationsApi } from '../services/api';
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
  DELIVERED: { status: 'COMPLETED', label: 'Complete' },
};

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
  const { hasPermission, isSalesOfficer } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderIdFromUrl = searchParams.get('orderId');
  const [activeTab, setActiveTab] = useState(orderIdFromUrl ? 1 : 0);
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
  const [statusFeedback, setStatusFeedback] = useState<{ text: string; variant: 'error' | 'info' } | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ id: string; status: string; label: string } | null>(null);

  const canCreate = hasPermission('sales:create');
  const canUpdate = hasPermission('sales:update');
  const canReadSales = hasPermission('sales:read');
  const canViewPerformance = hasPermission('reports:read') || hasPermission('finance:read');
  const canInvoice = hasPermission('finance:create');
  const canDownloadInvoice = hasPermission('finance:read');
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    if (!orderIdFromUrl) return;

    setActiveTab(1);
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
    queryKey: ['sales-orders', orderPage, orderSearch, orderStatus],
    queryFn: () =>
      operationsApi
        .salesOrders({ page: orderPage, limit: 15, search: orderSearch || undefined, status: orderStatus || undefined })
        .then((r) => r.data),
    enabled: canReadSales && (activeTab === 0 || activeTab === 1),
  });

  const { data: quotations, isLoading: quotesLoading } = useQuery({
    queryKey: ['quotations', quotePage, quoteSearch, quoteStatus],
    queryFn: () =>
      operationsApi
        .quotations({ page: quotePage, limit: 15, search: quoteSearch || undefined, status: quoteStatus || undefined })
        .then((r) => r.data),
    enabled: canReadSales && (activeTab === 0 || activeTab === 2),
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
      } else {
        setStatusFeedback(null);
      }
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
    },
    onError: (err) => setStatusFeedback({ text: getApiErrorMessage(err), variant: 'error' }),
  });

  const invoiceMutation = useMutation({
    mutationFn: (orderId: string) => financeApi.createInvoiceFromOrder(orderId),
    onSuccess: () => {
      setStatusFeedback({
        text: 'Invoice created. Download it from Finance or below. Assign delivery when ready.',
        variant: 'info',
      });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
    },
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
    setSelectedOrder(order);
    setOrderDetailOpen(true);
  };

  const closeOrderDetail = () => {
    setOrderDetailOpen(false);
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
        const next = getNextOrderAction(status, isSalesOfficer);
        if (!next || status === 'COMPLETED' || status === 'CANCELLED') return null;
        return (
          <Button
            size="sm"
            loading={statusMutation.isPending}
            disabled={statusMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              setPendingStatusChange({ id: row.id as string, status: next.status, label: next.label });
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
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canViewPerformance && (
              <Link to="/sales-performance">
                <Button variant="secondary" size="sm">
                  <Target className="h-4 w-4 mr-1.5" />
                  Team performance
                </Button>
              </Link>
            )}
            {stats && stats.pendingQuotations > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => goToTab(2)}>
                <FileText className="h-4 w-4 mr-1.5 text-amber-500" />
                {stats.pendingQuotations} pending quotes
              </Button>
            ) : stats && stats.openOrders > 0 ? (
              <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
                <ShoppingCart className="h-4 w-4 mr-1.5 text-primary-500" />
                {stats.openOrders} open orders
              </Button>
            ) : null}
          </div>
        }
      />

      {stats && (
        <StatGrid>
          <StatCard title="Open Orders" value={stats.openOrders} icon={<ShoppingCart className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Pipeline Value" value={formatCurrency(stats.pipelineValue)} icon={<TrendingUp className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Pending Quotes" value={stats.pendingQuotations} icon={<FileText className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Orders This Month" value={stats.ordersThisMonth} icon={<CalendarDays className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </StatGrid>
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
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel className="min-w-0 overflow-hidden">
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
              <Alert variant={statusFeedback.variant}>{statusFeedback.text}</Alert>
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
              responsive
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={orders?.pagination} page={orderPage} onPageChange={setOrderPage} label="orders" />
          </div>
        </DataPanel>
      )}

      {activeTab === 2 && (
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

      <Modal open={orderDetailOpen} onClose={closeOrderDetail} title="Sales Order Details" size="lg">
        {activeOrder && (
          <div className="space-y-4 text-sm">
            {statusFeedback && <Alert variant={statusFeedback.variant}>{statusFeedback.text}</Alert>}
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
              {canInvoice && !activeOrder.invoices?.length && activeOrder.status === 'READY' && (
                <Button
                  variant="secondary"
                  loading={invoiceMutation.isPending}
                  onClick={() => invoiceMutation.mutate(activeOrder.id)}
                >
                  <Receipt className="h-4 w-4 mr-2" />
                  Create Invoice
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

      <ConfirmDialog
        open={!!pendingStatusChange}
        title="Change order status?"
        message={
          pendingStatusChange
            ? `This will move the order to "${pendingStatusChange.status.replace(/_/g, ' ')}". Continue?`
            : ''
        }
        confirmLabel={pendingStatusChange?.label || 'Confirm'}
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
