import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { inventoryApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { PurchaseOrderForm } from '../components/forms/PurchaseOrderForm';
import { RequisitionForm } from '../components/forms/RequisitionForm';
import { GoodsReceiptForm } from '../components/forms/GoodsReceiptForm';
import { SupplierForm } from '../components/forms/SupplierForm';
import { RfqForm } from '../components/forms/RfqForm';
import { RfqDetailPanel } from '../components/forms/RfqDetailPanel';
import { Supplier } from '../types';

const tabs = ['Purchase Orders', 'Requisitions', 'RFQs', 'Goods Receipts', 'Suppliers'];

type ModalType = 'po' | 'requisition' | 'gr' | 'supplier' | 'rfq' | null;

export function ProcurementPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [modalType, setModalType] = useState<ModalType>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [rfqRequisitionId, setRfqRequisitionId] = useState<string | null>(null);
  const [selectedRfq, setSelectedRfq] = useState<Record<string, unknown> | null>(null);

  const { data: purchaseOrders, isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => inventoryApi.purchaseOrders().then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: requisitions, isLoading: reqLoading } = useQuery({
    queryKey: ['requisitions'],
    queryFn: () => inventoryApi.requisitions().then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: rfqs, isLoading: rfqLoading } = useQuery({
    queryKey: ['rfqs'],
    queryFn: () => inventoryApi.rfqs().then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: goodsReceipts, isLoading: grLoading } = useQuery({
    queryKey: ['goods-receipts'],
    queryFn: () => inventoryApi.goodsReceipts().then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: suppliers, isLoading: supLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => inventoryApi.suppliers().then((r) => r.data),
    enabled: activeTab === 4,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => inventoryApi.approveRequisition(id, 'APPROVED'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requisitions'] }),
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
          <div className="flex gap-1">
            {status === 'PENDING' || status === 'DRAFT' ? (
              <Button
                size="sm"
                loading={approveMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  approveMutation.mutate(row.id as string);
                }}
              >
                Approve
              </Button>
            ) : null}
            {status === 'APPROVED' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  openRfqModal(row.id as string);
                }}
              >
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

  return (
    <div>
      <PageHeader
        title="Procurement"
        subtitle="Requisition → RFQ → Quote → Award → PO → Goods Receipt"
        action={
          tabActions[activeTab] ? (
            <Button onClick={() => openModal(tabActions[activeTab].type)}>
              <Plus className="h-4 w-4 mr-2" />
              {tabActions[activeTab].label}
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
          <Table columns={poColumns} data={purchaseOrders?.data || []} loading={poLoading} />
        </div>
      )}

      {activeTab === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={requisitionColumns} data={requisitions?.data || []} loading={reqLoading} />
        </div>
      )}

      {activeTab === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={rfqColumns}
            data={rfqs?.data || []}
            loading={rfqLoading}
            onRowClick={(row) => setSelectedRfq(row as Record<string, unknown>)}
          />
        </div>
      )}

      {activeTab === 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={grColumns} data={goodsReceipts?.data || []} loading={grLoading} />
        </div>
      )}

      {activeTab === 4 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table
            columns={supplierColumns}
            data={suppliers?.data || []}
            loading={supLoading}
            onRowClick={(row) => openModal('supplier', row as unknown as Supplier)}
          />
        </div>
      )}

      <Modal
        open={modalType !== null}
        onClose={closeModal}
        title={modalType ? modalTitles[modalType] : ''}
        size={modalType === 'po' || modalType === 'gr' ? 'xl' : 'lg'}
      >
        {modalType === 'po' && <PurchaseOrderForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'requisition' && <RequisitionForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'gr' && <GoodsReceiptForm onSuccess={closeModal} onCancel={closeModal} />}
        {modalType === 'supplier' && (
          <SupplierForm supplier={editingSupplier} onSuccess={closeModal} onCancel={closeModal} />
        )}
        {modalType === 'rfq' && rfqRequisitionId && (
          <RfqForm requisitionId={rfqRequisitionId} onSuccess={closeModal} onCancel={closeModal} />
        )}
      </Modal>

      <Modal
        open={selectedRfq !== null}
        onClose={() => setSelectedRfq(null)}
        title="RFQ — Supplier Quotes"
        size="lg"
      >
        {selectedRfq && (
          <RfqDetailPanel
            rfq={selectedRfq as Parameters<typeof RfqDetailPanel>[0]['rfq']}
            onClose={() => setSelectedRfq(null)}
          />
        )}
      </Modal>
    </div>
  );
}
