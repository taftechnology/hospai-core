/** §4.8 purge certificate helpers — Platform D1 append-only evidence. */

import { ORG_PURGE_RETENTION_MS } from '@hospai/do-runtime';
import type { PmsEnv } from './env.js';
import { ensurePlatformSchema } from './registry.js';

export { ORG_PURGE_RETENTION_MS };

/** Always included in certificate limitations[] (§4.8 Phase 0 PITR caveat). */
export const PITR_LIMITATION = 'do_pitr_not_covered_phase0' as const;

/** Declared columns — check scripts assert no PII-shaped names. */
export const PURGE_CERTIFICATE_COLUMNS = [
  'certificate_id',
  'workflow_id',
  'kind',
  'org_id',
  'subject_json',
  'stores_json',
  'limitations_json',
  'operator_user_id',
  'outcome',
  'halt_reason',
  'started',
  'recorded_at',
  'certified',
] as const;

export type PurgeStoreName = 'key_store' | 'property_do' | 'org_do' | 'r2' | 'iceberg';

export type PurgeStoreRecord = {
  store: PurgeStoreName;
  status: 'reached' | 'skipped';
  deleted?: number;
  reason?: string;
  note?: string;
};

export type PurgeCertificateKind = 'guest' | 'org';
export type PurgeCertificateOutcome = 'certified' | 'halted';

export type AppendPurgeCertificateInput = {
  certificateId?: string;
  workflowId: string;
  kind: PurgeCertificateKind;
  orgId: string | null;
  subjects: unknown;
  stores: PurgeStoreRecord[];
  limitations?: string[];
  operatorUserId: string | null;
  outcome: PurgeCertificateOutcome;
  haltReason?: string | null;
  started: number;
  recordedAt?: number;
  certified?: number | null;
};

export type OrgRetentionRow = {
  status: string;
  purge_not_before: number | null;
};

export type OrgRetentionDenial = 'not_closing' | 'purge_not_before_null' | 'retention_not_elapsed';

/** Five §4.8 stores with R2/Iceberg pre-marked skipped. */
export function initialStoresSkippedR2Iceberg(): PurgeStoreRecord[] {
  return [
    { store: 'key_store', status: 'reached', deleted: 0, note: 'colocated_in_org_do' },
    { store: 'property_do', status: 'reached', deleted: 0 },
    { store: 'org_do', status: 'reached', deleted: 0 },
    { store: 'r2', status: 'skipped', reason: 'no_r2_binding' },
    { store: 'iceberg', status: 'skipped', reason: 'no_iceberg_binding' },
  ];
}

export function guestPurgeWorkflowId(guestRef: string): string {
  return `purge-guest-${guestRef}`;
}

export async function countOrgPurgeCertificates(env: PmsEnv, orgId: string): Promise<number> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const row = await env.PLATFORM_DB.prepare(
    `SELECT COUNT(*) AS n FROM purge_certificate WHERE org_id = ? AND kind = 'org'`,
  )
    .bind(orgId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export async function nextOrgPurgeWorkflowId(env: PmsEnv, orgId: string): Promise<string> {
  const attempt = 1 + (await countOrgPurgeCertificates(env, orgId));
  return `purge-org-${orgId}-${attempt}`;
}

/**
 * Three explicit JS checks — never bare `now >= purge_not_before`
 * (`Date.now() >= null` is true in JS).
 */
export function evaluateOrgRetention(
  row: OrgRetentionRow,
  now: number,
): { ok: true } | { ok: false; reason: OrgRetentionDenial } {
  if (row.status !== 'closing') return { ok: false, reason: 'not_closing' };
  if (row.purge_not_before == null) return { ok: false, reason: 'purge_not_before_null' };
  if (now < row.purge_not_before) return { ok: false, reason: 'retention_not_elapsed' };
  return { ok: true };
}

export async function appendPurgeCertificate(
  env: PmsEnv,
  input: AppendPurgeCertificateInput,
): Promise<void> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const recordedAt = input.recordedAt ?? Date.now();
  const certified =
    input.outcome === 'certified' ? (input.certified ?? recordedAt) : (input.certified ?? null);
  const limitations = input.limitations?.length
    ? input.limitations
    : [PITR_LIMITATION];
  await env.PLATFORM_DB.prepare(
    `INSERT INTO purge_certificate (
      certificate_id, workflow_id, kind, org_id, subject_json, stores_json, limitations_json,
      operator_user_id, outcome, halt_reason, started, recorded_at, certified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.certificateId ?? crypto.randomUUID(),
      input.workflowId,
      input.kind,
      input.orgId,
      JSON.stringify(input.subjects),
      JSON.stringify(input.stores),
      JSON.stringify(limitations),
      input.operatorUserId,
      input.outcome,
      input.haltReason ?? null,
      input.started,
      recordedAt,
      certified,
    )
    .run();
}

export async function closeOrgForPurge(
  env: PmsEnv,
  orgId: string,
  opts?: { now?: () => number; retentionMs?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const now = (opts?.now ?? Date.now)();
  const retentionMs = opts?.retentionMs ?? ORG_PURGE_RETENTION_MS;
  try {
    await env.PLATFORM_DB.prepare(
      `UPDATE org SET status = 'closing', closing_at = ?, purge_not_before = ? WHERE org_id = ? AND status = 'active'`,
    )
      .bind(now, now + retentionMs, orgId)
      .run();
    const row = await env.PLATFORM_DB.prepare(`SELECT status FROM org WHERE org_id = ?`)
      .bind(orgId)
      .first<{ status: string }>();
    if (row?.status !== 'closing') {
      return { ok: false, error: 'close_failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function reopenOrg(
  env: PmsEnv,
  orgId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  try {
    await env.PLATFORM_DB.prepare(
      `UPDATE org SET status = 'active', closing_at = NULL, purge_not_before = NULL WHERE org_id = ? AND status = 'closing'`,
    )
      .bind(orgId)
      .run();
    const row = await env.PLATFORM_DB.prepare(`SELECT status FROM org WHERE org_id = ?`)
      .bind(orgId)
      .first<{ status: string }>();
    if (row?.status !== 'active') {
      return { ok: false, error: 'reopen_failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getOrgRetentionRow(
  env: PmsEnv,
  orgId: string,
): Promise<OrgRetentionRow | null> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  const row = await env.PLATFORM_DB.prepare(
    `SELECT status, purge_not_before FROM org WHERE org_id = ?`,
  )
    .bind(orgId)
    .first<{ status: string; purge_not_before: number | null }>();
  if (!row) return null;
  return { status: row.status, purge_not_before: row.purge_not_before };
}
