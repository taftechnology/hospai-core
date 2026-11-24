import type { PlanCode, PropertyRecord } from '@hospai/contracts';
import { validateTenantId } from '@hospai/contracts';
import {
  PLATFORM_ALL_STATEMENTS,
  PLATFORM_ORG_SUSPENDED_STATEMENTS,
  PLATFORM_PURGE_ALTERS,
  PLATFORM_PURGE_STATEMENTS,
} from '@hospai/do-runtime';
import type { Jurisdiction } from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';

let schemaReady: Promise<void> | null = null;

async function tableHasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return (results ?? []).some((r) => r.name === column);
}

/**
 * Apply Platform D1 registry DDL via discrete statements (safe for triggers).
 * Call from write paths / test setup only — not on every read.
 * Order: base schema → purge ALTERs (PRAGMA-gated) → purge tables/triggers.
 */
export async function ensurePlatformSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of PLATFORM_ALL_STATEMENTS) {
        await db.prepare(stmt).run();
      }
      for (const alter of PLATFORM_PURGE_ALTERS) {
        if (!(await tableHasColumn(db, alter.table, alter.column))) {
          await db.prepare(alter.sql).run();
        }
      }
      for (const stmt of PLATFORM_PURGE_STATEMENTS) {
        await db.prepare(stmt).run();
      }
      // R7.1 §7: the org lifecycle trigger gains `suspended`. Replace it only when the live one is
      // the pre-R7.1 version, so a running registry is never left without the guard.
      const live = await db
        .prepare(`SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'org_status_update'`)
        .first<{ sql: string | null }>();
      if (!live?.sql?.includes('suspended')) {
        await db.batch(PLATFORM_ORG_SUSPENDED_STATEMENTS.map((stmt) => db.prepare(stmt)));
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

/** Reset schemaReady between isolated tests if needed. */
export function resetPlatformSchemaGate(): void {
  schemaReady = null;
}

export type TenantActiveDenial = 'not_found' | 'tenant_not_active' | 'tenant_suspended';

/**
 * Single control-plane gate for HTTP dispatch, replay, and provisioning.
 *
 * Org status by intent (R7.1 §7): a `write` (the default) passes `active` only, except when the
 * caller sets `allowSuspended` (org cancel: a customer can always leave); a `read` passes `active`
 * and `suspended`. A suspended org that a write meets is `tenant_suspended`, not `tenant_not_active`.
 * An explicit `allowedOrgStatuses` overrides the intent (purge, system consumers).
 */
export async function assertTenantActive(
  env: PmsEnv,
  opts: {
    orgId?: string;
    propertyId?: string;
    intent?: 'read' | 'write';
    allowSuspended?: boolean;
    allowedOrgStatuses?: readonly string[];
    prefetchedProperty?: PropertyRecord;
  },
): Promise<{ ok: true } | { ok: false; error: TenantActiveDenial; status?: string }> {
  const allowedOrgStatuses =
    opts.allowedOrgStatuses ??
    (opts.intent === 'read' || opts.allowSuspended ? ['active', 'suspended'] : ['active']);
  const denyOrg = (status: string): { ok: false; error: TenantActiveDenial; status: string } =>
    status === 'suspended'
      ? { ok: false, error: 'tenant_suspended', status }
      : { ok: false, error: 'tenant_not_active', status };
  await ensurePlatformSchema(env.PLATFORM_DB);
  if (opts.propertyId) {
    const property =
      opts.prefetchedProperty?.propertyId === opts.propertyId
        ? opts.prefetchedProperty
        : await getProperty(env, opts.propertyId);
    if (!property) return { ok: false, error: 'not_found' };
    if (property.status !== 'active') {
      return { ok: false, error: 'tenant_not_active', status: property.status };
    }
    if (opts.orgId && property.orgId !== opts.orgId) {
      return { ok: false, error: 'not_found' };
    }
    const org = await getOrg(env, property.orgId);
    if (!org) return { ok: false, error: 'not_found' };
    if (!allowedOrgStatuses.includes(org.status)) return denyOrg(org.status);
    return { ok: true };
  }
  if (opts.orgId) {
    const org = await getOrg(env, opts.orgId);
    if (!org) return { ok: false, error: 'not_found' };
    if (!allowedOrgStatuses.includes(org.status)) return denyOrg(org.status);
    return { ok: true };
  }
  return { ok: false, error: 'not_found' };
}

function rowToProperty(row: Record<string, unknown>): PropertyRecord {
  return {
    propertyId: String(row.property_id),
    orgId: String(row.org_id),
    name: String(row.name),
    jurisdiction: (row.jurisdiction as Jurisdiction | null) ?? null,
    timeZone: String(row.time_zone),
    status: row.status as PropertyRecord['status'],
    createdAt: Number(row.created_at),
  };
}

export async function getProperty(
  env: PmsEnv,
  propertyId: string,
): Promise<PropertyRecord | null> {
  // Reads assume migrations already applied (deploy / ensurePlatformSchema on writes).
  const row = await env.PLATFORM_DB.prepare(`SELECT * FROM property WHERE property_id = ?`)
    .bind(propertyId)
    .first();
  if (!row) return null;
  return rowToProperty(row as Record<string, unknown>);
}

export async function getOrg(
  env: PmsEnv,
  orgId: string,
): Promise<{ orgId: string; name: string; status: string; createdAt: number } | null> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const row = await env.PLATFORM_DB.prepare(
    `SELECT org_id, name, status, created_at FROM org WHERE org_id = ?`,
  )
    .bind(orgId)
    .first<{ org_id: string; name: string; status: string; created_at: number }>();
  if (!row) return null;
  return {
    orgId: row.org_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
}

export type PageOpts = { limit?: number; after?: string | null };

const DEFAULT_PAGE_LIMIT = 50;

/** Keyset pagination on `org_id` — cursor must match sort key. */
export async function listOrgIds(
  env: PmsEnv,
  opts?: PageOpts,
): Promise<{ ids: string[]; nextAfter: string | null }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
  const after = opts?.after ?? null;

  const { results } = after
    ? await env.PLATFORM_DB.prepare(
        `SELECT org_id FROM org WHERE org_id > ? ORDER BY org_id ASC LIMIT ?`,
      )
        .bind(after, limit)
        .all<{ org_id: string }>()
    : await env.PLATFORM_DB.prepare(`SELECT org_id FROM org ORDER BY org_id ASC LIMIT ?`)
        .bind(limit)
        .all<{ org_id: string }>();

  const ids = (results ?? []).map((r) => r.org_id);
  const nextAfter = ids.length === limit ? ids[ids.length - 1]! : null;
  return { ids, nextAfter };
}

