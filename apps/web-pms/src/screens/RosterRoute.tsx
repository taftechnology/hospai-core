import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { RosterScreen } from './RosterScreen.js';

/**
 * Permission gate before RosterScreen so deep-links without roster:write never
 * mount the HR roster (staff-role peers use the housekeeping picker instead).
 */
export function RosterRoute() {
  const propertyId = tenant.propertyId;
  const meQuery = useQuery({
    queryKey: ['me', propertyId],
    queryFn: () => api.getMe(propertyId),
    staleTime: 60_000,
    retry: false,
  });

  const shell = meShellStateFromQuery({
    status: meQuery.status,
    data: meQuery.data as PropertyMe | undefined,
    classified: meQuery.isError ? asClassified(meQuery.error) : undefined,
  });

  if (shell.kind !== 'authority') {
    return null;
  }

  if (shell.authority.kind === 'pending') {
    return null;
  }

  if (shell.authority.kind === 'live') {
    if (!hasPropertyPermission(shell.authority.me, 'roster:write')) {
      return <Navigate to="/arrivals" replace />;
    }
    return <RosterScreen />;
  }

  return <RosterScreen />;
}
