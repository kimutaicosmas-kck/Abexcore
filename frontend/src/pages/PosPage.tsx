import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { customersApi, posApi, productsApi } from '../services/api';
import {
  Button,
  Card,
  Input,
  Select,
  EmptyState,
  PageQueryStatus,
} from '../components/ui';
import { getApiErrorMessage } from '../utils/apiError';
import { useAuth } from '../contexts/AuthContext';

type ProductRow = {
  id: string;
  name: string;
  sku: string;
  sellingPrice: number | string;
  unit?: string;
};

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
};

export function PosPage() {
  const { hasPermission } = useAuth();
  const canSell = hasPermission('sales:create');
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'MPESA' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);

  const { data: products, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pos-products', search],
    queryFn: () =>
      productsApi.list({ page: 1, limit: 40, search: search || undefined, isActive: true }).then((r) => {
        const payload = r.data as { data?: ProductRow[] };
        return payload.data || [];
      }),
  });

  const { data: customers } = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () =>
      customersApi.list({ page: 1, limit: 100 }).then((r) => {
        const payload = r.data as { data?: { id: string; name: string }[] };
        return payload.data || [];
      }),
  });

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0),
    [cart]
  );

  const checkoutMutation = useMutation({
    mutationFn: () =>
      posApi.checkout({
        customerId: customerId || undefined,
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
        paymentMethod,
        mpesaPhone: paymentMethod === 'MPESA' ? mpesaPhone : undefined,
      }),
    onSuccess: (res) => {
      const data = res.data.data as {
        order?: { orderNumber: string };
        invoice?: { invoiceNumber: string; totalAmount: number | string };
        awaitingMpesa?: boolean;
      };
      setReceipt(
        data.awaitingMpesa
          ? `Sale ${data.order?.orderNumber} — M-Pesa prompt sent. Invoice ${data.invoice?.invoiceNumber}.`
          : `Sale complete: ${data.order?.orderNumber} / ${data.invoice?.invoiceNumber} — KES ${Number(data.invoice?.totalAmount || total).toLocaleString()}`
      );
      setCart([]);
    },
  });

  const addProduct = (product: ProductRow) => {
    const price = Number(product.sellingPrice);
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { productId: product.id, name: product.name, unitPrice: price, quantity: 1 }];
    });
  };

  return (
    <div className="space-y-6">
      {receipt && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {receipt}
        </div>
      )}

      {!canSell && (
        <p className="text-sm text-amber-700">You need sales:create permission to complete POS sales.</p>
      )}

      {checkoutMutation.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {getApiErrorMessage(checkoutMutation.error)}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3 space-y-4">
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <PageQueryStatus
            isError={isError}
            error={error}
            onRetry={() => refetch()}
          />
          {isLoading && <p className="text-sm text-slate-500">Loading products…</p>}
          {!isLoading && !(products || []).length && !isError && (
            <EmptyState title="No products" description="Try another search." />
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {(products || []).map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-left hover:border-primary-400 hover:bg-primary-50"
              >
                <div className="font-medium text-slate-900">{product.name}</div>
                <div className="text-xs text-slate-500">{product.sku}</div>
                <div className="mt-1 text-sm font-semibold text-primary-700">
                  KES {Number(product.sellingPrice).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <ShoppingCart className="h-5 w-5" /> Cart
          </div>
          {!cart.length && <EmptyState title="Cart empty" description="Tap products to add." />}
          <ul className="space-y-3">
            {cart.map((line) => (
              <li key={line.productId} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div>
                  <div className="text-sm font-medium">{line.name}</div>
                  <div className="text-xs text-slate-500">KES {line.unitPrice.toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCart((prev) =>
                        prev
                          .map((l) =>
                            l.productId === line.productId
                              ? { ...l, quantity: Math.max(0, l.quantity - 1) }
                              : l
                          )
                          .filter((l) => l.quantity > 0)
                      )
                    }
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-6 text-center text-sm">{line.quantity}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCart((prev) =>
                        prev.map((l) =>
                          l.productId === line.productId ? { ...l, quantity: l.quantity + 1 } : l
                        )
                      )
                    }
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCart((prev) => prev.filter((l) => l.productId !== line.productId))}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Select
            label="Customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            options={[
              { value: '', label: 'Walk-in Customer' },
              ...(customers || []).map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          <Select
            label="Payment"
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
            options={[
              { value: 'CASH', label: 'Cash' },
              { value: 'MPESA', label: 'M-Pesa' },
              { value: 'CARD', label: 'Card' },
              { value: 'BANK_TRANSFER', label: 'Bank transfer' },
            ]}
          />
          {paymentMethod === 'MPESA' && (
            <Input
              label="M-Pesa phone"
              placeholder="2547…"
              value={mpesaPhone}
              onChange={(e) => setMpesaPhone(e.target.value)}
            />
          )}

          <div className="flex items-center justify-between text-lg font-semibold">
            <span>Total</span>
            <span>KES {total.toLocaleString()}</span>
          </div>
          <Button
            className="w-full"
            disabled={!canSell || !cart.length || checkoutMutation.isPending}
            onClick={() => checkoutMutation.mutate()}
          >
            {checkoutMutation.isPending ? 'Processing…' : 'Complete sale'}
          </Button>
        </Card>
      </div>
    </div>
  );
}
