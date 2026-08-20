import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, X, Send, Ban } from 'lucide-react';
import { expensesApi } from '../../services/api';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFormBody,
  Select,
  Table,
  TablePagination,
  Textarea,
  formatCurrency,
  formatDate,
} from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { useAuth } from '../../contexts/AuthContext';

export type ExpensesPanelHandle = {
  openCreate: () => void;
};

type ExpenseRow = {
  id: string;
  expenseNumber: string;
  expenseDate: string;
  payeeName: string;
  description: string;
  amount: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: string;
  status: string;
  receiptUrl?: string | null;
  categoryAccount?: { code: string; name: string };
  submittedBy?: { firstName: string; lastName: string };
};

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  DRAFT: 'default',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  POSTED: 'success',
  VOIDED: 'danger',
};

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash / petty cash' },
  { value: 'PETTY_CASH', label: 'Petty cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'MPESA', label: 'M-Pesa' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'CARD', label: 'Card' },
];

export const ExpensesPanel = forwardRef<ExpensesPanelHandle>(function ExpensesPanel(_props, ref) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('finance:create');
  const canApprove = hasPermission('finance:approve') || hasPermission('finance:update');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState('');

  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryAccountId, setCategoryAccountId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [submitOnCreate, setSubmitOnCreate] = useState(true);

  const { data: categories } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () =>
      expensesApi.categories().then(
        (r) => r.data.data as { id: string; code: string; name: string }[]
      ),
  });

  const { data: summary } = useQuery({
    queryKey: ['expense-summary'],
    queryFn: () =>
      expensesApi.summary().then(
        (r) =>
          r.data.data as {
            count: number;
            totalAmount: number;
            byCategory: { account: { code: string; name: string } | null; totalAmount: number }[];
          }
      ),
  });

  const listQuery = useQuery({
    queryKey: ['expenses', page, status, search],
    queryFn: () =>
      expensesApi
        .list({
          page,
          limit: 20,
          status: status || undefined,
          search: search || undefined,
        })
        .then(
          (r) =>
            r.data as {
              data: ExpenseRow[];
              pagination: { page: number; total: number; totalPages: number };
            }
        ),
  });

  const resetForm = () => {
    setExpenseDate(new Date().toISOString().slice(0, 10));
    setCategoryAccountId(categories?.[0]?.id || '');
    setPayeeName('');
    setDescription('');
    setAmount('');
    setVatAmount('0');
    setPaymentMethod('CASH');
    setReference('');
    setNotes('');
    setReceiptFile(null);
    setSubmitOnCreate(true);
    setError('');
  };

  const openCreate = () => {
    resetForm();
    if (categories?.[0]) setCategoryAccountId(categories[0].id);
    setModalOpen(true);
  };

  useImperativeHandle(ref, () => ({ openCreate }), [categories]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Save draft first when a receipt is attached so upload works before approval submit.
      const shouldSubmit = submitOnCreate;
      const created = await expensesApi.create({
        expenseDate,
        categoryAccountId,
        payeeName,
        description,
        amount: Number(amount),
        vatAmount: Number(vatAmount || 0),
        paymentMethod,
        reference: reference || null,
        notes: notes || null,
        submit: shouldSubmit && !receiptFile,
      });
      const id = created.data?.data?.id as string | undefined;
      if (!id) return created;
      if (receiptFile) {
        await expensesApi.uploadReceipt(id, receiptFile);
      }
      if (shouldSubmit && receiptFile) {
        await expensesApi.submit(id);
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
      setModalOpen(false);
      resetForm();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      id,
      action,
      decision,
    }: {
      id: string;
      action: 'submit' | 'decide' | 'post' | 'void';
      decision?: 'APPROVED' | 'REJECTED';
    }) => {
      if (action === 'submit') return expensesApi.submit(id);
      if (action === 'decide') return expensesApi.decide(id, { decision: decision! });
      if (action === 'post') return expensesApi.post(id);
      return expensesApi.void(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'Select category' },
      ...(categories || []).map((c) => ({
        value: c.id,
        label: c.name,
      })),
    ],
    [categories]
  );

  const rows = listQuery.data?.data || [];

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Posted expenses</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">
            {formatCurrency(summary?.totalAmount || 0)}
          </p>
          <p className="text-xs text-slate-500 mt-1">{summary?.count || 0} entries on ledger</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:col-span-2">
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">By category</p>
          <div className="flex flex-wrap gap-2">
            {(summary?.byCategory || []).slice(0, 6).map((row, idx) => (
              <span
                key={row.account?.code || idx}
                className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
              >
                {row.account ? `${row.account.code} ${row.account.name}` : 'Category'}:{' '}
                {formatCurrency(row.totalAmount)}
              </span>
            ))}
            {!summary?.byCategory?.length && (
              <span className="text-sm text-slate-500">No posted expenses yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Search payee or EXP-…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <Select
          options={[
            { value: '', label: 'All statuses' },
            { value: 'DRAFT', label: 'Draft' },
            { value: 'PENDING_APPROVAL', label: 'Pending approval' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'POSTED', label: 'Posted' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'VOIDED', label: 'Voided' },
          ]}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-slate-500">Loading expenses…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          description="Record rent, fuel, utilities, and other operating costs. Approved expenses post to the ledger and P&L."
          action={
            canCreate ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New expense
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table
            embedded
            columns={[
              { key: 'expenseNumber', label: 'Number' },
              {
                key: 'expenseDate',
                label: 'Date',
                render: (v) => formatDate(v as string),
              },
              { key: 'payeeName', label: 'Payee' },
              {
                key: 'categoryAccount',
                label: 'Category',
                render: (_v, row) => {
                  const cat = (row as ExpenseRow).categoryAccount;
                  return cat?.name || '—';
                },
              },
              {
                key: 'totalAmount',
                label: 'Total',
                render: (v) => formatCurrency(Number(v)),
              },
              {
                key: 'status',
                label: 'Status',
                render: (v) => (
                  <Badge variant={STATUS_VARIANT[String(v)] || 'default'}>
                    {String(v).replace(/_/g, ' ')}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                label: '',
                render: (_v, row) => {
                  const expense = row as unknown as ExpenseRow;
                  return (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {(expense.status === 'DRAFT' || expense.status === 'REJECTED') && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={actionMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            actionMutation.mutate({ id: expense.id, action: 'submit' });
                          }}
                        >
                          <Send className="h-3.5 w-3.5 mr-1" /> Submit
                        </Button>
                      )}
                      {canApprove && expense.status === 'PENDING_APPROVAL' && (
                        <>
                          <Button
                            size="sm"
                            loading={actionMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              actionMutation.mutate({
                                id: expense.id,
                                action: 'decide',
                                decision: 'APPROVED',
                              });
                            }}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={actionMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              actionMutation.mutate({
                                id: expense.id,
                                action: 'decide',
                                decision: 'REJECTED',
                              });
                            }}
                          >
                            <X className="h-3.5 w-3.5 mr-1" /> Reject
                          </Button>
                        </>
                      )}
                      {canApprove && expense.status === 'APPROVED' && (
                        <Button
                          size="sm"
                          loading={actionMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            actionMutation.mutate({ id: expense.id, action: 'post' });
                          }}
                        >
                          Post to GL
                        </Button>
                      )}
                      {canApprove && expense.status === 'POSTED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={actionMutation.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              window.confirm(
                                `Void ${expense.expenseNumber}? This reverses the journal.`
                              )
                            ) {
                              actionMutation.mutate({ id: expense.id, action: 'void' });
                            }
                          }}
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" /> Void
                        </Button>
                      )}
                    </div>
                  );
                },
              },
            ]}
            data={rows}
          />
          <TablePagination
            pagination={listQuery.data?.pagination}
            page={page}
            onPageChange={setPage}
            label="expenses"
          />
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !createMutation.isPending && setModalOpen(false)}
        title="New operating expense"
        size="lg"
      >
        <ModalFormBody
          footer={
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={createMutation.isPending}
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={createMutation.isPending}
                onClick={() => {
                  setError('');
                  if (!categoryAccountId) {
                    setError('Select an expense category');
                    return;
                  }
                  if (!payeeName.trim() || !description.trim() || !(Number(amount) > 0)) {
                    setError('Payee, description, and amount are required');
                    return;
                  }
                  createMutation.mutate();
                }}
              >
                {submitOnCreate ? 'Save & submit' : 'Save draft'}
              </Button>
            </div>
          }
        >
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Date *"
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
            <Select
              label="Category *"
              options={categoryOptions}
              value={categoryAccountId}
              onChange={(e) => setCategoryAccountId(e.target.value)}
            />
            <Input
              label="Payee *"
              value={payeeName}
              onChange={(e) => setPayeeName(e.target.value)}
              placeholder="Landlord, fuel station, …"
            />
            <Select
              label="Paid via *"
              options={PAYMENT_METHODS}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            />
            <Input
              label="Amount (excl. VAT) *"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              label="VAT amount"
              type="number"
              min="0"
              step="0.01"
              value={vatAmount}
              onChange={(e) => setVatAmount(e.target.value)}
            />
            <Input
              label="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt / M-Pesa code"
            />
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Receipt</label>
              <input
                type="file"
                accept="image/*,.pdf"
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="sm:col-span-2">
              <Textarea
                label="Description *"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="sm:col-span-2">
              <Textarea
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={submitOnCreate}
                onChange={(e) => setSubmitOnCreate(e.target.checked)}
              />
              Submit for approval immediately (recommended)
            </label>
            <p className="sm:col-span-2 text-xs text-slate-500">
              Total to post: {formatCurrency(Number(amount || 0) + Number(vatAmount || 0))}. Approval
              posts Dr Expense (+ VAT input) / Cr Cash or Bank.
            </p>
          </div>
        </ModalFormBody>
      </Modal>
    </div>
  );
});
