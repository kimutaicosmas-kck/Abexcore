import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Table, Badge, Card, formatCurrency } from '../components/ui';

export function HRPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => financeApi.employees().then((r) => r.data),
  });

  const columns = [
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
  ];

  return (
    <div>
      <PageHeader title="Human Resources" subtitle="Employee records, attendance, leave, and payroll" />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
      </div>
    </div>
  );
}
