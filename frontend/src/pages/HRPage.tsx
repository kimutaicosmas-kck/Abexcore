import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Users, Calendar, DollarSign, UserCheck, ChevronRight, Clock, Download, FileText } from 'lucide-react';
import { hrApi } from '../services/api';
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
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { EmployeeForm } from '../components/forms/EmployeeForm';
import { AttendanceForm } from '../components/forms/AttendanceForm';
import { LeaveForm } from '../components/forms/LeaveForm';
import { PayrollForm } from '../components/forms/PayrollForm';
import { useAuth } from '../contexts/AuthContext';
import {
  Employee,
  HrStats,
  LeaveBalancesPayload,
  LeaveRequest,
  PayrollRecord,
  StaffOnLeaveRow,
} from '../types';
import { downloadFile } from '../utils/download';
import { getApiErrorMessage } from '../utils/apiError';

const tabs = ['Overview', 'Employees', 'Attendance', 'Leave', 'Payroll'];

const LEAVE_STATUS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

type HrModal = 'employee' | 'attendance' | 'leave' | 'payroll' | null;

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
  const [empSearch, setEmpSearch] = useState('');
  const [attSearch, setAttSearch] = useState('');
  const [leaveSearch, setLeaveSearch] = useState('');
  const [leaveStatus, setLeaveStatus] = useState('');
  const [paySearch, setPaySearch] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<
    | { type: 'leave'; id: string; status: string; label: string }
    | { type: 'payroll'; id: string }
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
  const { data: stats } = useQuery({
    queryKey: ['hr-stats'],
    queryFn: () => hrApi.stats().then((r) => r.data.data as HrStats),
  });

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['employees', empPage, empSearch],
    queryFn: () => hrApi.employees({ page: empPage, limit: 15, search: empSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 1,
  });

  const { data: attendance, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', attPage, attSearch],
    queryFn: () => hrApi.attendance({ page: attPage, limit: 15, search: attSearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 2,
  });

  const { data: leave, isLoading: leaveLoading } = useQuery({
    queryKey: ['leave', leavePage, leaveSearch, leaveStatus],
    queryFn: () =>
      hrApi.leave({ page: leavePage, limit: 15, search: leaveSearch || undefined, status: leaveStatus || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 3,
  });

  const { data: onLeaveToday } = useQuery({
    queryKey: ['leave-on-leave'],
    queryFn: () => hrApi.onLeave().then((r) => r.data.data as StaffOnLeaveRow[]),
    enabled: activeTab === 3,
  });

  const { data: balanceEmployees } = useQuery({
    queryKey: ['employees-for-leave-balances'],
    queryFn: () => hrApi.employees({ page: 1, limit: 100, isActive: true }).then((r) => r.data.data as Employee[]),
    enabled: activeTab === 3,
  });

  const { data: selectedBalances } = useQuery({
    queryKey: ['leave-balances', balanceEmployeeId, leaveYear],
    queryFn: () =>
      hrApi
        .leaveBalances({ employeeId: balanceEmployeeId, year: leaveYear })
        .then((r) => r.data.data as LeaveBalancesPayload),
    enabled: activeTab === 3 && !!balanceEmployeeId,
  });

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll', payPage, paySearch],
    queryFn: () => hrApi.payroll({ page: payPage, limit: 15, search: paySearch || undefined }).then((r) => r.data),
    enabled: activeTab === 0 || activeTab === 4,
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
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const tabActions: Record<number, { label: string; modal: HrModal }> = {
    1: { label: 'Add Employee', modal: 'employee' },
    2: { label: 'Record Attendance', modal: 'attendance' },
    3: { label: 'Request Leave', modal: 'leave' },
    4: { label: 'Create Payroll', modal: 'payroll' },
  };

  const recentEmployees = activeTab === 0 ? (employees?.data || []).slice(0, 6) : [];
  const pendingLeave = activeTab === 0
    ? ((leave?.data as LeaveRequest[]) || []).filter((l) => l.status === 'PENDING').slice(0, 5)
    : [];
  const recentAttendance = activeTab === 0 ? (attendance?.data || []).slice(0, 6) : [];

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
    { key: 'netPay', label: 'Net Pay', render: (v: unknown) => formatCurrency(v as number) },
    { key: 'isPaid', label: 'Status', render: (v: unknown) => <Badge variant={v ? 'success' : 'warning'}>{v ? 'Paid' : 'Unpaid'}</Badge> },
    { key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => {
      if (!canUpdate || row.isPaid) return null;
      return <Button size="sm" loading={payPayrollMutation.isPending} onClick={(e) => { e.stopPropagation(); setPendingConfirm({ type: 'payroll', id: row.id as string }); }}>Mark Paid</Button>;
    }},
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
      {stats && (
        <StatGrid>
          <StatCard title="Employees" value={stats.activeEmployees} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-primary-700" />
          <StatCard title="Pending Leave" value={stats.pendingLeave} icon={<Calendar className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Payroll Due" value={formatCurrency(stats.payrollDue)} icon={<DollarSign className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Present Today" value={stats.attendanceToday} icon={<UserCheck className="h-5 w-5 text-white" />} color="from-primary-600 to-primary-800" />
          <StatCard title="Total Headcount" value={stats.totalEmployees} icon={<Users className="h-5 w-5 text-white" />} color="from-slate-600 to-slate-800" />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.pendingLeave > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setLeaveStatus('PENDING'); setLeavePage(1); goToTab(3); }}>
              <Calendar className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.pendingLeave} pending leave
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => { setActiveTab(t); setEmpPage(1); setAttPage(1); setLeavePage(1); setPayPage(1); }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Pending leave requests"
              action={
                pendingLeave.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => { setLeaveStatus('PENDING'); goToTab(3); }}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {pendingLeave.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No pending leave" description="Leave requests awaiting approval appear here." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {pendingLeave.map((req) => (
                    <li key={req.id} className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/30">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">
                          {req.employee ? `${req.employee.firstName} ${req.employee.lastName}` : '—'}
                        </p>
                        <p className="text-xs text-slate-500">{req.type} · {formatDate(req.startDate)} – {formatDate(req.endDate)}</p>
                      </div>
                      <Badge variant="warning">Pending</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card
              title="Today's attendance"
              action={
                <Button variant="ghost" size="sm" onClick={() => goToTab(2)}>
                  Full log
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              }
              padding={false}
            >
              {recentAttendance.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No attendance records" description="Record check-ins to track daily presence." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {recentAttendance.map((record: { id: string; employee?: { firstName: string; lastName: string }; status: string; checkIn?: string }) => (
                    <li key={record.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100 text-primary-600">
                        <Clock className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800 truncate">
                          {record.employee ? `${record.employee.firstName} ${record.employee.lastName}` : '—'}
                        </p>
                        <p className="text-xs text-slate-400">
                          {record.checkIn ? new Date(record.checkIn).toLocaleTimeString() : 'No check-in'}
                        </p>
                      </div>
                      <Badge variant={record.status === 'present' ? 'success' : 'warning'}>{record.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 1 && (
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

      {activeTab === 2 && (
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

      {activeTab === 3 && (
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
                description="Create payroll runs for employee compensation."
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

      <Modal open={modal !== null} onClose={() => { setModal(null); setEditing(null); }} title={modal === 'employee' ? (editing ? 'Edit Employee' : 'Add Employee') : modal === 'attendance' ? 'Record Attendance' : modal === 'leave' ? 'Request Leave' : 'Create Payroll'} size="lg">
        {modal === 'employee' && <EmployeeForm employee={editing} onSuccess={() => { setModal(null); setEditing(null); }} onCancel={() => { setModal(null); setEditing(null); }} />}
        {modal === 'attendance' && <AttendanceForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'leave' && <LeaveForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'payroll' && <PayrollForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
      </Modal>

      <ConfirmDialog
        open={!!pendingConfirm}
        title={pendingConfirm?.type === 'payroll' ? 'Mark payroll as paid?' : `${pendingConfirm?.label} leave request?`}
        message={
          pendingConfirm?.type === 'payroll'
            ? 'This records the payroll as paid and cannot be undone easily.'
            : `This will ${pendingConfirm?.label?.toLowerCase()} the leave request. Continue?`
        }
        confirmLabel={pendingConfirm?.type === 'payroll' ? 'Mark Paid' : pendingConfirm?.label || 'Confirm'}
        variant={pendingConfirm?.type === 'leave' && pendingConfirm.status === 'REJECTED' ? 'danger' : 'primary'}
        loading={approveLeaveMutation.isPending || payPayrollMutation.isPending}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (!pendingConfirm) return;
          if (pendingConfirm.type === 'leave') {
            approveLeaveMutation.mutate(
              { id: pendingConfirm.id, status: pendingConfirm.status },
              { onSettled: () => setPendingConfirm(null) }
            );
          } else {
            payPayrollMutation.mutate(pendingConfirm.id, { onSettled: () => setPendingConfirm(null) });
          }
        }}
      />
    </div>
  );
}
