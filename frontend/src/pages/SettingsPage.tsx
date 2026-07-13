import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Card, Button, Input } from '../components/ui';

export function SettingsPage() {
  const { data: company } = useQuery({
    queryKey: ['company'],
    queryFn: () => financeApi.company().then((r) => r.data.data),
  });

  return (
    <div>
      <PageHeader title="Company Settings" subtitle="Company profile, branches, tax rates, and configuration" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Company Profile">
          <div className="space-y-4">
            <Input label="Company Name" defaultValue={company?.name || ''} />
            <Input label="Legal Name" defaultValue={company?.legalName || ''} />
            <Input label="Registration No" defaultValue={company?.registrationNo || ''} />
            <Input label="Tax PIN" defaultValue={company?.taxPin || ''} />
            <Input label="Email" defaultValue={company?.email || ''} />
            <Input label="Phone" defaultValue={company?.phone || ''} />
            <Input label="Address" defaultValue={company?.address || ''} />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Currency" defaultValue={company?.currency || 'KES'} />
              <Input label="VAT Rate (%)" defaultValue={company?.vatRate || 16} type="number" />
            </div>
            <Button>Save Changes</Button>
          </div>
        </Card>

        <div className="space-y-6">
          <Card title="Branches">
            {company?.branches?.map((branch: { id: string; name: string; code: string; city: string }) => (
              <div key={branch.id} className="flex justify-between py-2 border-b border-gray-100">
                <div>
                  <p className="font-medium">{branch.name}</p>
                  <p className="text-sm text-gray-500">{branch.code} &middot; {branch.city}</p>
                </div>
                <Button size="sm" variant="ghost">Edit</Button>
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
