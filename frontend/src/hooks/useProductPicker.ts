import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../services/api';
import { Product } from '../types';

/** Active products for order/quote/inventory dropdowns. */
export function useProductPicker() {
  return useQuery({
    queryKey: ['products', 'picker'],
    queryFn: () =>
      productsApi
        .list({ limit: 500, isActive: true })
        .then((r) => r.data.data as Product[]),
  });
}
