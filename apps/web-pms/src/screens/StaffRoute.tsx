import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { StaffScreen } from './StaffScreen.js';

/**
 * Permission gate before StaffScreen so deep-links without staff:read never
 * mount the screen (and thus never fire Clerk-backed member list queries).
 */
export function StaffRoute() {
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
    if (!hasPropertyPermission(shell.authority.me, 'staff:read')) {
      return <Navigate to="/arrivals" replace />;
    }
    return <StaffScreen />;
  }

  // unknown → fail open (match nav)
  return <StaffScreen />;
}
