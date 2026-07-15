import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Users, Calendar, DollarSign, UserCheck } from 'lucide-react';
import { hrApi } from '../services/api';
import {
  PageHeader, Table, Badge, Button, Input, Select, StatCard,
  formatCurrency, formatDate, getStatusBadge, PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { EmployeeForm } from '../components/forms/EmployeeForm';
import { AttendanceForm } from '../components/forms/AttendanceForm';
import { LeaveForm } from '../components/forms/LeaveForm';
import { PayrollForm } from '../components/forms/PayrollForm';
import { useAuth } from '../contexts/AuthContext';
import { Employee, HrStats, LeaveRequest, PayrollRecord } from '../types';

const tabs = ['Employees', 'Attendance', 'Leave', 'Payroll'];
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

  const canCreate = hasPermission('hr:create');
  const canUpdate = hasPermission('hr:update');

  const { data: stats } = useQuery({
    queryKey: ['hr-stats'],
    queryFn: () => hrApi.stats().then((r) => r.data.data as HrStats),
  });

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

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll', payPage, paySearch],
    queryFn: () => hrApi.payroll({ page: payPage, limit: 15, search: paySearch || undefined }).then((r) => r.data),
    enabled: activeTab === 3,
  });

  const approveLeaveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => hrApi.approveLeave(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
    },
  });

  const payPayrollMutation = useMutation({
    mutationFn: (id: string) => hrApi.payPayroll(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
    },
  });

  const tabActions: Record<number, { label: string; modal: HrModal }> = {
    0: { label: 'Add Employee', modal: 'employee' },
    1: { label: 'Record Attendance', modal: 'attendance' },
    2: { label: 'Request Leave', modal: 'leave' },
    3: { label: 'Create Payroll', modal: 'payroll' },
  };

  const renderPagination = (pagination: { page: number; totalPages: number } | undefined, page: number, setPage: (fn: (p: number) => number) => void) =>
    pagination && pagination.totalPages > 1 ? (
      <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
        <span>Page {pagination.page} of {pagination.totalPages}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    ) : null;

  const employeeColumns = [
    { key: 'employeeNo', label: 'Employee #' },
    { key: 'name', label: 'Name', render: (_: unknown, row: Record<string, unknown>) => `${row.firstName} ${row.lastName}` },
    { key: 'position', label: 'Position' },
    { key: 'department', label: 'Department', render: (_: unknown, row: Record<string, unknown>) => (row.department as { name: string })?.name || '-' },
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

  return (
    <div>
      <PageHeader subtitle="Employees, attendance, leave, and payroll" />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Employees" value={stats.activeEmployees} icon={<Users className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Pending Leave" value={stats.pendingLeave} icon={<Calendar className="h-5 w-5 text-white" />} color="from-amber-500 to-orange-600" />
          <StatCard title="Payroll Due" value={formatCurrency(stats.payrollDue)} icon={<DollarSign className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="Present Today" value={stats.attendanceToday} icon={<UserCheck className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
        </div>
      )}

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => { setActiveTab(t); setEmpPage(1); setAttPage(1); setLeavePage(1); setPayPage(1); }}
        actions={canCreate && tabActions[activeTab] ? (
          <Button onClick={() => { setEditing(null); setModal(tabActions[activeTab].modal); }}>
            <Plus className="h-4 w-4 mr-2" />{tabActions[activeTab].label}
          </Button>
        ) : undefined}
      />

      {activeTab === 0 && (
        <>
          <div className="mb-4 max-w-sm"><Input placeholder="Search employees…" value={empSearch} onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(1); }} /></div>
          <Table columns={employeeColumns} data={employees?.data || []} loading={empLoading} onRowClick={(row) => { if (canUpdate) { setEditing(row as unknown as Employee); setModal('employee'); } }} />
          {renderPagination(employees?.pagination, empPage, setEmpPage)}
        </>
      )}

      {activeTab === 1 && (
        <>
          <div className="mb-4 max-w-sm"><Input placeholder="Search attendance…" value={attSearch} onChange={(e) => { setAttSearch(e.target.value); setAttPage(1); }} /></div>
          <Table columns={[
            { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string; employeeNo: string }; return e ? `${e.firstName} ${e.lastName} (${e.employeeNo})` : '-'; } },
            { key: 'date', label: 'Date', render: (v: unknown) => formatDate(v as string) },
            { key: 'checkIn', label: 'Check In', render: (v: unknown) => (v ? new Date(v as string).toLocaleTimeString() : '-') },
            { key: 'checkOut', label: 'Check Out', render: (v: unknown) => (v ? new Date(v as string).toLocaleTimeString() : '-') },
            { key: 'status', label: 'Status', render: (v: unknown) => <Badge variant={v === 'present' ? 'success' : 'warning'}>{v as string}</Badge> },
          ]} data={attendance?.data || []} loading={attLoading} />
          {renderPagination(attendance?.pagination, attPage, setAttPage)}
        </>
      )}

      {activeTab === 2 && (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <Input placeholder="Search leave…" className="max-w-sm" value={leaveSearch} onChange={(e) => { setLeaveSearch(e.target.value); setLeavePage(1); }} />
            <Select options={LEAVE_STATUS} value={leaveStatus} onChange={(e) => { setLeaveStatus(e.target.value); setLeavePage(1); }} className="w-40" />
          </div>
          <Table columns={[
            { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string }; return e ? `${e.firstName} ${e.lastName}` : '-'; } },
            { key: 'type', label: 'Type' },
            { key: 'startDate', label: 'Start', render: (v: unknown) => formatDate(v as string) },
            { key: 'endDate', label: 'End', render: (v: unknown) => formatDate(v as string) },
            { key: 'status', label: 'Status', render: (v: unknown) => <Badge variant={getStatusBadge(v as string)}>{(v as string).replace(/_/g, ' ')}</Badge> },
            { key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => {
              if (!canUpdate || row.status !== 'PENDING') return null;
              return (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" loading={approveLeaveMutation.isPending} onClick={() => approveLeaveMutation.mutate({ id: row.id as string, status: 'APPROVED' })}>Approve</Button>
                  <Button size="sm" variant="secondary" loading={approveLeaveMutation.isPending} onClick={() => approveLeaveMutation.mutate({ id: row.id as string, status: 'REJECTED' })}>Reject</Button>
                </div>
              );
            }},
          ]} data={(leave?.data as LeaveRequest[]) || []} loading={leaveLoading} />
          {renderPagination(leave?.pagination, leavePage, setLeavePage)}
        </>
      )}

      {activeTab === 3 && (
        <>
          <div className="mb-4 max-w-sm"><Input placeholder="Search payroll…" value={paySearch} onChange={(e) => { setPaySearch(e.target.value); setPayPage(1); }} /></div>
          <Table columns={[
            { key: 'employee', label: 'Employee', render: (_: unknown, row: Record<string, unknown>) => { const e = row.employee as { firstName: string; lastName: string; employeeNo: string }; return e ? `${e.firstName} ${e.lastName} (${e.employeeNo})` : '-'; } },
            { key: 'periodStart', label: 'Period Start', render: (v: unknown) => formatDate(v as string) },
            { key: 'periodEnd', label: 'Period End', render: (v: unknown) => formatDate(v as string) },
            { key: 'netPay', label: 'Net Pay', render: (v: unknown) => formatCurrency(v as number) },
            { key: 'isPaid', label: 'Status', render: (v: unknown) => <Badge variant={v ? 'success' : 'warning'}>{v ? 'Paid' : 'Unpaid'}</Badge> },
            { key: 'actions', label: 'Actions', render: (_: unknown, row: Record<string, unknown>) => {
              if (!canUpdate || row.isPaid) return null;
              return <Button size="sm" loading={payPayrollMutation.isPending} onClick={(e) => { e.stopPropagation(); payPayrollMutation.mutate(row.id as string); }}>Mark Paid</Button>;
            }},
          ]} data={(payroll?.data as PayrollRecord[]) || []} loading={payrollLoading} />
          {renderPagination(payroll?.pagination, payPage, setPayPage)}
        </>
      )}

      <Modal open={modal !== null} onClose={() => { setModal(null); setEditing(null); }} title={modal === 'employee' ? (editing ? 'Edit Employee' : 'Add Employee') : modal === 'attendance' ? 'Record Attendance' : modal === 'leave' ? 'Request Leave' : 'Create Payroll'} size="lg">
        {modal === 'employee' && <EmployeeForm employee={editing} onSuccess={() => { setModal(null); setEditing(null); }} onCancel={() => { setModal(null); setEditing(null); }} />}
        {modal === 'attendance' && <AttendanceForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'leave' && <LeaveForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
        {modal === 'payroll' && <PayrollForm onSuccess={() => setModal(null)} onCancel={() => setModal(null)} />}
      </Modal>
    </div>
  );
}
