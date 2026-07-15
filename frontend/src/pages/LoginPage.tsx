import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Layers, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button, Input } from '../components/ui';
import { APP_NAME, APP_TAGLINE, DESIGNER } from '../constants/brand';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState({ email: '', password: '' });

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');
    try {
      await login(data.email, data.password, data.totpCode);
      navigate('/');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; code?: string } } };
      if (axiosErr.response?.data?.code === '2FA_REQUIRED') {
        setNeeds2FA(true);
        setSavedCredentials({ email: data.email, password: data.password });
        setError('');
      } else {
        setError(axiosErr.response?.data?.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const submit2FA = async (totpCode: string) => {
    setLoading(true);
    setError('');
    try {
      await login(savedCredentials.email, savedCredentials.password, totpCode);
      navigate('/');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } } };
      setError(axiosErr.response?.data?.message || 'Invalid 2FA code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-surface-subtle">
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-900" />
        <div className="relative text-white max-w-lg">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 mb-6">
            <Layers className="h-7 w-7" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">{APP_NAME}</h1>
          <p className="text-primary-100 text-lg leading-relaxed mb-8">{APP_TAGLINE}</p>
          <p className="text-sm text-primary-200/90">Designed by {DESIGNER}</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl border border-border shadow-panel p-8">
            <div className="text-center mb-8">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                {needs2FA ? 'Two-factor authentication' : 'Sign in'}
              </h2>
              <p className="text-slate-500 mt-1.5 text-sm">
                {needs2FA ? 'Enter the 6-digit code from your authenticator app' : `Access your ${APP_NAME} workspace`}
              </p>
            </div>

            {!needs2FA ? (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm ring-1 ring-red-100">{error}</div>
                )}
                <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
                <Input label="Password" type="password" {...register('password')} error={errors.password?.message} />
                <Button type="submit" loading={loading} className="w-full mt-2">Sign in</Button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = (e.currentTarget.elements.namedItem('totp') as HTMLInputElement).value;
                  submit2FA(code);
                }}
                className="space-y-4"
              >
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm ring-1 ring-red-100">{error}</div>
                )}
                <Input
                  label="Authentication code"
                  name="totp"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  onChange={(e) => setValue('totpCode', e.target.value)}
                />
                <Button type="submit" loading={loading} className="w-full">Verify</Button>
                <button type="button" className="w-full text-sm text-slate-500 hover:text-slate-700" onClick={() => setNeeds2FA(false)}>
                  Back to login
                </button>
              </form>
            )}

            {import.meta.env.DEV && !needs2FA && (
              <p className="mt-6 text-center text-xs text-slate-400">Development mode — use seeded admin credentials</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
