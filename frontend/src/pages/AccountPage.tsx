import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Camera, KeyRound, LogOut, Shield } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Badge, Button, Card, Input, PageToolbar, formatDateTime } from '../components/ui';
import { UserAvatar } from '../components/ui/UserAvatar';
import { getApiErrorMessage } from '../utils/apiError';
import { SettingsPage } from './SettingsPage';

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

function ProfilePanel() {
  const navigate = useNavigate();
  const { user, company, logout, refreshUser } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSuccess, setAvatarSuccess] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  });

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

  const onUploadAvatar = async (file: File) => {
    setAvatarError('');
    setAvatarSuccess('');
    setAvatarUploading(true);
    try {
      await authApi.uploadAvatar(file);
      await refreshUser();
      setAvatarSuccess('Profile photo updated.');
    } catch (err) {
      setAvatarError(getApiErrorMessage(err) || 'Failed to upload photo. Use JPG, PNG, or WEBP under 2MB.');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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

  const workspaceLine =
    [user.department?.name, user.branch?.name].filter(Boolean).join(' · ') || 'No branch assigned';

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="relative shrink-0 self-start">
            <UserAvatar
              firstName={user.firstName}
              lastName={user.lastName}
              avatar={user.avatar}
              size="lg"
              className="ring-2 ring-primary-100"
            />
            <button
              type="button"
              disabled={avatarUploading}
              onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-primary-100 bg-white text-primary-700 shadow-sm hover:bg-primary-50 disabled:opacity-60"
              aria-label="Upload profile photo"
              title="Upload profile photo"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={avatarUploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadAvatar(file);
              }}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-slate-900 truncate">
                {user.firstName} {user.lastName}
              </h2>
              <Badge variant="info">{user.role?.name || 'User'}</Badge>
            </div>
            <p className="text-sm text-slate-600 mt-1 truncate">{user.email}</p>
            {user.phone && <p className="text-sm text-slate-500 mt-0.5">{user.phone}</p>}
            <button
              type="button"
              disabled={avatarUploading}
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 text-sm font-medium text-primary-700 hover:text-primary-800 disabled:opacity-60"
            >
              {avatarUploading ? 'Uploading…' : user.avatar ? 'Change photo' : 'Upload photo'}
            </button>
          </div>
        </div>

        {(avatarError || avatarSuccess) && (
          <div className="mt-4 space-y-2">
            {avatarError && <Alert variant="error">{avatarError}</Alert>}
            {avatarSuccess && <Alert variant="success">{avatarSuccess}</Alert>}
          </div>
        )}

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3">
            <div className="flex items-center gap-2 text-slate-500">
              <Building2 className="h-4 w-4 shrink-0" />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Workspace</p>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-900">{company?.name || '—'}</p>
            <p className="text-xs text-slate-500 mt-0.5">{workspaceLine}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3">
            <div className="flex items-center gap-2 text-slate-500">
              <Shield className="h-4 w-4 shrink-0" />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Access</p>
            </div>
            <p className="mt-1.5 text-sm font-medium text-slate-900 capitalize">
              {user.status?.toLowerCase() || '—'}
            </p>
            {user.lastLoginAt && (
              <p className="text-xs text-slate-500 mt-0.5">Last login: {formatDateTime(user.lastLoginAt)}</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="Change password">
        <form onSubmit={handleSubmit(onChangePassword)} className="space-y-3">
          <p className="text-xs text-slate-500 -mt-1 mb-1">
            Use a strong password with at least 8 characters. You will stay signed in after updating.
          </p>
          {passwordError && <Alert variant="error">{passwordError}</Alert>}
          {passwordSuccess && <Alert variant="success">{passwordSuccess}</Alert>}
          <div className="grid gap-3 sm:grid-cols-1">
            <Input
              label="Current password"
              type="password"
              autoComplete="current-password"
              {...register('currentPassword')}
              error={errors.currentPassword?.message}
            />
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
          </div>
          <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
            <KeyRound className="h-4 w-4 mr-1.5" />
            Update password
          </Button>
        </form>
      </Card>

      <div className="pt-1">
        <Button variant="danger" loading={loggingOut} onClick={handleLogout} className="w-full sm:w-auto">
          <LogOut className="h-4 w-4 mr-1.5" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

export function AccountPage() {
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canOpenSettings = hasPermission('settings:read');

  const tabs = useMemo(() => {
    if (!canOpenSettings) return ['Profile'];
    return ['Profile', 'Company'];
  }, [canOpenSettings]);

  const wantCompany =
    canOpenSettings &&
    ['settings', 'company', 'company settings'].includes((searchParams.get('tab') || '').toLowerCase());

  const initialTab = wantCompany ? 'Company' : 'Profile';
  const [activeTabName, setActiveTabName] = useState(initialTab);
  const activeTab = Math.max(0, tabs.indexOf(activeTabName));

  useEffect(() => {
    const next = wantCompany ? 'Company' : 'Profile';
    setActiveTabName((current) => (current === next ? current : next));
  }, [wantCompany]);

  const setTab = (name: string) => {
    setActiveTabName(name);
    const next = new URLSearchParams(searchParams);
    if (name === 'Company') next.set('tab', 'settings');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      {canOpenSettings && (
        <PageToolbar
          tabs={tabs}
          activeTab={activeTab >= 0 ? activeTab : 0}
          onTabChange={(index) => setTab(tabs[index])}
        />
      )}
      {activeTabName === 'Profile' && <ProfilePanel />}
      {activeTabName === 'Company' && canOpenSettings && <SettingsPage />}
    </div>
  );
}
