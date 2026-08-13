import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';

/**
 * Permission gate before SettingsScreen so deep-links without settings:configure
 * never mount the screen (and thus never fire list queries).
 */
export function SettingsRoute() {
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
    if (!hasPropertyPermission(shell.authority.me, 'settings:configure')) {
      return <Navigate to="/arrivals" replace />;
    }
    return <Outlet />;
  }

  return <Outlet />;
}
