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

export type OrgRoute = {
  orgId: string;
  locationHint?: string;
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

export class InvalidTimeZoneError extends Error {
  constructor(public readonly timeZone: string) {
    super(`Invalid IANA time zone: ${timeZone}`);
    this.name = 'InvalidTimeZoneError';
  }
}

/**
 * Best-effort Cloudflare locationHint from an IANA timezone (§4.5).
 * Latency only — never used for residency.
 */
export function locationHintFromTimeZone(timeZone: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    throw new InvalidTimeZoneError(timeZone);
  }

  const area = timeZone.split('/')[0] ?? '';
  const rest = timeZone.slice(area.length + 1);

  switch (area) {
    case 'America':
      // Rough split: eastern Canada/US/Caribbean → enam; rest of Americas → wnam
      if (
        /^(New_York|Toronto|Montreal|Detroit|Indiana|Kentucky|Louisville|Iqaluit|Nipigon|Thunder_Bay|Pangnirtung|Glace_Bay|Goose_Bay|Halifax|Moncton|Blanc-Sablon|St_Johns|Puerto_Rico|Antigua|Barbados|Dominica|Grenada|Guadeloupe|Martinique|St_Kitts|St_Lucia|St_Thomas|St_Vincent|Tortola|Port_of_Spain|Curacao|Aruba|Cayman|Jamaica|Nassau|Havana|Santo_Domingo|Port-au-Prince)/.test(
          rest,
        )
      ) {
        return 'enam';
      }
      return 'wnam';
    case 'Europe':
      if (/^(Moscow|Istanbul|Helsinki|Kyiv|Riga|Tallinn|Vilnius|Minsk|Bucharest|Sofia|Athens|Nicosia)/.test(rest)) {
        return 'eeur';
      }
      return 'weur';
    case 'Asia':
      return 'apac';
    case 'Australia':
    case 'Pacific':
      return 'oc';
    case 'Africa':
      return 'weur';
    case 'Atlantic':
      return rest.startsWith('Cape_Verde') || rest.startsWith('Azores') ? 'weur' : 'enam';
    case 'Indian':
      return 'apac';
    default:
      return 'wnam';
  }
}

/**
 * Resolve a PropertyDO stub. Fails closed when the route demands a jurisdiction
 * the namespace cannot apply — never silently opens the default namespace.
 *
 * Local workerd does not implement `namespace.jurisdiction()` (throws). Pass
 * `simulateJurisdiction: true` (via env HOSPAI_JURISDICTION_MODE=simulate) to
 * encode jurisdiction into the object name so EU/default storage never collide.
 * Production must leave simulation off.
 */
export function resolvePropertyStub(
  ns: DurableObjectNamespaceLike,
  route: TenantRoute,
  options?: { simulateJurisdiction?: boolean },
): unknown {
  let scoped = ns;
  if (route.jurisdiction !== null) {
    if (typeof ns.jurisdiction !== 'function') {
      throw new JurisdictionUnavailableError(route.jurisdiction, route.propertyId);
    }
    try {
      scoped = ns.jurisdiction(route.jurisdiction);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (options?.simulateJurisdiction && /not implemented/i.test(msg)) {
        const j = route.jurisdiction;
        const base = ns;
        scoped = {
          idFromName(name: string) {
            return base.idFromName(`${j}::${name}`);
          },
          get(id: unknown, opts?: { locationHint?: string }) {
            return base.get(id, opts);
          },
        };
      } else if (/not implemented/i.test(msg)) {
        throw new JurisdictionUnavailableError(route.jurisdiction, route.propertyId);
      } else {
        throw e;
      }
    }
  }
  const id = scoped.idFromName(route.propertyId);
  return scoped.get(id, route.locationHint ? { locationHint: route.locationHint } : undefined);
}

/** Resolve an OrgDO stub (orgs are not jurisdiction-scoped in this spine). */
export function resolveOrgStub(ns: DurableObjectNamespaceLike, route: OrgRoute): unknown {
  const id = ns.idFromName(route.orgId);
  return ns.get(id, route.locationHint ? { locationHint: route.locationHint } : undefined);
}

/** Resolve an OrgEntitlementDO stub (same orgId naming as OrgDO). */
export function resolveOrgEntitlementStub(ns: DurableObjectNamespaceLike, orgId: string): unknown {
  const id = ns.idFromName(orgId);
  return ns.get(id);
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
