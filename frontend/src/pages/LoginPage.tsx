import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ShieldCheck,
  Factory,
  Package,
  ShoppingCart,
  Wallet,
  BarChart3,
  ChevronRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { authApi } from '../services/api';
import { Alert, ApiErrorAlert, Button, Input } from '../components/ui';
import { AbexCoreLogo } from '../components/brand/AbexCoreLogo';
import { PoweredBy } from '../components/brand/PoweredBy';
import { APP_NAME, APP_TAGLINE } from '../constants/brand';
import {
  resolveTenantSlugFromHost,
  resolveTenantSlugFromQuery,
  buildTenantLoginUrl,
  isStandalonePwa,
} from '../utils/tenant';
import { CompanyLogoMark } from '../components/brand/CompanyBrand';
import { PLATFORM_COMPANY_SLUG } from '../constants/platform';

const loginSchema = z.object({
  companySlug: z.string().min(2, 'Company code is required'),
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
    color: 'bg-blue-500/15 text-blue-200 border-blue-400/20',
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
  const [searchParams] = useSearchParams();
  const sessionReason = searchParams.get('reason');
  const sessionExpired = sessionReason === 'inactive' || sessionReason === 'session';
  const [loginError, setLoginError] = useState<unknown>(null);
  const [validationError, setValidationError] = useState('');
  const [loading, setLoading] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [savedCredentials, setSavedCredentials] = useState({ companySlug: '', email: '', password: '' });
  const [resolvedTenant, setResolvedTenant] = useState<{ slug: string; name: string; logo?: string | null } | null>(null);
  const [tenantLoading, setTenantLoading] = useState(false);
  const [tenantError, setTenantError] = useState('');

  const installedPwa = isStandalonePwa();

  // Browser: ?tenant= or subdomain can lock the company. Installed PWA must stay multi-company —
  // old installs still open /login?tenant=owner which hid the company field and blocked other tenants.
  const hostSlug = useMemo(() => {
    const fromHost = resolveTenantSlugFromHost();
    if (installedPwa) return fromHost; // ignore ?tenant= in the installed app
    return resolveTenantSlugFromQuery(window.location.search) || fromHost;
  }, [searchParams, installedPwa]);
  const tenantLocked = !!hostSlug;
  const isPlatformLogin = hostSlug === PLATFORM_COMPANY_SLUG;
  const platformLoginUrl = buildTenantLoginUrl(PLATFORM_COMPANY_SLUG);

  const { register, handleSubmit, formState: { errors }, setValue } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      companySlug: hostSlug || localStorage.getItem('companySlug') || (import.meta.env.DEV ? 'owner' : ''),
      email: '',
      password: '',
    },
  });

  // Strip legacy ?tenant=owner from installed-app URLs so company code stays visible.
  useEffect(() => {
    if (!installedPwa) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tenant')) return;
    params.delete('tenant');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    setValue('companySlug', localStorage.getItem('companySlug') || '');
    setResolvedTenant(null);
    setTenantError('');
  }, [installedPwa, setValue]);

  useEffect(() => {
    if (!hostSlug) return;

    setValue('companySlug', hostSlug);
    setTenantLoading(true);
    setTenantError('');

    authApi
      .resolveTenant(hostSlug)
      .then(({ data }) => {
        setResolvedTenant({ slug: data.data.slug, name: data.data.name, logo: data.data.logo });
      })
      .catch(() => {
        setResolvedTenant(null);
        setTenantError('This workspace URL is not valid or the company is inactive.');
      })
      .finally(() => setTenantLoading(false));
  }, [hostSlug, setValue]);

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setLoginError(null);
    setValidationError('');
    const email = data.email.trim();
    // Do not trim password — spaces can be intentional; trimming broke some mobile autofills.
    const password = data.password;
    const companySlug = (hostSlug || data.companySlug).trim().toLowerCase();
    if (!companySlug) {
      setValidationError('Enter your company code, then email and password.');
      setLoading(false);
      return;
    }
    try {
      await login(companySlug, email, password, data.totpCode?.trim());
      navigate('/');
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; code?: string } } };
      if (axiosErr.response?.data?.code === '2FA_REQUIRED') {
        setNeeds2FA(true);
        setSavedCredentials({ companySlug, email, password });
        setLoginError(null);
    setValidationError('');
      } else {
        setLoginError(err);
      }
    } finally {
      setLoading(false);
    }
  };

  const submit2FA = async (totpCode: string) => {
    setLoading(true);
    setLoginError(null);
    setValidationError('');
    try {
      await login(savedCredentials.companySlug, savedCredentials.email, savedCredentials.password, totpCode);
      navigate('/');
    } catch (err: unknown) {
      setLoginError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c1929] via-primary-900 to-[#0c4a6e]" />
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_30%,rgba(139,92,246,0.45),transparent_45%)]" />
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_80%_70%,rgba(6,182,212,0.35),transparent_40%)]" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary-400/50 to-transparent" />
        <div className="relative text-white max-w-lg w-full flex flex-col min-h-[min(640px,80vh)] items-center text-center">
          <div className="flex-1 w-full flex flex-col items-center">
            <AbexCoreLogo inverted size="lg" className="mb-8" />
            <p className="text-primary-100 text-lg leading-relaxed mb-8 max-w-md">{APP_TAGLINE}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
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
          <PoweredBy className="text-primary-200/80 mt-8 w-full" />
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 bg-transparent">
        <div className="lg:hidden text-center mb-6 w-full flex flex-col items-center">
          <AbexCoreLogo size="md" className="mb-2" />
        </div>

        <div className="w-full max-w-md">
          <div className="bg-white/90 backdrop-blur-xl rounded-2xl border border-white/60 shadow-panel overflow-hidden ring-1 ring-slate-900/[0.04]">
            <div className="h-1 bg-gradient-to-r from-primary-500 via-primary-600 to-accent-500" />
            <div className="p-8">
              <div className="text-center mb-8">
                {resolvedTenant && !needs2FA ? (
                  <div className="mx-auto mb-4 flex justify-center">
                    <CompanyLogoMark
                      logo={resolvedTenant.logo}
                      name={resolvedTenant.name}
                      companySlug={resolvedTenant.slug}
                      size="lg"
                    />
                  </div>
                ) : (
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-50 text-primary-600 ring-1 ring-primary-100">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                )}
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                  {needs2FA ? 'Two-factor authentication' : 'Sign in'}
                </h2>
                <p className="text-slate-500 mt-1.5 text-sm">
                  {needs2FA
                    ? 'Enter the 6-digit code from your authenticator app'
                    : resolvedTenant
                      ? `Sign in to ${resolvedTenant.name}`
                      : tenantLocked && tenantLoading
                        ? 'Loading workspace…'
                        : `Access your ${APP_NAME} workspace`}
                </p>
              </div>

              {!needs2FA ? (
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  {sessionExpired && (
                    <Alert variant="warning">
                      {sessionReason === 'inactive'
                        ? 'Your session expired due to inactivity. Please sign in again.'
                        : 'Your session expired. Please sign in again to continue.'}
                    </Alert>
                  )}
                  {tenantError && <Alert variant="error">{tenantError}</Alert>}
                  {validationError && <Alert variant="error">{validationError}</Alert>}
                  {loginError != null && (
                    <ApiErrorAlert error={loginError} compact onRetry={() => setLoginError(null)} />
                  )}

                  {tenantLocked ? (
                    <input type="hidden" {...register('companySlug')} />
                  ) : (
                    <Input
                      label="Company code *"
                      placeholder="e.g. your-company"
                      autoComplete="organization"
                      {...register('companySlug')}
                      error={errors.companySlug?.message}
                    />
                  )}

                  <Input
                    label="Email"
                    type="email"
                    autoComplete="username"
                    {...register('email')}
                    error={errors.email?.message}
                  />
                  <Input
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    {...register('password')}
                    error={errors.password?.message}
                  />
                  <Button type="submit" loading={loading || tenantLoading} className="w-full mt-2">
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
                  {validationError && <Alert variant="error">{validationError}</Alert>}
                  {loginError != null && (
                    <ApiErrorAlert error={loginError} compact onRetry={() => setLoginError(null)} />
                  )}
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

              {import.meta.env.DEV && !needs2FA && isPlatformLogin && (
                <p className="mt-6 text-center text-xs text-slate-400 border-t border-slate-100 pt-4">
                  Dev — company code <strong>owner</strong>, email <strong>kimutaicosmas547@gmail.com</strong> / password set in platform config
                  <br />
                  Direct URL: <strong>{platformLoginUrl}</strong>
                </p>
              )}
            </div>
          </div>

          <PoweredBy className="mt-4 hidden lg:block" />

          <p className="text-center text-xs text-slate-400 mt-2 hidden lg:block">
            Secure enterprise access
          </p>
        </div>
      </div>

      <div className="fixed bottom-0 inset-x-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none lg:hidden">
        <PoweredBy className="bg-slate-100/90 py-2" />
      </div>
    </div>
  );
}
