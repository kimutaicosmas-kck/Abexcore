import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardList, FileText, Users, ShoppingCart, PackageCheck, ShieldCheck } from 'lucide-react';
import { inventoryApi, financeApi } from '../services/api';
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

type ModalType = 'po' | 'requisition' | 'gr' | 'supplier' | 'rfq' | null;

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

  const canCreate = hasPermission('procurement:create');
  const canUpdate = hasPermission('procurement:update');
  const canInvoice = hasPermission('finance:create');

  const { data: stats } = useQuery({
    queryKey: ['procurement-stats'],
    queryFn: () => inventoryApi.procurementStats().then((r) => r.data.data as ProcurementStats),
  });

  const { data: purchaseOrders, isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders', poPage, poSearch],
    queryFn: () => inventoryApi.purchaseOrders({ page: poPage, limit: 15, search: poSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: requisitions, isLoading: reqLoading } = useQuery({
    queryKey: ['requisitions', reqPage, reqSearch, reqStatus],
    queryFn: () =>
      inventoryApi.requisitions({ page: reqPage, limit: 15, search: reqSearch || undefined, status: reqStatus || undefined }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: rfqs, isLoading: rfqLoading } = useQuery({
    queryKey: ['rfqs', rfqPage, rfqSearch],
    queryFn: () => inventoryApi.rfqs({ page: rfqPage, limit: 15, search: rfqSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: goodsReceipts, isLoading: grLoading } = useQuery({
    queryKey: ['goods-receipts', grPage, grSearch],
    queryFn: () => inventoryApi.goodsReceipts({ page: grPage, limit: 15, search: grSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: suppliers, isLoading: supLoading } = useQuery({
    queryKey: ['suppliers', supPage, supSearch],
    queryFn: () => inventoryApi.suppliers({ page: supPage, limit: 15, search: supSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 4,
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
    postGrMutation.mutate(gr.id, {
      onSuccess: () => {
        setSelectedGr((prev) => (prev?.id === gr.id ? { ...prev, status: 'APPROVED', inspectionStatus: 'PASSED' } : prev));
      },
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
              <Button size="sm" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(row.id as string)}>
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
                onClick={() => purchaseInvoiceMutation.mutate(gr.id)}
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
  ];

  const modalTitles: Record<Exclude<ModalType, null>, string> = {
    po: 'New Purchase Order',
    requisition: 'New Requisition',
    gr: 'New Goods Receipt',
    supplier: editingSupplier ? 'Edit Supplier' : 'Add Supplier',
    rfq: 'Create Request for Quotation',
  };

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
      <PageHeader subtitle="Requisition → RFQ → PO → goods receipt workflow" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Pending Requisitions" value={stats.pendingRequisitions} icon={<ClipboardList className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Open RFQs" value={stats.openRfqs} icon={<FileText className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Active PO Value" value={formatCurrency(stats.activePoValue)} icon={<ShoppingCart className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Suppliers" value={stats.suppliers} icon={<Users className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

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
        actions={
          canCreate && tabActions[activeTab] ? (
            <Button onClick={() => openModal(tabActions[activeTab].type)}>
              <Plus className="h-4 w-4 mr-2" />
              {tabActions[activeTab].label}
            </Button>
          ) : undefined
        }
      />

      {activeTab === 0 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search purchase orders…" value={poSearch} onChange={(e) => { setPoSearch(e.target.value); setPoPage(1); }} />
          </div>
          <Table
            columns={poColumns}
            data={(purchaseOrders?.data as PurchaseOrder[]) || []}
            loading={poLoading}
            onRowClick={(row) => { setSelectedPo(row as unknown as PurchaseOrder); setPoDetailOpen(true); }}
          />
          {renderPagination(purchaseOrders?.pagination, poPage, setPoPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search requisitions…" className="max-w-sm" value={reqSearch} onChange={(e) => { setReqSearch(e.target.value); setReqPage(1); }} />
            <Select options={STATUS_FILTER} value={reqStatus} onChange={(e) => { setReqStatus(e.target.value); setReqPage(1); }} className="w-40" />
          </div>
          <Table columns={requisitionColumns} data={requisitions?.data || []} loading={reqLoading} />
          {renderPagination(requisitions?.pagination, reqPage, setReqPage)}
        </>
      )}

      {activeTab === 2 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search RFQs…" value={rfqSearch} onChange={(e) => { setRfqSearch(e.target.value); setRfqPage(1); }} />
          </div>
          <Table columns={rfqColumns} data={rfqs?.data || []} loading={rfqLoading} onRowClick={(row) => setSelectedRfq(row as Record<string, unknown>)} />
          {renderPagination(rfqs?.pagination, rfqPage, setRfqPage)}
        </>
      )}

      {activeTab === 3 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search goods receipts…" value={grSearch} onChange={(e) => { setGrSearch(e.target.value); setGrPage(1); }} />
          </div>
          <Table
            columns={grColumns}
            data={(goodsReceipts?.data as GoodsReceipt[]) || []}
            loading={grLoading}
            onRowClick={(row) => {
              setSelectedGr(row as unknown as GoodsReceipt);
              setPostGrError(null);
              setGrDetailOpen(true);
            }}
          />
          {renderPagination(goodsReceipts?.pagination, grPage, setGrPage)}
        </>
      )}

      {activeTab === 4 && (
        <>
          <div className="mb-4 max-w-sm">
            <Input placeholder="Search suppliers…" value={supSearch} onChange={(e) => { setSupSearch(e.target.value); setSupPage(1); }} />
          </div>
          <Table
            columns={supplierColumns}
            data={suppliers?.data || []}
            loading={supLoading}
            onRowClick={(row) => openModal('supplier', row as unknown as Supplier)}
          />
          {renderPagination(suppliers?.pagination, supPage, setSupPage)}
        </>
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
                  onClick={() => purchaseInvoiceMutation.mutate(selectedGr.id)}
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

      <Modal open={poDetailOpen} onClose={() => { setPoDetailOpen(false); setSelectedPo(null); }} title="Purchase Order Details" size="lg">
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
          </div>
        )}
      </Modal>
    </div>
  );
}
