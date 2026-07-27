/**
 * The ONLY package allowed to call DurableObjectNamespace.idFromName / getByName
 * for tenant routing. ESLint enforces this boundary.
 */

export type TenantRoute = {
  orgId: string;
  propertyId: string;
  jurisdiction: 'eu' | 'us' | 'fedramp' | null;
  locationHint?: string;
};

export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  jurisdiction?(j: string): DurableObjectNamespaceLike;
  get(id: unknown, options?: { locationHint?: string }): unknown;
};

export function resolvePropertyStub(
  ns: DurableObjectNamespaceLike,
  route: TenantRoute,
): unknown {
  const scoped = route.jurisdiction && ns.jurisdiction ? ns.jurisdiction(route.jurisdiction) : ns;
  const id = scoped.idFromName(route.propertyId);
  return scoped.get(id, route.locationHint ? { locationHint: route.locationHint } : undefined);
}

/** Sentinel used by lint tests — do not call idFromName elsewhere. */
export const TENANT_ROUTER_PACKAGE = '@hospai/tenant-router';
