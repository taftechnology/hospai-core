/**
 * The ONLY package allowed to call DurableObjectNamespace.idFromName / getByName
 * for tenant routing. ESLint enforces this boundary.
 */

export type Jurisdiction = 'eu' | 'us' | 'fedramp';

export type TenantRoute = {
  orgId: string;
  propertyId: string;
  /** null = deliberately non-jurisdictional tenant. Non-null MUST use ns.jurisdiction(). */
  jurisdiction: Jurisdiction | null;
  locationHint?: string;
  /**
   * Expected jurisdiction recorded on the tenant registry for DO self-check.
   * When set on the DO, cold-start asserts ctx.id.jurisdiction matches.
   */
  recordedJurisdiction?: Jurisdiction | null;
};

export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  getByName?(name: string): unknown;
  jurisdiction?(j: string): DurableObjectNamespaceLike;
  get(id: unknown, options?: { locationHint?: string }): unknown;
};

export class JurisdictionUnavailableError extends Error {
  constructor(
    public readonly requested: Jurisdiction,
    public readonly propertyId: string,
  ) {
    super(
      `Jurisdiction '${requested}' required for property ${propertyId}, but namespace.jurisdiction() is unavailable. Refusing to open the default namespace (ARCHITECTURE §4.5).`,
    );
    this.name = 'JurisdictionUnavailableError';
  }
}

export class JurisdictionMismatchError extends Error {
  constructor(
    public readonly expected: Jurisdiction | null | undefined,
    public readonly actual: string | null | undefined,
  ) {
    super(
      `PropertyDO jurisdiction mismatch: expected ${String(expected)}, got ${String(actual)}. Refusing to serve (ARCHITECTURE §4.5 rule 4).`,
    );
    this.name = 'JurisdictionMismatchError';
  }
}

/**
 * Resolve a PropertyDO stub. Fails closed when the route demands a jurisdiction
 * the namespace cannot apply — never silently opens the default namespace.
 */
export function resolvePropertyStub(
  ns: DurableObjectNamespaceLike,
  route: TenantRoute,
): unknown {
  let scoped = ns;
  if (route.jurisdiction !== null) {
    if (typeof ns.jurisdiction !== 'function') {
      throw new JurisdictionUnavailableError(route.jurisdiction, route.propertyId);
    }
    scoped = ns.jurisdiction(route.jurisdiction);
  }
  const id = scoped.idFromName(route.propertyId);
  return scoped.get(id, route.locationHint ? { locationHint: route.locationHint } : undefined);
}

/** Assert DO instance jurisdiction matches the registry. Call on cold start. */
export function assertJurisdictionMatch(
  actual: string | null | undefined,
  expected: Jurisdiction | null | undefined,
): void {
  // undefined expected = not yet wired (dev stubs); null expected = non-jurisdictional
  if (expected === undefined) return;
  const normalizedActual = actual ?? null;
  if (normalizedActual !== expected) {
    throw new JurisdictionMismatchError(expected, normalizedActual);
  }
}

/** Sentinel used by lint tests — do not call idFromName / getByName elsewhere. */
export const TENANT_ROUTER_PACKAGE = '@hospai/tenant-router';
