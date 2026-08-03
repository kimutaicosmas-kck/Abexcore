import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Input, Select, FormActions, ModalFormBody } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';
import { User } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { ModuleAccessPicker } from './ModuleAccessPicker';
import { mergeRoleAndExtraModules, modulesForRoleName } from '../../utils/roleModules';
import { canAssignCompanySuperAdmin } from '../../utils/superAdmin';

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
  /** Create a matching HR employee for this login. */
  createEmployeeProfile: z.boolean().optional(),
  /** Link to an existing unlinked employee (or keep current). */
  employeeId: z.string().optional(),
});

type UserFormData = z.infer<typeof userSchema>;

interface LinkableEmployee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  position?: string;
}

interface UserFormProps {
  user?: User | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function modulesFromUser(user: User): string[] {
  if (Array.isArray(user.allowedModules) && user.allowedModules.length > 0) {
    return user.allowedModules.includes('dashboard')
      ? [...user.allowedModules]
      : ['dashboard', ...user.allowedModules];
  }
  return modulesForRoleName(user.role?.name || 'Sales Officer');
}

export function UserForm({ user, onSuccess, onCancel }: UserFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!user;
  const [selectedModules, setSelectedModules] = useState<string[]>(['dashboard']);
  const [moduleError, setModuleError] = useState('');
  const skipNextRoleModuleSync = useRef(false);

  type SuperAdminQuota = { used: number; max: number; remaining: number };

  const { data: rolesResponse } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () =>
      usersApi.roles().then((r) => ({
        roles: r.data.data as { id: string; name: string }[],
        superAdminQuota: (r.data.meta?.superAdminQuota || null) as SuperAdminQuota | null,
      })),
  });
  const rolesData = rolesResponse?.roles;
  const superAdminQuota = rolesResponse?.superAdminQuota;

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data as { id: string; name: string }[]),
  });

  const { data: branchesData } = useQuery({
    queryKey: ['user-branches'],
    queryFn: () => usersApi.branches().then((r) => r.data.data as { id: string; name: string; code: string }[]),
  });

  const { data: linkableEmployees } = useQuery({
    queryKey: ['users-linkable-employees'],
    queryFn: () => usersApi.linkableEmployees().then((r) => r.data.data as LinkableEmployee[]),
  });

  const { user: authUser } = useAuth();
  const canAssignSuperAdmin = canAssignCompanySuperAdmin(authUser?.role?.name);
  const editingIsSuperAdmin = user?.role?.name === 'Super Admin';
  // Per-company seats (Amazon ≠ Company X). Hide only when this tenant is full.
  const atSuperAdminCapacity =
    !!superAdminQuota && superAdminQuota.remaining <= 0 && !editingIsSuperAdmin;
  const canOfferSuperAdmin = canAssignSuperAdmin && !atSuperAdminCapacity;

  const assignableRoles = (rolesData || []).filter(
    (r) => r.name !== 'Super Admin' || canOfferSuperAdmin
  );

  const roleOptions = [
    { value: '', label: 'Select role…' },
    ...assignableRoles.map((r) => ({
      value: r.id,
      label:
        r.name === 'Super Admin'
          ? `Super Admin — this company${
              superAdminQuota ? ` (${superAdminQuota.used}/${superAdminQuota.max})` : ' (max 2)'
            }`
          : r.name,
    })),
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

  const linkedEmployee = user?.employee;
  const employeeOptions = [
    { value: '', label: linkedEmployee ? 'Unlink employee profile' : 'No employee linked' },
    ...(linkedEmployee
      ? [
          {
            value: linkedEmployee.id,
            label: `${linkedEmployee.employeeNo} — ${linkedEmployee.firstName} ${linkedEmployee.lastName} (current)`,
          },
        ]
      : []),
    ...(linkableEmployees || [])
      .filter((e) => e.id !== linkedEmployee?.id)
      .map((e) => ({
        value: e.id,
        label: `${e.employeeNo} — ${e.firstName} ${e.lastName}${e.position ? ` · ${e.position}` : ''}`,
      })),
  ];

  const { register, handleSubmit, reset, setError, setValue, watch, formState: { errors } } = useForm<UserFormData>({
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
      createEmployeeProfile: true,
      employeeId: '',
    },
  });

  const selectedRoleId = watch('roleId');
  const createEmployeeProfile = watch('createEmployeeProfile');
  const selectedEmployeeId = watch('employeeId');
  const selectedRoleName = rolesData?.find((r) => r.id === selectedRoleId)?.name || '';
  const roleBaseline = selectedRoleName ? modulesForRoleName(selectedRoleName) : ['dashboard'];

  useEffect(() => {
    if (selectedEmployeeId) {
      setValue('createEmployeeProfile', false);
    }
  }, [selectedEmployeeId, setValue]);

  useEffect(() => {
    if (!selectedRoleId || !rolesData?.length) return;
    if (skipNextRoleModuleSync.current) {
      skipNextRoleModuleSync.current = false;
      return;
    }
    const role = rolesData.find((r) => r.id === selectedRoleId);
    if (role) {
      // Strict RBAC: role change resets to that role's defaults (extras cleared).
      setSelectedModules(modulesForRoleName(role.name));
      setModuleError('');
    }
  }, [selectedRoleId, rolesData]);

  useEffect(() => {
    if (user) {
      skipNextRoleModuleSync.current = true;
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
        createEmployeeProfile: false,
        employeeId: user.employee?.id || '',
      });
      setSelectedModules(modulesFromUser(user));
      setModuleError('');
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
        createEmployeeProfile: true,
        employeeId: '',
      });
      setSelectedModules(['dashboard']);
      setModuleError('');
    }
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit ? usersApi.update(user!.id, payload) : usersApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-stats'] });
      queryClient.invalidateQueries({ queryKey: ['user-roles'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['users-linkable-employees'] });
      queryClient.invalidateQueries({ queryKey: ['hr-linkable-users'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['user-detail', user!.id] });
      onSuccess();
    },
  });

  const onSubmit = (data: UserFormData) => {
    if (!isEdit && !data.password) {
      setError('password', { message: 'Password is required' });
      return;
    }

    if (!selectedRoleName) {
      setError('roleId', { message: 'Role is required' });
      return;
    }
    const modules = mergeRoleAndExtraModules(selectedRoleName, selectedModules);
    if (modules.length < 1) {
      setModuleError('Select a role to apply module access.');
      return;
    }
    setModuleError('');

    const linkingExisting = !!data.employeeId;
    const payload: Record<string, unknown> = {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone || undefined,
      roleId: data.roleId,
      departmentId: data.departmentId || undefined,
      branchId: data.branchId || undefined,
      modules,
      ...(isEdit ? { status: data.status } : {}),
      ...(data.password ? { password: data.password } : {}),
    };

    if (isEdit) {
      if (data.employeeId) {
        payload.employeeId = data.employeeId;
      } else if (user?.employee) {
        payload.employeeId = null;
      } else if (data.createEmployeeProfile) {
        payload.createEmployeeProfile = true;
      }
    } else if (linkingExisting) {
      payload.employeeId = data.employeeId;
    } else if (data.createEmployeeProfile) {
      payload.createEmployeeProfile = true;
    }

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
        {canAssignSuperAdmin && (
          <p className="text-xs text-slate-500 -mt-1">
            {superAdminQuota
              ? `This company Super Admin seats: ${superAdminQuota.used} of ${superAdminQuota.max}${
                  superAdminQuota.remaining === 0 && !editingIsSuperAdmin
                    ? ' · limit reached for this company'
                    : ''
                }`
              : 'Each company may have up to 2 Super Admins (not shared across tenants).'}
          </p>
        )}
        <Select label="Department" options={departmentOptions} {...register('departmentId')} />
        <Select label="Branch" options={branchOptions} {...register('branchId')} />
        {isEdit && (
          <Select label="Status" options={statusOptions} {...register('status')} />
        )}
      </div>

      <div className="mt-4 space-y-3 rounded-xl border border-primary-100 bg-primary-50/50 p-3">
        <p className="text-sm font-medium text-primary-950">HR employee link</p>
        <p className="text-xs text-primary-800/80">
          One login should map to one employee so leave and payroll stay on the same person.
        </p>
        {linkedEmployee && (
          <p className="text-xs text-emerald-800">
            Currently linked: {linkedEmployee.employeeNo} — {linkedEmployee.firstName}{' '}
            {linkedEmployee.lastName}
          </p>
        )}
        {!selectedEmployeeId && !linkedEmployee && (
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-slate-300"
              {...register('createEmployeeProfile')}
            />
            <span>
              {isEdit
                ? 'Create HR employee profile for this login'
                : 'Also create HR employee profile (recommended)'}
            </span>
          </label>
        )}
        <Select label="Link existing employee" options={employeeOptions} {...register('employeeId')} />
        {createEmployeeProfile && !selectedEmployeeId && !linkedEmployee && (
          <p className="text-xs text-slate-600">
            An employee record will be created and linked using this user’s name and email.
          </p>
        )}
      </div>

      <ModuleAccessPicker
        value={selectedModules}
        roleBaseline={roleBaseline}
        onChange={(next) => {
          setSelectedModules(mergeRoleAndExtraModules(selectedRoleName || 'Sales Representative', next));
          setModuleError('');
        }}
        error={moduleError}
      />
      </ModalFormBody>
    </form>
  );
}
