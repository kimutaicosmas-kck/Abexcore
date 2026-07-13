import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { productsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductForm } from '../components/forms/ProductForm';
import { Product } from '../types';

export function ProductsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list().then((r) => r.data),
  });

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Product Name' },
    {
      key: 'category',
      label: 'Category',
      render: (val: unknown) => (
        <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'manufacturingCost',
      label: 'Mfg Cost',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'sellingPrice',
      label: 'Selling Price',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'distributorPrice',
      label: 'Distributor',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val ? 'success' : 'danger'}>{val ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(row as unknown as Product); }}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Product Catalog"
        subtitle="Oil filters, air filters, fuel filters, and all filter products"
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Add Product
          </Button>
        }
      />
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <Table
          columns={columns}
          data={(data?.data as Product[]) || []}
          loading={isLoading}
          onRowClick={(row) => openEdit(row as unknown as Product)}
        />
      </div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit Product' : 'Add Product'}
        size="lg"
      >
        <ProductForm product={editing} onSuccess={closeModal} onCancel={closeModal} />
      </Modal>
    </div>
  );
}
