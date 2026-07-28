import type { PlanCode, PropertyRecord } from '@hospai/contracts';
import { validateTenantId } from '@hospai/contracts';
import { PLATFORM_ALL_STATEMENTS } from '@hospai/do-runtime';
import type { Jurisdiction } from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';

let schemaReady: Promise<void> | null = null;

/**
 * Apply Platform D1 registry DDL via discrete statements (safe for triggers).
 * Call from write paths / test setup only — not on every read.
 */
export async function ensurePlatformSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const stmt of PLATFORM_ALL_STATEMENTS) {
        await db.prepare(stmt).run();
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
): Promise<PropertyRecord> {
  validateTenantId(property.propertyId);
  validateTenantId(property.orgId);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const createdAt = Date.now();
  const status = property.status ?? 'active';
  await env.PLATFORM_DB.prepare(
    `INSERT INTO property (property_id, org_id, name, jurisdiction, time_zone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      property.propertyId,
      property.orgId,
      property.name,
      property.jurisdiction,
      property.timeZone,
      status,
      createdAt,
    )
    .run();
  return {
    propertyId: property.propertyId,
    orgId: property.orgId,
    name: property.name,
    jurisdiction: property.jurisdiction,
    timeZone: property.timeZone,
    status,
    createdAt,
  };
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
