import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Layers,
  ShieldCheck,
  Factory,
  Package,
  ShoppingCart,
  Wallet,
  BarChart3,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Alert, Button, Input } from '../components/ui';
import { APP_NAME, APP_TAGLINE, DESIGNER, APP_VERSION } from '../constants/brand';

const loginSchema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
  totpCode: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

const FEATURES = [
  {
    label: 'Production & quality',
    desc: 'Manufacturing orders and inspections',
    icon: Factory,
    color: 'bg-orange-500/15 text-orange-200 border-orange-400/20',
  },
  {
    label: 'Inventory control',
    desc: 'Stock, warehouses, and movements',
    icon: Package,
    color: 'bg-violet-500/15 text-violet-200 border-violet-400/20',
  },
  {
    label: 'Sales & delivery',
    desc: 'Orders, quotations, and dispatch',
    icon: ShoppingCart,
    color: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/20',
  },
  {
    label: 'Finance & reports',
    desc: 'Invoices, GL, and business intelligence',
    icon: Wallet,
    color: 'bg-sky-500/15 text-sky-200 border-sky-400/20',
  },
];

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
    <div className="min-h-screen flex bg-slate-100/80">
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-900" />
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.15),transparent_50%)]" />
        <div className="relative text-white max-w-lg w-full">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 mb-6 shadow-lg">
            <Layers className="h-7 w-7" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-3">{APP_NAME}</h1>
          <p className="text-primary-100 text-lg leading-relaxed mb-2">{APP_TAGLINE}</p>
          <p className="text-sm text-primary-200/80 mb-8">
            Designed by {DESIGNER} · v{APP_VERSION}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.label}
                className={`flex items-start gap-3 p-4 rounded-xl border backdrop-blur-sm ${feature.color}`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                  <feature.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-white">{feature.label}</p>
                  <p className="text-xs text-primary-100/80 mt-0.5">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-2 text-sm text-primary-200/90">
            <BarChart3 className="h-4 w-4" />
            <span>Unified dashboard for manufacturing ERP operations</span>
            <ChevronRight className="h-4 w-4 opacity-60" />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10">
        <div className="lg:hidden text-center mb-6">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-600 text-white mb-3 shadow-md">
            <Layers className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">{APP_NAME}</h1>
          <p className="text-xs text-slate-500 mt-1">v{APP_VERSION}</p>
        </div>

        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl border border-border shadow-soft overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-primary-500 to-indigo-600" />
            <div className="p-8">
              <div className="text-center mb-8">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  {needs2FA ? 'Two-factor authentication' : 'Sign in'}
                </h2>
                <p className="text-slate-500 mt-1.5 text-sm">
                  {needs2FA
                    ? 'Enter the 6-digit code from your authenticator app'
                    : `Access your ${APP_NAME} workspace`}
                </p>
              </div>

              {!needs2FA ? (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  {error && <Alert variant="error">{error}</Alert>}
                  <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
                  <Input label="Password" type="password" {...register('password')} error={errors.password?.message} />
                  <Button type="submit" loading={loading} className="w-full mt-2">
                    Sign in
                  </Button>
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
                  {error && <Alert variant="error">{error}</Alert>}
                  <Input
                    label="Authentication code"
                    name="totp"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    onChange={(e) => setValue('totpCode', e.target.value)}
                  />
                  <Button type="submit" loading={loading} className="w-full">
                    Verify
                  </Button>
                  <button
                    type="button"
                    className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
                    onClick={() => setNeeds2FA(false)}
                  >
                    Back to login
                  </button>
                </form>
              )}

              {import.meta.env.DEV && !needs2FA && (
                <p className="mt-6 text-center text-xs text-slate-400 border-t border-slate-100 pt-4">
                  Development mode — use seeded admin credentials
                </p>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-slate-400 mt-4 hidden lg:block">
            {DESIGNER} · Secure enterprise access
          </p>
        </div>
      </div>
    </div>
  );
}
