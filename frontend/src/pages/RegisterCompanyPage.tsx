import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck, Upload, ImageIcon } from 'lucide-react';
import { tenantApi } from '../services/api';
import { Alert, Button, Input } from '../components/ui';
import { PoweredBy } from '../components/brand/PoweredBy';
import { ModuleAccessPicker } from '../components/forms/ModuleAccessPicker';
import { getApiErrorMessage } from '../utils/apiError';
import { useAuth } from '../contexts/AuthContext';
import {
  CompanyModulePreset,
  CORE_COMPANY_MODULES,
  PACKAGE_PRESET_OPTIONS,
  TRADING_COMPANY_MODULES,
  modulesForPreset,
} from '../utils/companyModules';

const registerSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  companySlug: z.string().min(2, 'Company code is required').max(48).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers, and hyphens only'),
  adminFirstName: z.string().min(1, 'First name is required'),
  adminLastName: z.string().min(1, 'Last name is required'),
  adminEmail: z.string().email('Invalid email'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().optional(),
});

type RegisterForm = z.infer<typeof registerSchema>;

export function RegisterCompanyPage() {
  const navigate = useNavigate();
  const { isPlatformOwner } = useAuth();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [modulePreset, setModulePreset] = useState<CompanyModulePreset>('manufacturing');
  const [customModules, setCustomModules] = useState<string[]>([...TRADING_COMPANY_MODULES]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, formState: { errors }, watch, setValue } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      companyName: '',
      companySlug: '',
      adminFirstName: '',
      adminLastName: '',
      adminEmail: '',
      adminPassword: '',
      phone: '',
    },
  });

  const companyName = watch('companyName');

  const onLogoChange = (file: File | null) => {
    setLogoFile(file);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(file ? URL.createObjectURL(file) : null);
  };

  const onSubmit = async (data: RegisterForm) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value != null && value !== '') formData.append(key, String(value));
      });
      formData.append('modulePreset', modulePreset);
      if (modulePreset === 'custom') {
        formData.append('enabledModules', JSON.stringify(modulesForPreset('custom', customModules)));
      }
      if (logoFile) formData.append('logo', logoFile);

      const res = await tenantApi.registerCompany(formData);
      const slug = res.data.data.company.slug as string;
      setSuccess(res.data.message || `Company registered. Admin signs in with code "${slug}".`);
      setTimeout(() => navigate('/account?tab=settings'), 2500);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (!isPlatformOwner) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <Alert variant="error">Only the platform owner can register new companies.</Alert>
        <div className="mt-4 text-center">
          <Link to="/" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
      <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Register new company</h1>
      </div>

      <div className="bg-white rounded-2xl border border-border shadow-soft overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-primary-500 to-primary-700" />
        <div className="p-8">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Input label="Company name *" {...register('companyName')} error={errors.companyName?.message} />
            <Input
              label="Company code *"
              placeholder="e.g. acme-trading"
              {...register('companySlug', {
                onBlur: () => {
                  if (!watch('companySlug') && companyName) {
                    setValue(
                      'companySlug',
                      companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
                    );
                  }
                },
              })}
              error={errors.companySlug?.message}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Package / modules *</p>
              <div className="space-y-2">
                {PACKAGE_PRESET_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                      modulePreset === opt.value
                        ? 'border-primary-300 bg-primary-50/60'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="modulePreset"
                      className="mt-1"
                      checked={modulePreset === opt.value}
                      onChange={() => {
                        setModulePreset(opt.value);
                        if (opt.value === 'custom') {
                          setCustomModules([...TRADING_COMPANY_MODULES]);
                        }
                      }}
                    />
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{opt.label}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {modulePreset === 'custom' && (
                <ModuleAccessPicker
                  value={customModules}
                  roleBaseline={[...CORE_COMPANY_MODULES]}
                  onChange={setCustomModules}
                  label="Included modules *"
                />
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Company logo (optional)</label>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo preview" className="h-full w-full object-contain" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-slate-400" />
                  )}
                </div>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => onLogoChange(e.target.files?.[0] || null)}
                  />
                  <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload logo
                  </Button>
                  {logoFile && (
                    <button
                      type="button"
                      className="block mt-2 text-xs text-slate-500 hover:text-slate-700"
                      onClick={() => {
                        onLogoChange(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Admin first name *" {...register('adminFirstName')} error={errors.adminFirstName?.message} />
              <Input label="Admin last name *" {...register('adminLastName')} error={errors.adminLastName?.message} />
            </div>
            <Input label="Admin email *" type="email" {...register('adminEmail')} error={errors.adminEmail?.message} />
            <Input label="Admin password *" type="password" {...register('adminPassword')} error={errors.adminPassword?.message} />
            <Input label="Phone (optional)" {...register('phone')} />

            <Button type="submit" loading={loading} className="w-full mt-2">
              <ShieldCheck className="h-4 w-4 mr-2" />
              Create company workspace
            </Button>
          </form>
        </div>
      </div>
      <PoweredBy />
    </div>
  );
}
