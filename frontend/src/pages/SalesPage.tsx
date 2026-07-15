import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingCart, FileText, TrendingUp, CalendarDays, Truck, Receipt } from 'lucide-react';
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

const tabs = ['Sales Orders', 'Quotations'];

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
    enabled: activeTab === 0,
  });

  const { data: quotations, isLoading: quotesLoading } = useQuery({
    queryKey: ['quotations', quotePage, quoteSearch, quoteStatus],
    queryFn: () =>
      operationsApi
        .quotations({ page: quotePage, limit: 15, search: quoteSearch || undefined, status: quoteStatus || undefined })
        .then((r) => r.data),
    enabled: activeTab === 1,
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
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-stats'] });
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
    },
  });

  const invoiceMutation = useMutation({
    mutationFn: (orderId: string) => financeApi.createInvoiceFromOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-order'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
    },
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

  const renderPagination = (
    pagination: { page: number; totalPages: number } | undefined,
    page: number,
    setPage: (fn: (p: number) => number) => void
  ) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  return (
    <div>
      <PageHeader subtitle="Quotations, sales orders, and customer order tracking" />

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
        actions={
          canCreate ? (
            <div className="flex gap-2">
              {activeTab === 1 && (
                <Button variant="secondary" onClick={() => setQuotationModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Quotation
                </Button>
              )}
              {activeTab === 0 && (
                <Button onClick={() => setOrderModalOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Sales Order
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {activeTab === 0 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search orders…" className="max-w-sm" value={orderSearch} onChange={(e) => { setOrderSearch(e.target.value); setOrderPage(1); }} />
            <Select options={ORDER_STATUS_OPTIONS} value={orderStatus} onChange={(e) => { setOrderStatus(e.target.value); setOrderPage(1); }} className="w-44" />
          </div>
          <Table
            columns={orderColumns}
            data={(orders?.data as SalesOrder[]) || []}
            loading={ordersLoading}
            onRowClick={(row) => { setSelectedOrder(row as unknown as SalesOrder); setOrderDetailOpen(true); }}
          />
          {renderPagination(orders?.pagination, orderPage, setOrderPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search quotations…" className="max-w-sm" value={quoteSearch} onChange={(e) => { setQuoteSearch(e.target.value); setQuotePage(1); }} />
            <Select options={QUOTE_STATUS_OPTIONS} value={quoteStatus} onChange={(e) => { setQuoteStatus(e.target.value); setQuotePage(1); }} className="w-44" />
          </div>
          <Table
            columns={quoteColumns}
            data={(quotations?.data as SalesQuotation[]) || []}
            loading={quotesLoading}
            onRowClick={(row) => { setSelectedQuote(row as unknown as SalesQuotation); setQuoteDetailOpen(true); }}
          />
          {renderPagination(quotations?.pagination, quotePage, setQuotePage)}
        </>
      )}

      <Modal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} title="New Sales Order" size="xl">
        <SalesOrderForm onSuccess={() => setOrderModalOpen(false)} onCancel={() => setOrderModalOpen(false)} />
      </Modal>

      <Modal open={quotationModalOpen} onClose={() => setQuotationModalOpen(false)} title="New Quotation" size="xl">
        <QuotationForm onSuccess={() => setQuotationModalOpen(false)} onCancel={() => setQuotationModalOpen(false)} />
      </Modal>

      <Modal open={orderDetailOpen} onClose={() => { setOrderDetailOpen(false); setSelectedOrder(null); }} title="Sales Order Details" size="lg">
        {activeOrder && (
          <div className="space-y-4 text-sm">
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
                  onClick={() => statusMutation.mutate({ id: activeOrder.id, status: NEXT_STATUS[activeOrder.status].status })}
                >
                  {NEXT_STATUS[activeOrder.status].label}
                </Button>
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
