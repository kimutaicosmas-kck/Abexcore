import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, KeyRound, LogOut, Settings, Shield, UserCircle } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input, formatDateTime } from '../components/ui';
import { getApiErrorMessage } from '../utils/apiError';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type PasswordForm = z.infer<typeof passwordSchema>;

export function AccountPage() {
  const navigate = useNavigate();
  const { user, company, logout, canAccessRoute, refreshUser } = useAuth();
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

  const initials =
    `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase() || 'U';
  const canOpenSettings = canAccessRoute('/settings');

  const onChangePassword = async (data: PasswordForm) => {
    setPasswordError('');
    setPasswordSuccess('');
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      await refreshUser();
      reset();
      setPasswordSuccess('Password updated successfully.');
    } catch (err) {
      setPasswordError(getApiErrorMessage(err));
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  if (!user) {
    return <Alert variant="error">Unable to load your profile. Try signing in again.</Alert>;
  }

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Card padding={false} className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary-600 to-primary-800 px-4 py-6 text-white">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-xl font-bold ring-1 ring-white/25">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {user.firstName} {user.lastName}
              </h2>
              <p className="text-sm text-primary-100 truncate">{user.email}</p>
              <p className="text-xs text-primary-200/90 mt-1">{user.role?.name}</p>
            </div>
          </div>
        </div>

        <ul className="divide-y divide-slate-100">
          <li className="flex items-start gap-3 px-4 py-3.5">
            <UserCircle className="h-5 w-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Profile</p>
              <p className="text-sm font-medium text-slate-900 mt-0.5">
                {user.firstName} {user.lastName}
              </p>
              {user.phone && <p className="text-xs text-slate-500 mt-0.5">{user.phone}</p>}
            </div>
          </li>
          <li className="flex items-start gap-3 px-4 py-3.5">
            <Building2 className="h-5 w-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Workspace</p>
              <p className="text-sm font-medium text-slate-900 mt-0.5">{company?.name || '—'}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {[user.department?.name, user.branch?.name].filter(Boolean).join(' · ') || 'No branch assigned'}
              </p>
            </div>
          </li>
          <li className="flex items-start gap-3 px-4 py-3.5">
            <Shield className="h-5 w-5 text-primary-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Access</p>
              <p className="text-sm font-medium text-slate-900 mt-0.5">{user.role?.name}</p>
              <p className="text-xs text-slate-500 mt-0.5 capitalize">Status: {user.status?.toLowerCase()}</p>
              {user.lastLoginAt && (
                <p className="text-xs text-slate-500 mt-0.5">Last login: {formatDateTime(user.lastLoginAt)}</p>
              )}
            </div>
          </li>
        </ul>
      </Card>

      <Card title="Change password">
        <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3">
          <p className="text-xs text-slate-500 -mt-1 mb-1">
            Use a strong password with at least 8 characters. You will stay signed in after updating.
          </p>
          {passwordError && <Alert variant="error">{passwordError}</Alert>}
          {passwordSuccess && <Alert variant="success">{passwordSuccess}</Alert>}
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            {...register('currentPassword')}
            error={errors.currentPassword?.message}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            {...register('newPassword')}
            error={errors.newPassword?.message}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            {...register('confirmPassword')}
            error={errors.confirmPassword?.message}
          />
          <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
            <KeyRound className="h-4 w-4 mr-1.5" />
            Update password
          </Button>
        </form>
      </Card>

      <div className="grid gap-2 sm:grid-cols-2">
        {canOpenSettings && (
          <Link
            to="/settings"
            className="flex items-center justify-center gap-2 rounded-2xl border border-primary-100 bg-white px-4 py-3 text-sm font-medium text-primary-800 shadow-soft active:scale-[0.98]"
          >
            <Settings className="h-4 w-4" />
            Company settings
          </Link>
        )}
        <Button variant="danger" loading={loggingOut} onClick={handleLogout} className="w-full">
          <LogOut className="h-4 w-4 mr-1.5" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
