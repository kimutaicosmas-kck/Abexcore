import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { storefrontApi } from '../services/api';
import { Button, Card, EmptyState, Input, Select } from '../components/ui';
import { getApiErrorMessage } from '../utils/apiError';

type StoreProduct = {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  inStock: boolean;
};

type CartLine = { productId: string; name: string; price: number; quantity: number };

/** Public e-commerce storefront — no login required. */
export function StorefrontShopPage() {
  const { slug = '' } = useParams();
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH_ON_DELIVERY' | 'MPESA'>('MPESA');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [orderResult, setOrderResult] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['storefront', slug, search],
    queryFn: () =>
      storefrontApi.products(slug, { search: search || undefined }).then((r) => r.data as {
        store: { name: string; slug: string; phone?: string };
        data: StoreProduct[];
      }),
    enabled: Boolean(slug),
  });

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart]
  );

  const checkoutMutation = useMutation({
    mutationFn: () =>
      storefrontApi.checkout(slug, {
        customerName,
        customerPhone,
        customerEmail: customerEmail || undefined,
        customerAddress: customerAddress || undefined,
        paymentMethod,
        mpesaPhone: paymentMethod === 'MPESA' ? mpesaPhone || customerPhone : undefined,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      }),
    onSuccess: (res) => {
      const d = res.data.data as {
        orderNumber: string;
        totalAmount: number;
        message: string;
        mpesaCheckoutRequestId?: string;
      };
      setOrderResult(
        `${d.message}. Order ${d.orderNumber} — KES ${Number(d.totalAmount).toLocaleString()}` +
          (d.mpesaCheckoutRequestId ? '. Check your phone for M-Pesa.' : '')
      );
      setCart([]);
    },
  });

  const onCheckout = (e: FormEvent) => {
    e.preventDefault();
    checkoutMutation.mutate();
  };

  if (!slug) {
    return <div className="p-8 text-center text-slate-600">Missing store slug.</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              {data?.store?.name || 'Online Store'}
            </h1>
            <p className="text-sm text-slate-500">Powered by AbexCore</p>
          </div>
          <Input
            className="max-w-xs"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-4">
          {isLoading && <p className="text-slate-500">Loading catalog…</p>}
          {isError && (
            <p className="text-red-600">Store not found or not enabled. Ask the seller to turn on e-commerce.</p>
          )}
          {!isLoading && !(data?.data || []).length && (
            <EmptyState title="No products" description="Nothing listed yet." />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {(data?.data || []).map((product) => (
              <Card key={product.id} className="space-y-2">
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    className="h-36 w-full rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-36 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                    No image
                  </div>
                )}
                <div className="font-medium text-slate-900">{product.name}</div>
                <div className="text-sm text-slate-500">{product.sku}</div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">
                    KES {Number(product.price).toLocaleString()}
                  </span>
                  <Button
                    size="sm"
                    disabled={!product.inStock}
                    onClick={() =>
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
                            price: product.price,
                            quantity: 1,
                          },
                        ];
                      })
                    }
                  >
                    {product.inStock ? 'Add' : 'Out of stock'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <Card className="space-y-3">
            <h2 className="font-semibold text-slate-900">Cart</h2>
            {!cart.length && <p className="text-sm text-slate-500">Your cart is empty.</p>}
            {cart.map((line) => (
              <div key={line.productId} className="flex justify-between text-sm">
                <span>
                  {line.name} × {line.quantity}
                </span>
                <span>KES {(line.price * line.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-2 font-semibold">
              Total: KES {total.toLocaleString()}
            </div>
          </Card>

          <Card>
            <form className="space-y-3" onSubmit={onCheckout}>
              <h2 className="font-semibold text-slate-900">Checkout</h2>
              <Input
                label="Full name"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <Input
                label="Phone"
                required
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
              <Input
                label="Delivery address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
              />
              <Select
                label="Payment"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                options={[
                  { value: 'MPESA', label: 'M-Pesa STK' },
                  { value: 'CASH_ON_DELIVERY', label: 'Cash on delivery' },
                ]}
              />
              {paymentMethod === 'MPESA' && (
                <Input
                  label="M-Pesa phone"
                  value={mpesaPhone}
                  onChange={(e) => setMpesaPhone(e.target.value)}
                  placeholder="Defaults to contact phone"
                />
              )}
              {checkoutMutation.isError && (
                <p className="text-sm text-red-600">{getApiErrorMessage(checkoutMutation.error)}</p>
              )}
              {orderResult && <p className="text-sm text-emerald-700">{orderResult}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={!cart.length || checkoutMutation.isPending || !customerName || !customerPhone}
              >
                {checkoutMutation.isPending ? 'Placing order…' : 'Place order'}
              </Button>
            </form>
          </Card>
        </aside>
      </main>
    </div>
  );
}
