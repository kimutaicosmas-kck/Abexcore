import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  UserCheck,
  UserX,
  Shield,
  Search,
  ChevronRight,
  UserPlus,
  ScrollText,
} from 'lucide-react';
import { usersApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  StatCard,
  StatGrid,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatDate,
  formatDateTime,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { UserForm } from '../components/forms/UserForm';
import { useAuth } from '../contexts/AuthContext';
import { AuditLogEntry, RoleWithPermissions, User, UserStats } from '../types';

const tabs = ['Users', 'Roles & Permissions', 'Audit Log'];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

function statusBadgeVariant(status: string) {
  if (status === 'ACTIVE') return 'success';
  if (status === 'SUSPENDED') return 'warning';
  return 'danger';
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');

  const [formModalOpen, setFormModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  const canCreate = hasPermission('users:create');
  const canUpdate = hasPermission('users:update');
  const canDelete = hasPermission('users:delete');

  const { data: stats } = useQuery({
    queryKey: ['user-stats'],
    queryFn: () => usersApi.stats().then((r) => r.data.data as UserStats),
  });

  const { data: rolesResponse } = useQuery({
    queryKey: ['user-roles'],
    queryFn: () =>
      usersApi.roles().then((r) => ({
        roles: r.data.data as RoleWithPermissions[],
        superAdminQuota: r.data.meta?.superAdminQuota ?? null,
      })),
    enabled: activeTab <= 1,
  });
  const rolesData = rolesResponse?.roles;

  const roleFilterOptions = [
    { value: '', label: 'All roles' },
    ...(rolesData || []).map((r) => ({ value: r.id, label: r.name })),
  ];

  const { data: usersRes, isLoading, isError, refetch } = useQuery({
    queryKey: ['users', page, search, statusFilter, roleFilter],
    queryFn: () =>
      usersApi
        .list({
          page,
          limit: 15,
          search: search || undefined,
          status: statusFilter || undefined,
          roleId: roleFilter || undefined,
        })
        .then((r) => r.data),
    enabled: activeTab === 0,
  });

  const { data: userDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['user-detail', selectedUser?.id],
    queryFn: () => usersApi.get(selectedUser!.id).then((r) => r.data.data as User),
    enabled: !!selectedUser && detailModalOpen,
  });

  const { data: auditRes, isLoading: auditLoading } = useQuery({
    queryKey: ['user-audit-logs', auditPage, auditSearch],
    queryFn: () =>
      usersApi
        .auditLogs({ page: auditPage, limit: 20, search: auditSearch || undefined })
        .then((r) => r.data),
    enabled: activeTab === 2,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-stats'] });
      setDeactivateModalOpen(false);
      setDetailModalOpen(false);
      setSelectedUser(null);
    },
  });

  const goToTab = (index: number) => setActiveTab(index);

  const openCreate = () => {
    setEditing(null);
    setFormModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setFormModalOpen(true);
    setDetailModalOpen(false);
  };

  const openDetail = (user: User) => {
    setSelectedUser(user);
    setDetailModalOpen(true);
  };

  const closeFormModal = () => {
    setFormModalOpen(false);
    setEditing(null);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const userColumns = [
    {
      key: 'name',
      label: 'Name',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium text-slate-900">{row.firstName as string} {row.lastName as string}</p>
          <p className="text-xs text-slate-500">{row.email as string}</p>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.role as { name: string })?.name || '-',
    },
    {
      key: 'employee',
      label: 'Employee',
      render: (_: unknown, row: Record<string, unknown>) => {
        const emp = (row as { employee?: User['employee'] }).employee;
        if (emp) {
          return <Badge variant="success">{emp.employeeNo}</Badge>;
        }
        return <Badge variant="warning">Not linked</Badge>;
      },
    },
    {
      key: 'department',
      label: 'Department',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.department as { name: string })?.name || '-',
    },
    {
      key: 'branch',
      label: 'Branch',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.branch as { code: string })?.code || '-',
    },
    {
      key: 'lastLoginAt',
      label: 'Last Login',
      render: (val: unknown) => (val ? formatDate(val as string) : 'Never'),
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={statusBadgeVariant(val as string)}>{val as string}</Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canUpdate && (
            <Button size="sm" variant="ghost" onClick={() => openEdit(row as unknown as User)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && row.id !== currentUser?.id && row.status === 'ACTIVE' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedUser(row as unknown as User);
                setDeactivateModalOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const auditColumns = [
    {
      key: 'createdAt',
      label: 'Timestamp',
      render: (val: unknown) => formatDateTime(val as string),
    },
    {
      key: 'user',
      label: 'User',
      render: (_: unknown, row: Record<string, unknown>) => {
        const u = row.user as { firstName: string; lastName: string; email: string } | undefined;
        return u ? `${u.firstName} ${u.lastName}` : 'System';
      },
    },
    { key: 'module', label: 'Module' },
    { key: 'action', label: 'Action' },
    { key: 'entityType', label: 'Entity' },
    {
      key: 'entityId',
      label: 'Entity ID',
      render: (val: unknown) => (
        <span className="font-mono text-xs text-slate-500">{(val as string)?.slice(0, 8) || '-'}…</span>
      ),
    },
  ];

  const toolbarActions =
    canCreate &&
    (activeTab === 0 ? (
      <Button size="sm" onClick={openCreate}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add User
      </Button>
    ) : undefined);

  return (
    <div className="space-y-4">
      {stats && (
        <StatGrid>
          <StatCard title="Total Users" value={stats.total} icon={<Users className="h-5 w-5 text-white" />} color="from-blue-500 to-blue-700" onClick={() => goToTab(0)} />
          <StatCard title="Active" value={stats.active} icon={<UserCheck className="h-5 w-5 text-white" />} color="from-lime-500 to-lime-700" onClick={() => { setStatusFilter('ACTIVE'); setPage(1); goToTab(0); }} />
          <StatCard title="Inactive / Suspended" value={stats.inactive + stats.suspended} icon={<UserX className="h-5 w-5 text-white" />} color="from-pink-500 to-pink-700" onClick={() => { setStatusFilter('INACTIVE'); setPage(1); goToTab(0); }} />
          <StatCard title="Logged In (7d)" value={stats.recentLogins} icon={<Shield className="h-5 w-5 text-white" />} color="from-amber-500 to-amber-700" onClick={() => goToTab(0)} />
          <StatCard title="Roles" value={stats.byRole.length} icon={<ScrollText className="h-5 w-5 text-white" />} color="from-slate-500 to-slate-700" onClick={() => goToTab(1)} />
        </StatGrid>
      )}

      <PageHeader
        action={
          stats && stats.inactive + stats.suspended > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => { setStatusFilter('INACTIVE'); setPage(1); goToTab(0); }}>
              <UserX className="h-4 w-4 mr-1.5 text-red-500" />
              {stats.inactive + stats.suspended} inactive
            </Button>
          ) : undefined
        }
      />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setPage(1);
          setAuditPage(1);
        }}
        actions={toolbarActions}
      />

      {activeTab === 0 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-wrap items-end gap-3">
            <form onSubmit={handleSearch} className="flex-1 min-w-[200px] sm:max-w-md">
              <Input
                placeholder="Search name or email…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
            <Select
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="w-40"
            />
            <Select
              options={roleFilterOptions}
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
              className="w-44"
            />
            <Button variant="secondary" size="sm" onClick={() => { setSearchInput(''); setSearch(''); setStatusFilter(''); setRoleFilter(''); setPage(1); }}>
              Clear
            </Button>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {isError && (
            <div className="px-4">
              <Alert variant="error" className="mb-4">
                Failed to load users.{' '}
                <button type="button" onClick={() => refetch()} className="underline font-medium">Retry</button>
              </Alert>
            </div>
          )}

          {(usersRes?.data?.length || 0) === 0 && !isLoading ? (
            <div className="p-6">
              <EmptyState
                title="No users found"
                description="Try a different search or add a new user."
                action={
                  canCreate ? (
                    <Button onClick={openCreate}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add user
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={userColumns}
              data={(usersRes?.data as User[]) || []}
              loading={isLoading}
              responsive
              onRowClick={(row) => openDetail(row as unknown as User)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={usersRes?.pagination} page={page} onPageChange={setPage} label="users" />
          </div>
        </DataPanel>
      )}

      {activeTab === 1 && (
        <>
          {(rolesData?.length || 0) === 0 ? (
            <EmptyState title="No roles configured" description="Roles are set up during system seeding or in Settings." />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {(rolesData || []).map((role) => (
                <Card key={role.id} title={role.name} action={role.isSystem ? <Badge variant="info">System</Badge> : undefined}>
                  <p className="text-xs text-slate-500 mb-3">
                    {role.description || 'No description'} · {role._count?.users ?? 0} active users
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                    {role.permissions.length === 0 ? (
                      <span className="text-xs text-slate-400">No permissions assigned</span>
                    ) : (
                      role.permissions.map((rp) => (
                        <Badge key={rp.permission.id} variant="default">
                          {rp.permission.module}:{rp.permission.action}
                        </Badge>
                      ))
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 2 && (
        <DataPanel>
          <div className="p-4 pb-0 sm:max-w-md">
            <Input
              placeholder="Search audit logs…"
              value={auditSearch}
              onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }}
            />
          </div>
          {(auditRes?.data?.length || 0) === 0 && !auditLoading ? (
            <div className="p-6">
              <EmptyState title="No audit entries found" description="System actions and changes will be logged here." />
            </div>
          ) : (
            <Table
              columns={auditColumns}
              data={(auditRes?.data as AuditLogEntry[]) || []}
              loading={auditLoading}
              responsive
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination pagination={auditRes?.pagination} page={auditPage} onPageChange={setAuditPage} label="entries" />
          </div>
        </DataPanel>
      )}

      <Modal open={formModalOpen} onClose={closeFormModal} title={editing ? 'Edit User' : 'Add User'} size="xl">
        <UserForm key={editing?.id ?? 'new'} user={editing} onSuccess={closeFormModal} onCancel={closeFormModal} />
      </Modal>

      <Modal open={detailModalOpen} onClose={() => { setDetailModalOpen(false); setSelectedUser(null); }} title="User Details" size="lg">
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : userDetail ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Name</p>
                <p className="font-semibold text-slate-900">{userDetail.firstName} {userDetail.lastName}</p>
              </div>
              <div>
                <p className="text-slate-500">Email</p>
                <p className="font-semibold text-slate-900">{userDetail.email}</p>
              </div>
              <div>
                <p className="text-slate-500">Role</p>
                <p className="font-semibold text-slate-900">{userDetail.role?.name}</p>
              </div>
              <div>
                <p className="text-slate-500">Status</p>
                <Badge variant={statusBadgeVariant(userDetail.status)}>{userDetail.status}</Badge>
              </div>
              <div>
                <p className="text-slate-500">Department</p>
                <p className="font-semibold text-slate-900">{userDetail.department?.name || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Branch</p>
                <p className="font-semibold text-slate-900">{userDetail.branch?.name || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Phone</p>
                <p className="font-semibold text-slate-900">{userDetail.phone || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500">Last Login</p>
                <p className="font-semibold text-slate-900">
                  {userDetail.lastLoginAt ? formatDate(userDetail.lastLoginAt) : 'Never'}
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-slate-900 mb-2">Recent Login History</h4>
              {userDetail.loginHistory?.length ? (
                <div className="rounded-xl border border-border overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-surface-muted/60">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">IP</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {userDetail.loginHistory.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-3 py-2">{formatDateTime(entry.createdAt)}</td>
                          <td className="px-3 py-2 text-slate-500">{entry.ipAddress || '—'}</td>
                          <td className="px-3 py-2">
                            <Badge variant={entry.success ? 'success' : 'danger'}>
                              {entry.success ? 'Success' : 'Failed'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No login history recorded.</p>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              {canUpdate && (
                <Button variant="secondary" onClick={() => openEdit(userDetail)}>
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              )}
              {canDelete && userDetail.id !== currentUser?.id && userDetail.status === 'ACTIVE' && (
                <Button variant="danger" onClick={() => setDeactivateModalOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deactivateModalOpen}
        onClose={() => setDeactivateModalOpen(false)}
        title="Deactivate User"
        size="md"
      >
        <p className="text-sm text-slate-600 mb-4">
          Move <strong>{selectedUser?.firstName} {selectedUser?.lastName}</strong> to the Recycle Bin? They will lose access immediately and can be restored later.
        </p>
        {deactivateMutation.isError && (
          <Alert variant="error" className="mb-4">
            {(deactivateMutation.error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
              'Failed to deactivate user.'}
          </Alert>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeactivateModalOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            loading={deactivateMutation.isPending}
            onClick={() => selectedUser && deactivateMutation.mutate(selectedUser.id)}
          >
            Deactivate
          </Button>
        </div>
      </Modal>
    </div>
  );
}
