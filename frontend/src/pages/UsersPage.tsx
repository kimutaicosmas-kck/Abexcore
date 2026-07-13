import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { usersApi } from '../services/api';
import { PageHeader, Table, Badge, Button } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { UserForm } from '../components/forms/UserForm';
import { User } from '../types';

export function UsersPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then((r) => r.data),
  });

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditing(user);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const columns = [
    {
      key: 'name',
      label: 'Name',
      render: (_: unknown, row: Record<string, unknown>) =>
        `${row.firstName} ${row.lastName}`,
    },
    { key: 'email', label: 'Email' },
    {
      key: 'role',
      label: 'Role',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.role as { name: string })?.name || '-',
    },
    {
      key: 'department',
      label: 'Department',
      render: (_: unknown, row: Record<string, unknown>) =>
        (row.department as { name: string })?.name || '-',
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val === 'ACTIVE' ? 'success' : 'danger'}>{val as string}</Badge>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Manage users, roles, permissions, and departments"
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table
          columns={columns}
          data={data?.data || []}
          loading={isLoading}
          onRowClick={(row) => openEdit(row as unknown as User)}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit User' : 'Add User'}
        size="lg"
      >
        <UserForm user={editing} onSuccess={closeModal} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
