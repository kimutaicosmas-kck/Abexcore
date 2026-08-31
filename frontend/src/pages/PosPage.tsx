import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  Package,
  CreditCard,
} from 'lucide-react';
import clsx from 'clsx';
import { customersApi, operationsApi, productsApi } from '../services/api';
import { Alert, Button, formatCurrency, LoadingSpinner } from '../components/ui';
import { Customer, Product } from '../types';
import { getApiErrorMessage } from '../utils/apiError';
import { formatPartNumberLine } from '../utils/productDisplay';

type CartLine = {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  imageUrl?: string;
};

function productImageSrc(url?: string) {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

export function PosPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [successOrderNo, setSuccessOrderNo] = useState<string | null>(null);
  const [successOrderId, setSuccessOrderId] = useState<string | null>(null);

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products'],
    queryFn: () =>
      productsApi.available({ page: 1, limit: 200 }).then((r) => (r.data.data || []) as Product[]),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['pos-categories'],
    queryFn: () => productsApi.categories().then((r) => (r.data.data || []) as { id: string; name: string }[]),
  });

  const { data: customers = [] } = useQuery({
    queryKey: ['pos-customers', customerSearch],
    queryFn: () =>
      customersApi
        .list({ search: customerSearch.trim() || undefined, limit: 30 })
        .then((r) => (r.data.data || []) as Customer[]),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryId !== 'all' && p.categoryId !== categoryId) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryId]);

  const cartTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const selectedCustomer = customers.find((c) => c.id === customerId);

  const addToCart = (product: Product) => {
    setSuccessOrderNo(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unitPrice: Number(product.sellingPrice) || 0,
          quantity: 1,
          imageUrl: product.imageUrl,
        },
      ];
    });
  };

  const setQty = (productId: string, quantity: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.productId === productId ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const checkout = useMutation({
    mutationFn: async () => {
      if (!customerId) throw new Error('Select a customer before checkout');
      if (!cart.length) throw new Error('Add at least one product');
      const res = await operationsApi.posCheckout({
        customerId,
        notes: 'POS counter sale',
        items: cart.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: 0,
        })),
      });
      const data = res.data.data as {
        order: { id: string; orderNumber: string };
        invoice?: { id: string; invoiceNumber?: string } | null;
        deliveryNote?: { id: string; deliveryNo?: string } | null;
      };
      return data;
    },
    onSuccess: (data) => {
      setCheckoutError(null);
      setCart([]);
      setSuccessOrderNo(data.order.orderNumber);
      setSuccessOrderId(data.order.id);
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      queryClient.invalidateQueries({ queryKey: ['delivery'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => setCheckoutError(getApiErrorMessage(err) || 'Checkout failed'),
  });

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-5.5rem)] min-h-[28rem] flex-col gap-3 lg:flex-row">
      {/* Catalog */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-soft dark:border-slate-800 dark:bg-slate-900">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name, SKU, or barcode…"
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm outline-none focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-500/15 dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setCategoryId('all')}
              className={clsx(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                categoryId === 'all'
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              )}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id)}
                className={clsx(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition',
                  categoryId === c.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          {productsLoading ? (
            <LoadingSpinner className="h-48" />
          ) : filtered.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center text-sm text-slate-500">
              <Package className="mb-2 h-8 w-8 opacity-40" />
              No products match this search
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((product) => {
                const img = productImageSrc(product.imageUrl);
                const stock = product.stockLevels?.reduce((s, l) => s + Number(l.quantity || 0), 0);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addToCart(product)}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-soft transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex h-28 items-center justify-center bg-slate-100 dark:bg-slate-800">
                      {img ? (
                        <img src={img} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package className="h-10 w-10 text-slate-300" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 p-3">
                      <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {product.name}
                      </p>
                      <p className="text-[11px] text-slate-500">{formatPartNumberLine(product.sku)}</p>
                      {stock != null && (
                        <p className="text-[11px] text-slate-500">Stock {stock}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between pt-2">
                        <span className="text-sm font-bold tabular-nums text-primary-700">
                          {formatCurrency(Number(product.sellingPrice) || 0)}
                        </span>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-white opacity-90 group-hover:opacity-100">
                          <Plus className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Cart */}
      <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-slate-200/80 bg-white shadow-soft lg:w-[22rem] dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary-600" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cart</h2>
            {cartCount > 0 && (
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold text-primary-700">
                {cartCount}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              type="button"
              onClick={() => setCart([])}
              className="text-xs font-medium text-slate-500 hover:text-red-600"
            >
              Clear
            </button>
          )}
        </div>

        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Customer *</label>
          <input
            value={customerSearch}
            onChange={(e) => {
              setCustomerSearch(e.target.value);
              setCustomerId('');
            }}
            placeholder="Search customer…"
            className="mb-2 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-primary-400 dark:border-slate-700 dark:bg-slate-950"
          />
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {customers.slice(0, 8).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCustomerId(c.id);
                  setCustomerSearch(c.name);
                }}
                className={clsx(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs',
                  customerId === c.id
                    ? 'bg-primary-50 font-semibold text-primary-800'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                )}
              >
                <span className="truncate">{c.name}</span>
                {customerId === c.id && <span className="text-primary-600">Selected</span>}
              </button>
            ))}
          </div>
          {selectedCustomer && (
            <p className="mt-2 text-[11px] text-emerald-700">Selling to {selectedCustomer.name}</p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {!cart.length ? (
            <p className="px-2 py-10 text-center text-sm text-slate-500">Tap products to add them here</p>
          ) : (
            cart.map((line) => (
              <div
                key={line.productId}
                className="flex gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-2 dark:border-slate-800 dark:bg-slate-950/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{line.name}</p>
                  <p className="text-[11px] text-slate-500">{formatCurrency(line.unitPrice)} each</p>
                  <div className="mt-2 flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 p-1 dark:border-slate-700"
                      onClick={() => setQty(line.productId, line.quantity - 1)}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-8 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 p-1 dark:border-slate-700"
                      onClick={() => setQty(line.productId, line.quantity + 1)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="ml-auto rounded-lg p-1 text-slate-400 hover:text-red-600"
                      onClick={() => setQty(line.productId, 0)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
                  {formatCurrency(line.unitPrice * line.quantity)}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2 border-t border-slate-100 p-4 dark:border-slate-800">
          {checkoutError && <Alert variant="error">{checkoutError}</Alert>}
          {successOrderNo && (
            <Alert variant="success">
              <p className="font-medium">Sale {successOrderNo} completed.</p>
              <p className="mt-1 text-xs opacity-90">
                Stock issued, customer-collection delivery note marked delivered, and invoice created.
              </p>
              <button
                type="button"
                className="mt-2 underline font-medium"
                onClick={() =>
                  navigate(successOrderId ? `/sales?orderId=${successOrderId}` : '/sales')
                }
              >
                Open order in Sales
              </button>
            </Alert>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">Total</span>
            <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
              {formatCurrency(cartTotal)}
            </span>
          </div>
          <Button
            className="w-full"
            disabled={!cart.length || !customerId}
            loading={checkout.isPending}
            onClick={() => {
              setCheckoutError(null);
              checkout.mutate();
            }}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Checkout
          </Button>
          {!customerId && cart.length > 0 && (
            <p className="text-center text-[11px] text-amber-700">Select a customer to checkout</p>
          )}
        </div>
      </aside>
    </div>
  );
}
