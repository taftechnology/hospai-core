import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import { api, asClassified, tenant } from '../client.js';
import { homePathFor } from './home-path.js';
import { meShellStateFromQuery, type PropertyMe } from './me.js';

/** `/` → the actor's home (R2.6). Waits for /me so a housekeeping-only member never sees the Dashboard flash. */
export function HomeRedirect() {
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
  if (shell.kind === 'authority' && shell.authority.kind === 'pending') return null;
  const me = shell.kind === 'authority' && shell.authority.kind === 'live' ? shell.authority.me : null;
  return <Navigate to={homePathFor(me)} replace />;
}
