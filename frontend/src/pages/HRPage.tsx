import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Calendar, Download, FileText } from 'lucide-react';
import { hrApi } from '../services/api';
import {
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
  PageToolbar,
  ConfirmDialog,
  QueryErrorAlert,
  Alert,
  Textarea,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { EmployeeForm } from '../components/forms/EmployeeForm';
import { AttendanceForm } from '../components/forms/AttendanceForm';
import { LeaveForm } from '../components/forms/LeaveForm';
import { PayrollForm } from '../components/forms/PayrollForm';
import { SalaryAdvanceForm } from '../components/forms/SalaryAdvanceForm';
import { useAuth } from '../contexts/AuthContext';
import {
  Employee,
  LeaveBalancesPayload,
  LeaveRequest,
  PayrollRecord,
  SalaryAdvance,
  StaffOnLeaveRow,
} from '../types';
import { downloadFile } from '../utils/download';
import { getApiErrorMessage } from '../utils/apiError';

const tabs = ['Employees', 'Attendance', 'Leave', 'Advances', 'Payroll'];

const LEAVE_STATUS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

const ADVANCE_STATUS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'WRITTEN_OFF', label: 'Written off' },
];

type HrModal = 'employee' | 'attendance' | 'leave' | 'payroll' | 'advance' | 'repay' | null;

