import { useQuery } from '@tanstack/react-query';
import { api, asClassified, tenant } from '../client.js';

export function usePropertySubtitle(prefix: string): { subtitle: string } {
  const propertyId = tenant.propertyId;
  const q = useQuery({
    queryKey: ['property', propertyId],
    queryFn: () => api.getProperty(propertyId),
    staleTime: 60_000,
    retry: false,
  });
  const failClosed = q.isError && asClassified(q.error).class === 'fail_closed';
  const name =
    !failClosed && q.data && 'property' in q.data ? q.data.property.name : null;
  return { subtitle: name ? `${prefix} · ${name}` : prefix };
}
