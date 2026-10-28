import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ProductCategoryRead, ProductItemRead } from '@hospai/client-core';
import { api, tenant } from '../client.js';

export type ProductGroup = { category: ProductCategoryRead; items: ProductItemRead[] };

/**
 * Active, postable products grouped by active category (R1.5 spec §2.7) for the
 * *Post charge* pickers. Same key the Settings tab invalidates.
 */
export function usePostableProducts(enabled = true) {
  const propertyId = tenant.propertyId;
  const query = useQuery({
    queryKey: ['products', propertyId, 'active'],
    queryFn: () => api.listProducts(propertyId, { status: 'active' }),
    enabled,
    retry: false,
  });
  const groups = useMemo<ProductGroup[]>(() => {
    const data = query.data;
    if (!data) return [];
    return data.categories
      .filter((c) => c.status === 'active')
      .map((category) => ({
        category,
        items: data.items.filter((i) => i.categoryId === category.categoryId && i.postable),
      }))
      .filter((g) => g.items.length > 0);
  }, [query.data]);
  const byId = useMemo(
    () => new Map(groups.flatMap((g) => g.items.map((i) => [i.productId, i] as const))),
    [groups],
  );
  return { query, groups, byId, hasProducts: byId.size > 0 };
}
