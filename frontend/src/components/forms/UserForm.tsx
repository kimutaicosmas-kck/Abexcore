import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { usersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { User } from '../../types';

const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
  roleId: z.string().min(1, 'Role is required'),
  departmentId: z.string().optional(),
  branchId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
});

type UserFormData = z.infer<typeof userSchema>;

interface UserFormProps {
  user?: User | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function getApiError(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string }>;
  return axiosError.response?.data?.message || 'Failed to save user. Please try again.';
}

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!user;

  const { data: rolesData } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () => usersApi.roles().then((r) => r.data.data),
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data),
  });

  const { data: branchesData } = useQuery({
    queryKey: ['user-branches'],
    queryFn: () => usersApi.branches().then((r) => r.data.data),
  });

  const roleOptions = [
    { value: '', label: 'Select role...' },
    ...(rolesData || []).map((r: { id: string; name: string }) => ({ value: r.id, label: r.name })),
  ];

  const departmentOptions = [
    { value: '', label: 'None' },
    ...(departmentsData || []).map((d: { id: string; name: string }) => ({ value: d.id, label: d.name })),
  ];

  const branchOptions = [
    { value: '', label: 'None' },
    ...(branchesData || []).map((b: { id: string; name: string; code: string }) => ({
      value: b.id,
      label: `${b.name} (${b.code})`,
    })),
  ];

  const statusOptions = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'SUSPENDED', label: 'Suspended' },
  ];

  const { register, handleSubmit, setError, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: user
      ? {
          email: user.email,
          password: '',
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone || '',
          roleId: user.roleId,
          departmentId: user.department?.id || '',
          branchId: user.branch?.id || '',
          status: (user.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') || 'ACTIVE',
        }
      : { password: '', roleId: '', departmentId: '', branchId: '', status: 'ACTIVE' },
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? usersApi.update(user!.id, payload) : usersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-roles'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['user-detail', user!.id] });
      onSuccess();
    },
  });

  const onSubmit = (data: UserFormData) => {
    if (!isEdit && !data.password) {
      setError('password', { message: 'Password is required' });
      return;
    }
    const payload = {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || undefined,
      roleId: data.roleId,
      departmentId: data.departmentId || undefined,
      branchId: data.branchId || undefined,
      ...(isEdit ? { status: data.status } : {}),
      ...(data.password ? { password: data.password } : {}),
    };
    mutation.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiError(mutation.error)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Email *" type="email" {...register('email')} error={errors.email?.message} />
        <Input
          label={isEdit ? 'Password (leave blank to keep)' : 'Password *'}
          type="password"
          {...register('password')}
          error={errors.password?.message}
        />
        <Input label="First Name *" {...register('firstName')} error={errors.firstName?.message} />
        <Input label="Last Name *" {...register('lastName')} error={errors.lastName?.message} />
        <Input label="Phone" {...register('phone')} />
        <Select label="Role *" options={roleOptions} {...register('roleId')} error={errors.roleId?.message} />
        <Select label="Department" options={departmentOptions} {...register('departmentId')} />
        <Select label="Branch" options={branchOptions} {...register('branchId')} />
        {isEdit && (
          <Select label="Status" options={statusOptions} {...register('status')} />
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update User' : 'Create User'}
        </Button>
      </div>
    </form>
  );
}
