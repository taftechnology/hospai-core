import { useQuery } from '@tanstack/react-query';
import { api, tenant } from '../client.js';

/**
 * The property's open business date, from the property read (night audit rolls it, so it can
 * trail the property-local calendar date). Null until the read settles or when it is unset.
 */
export function usePropertyBusinessDate(): string | null {
  const q = useQuery({
    queryKey: ['property', tenant.propertyId],
    queryFn: () => api.getProperty(tenant.propertyId),
    staleTime: 60_000,
    retry: false,
  });
  return q.data && 'property' in q.data ? (q.data.businessDate ?? null) : null;
}
