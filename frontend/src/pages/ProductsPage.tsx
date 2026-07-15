import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Layers, Upload, Package, Box, FileText } from 'lucide-react';
import { productsApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  Card,
  StatCard,
  Alert,
  formatCurrency,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductForm } from '../components/forms/ProductForm';
import { BOMForm } from '../components/forms/BOMForm';
import { useAuth } from '../contexts/AuthContext';
import { Product, ProductStats } from '../types';

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'OIL_FILTER', label: 'Oil Filter' },
  { value: 'FUEL_FILTER', label: 'Fuel Filter' },
  { value: 'AIR_FILTER', label: 'Air Filter' },
  { value: 'CABIN_FILTER', label: 'Cabin Filter' },
  { value: 'HYDRAULIC_FILTER', label: 'Hydraulic Filter' },
  { value: 'WATER_FILTER', label: 'Water Filter' },
  { value: 'INDUSTRIAL_FILTER', label: 'Industrial Filter' },
  { value: 'CUSTOM_FILTER', label: 'Custom Filter' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function ProductsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');
  const [isActive, setIsActive] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [bomOpen, setBomOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [selected, setSelected] = useState<Product | null>(null);
  const [bomProduct, setBomProduct] = useState<Product | null>(null);

  const canCreate = hasPermission('products:create');
  const canUpdate = hasPermission('products:update');
  const canDelete = hasPermission('products:delete');

  const { data: stats } = useQuery({
    queryKey: ['product-stats'],
    queryFn: () => productsApi.stats().then((r) => r.data.data as ProductStats),
  });

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

  const columns = [
    {
      key: 'sku',
      label: 'SKU',
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
      render: (val: unknown) => <Badge variant="info">{(val as string).replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'sellingPrice',
      label: 'Selling Price',
      render: (val: unknown) => formatCurrency(val as number),
    },
    {
      key: 'bom',
      label: 'BOM',
      render: (_: unknown, row: Record<string, unknown>) => (
        <Badge variant={(row.bom as object) ? 'success' : 'warning'}>
          {(row.bom as object) ? 'Defined' : 'Missing'}
        </Badge>
      ),
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
                <Button size="sm" variant="ghost" onClick={() => { setBomProduct(product); setBomOpen(true); }} title="BOM">
                  <Layers className="h-4 w-4" />
                </Button>
                <label className="cursor-pointer p-2 rounded hover:bg-surface-muted" title="Upload image">
                  <Upload className="h-4 w-4 text-slate-600" />
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(product, file);
                  }} />
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

  const pagination = productsRes?.pagination;

  return (
    <div>
      <PageHeader
        subtitle="Product catalog with BOM, pricing, and image support"
        action={canCreate ? (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />Add Product
          </Button>
        ) : undefined}
      />

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <StatCard title="Total Products" value={stats.total} icon={<Package className="h-5 w-5 text-white" />} color="from-primary-500 to-indigo-600" />
          <StatCard title="Active" value={stats.active} icon={<Box className="h-5 w-5 text-white" />} color="from-emerald-500 to-teal-600" />
          <StatCard title="With BOM" value={stats.withBom} icon={<FileText className="h-5 w-5 text-white" />} color="from-violet-500 to-purple-600" />
          <StatCard title="FG in Stock" value={stats.finishedGoodsQty.toLocaleString()} icon={<Layers className="h-5 w-5 text-white" />} color="from-orange-500 to-amber-600" />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <form className="flex-1 min-w-[200px] max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}>
          <Input placeholder="Search SKU or name…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </form>
        <Select options={CATEGORY_OPTIONS} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-44" />
        <Select options={STATUS_OPTIONS} value={isActive} onChange={(e) => { setIsActive(e.target.value); setPage(1); }} className="w-36" />
        <Button variant="secondary" size="sm" onClick={() => { setSearchInput(''); setSearch(''); setCategory(''); setIsActive(''); setPage(1); }}>Clear</Button>
      </div>

      {isError && (
        <Alert variant="error" className="mb-4">
          Failed to load products. <button type="button" className="underline" onClick={() => refetch()}>Retry</button>
        </Alert>
      )}

      <Table
        columns={columns}
        data={(productsRes?.data as Product[]) || []}
        loading={isLoading}
        onRowClick={(row) => openDetail(row as unknown as Product)}
      />

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <span>Page {pagination.page} of {pagination.totalPages} ({pagination.total} products)</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Modal open={formOpen} onClose={() => { setFormOpen(false); setEditing(null); }} title={editing ? 'Edit Product' : 'Add Product'} size="lg">
        <ProductForm product={editing} onSuccess={() => { setFormOpen(false); setEditing(null); }} onCancel={() => { setFormOpen(false); setEditing(null); }} />
      </Modal>

      <Modal open={bomOpen} onClose={() => { setBomOpen(false); setBomProduct(null); }} title="Bill of Materials" size="lg">
        {bomProduct && (
          <BOMForm productId={bomProduct.id} onSuccess={() => { setBomOpen(false); setBomProduct(null); }} onCancel={() => { setBomOpen(false); setBomProduct(null); }} />
        )}
      </Modal>

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null); }} title="Product Details" size="xl">
        {detailLoading ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading…</div>
        ) : productDetail ? (
          <div className="space-y-6">
            <div className="flex gap-4">
              {productDetail.imageUrl ? (
                <img src={productDetail.imageUrl} alt={productDetail.name} className="h-24 w-24 rounded-xl object-cover border border-border" />
              ) : (
                <div className="h-24 w-24 rounded-xl bg-surface-muted flex items-center justify-center text-slate-400 text-xs">No image</div>
              )}
              <div className="grid grid-cols-2 gap-3 flex-1 text-sm">
                <div><p className="text-slate-500">SKU</p><p className="font-semibold">{productDetail.sku}</p></div>
                <div><p className="text-slate-500">Category</p><Badge variant="info">{productDetail.category.replace(/_/g, ' ')}</Badge></div>
                <div><p className="text-slate-500">Selling Price</p><p className="font-semibold">{formatCurrency(Number(productDetail.sellingPrice))}</p></div>
                <div><p className="text-slate-500">Mfg Cost</p><p className="font-semibold">{formatCurrency(Number(productDetail.manufacturingCost))}</p></div>
                <div><p className="text-slate-500">Min Stock</p><p className="font-semibold">{productDetail.minStockLevel}</p></div>
                <div><p className="text-slate-500">Status</p><Badge variant={productDetail.isActive ? 'success' : 'danger'}>{productDetail.isActive ? 'Active' : 'Inactive'}</Badge></div>
              </div>
            </div>
            {productDetail.description && <p className="text-sm text-slate-600">{productDetail.description}</p>}

            <Card title="Bill of Materials">
              {productDetail.bom?.items?.length ? (
                <div className="space-y-2">
                  {productDetail.bom.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm py-1 border-b border-border/60 last:border-0">
                      <span>{item.rawMaterial.name} ({item.rawMaterial.code})</span>
                      <span className="text-slate-600">{item.quantity} {item.unit}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">No BOM defined. Add components to enable production.</p>
              )}
            </Card>

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
                <>
                  <Button variant="secondary" onClick={() => { setBomProduct(productDetail); setBomOpen(true); setDetailOpen(false); }}>
                    <Layers className="h-4 w-4 mr-1.5" />Edit BOM
                  </Button>
                  <Button variant="secondary" onClick={() => { setEditing(productDetail); setFormOpen(true); setDetailOpen(false); }}>
                    <Pencil className="h-4 w-4 mr-1.5" />Edit
                  </Button>
                </>
              )}
              {canDelete && productDetail.isActive && (
                <Button variant="danger" onClick={() => setDeactivateOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" />Deactivate
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={deactivateOpen} onClose={() => setDeactivateOpen(false)} title="Deactivate Product" size="md">
        <p className="text-sm text-slate-600 mb-4">Deactivate <strong>{productDetail?.name}</strong>?</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeactivateOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={deactivateMutation.isPending} onClick={() => productDetail && deactivateMutation.mutate(productDetail.id)}>Deactivate</Button>
        </div>
      </Modal>
    </div>
  );
}
