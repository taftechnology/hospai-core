import type { OrgRole } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';

/**
 * In-DO cache for effective roles — avoids per-command OrgDO RPC on hot paths.
 *
 * Revocation lag: up to {@link PermissionDoCache.MAX_AGE_MS} after membership or
 * property-role changes in OrgDO. There is no cross-DO invalidation signal in Phase 1
 * (contrast entitlement snapshots, which are version-keyed). Accepted tradeoff until
 * KV permission projection (ARCHITECTURE §4.3).
 */
export class PermissionDoCache {
  private cache = new Map<string, { role: OrgRole; cachedAt: number }>();

  static readonly MAX_AGE_MS = 60_000;

  async getEffectiveRole(
    orgDo: DurableObjectNamespace,
    orgId: string,
    propertyId: string,
    userId: string,
  ): Promise<OrgRole | null> {
    const key = `${userId}:${propertyId}`;
    const now = Date.now();
    const entry = this.cache.get(key);
    if (entry && now - entry.cachedAt < PermissionDoCache.MAX_AGE_MS) {
      return entry.role;
    }

    const org = resolveOrgStub(orgDo, { orgId }) as {
      getEffectiveRole(userId: string, propertyId: string | null): Promise<OrgRole | null>;
    };
    const role = await org.getEffectiveRole(userId, propertyId);
    if (!role) {
      this.cache.delete(key);
      return null;
    }
    this.cache.set(key, { role, cachedAt: now });
    return role;
  }

  /** Clears cached roles — test-only; see degraded-mode spec test 6b. */
  invalidate(): void {
    this.cache.clear();
  }
}