export type LivePropertyRow = {
  propertyId: string;
  orgId: string;
  name: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
};

/**
 * R7.2 health sweep: hotels whose property AND org are live (`active`, or `suspended`, which still
 * runs night audit). Keyset-paged on `property_id`. `listPropertyIds` stays unfiltered for the
 * migration sweep.
 */
export async function listLivePropertiesPage(
  env: PmsEnv,
  opts?: PageOpts,
): Promise<{ rows: LivePropertyRow[]; nextAfter: string | null }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
  const after = opts?.after ?? '';
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT p.property_id, p.org_id, p.name, p.jurisdiction, p.time_zone
     FROM property p JOIN org o ON o.org_id = p.org_id
     WHERE p.status IN ('active', 'suspended') AND o.status IN ('active', 'suspended')
       AND p.property_id > ?
     ORDER BY p.property_id ASC LIMIT ?`,
  )
    .bind(after, limit)
    .all<{
      property_id: string;
      org_id: string;
      name: string;
      jurisdiction: string | null;
      time_zone: string;
    }>();
  const rows = (results ?? []).map((r) => ({
    propertyId: r.property_id,
    orgId: r.org_id,
    name: r.name,
    jurisdiction: (r.jurisdiction as Jurisdiction | null) ?? null,
    timeZone: r.time_zone,
  }));
  const nextAfter = rows.length === limit ? rows[rows.length - 1]!.propertyId : null;
  return { rows, nextAfter };
}

export type PropertySweepRow = {
  propertyId: string;
  orgId: string;
  jurisdiction: Jurisdiction | null;
  timeZone: string;
};

/** Keyset pagination on `property_id`; returns full rows for stub resolution without N+1 reads. */
export async function listPropertyIds(
  env: PmsEnv,
  opts?: PageOpts,
): Promise<{ rows: PropertySweepRow[]; nextAfter: string | null }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
  const after = opts?.after ?? null;

  const { results } = after
    ? await env.PLATFORM_DB.prepare(
        `SELECT property_id, org_id, jurisdiction, time_zone FROM property WHERE property_id > ? ORDER BY property_id ASC LIMIT ?`,
      )
        .bind(after, limit)
        .all<{ property_id: string; org_id: string; jurisdiction: string | null; time_zone: string }>()
    : await env.PLATFORM_DB.prepare(
        `SELECT property_id, org_id, jurisdiction, time_zone FROM property ORDER BY property_id ASC LIMIT ?`,
      )
        .bind(limit)
        .all<{ property_id: string; org_id: string; jurisdiction: string | null; time_zone: string }>();

  const rows = (results ?? []).map((r) => ({
    propertyId: r.property_id,
    orgId: r.org_id,
    jurisdiction: (r.jurisdiction as Jurisdiction | null) ?? null,
    timeZone: r.time_zone,
  }));
  const nextAfter = rows.length === limit ? rows[rows.length - 1]!.propertyId : null;
  return { rows, nextAfter };
}

/** Keyset pagination on `property_id` scoped to one org — for org purge snapshot / verify. */
export async function listPropertiesForOrg(
  env: PmsEnv,
  orgId: string,
  opts?: PageOpts,
): Promise<{ rows: PropertySweepRow[]; nextAfter: string | null }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const limit = opts?.limit ?? DEFAULT_PAGE_LIMIT;
  const after = opts?.after ?? null;

  const { results } = after
    ? await env.PLATFORM_DB.prepare(
        `SELECT property_id, org_id, jurisdiction, time_zone FROM property
         WHERE org_id = ? AND property_id > ? ORDER BY property_id ASC LIMIT ?`,
      )
        .bind(orgId, after, limit)
        .all<{ property_id: string; org_id: string; jurisdiction: string | null; time_zone: string }>()
    : await env.PLATFORM_DB.prepare(
        `SELECT property_id, org_id, jurisdiction, time_zone FROM property
         WHERE org_id = ? ORDER BY property_id ASC LIMIT ?`,
      )
        .bind(orgId, limit)
        .all<{ property_id: string; org_id: string; jurisdiction: string | null; time_zone: string }>();

  const rows = (results ?? []).map((r) => ({
    propertyId: r.property_id,
    orgId: r.org_id,
    jurisdiction: (r.jurisdiction as Jurisdiction | null) ?? null,
    timeZone: r.time_zone,
  }));
  const nextAfter = rows.length === limit ? rows[rows.length - 1]!.propertyId : null;
  return { rows, nextAfter };
}

/** Insert org row + seed Starter subscription. Returns false if org_id already exists. */
export async function createOrg(env: PmsEnv, orgId: string, name: string): Promise<boolean> {
  validateTenantId(orgId);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const existing = await env.PLATFORM_DB.prepare(`SELECT org_id FROM org WHERE org_id = ?`)
    .bind(orgId)
    .first();
  if (existing) return false;
  await env.PLATFORM_DB.prepare(
    `INSERT INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  )
    .bind(orgId, name, Date.now())
    .run();
  await seedSubscription(env, orgId, 'starter');
  return true;
}

