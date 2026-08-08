import { V1_HTTP_ROUTE_AUDIT } from '@hospai/contracts/v1-http-routes';

export function permissionForForbidden(body: unknown, routeId: string): string | null {
  if (body !== null && typeof body === 'object') {
    const p = (body as Record<string, unknown>).permission;
    if (typeof p === 'string' && p.length > 0) return p;
  }
  const row = V1_HTTP_ROUTE_AUDIT.find((r) => r.id === routeId);
  if (row && 'permission' in row && typeof row.permission === 'string') {
    return row.permission;
  }
  return null;
}
