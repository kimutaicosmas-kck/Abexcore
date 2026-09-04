import { useEffect, useState } from 'react';
import { Control, Controller, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { FieldArrayWithId } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { productsApi } from '../../services/api';
import { Product } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';
import { formatCurrency } from '../ui';
import { Button, Input } from '../ui';
import { ProductSearchSelect } from './ProductSearchSelect';

export type ProductLineItemValues = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  id?: string;
  productLabel?: string;
  confirmedDeliveredQty?: number;
};

interface ProductLineItemsEditorProps {
  fields: FieldArrayWithId[];
  items: ProductLineItemValues[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: UseFormRegister<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue: UseFormSetValue<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errors: FieldErrors<any>;
  onAppend: () => void;
  onRemove: (index: number) => void;
  isVatCustomer?: boolean;
  sectionLabel?: string;
  /** Return false to disable remove for a row (e.g. delivered qty lock). Default: fields.length > 1 */
  canRemoveItem?: (index: number, item: ProductLineItemValues | undefined) => boolean;
  /** When false, product is read-only in the editor (existing order lines). */
  isProductEditable?: (index: number, item: ProductLineItemValues | undefined) => boolean;
  /** Static product label when not editable. */
  getProductLabel?: (index: number, item: ProductLineItemValues | undefined) => string | undefined;
  /** Extra hidden fields / notes above product in the editor row. */
  renderEditorExtras?: (index: number, item: ProductLineItemValues | undefined) => React.ReactNode;
  /** Minimum quantity for the active row (e.g. delivered qty floor). */
  getQuantityMin?: (index: number, item: ProductLineItemValues | undefined) => number;
  allowAdd?: boolean;
  onProductSelected?: (index: number, product: Product | null) => void;
}

function ProductLineLabel({ productId }: { productId: string }) {
  const { data: product } = useQuery({
    queryKey: ['products', 'selected', productId],
    queryFn: () => productsApi.get(productId).then((r) => r.data.data),
    enabled: Boolean(productId),
    staleTime: 60_000,
  });

  if (!productId) return <span className="text-slate-400 italic">No product</span>;
  if (!product) return <span className="text-slate-500">Loading…</span>;
  return <span className="truncate">{formatProductOptionLabel(product)}</span>;
}

function itemFieldError(
  errors: FieldErrors<any>,
  index: number,
  field: 'productId' | 'quantity' | 'unitPrice' | 'discount'
): string | undefined {
  const itemsErr = errors.items as Record<number, Record<string, { message?: string }>> | undefined;
  return itemsErr?.[index]?.[field]?.message;
}

function lineTotal(item: ProductLineItemValues | undefined) {
  const qty = Number(item?.quantity || 0);
  const price = Number(item?.unitPrice || 0);
  const discount = Number(item?.discount || 0);
  return Math.round(qty * price * (1 - discount / 100));
}

export function ProductLineItemsEditor({
  fields,
  items,
  control,
  register,
  setValue,
  errors,
  onAppend,
  onRemove,
  isVatCustomer = false,
  sectionLabel = 'Items',
  canRemoveItem,
  isProductEditable = () => true,
  getProductLabel,
  renderEditorExtras,
  getQuantityMin,
  allowAdd = true,
  onProductSelected,
}: ProductLineItemsEditorProps) {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, fields.length - 1));

  useEffect(() => {
    setActiveIndex((current) => {
      if (fields.length === 0) return 0;
      if (current >= fields.length) return fields.length - 1;
      return current;
    });
  }, [fields.length]);

  const handleAppend = () => {
    onAppend();
    setActiveIndex(fields.length);
  };

  const handleRemove = (index: number) => {
    onRemove(index);
    setActiveIndex((current) => {
      if (index < current) return current - 1;
      if (index === current) return Math.max(0, current - 1);
      return current;
    });
  };

  const frozenIndices = fields
    .map((_, index) => index)
    .filter((index) => index !== activeIndex);
  const activeItem = items[activeIndex];
  const activeLineTotal = lineTotal(activeItem);
  const productEditable = isProductEditable(activeIndex, activeItem);
  const readOnlyLabel = getProductLabel?.(activeIndex, activeItem);
  const quantityMin = getQuantityMin?.(activeIndex, activeItem) ?? 1;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-slate-800">{sectionLabel} *</label>
        {allowAdd && (
          <Button type="button" size="sm" variant="secondary" onClick={handleAppend}>
            <Plus className="mr-1 h-3 w-3" /> Add Item
          </Button>
        )}
      </div>

      {errors.items && typeof errors.items === 'object' && 'message' in errors.items && (
        <p className="mb-2 text-sm text-red-600">{String(errors.items.message)}</p>
      )}

      {fields[activeIndex] && (
        <div className="mb-3 rounded-2xl border border-primary-100 bg-white p-3 shadow-sm sm:p-4 space-y-3 ring-1 ring-primary-50">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">
              {activeIndex === fields.length - 1 && frozenIndices.length > 0
                ? 'New item'
                : frozenIndices.length > 0
                  ? `Editing item ${activeIndex + 1}`
                  : `Item ${activeIndex + 1}`}
            </p>
            {fields.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!px-2 !py-1 shrink-0"
                disabled={
                  canRemoveItem
                    ? !canRemoveItem(activeIndex, activeItem)
                    : false
                }
                onClick={() => handleRemove(activeIndex)}
                aria-label={`Remove item ${activeIndex + 1}`}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>

          {renderEditorExtras?.(activeIndex, activeItem)}

          {productEditable ? (
            <Controller
              name={`items.${activeIndex}.productId`}
              control={control}
              render={({ field: productField }) => (
                <ProductSearchSelect
                  label="Product"
                  value={productField.value}
                  onChange={productField.onChange}
                  onProductSelect={(product) => {
                    onProductSelected?.(activeIndex, product ?? null);
                    if (product) {
                      const currentPrice = items[activeIndex]?.unitPrice;
                      if (!currentPrice || currentPrice === 0) {
                        setValue(`items.${activeIndex}.unitPrice`, Number(product.sellingPrice));
                      }
                    }
                  }}
                  error={itemFieldError(errors, activeIndex, 'productId')}
                />
              )}
            />
          ) : (
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Product</p>
              <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-900">
                {readOnlyLabel || 'Product'}
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Input
              label="Qty"
              type="number"
              min={quantityMin}
              inputMode="numeric"
              {...register(`items.${activeIndex}.quantity`)}
              error={itemFieldError(errors, activeIndex, 'quantity')}
            />
            <Input
              label={isVatCustomer ? 'Price*' : 'Price'}
              type="number"
              step="0.01"
              inputMode="decimal"
              title={isVatCustomer ? 'Price includes VAT' : undefined}
              {...register(`items.${activeIndex}.unitPrice`)}
              error={itemFieldError(errors, activeIndex, 'unitPrice')}
            />
            <Input
              label="Disc %"
              type="number"
              min={0}
              max={100}
              inputMode="decimal"
              {...register(`items.${activeIndex}.discount`)}
              error={itemFieldError(errors, activeIndex, 'discount')}
            />
          </div>

          {isVatCustomer && (
            <p className="-mt-1 text-[11px] text-slate-500">* Price includes VAT</p>
          )}

          <div className="flex items-center justify-between border-t border-slate-200/80 pt-2">
            <span className="text-xs text-slate-500">Line total</span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {formatCurrency(activeLineTotal)}
            </span>
          </div>
        </div>
      )}

      {frozenIndices.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Added items ({frozenIndices.length})
            </p>
          </div>
          <div className="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-2 py-2 font-semibold text-right w-14">Qty</th>
                  <th className="px-2 py-2 font-semibold text-right w-24">Price</th>
                  <th className="hidden px-2 py-2 font-semibold text-right w-16 sm:table-cell">Disc</th>
                  <th className="px-2 py-2 font-semibold text-right w-24">Total</th>
                  <th className="px-2 py-2 w-20" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...frozenIndices].reverse().map((index) => {
                  const item = items[index];
                  const removable = canRemoveItem
                    ? canRemoveItem(index, item)
                    : fields.length > 1;
                  return (
                    <tr
                      key={fields[index].id}
                      className={clsx(
                        'hover:bg-primary-50/40',
                        !item?.productId && 'bg-amber-50/40'
                      )}
                    >
                      <td className="max-w-[220px] px-3 py-2.5 font-medium text-slate-900">
                        <ProductLineLabel productId={item?.productId || ''} />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                        {item?.quantity ?? '—'}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                        {formatCurrency(Number(item?.unitPrice || 0))}
                      </td>
                      <td className="hidden px-2 py-2.5 text-right tabular-nums text-slate-600 sm:table-cell">
                        {Number(item?.discount || 0)}%
                      </td>
                      <td className="px-2 py-2.5 text-right font-medium tabular-nums text-slate-900">
                        {formatCurrency(lineTotal(item))}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => setActiveIndex(index)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-primary-700"
                            title="Edit item"
                            aria-label={`Edit item ${index + 1}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!removable}
                            onClick={() => handleRemove(index)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                            title={removable ? 'Remove item' : 'Cannot remove'}
                            aria-label={`Remove item ${index + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
