import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Card, Button, Input } from '../components/ui';

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
  const [successMessage, setSuccessMessage] = useState('');

  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: () => financeApi.company().then((r) => r.data.data),
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
    mutationFn: (data: CompanyFormData) => financeApi.updateCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company'] });
      setSuccessMessage('Company settings saved successfully.');
      setTimeout(() => setSuccessMessage(''), 4000);
    },
  });

  return (
    <div>
      <PageHeader title="Company Settings" subtitle="Company profile, branches, tax rates, and configuration" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Company Profile">
          <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
            {successMessage && (
              <div className="p-3 rounded-lg bg-green-50 text-green-700 text-sm">{successMessage}</div>
            )}
            {mutation.isError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                Failed to save settings. Please try again.
              </div>
            )}

            <Input label="Company Name *" {...register('name', { required: 'Company name is required' })} error={errors.name?.message} />
            <Input label="Legal Name" {...register('legalName')} />
            <Input label="Registration No" {...register('registrationNo')} />
            <Input label="Tax PIN" {...register('taxPin')} />
            <Input label="Email" type="email" {...register('email')} />
            <Input label="Phone" {...register('phone')} />
            <Input label="Address" {...register('address')} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Currency" {...register('currency')} />
              <Input label="VAT Rate (%)" type="number" step="0.01" {...register('vatRate', { valueAsNumber: true })} />
            </div>
            <Button type="submit" loading={mutation.isPending}>Save Changes</Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card title="Branches">
            {company?.branches?.map((branch: { id: string; name: string; code: string; city: string }) => (
              <div key={branch.id} className="flex justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium">{branch.name}</p>
                  <p className="text-sm text-gray-500">{branch.code} &middot; {branch.city}</p>
                </div>
              </div>
            )) || <p className="text-gray-500 text-sm">No branches configured</p>}
          </Card>

          <Card title="Tax Rates">
            {company?.taxRates?.map((tax: { id: string; name: string; rate: number; isDefault: boolean }) => (
              <div key={tax.id} className="flex justify-between py-2 border-b border-gray-100">
                <span>{tax.name}</span>
                <span className="font-medium">{tax.rate}% {tax.isDefault && '(Default)'}</span>
              </div>
            )) || <p className="text-gray-500 text-sm">No tax rates configured</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
