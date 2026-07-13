import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { User } from '../../types';

const baseUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional(),
  roleId: z.string().min(1, 'Role is required'),
  departmentId: z.string().optional(),
});

const userSchema = baseUserSchema.extend({
  password: z.string().min(8, 'Password must be at least 8 characters').optional().or(z.literal('')),
});

type UserFormData = z.infer<typeof userSchema>;

interface Role {
  id: string;
  name: string;
}

interface Department {
  id: string;
  name: string;
}

interface UserFormProps {
  user?: User | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!user;

  const { data: rolesData } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () => usersApi.roles().then((r) => r.data.data as Role[]),
  });

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data as Department[]),
  });

  const roleOptions = [
    { value: '', label: 'Select role...' },
    ...(rolesData || []).map((r) => ({ value: r.id, label: r.name })),
  ];

  const departmentOptions = [
    { value: '', label: 'None' },
    ...(departmentsData || []).map((d) => ({ value: d.id, label: d.name })),
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
        }
      : { password: '', roleId: '', departmentId: '' },
  });

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? usersApi.update(user!.id, payload) : usersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onSuccess();
    },
  });

  const onSubmit = (data: UserFormData) => {
    if (!isEdit && !data.password) {
      setError('password', { message: 'Password is required' });
      return;
    }
    const payload = {
      ...data,
      phone: data.phone || undefined,
      departmentId: data.departmentId || undefined,
      ...(data.password ? { password: data.password } : {}),
    };
    mutation.mutate(payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save user. Please try again.
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
