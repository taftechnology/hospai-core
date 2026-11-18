import { hasPropertyPermission, type PropertyMe } from './me.js';

/**
 * R2.6: where a signed-in actor lands, from their live permissions — not a role name and not a
 * role switcher. The desk (anyone who can read reservations) starts on the Dashboard as before.
 * An actor who cannot read reservations but can read housekeeping (a housekeeping-only member)
 * starts on Housekeeping; maintenance-only starts on Maintenance. Unknown authority keeps the
 * Dashboard (fail open, like PermissionRoute).
 */
export function homePathFor(me: PropertyMe | null | undefined): string {
  if (!me) return '/dashboard';
  if (hasPropertyPermission(me, 'reservations:read')) return '/dashboard';
  if (hasPropertyPermission(me, 'housekeeping:read')) return '/housekeeping';
  if (hasPropertyPermission(me, 'maintenance:read')) return '/maintenance';
  return '/dashboard';
}

/**
 * Where PermissionRoute sends a denied actor when the route names no fallback. The desk keeps
 * Arrivals; anyone who cannot read reservations goes to their own home instead of a page that
 * would only fail again.
 */
export function deniedFallbackFor(me: PropertyMe): string {
  return hasPropertyPermission(me, 'reservations:read') ? '/arrivals' : homePathFor(me);
}
