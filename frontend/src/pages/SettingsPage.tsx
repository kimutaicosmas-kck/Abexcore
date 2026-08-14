import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { settingsApi, authApi, tenantApi, usersApi, productsApi, inventoryApi } from '../services/api';
import { Card, Button, Input, Textarea, Alert, PageToolbar, EmptyState, Select, formatDate, formatDateTime } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';
import { CatalogManageItem, CompanySettings, RegisteredCompany, TenantTeamMember, WorkspaceSettings } from '../types';
import { CompanyLogoMark } from '../components/brand/CompanyBrand';
import { AbexCoreLogo } from '../components/brand/AbexCoreLogo';
import { buildTenantLoginPath, buildTenantLoginUrl } from '../utils/tenant';
import { PLATFORM_COMPANY_SLUG } from '../constants/platform';
import { CatalogListManager } from '../components/settings/CatalogListManager';
import { ServerMetricsPanel } from '../components/settings/ServerMetricsPanel';
import { ModuleAccessPicker } from '../components/forms/ModuleAccessPicker';
import { canAssignCompanySuperAdmin } from '../utils/superAdmin';
import {
  mergeRoleAndExtraModules,
  modulesForRoleName,
  resolveDepartmentIdFromModules,
} from '../utils/roleModules';
import { getApiErrorMessage } from '../utils/apiError';
import { RecycleBinPanel } from './RecycleBinPage';

const TRASH_ACCESS_PERMISSIONS = [
  'users:delete',
  'customers:delete',
  'products:delete',
  'hr:delete',
  'procurement:delete',
  'inventory:delete',
  'settings:read',
] as const;

const coreSettingsTabs = [
  'Company Profile',
  'Email',
  'Workspace',
  'Team',
  'Catalog',
  'Branches & Tax',
] as const;

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
  coopPaybillNumber?: string;
  mpesaAccountNumber?: string;
  welcomeMessage?: string;
}

interface InviteFormData {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  roleId: string;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { hasPermission, user, isPlatformOwner, isSuperAdmin, company: authCompany, setCompany } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const canAssignSuperAdmin = canAssignCompanySuperAdmin(user?.role?.name);
  const canAccessTrash = TRASH_ACCESS_PERMISSIONS.some((permission) => hasPermission(permission));
  const [activeTab, setActiveTab] = useState(0);
  const [successMessage, setSuccessMessage] = useState('');
  const [twoFaQr, setTwoFaQr] = useState<string | null>(null);
  const [twoFaToken, setTwoFaToken] = useState('');
  const [twoFaMessage, setTwoFaMessage] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [qualityEnabled, setQualityEnabled] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [resettingDemo, setResettingDemo] = useState(false);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [inviteModules, setInviteModules] = useState<string[]>(['dashboard']);
  const [inviteModuleError, setInviteModuleError] = useState('');

  const tabs = useMemo(() => {
    const items = isPlatformOwner
      ? ['Company Profile', 'Email', 'Workspace', 'Companies', 'Server', ...coreSettingsTabs.slice(3)]
      : [...coreSettingsTabs];
    if (canAccessTrash) items.push('Recycle Bin');
    items.push('Security');
    return items;
  }, [isPlatformOwner, canAccessTrash]);
  const activeTabName = tabs[activeTab] ?? tabs[0];

  useEffect(() => {
    if (searchParams.get('panel') !== 'recycle-bin') return;
    const idx = tabs.indexOf('Recycle Bin');
    if (idx >= 0) setActiveTab(idx);
  }, [searchParams, tabs]);

  const handleSettingsTabChange = (index: number) => {
    setActiveTab(index);
    const next = new URLSearchParams(searchParams);
    if (tabs[index] === 'Recycle Bin') next.set('panel', 'recycle-bin');
    else next.delete('panel');
    setSearchParams(next, { replace: true });
  };

