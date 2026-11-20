import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, tenant } from '../client.js';

/**
 * Name for a staff user id, from the property's member list (same cache as the Staff screen).
 * Only asks when the viewer may read staff; unknown ids resolve to null so callers can fall back
 * to a plain word instead of showing the id.
 */
export function usePropertyActorLabel(enabled: boolean) {
  const propertyId = tenant.propertyId;
  const members = useQuery({
    queryKey: ['property-members', propertyId],
    queryFn: () => api.listPropertyMembers(propertyId),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return useCallback(
    (actor: string): string | null => {
      const member = members.data?.members.find((m) => m.userId === actor);
      return member?.displayName ?? member?.email ?? null;
    },
    [members.data],
  );
}
