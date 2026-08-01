import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hrApi, usersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Employee } from '../../types';
import { getApiErrorMessage } from '../../utils/apiError';

const employeeSchema = z.object({
  employeeNo: z.string().min(1, 'Employee number is required'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  position: z.string().optional(),
  hireDate: z.string().min(1, 'Hire date is required'),
  salary: z.coerce.number().min(0).optional(),
  departmentId: z.string().optional(),
  userId: z.string().optional(),
});

type EmployeeFormData = z.infer<typeof employeeSchema>;

interface Department {
  id: string;
  name: string;
}

interface LinkableUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: { name: string };
}

interface EmployeeFormProps {
  employee?: Employee | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function EmployeeForm({ employee, onSuccess, onCancel }: EmployeeFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!employee;

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data as Department[]),
  });

  const { data: linkableUsers } = useQuery({
    queryKey: ['hr-linkable-users'],
    queryFn: () => hrApi.linkableUsers().then((r) => r.data.data as LinkableUser[]),
  });

  const departmentOptions = [
    { value: '', label: 'None' },
    ...(departmentsData || []).map((d) => ({ value: d.id, label: d.name })),
  ];

  const linkedUser = employee?.user;
  const userOptions = [
    { value: '', label: 'No login linked' },
    ...(linkedUser
      ? [
          {
            value: linkedUser.id,
            label: `${linkedUser.firstName} ${linkedUser.lastName} (${linkedUser.email}) — current`,
          },
        ]
      : []),
    ...(linkableUsers || [])
      .filter((u) => u.id !== linkedUser?.id)
      .map((u) => ({
        value: u.id,
        label: `${u.firstName} ${u.lastName} (${u.email})${u.role?.name ? ` · ${u.role.name}` : ''}`,
      })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeSchema),
    defaultValues: employee
      ? {
          employeeNo: employee.employeeNo,
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email || '',
          phone: employee.phone || '',
          position: employee.position || '',
          hireDate: employee.hireDate
            ? String(employee.hireDate).slice(0, 10)
            : new Date().toISOString().split('T')[0],
          salary: Number(employee.salary),
          departmentId: employee.departmentId || employee.department?.id || '',
          userId: employee.userId || employee.user?.id || '',
        }
      : { salary: 0, departmentId: '', userId: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: EmployeeFormData) => {
      const payload = {
        ...data,
        email: data.email || undefined,
        phone: data.phone || undefined,
        departmentId: data.departmentId || undefined,
        userId: data.userId || null,
      };
      return isEdit
        ? hrApi.updateEmployee(employee!.id, payload)
        : hrApi.createEmployee(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-stats'] });
      queryClient.invalidateQueries({ queryKey: ['hr-linkable-users'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiErrorMessage(mutation.error)}
        </div>
      )}

      <div className="rounded-lg border border-primary-100 bg-primary-50/60 px-3 py-2 text-xs text-primary-900">
        Link a <strong>system login (Users)</strong> so this person has one account for leave, sales, and the rest of the ERP.
        Matching email auto-links on create when possible.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Employee No *" {...register('employeeNo')} error={errors.employeeNo?.message} disabled={isEdit} />
        <Input label="Position" {...register('position')} />
        <Input label="First Name *" {...register('firstName')} error={errors.firstName?.message} />
        <Input label="Last Name *" {...register('lastName')} error={errors.lastName?.message} />
        <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
        <Input label="Phone" {...register('phone')} />
        <Input label="Hire Date *" type="date" {...register('hireDate')} error={errors.hireDate?.message} />
        <Input label="Salary (KES)" type="number" step="0.01" {...register('salary')} />
        <Select label="Department" options={departmentOptions} {...register('departmentId')} />
        <Select
          label="System login (User account)"
          options={userOptions}
          {...register('userId')}
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Employee' : 'Create Employee'}
        </Button>
      </div>
    </form>
  );
}
