import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from '../auth/me.js';
import { api, asClassified, tenant } from '../client.js';
import { BookingScreen } from './BookingScreen.js';

/**
 * Permission gate before BookingScreen so deep-links without reservations:write
 * never mount the wizard (and thus never fire availability / guest writes).
 */
export function BookRoute() {
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
    if (!hasPropertyPermission(shell.authority.me, 'reservations:write')) {
      return <Navigate to="/arrivals" replace />;
    }
    return <BookingScreen />;
  }

  // unknown → fail open (match nav)
  return <BookingScreen />;
}
