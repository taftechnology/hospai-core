import type { PropertyRecord } from '@hospai/contracts';
import type { Jurisdiction } from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';

const D1_SCHEMA = `
CREATE TABLE IF NOT EXISTS org (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS property (
  property_id   TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES org(org_id),
  name          TEXT NOT NULL,
  jurisdiction  TEXT,
  time_zone     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL,
  CHECK (jurisdiction IS NULL OR jurisdiction IN ('eu', 'us', 'fedramp'))
);
CREATE INDEX IF NOT EXISTS property_org_idx ON property (org_id);
`;

let schemaReady: Promise<void> | null = null;

/** Apply Platform D1 registry DDL (idempotent). Vitest / local may not auto-migrate. */
export async function ensurePlatformSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      // D1 exec may not run multiple statements; split carefully.
      for (const stmt of D1_SCHEMA.split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await db.prepare(stmt).run();
      }
    })();
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
  await ensurePlatformSchema(env.PLATFORM_DB);
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
}

export async function insertProperty(
  env: PmsEnv,
  property: Omit<PropertyRecord, 'status' | 'createdAt'> & { status?: PropertyRecord['status'] },
): Promise<PropertyRecord> {
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
