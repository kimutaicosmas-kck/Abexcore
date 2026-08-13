import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import { productsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductForm } from '../components/forms/ProductForm';
import { useAuth } from '../contexts/AuthContext';
import { Product, ProductCategoryOption } from '../types';
import { PART_NUMBER_LABEL } from '../utils/productDisplay';
import { AvailableProductsPanel } from './AvailableProductsPage';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function ProductsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManageProducts = hasPermission('products:read');
  const canViewAvailable = hasPermission('sales:read');
  const canCreate = hasPermission('products:create');
  const canUpdate = hasPermission('products:update');
  const canDelete = hasPermission('products:delete');

  const tabs = useMemo(() => {
    const items: string[] = [];
    if (canManageProducts) {
      items.push('Catalog');
    }
    if (canViewAvailable) items.push('Available');
    return items;
  }, [canManageProducts, canViewAvailable]);

  const tabParam = (searchParams.get('tab') || '').toLowerCase();
  const wantAvailable = tabParam === 'available' && canViewAvailable;
  const wantCatalog = (tabParam === 'catalog' || tabParam === '1') && canManageProducts;
  const initialTab = wantAvailable
    ? 'Available'
    : wantCatalog
      ? 'Catalog'
      : tabs[0] || 'Catalog';

  const [activeTabName, setActiveTabName] = useState(initialTab);
  const activeTab = Math.max(0, tabs.indexOf(activeTabName));

  useEffect(() => {
    if (!tabs.includes(activeTabName) && tabs[0]) {
      setActiveTabName(tabs[0]);
      return;
    }
    if (wantAvailable && activeTabName !== 'Available') setActiveTabName('Available');
    else if (wantCatalog && activeTabName !== 'Catalog') setActiveTabName('Catalog');
  }, [wantAvailable, wantCatalog, tabs, activeTabName]);

  const setTab = (name: string) => {
    setActiveTabName(name);
    const next = new URLSearchParams(searchParams);
    if (name === 'Available') next.set('tab', 'available');
    else if (name === 'Catalog') next.set('tab', 'catalog');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');
  const [isActive, setIsActive] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);

  const showCatalogQueries = canManageProducts && activeTabName === 'Catalog';

  const { data: categoriesData } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => productsApi.categories().then((r) => r.data.data as ProductCategoryOption[]),
    enabled: canManageProducts,
  });

  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(categoriesData || []).map((c) => ({ value: c.id, label: c.name })),
  ];

  const { data: productsRes, isLoading, isError, refetch } = useQuery({
    queryKey: ['products', page, search, category, isActive],
    queryFn: () =>
      productsApi
        .list({
          page,
          limit: 15,
          search: search || undefined,
          category: category || undefined,
          isActive: isActive === '' ? undefined : isActive === 'true',
        })
        .then((r) => r.data),
    enabled: showCatalogQueries,
  });

  const { data: productDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['product-detail', selected?.id],
    queryFn: () => productsApi.get(selected!.id).then((r) => r.data.data as Product),
    enabled: !!selected && detailOpen,
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => productsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      setDeactivateOpen(false);
      setDetailOpen(false);
      setSelected(null);
    },
  });

  const handleImageUpload = async (product: Product, file: File) => {
    await productsApi.uploadImage(product.id, file);
    queryClient.invalidateQueries({ queryKey: ['products'] });
    if (selected?.id === product.id) queryClient.invalidateQueries({ queryKey: ['product-detail', product.id] });
  };

  const openDetail = (product: Product) => {
    setSelected(product);
    setDetailOpen(true);
  };

  const openAddProduct = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const products = (productsRes?.data as Product[]) || [];

  const columns = [
    {
      key: 'sku',
      label: PART_NUMBER_LABEL,
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium">{row.sku as string}</p>
          {(row.barcode as string) && <p className="text-xs text-slate-500">{row.barcode as string}</p>}
        </div>
      ),
    },
    { key: 'name', label: 'Product Name' },
    {
      key: 'category',
      label: 'Category',
      render: (_: unknown, row: Record<string, unknown>) => {
        const product = row as unknown as Product;
        return <Badge variant="info">{product.category?.name || 'Uncategorized'}</Badge>;
      },
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
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {canUpdate && (
              <>
                <label className="cursor-pointer p-2 rounded hover:bg-surface-muted" title="Upload image">
                  <Upload className="h-4 w-4 text-slate-600" />
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
                <Button size="sm" variant="ghost" onClick={() => { setEditing(product); setFormOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        );
      },
    },
  ];

  if (tabs.length === 0) {
    return <Alert variant="warning">You do not have access to the products module.</Alert>;
  }

  const toolbarActions =
    canCreate && activeTabName === 'Catalog' ? (
      <Button size="sm" onClick={openAddProduct}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Product
      </Button>
    ) : undefined;

  const subtitle =
    activeTabName === 'Available'
      ? 'Finished goods you can sell — live available quantity after reservations.'
      : 'Manage the full product catalog, prices, and status.';

  return (
    <div className="space-y-4">
      <PageHeader subtitle={subtitle} />

      <PageToolbar
        tabs={tabs}
        activeTab={activeTab >= 0 ? activeTab : 0}
        onTabChange={(index) => setTab(tabs[index])}
        actions={toolbarActions}
      />

      {activeTabName === 'Catalog' && canManageProducts && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row flex-wrap items-end gap-3">
            <form
              className="flex-1 min-w-[200px] sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
                setPage(1);
              }}
            >
              <Input
                placeholder="Search part number or name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
            <Select
              options={categoryOptions}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="sm:w-44"
            />
            <Select
              options={STATUS_OPTIONS}
              value={isActive}
              onChange={(e) => {
                setIsActive(e.target.value);
                setPage(1);
              }}
              className="sm:w-36"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setCategory('');
                setIsActive('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          </div>

          {isError && (
            <div className="px-4 pt-4">
              <Alert variant="error">
                Failed to load products.{' '}
                <button type="button" className="underline font-medium" onClick={() => refetch()}>
                  Retry
                </button>
              </Alert>
            </div>
          )}

          {(products.length || 0) === 0 && !isLoading && !isError ? (
            <div className="p-6">
              <EmptyState
                title="No products found"
                description="Try different filters or add a new product."
                action={
                  canCreate ? (
                    <Button onClick={openAddProduct}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add product
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table
              columns={columns}
              data={products}
              loading={isLoading}
              responsive
              onRowClick={(row) => openDetail(row as unknown as Product)}
              embedded
            />
          )}
          <div className="px-4 pb-4">
            <TablePagination
              pagination={productsRes?.pagination}
              page={page}
              onPageChange={setPage}
              label="products"
            />
          </div>
        </DataPanel>
      )}

      {activeTabName === 'Available' && canViewAvailable && <AvailableProductsPanel />}

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        title={editing ? 'Edit Product' : 'Add Product'}
        size="lg"
      >
        <ProductForm
          product={editing}
          onSuccess={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      </Modal>

      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setSelected(null);
        }}
        title="Product Details"
        size="xl"
      >
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : productDetail ? (
          <div className="space-y-6">
            <div className="flex gap-4">
              {productDetail.imageUrl ? (
                <img
                  src={productDetail.imageUrl}
                  alt={productDetail.name}
                  className="h-24 w-24 rounded-xl object-cover border border-border"
                />
              ) : (
                <div className="h-24 w-24 rounded-xl bg-surface-muted flex items-center justify-center text-slate-400 text-xs">
                  No image
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 flex-1 text-sm">
                <div>
                  <p className="text-slate-500">{PART_NUMBER_LABEL}</p>
                  <p className="font-semibold">{productDetail.sku}</p>
                </div>
                <div>
                  <p className="text-slate-500">Category</p>
                  <Badge variant="info">{productDetail.category?.name || 'Uncategorized'}</Badge>
                </div>
                <div>
                  <p className="text-slate-500">Selling Price</p>
                  <p className="font-semibold">{formatCurrency(Number(productDetail.sellingPrice))}</p>
                </div>
                <div>
                  <p className="text-slate-500">Min Stock</p>
                  <p className="font-semibold">{productDetail.minStockLevel}</p>
                </div>
                <div>
                  <p className="text-slate-500">Status</p>
                  <Badge variant={productDetail.isActive ? 'success' : 'danger'}>
                    {productDetail.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              </div>
            </div>
            {productDetail.description && <p className="text-sm text-slate-600">{productDetail.description}</p>}

            {productDetail.stockLevels && productDetail.stockLevels.length > 0 && (
              <Card title="Stock Levels">
                {productDetail.stockLevels.map((sl) => (
                  <div key={sl.id} className="flex justify-between text-sm py-1">
                    <span>{sl.warehouse.name}</span>
                    <span className="font-medium">{Number(sl.quantity).toLocaleString()} units</span>
                  </div>
                ))}
              </Card>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t">
              {canUpdate && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(productDetail);
                    setFormOpen(true);
                    setDetailOpen(false);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-1.5" />
                  Edit
                </Button>
              )}
              {canDelete && productDetail.isActive && (
                <Button variant="danger" onClick={() => setDeactivateOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Deactivate
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="Deactivate Product" size="md">
        <p className="text-sm text-slate-600 mb-4">
          Deactivate <strong>{productDetail?.name}</strong>?
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeactivateOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deactivateMutation.isPending}
            onClick={() => productDetail && deactivateMutation.mutate(productDetail.id)}
          >
            Deactivate
          </Button>
        </div>
      </Modal>
    </div>
  );
}
