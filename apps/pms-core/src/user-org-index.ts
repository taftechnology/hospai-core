/**
 * R4.4 discovery index (platform D1 `user_org`): which orgs to look in for a user.
 *
 * Ids only. It is never used to authorize anything: `GET /v1/me/tenants` re-checks every org it
 * names against that org's OrgDO. A stale or missing row is therefore harmless, which is why every
 * write here is best effort: it runs after the OrgDO write has committed, never inside a
 * `transactionSync`, and a D1 failure logs `user_org.index_write_failed` (ids only) without
 * failing the request.
 */
import { logWarn } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import { ensurePlatformSchema } from './registry.js';

/** Orgs read per user; over the cap the most recently updated win. */
export const USER_ORG_LIST_CAP = 20;

const INDEX_WRITE_FAILED = 'user_org.index_write_failed';

function warnIndexWrite(userId: string, orgId: string): void {
  logWarn({ moduleId: 'pms.core', userId, orgId }, { msg: INDEX_WRITE_FAILED });
}

/** Upsert `(userId, orgId)`. Never throws. */
export async function indexUserOrg(env: PmsEnv, userId: string, orgId: string): Promise<void> {
  try {
    await ensurePlatformSchema(env.PLATFORM_DB);
    await env.PLATFORM_DB.prepare(
      `INSERT INTO user_org (user_id, org_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id, org_id) DO UPDATE SET updated_at = excluded.updated_at`,
    )
      .bind(userId, orgId, Date.now())
      .run();
  } catch {
    warnIndexWrite(userId, orgId);
  }
}

/**
 * Delete `(userId, orgId)` only when the OrgDO reports no remaining membership (org `member` row
 * or any `property_member` grant). `hasAnyMembership` is the OrgDO's answer; if it cannot be
 * read the row stays (a stale row is harmless). Never throws.
 */
export async function unindexUserOrgIfNoMembership(
  env: PmsEnv,
  userId: string,
  orgId: string,
  hasAnyMembership: () => Promise<boolean>,
): Promise<void> {
  try {
    if (await hasAnyMembership()) return;
    await ensurePlatformSchema(env.PLATFORM_DB);
    await env.PLATFORM_DB.prepare(`DELETE FROM user_org WHERE user_id = ? AND org_id = ?`)
      .bind(userId, orgId)
      .run();
  } catch {
    warnIndexWrite(userId, orgId);
  }
}

/** Orgs the index lists for a user: at most {@link USER_ORG_LIST_CAP}, newest update first. */
export async function listIndexedOrgIds(env: PmsEnv, userId: string): Promise<string[]> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const res = await env.PLATFORM_DB.prepare(
    `SELECT org_id FROM user_org WHERE user_id = ? ORDER BY updated_at DESC, org_id LIMIT ?`,
  )
    .bind(userId, USER_ORG_LIST_CAP)
    .all<{ org_id: string }>();
  return (res.results ?? []).map((r) => r.org_id);
}

/** Org purge: remove every index row for the org. Returns the number of rows deleted. */
export async function deleteUserOrgRowsForOrg(env: PmsEnv, orgId: string): Promise<number> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const res = await env.PLATFORM_DB.prepare(`DELETE FROM user_org WHERE org_id = ?`)
    .bind(orgId)
    .run();
  return Number(res.meta?.changes ?? 0);
}