export async function upsertOrg(
  env: PmsEnv,
  orgId: string,
  name: string,
): Promise<void> {
  validateTenantId(orgId);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const existing = await env.PLATFORM_DB.prepare(`SELECT org_id FROM org WHERE org_id = ?`)
    .bind(orgId)
    .first();
  if (existing) return;
  await env.PLATFORM_DB.prepare(
    `INSERT INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  )
    .bind(orgId, name, Date.now())
    .run();
  await seedSubscription(env, orgId, 'starter');
}

export async function ensureOrgRegistryRow(env: PmsEnv, orgId: string, name: string): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  await env.PLATFORM_DB.prepare(
    `INSERT OR IGNORE INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  )
    .bind(orgId, name, Date.now())
    .run();
}

export async function seedSubscription(
  env: PmsEnv,
  orgId: string,
  planCode: PlanCode,
): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  await ensureOrgRegistryRow(env, orgId, orgId);

  const existing = await env.PLATFORM_DB.prepare(
    `SELECT plan_code, status FROM subscription WHERE org_id = ?`,
  )
    .bind(orgId)
    .first<{ plan_code: string; status: string }>();

  if (!existing) {
    await env.PLATFORM_DB.prepare(
      `INSERT OR IGNORE INTO subscription (org_id, plan_code, status, entitlement_version, trial_ends_at, current_period_end)
       VALUES (?, ?, 'active', 1, NULL, NULL)`,
    )
      .bind(orgId, planCode)
      .run();
    return;
  }

  if (existing.status === 'active' && existing.plan_code === planCode) return;

  await env.PLATFORM_DB.prepare(
    `UPDATE subscription
     SET plan_code = ?, status = 'active', entitlement_version = entitlement_version + 1
     WHERE org_id = ?`,
  )
    .bind(planCode, orgId)
    .run();
}

