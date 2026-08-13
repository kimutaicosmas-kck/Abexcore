import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  ClipboardList,
  FileText,
  FileSpreadsheet,
  Download,
  Mail,
  Users,
  ShoppingCart,
  PackageCheck,
  ShieldCheck,
  ChevronRight,
  Truck,
} from 'lucide-react';
import { inventoryApi, financeApi } from '../services/api';
import { downloadFile } from '../utils/download';
import { getApiErrorMessage } from '../utils/apiError';
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
  PageQueryStatus,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { PurchaseOrderForm } from '../components/forms/PurchaseOrderForm';
import { RequisitionForm } from '../components/forms/RequisitionForm';
import { GoodsReceiptForm } from '../components/forms/GoodsReceiptForm';
import { SupplierForm } from '../components/forms/SupplierForm';
import { RfqForm } from '../components/forms/RfqForm';
import { RfqDetailPanel } from '../components/forms/RfqDetailPanel';
import { useAuth } from '../contexts/AuthContext';
import { ProcurementStats, PurchaseOrder, Supplier, GoodsReceipt } from '../types';

const tabs = ['Purchase Orders', 'Requisitions', 'RFQs', 'Goods Receipts', 'Suppliers'];

const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATEMENT_MODE_OPTIONS = [
  { value: 'FULL', label: 'Full statement (with payments)' },
  { value: 'OUTSTANDING', label: 'Outstanding invoices (amount due)' },
];

type ModalType = 'po' | 'requisition' | 'gr' | 'supplier' | 'rfq' | null;

type VendorStatementData = {
  mode: 'FULL' | 'OUTSTANDING';
  supplier: Supplier;
  period: { from: string | null; to: string };
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  closingBalance: number;
  totalDue: number;
  aging: {
    current: number;
    days1_30: number;
    days31_60: number;
    days61_90: number;
    days90Plus: number;
    amountDue: number;
  };
  lines: {
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
    paymentMethod?: string | null;
    invoiceTotal?: number;
    paidAmount?: number;
    balanceDue?: number;
    dueDate?: string | null;
    status?: string;
  }[];
};

