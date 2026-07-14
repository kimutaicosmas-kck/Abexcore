import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Layers, Upload } from 'lucide-react';
import { productsApi } from '../services/api';
import { PageHeader, Table, Badge, Button, formatCurrency } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductForm } from '../components/forms/ProductForm';
import { BOMForm } from '../components/forms/BOMForm';
import { Product } from '../types';

export function ProductsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [bomProduct, setBomProduct] = useState<Product | null>(null);

  const { data, isLoading, refetch } = useQuery({
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

  const openBom = (product: Product) => {
    setBomProduct(product);
    setBomModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
  };

  const handleImageUpload = async (product: Product, file: File) => {
    await productsApi.uploadImage(product.id, file);
    refetch();
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
      key: 'isActive',
      label: 'Status',
      render: (val: unknown) => (
        <Badge variant={val ? 'success' : 'danger'}>{val ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row as unknown as Product;
        return (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openBom(product); }} title="Edit BOM">
              <Layers className="h-4 w-4" />
            </Button>
            <label className="cursor-pointer p-2 rounded hover:bg-gray-100" title="Upload image">
              <Upload className="h-4 w-4 text-gray-600" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(product, file);
                }}
              />
            </label>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(product); }}>
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Product Catalog"
        subtitle="Oil filters, air filters, fuel filters — with BOM and image support"
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

      <Modal
        open={bomModalOpen}
        onClose={() => { setBomModalOpen(false); setBomProduct(null); }}
        title="Bill of Materials"
        size="lg"
      >
        {bomProduct && (
          <BOMForm
            productId={bomProduct.id}
            onSuccess={() => { setBomModalOpen(false); setBomProduct(null); }}
            onCancel={() => { setBomModalOpen(false); setBomProduct(null); }}
          />
        )}
      </Modal>
    </div>
  );
}