/** Test helper: cancel without deleting — bumps entitlement_version for KV cache isolation. */
export async function cancelSubscription(env: PmsEnv, orgId: string): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const row = await env.PLATFORM_DB.prepare(`SELECT status FROM subscription WHERE org_id = ?`)
    .bind(orgId)
    .first<{ status: string }>();
  if (!row || row.status === 'cancelled') return;
  await env.PLATFORM_DB.prepare(
    `UPDATE subscription SET status = 'cancelled', entitlement_version = entitlement_version + 1 WHERE org_id = ?`,
  )
    .bind(orgId)
    .run();
}

/** Test helper: attempt DELETE (must abort when trigger is present). */
export async function tryDeleteSubscription(
  env: PmsEnv,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await env.PLATFORM_DB.prepare(`DELETE FROM subscription WHERE org_id = ?`).bind(orgId).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Test helper: attempt raw status write (must abort on invalid domain or missing version bump). */
export async function trySetSubscriptionStatus(
  env: PmsEnv,
  orgId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await env.PLATFORM_DB.prepare(`UPDATE subscription SET status = ? WHERE org_id = ?`)
      .bind(status, orgId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function trySetOrgStatus(
  env: PmsEnv,
  orgId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(`UPDATE org SET status = ? WHERE org_id = ?`)
      .bind(status, orgId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function trySetPropertyStatus(
  env: PmsEnv,
  propertyId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(`UPDATE property SET status = ? WHERE property_id = ?`)
      .bind(status, propertyId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tryDeleteOrg(
  env: PmsEnv,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(`DELETE FROM org WHERE org_id = ?`).bind(orgId).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tryDeleteProperty(
  env: PmsEnv,
  propertyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(`DELETE FROM property WHERE property_id = ?`).bind(propertyId).run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tryUpdatePurgeCertificate(
  env: PmsEnv,
  certificateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(
      `UPDATE purge_certificate SET halt_reason = 'mutated' WHERE certificate_id = ?`,
    )
      .bind(certificateId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function tryDeletePurgeCertificate(
  env: PmsEnv,
  certificateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(`DELETE FROM purge_certificate WHERE certificate_id = ?`)
      .bind(certificateId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Test-only: insert a purge_certificate row (bypasses app helpers). */
export async function insertPurgeCertificateRaw(
  env: PmsEnv,
  row: {
    certificateId: string;
    workflowId: string;
    kind: 'guest' | 'org';
    orgId: string | null;
    outcome?: 'certified' | 'halted';
  },
): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const now = Date.now();
  await env.PLATFORM_DB.prepare(
    `INSERT INTO purge_certificate (
      certificate_id, workflow_id, kind, org_id, subject_json, stores_json, limitations_json,
      operator_user_id, outcome, halt_reason, started, recorded_at, certified
    ) VALUES (?, ?, ?, ?, '{}', '[]', '[]', NULL, ?, NULL, ?, ?, NULL)`,
  )
    .bind(
      row.certificateId,
      row.workflowId,
      row.kind,
      row.orgId,
      row.outcome ?? 'halted',
      now,
      now,
    )
    .run();
}

/** Test-only: stamp purge_not_before so closing→purging is allowed by trigger. */
export async function setOrgPurgeNotBefore(
  env: PmsEnv,
  orgId: string,
  purgeNotBefore: number,
): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  await env.PLATFORM_DB.prepare(`UPDATE org SET purge_not_before = ? WHERE org_id = ?`)
    .bind(purgeNotBefore, orgId)
    .run();
}

/** Test-only: set operational kill-switch for a feature key. */
export async function setKillSwitch(
  env: PmsEnv,
  featureKey: string,
  active: boolean,
): Promise<void> {
  const key = `kill:${featureKey}`;
  if (active) {
    await env.ENTITLEMENT_KV.put(key, '1');
  } else {
    await env.ENTITLEMENT_KV.delete(key);
  }
}

export async function insertProperty(
  env: PmsEnv,
  property: Omit<PropertyRecord, 'status' | 'createdAt'> & { status?: PropertyRecord['status'] },
  /** R7.1 D7: statements committed with the insert in one `db.batch()` (the operator_action row). */
  withStatements?: (created: PropertyRecord) => D1PreparedStatement[],
): Promise<PropertyRecord> {
  validateTenantId(property.propertyId);
  validateTenantId(property.orgId);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const createdAt = Date.now();
  const status = property.status ?? 'active';
  const created: PropertyRecord = {
    propertyId: property.propertyId,
    orgId: property.orgId,
    name: property.name,
    jurisdiction: property.jurisdiction,
    timeZone: property.timeZone,
    status,
    createdAt,
  };
  const insert = env.PLATFORM_DB.prepare(
    `INSERT INTO property (property_id, org_id, name, jurisdiction, time_zone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    property.propertyId,
    property.orgId,
    property.name,
    property.jurisdiction,
    property.timeZone,
    status,
    createdAt,
  );
  if (withStatements) {
    await env.PLATFORM_DB.batch([insert, ...withStatements(created)]);
  } else {
    await insert.run();
  }
  return created;
}

export async function updatePropertyName(
  env: PmsEnv,
  propertyId: string,
  name: string,
): Promise<boolean> {
  const result = await env.PLATFORM_DB.prepare(`UPDATE property SET name = ? WHERE property_id = ?`)
    .bind(name, propertyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/** Test helper: attempt to mutate jurisdiction (must abort when trigger is present). */
export async function tryUpdatePropertyJurisdiction(
  env: PmsEnv,
  propertyId: string,
  jurisdiction: Jurisdiction | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await env.PLATFORM_DB.prepare(`UPDATE property SET jurisdiction = ? WHERE property_id = ?`)
      .bind(jurisdiction, propertyId)
      .run();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
