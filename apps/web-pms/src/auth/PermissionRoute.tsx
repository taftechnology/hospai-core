import type { PropertyScopedPermission } from '@hospai/contracts';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router';
import {
  hasPropertyPermission,
  meShellStateFromQuery,
  type PropertyMe,
} from './me.js';
import { setPermissionDenyFlash } from '../shell/PermissionDenyFlash.js';
import { deniedFallbackFor } from './home-path.js';
import { api, asClassified, tenant } from '../client.js';

export type PermissionRouteProps = {
  permission: PropertyScopedPermission;
  /**
   * Redirect target when live authority lacks permission. Default: `/arrivals` for the desk,
   * the actor's own home otherwise (R2.6 — a housekeeping-only member goes to Housekeeping).
   */
  fallback?: string;
};

/**
 * Shared permission gate for property-scoped routes. Renders nested routes via
 * `<Outlet/>` on pass — never mounts a screen directly.
 */
export function PermissionRoute({ permission, fallback }: PermissionRouteProps) {
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
    if (!hasPropertyPermission(shell.authority.me, permission)) {
      setPermissionDenyFlash();
      return <Navigate to={fallback ?? deniedFallbackFor(shell.authority.me)} replace />;
    }
    return <Outlet />;
  }

  // unknown → fail open (audit Do-not-fix — deliberate)
  return <Outlet />;
}
