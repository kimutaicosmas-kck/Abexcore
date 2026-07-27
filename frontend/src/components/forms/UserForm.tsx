import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Input, Select, FormActions, ModalFormBody } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { User } from '../../types';
import { ModuleAccessPicker } from './ModuleAccessPicker';
import { modulesForRoleName } from '../../utils/roleModules';

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

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!user;
  const [selectedModules, setSelectedModules] = useState<string[]>(['dashboard']);

  const { data: rolesData } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () => usersApi.roles().then((r) => r.data.data as { id: string; name: string }[]),
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data as { id: string; name: string }[]),
  });

  const { data: branchesData } = useQuery({
    queryKey: ['user-branches'],
    queryFn: () => usersApi.branches().then((r) => r.data.data as { id: string; name: string; code: string }[]),
  });

  const assignableRoles = (rolesData || []).filter((r) => r.name !== 'Super Admin');

  const roleOptions = [
    { value: '', label: 'Select role…' },
    ...assignableRoles.map((r) => ({ value: r.id, label: r.name })),
  ];

  const departmentOptions = [
    { value: '', label: 'None' },
    ...(departmentsData || []).map((d) => ({ value: d.id, label: d.name })),
  ];

  const branchOptions = [
    { value: '', label: 'None' },
    ...(branchesData || []).map((b) => ({
      value: b.id,
      label: `${b.name} (${b.code})`,
    })),
  ];

  const statusOptions = [
    { value: 'ACTIVE', label: 'Active' },
    { value: 'INACTIVE', label: 'Inactive' },
    { value: 'SUSPENDED', label: 'Suspended' },
  ];

  const { register, handleSubmit, reset, setError, watch, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      password: '',
      firstName: '',
      lastName: '',
      phone: '',
      roleId: '',
      departmentId: '',
      branchId: '',
      status: 'ACTIVE',
    },
  });

  const selectedRoleId = watch('roleId');

  useEffect(() => {
    if (!selectedRoleId || !rolesData?.length) return;
    const role = rolesData.find((r) => r.id === selectedRoleId);
    if (role) {
      setSelectedModules(modulesForRoleName(role.name));
    }
  }, [selectedRoleId, rolesData]);

  useEffect(() => {
    if (user) {
      reset({
        email: user.email,
        password: '',
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone || '',
        roleId: user.roleId || user.role?.id || '',
        departmentId: user.department?.id || '',
        branchId: user.branch?.id || '',
        status: (user.status as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') || 'ACTIVE',
      });
      setSelectedModules(modulesForRoleName(user.role?.name || 'Sales Officer'));
    } else {
      reset({
        email: '',
        password: '',
        firstName: '',
        lastName: '',
        phone: '',
        roleId: '',
        departmentId: '',
        branchId: '',
        status: 'ACTIVE',
      });
      setSelectedModules(['dashboard']);
    }
  }, [user, reset]);

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
    <form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
      <ModalFormBody
        footer={
          <FormActions
            onCancel={onCancel}
            submitLabel={isEdit ? 'Update User' : 'Create User'}
            loading={mutation.isPending}
          />
        }
      >
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          {getApiErrorMessage(mutation.error)}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Email *"
          type="email"
          autoComplete="off"
          {...register('email')}
          error={errors.email?.message}
        />
        <Input
          label={isEdit ? 'Password (leave blank to keep)' : 'Password *'}
          type="password"
          autoComplete="new-password"
          {...register('password')}
          error={errors.password?.message}
        />
        <Input label="First Name *" autoComplete="off" {...register('firstName')} error={errors.firstName?.message} />
        <Input label="Last Name *" autoComplete="off" {...register('lastName')} error={errors.lastName?.message} />
        <Input label="Phone" autoComplete="off" {...register('phone')} />
        <Select label="Role *" options={roleOptions} {...register('roleId')} error={errors.roleId?.message} />
        <Select label="Department" options={departmentOptions} {...register('departmentId')} />
        <Select label="Branch" options={branchOptions} {...register('branchId')} />
        {isEdit && (
          <Select label="Status" options={statusOptions} {...register('status')} />
        )}
      </div>

      <ModuleAccessPicker
        value={selectedModules}
        onChange={setSelectedModules}
        disabled
      />
      </ModalFormBody>
    </form>
  );
}
