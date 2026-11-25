import type { OrgScopedPermission } from '@hospai/contracts';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import { hasOrgPermission, meShellStateFromQuery, type PropertyMe } from './me.js';
import { setPermissionDenyFlash } from '../shell/PermissionDenyFlash.js';
import { deniedFallbackFor } from './home-path.js';
import { api, asClassified, tenant } from '../client.js';

/**
 * Gate for org-scope routes (Hotels today, R7.4): the same rules as `PermissionRoute`, checked
 * against the org permissions of the active hotel's `/me`. The server still decides; this only
 * keeps a user without the permission off the page.
 */
export function OrgPermissionRoute({ permission }: { permission: OrgScopedPermission }) {
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
  if (shell.kind !== 'authority' || shell.authority.kind === 'pending') return null;
  if (shell.authority.kind === 'live') {
    if (!hasOrgPermission(shell.authority.me, permission)) {
      setPermissionDenyFlash();
      return <Navigate to={deniedFallbackFor(shell.authority.me)} replace />;
    }
    return <Outlet />;
  }
  return <Outlet />;
}
