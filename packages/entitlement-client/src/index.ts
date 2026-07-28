import {
  COMMAND_CATALOG,
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  type EntitlementSnapshot,
  type FeatureKey,
  type FeatureValue,
} from '@hospai/contracts';
import { resolveOrgEntitlementStub } from '@hospai/tenant-router';

export type EntitlementEnv = {
  PLATFORM_DB: D1Database;
  ENTITLEMENT_KV: KVNamespace;
  ORG_ENTITLEMENT_DO: DurableObjectNamespace;
};

export class EntitlementRequiredError extends Error {
  readonly code = ENTITLEMENT_REQUIRED;

  constructor(public readonly featureKey: FeatureKey) {
    super(`Entitlement required: ${featureKey}`);
    this.name = 'EntitlementRequiredError';
  }
}

export class EntitlementResolutionError extends Error {
  readonly code = ENTITLEMENT_UNAVAILABLE;

  constructor(cause?: unknown) {
    super('Entitlement resolution failed', { cause });
    this.name = 'EntitlementResolutionError';
  }
}

export type EntitlementDenial =
  | { ok: false; error: typeof ENTITLEMENT_REQUIRED }
  | { ok: false; error: typeof ENTITLEMENT_UNAVAILABLE };

function snapshotKvKey(orgId: string, version: number): string {
  return `ent:${orgId}:v${version}`;
}

function killKvKey(featureKey: FeatureKey): string {
  return `kill:${featureKey}`;
}

export function parseFeatureValue(type: string, raw: string): FeatureValue {
  if (type === 'BOOLEAN') return raw === 'true';
  if (type === 'LIMIT') return Number(raw);
  return raw;
}

export function require(snapshot: EntitlementSnapshot, featureKey: FeatureKey): void {
  const val = snapshot.features[featureKey];
  if (featureKey === 'pms.core') {
    if (val === true) return;
    throw new EntitlementRequiredError(featureKey);
  }
  if (featureKey === 'pms.units.limit') {
    if (typeof val === 'number' && val > 0) return;
    throw new EntitlementRequiredError(featureKey);
  }
  if (val === true) return;
  throw new EntitlementRequiredError(featureKey);
}

export async function checkKillSwitch(env: EntitlementEnv, featureKey: FeatureKey): Promise<boolean> {
  const killed = await env.ENTITLEMENT_KV.get(killKvKey(featureKey), { cacheTtl: 60 });
  return killed !== null && killed !== '';
}

export async function loadSnapshot(
  env: EntitlementEnv,
  orgId: string,
  opts?: { version?: number },
): Promise<EntitlementSnapshot> {
  try {
    let version = opts?.version;
    if (version === undefined) {
      const sub = await env.PLATFORM_DB.prepare(
        `SELECT entitlement_version FROM subscription WHERE org_id = ? AND status = 'active'`,
      )
        .bind(orgId)
        .first<{ entitlement_version: number }>();
      version = sub?.entitlement_version ?? 0;
    }

    const key = snapshotKvKey(orgId, version);
    const cached = await env.ENTITLEMENT_KV.get<EntitlementSnapshot>(key, 'json');
    if (cached) return cached;

    const stub = resolveOrgEntitlementStub(env.ORG_ENTITLEMENT_DO, orgId) as {
      resolveEntitlements(orgId: string): Promise<EntitlementSnapshot>;
    };
    const snap = await stub.resolveEntitlements(orgId);
    await env.ENTITLEMENT_KV.put(key, JSON.stringify(snap), { expirationTtl: 3600 });
    return snap;
  } catch (e) {
    if (e instanceof EntitlementRequiredError) throw e;
    throw new EntitlementResolutionError(e);
  }
}

/** Version-keyed in-DO cache — safe for lifetime of `version` (§6.3). */
export class EntitlementDoCache {
  private snap: EntitlementSnapshot | null = null;

  invalidate(): void {
    this.snap = null;
  }

  async load(env: EntitlementEnv, orgId: string): Promise<EntitlementSnapshot> {
    if (this.snap && this.snap.orgId === orgId) return this.snap;
    this.snap = await loadSnapshot(env, orgId);
    return this.snap;
  }
}

export async function assertEntitled(
  env: EntitlementEnv,
  cache: EntitlementDoCache,
  orgId: string,
  featureKey: FeatureKey,
): Promise<EntitlementDenial | { ok: true }> {
  try {
    const snap = await cache.load(env, orgId);
    require(snap, featureKey);
    return { ok: true };
  } catch (e) {
    if (e instanceof EntitlementRequiredError) {
      return { ok: false, error: ENTITLEMENT_REQUIRED };
    }
    return { ok: false, error: ENTITLEMENT_UNAVAILABLE };
  }
}

export function mapCommandEntitlement(commandId: string): FeatureKey | undefined {
  return COMMAND_CATALOG.find((c) => c.id === commandId)?.entitlement;
}

export { killKvKey, snapshotKvKey };
