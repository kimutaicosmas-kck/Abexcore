import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi, authApi } from '../services/api';
import { PageHeader, Card, Button, Input, Alert, PageToolbar } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { CompanySettings } from '../types';

const tabs = ['Company Profile', 'Branches & Tax', 'Security'];

interface CompanyFormData {
  name: string;
  legalName?: string;
  registrationNo?: string;
  taxPin?: string;
  email?: string;
  phone?: string;
  address?: string;
  currency?: string;
  vatRate?: number;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [twoFaQr, setTwoFaQr] = useState<string | null>(null);
  const [twoFaToken, setTwoFaToken] = useState('');
  const [twoFaMessage, setTwoFaMessage] = useState('');

  const canUpdate = hasPermission('settings:update');

  const { data: company, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: () => settingsApi.company().then((r) => r.data.data as CompanySettings),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CompanyFormData>();

  useEffect(() => {
    if (company) {
      reset({
        name: company.name || '',
        legalName: company.legalName || '',
        registrationNo: company.registrationNo || '',
        taxPin: company.taxPin || '',
        email: company.email || '',
        phone: company.phone || '',
        address: company.address || '',
        currency: company.currency || 'KES',
        vatRate: Number(company.vatRate) || 16,
      });
    }
  }, [company, reset]);

  const mutation = useMutation({
    mutationFn: (data: CompanyFormData) => settingsApi.updateCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company'] });
      setSuccessMessage('Company settings saved successfully.');
      setTimeout(() => setSuccessMessage(''), 4000);
    },
  });

  return (
    <div>
      <PageHeader subtitle="Company profile, branches, and tax configuration" />

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 0 && (
        <Card title="Company Profile">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-3 max-w-xl">
              {successMessage && <Alert variant="success">{successMessage}</Alert>}
              {mutation.isError && <Alert variant="error">Failed to save settings. Please try again.</Alert>}

              <Input label="Company Name *" {...register('name', { required: 'Company name is required' })} error={errors.name?.message} disabled={!canUpdate} />
              <Input label="Legal Name" {...register('legalName')} disabled={!canUpdate} />
              <Input label="Registration No" {...register('registrationNo')} disabled={!canUpdate} />
              <Input label="Tax PIN" {...register('taxPin')} disabled={!canUpdate} />
              <Input label="Email" type="email" {...register('email')} disabled={!canUpdate} />
              <Input label="Phone" {...register('phone')} disabled={!canUpdate} />
              <Input label="Address" {...register('address')} disabled={!canUpdate} />
              <div className="grid grid-cols-2 gap-4">
                <Input label="Currency" {...register('currency')} disabled={!canUpdate} />
                <Input label="VAT Rate (%)" type="number" step="0.01" {...register('vatRate', { valueAsNumber: true })} disabled={!canUpdate} />
              </div>
              {canUpdate && <Button type="submit" loading={mutation.isPending}>Save Changes</Button>}
            </form>
          )}
        </Card>
      )}

      {activeTab === 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Branches">
            {company?.branches?.length ? company.branches.map((branch) => (
              <div key={branch.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="font-medium text-sm text-slate-900">{branch.name}</p>
                  <p className="text-xs text-slate-500">{branch.code} · {branch.city}</p>
                </div>
              </div>
            )) : <p className="text-slate-500 text-sm">No branches configured</p>}
          </Card>

          <Card title="Tax Rates">
            {company?.taxRates?.length ? company.taxRates.map((tax) => (
              <div key={tax.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <span className="text-slate-700">{tax.name}</span>
                <span className="font-medium text-slate-900">{tax.rate}% {tax.isDefault && '(Default)'}</span>
              </div>
            )) : <p className="text-slate-500 text-sm">No tax rates configured</p>}
          </Card>
        </div>
      )}

      {activeTab === 2 && (
        <Card title="Two-Factor Authentication">
          <p className="text-sm text-slate-600 mb-4">
            Protect your account with an authenticator app (Google Authenticator, Authy, etc.).
          </p>
          {!twoFaQr ? (
            <Button
              onClick={async () => {
                try {
                  const { data } = await authApi.setup2FA();
                  setTwoFaQr(data.data.qrCode);
                  setTwoFaMessage('Scan the QR code, then enter the 6-digit code below.');
                } catch {
                  setTwoFaMessage('Failed to start 2FA setup.');
                }
              }}
            >
              Enable 2FA
            </Button>
          ) : (
            <div className="space-y-4 max-w-sm">
              <img src={twoFaQr} alt="2FA QR code" className="rounded-lg border border-slate-200" />
              <Input
                label="Verification code"
                value={twoFaToken}
                onChange={(e) => setTwoFaToken(e.target.value)}
                inputMode="numeric"
                maxLength={6}
              />
              <Button
                onClick={async () => {
                  try {
                    await authApi.verify2FA(twoFaToken);
                    setTwoFaMessage('Two-factor authentication enabled.');
                    setTwoFaQr(null);
                    setTwoFaToken('');
                  } catch {
                    setTwoFaMessage('Invalid code. Try again.');
                  }
                }}
              >
                Confirm 2FA
              </Button>
            </div>
          )}
          {twoFaMessage && <p className="mt-3 text-sm text-slate-600">{twoFaMessage}</p>}
        </Card>
      )}
    </div>
  );
}