export function ProcurementPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const [poPage, setPoPage] = useState(1);
  const [reqPage, setReqPage] = useState(1);
  const [rfqPage, setRfqPage] = useState(1);
  const [grPage, setGrPage] = useState(1);
  const [supPage, setSupPage] = useState(1);

  const [poSearch, setPoSearch] = useState('');
  const [reqSearch, setReqSearch] = useState('');
  const [reqStatus, setReqStatus] = useState('');
  const [rfqSearch, setRfqSearch] = useState('');
  const [grSearch, setGrSearch] = useState('');
  const [supSearch, setSupSearch] = useState('');

  const [modalType, setModalType] = useState<ModalType>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [rfqRequisitionId, setRfqRequisitionId] = useState<string | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<Record<string, unknown> | null>(null);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [poDetailOpen, setPoDetailOpen] = useState(false);
  const [selectedGr, setSelectedGr] = useState<GoodsReceipt | null>(null);
  const [grDetailOpen, setGrDetailOpen] = useState(false);
  const [postGrError, setPostGrError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'approve-req'; id: string }
    | { type: 'post-gr'; id: string }
    | { type: 'purchase-invoice'; id: string }
    | null
  >(null);
  const [statementSupplier, setStatementSupplier] = useState<Supplier | null>(null);
  const [statementFrom, setStatementFrom] = useState('');
  const [statementTo, setStatementTo] = useState('');
  const [statementMode, setStatementMode] = useState<'FULL' | 'OUTSTANDING'>('FULL');
  const [statementExportError, setStatementExportError] = useState<string | null>(null);
  const [statementExporting, setStatementExporting] = useState<'pdf' | 'excel' | null>(null);
  const [poPdfLoading, setPoPdfLoading] = useState(false);
  const [poActionError, setPoActionError] = useState<string | null>(null);
  const [poActionSuccess, setPoActionSuccess] = useState<string | null>(null);

  const canCreate = hasPermission('procurement:create');
  const canUpdate = hasPermission('procurement:update');
  const canInvoice = hasPermission('finance:create');
  const { data: stats } = useQuery({
    queryKey: ['procurement-stats'],
    queryFn: () => inventoryApi.procurementStats().then((r) => r.data.data as ProcurementStats),
  });

  const { data: purchaseOrders, isLoading: poLoading, isError: poError, error: poErr, refetch: refetchPo } = useQuery({
    queryKey: ['purchase-orders', poPage, poSearch],
    queryFn: () => inventoryApi.purchaseOrders({ page: poPage, limit: 15, search: poSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: requisitions, isLoading: reqLoading, isError: reqError, error: reqErr, refetch: refetchReq } = useQuery({
    queryKey: ['requisitions', reqPage, reqSearch, reqStatus],
    queryFn: () =>
      inventoryApi.requisitions({ page: reqPage, limit: 15, search: reqSearch || undefined, status: reqStatus || undefined }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: rfqs, isLoading: rfqLoading, isError: rfqError, error: rfqErr, refetch: refetchRfq } = useQuery({
    queryKey: ['rfqs', rfqPage, rfqSearch],
    queryFn: () => inventoryApi.rfqs({ page: rfqPage, limit: 15, search: rfqSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: goodsReceipts, isLoading: grLoading, isError: grError, error: grErr, refetch: refetchGr } = useQuery({
    queryKey: ['goods-receipts', grPage, grSearch],
    queryFn: () => inventoryApi.goodsReceipts({ page: grPage, limit: 15, search: grSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: suppliers, isLoading: supLoading, isError: supError, error: supErr, refetch: refetchSup } = useQuery({
    queryKey: ['suppliers', supPage, supSearch],
    queryFn: () => inventoryApi.suppliers({ page: supPage, limit: 15, search: supSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 4,
  });

  const {
    data: statementData,
    isLoading: statementLoading,
    isError: statementError,
    refetch: refetchStatement,
  } = useQuery({
    queryKey: ['vendor-statement', statementSupplier?.id, statementFrom, statementTo, statementMode],
    queryFn: () =>
      inventoryApi
        .vendorStatement(statementSupplier!.id, {
          from: statementFrom || undefined,
          to: statementTo || undefined,
          mode: statementMode,
        })
        .then((r) => r.data.data as VendorStatementData),
    enabled: !!statementSupplier,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.approveRequisition(id, 'APPROVED'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requisitions'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
    },
  });

  const postGrMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.postGoodsReceiptToStock(id),
    onSuccess: () => {
      setPostGrError(null);
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to post goods to stock. Complete a passed quality inspection first.';
      setPostGrError(message);
    },
  });

  const hasPassedInspection = (gr: GoodsReceipt | Record<string, unknown>) => {
    const inspections = (gr as GoodsReceipt).inspections || [];
    return inspections.some((i) => i.status === 'PASSED');
  };

  const canPostGr = (gr: GoodsReceipt | Record<string, unknown>) => {
    const status = (gr as GoodsReceipt).status;
    return status === 'PENDING' && hasPassedInspection(gr);
  };

  const handlePostGr = (gr: GoodsReceipt) => {
    setPostGrError(null);
    setPendingConfirm({ type: 'post-gr', id: gr.id });
  };

  const runPostGr = (grId: string) => {
    postGrMutation.mutate(grId, {
      onSuccess: () => {
        setSelectedGr((prev) => (prev?.id === grId ? { ...prev, status: 'APPROVED', inspectionStatus: 'PASSED' } : prev));
      },
      onSettled: () => setPendingConfirm(null),
    });
  };

  const purchaseInvoiceMutation = useMutation({
    mutationFn: (grnId: string) => financeApi.createPurchaseInvoiceFromGrn(grnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
      queryClient.invalidateQueries({ queryKey: ['finance-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['finance-stats'] });
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const downloadPoPdf = async (po: PurchaseOrder) => {
    setPoActionError(null);
    setPoActionSuccess(null);
    setPoPdfLoading(true);
    try {
      await downloadFile(inventoryApi.purchaseOrderPdfPath(po.id), `${po.poNumber}.pdf`);
    } catch (err) {
      setPoActionError(err instanceof Error ? err.message : 'Failed to download purchase order PDF');
    } finally {
      setPoPdfLoading(false);
    }
  };

  const sendPoMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.sendPurchaseOrder(id),
    onSuccess: (res) => {
      setPoActionError(null);
      setPoActionSuccess((res.data?.message as string) || 'Purchase order emailed to supplier');
    },
    onError: (err) => {
      setPoActionSuccess(null);
      setPoActionError(getApiErrorMessage(err));
    },
  });

  const openStatement = (supplier: Supplier) => {
    setStatementSupplier(supplier);
    setStatementFrom('');
    setStatementTo('');
    setStatementMode('FULL');
    setStatementExportError(null);
  };

  const exportStatement = async (format: 'pdf' | 'excel') => {
    if (!statementSupplier) return;
    setStatementExportError(null);
    setStatementExporting(format);
    const suffix = statementMode === 'OUTSTANDING' ? 'outstanding' : 'statement';
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    try {
      await downloadFile(
        `/inventory/suppliers/${statementSupplier.id}/statement/${format}`,
        `${statementSupplier.code}-${suffix}.${ext}`,
        {
          from: statementFrom || undefined,
          to: statementTo || undefined,
          mode: statementMode,
        }
      );
    } catch (err) {
      setStatementExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setStatementExporting(null);
    }
  };

  const openModal = (type: ModalType, supplier?: Supplier | null) => {
    setEditingSupplier(supplier ?? null);
    setModalType(type);
  };

  const openRfqModal = (requisitionId: string) => {
    setRfqRequisitionId(requisitionId);
    setModalType('rfq');
  };

  const closeModal = () => {
    setModalType(null);
    setEditingSupplier(null);
    setRfqRequisitionId(null);
  };

  const tabActions: Record<number, { label: string; type: ModalType }> = {
    0: { label: 'New Purchase Order', type: 'po' },
    1: { label: 'New Requisition', type: 'requisition' },
    3: { label: 'New Goods Receipt', type: 'gr' },
    4: { label: 'Add Supplier', type: 'supplier' },
  };

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
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            title="Download PDF"
            loading={poPdfLoading && selectedPo?.id === (row.id as string)}
            onClick={() => downloadPoPdf(row as unknown as PurchaseOrder)}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const requisitionColumns = [
    { key: 'requisitionNo', label: 'Req #' },
    { key: 'department', label: 'Department' },
    { key: 'priority', label: 'Priority' },
    {
      key: 'requiredDate',
      label: 'Required',
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
        const status = row.status as string;
        return (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {canUpdate && (status === 'PENDING' || status === 'DRAFT') && (
              <Button size="sm" loading={approveMutation.isPending} onClick={() => setPendingConfirm({ type: 'approve-req', id: row.id as string })}>
                Approve
              </Button>
            )}
            {canCreate && status === 'APPROVED' && (
              <Button size="sm" variant="secondary" onClick={() => openRfqModal(row.id as string)}>
                Create RFQ
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const rfqColumns = [
    { key: 'rfqNo', label: 'RFQ #' },
    {
      key: 'requisition',
      label: 'Requisition',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.requisition as { requisitionNo: string })?.requisitionNo || '-',
    },
    {
      key: 'dueDate',
      label: 'Due Date',
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
      key: 'quotations',
      label: 'Quotes',
      render: (val: unknown) => `${(val as unknown[])?.length || 0} supplier(s)`,
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedRfq(row); }}>
          Manage
        </Button>
      ),
    },
  ];

  const grColumns = [
    { key: 'grnNumber', label: 'GRN #' },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.supplier as { name: string })?.name || '-',
    },
    {
      key: 'receiptDate',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'inspectionStatus',
      label: 'Inspection',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        const gr = row as unknown as GoodsReceipt;
        if (!canUpdate || gr.status === 'APPROVED') return null;

        return (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {canPostGr(gr) ? (
              <Button
                size="sm"
                loading={postGrMutation.isPending && postGrMutation.variables === gr.id}
                onClick={() => handlePostGr(gr)}
              >
                Post to Stock
              </Button>
            ) : (
              <Link to="/quality">
                <Button size="sm" variant="secondary">
                  QC Required
                </Button>
              </Link>
            )}
            {canInvoice && gr.status === 'APPROVED' && (
              <Button
                size="sm"
                variant="secondary"
                loading={purchaseInvoiceMutation.isPending && purchaseInvoiceMutation.variables === gr.id}
                onClick={() => setPendingConfirm({ type: 'purchase-invoice', id: gr.id })}
              >
                Purchase Invoice
              </Button>
            )}
          </div>
        );
      },
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
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            title="Vendor statement"
            onClick={() => openStatement(row as unknown as Supplier)}
          >
            <FileText className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const modalTitles: Record<Exclude<ModalType, null>, string> = {
    po: 'New Purchase Order',
    requisition: 'New Requisition',
    gr: 'New Goods Receipt',
    supplier: editingSupplier ? 'Edit Supplier' : 'Add Supplier',
    rfq: 'Create Request for Quotation',
  };

  const toolbarActions =
    canCreate &&
    (activeTab === 0
      ? (
          <Button size="sm" onClick={() => openModal('po')}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Purchase Order
          </Button>
        )
      : tabActions[activeTab]
        ? (
            <Button size="sm" onClick={() => openModal(tabActions[activeTab].type)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {tabActions[activeTab].label}
            </Button>
          )
        : undefined);

  return (
    <div className="space-y-4">
      <PageQueryStatus
        isError={poError || reqError || rfqError || grError || supError}
        error={poErr || reqErr || rfqErr || grErr || supErr}
        onRetry={() => {
          void refetchPo();
          void refetchReq();
          void refetchRfq();
          void refetchGr();
          void refetchSup();
        }}
      />
      {stats && (
        <StatGrid>
          <StatCard title="Pending Requisitions" value={stats.pendingRequisitions} icon={<ClipboardList className="h-5 w-5 text-white" />} color="from-teal-500 to-teal-700" onClick={() => goToTab(1)} />
          <StatCard title="Open RFQs" value={stats.openRfqs} icon={<FileText className="h-5 w-5 text-white" />} color="from-indigo-500 to-indigo-700" onClick={() => goToTab(2)} />
          <StatCard title="Active PO Value" value={formatCurrency(stats.activePoValue)} icon={<ShoppingCart className="h-5 w-5 text-white" />} color="from-orange-500 to-orange-700" onClick={() => goToTab(0)} />
          <StatCard title="Suppliers" value={stats.suppliers} icon={<Users className="h-5 w-5 text-white" />} color="from-fuchsia-500 to-fuchsia-700" onClick={() => goToTab(4)} />
          <StatCard title="Active POs" value={stats.activePurchaseOrders} icon={<PackageCheck className="h-5 w-5 text-white" />} color="from-cyan-500 to-cyan-700" onClick={() => goToTab(0)} />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.pendingRequisitions > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <ClipboardList className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pendingRequisitions} pending requisitions
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setPoPage(1);
          setReqPage(1);
          setRfqPage(1);
          setGrPage(1);
          setSupPage(1);
        }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input placeholder="Search purchase orders…" value={poSearch} onChange={(e) => { setPoSearch(e.target.value); setPoPage(1); }} />
          </div>
          {(purchaseOrders?.data?.length || 0) === 0 && !poLoading ? (
            <div className="p-6">
              <EmptyState
                title="No purchase orders found"
                description="Create a purchase order from an approved RFQ or directly."
                action={
                  canCreate ? (
                    <Button onClick={() => openModal('po')}>
                      <Plus className="h-4 w-4 mr-2" />
                      New purchase order
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={poColumns}
              data={(purchaseOrders?.data as PurchaseOrder[]) || []}
              loading={poLoading}
              onRowClick={(row) => { setSelectedPo(row as unknown as PurchaseOrder); setPoDetailOpen(true); }}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={purchaseOrders?.pagination} page={poPage} onPageChange={setPoPage} label="orders" />
          </div>
        </DataPanel>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap gap-3">
            <Input placeholder="Search requisitions…" className="sm:max-w-md" value={reqSearch} onChange={(e) => { setReqSearch(e.target.value); setReqPage(1); }} />
            <Select options={STATUS_FILTER} value={reqStatus} onChange={(e) => { setReqStatus(e.target.value); setReqPage(1); }} className="w-40" />
          </div>
          {(requisitions?.data?.length || 0) === 0 && !reqLoading ? (
            <div className="p-6">
              <EmptyState
                title="No requisitions found"
                description="Submit a requisition to request materials or supplies."
                action={
                  canCreate ? (
                    <Button onClick={() => openModal('requisition')}>
                      <Plus className="h-4 w-4 mr-2" />
                      New requisition
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={requisitionColumns} data={requisitions?.data || []} loading={reqLoading} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={requisitions?.pagination} page={reqPage} onPageChange={setReqPage} label="requisitions" />
          </div>
        </DataPanel>
      )}

      {activeTab === 2 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input placeholder="Search RFQs…" value={rfqSearch} onChange={(e) => { setRfqSearch(e.target.value); setRfqPage(1); }} />
          </div>
          {(rfqs?.data?.length || 0) === 0 && !rfqLoading ? (
            <div className="p-6">
              <EmptyState title="No RFQs found" description="Create an RFQ from an approved requisition to collect supplier quotes." />
            </div>
          ) : (
            <Table columns={rfqColumns} data={rfqs?.data || []} loading={rfqLoading} onRowClick={(row) => setSelectedRfq(row as Record<string, unknown>)} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={rfqs?.pagination} page={rfqPage} onPageChange={setRfqPage} label="RFQs" />
          </div>
        </DataPanel>
      )}

      {activeTab === 3 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input placeholder="Search goods receipts…" value={grSearch} onChange={(e) => { setGrSearch(e.target.value); setGrPage(1); }} />
          </div>
          {(goodsReceipts?.data?.length || 0) === 0 && !grLoading ? (
            <div className="p-6">
              <EmptyState
                title="No goods receipts found"
                description="Record incoming deliveries against purchase orders."
                action={
                  canCreate ? (
                    <Button onClick={() => openModal('gr')}>
                      <Plus className="h-4 w-4 mr-2" />
                      New goods receipt
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={grColumns}
              data={(goodsReceipts?.data as GoodsReceipt[]) || []}
              loading={grLoading}
              onRowClick={(row) => {
                setSelectedGr(row as unknown as GoodsReceipt);
                setPostGrError(null);
                setGrDetailOpen(true);
              }}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={goodsReceipts?.pagination} page={grPage} onPageChange={setGrPage} label="receipts" />
          </div>
        </DataPanel>
      )}

      {activeTab === 4 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input placeholder="Search suppliers…" value={supSearch} onChange={(e) => { setSupSearch(e.target.value); setSupPage(1); }} />
          </div>
          {(suppliers?.data?.length || 0) === 0 && !supLoading ? (
            <div className="p-6">
              <EmptyState
                title="No suppliers found"
                description="Add suppliers to manage your procurement network."
                action={
                  canCreate ? (
                    <Button onClick={() => openModal('supplier')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add supplier
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={supplierColumns}
              data={suppliers?.data || []}
              loading={supLoading}
              onRowClick={(row) => openModal('supplier', row as unknown as Supplier)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={suppliers?.pagination} page={supPage} onPageChange={setSupPage} label="suppliers" />
          </div>
        </DataPanel>
      )}

      <Modal open={modalType !== null} onClose={closeModal} title={modalType ? modalTitles[modalType] : ''} size={modalType === 'po' || modalType === 'gr' ? 'xl' : 'lg'}>
        {modalType === 'po' && <PurchaseOrderForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'requisition' && <RequisitionForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'gr' && <GoodsReceiptForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'supplier' && <SupplierForm supplier={editingSupplier} onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'rfq' && rfqRequisitionId && <RfqForm requisitionId={rfqRequisitionId} onSuccess={closeModal} onCancel={closeModal} />}
      </Modal>

      <Modal open={selectedRfq !== null} onClose={() => setSelectedRfq(null)} title="RFQ — Supplier Quotes" size="lg">
        {selectedRfq && (
          <RfqDetailPanel rfq={selectedRfq as Parameters<typeof RfqDetailPanel>[0]['rfq']} onClose={() => setSelectedRfq(null)} />
        )}
      </Modal>

      <Modal open={grDetailOpen} onClose={() => { setGrDetailOpen(false); setSelectedGr(null); setPostGrError(null); }} title="Goods Receipt Details" size="lg">
        {selectedGr && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">GRN #</p><p className="font-semibold">{selectedGr.grnNumber}</p></div>
              <div><p className="text-slate-500">Supplier</p><p className="font-semibold">{selectedGr.supplier?.name || '-'}</p></div>
              <div><p className="text-slate-500">Receipt Date</p><p className="font-semibold">{formatDate(selectedGr.receiptDate)}</p></div>
              <div><p className="text-slate-500">Purchase Order</p><p className="font-semibold">{selectedGr.purchaseOrder?.poNumber || '-'}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selectedGr.status)}>{selectedGr.status}</Badge></div>
              <div><p className="text-slate-500">Inspection</p><Badge variant={getStatusBadge(selectedGr.inspectionStatus)}>{selectedGr.inspectionStatus.replace(/_/g, ' ')}</Badge></div>
            </div>

            {selectedGr.items && selectedGr.items.length > 0 && (
              <Card title="Received Items">
                {selectedGr.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{item.batchNumber ? `Batch ${item.batchNumber}` : 'Material item'}</span>
                    <span>{Number(item.quantity).toLocaleString()} {item.unit} × {formatCurrency(Number(item.unitCost))}</span>
                  </div>
                ))}
              </Card>
            )}

            {selectedGr.inspections && selectedGr.inspections.length > 0 && (
              <Card title="Quality Inspections">
                {selectedGr.inspections.map((inspection) => (
                  <div key={inspection.id} className="flex justify-between py-2 border-b border-border/60 last:border-0">
                    <span>{inspection.inspectionNo}</span>
                    <Badge variant={getStatusBadge(inspection.status)}>{inspection.status}</Badge>
                  </div>
                ))}
              </Card>
            )}

            {selectedGr.status === 'PENDING' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    Stock is not updated until a quality inspection passes and this receipt is posted to stock.
                  </p>
                </div>
              </div>
            )}

            {postGrError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{postGrError}</div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {selectedGr.status === 'PENDING' && !hasPassedInspection(selectedGr) && (
                <Link to="/quality">
                  <Button variant="secondary">
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Create QC Inspection
                  </Button>
                </Link>
              )}
              {canUpdate && canPostGr(selectedGr) && (
                <Button loading={postGrMutation.isPending} onClick={() => handlePostGr(selectedGr)}>
                  <PackageCheck className="h-4 w-4 mr-2" />
                  Post to Stock
                </Button>
              )}
              {canInvoice && selectedGr.status === 'APPROVED' && (
                <Button
                  variant="secondary"
                  loading={purchaseInvoiceMutation.isPending}
                  onClick={() => setPendingConfirm({ type: 'purchase-invoice', id: selectedGr.id })}
                >
                  Create Purchase Invoice
                </Button>
              )}
              {selectedGr.status === 'APPROVED' && (
                <Badge variant="success">Posted to inventory</Badge>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={poDetailOpen}
        onClose={() => {
          setPoDetailOpen(false);
          setSelectedPo(null);
          setPoActionError(null);
          setPoActionSuccess(null);
        }}
        title="Purchase Order Details"
        size="lg"
      >
        {selectedPo && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div><p className="text-slate-500">PO Number</p><p className="font-semibold">{selectedPo.poNumber}</p></div>
              <div><p className="text-slate-500">Supplier</p><p className="font-semibold">{selectedPo.supplier?.name}</p></div>
              <div><p className="text-slate-500">Date</p><p className="font-semibold">{formatDate(selectedPo.orderDate)}</p></div>
              <div><p className="text-slate-500">Status</p><Badge variant={getStatusBadge(selectedPo.status)}>{selectedPo.status}</Badge></div>
              <div><p className="text-slate-500">Total</p><p className="font-semibold text-lg">{formatCurrency(Number(selectedPo.totalAmount))}</p></div>
            </div>
            {selectedPo.items?.length > 0 && (
              <Card title="Line Items">
                {selectedPo.items.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 border-b border-border/60 last:border-0 text-sm">
                    <span>{item.description}</span>
                    <span>{Number(item.quantity).toLocaleString()} × {formatCurrency(Number(item.unitPrice))}</span>
                  </div>
                ))}
              </Card>
            )}
            {poActionError && <Alert variant="error">{poActionError}</Alert>}
            {poActionSuccess && <Alert variant="success">{poActionSuccess}</Alert>}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                loading={poPdfLoading}
                onClick={() => downloadPoPdf(selectedPo)}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Download PDF
              </Button>
              {selectedPo.supplier?.email && (canCreate || canUpdate) && (
                <Button
                  variant="secondary"
                  loading={sendPoMutation.isPending}
                  onClick={() => sendPoMutation.mutate(selectedPo.id)}
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  Email to supplier
                </Button>
              )}
              {selectedPo.supplier?.id && (
                <Button
                  variant="secondary"
                  onClick={() => openStatement(selectedPo.supplier)}
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Vendor statement
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!statementSupplier}
        onClose={() => setStatementSupplier(null)}
        title={statementSupplier ? `Vendor statement — ${statementSupplier.name}` : 'Vendor statement'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Statement type"
              options={STATEMENT_MODE_OPTIONS}
              value={statementMode}
              onChange={(e) => setStatementMode(e.target.value as 'FULL' | 'OUTSTANDING')}
              className="w-64"
            />
            <Input
              label="From"
              type="date"
              value={statementFrom}
              onChange={(e) => setStatementFrom(e.target.value)}
              className="w-44"
            />
            <Input
              label="To"
              type="date"
              value={statementTo}
              onChange={(e) => setStatementTo(e.target.value)}
              className="w-44"
            />
            <Button variant="secondary" size="sm" onClick={() => refetchStatement()}>
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={statementExporting === 'pdf'}
              disabled={!!statementExporting || statementLoading}
              onClick={() => exportStatement('pdf')}
            >
              <Download className="h-4 w-4 mr-1" />
              PDF
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={statementExporting === 'excel'}
              disabled={!!statementExporting || statementLoading}
              onClick={() => exportStatement('excel')}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" />
              Excel
            </Button>
          </div>
          {statementSupplier && (
            <p className="text-xs text-slate-500">
              {statementSupplier.code}
              {statementMode === 'OUTSTANDING'
                ? ' · Open purchase invoices still owed to this vendor'
                : ' · Full AP ledger including payments'}
            </p>
          )}
          {statementExportError && <Alert variant="error">{statementExportError}</Alert>}
          {statementLoading && <p className="text-sm text-slate-500 py-6 text-center">Loading statement…</p>}
          {statementError && (
            <Alert variant="error">Failed to load statement. Try again.</Alert>
          )}
          {statementData && !statementLoading && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm rounded-xl bg-slate-900 text-white p-3">
                {[
                  { label: 'Current', value: statementData.aging?.current ?? 0 },
                  { label: '1–30 past due', value: statementData.aging?.days1_30 ?? 0 },
                  { label: '31–60 days past due', value: statementData.aging?.days31_60 ?? 0 },
                  {
                    label: '61–90 days past due',
                    value: (statementData.aging?.days61_90 ?? 0) + (statementData.aging?.days90Plus ?? 0),
                  },
                  { label: 'Amount due', value: statementData.aging?.amountDue ?? statementData.totalDue, emphasize: true },
                ].map((col) => (
                  <div key={col.label} className="px-1 py-1 text-center">
                    <p className={`text-[10px] uppercase tracking-wide ${col.emphasize ? 'text-slate-200' : 'text-slate-400'}`}>
                      {col.label}
                    </p>
                    <p className={`tabular-nums font-semibold mt-1 ${col.emphasize ? 'text-base' : 'text-sm'}`}>
                      {formatCurrency(col.value)}
                    </p>
                  </div>
                ))}
              </div>
              {statementData.lines.length === 0 ? (
                <EmptyState
                  title={statementMode === 'OUTSTANDING' ? 'No outstanding invoices' : 'No transactions in this period'}
                  description={
                    statementMode === 'OUTSTANDING'
                      ? 'This vendor has no open balances for the selected dates.'
                      : 'Adjust the date range or wait for purchase invoices and payments.'
                  }
                />
              ) : (
                <div className="table-scroll-x max-h-[50vh] border border-border/60 rounded-xl">
                  <table className="min-w-max w-full text-sm">
                    <thead className="bg-surface-muted/80 sticky top-0">
                      {statementMode === 'OUTSTANDING' ? (
                        <tr className="text-left text-xs text-slate-500">
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Invoice</th>
                          <th className="px-3 py-2 font-medium">Due</th>
                          <th className="px-3 py-2 font-medium">Status</th>
                          <th className="px-3 py-2 font-medium text-right">Invoiced</th>
                          <th className="px-3 py-2 font-medium text-right">Paid</th>
                          <th className="px-3 py-2 font-medium text-right">Balance due</th>
                        </tr>
                      ) : (
                        <tr className="text-left text-xs text-slate-500">
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Reference</th>
                          <th className="px-3 py-2 font-medium">Description</th>
                          <th className="px-3 py-2 font-medium text-right">Debit</th>
                          <th className="px-3 py-2 font-medium text-right">Credit</th>
                          <th className="px-3 py-2 font-medium text-right">Balance</th>
                        </tr>
                      )}
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {statementData.lines.map((line, i) =>
                        statementMode === 'OUTSTANDING' ? (
                          <tr key={`${line.reference}-${i}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(line.date)}</td>
                            <td className="px-3 py-2 font-medium">{line.reference}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{line.dueDate ? formatDate(line.dueDate) : '—'}</td>
                            <td className="px-3 py-2">
                              <Badge variant={getStatusBadge(line.status || 'UNPAID')}>
                                {(line.status || 'UNPAID').replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(line.invoiceTotal || 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(line.paidAmount || 0)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(line.balanceDue || line.debit)}</td>
                          </tr>
                        ) : (
                          <tr key={`${line.reference}-${i}`}>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(line.date)}</td>
                            <td className="px-3 py-2">
                              <Badge variant={line.type === 'PAYMENT' ? 'success' : 'info'}>
                                {line.type === 'PAYMENT'
                                  ? line.paymentMethod || 'Payment'
                                  : line.type.replace(/_/g, ' ')}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 font-medium">{line.reference}</td>
                            <td className="px-3 py-2 text-slate-600 max-w-[220px] truncate" title={line.description}>{line.description}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.debit ? formatCurrency(line.debit) : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.credit ? formatCurrency(line.credit) : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(line.balance)}</td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={
          pendingConfirm?.type === 'approve-req'
            ? 'Approve requisition?'
            : pendingConfirm?.type === 'post-gr'
              ? 'Post goods to stock?'
              : 'Create purchase invoice?'
        }
        message={
          pendingConfirm?.type === 'approve-req'
            ? 'This approves the requisition for procurement. Continue?'
            : pendingConfirm?.type === 'post-gr'
              ? 'Stock levels will be updated. This action should only be done after QC passes.'
              : 'A purchase invoice will be created from this goods receipt.'
        }
        confirmLabel={
          pendingConfirm?.type === 'approve-req'
            ? 'Approve'
            : pendingConfirm?.type === 'post-gr'
              ? 'Post to Stock'
              : 'Create Invoice'
        }
        loading={approveMutation.isPending || postGrMutation.isPending || purchaseInvoiceMutation.isPending}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (!pendingConfirm) return;
          if (pendingConfirm.type === 'approve-req') {
            approveMutation.mutate(pendingConfirm.id, { onSettled: () => setPendingConfirm(null) });
          } else if (pendingConfirm.type === 'post-gr') {
            runPostGr(pendingConfirm.id);
          } else {
            purchaseInvoiceMutation.mutate(pendingConfirm.id, { onSettled: () => setPendingConfirm(null) });
          }
        }}
      />
    </div>
  );
}
