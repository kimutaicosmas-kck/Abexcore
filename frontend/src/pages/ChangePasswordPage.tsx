import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Button, Input, Alert } from '../components/ui';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string().min(1, 'Required'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { refreshUser, clearMustChangePassword } = useAuth();
  const [error, setError] = useState('');

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setError('');
    try {
      await authApi.changePassword(data.currentPassword, data.newPassword);
      clearMustChangePassword();
      await refreshUser();
      navigate('/');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || 'Failed to change password');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-subtle p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-border shadow-panel p-8">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Change your password</h1>
          <p className="text-sm text-slate-500 mt-1">You must set a new password before continuing.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Input label="Current password" type="password" {...register('currentPassword')} error={errors.currentPassword?.message} />
          <Input label="New password" type="password" {...register('newPassword')} error={errors.newPassword?.message} />
          <Input label="Confirm new password" type="password" {...register('confirmPassword')} error={errors.confirmPassword?.message} />
          <Button type="submit" loading={isSubmitting} className="w-full">Update password</Button>
        </form>
      </div>
    </div>
  );
}
