import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { hrApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency, formatDate, getStatusBadge } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { EmployeeForm } from '../components/forms/EmployeeForm';
import { Employee } from '../types';

const tabs = ['Employees', 'Attendance', 'Leave', 'Payroll'];

export function HRPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const { data: employees, isLoading: empLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => hrApi.employees().then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: attendance, isLoading: attLoading } = useQuery({
    queryKey: ['attendance'],
    queryFn: () => hrApi.attendance().then((r) => r.data),
    enabled: activeTab === 1,
  });

  const { data: leave, isLoading: leaveLoading } = useQuery({
    queryKey: ['leave'],
    queryFn: () => hrApi.leave().then((r) => r.data),
    enabled: activeTab === 2,
  });

  const { data: payroll, isLoading: payrollLoading } = useQuery({
    queryKey: ['payroll'],
    queryFn: () => hrApi.payroll().then((r) => r.data),
    enabled: activeTab === 3,
  });

  const approveLeaveMutation = useMutation({
    mutationFn: (id: string) => hrApi.approveLeave(id, 'APPROVED'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave'] }),
  });

  const payPayrollMutation = useMutation({
    mutationFn: (id: string) => hrApi.payPayroll(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll'] }),
  });

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const employeeColumns = [
    { key: 'employeeNo', label: 'Employee #' },
    {
      key: 'name',
      label: 'Name',
      render: (_: unknown, row: Record<string, unknown>) =>
        `${row.firstName} ${row.lastName}`,
    },
    { key: 'position', label: 'Position' },
    {
      key: 'department',
      label: 'Department',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.department as { name: string })?.name || '-',
    },
    {
      key: 'salary',
      label: 'Salary',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val ? 'success' : 'danger'}>{val ? 'Active' : 'Inactive'}</Badge>
      ),
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
            openEdit(row as unknown as Employee);
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const attendanceColumns = [
    {
      key: 'employee',
      label: 'Employee',
      render: (_: unknown, row: Record<string, unknown>) => {
        const emp = row.employee as { firstName: string; lastName: string; employeeNo: string };
        return emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeNo})` : '-';
      },
    },
    {
      key: 'date',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'checkIn',
      label: 'Check In',
      render: (val: unknown) => (val ? new Date(val as string).toLocaleTimeString() : '-'),
    },
    {
      key: 'checkOut',
      label: 'Check Out',
      render: (val: unknown) => (val ? new Date(val as string).toLocaleTimeString() : '-'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val === 'present' ? 'success' : 'warning'}>{val as string}</Badge>
      ),
    },
  ];

  const leaveColumns = [
    {
      key: 'employee',
      label: 'Employee',
      render: (_: unknown, row: Record<string, unknown>) => {
        const emp = row.employee as { firstName: string; lastName: string };
        return emp ? `${emp.firstName} ${emp.lastName}` : '-';
      },
    },
    { key: 'type', label: 'Type' },
    {
      key: 'startDate',
      label: 'Start',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'endDate',
      label: 'End',
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
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (row.status !== 'PENDING') return null;
        return (
          <Button
            size="sm"
            loading={approveLeaveMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              approveLeaveMutation.mutate(row.id as string);
            }}
          >
            Approve
          </Button>
        );
      },
    },
  ];

  const payrollColumns = [
    {
      key: 'employee',
      label: 'Employee',
      render: (_: unknown, row: Record<string, unknown>) => {
        const emp = row.employee as { firstName: string; lastName: string; employeeNo: string };
        return emp ? `${emp.firstName} ${emp.lastName} (${emp.employeeNo})` : '-';
      },
    },
    {
      key: 'periodStart',
      label: 'Period Start',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'periodEnd',
      label: 'Period End',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'netPay',
      label: 'Net Pay',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'isPaid',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val ? 'success' : 'warning'}>{val ? 'Paid' : 'Unpaid'}</Badge>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: Record<string, unknown>) => {
        if (row.isPaid) return null;
        return (
          <Button
            size="sm"
            loading={payPayrollMutation.isPending}
            onClick={(e) => {
              e.stopPropagation();
              payPayrollMutation.mutate(row.id as string);
            }}
          >
            Mark Paid
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Human Resources"
        subtitle="Employee records, attendance, leave, and payroll"
        action={
          activeTab === 0 ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
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
          <Table
            columns={employeeColumns}
            data={employees?.data || []}
            loading={empLoading}
            onRowClick={(row) => openEdit(row as unknown as Employee)}
          />
        </div>
      )}

      {activeTab === 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={attendanceColumns} data={attendance?.data || []} loading={attLoading} />
        </div>
      )}

      {activeTab === 2 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={leaveColumns} data={leave?.data || []} loading={leaveLoading} />
        </div>
      )}

      {activeTab === 3 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <Table columns={payrollColumns} data={payroll?.data || []} loading={payrollLoading} />
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit Employee' : 'Add Employee'}
        size="lg"
      >
        <EmployeeForm employee={editing} onSuccess={closeModal} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
