import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Plus } from 'lucide-react';
import { financeApi } from '../services/api';
import { PageHeader, Table, Badge, Card, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { InvoiceForm } from '../components/forms/InvoiceForm';
import { PaymentForm } from '../components/forms/PaymentForm';
import { JournalEntryForm } from '../components/forms/JournalEntryForm';
import { downloadFile } from '../utils/download';

export function FinancePage() {
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [journalModalOpen, setJournalModalOpen] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [showJournalEntries, setShowJournalEntries] = useState(false);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => financeApi.invoices().then((r) => r.data),
  });

  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.accounts().then((r) => r.data.data),
  });

  const { data: journalEntries } = useQuery({
    queryKey: ['journal-entries'],
    queryFn: () => financeApi.journalEntries().then((r) => r.data.data),
    enabled: showJournalEntries,
  });

  const { data: summary } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => financeApi.reportsSummary().then((r) => r.data.data),
  });

  const { data: reconciliation } = useQuery({
    queryKey: ['bank-reconciliation'],
    queryFn: () => financeApi.bankReconciliation().then((r) => r.data.data),
    enabled: showReconciliation,
  });

  const reconcileMutation = useMutation({
    mutationFn: (id: string) => financeApi.reconcilePayment(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bank-reconciliation'] }),
  });

  const handleExport = async (id: string, type: 'pdf' | 'excel', invoiceNumber: string) => {
    setDownloading(`${id}-${type}`);
    try {
      const url = type === 'pdf'
        ? `/api/v1/finance/invoices/${id}/pdf`
        : `/api/v1/finance/invoices/${id}/excel`;
      await downloadFile(url, `${invoiceNumber}.${type === 'pdf' ? 'pdf' : 'xlsx'}`);
    } finally {
      setDownloading(null);
    }
  };

  const invoiceColumns = [
    { key: 'invoiceNumber', label: 'Invoice #' },
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => (
        <Badge variant={val === 'SALES' ? 'success' : 'info'}>{val as string}</Badge>
      ),
    },
    {
      key: 'party',
      label: 'Customer/Supplier',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.customer as { name: string })?.name ||
        (row.supplier as { name: string })?.name || '-',
    },
    {
      key: 'invoiceDate',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'totalAmount',
      label: 'Amount',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={getStatusBadge(val as string)}>{val as string}</Badge>
      ),
    },
    {
      key: 'export',
      label: 'Export',
      render: (_: unknown, row: Record<string, unknown>) => {
        const id = row.id as string;
        const invoiceNumber = row.invoiceNumber as string;
        return (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              loading={downloading === `${id}-pdf`}
              onClick={(e) => { e.stopPropagation(); handleExport(id, 'pdf', invoiceNumber); }}
              title="Download PDF"
            >
              <FileText className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              loading={downloading === `${id}-excel`}
              onClick={(e) => { e.stopPropagation(); handleExport(id, 'excel', invoiceNumber); }}
              title="Download Excel"
            >
              <FileSpreadsheet className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Invoices, payments, accounts, and financial management"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowJournalEntries(!showJournalEntries)}>
              Journal Entries
            </Button>
            <Button variant="secondary" onClick={() => setJournalModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Post Journal
            </Button>
            <Button variant="secondary" onClick={() => setShowReconciliation(!showReconciliation)}>
              Bank Reconciliation
            </Button>
            <Button variant="secondary" onClick={() => setPaymentModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
            <Button onClick={() => setInvoiceModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Invoice
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <p className="text-sm text-gray-500">Total Sales</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(summary?.totalSales || 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Total Purchases</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(summary?.totalPurchases || 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Net Position</p>
          <p className="text-2xl font-bold text-primary-600">
            {formatCurrency((summary?.totalSales || 0) - (summary?.totalPurchases || 0))}
          </p>
        </Card>
      </div>

      {showJournalEntries && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Journal Entries</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <Table
              columns={[
                { key: 'entryNumber', label: 'Entry #' },
                { key: 'date', label: 'Date', render: (v: unknown) => formatDate(v as string) },
                { key: 'description', label: 'Description' },
                { key: 'reference', label: 'Reference' },
                {
                  key: 'lines',
                  label: 'Lines',
                  render: (val: unknown) => {
                    const lines = val as Array<{ account: { code: string }; debit: number; credit: number }>;
                    return lines?.length || 0;
                  },
                },
                {
                  key: 'isPosted',
                  label: 'Status',
                  render: (val: unknown) => (
                    <Badge variant={val ? 'success' : 'warning'}>{val ? 'Posted' : 'Draft'}</Badge>
                  ),
                },
              ]}
              data={journalEntries || []}
            />
          </div>
        </div>
      )}

      {showReconciliation && reconciliation && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-4">Bank Reconciliation</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <Card>
              <p className="text-sm text-gray-500">Bank Balance (GL)</p>
              <p className="text-xl font-bold">{formatCurrency(reconciliation.bankBalance)}</p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Unreconciled Payments</p>
              <p className="text-xl font-bold text-amber-600">{formatCurrency(reconciliation.unreconciledTotal)}</p>
            </Card>
            <Card>
              <p className="text-sm text-gray-500">Pending Items</p>
              <p className="text-xl font-bold">{reconciliation.unreconciled?.length || 0}</p>
            </Card>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <Table
              columns={[
                { key: 'paymentNumber', label: 'Payment #' },
                { key: 'method', label: 'Method' },
                { key: 'paymentDate', label: 'Date', render: (v: unknown) => formatDate(v as string) },
                { key: 'amount', label: 'Amount', render: (v: unknown) => formatCurrency(v as number) },
                { key: 'reference', label: 'Reference' },
                {
                  key: 'actions',
                  label: '',
                  render: (_: unknown, row: Record<string, unknown>) => (
                    <Button
                      size="sm"
                      loading={reconcileMutation.isPending}
                      onClick={() => reconcileMutation.mutate(row.id as string)}
                    >
                      Reconcile
                    </Button>
                  ),
                },
              ]}
              data={reconciliation.unreconciled || []}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2">
          <h2 className="text-lg font-semibold mb-4">Invoices</h2>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200">
            <Table columns={invoiceColumns} data={invoices?.data || []} loading={isLoading} />
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Chart of Accounts</h2>
          <Card>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {accounts?.map((acc: { id: string; code: string; name: string; type: string; balance: number }) => (
                <div key={acc.id} className="flex justify-between text-sm py-1 border-b border-gray-100">
                  <span className="text-gray-600">{acc.code} - {acc.name}</span>
                  <span className="font-medium">{formatCurrency(Number(acc.balance))}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={invoiceModalOpen} onClose={() => setInvoiceModalOpen(false)} title="Create Invoice" size="xl">
        <InvoiceForm onSuccess={() => setInvoiceModalOpen(false)} onCancel={() => setInvoiceModalOpen(false)} />
      </Modal>

      <Modal open={paymentModalOpen} onClose={() => setPaymentModalOpen(false)} title="Record Payment" size="md">
        <PaymentForm onSuccess={() => setPaymentModalOpen(false)} onCancel={() => setPaymentModalOpen(false)} />
      </Modal>

      <Modal open={journalModalOpen} onClose={() => setJournalModalOpen(false)} title="Post Journal Entry" size="xl">
        <JournalEntryForm
          onSuccess={() => {
            setJournalModalOpen(false);
            setShowJournalEntries(true);
          }}
          onCancel={() => setJournalModalOpen(false)}
        />
      </Modal>
    </div>
  );
}