export function HRPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [modal, setModal] = useState<HrModal>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [empPage, setEmpPage] = useState(1);
  const [attPage, setAttPage] = useState(1);
  const [leavePage, setLeavePage] = useState(1);
  const [payPage, setPayPage] = useState(1);
  const [advPage, setAdvPage] = useState(1);
  const [empSearch, setEmpSearch] = useState('');
  const [attSearch, setAttSearch] = useState('');
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveStatus, setLeaveStatus] = useState('');
  const [paySearch, setPaySearch] = useState('');
  const [advSearch, setAdvSearch] = useState('');
  const [advStatus, setAdvStatus] = useState('');
  const [selectedAdvanceId, setSelectedAdvanceId] = useState<string | null>(null);
  const [repayForm, setRepayForm] = useState({ amount: '', method: 'CASH', notes: '' });
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'leave'; id: string; status: string; label: string }
    | { type: 'payroll'; id: string }
    | { type: 'advance-approve'; id: string }
    | { type: 'advance-reject'; id: string }
    | { type: 'advance-disburse'; id: string }
    | { type: 'advance-cancel'; id: string }
    | { type: 'advance-writeoff'; id: string }
    | null
  >(null);
  const [balanceEmployeeId, setBalanceEmployeeId] = useState('');
  const [balanceEdit, setBalanceEdit] = useState<{
    type: string;
    entitledDays: string;
    usedDays: string;
    notes: string;
  } | null>(null);
  const [exportError, setExportError] = useState('');
  const leaveYear = new Date().getFullYear();

  const canCreate = hasPermission('hr:create');
  const canUpdate = hasPermission('hr:update');

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['employees', empPage, empSearch],
    queryFn: () => hrApi.employees({ page: empPage, limit: 15, search: empSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: attendance, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', attPage, attSearch],
    queryFn: () => hrApi.attendance({ page: attPage, limit: 15, search: attSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: leave, isLoading: leaveLoading } = useQuery({
    queryKey: ['leave', leavePage, leaveSearch, leaveStatus],
    queryFn: () =>
      hrApi.leave({ page: leavePage, limit: 15, search: leaveSearch || undefined, status: leaveStatus || undefined }).then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: onLeaveToday } = useQuery({
    queryKey: ['leave-on-leave'],
    queryFn: () => hrApi.onLeave().then((r) => r.data.data as StaffOnLeaveRow[]),
    enabled: activeTab === 2,
  });

  const { data: balanceEmployees } = useQuery({
    queryKey: ['employees-for-leave-balances'],
    queryFn: () => hrApi.employees({ page: 1, limit: 100, isActive: true }).then((r) => r.data.data as Employee[]),
    enabled: activeTab === 2,
  });

  const { data: selectedBalances } = useQuery({
    queryKey: ['leave-balances', balanceEmployeeId, leaveYear],
    queryFn: () =>
      hrApi
        .leaveBalances({ employeeId: balanceEmployeeId, year: leaveYear })
        .then((r) => r.data.data as LeaveBalancesPayload),
    enabled: activeTab === 2 && !!balanceEmployeeId,
  });

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll', payPage, paySearch],
    queryFn: () => hrApi.payroll({ page: payPage, limit: 15, search: paySearch || undefined }).then((r) => r.data),
    enabled: activeTab === 4,
  });

  const { data: advances, isLoading: advancesLoading } = useQuery({
    queryKey: ['salary-advances', advPage, advSearch, advStatus],
    queryFn: () =>
      hrApi
        .advances({
          page: advPage,
          limit: 15,
          search: advSearch || undefined,
          status: advStatus || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 3,
  });

  const { data: advanceDetail, isLoading: advanceDetailLoading } = useQuery({
    queryKey: ['salary-advance', selectedAdvanceId],
    queryFn: () => hrApi.getAdvance(selectedAdvanceId!).then((r) => r.data.data as SalaryAdvance),
    enabled: !!selectedAdvanceId,
  });

  const approveLeaveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => hrApi.approveLeave(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: ['leave-on-leave'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
    },
  });

  const updateBalanceMutation = useMutation({
    mutationFn: () =>
      hrApi.updateLeaveBalance({
        employeeId: balanceEmployeeId,
        type: balanceEdit!.type,
        year: leaveYear,
        entitledDays: Number(balanceEdit!.entitledDays),
        usedDays: Number(balanceEdit!.usedDays),
        notes: balanceEdit!.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['my-leave-balances'] });
      setBalanceEdit(null);
    },
  });

  const payPayrollMutation = useMutation({
    mutationFn: (id: string) => hrApi.payPayroll(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
      queryClient.invalidateQueries({ queryKey: ['salary-advance-stats'] });
    },
  });

  const invalidateAdvances = () => {
    queryClient.invalidateQueries({ queryKey: ['salary-advances'] });
    queryClient.invalidateQueries({ queryKey: ['salary-advance-stats'] });
    queryClient.invalidateQueries({ queryKey: ['salary-advance'] });
    queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
  };

  const approveAdvanceMutation = useMutation({
    mutationFn: (id: string) => hrApi.approveAdvance(id, { disburseNow: true }),
    onSuccess: invalidateAdvances,
  });
  const rejectAdvanceMutation = useMutation({
    mutationFn: (id: string) => hrApi.rejectAdvance(id, { reason: 'Rejected by HR' }),
    onSuccess: invalidateAdvances,
  });
  const disburseAdvanceMutation = useMutation({
    mutationFn: (id: string) => hrApi.disburseAdvance(id),
    onSuccess: invalidateAdvances,
  });
  const cancelAdvanceMutation = useMutation({
    mutationFn: (id: string) => hrApi.cancelAdvance(id, { reason: 'Cancelled by HR' }),
    onSuccess: invalidateAdvances,
  });
  const writeOffAdvanceMutation = useMutation({
    mutationFn: (id: string) => hrApi.writeOffAdvance(id, { reason: 'Written off by HR' }),
    onSuccess: invalidateAdvances,
  });
  const repayAdvanceMutation = useMutation({
    mutationFn: () =>
      hrApi.repayAdvance(selectedAdvanceId!, {
        amount: Number(repayForm.amount),
        method: repayForm.method,
        notes: repayForm.notes || undefined,
      }),
    onSuccess: () => {
      invalidateAdvances();
      setModal(null);
      setRepayForm({ amount: '', method: 'CASH', notes: '' });
    },
  });

  const tabActions: Record<number, { label: string; modal: HrModal }> = {
    0: { label: 'Add Employee', modal: 'employee' },
    1: { label: 'Record Attendance', modal: 'attendance' },
    2: { label: 'Request Leave', modal: 'leave' },
    3: { label: 'Add Advance', modal: 'advance' },
    4: { label: 'Create Payroll', modal: 'payroll' },
  };

  const advanceBusy =
    approveAdvanceMutation.isPending ||
    rejectAdvanceMutation.isPending ||
    disburseAdvanceMutation.isPending ||
    cancelAdvanceMutation.isPending ||
    writeOffAdvanceMutation.isPending;

  const employeeColumns = [
    { key: 'employeeNo', label: 'Employee #' },
    { key: 'name', label: 'Name', render: (_: unknown, row: Record<string, unknown>) => `${row.firstName} ${row.lastName}` },
    { key: 'position', label: 'Position' },
    { key: 'department', label: 'Department', render: (_: unknown, row: Record<string, unknown>) => (row.department as { name: string })?.name || '-' },
    {
      key: 'user',
      label: 'Login',
      render: (_: unknown, row: Record<string, unknown>) => {
        const emp = row as unknown as Employee;
        if (emp.user) {
          return <Badge variant="success">{emp.user.email}</Badge>;
        }
        return <Badge variant="warning">Not linked</Badge>;
      },
    },
    { key: 'salary', label: 'Salary', render: (val: unknown) => formatCurrency(val as number) },
    { key: 'isActive', label: 'Status', render: (val: unknown) => <Badge variant={val ? 'success' : 'danger'}>{val ? 'Active' : 'Inactive'}</Badge> },
    {
      key: 'actions', label: '',
      render: (_: unknown, row: Record<string, unknown>) => canUpdate ? (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditing(row as unknown as Employee); setModal('employee'); }}>
          <Pencil className="h-4 w-4" />
        </Button>
      ) : null,
    },
  ];

  const attendanceColumns = [
    { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string; employeeNo: string }; return e ? `${e.firstName} ${e.lastName} (${e.employeeNo})` : '-'; } },
    { key: 'date', label: 'Date', render: (v: unknown) => formatDate(v as string) },
    { key: 'checkIn', label: 'Check In', render: (v: unknown) => (v ? new Date(v as string).toLocaleTimeString() : '-') },
    { key: 'checkOut', label: 'Check Out', render: (v: unknown) => (v ? new Date(v as string).toLocaleTimeString() : '-') },
    { key: 'status', label: 'Status', render: (v: unknown) => <Badge variant={v === 'present' ? 'success' : 'warning'}>{v as string}</Badge> },
  ];

  const leaveColumns = [
    { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string }; return e ? `${e.firstName} ${e.lastName}` : '-'; } },
    { key: 'type', label: 'Type' },
    { key: 'startDate', label: 'Start', render: (v: unknown) => formatDate(v as string) },
    { key: 'endDate', label: 'End', render: (v: unknown) => formatDate(v as string) },
    { key: 'status', label: 'Status', render: (v: unknown) => <Badge variant={getStatusBadge(v as string)}>{(v as string).replace(/_/g, ' ')}</Badge> },
    { key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => {
      if (!canUpdate || row.status !== 'PENDING') return null;
      return (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" loading={approveLeaveMutation.isPending} onClick={() => setPendingConfirm({ type: 'leave', id: row.id as string, status: 'APPROVED', label: 'Approve' })}>Approve</Button>
          <Button size="sm" variant="secondary" loading={approveLeaveMutation.isPending} onClick={() => setPendingConfirm({ type: 'leave', id: row.id as string, status: 'REJECTED', label: 'Reject' })}>Reject</Button>
        </div>
      );
    }},
  ];

  const payrollColumns = [
    { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string; employeeNo: string }; return e ? `${e.firstName} ${e.lastName} (${e.employeeNo})` : '-'; } },
    { key: 'periodStart', label: 'Period Start', render: (v: unknown) => formatDate(v as string) },
    { key: 'periodEnd', label: 'Period End', render: (v: unknown) => formatDate(v as string) },
    {
      key: 'advanceDeduction',
      label: 'Advance',
      render: (v: unknown) => (Number(v || 0) > 0 ? formatCurrency(Number(v)) : '—'),
    },
    { key: 'netPay', label: 'Net Pay', render: (v: unknown) => formatCurrency(v as number) },
    { key: 'isPaid', label: 'Status', render: (v: unknown) => <Badge variant={v ? 'success' : 'warning'}>{v ? 'Paid' : 'Unpaid'}</Badge> },
    { key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => {
      if (!canUpdate || row.isPaid) return null;
      return <Button size="sm" loading={payPayrollMutation.isPending} onClick={(e) => { e.stopPropagation(); setPendingConfirm({ type: 'payroll', id: row.id as string }); }}>Mark Paid</Button>;
    }},
  ];

  const advanceStatusVariant = (status: string) => {
    if (status === 'ACTIVE') return 'success';
    if (status === 'PENDING') return 'warning';
    if (status === 'COMPLETED') return 'info';
    if (status === 'WRITTEN_OFF' || status === 'CANCELLED') return 'danger';
    return getStatusBadge(status);
  };

  const advanceColumns = [
    { key: 'advanceNo', label: 'Advance #' },
    {
      key: 'employee',
      label: 'Employee',
      render: (_: unknown, row: Record<string, unknown>) => {
        const e = row.employee as SalaryAdvance['employee'];
        return e ? `${e.firstName} ${e.lastName} (${e.employeeNo})` : '—';
      },
    },
    { key: 'amount', label: 'Amount', render: (v: unknown) => formatCurrency(v as number) },
    { key: 'monthlyDeduction', label: 'Monthly', render: (v: unknown) => formatCurrency(v as number) },
    { key: 'remainingBalance', label: 'Balance', render: (v: unknown) => formatCurrency(v as number) },
    {
      key: 'status',
      label: 'Status',
      render: (v: unknown) => (
        <Badge variant={advanceStatusVariant(v as string)}>{(v as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'disbursedAt',
      label: 'Disbursed',
      render: (v: unknown) => (v ? formatDate(v as string) : <Badge variant="warning">Not yet</Badge>),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedAdvanceId(row.id as string);
          }}
        >
          View
        </Button>
      ),
    },
  ];

  const openEmployeeEdit = (employee: Employee) => {
    if (canUpdate) {
      setEditing(employee);
      setModal('employee');
    }
  };

  const toolbarActions =
    canCreate && tabActions[activeTab] ? (
      <Button size="sm" onClick={() => { setEditing(null); setModal(tabActions[activeTab].modal); }}>
        <Plus className="h-4 w-4 mr-1.5" />
        {tabActions[activeTab].label}
      </Button>
    ) : undefined;

  return (
    <div className="space-y-4">
      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => { setActiveTab(t); setEmpPage(1); setAttPage(1); setLeavePage(1); setAdvPage(1); setPayPage(1); }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <DataPanel>
          <div className="p-4 pb-0">
            <Input
              placeholder="Search employees…"
              className="sm:max-w-md"
              value={empSearch}
              onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(1); }}
            />
          </div>
          {(employees?.data?.length || 0) === 0 && !empLoading ? (
            <div className="p-6">
              <EmptyState
                title="No employees found"
                description="Add employees to manage HR records."
                action={
                  canCreate ? (
                    <Button onClick={() => { setEditing(null); setModal('employee'); }}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Employee
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={employeeColumns}
              data={employees?.data || []}
              loading={empLoading}
              onRowClick={(row) => openEmployeeEdit(row as unknown as Employee)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={employees?.pagination} page={empPage} onPageChange={setEmpPage} label="employees" />
          </div>
        </DataPanel>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0">
            <Input
              placeholder="Search attendance…"
              className="sm:max-w-md"
              value={attSearch}
              onChange={(e) => { setAttSearch(e.target.value); setAttPage(1); }}
            />
          </div>
          {(attendance?.data?.length || 0) === 0 && !attLoading ? (
            <div className="p-6">
              <EmptyState
                title="No attendance records"
                description="Record check-ins and check-outs for employees."
                action={
                  canCreate ? (
                    <Button onClick={() => setModal('attendance')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Record Attendance
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={attendanceColumns} data={attendance?.data || []} loading={attLoading} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={attendance?.pagination} page={attPage} onPageChange={setAttPage} label="records" />
          </div>
        </DataPanel>
      )}

      {activeTab === 2 && (
        <div className="space-y-4">
          <Card title={`Staff on leave today (${onLeaveToday?.length || 0})`} padding={false}>
            {!onLeaveToday?.length ? (
              <div className="p-6">
                <EmptyState title="No one on leave today" description="Approved leave covering today appears here." />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {onLeaveToday.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{row.employee.name}</p>
                      <p className="text-xs text-slate-500">
                        {row.type.replace(/_/g, ' ')} · {formatDate(row.startDate)} – {formatDate(row.endDate)}
                        {row.employee.department ? ` · ${row.employee.department}` : ''}
                      </p>
                    </div>
                    <Badge variant="success">{row.days}d</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Amend leave balances (${leaveYear})`}>
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Defaults: Annual 21, Sick 7, Compassionate 5, Paternity 14 (male), Maternity 90 (female). Balances reset each January.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Select
                  label="Employee"
                  options={[
                    { value: '', label: 'Select employee…' },
                    ...(balanceEmployees || []).map((e) => ({
                      value: e.id,
                      label: `${e.firstName} ${e.lastName} (${e.employeeNo})`,
                    })),
                  ]}
                  value={balanceEmployeeId}
                  onChange={(e) => setBalanceEmployeeId(e.target.value)}
                />
                <div className="flex flex-wrap items-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        setExportError('');
                        await downloadFile(hrApi.leaveReportExcelPath(leaveYear), `leave-balances-${leaveYear}.xlsx`);
                      } catch (err) {
                        setExportError(getApiErrorMessage(err));
                      }
                    }}
                  >
                    <Download className="h-4 w-4 mr-1.5" />
                    Excel
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        setExportError('');
                        await downloadFile(hrApi.leaveReportPdfPath(leaveYear), `leave-balances-${leaveYear}.pdf`);
                      } catch (err) {
                        setExportError(getApiErrorMessage(err));
                      }
                    }}
                  >
                    <FileText className="h-4 w-4 mr-1.5" />
                    PDF
                  </Button>
                </div>
              </div>
              {exportError && <Alert variant="error">{exportError}</Alert>}
              {updateBalanceMutation.isError && (
                <Alert variant="error">{getApiErrorMessage(updateBalanceMutation.error)}</Alert>
              )}
              {selectedBalances && (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Entitled</th>
                        <th className="px-3 py-2">Used</th>
                        <th className="px-3 py-2">Remaining</th>
                        {canUpdate && <th className="px-3 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedBalances.balances.map((b) => (
                        <tr key={b.id}>
                          <td className="px-3 py-2 font-medium">{b.type.replace(/_/g, ' ')}</td>
                          <td className="px-3 py-2 tabular-nums">{b.entitledDays}</td>
                          <td className="px-3 py-2 tabular-nums">{b.usedDays}</td>
                          <td className="px-3 py-2 tabular-nums font-semibold">{b.remainingDays}</td>
                          {canUpdate && (
                            <td className="px-3 py-2 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setBalanceEdit({
                                    type: b.type,
                                    entitledDays: String(b.entitledDays),
                                    usedDays: String(b.usedDays),
                                    notes: b.notes || '',
                                  })
                                }
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          <DataPanel>
            <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Search leave…"
                className="sm:max-w-md"
                value={leaveSearch}
                onChange={(e) => { setLeaveSearch(e.target.value); setLeavePage(1); }}
              />
              <Select
                options={LEAVE_STATUS}
                value={leaveStatus}
                onChange={(e) => { setLeaveStatus(e.target.value); setLeavePage(1); }}
                className="sm:w-40"
              />
            </div>
            {(leave?.data?.length || 0) === 0 && !leaveLoading ? (
              <div className="p-6">
                <EmptyState
                  title="No leave requests found"
                  description="Employees can submit leave requests for approval."
                  action={
                    canCreate ? (
                      <Button onClick={() => setModal('leave')}>
                        <Plus className="h-4 w-4 mr-2" />
                        Request Leave
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table columns={leaveColumns} data={(leave?.data as LeaveRequest[]) || []} loading={leaveLoading} embedded />
            )}
            <div className="px-4 pb-4">
              <TablePagination pagination={leave?.pagination} page={leavePage} onPageChange={setLeavePage} label="requests" />
            </div>
          </DataPanel>

          <Modal
            open={!!balanceEdit}
            onClose={() => setBalanceEdit(null)}
            title={`Edit ${balanceEdit?.type.replace(/_/g, ' ') || 'leave'} balance`}
            size="md"
          >
            {balanceEdit && (
              <div className="space-y-4">
                <Input
                  label="Entitled days"
                  type="number"
                  min={0}
                  value={balanceEdit.entitledDays}
                  onChange={(e) => setBalanceEdit({ ...balanceEdit, entitledDays: e.target.value })}
                />
                <Input
                  label="Used days"
                  type="number"
                  min={0}
                  value={balanceEdit.usedDays}
                  onChange={(e) => setBalanceEdit({ ...balanceEdit, usedDays: e.target.value })}
                />
                <Input
                  label="Notes"
                  value={balanceEdit.notes}
                  onChange={(e) => setBalanceEdit({ ...balanceEdit, notes: e.target.value })}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setBalanceEdit(null)}>Cancel</Button>
                  <Button loading={updateBalanceMutation.isPending} onClick={() => updateBalanceMutation.mutate()}>
                    Save balance
                  </Button>
                </div>
              </div>
            )}
          </Modal>
        </div>
      )}

      {activeTab === 3 && (
        <div className="space-y-4">
          <DataPanel>
            <div className="p-4 pb-0 flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="Search advances…"
                className="sm:max-w-md"
                value={advSearch}
                onChange={(e) => { setAdvSearch(e.target.value); setAdvPage(1); }}
              />
              <Select
                options={ADVANCE_STATUS}
                value={advStatus}
                onChange={(e) => { setAdvStatus(e.target.value); setAdvPage(1); }}
                className="sm:w-44"
              />
            </div>
            {(advances?.data?.length || 0) === 0 && !advancesLoading ? (
              <div className="p-6">
                <EmptyState
                  title="No salary advances"
                  description="Issue an advance, set a monthly deduction, and recover it from payroll."
                  action={
                    canCreate ? (
                      <Button onClick={() => setModal('advance')}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Advance
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <Table
                columns={advanceColumns}
                data={(advances?.data as SalaryAdvance[]) || []}
                loading={advancesLoading}
                onRowClick={(row) => setSelectedAdvanceId((row as unknown as SalaryAdvance).id)}
                embedded
              />
            )}
            <div className="px-4 pb-4">
              <TablePagination pagination={advances?.pagination} page={advPage} onPageChange={setAdvPage} label="advances" />
            </div>
          </DataPanel>
        </div>
      )}

      {activeTab === 4 && (
        <DataPanel>
          <div className="p-4 pb-0">
            <Input
              placeholder="Search payroll…"
              className="sm:max-w-md"
              value={paySearch}
              onChange={(e) => { setPaySearch(e.target.value); setPayPage(1); }}
            />
          </div>
          {(payroll?.data?.length || 0) === 0 && !payrollLoading ? (
            <div className="p-6">
              <EmptyState
                title="No payroll records"
                description="Create payroll runs for employee compensation. Active advances are deducted automatically."
                action={
                  canCreate ? (
                    <Button onClick={() => setModal('payroll')}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Payroll
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table columns={payrollColumns} data={(payroll?.data as PayrollRecord[]) || []} loading={payrollLoading} embedded />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={payroll?.pagination} page={payPage} onPageChange={setPayPage} label="records" />
          </div>
        </DataPanel>
      )}

      <Modal
        open={modal !== null && modal !== 'repay'}
        onClose={() => { setModal(null); setEditing(null); }}
        title={
          modal === 'employee'
            ? editing ? 'Edit Employee' : 'Add Employee'
            : modal === 'attendance'
              ? 'Record Attendance'
              : modal === 'leave'
                ? 'Request Leave'
                : modal === 'advance'
                  ? 'Salary Advance'
                  : 'Create Payroll'
        }
        size="lg"
      >
        {modal === 'employee' && <EmployeeForm employee={editing} onSuccess={() => { setModal(null); setEditing(null); }} onCancel={() => { setModal(null); setEditing(null); }} />}
        {modal === 'attendance' && <AttendanceForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'leave' && <LeaveForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'advance' && <SalaryAdvanceForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'payroll' && <PayrollForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
      </Modal>

      <Modal
        open={!!selectedAdvanceId}
        onClose={() => setSelectedAdvanceId(null)}
        title={advanceDetail ? `Advance ${advanceDetail.advanceNo}` : 'Salary advance'}
        size="lg"
      >
        {advanceDetailLoading || !advanceDetail ? (
          <p className="text-sm text-slate-500 py-8 text-center">Loading advance details…</p>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  {advanceDetail.employee.firstName} {advanceDetail.employee.lastName}
                </p>
                <p className="text-sm text-slate-500">{advanceDetail.employee.employeeNo}</p>
              </div>
              <Badge variant={advanceStatusVariant(advanceDetail.status)}>
                {advanceDetail.status.replace(/_/g, ' ')}
              </Badge>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Amount</p>
                <p className="font-semibold">{formatCurrency(advanceDetail.amount)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Monthly</p>
                <p className="font-semibold">{formatCurrency(advanceDetail.monthlyDeduction)}</p>
              </div>
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-xs text-emerald-700">Balance</p>
                <p className="font-semibold text-emerald-800">{formatCurrency(advanceDetail.remainingBalance)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Repaid</p>
                <p className="font-semibold">{formatCurrency(advanceDetail.totalRepaid)}</p>
              </div>
            </div>

            <div className="text-sm text-slate-600 space-y-1">
              <p><span className="text-slate-400">Deduction start:</span> {formatDate(advanceDetail.deductionStartDate)}</p>
              <p><span className="text-slate-400">Disbursed:</span> {advanceDetail.disbursedAt ? formatDate(advanceDetail.disbursedAt) : 'Not disbursed'}</p>
              {advanceDetail.reason && <p><span className="text-slate-400">Reason:</span> {advanceDetail.reason}</p>}
            </div>

            {canUpdate && (
              <div className="flex flex-wrap gap-2">
                {advanceDetail.status === 'PENDING' && (
                  <>
                    <Button size="sm" loading={advanceBusy} onClick={() => setPendingConfirm({ type: 'advance-approve', id: advanceDetail.id })}>
                      Approve & disburse
                    </Button>
                    <Button size="sm" variant="secondary" loading={advanceBusy} onClick={() => setPendingConfirm({ type: 'advance-reject', id: advanceDetail.id })}>
                      Reject
                    </Button>
                  </>
                )}
                {advanceDetail.status === 'ACTIVE' && !advanceDetail.disbursedAt && (
                  <Button size="sm" loading={advanceBusy} onClick={() => setPendingConfirm({ type: 'advance-disburse', id: advanceDetail.id })}>
                    Disburse
                  </Button>
                )}
                {advanceDetail.status === 'ACTIVE' && advanceDetail.disbursedAt && advanceDetail.remainingBalance > 0 && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        setRepayForm({
                          amount: String(advanceDetail.remainingBalance),
                          method: 'CASH',
                          notes: '',
                        });
                        setModal('repay');
                      }}
                    >
                      Record repayment
                    </Button>
                    <Button size="sm" variant="secondary" loading={advanceBusy} onClick={() => setPendingConfirm({ type: 'advance-writeoff', id: advanceDetail.id })}>
                      Write off
                    </Button>
                  </>
                )}
                {(advanceDetail.status === 'PENDING' || advanceDetail.status === 'ACTIVE') && (
                  <Button size="sm" variant="danger" loading={advanceBusy} onClick={() => setPendingConfirm({ type: 'advance-cancel', id: advanceDetail.id })}>
                    Cancel
                  </Button>
                )}
              </div>
            )}

            {!!advanceDetail.schedule?.length && advanceDetail.remainingBalance > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-800 mb-2">Projected recovery schedule</h4>
                <div className="max-h-40 overflow-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Month</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {advanceDetail.schedule.map((row) => (
                        <tr key={row.dueDate} className="border-t border-slate-100">
                          <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-slate-800 mb-2">Repayment history</h4>
              {!advanceDetail.repayments?.length ? (
                <p className="text-sm text-slate-500">No repayments yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {advanceDetail.repayments.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-800">{formatCurrency(r.amount)}</p>
                        <p className="text-xs text-slate-500">
                          {r.method.replace(/_/g, ' ')}
                          {r.paidAt ? ` · ${formatDate(r.paidAt)}` : ''}
                          {!r.isApplied ? ' · Scheduled' : ''}
                        </p>
                      </div>
                      <Badge variant={r.isApplied ? 'success' : 'warning'}>
                        {r.isApplied ? 'Applied' : 'Scheduled'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={modal === 'repay'} onClose={() => setModal(null)} title="Record advance repayment" size="md">
        <div className="space-y-4">
          {repayAdvanceMutation.isError && (
            <Alert variant="error">{getApiErrorMessage(repayAdvanceMutation.error)}</Alert>
          )}
          <Input
            label="Amount (KES) *"
            type="number"
            step="0.01"
            value={repayForm.amount}
            onChange={(e) => setRepayForm({ ...repayForm, amount: e.target.value })}
          />
          <Select
            label="Method"
            options={[
              { value: 'CASH', label: 'Cash' },
              { value: 'BANK_TRANSFER', label: 'Bank transfer' },
              { value: 'MPESA', label: 'M-Pesa' },
              { value: 'MANUAL', label: 'Manual / other' },
            ]}
            value={repayForm.method}
            onChange={(e) => setRepayForm({ ...repayForm, method: e.target.value })}
          />
          <Textarea
            label="Notes"
            rows={2}
            value={repayForm.notes}
            onChange={(e) => setRepayForm({ ...repayForm, notes: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            <Button
              loading={repayAdvanceMutation.isPending}
              disabled={!Number(repayForm.amount)}
              onClick={() => repayAdvanceMutation.mutate()}
            >
              Record repayment
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={
          pendingConfirm?.type === 'payroll'
            ? 'Mark payroll as paid?'
            : pendingConfirm?.type === 'leave'
              ? `${pendingConfirm.label} leave request?`
              : pendingConfirm?.type === 'advance-approve'
                ? 'Approve and disburse advance?'
                : pendingConfirm?.type === 'advance-reject'
                  ? 'Reject this advance?'
                  : pendingConfirm?.type === 'advance-disburse'
                    ? 'Disburse this advance?'
                    : pendingConfirm?.type === 'advance-writeoff'
                      ? 'Write off remaining balance?'
                      : pendingConfirm?.type === 'advance-cancel'
                        ? 'Cancel this advance?'
                        : 'Confirm'
        }
        message={
          pendingConfirm?.type === 'payroll'
            ? 'This posts the payroll journal and applies any scheduled salary advance recoveries.'
            : pendingConfirm?.type === 'leave'
              ? `This will ${pendingConfirm.label.toLowerCase()} the leave request. Continue?`
              : pendingConfirm?.type === 'advance-approve'
                ? 'The advance will become active and cash will be posted to the staff advances ledger.'
                : pendingConfirm?.type === 'advance-reject'
                  ? 'The advance request will be cancelled.'
                  : pendingConfirm?.type === 'advance-disburse'
                    ? 'Cash will leave the bank/cash account and a staff advance receivable will be created.'
                    : pendingConfirm?.type === 'advance-writeoff'
                      ? 'The remaining balance will be expensed and the receivable cleared. This cannot be undone.'
                      : pendingConfirm?.type === 'advance-cancel'
                        ? 'Pending advances are cancelled. Undisbursed or fully unpaid disbursed advances are reversed in the ledger.'
                        : 'Continue?'
        }
        confirmLabel={
          pendingConfirm?.type === 'payroll'
            ? 'Mark Paid'
            : pendingConfirm?.type === 'leave'
              ? pendingConfirm.label
              : pendingConfirm?.type === 'advance-approve'
                ? 'Approve & disburse'
                : pendingConfirm?.type === 'advance-reject'
                  ? 'Reject'
                  : pendingConfirm?.type === 'advance-disburse'
                    ? 'Disburse'
                    : pendingConfirm?.type === 'advance-writeoff'
                      ? 'Write off'
                      : pendingConfirm?.type === 'advance-cancel'
                        ? 'Cancel advance'
                        : 'Confirm'
        }
        variant={
          pendingConfirm?.type === 'leave' && pendingConfirm.status === 'REJECTED'
            ? 'danger'
            : pendingConfirm?.type === 'advance-reject' ||
                pendingConfirm?.type === 'advance-writeoff' ||
                pendingConfirm?.type === 'advance-cancel'
              ? 'danger'
              : 'primary'
        }
        loading={
          approveLeaveMutation.isPending ||
          payPayrollMutation.isPending ||
          advanceBusy
        }
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (!pendingConfirm) return;
          const done = { onSettled: () => setPendingConfirm(null) };
          if (pendingConfirm.type === 'leave') {
            approveLeaveMutation.mutate({ id: pendingConfirm.id, status: pendingConfirm.status }, done);
          } else if (pendingConfirm.type === 'payroll') {
            payPayrollMutation.mutate(pendingConfirm.id, done);
          } else if (pendingConfirm.type === 'advance-approve') {
            approveAdvanceMutation.mutate(pendingConfirm.id, done);
          } else if (pendingConfirm.type === 'advance-reject') {
            rejectAdvanceMutation.mutate(pendingConfirm.id, done);
          } else if (pendingConfirm.type === 'advance-disburse') {
            disburseAdvanceMutation.mutate(pendingConfirm.id, done);
          } else if (pendingConfirm.type === 'advance-cancel') {
            cancelAdvanceMutation.mutate(pendingConfirm.id, done);
          } else if (pendingConfirm.type === 'advance-writeoff') {
            writeOffAdvanceMutation.mutate(pendingConfirm.id, done);
          }
        }}
      />
    </div>
  );
}
