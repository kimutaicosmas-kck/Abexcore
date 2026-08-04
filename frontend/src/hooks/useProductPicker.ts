import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../services/api';
import { Product } from '../types';

/**
 * Lightweight product list for pages that still need a small catalog snapshot.
 * Prefer {@link ProductSearchSelect} for product fields — it searches server-side.
 */
export function useProductPicker(search?: string) {
  return useQuery({
    queryKey: ['products', 'picker', search || ''],
    queryFn: () =>
      productsApi
        .list({
          page: 1,
          limit: 40,
          isActive: true,
          search: search?.trim() || undefined,
        })
        .then((r) => r.data.data as Product[]),
    staleTime: 30_000,
  });
}
