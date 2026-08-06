import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Camera, KeyRound, LogOut, Settings, Shield, UserCircle } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Card, Input, formatDateTime } from '../components/ui';
import { UserAvatar } from '../components/ui/UserAvatar';
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

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <Card padding={false} className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary-600 to-primary-800 px-4 py-6 text-white">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <UserAvatar
                firstName={user.firstName}
                lastName={user.lastName}
                avatar={user.avatar}
                size="lg"
                className="ring-1 ring-white/25 bg-white/15"
              />
              <button
                type="button"
                disabled={avatarUploading}
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white text-primary-700 shadow-md ring-2 ring-primary-700 hover:bg-primary-50 disabled:opacity-60"
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
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {user.firstName} {user.lastName}
              </h2>
              <p className="text-sm text-primary-100 truncate">{user.email}</p>
              <p className="text-xs text-primary-200/90 mt-1">{user.role?.name}</p>
              <button
                type="button"
                disabled={avatarUploading}
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 text-xs font-medium text-white/90 underline-offset-2 hover:underline disabled:opacity-60"
              >
                {avatarUploading ? 'Uploading…' : user.avatar ? 'Change photo' : 'Upload photo'}
              </button>
            </div>
          </div>
          {avatarError && (
            <div className="mt-3">
              <Alert variant="error">{avatarError}</Alert>
            </div>
          )}
          {avatarSuccess && (
            <div className="mt-3">
              <Alert variant="success">{avatarSuccess}</Alert>
            </div>
          )}
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