  const canUpdate = hasPermission('settings:update');
  const canInvite = hasPermission('users:create');
  const canReadTeam = hasPermission('users:read');
  const canReadCatalog = hasPermission('products:read') || hasPermission('inventory:read');
  const canEditCategories = hasPermission('products:update') || hasPermission('products:create');
  const canEditMaterialTypes = hasPermission('inventory:update') || hasPermission('inventory:create');
  const twoFaEnabled = !!(user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled;

  const [emailHost, setEmailHost] = useState('smtp.gmail.com');
  const [emailPort, setEmailPort] = useState('587');
  const [emailSecure, setEmailSecure] = useState(false);
  const [emailUsername, setEmailUsername] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailFromEmail, setEmailFromEmail] = useState('');
  const [emailFromName, setEmailFromName] = useState('AbexCore ERP');
  const [emailActive, setEmailActive] = useState(true);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);

  const { data: company, isLoading } = useQuery({
    queryKey: ['company'],
    queryFn: () => settingsApi.company().then((r) => r.data.data as CompanySettings),
  });

  const { data: workspace, isLoading: workspaceLoading } = useQuery({
    queryKey: ['tenant-workspace'],
    queryFn: () => tenantApi.workspace().then((r) => r.data.data as WorkspaceSettings),
    enabled: activeTabName === 'Workspace',
  });

  const { data: team, isLoading: teamLoading } = useQuery({
    queryKey: ['tenant-team'],
    queryFn: () => tenantApi.team().then((r) => r.data.data as TenantTeamMember[]),
    enabled: activeTabName === 'Team' && canReadTeam,
  });

  const { data: registeredCompanies, isLoading: companiesLoading } = useQuery({
    queryKey: ['tenant-companies'],
    queryFn: () => tenantApi.listCompanies().then((r) => r.data.data as RegisteredCompany[]),
    enabled: activeTabName === 'Companies' && isPlatformOwner,
  });

  type EmailConfigStatus = {
    configured: boolean;
    source: 'company' | 'env' | 'none';
    effectiveSource?: 'company' | 'env' | 'none';
    effectiveFrom?: string | null;
    effectiveUsername?: string | null;
    hasPassword: boolean;
    envFallback: boolean;
    usingEnvDespiteCompanyConfig?: boolean;
    config: {
      host: string;
      port: number;
      secure: boolean;
      username: string;
      fromEmail: string;
      fromName: string;
      isActive: boolean;
    } | null;
  };

  const { data: emailStatus, isLoading: emailLoading } = useQuery({
    queryKey: ['tenant-email-config'],
    queryFn: () => tenantApi.emailConfig().then((r) => r.data.data as EmailConfigStatus),
    enabled: activeTabName === 'Email',
  });

  useEffect(() => {
    if (!emailStatus?.config) return;
    setEmailHost(emailStatus.config.host || 'smtp.gmail.com');
    setEmailPort(String(emailStatus.config.port || 587));
    setEmailSecure(!!emailStatus.config.secure);
    setEmailUsername(emailStatus.config.username || '');
    setEmailFromEmail(emailStatus.config.fromEmail || '');
    setEmailFromName(emailStatus.config.fromName || 'AbexCore ERP');
    setEmailActive(emailStatus.config.isActive !== false);
    setEmailPassword('');
  }, [emailStatus]);

  const { data: rolesResponse } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () =>
      usersApi.roles().then((r) => ({
        roles: r.data.data as { id: string; name: string }[],
        superAdminQuota: r.data.meta?.superAdminQuota ?? null,
      })),
    enabled: activeTabName === 'Team' && canInvite,
  });
  const rolesData = rolesResponse?.roles;
  const superAdminQuota = rolesResponse?.superAdminQuota;

  const { data: departmentsData } = useQuery({
    queryKey: ['user-departments'],
    queryFn: () => usersApi.departments().then((r) => r.data.data as { id: string; name: string }[]),
    enabled: activeTabName === 'Team' && canInvite,
  });

  const { data: productCategories, isLoading: categoriesLoading } = useQuery({
    queryKey: ['product-categories-manage'],
    queryFn: () => productsApi.manageCategories().then((r) => r.data.data as CatalogManageItem[]),
    enabled: activeTabName === 'Catalog' && hasPermission('products:read'),
  });

  const { data: materialTypes, isLoading: materialTypesLoading } = useQuery({
    queryKey: ['material-types-manage'],
    queryFn: () => inventoryApi.manageMaterialTypes().then((r) => r.data.data as CatalogManageItem[]),
    enabled: activeTabName === 'Catalog' && hasPermission('inventory:read'),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CompanyFormData>();
  const {
    register: registerInvite,
    handleSubmit: handleInviteSubmit,
    reset: resetInvite,
    watch: watchInvite,
    formState: { errors: inviteErrors },
  } = useForm<InviteFormData>({
    defaultValues: { email: '', firstName: '', lastName: '', password: '', roleId: '' },
  });

  const inviteRoleId = watchInvite('roleId');
  const inviteRoleName = (rolesData || []).find((r) => r.id === inviteRoleId)?.name || '';
  const inviteRoleBaseline = inviteRoleName ? modulesForRoleName(inviteRoleName) : ['dashboard'];

  useEffect(() => {
    if (!inviteRoleName) return;
    setInviteModules(modulesForRoleName(inviteRoleName));
    setInviteModuleError('');
  }, [inviteRoleName]);

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
        coopPaybillNumber: company.coopPaybillNumber || '',
        mpesaAccountNumber: company.mpesaAccountNumber || '',
        welcomeMessage: company.welcomeMessage || '',
      });
    }
  }, [company, reset]);

  useEffect(() => {
    if (workspace) {
      setQualityEnabled(workspace.qualityModuleEnabled);
    }
  }, [workspace]);

  const mutation = useMutation({
    mutationFn: (data: CompanyFormData) => settingsApi.updateCompany(data),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['company'] });
      if (authCompany) {
        setCompany({
          ...authCompany,
          name: variables.name,
          vatRate: variables.vatRate ?? authCompany.vatRate,
          welcomeMessage: variables.welcomeMessage?.trim() || null,
        });
      }
      setSuccessMessage('Company settings saved successfully.');
      setTimeout(() => setSuccessMessage(''), 4000);
    },
  });

  const workspaceMutation = useMutation({
    mutationFn: (data: { qualityModuleEnabled: boolean }) => tenantApi.updateWorkspace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-workspace'] });
      queryClient.invalidateQueries({ queryKey: ['company'] });
      setSuccessMessage('Workspace settings saved.');
      setTimeout(() => setSuccessMessage(''), 4000);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantApi.inviteUser(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-team'] });
      resetInvite();
      setInviteModules(['dashboard', 'sales']);
      setInviteModuleError('');
      setSuccessMessage(res.data.message || 'User invited successfully.');
      setEmailError(res.data.emailSent === false ? 'Invite saved, but email was not delivered. Configure Settings → Email (SMTP) or share login details manually.' : '');
      setTimeout(() => setSuccessMessage(''), 8000);
    },
  });

  const companyStatusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      tenantApi.updateCompanyStatus(id, isActive),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-companies'] });
      const name = res.data.data?.name || 'Company';
      setSuccessMessage(
        res.data.data?.isActive ? `${name} has been reactivated.` : `${name} has been deactivated.`
      );
      setTimeout(() => setSuccessMessage(''), 4000);
    },
    onSettled: () => setStatusUpdatingId(null),
  });

  const deleteCompanyMutation = useMutation({
    mutationFn: ({ id, confirmSlug }: { id: string; confirmSlug: string }) =>
      tenantApi.deleteCompany(id, confirmSlug),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tenant-companies'] });
      setSuccessMessage(res.data.message || 'Company deleted permanently.');
      setTimeout(() => setSuccessMessage(''), 5000);
    },
    onSettled: () => setDeletingCompanyId(null),
  });

  const resetDemoMutation = useMutation({
    mutationFn: (confirmSlug: string) => tenantApi.resetDemoWorkspace(confirmSlug),
    onSuccess: (res) => {
      queryClient.invalidateQueries();
      setSuccessMessage(res.data.message || 'Demo workspace reset complete.');
      setTimeout(() => setSuccessMessage(''), 6000);
    },
    onSettled: () => setResettingDemo(false),
  });

  const seedDemoMutation = useMutation({
    mutationFn: () => tenantApi.seedDemoData(),
    onSuccess: (res) => {
      queryClient.invalidateQueries();
      setSuccessMessage(res.data.message || 'Demo test data loaded.');
      setTimeout(() => setSuccessMessage(''), 6000);
    },
    onSettled: () => setSeedingDemo(false),
  });

  const toggleCompanyStatus = (company: RegisteredCompany) => {
    const nextActive = !company.isActive;
    const action = nextActive ? 'reactivate' : 'deactivate';
    if (!window.confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} "${company.name}"? Users will ${nextActive ? 'be able to' : 'not be able to'} sign in.`)) {
      return;
    }
    setStatusUpdatingId(company.id);
    companyStatusMutation.mutate({ id: company.id, isActive: nextActive });
  };

  const deleteCompanyPermanently = (entry: RegisteredCompany) => {
    const typed = window.prompt(
      `This permanently deletes "${entry.name}" and ALL its data (users, products, orders, invoices, etc.).\n\nType the company code "${entry.slug}" to confirm:`
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== entry.slug.toLowerCase()) {
      window.alert('Company code did not match. Delete cancelled.');
      return;
    }
    setDeletingCompanyId(entry.id);
    deleteCompanyMutation.mutate({ id: entry.id, confirmSlug: entry.slug });
  };

  const resetDemoWorkspace = () => {
    if (!workspace) return;
    const typed = window.prompt(
      `This removes ALL demo data from your AbexCore workspace (products, customers, orders, invoices, inventory, demo users, etc.).\n\nYour login, company profile, branches, and warehouses are kept.\n\nType "${workspace.slug}" to confirm:`
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== workspace.slug.toLowerCase()) {
      window.alert('Company code did not match. Reset cancelled.');
      return;
    }
    setResettingDemo(true);
    resetDemoMutation.mutate(workspace.slug);
  };

  const copyLoginUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    setSuccessMessage('');
    setLogoError('');
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const { data } = await tenantApi.uploadLogo(formData);
      queryClient.invalidateQueries({ queryKey: ['company'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-workspace'] });
      if (authCompany && data.data) {
        setCompany({ ...authCompany, logo: data.data.logo, name: data.data.name });
      }
      setSuccessMessage('Company logo updated.');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch {
      setSuccessMessage('');
      setLogoError('Failed to upload logo. Use PNG, JPG, WEBP, or SVG under 2MB.');
    } finally {
      setLogoUploading(false);
    }
  };

  const displayLogo = authCompany?.logo ?? company?.logo;

  const submitInvite = (data: InviteFormData) => {
    if (!data.roleId || !inviteRoleName) {
      setInviteModuleError('Select a role for this user.');
      return;
    }
    const modules = mergeRoleAndExtraModules(inviteRoleName, inviteModules);
    setInviteModuleError('');
    const departmentId = resolveDepartmentIdFromModules(modules, departmentsData || []);
    inviteMutation.mutate({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      password: data.password,
      roleId: data.roleId,
      departmentId,
      modules,
    });
  };

  const subdomainLoginUrl = workspace ? buildTenantLoginUrl(workspace.slug) : '';
  const pathLoginUrl = workspace
    ? `${window.location.origin}${buildTenantLoginPath(workspace.slug)}`
    : '';

  return (
    <div className="space-y-4">
      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={handleSettingsTabChange} />

      {activeTabName === 'Company Profile' && (
        <Card title="Company Profile">
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-3 max-w-xl">
              {successMessage && <Alert variant="success">{successMessage}</Alert>}
              {logoError && <Alert variant="error">{logoError}</Alert>}
              {mutation.isError && <Alert variant="error">Failed to save settings. Please try again.</Alert>}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {isPlatformOwner ? 'Platform logo' : 'Company logo'}
                </label>
                <div className="flex items-center gap-4">
                  {isPlatformOwner ? (
                    <AbexCoreLogo variant="mark" size="lg" />
                  ) : (
                    <CompanyLogoMark logo={displayLogo} name={company?.name || authCompany?.name} size="lg" />
                  )}
                  {canUpdate && !isPlatformOwner && (
                    <label className="inline-flex">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        disabled={logoUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadLogo(file);
                          e.target.value = '';
                        }}
                      />
                      <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                        <Upload className="h-4 w-4" />
                        {logoUploading ? 'Uploading…' : 'Change logo'}
                      </span>
                    </label>
                  )}
                </div>
              </div>

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
              <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Document payment block (Lipa na M-Pesa)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Paybill number"
                    placeholder="e.g. 400200"
                    {...register('coopPaybillNumber')}
                    disabled={!canUpdate}
                  />
                  <Input
                    label="Account number"
                    placeholder="e.g. 40098634"
                    {...register('mpesaAccountNumber')}
                    disabled={!canUpdate}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-primary-100 bg-primary-50/40 p-4 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Login welcome message</p>
                <Textarea
                  label="Welcome message"
                  rows={3}
                  maxLength={280}
                  placeholder="e.g. Welcome to Acme Filters. Quality production starts here."
                  {...register('welcomeMessage')}
                  disabled={!canUpdate}
                />
              </div>
              {canUpdate && <Button type="submit" loading={mutation.isPending}>Save Changes</Button>}
            </form>
          )}
        </Card>
      )}

      {activeTabName === 'Workspace' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {isPlatformOwner && (
            <Card title="Platform administration" className="lg:col-span-2">
              <Link to="/admin/register-company">
                <Button type="button">Register new company</Button>
              </Link>
            </Card>
          )}

          {isPlatformOwner && (
            <Card title="Demo test data" className="lg:col-span-2 border-emerald-200 bg-emerald-50/40">
              {seedDemoMutation.isError && (
                <Alert variant="error" className="mb-3">
                  {getApiErrorMessage(seedDemoMutation.error)}
                </Alert>
              )}
              <Button type="button" loading={seedingDemo} onClick={() => { setSeedingDemo(true); seedDemoMutation.mutate(); }}>
                Load demo test data
              </Button>
              <p className="text-xs text-slate-500 mt-2">
                Demo team users (if created) use password <code className="font-mono">Demo@12345!</code>
              </p>
            </Card>
          )}

          {isPlatformOwner && (
            <Card title="Reset demo workspace" className="lg:col-span-2 border-amber-200 bg-amber-50/40">
              {resetDemoMutation.isError && (
                <Alert variant="error" className="mb-3">
                  {(resetDemoMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message
                    || 'Failed to reset demo workspace. Please try again.'}
                </Alert>
              )}
              <Button type="button" variant="danger" loading={resettingDemo} onClick={resetDemoWorkspace}>
                Reset demo workspace
              </Button>
            </Card>
          )}

          <Card title="Workspace">
            {workspaceLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : workspace ? (
              <div className="space-y-4">
                {successMessage && <Alert variant="success">{successMessage}</Alert>}
                {workspaceMutation.isError && <Alert variant="error">Failed to save workspace settings.</Alert>}

                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Company code</p>
                  <p className="text-lg font-semibold text-slate-900 mt-1">{workspace.slug}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Direct login URLs</p>
                  {[subdomainLoginUrl, pathLoginUrl].filter(Boolean).map((url) => (
                    <div key={url} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <code className="text-xs text-slate-700 break-all flex-1">{url}</code>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => copyLoginUrl(url)}
                        aria-label="Copy login URL"
                      >
                        {copiedUrl === url ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">Team members</p>
                    <p className="text-xl font-semibold text-slate-900">{workspace.userCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">Active users</p>
                    <p className="text-xl font-semibold text-slate-900">{workspace.activeUsers}</p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState title="Workspace unavailable" description="Could not load workspace settings." />
            )}
          </Card>

          <Card title="Modules">
            {workspaceLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="space-y-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-border"
                    checked={qualityEnabled}
                    onChange={(e) => setQualityEnabled(e.target.checked)}
                    disabled={!canUpdate}
                  />
                  <span>
                    <span className="block text-sm font-medium text-slate-900">Quality module</span>
                  </span>
                </label>
                {canUpdate && (
                  <Button
                    type="button"
                    loading={workspaceMutation.isPending}
                    onClick={() => workspaceMutation.mutate({ qualityModuleEnabled: qualityEnabled })}
                  >
                    Save module settings
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTabName === 'Companies' && isPlatformOwner && (
        <Card title="Registered companies">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <Link to="/admin/register-company">
              <Button type="button">Register new company</Button>
            </Link>
          </div>

          {successMessage && <Alert variant="success" className="mb-4">{successMessage}</Alert>}
          {companyStatusMutation.isError && (
            <Alert variant="error" className="mb-4">Failed to update company status. Please try again.</Alert>
          )}
          {deleteCompanyMutation.isError && (
            <Alert variant="error" className="mb-4">
              {(deleteCompanyMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message
                || 'Failed to delete company. Please try again.'}
            </Alert>
          )}

          {companiesLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : registeredCompanies?.length ? (
            <div className="table-scroll-x -mx-1">
              <table className="min-w-max w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 px-2 font-medium">Company</th>
                    <th className="py-2 px-2 font-medium">Code</th>
                    <th className="py-2 px-2 font-medium">Users</th>
                    <th className="py-2 px-2 font-medium">Registered</th>
                    <th className="py-2 px-2 font-medium">Status</th>
                    <th className="py-2 px-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {registeredCompanies.map((entry) => {
                    const isPlatformCompany = entry.slug === PLATFORM_COMPANY_SLUG;
                    return (
                      <tr key={entry.id}>
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <CompanyLogoMark logo={entry.logo} name={entry.name} companySlug={entry.slug} size="sm" />
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900 truncate">{entry.name}</p>
                              {entry.email && <p className="text-xs text-slate-500 truncate">{entry.email}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-2 font-mono text-xs text-slate-700">{entry.slug}</td>
                        <td className="py-3 px-2 text-slate-700">{entry.userCount}</td>
                        <td className="py-3 px-2 text-slate-500 whitespace-nowrap">{formatDate(entry.createdAt)}</td>
                        <td className="py-3 px-2">
                          <span
                            className={
                              entry.isActive
                                ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                                : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'
                            }
                          >
                            {entry.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right">
                          {isPlatformCompany ? (
                            <span className="text-xs text-slate-400">Platform owner</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                variant={entry.isActive ? 'ghost' : 'secondary'}
                                size="sm"
                                loading={statusUpdatingId === entry.id}
                                onClick={() => toggleCompanyStatus(entry)}
                              >
                                {entry.isActive ? 'Deactivate' : 'Reactivate'}
                              </Button>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                loading={deletingCompanyId === entry.id}
                                onClick={() => deleteCompanyPermanently(entry)}
                              >
                                Delete
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No companies registered"
              description="Register the first company workspace to get started."
            />
          )}
        </Card>
      )}

      {activeTabName === 'Server' && isPlatformOwner && <ServerMetricsPanel />}

      {activeTabName === 'Team' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {canInvite && (
            <Card title="Invite team member">
              <form onSubmit={handleInviteSubmit(submitInvite)} className="space-y-3" autoComplete="off">
                {successMessage && <Alert variant="success">{successMessage}</Alert>}
                {inviteMutation.isError && (
                  <Alert variant="error">{getApiErrorMessage(inviteMutation.error)}</Alert>
                )}

                <Input
                  label="Email *"
                  type="email"
                  autoComplete="off"
                  {...registerInvite('email', { required: 'Email is required' })}
                  error={inviteErrors.email?.message}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="First name *"
                    autoComplete="off"
                    {...registerInvite('firstName', { required: 'Required' })}
                    error={inviteErrors.firstName?.message}
                  />
                  <Input
                    label="Last name *"
                    autoComplete="off"
                    {...registerInvite('lastName', { required: 'Required' })}
                    error={inviteErrors.lastName?.message}
                  />
                </div>
                <Select
                  label="Role *"
                  options={[
                    { value: '', label: 'Select role…' },
                    ...(rolesData || [])
                      .filter((r) => {
                        if (r.name !== 'Super Admin') return true;
                        if (!canAssignSuperAdmin) return false;
                        return !superAdminQuota || superAdminQuota.remaining > 0;
                      })
                      .map((r) => ({
                        value: r.id,
                        label:
                          r.name === 'Super Admin'
                            ? `Super Admin — this company${
                                superAdminQuota
                                  ? ` (${superAdminQuota.used}/${superAdminQuota.max})`
                                  : ' (max 2)'
                              }`
                            : r.name,
                      })),
                  ]}
                  {...registerInvite('roleId', { required: 'Role is required' })}
                  error={inviteErrors.roleId?.message}
                />
                {canAssignSuperAdmin && (
                  <p className="text-xs text-slate-500 -mt-1">
                    {superAdminQuota
                      ? `This company Super Admin seats: ${superAdminQuota.used} of ${superAdminQuota.max}${
                          superAdminQuota.remaining === 0 ? ' · limit reached for this company' : ''
                        }`
                      : 'Each company may have up to 2 Super Admins (not shared across tenants).'}
                  </p>
                )}
                <ModuleAccessPicker
                  value={inviteModules}
                  roleBaseline={inviteRoleBaseline}
                  onChange={(next) =>
                    setInviteModules(mergeRoleAndExtraModules(inviteRoleName || 'Sales Executive', next))
                  }
                  error={inviteModuleError}
                />
                <Input
                  label="Temporary password *"
                  type="password"
                  autoComplete="new-password"
                  {...registerInvite('password', { required: 'Password is required', minLength: { value: 8, message: 'At least 8 characters' } })}
                  error={inviteErrors.password?.message}
                />
                <Button type="submit" loading={inviteMutation.isPending}>Send invite</Button>
              </form>
            </Card>
          )}

          <Card title="Team" className={canInvite ? '' : 'lg:col-span-2'}>
            {!canReadTeam ? (
              <EmptyState title="No access" description="You do not have permission to view team members." />
            ) : teamLoading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : team?.length ? (
              <div className="divide-y divide-slate-100">
                {team.map((member) => (
                  <div key={member.id} className="flex items-center justify-between py-3 gap-3">
                    <div>
                      <p className="font-medium text-sm text-slate-900">
                        {member.firstName} {member.lastName}
                      </p>
                      <p className="text-xs text-slate-500">{member.email} · {member.role.name}</p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>{member.status}</p>
                      <p>{member.lastLoginAt ? `Last login ${formatDate(member.lastLoginAt)}` : 'Never signed in'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No team members yet" description="Invite your first user using the form." />
            )}
          </Card>
        </div>
      )}

      {activeTabName === 'Catalog' && (
        !canReadCatalog ? (
          <Card title="Catalog">
            <EmptyState title="No access" description="You do not have permission to manage catalog settings." />
          </Card>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {hasPermission('products:read') && (
              <Card title="Product categories">
                <CatalogListManager
                  items={productCategories || []}
                  loading={categoriesLoading}
                  canEdit={canEditCategories}
                  addLabel="Add category"
                  emptyLabel="e.g. Electronics, Apparel, Spare Parts"
                  usageLabel="products"
                  queryKey={['product-categories-manage']}
                  invalidateKeys={[['product-categories']]}
                  onAdd={(name) => productsApi.createCategory({ name }).then((r) => r.data)}
                  onUpdate={(id, data) => productsApi.updateCategory(id, data).then((r) => r.data)}
                  onReorder={(ids) => productsApi.reorderCategories(ids).then((r) => r.data)}
                  canDeactivate={isSuperAdmin}
                  onDeactivate={(id) => productsApi.deactivateCategory(id).then((r) => r.data)}
                />
              </Card>
            )}

            {hasPermission('inventory:read') && (
              <Card title="Material types">
                <CatalogListManager
                  items={materialTypes || []}
                  loading={materialTypesLoading}
                  canEdit={canEditMaterialTypes}
                  addLabel="Add material type"
                  emptyLabel="e.g. Fabric, Chemical, Hardware"
                  usageLabel="materials"
                  queryKey={['material-types-manage']}
                  invalidateKeys={[['material-types']]}
                  onAdd={(name) => inventoryApi.createMaterialType({ name }).then((r) => r.data)}
                  onUpdate={(id, data) => inventoryApi.updateMaterialType(id, data).then((r) => r.data)}
                  onReorder={(ids) => inventoryApi.reorderMaterialTypes(ids).then((r) => r.data)}
                />
              </Card>
            )}
          </div>
        )
      )}

      {activeTabName === 'Branches & Tax' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Branches">
            {company?.branches?.length ? company.branches.map((branch) => (
              <div key={branch.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <p className="font-medium text-sm text-slate-900">{branch.name}</p>
                  <p className="text-xs text-slate-500">{branch.code} · {branch.city}</p>
                </div>
              </div>
            )) : (
              <EmptyState title="No branches configured" description="Branches are set up during system seeding or by your administrator." />
            )}
          </Card>

          <Card title="Tax Rates">
            {company?.taxRates?.length ? company.taxRates.map((tax) => (
              <div key={tax.id} className="flex justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
                <span className="text-slate-700">{tax.name}</span>
                <span className="font-medium text-slate-900">{tax.rate}% {tax.isDefault && '(Default)'}</span>
              </div>
            )) : (
              <EmptyState title="No tax rates configured" description="Tax rates are defined during company setup." />
            )}
          </Card>
        </div>
      )}

      {activeTabName === 'Email' && (
        <Card title="Email notifications (SMTP)">
          {emailLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <form
              className="space-y-3 max-w-xl"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!canUpdate) return;
                setEmailError('');
                setEmailMessage('');
                setEmailSaving(true);
                try {
                  await tenantApi.updateEmailConfig({
                    host: emailHost.trim(),
                    port: Number(emailPort) || 587,
                    secure: emailSecure || Number(emailPort) === 465,
                    username: emailUsername.trim(),
                    ...(emailPassword.trim() ? { password: emailPassword } : {}),
                    fromEmail: emailFromEmail.trim(),
                    fromName: emailFromName.trim(),
                    isActive: emailActive,
                  });
                  setEmailPassword('');
                  await queryClient.invalidateQueries({ queryKey: ['tenant-email-config'] });
                  setEmailMessage('Email settings saved. Send a test email to confirm delivery.');
                } catch (err) {
                  setEmailError(getApiErrorMessage(err) || 'Failed to save email settings.');
                } finally {
                  setEmailSaving(false);
                }
              }}
            >
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3.5 py-3 text-sm">
                <p className="font-medium text-slate-900">
                  Status:{' '}
                  {emailStatus?.configured ? (
                    <span className="text-emerald-700">
                      Ready ({emailStatus.effectiveSource === 'company' ? 'company SMTP' : 'server .env on server'})
                    </span>
                  ) : (
                    <span className="text-amber-700">Not configured — notifications stay in-app only</span>
                  )}
                </p>
                {emailStatus?.effectiveFrom && (
                  <p className="text-xs text-slate-600 mt-1">
                    Currently sending as: <strong>{emailStatus.effectiveFrom}</strong>
                  </p>
                )}
                {emailStatus?.usingEnvDespiteCompanyConfig && (
                  <p className="text-xs text-amber-800 mt-1">
                    Company SMTP is saved but not in use. Re-save with the App Password, or update{' '}
                    <code className="text-[11px]">SMTP_*</code> in the server <code className="text-[11px]">.env</code>.
                  </p>
                )}
                {emailStatus?.envFallback && emailStatus.effectiveSource === 'env' && (
                  <p className="text-xs text-amber-800 mt-1">
                    Using server <code className="text-[11px]">.env</code> SMTP — change{' '}
                    <code className="text-[11px]">SMTP_USER</code> /{' '}
                    <code className="text-[11px]">SMTP_FROM</code> on Contabo, or save company SMTP below.
                  </p>
                )}
              </div>

              {emailMessage && <Alert variant="success">{emailMessage}</Alert>}
              {emailError && <Alert variant="error">{emailError}</Alert>}

              <Input
                label="SMTP host"
                value={emailHost}
                onChange={(e) => setEmailHost(e.target.value)}
                placeholder="smtp.gmail.com"
                disabled={!canUpdate}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Port"
                  type="number"
                  value={emailPort}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEmailPort(next);
                    if (Number(next) === 587) setEmailSecure(false);
                    if (Number(next) === 465) setEmailSecure(true);
                  }}
                  disabled={!canUpdate}
                  required
                />
                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Number(emailPort) === 465 ? true : Number(emailPort) === 587 ? false : emailSecure}
                      onChange={(e) => setEmailSecure(e.target.checked)}
                      disabled={!canUpdate || Number(emailPort) === 587 || Number(emailPort) === 465}
                    />
                    Use SSL (only for port 465)
                  </label>
                </div>
              </div>
              <Input
                label="SMTP username"
                value={emailUsername}
                onChange={(e) => {
                  const next = e.target.value;
                  setEmailUsername(next);
                  if (
                    !emailFromEmail ||
                    emailFromEmail.toLowerCase() === emailUsername.toLowerCase()
                  ) {
                    setEmailFromEmail(next);
                  }
                }}
                placeholder="you@company.com"
                disabled={!canUpdate}
                required
              />
              <Input
                label={
                  emailStatus?.hasPassword
                    ? 'SMTP / App password (paste again if login was rejected)'
                    : 'SMTP / App password'
                }
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="16-character Google App Password"
                disabled={!canUpdate}
                required={!emailStatus?.hasPassword}
              />
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Creating an App Password in Google only generates the code once. You must paste that
                16-character password into this field and click <strong>Save email settings</strong>,
                then <strong>Send test email</strong>. Leaving this blank keeps the old (wrong) password.
              </p>
              <Input
                label="From name"
                value={emailFromName}
                onChange={(e) => setEmailFromName(e.target.value)}
                disabled={!canUpdate}
                required
              />
              <Input
                label="From email"
                type="email"
                value={emailFromEmail}
                onChange={(e) => setEmailFromEmail(e.target.value)}
                placeholder="noreply@company.com"
                disabled={!canUpdate}
                required
              />
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={emailActive}
                  onChange={(e) => setEmailActive(e.target.checked)}
                  disabled={!canUpdate}
                />
                Send email notifications (active)
              </label>

              {canUpdate && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="submit" loading={emailSaving}>
                    Save email settings
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    loading={emailTesting}
                    disabled={!emailStatus?.configured && !emailStatus?.hasPassword}
                    onClick={async () => {
                      setEmailError('');
                      setEmailMessage('');
                      setEmailTesting(true);
                      try {
                        const { data } = await tenantApi.testEmailConfig(user?.email);
                        setEmailMessage(data.message || `Test email sent to ${user?.email}`);
                      } catch (err) {
                        setEmailError(getApiErrorMessage(err) || 'Test email failed.');
                      } finally {
                        setEmailTesting(false);
                      }
                    }}
                  >
                    Send test email
                  </Button>
                </div>
              )}
            </form>
          )}
        </Card>
      )}

      {activeTabName === 'Recycle Bin' && canAccessTrash && <RecycleBinPanel />}

      {activeTabName === 'Security' && (
        <Card title="Two-Factor Authentication">
          <p className="text-sm text-slate-600 mb-4">
            Status: <span className="font-semibold text-slate-900">{twoFaEnabled ? 'Enabled' : 'Not enabled'}</span>
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
