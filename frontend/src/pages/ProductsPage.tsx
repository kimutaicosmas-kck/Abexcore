import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Layers,
  Upload,
  Package,
  Box,
  FileText,
  AlertTriangle,
  ChevronRight,
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
  StatCard,
  StatGrid,
  Alert,
  EmptyState,
  DataPanel,
  TablePagination,
  formatCurrency,
  PageToolbar,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { ProductForm } from '../components/forms/ProductForm';
import { BOMForm } from '../components/forms/BOMForm';
import { useAuth } from '../contexts/AuthContext';
import { OverviewHint } from '../components/layout/ModuleOverview';
import { Product, ProductStats } from '../types';
import { PART_NUMBER_LABEL, formatPartNumberLine } from '../utils/productDisplay';

const tabs = ['Overview', 'Catalog'];

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
  const [activeTab, setActiveTab] = useState(0);
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
    enabled: activeTab === 0 || activeTab === 1,
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

  const goToTab = (index: number) => {
    setActiveTab(index);
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
  const recentProducts = activeTab === 0 ? products.slice(0, 6) : [];
  const missingBomProducts = activeTab === 0 ? products.filter((p) => !p.bom).slice(0, 5) : [];

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

  const toolbarActions =
    canCreate &&
    (activeTab === 0 || activeTab === 1 ? (
      <Button size="sm" onClick={openAddProduct}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add Product
      </Button>
    ) : undefined);

  return (
    <div className="space-y-1">
      <PageHeader
        title="Products"
        subtitle="Product catalog with BOM, pricing, and image support"
        action={
          stats && stats.withoutBom > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => goToTab(1)}>
              <AlertTriangle className="h-4 w-4 mr-1.5 text-amber-500" />
              {stats.withoutBom} missing BOM
            </Button>
          ) : undefined
        }
      />

      {stats && (
        <StatGrid>
          <StatCard
            title="Total Products"
            value={stats.total}
            icon={<Package className="h-5 w-5 text-white" />}
            color="from-primary-500 to-indigo-600"
          />
          <StatCard
            title="Active"
            value={stats.active}
            icon={<Box className="h-5 w-5 text-white" />}
            color="from-emerald-500 to-teal-600"
          />
          <StatCard
            title="With BOM"
            value={stats.withBom}
            icon={<FileText className="h-5 w-5 text-white" />}
            color="from-violet-500 to-purple-600"
          />
          <StatCard
            title="FG in Stock"
            value={stats.finishedGoodsQty.toLocaleString()}
            icon={<Layers className="h-5 w-5 text-white" />}
            color="from-orange-500 to-amber-600"
          />
        </StatGrid>
      )}

      <PageToolbar tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} actions={toolbarActions} />

      {activeTab === 0 && (
        <div className="space-y-4">
          <OverviewHint>Use the tabs above to manage records. Summary counts are shown at the top.</OverviewHint>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card
              title="Missing BOM"
              action={
                missingBomProducts.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => goToTab(1)}>
                    View all
                  </Button>
                ) : undefined
              }
              padding={false}
            >
              {missingBomProducts.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="All products have BOM" description="Every active product has a bill of materials defined." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {missingBomProducts.map((product) => (
                    <li
                      key={product.id}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/30 cursor-pointer"
                      onClick={() => openDetail(product)}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 truncate">{product.name}</p>
                        <p className="text-xs text-slate-500">{formatPartNumberLine(product.sku)}</p>
                      </div>
                      <Badge variant="warning">Missing</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="By category" padding={false}>
              {(stats?.byCategory?.length || 0) === 0 ? (
                <div className="p-6">
                  <EmptyState title="No category data" description="Product categories will appear here once catalog is populated." />
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {(stats?.byCategory || []).slice(0, 6).map((item) => (
                    <li
                      key={item.category}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer"
                      onClick={() => { setCategory(item.category); setPage(1); goToTab(1); }}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                        <Package className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900">{item.category.replace(/_/g, ' ')}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-slate-700">{item.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <DataPanel>
          <div className="p-4 pb-0 flex flex-col sm:flex-row flex-wrap items-end gap-3">
            <form
              className="flex-1 min-w-[200px] sm:max-w-md"
              onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); setPage(1); }}
            >
              <Input
                placeholder="Search part number or name…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
            <Select
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              className="sm:w-44"
            />
            <Select
              options={STATUS_OPTIONS}
              value={isActive}
              onChange={(e) => { setIsActive(e.target.value); setPage(1); }}
              className="sm:w-36"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setSearchInput(''); setSearch(''); setCategory(''); setIsActive(''); setPage(1); }}
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
                <div><p className="text-slate-500">{PART_NUMBER_LABEL}</p><p className="font-semibold">{productDetail.sku}</p></div>
                <div><p className="text-slate-500">Category</p><Badge variant="info">{productDetail.category.replace(/_/g, ' ')}</Badge></div>
                <div><p className="text-slate-500">Selling Price</p><p className="font-semibold">{formatCurrency(Number(productDetail.sellingPrice))}</p></div>
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
