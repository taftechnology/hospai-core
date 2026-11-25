/**
 * Restore drill (spec 2026-11-25): `ops.restore_property` rewinds ONE PropertyDO to an earlier moment, or
 * undoes such a restore, using Cloudflare's point-in-time recovery. Modelled on `ops.copy_setup`: the run
 * state is a row in Platform D1 (`property_restore`) because the restore rewinds everything inside the
 * PropertyDO, including any note of itself, and the operator's one request drives both steps.
 *
 *   A  Check the preconditions (operator, suspended org, 29-day window, purge floor, typed property id,
 *      no unfinished restore), insert the ledger row `pending`, then ask the PropertyDO to arm the restore
 *      (`prepareRestore`). It replies with the undo bookmark and the fence floor and restarts itself a
 *      moment later. One D1 batch then moves the row to `restored` and writes the `operator_action` row.
 *   B  After the restart, `fenceAfterRestore` makes the rewound object safe to reuse (ARI version, outbox
 *      sequence, one `property.restored` event); the row moves to `fenced`. A fence that cannot finish
 *      in this request is finished by sending the same request again: the replay finds the `restored` row
 *      and runs the fence only.
 *
 * No money, guest or folio data is read or written here: ids, instants, opaque bookmarks, the reason.
 */
import {
  INTERNAL_ERROR,
  INVALID_REQUEST,
  NOT_FOUND,
  ORG_NOT_SUSPENDED,
  ORG_UNREACHABLE,
  RESTORE_BEFORE_PURGE,
  RESTORE_IN_PROGRESS,
  RESTORE_WINDOW_MS,
  TENANT_NOT_ACTIVE,
  type OpsFailure,
  type OpsRestoreAccepted,
  type PropertyRestoreList,
  type PropertyRestoreRow,
  type RestoreKind,
  type RestoreStatus,
} from '@hospai/contracts';
import { logError } from '@hospai/observability';
import { isPropertyDoTransportFailure } from './do-transport-failure.js';
import type { PmsEnv } from './env.js';
import {
  actionStatement,
  authorize,
  findPrior,
  newActionId,
  opsFail,
  prepareWrite,
  replayCheck,
  runBatch,
  tenantIdOk,
  type WriteInput,
} from './ops-platform.js';
import { resolvePropertyFromRegistry } from './provision.js';
import { ensurePlatformSchema, getOrg, getProperty } from './registry.js';

type RestoreRow = {
  restore_id: string;
  property_id: string;
  org_id: string;
  kind: RestoreKind;
  undo_of: string | null;
  target_time: number | null;
  target_bookmark: string | null;
  undo_bookmark: string | null;
  fence_ari_version: number | null;
  fence_outbox_seq: number | null;
  status: RestoreStatus;
  operator_id: string;
  reason: string;
  created_at: number;
  updated_at: number;
};

/**
 * The fence runs after the PropertyDO restarts. The first call may land on the instance that has just
 * armed the restore (it answers `restore_not_applied` until the restart), so the request waits a few
 * seconds in growing steps before it gives up and leaves the row `restored` for a replay.
 */
export const RESTORE_FENCE_DELAYS_MS: readonly number[] = [250, 500, 1000, 1500, 2500];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function loadRestore(env: PmsEnv, restoreId: string): Promise<RestoreRow | null> {
  await ensurePlatformSchema(env.PLATFORM_DB);
  return env.PLATFORM_DB.prepare(`SELECT * FROM property_restore WHERE restore_id = ?`).bind(restoreId).first<RestoreRow>();
}

/** The newest `fenced` row of a hotel: the only row an undo may use, and only when it is a `restore`. */
async function newestFenced(env: PmsEnv, propertyId: string): Promise<RestoreRow | null> {
  return env.PLATFORM_DB.prepare(
    `SELECT * FROM property_restore WHERE property_id = ? AND status = 'fenced'
     ORDER BY created_at DESC, restore_id DESC LIMIT 1`,
  )
    .bind(propertyId)
    .first<RestoreRow>();
}

async function markFailed(env: PmsEnv, restoreId: string): Promise<void> {
  await env.PLATFORM_DB.prepare(
    `UPDATE property_restore SET status = 'failed', updated_at = ? WHERE restore_id = ? AND status = 'pending'`,
  )
    .bind(Date.now(), restoreId)
    .run();
}

export async function restoreProperty(
  env: PmsEnv,
  input: WriteInput & {
    propertyId: string;
    targetTime?: number | null;
    undoOf?: string | null;
    confirmPropertyId: string;
  },
): Promise<OpsRestoreAccepted | OpsFailure> {
  const targetTime = input?.targetTime ?? null;
  const undoOf = input?.undoOf ?? null;
  const p = await prepareWrite(env, 'ops.restore_property', input, {
    propertyId: input?.propertyId,
    targetTime,
    undoOf,
    confirmPropertyId: input?.confirmPropertyId,
  });
  if ('ok' in p) return p;

  // Shape: exactly one of a target time and an undo.
  if ((targetTime === null) === (undoOf === null)) return opsFail(INVALID_REQUEST, 'target_or_undo');
  if (targetTime !== null && (!Number.isSafeInteger(targetTime) || targetTime <= 0)) {
    return opsFail(INVALID_REQUEST, 'target_time');
  }
  if (undoOf !== null && (typeof undoOf !== 'string' || undoOf.length === 0 || undoOf.length > 128)) {
    return opsFail(INVALID_REQUEST, 'undo_of');
  }
  if (!tenantIdOk(input.propertyId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  // The operator types the property id to confirm; a mismatch is refused before anything is read.
  if (input.confirmPropertyId !== input.propertyId) return opsFail(INVALID_REQUEST, 'confirm_property_id');

  // Replay: same key and payload. The operator_action row exists only once the PropertyDO has armed the
  // restore, so a replay is a `restored` row waiting for its fence, or a finished `fenced` one.
  const prior = await findPrior(env, p);
  if (prior) {
    const bad = replayCheck(p, prior);
    if (bad) return bad;
    const row = await loadRestore(env, prior.action_id);
    if (!row) return opsFail(INTERNAL_ERROR);
    if (row.status === 'restored') {
      const fenced = await finishFence(env, row);
      if (fenced) return fenced;
    }
    return { ok: true, actionId: prior.action_id, restoreId: row.restore_id, replayed: true };
  }

  const property = await getProperty(env, input.propertyId);
  if (!property) return opsFail(NOT_FOUND);
  // A purging or purged hotel is never restored.
  if (property.status !== 'active') return opsFail(TENANT_NOT_ACTIVE);
  const org = await getOrg(env, property.orgId);
  if (!org) return opsFail(NOT_FOUND);
  // Suspension stops staff writes, so nothing races the restore.
  if (org.status !== 'suspended') return opsFail(ORG_NOT_SUSPENDED);

  await ensurePlatformSchema(env.PLATFORM_DB);
  const now = Date.now();
  let targetBookmark: string | null = null;
  let kind: RestoreKind = 'restore';
  if (targetTime !== null) {
    if (targetTime >= now) return opsFail(INVALID_REQUEST, 'target_time');
    if (now - targetTime > RESTORE_WINDOW_MS) return opsFail(INVALID_REQUEST, 'target_time_too_old');
    // Purge floor: a restore never lands at or before a recorded erasure or purge of this org.
    const floor = await env.PLATFORM_DB.prepare(`SELECT MAX(recorded_at) AS floor FROM purge_certificate WHERE org_id = ?`)
      .bind(org.orgId)
      .first<{ floor: number | null }>();
    if (floor?.floor != null && targetTime <= floor.floor) return opsFail(RESTORE_BEFORE_PURGE);
  } else {
    kind = 'undo';
    const source = await loadRestore(env, undoOf as string);
    if (!source || source.property_id !== property.propertyId) return opsFail(NOT_FOUND);
    const newest = await newestFenced(env, property.propertyId);
    // Only the newest fenced restore can be undone; the bookmark is the one the PropertyDO gave back.
    if (!newest || newest.restore_id !== source.restore_id || source.kind !== 'restore' || !source.undo_bookmark) {
      return opsFail(INVALID_REQUEST, 'undo_not_available');
    }
    // Undo goes forward in time: the purge floor check is skipped by design (spec §4).
    targetBookmark = source.undo_bookmark;
  }

  const open = await env.PLATFORM_DB.prepare(
    `SELECT restore_id FROM property_restore WHERE property_id = ? AND status IN ('pending', 'restored') LIMIT 1`,
  )
    .bind(property.propertyId)
    .first<{ restore_id: string }>();
  if (open) return opsFail(RESTORE_IN_PROGRESS);

  const restoreId = newActionId();
  try {
    await env.PLATFORM_DB.prepare(
      `INSERT INTO property_restore
         (restore_id, property_id, org_id, kind, undo_of, target_time, status, operator_id, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
      .bind(restoreId, property.propertyId, org.orgId, kind, undoOf, targetTime, p.operator.operator_id, p.reason, now, now)
      .run();
  } catch (e) {
    if ((e instanceof Error ? e.message : String(e)).includes('property_restore.property_id')) {
      return opsFail(RESTORE_IN_PROGRESS);
    }
    throw e;
  }

  // Step A: arm the restore on the PropertyDO.
  const resolved = await resolvePropertyFromRegistry(env, property.propertyId, property);
  if (!resolved) {
    await markFailed(env, restoreId);
    return opsFail(NOT_FOUND);
  }
  let armed: Awaited<ReturnType<typeof resolved.stub.prepareRestore>>;
  try {
    armed = await resolved.stub.prepareRestore(
      targetTime !== null ? { restoreId, targetTime } : { restoreId, targetBookmark: targetBookmark as string },
    );
  } catch (e) {
    await markFailed(env, restoreId);
    if (isPropertyDoTransportFailure(e, env)) return opsFail(ORG_UNREACHABLE, 'property_unreachable');
    throw e;
  }
  if (!armed.ok) {
    await markFailed(env, restoreId);
    return opsFail(armed.error, armed.detail);
  }

  // The row moves to `restored` and the hotel-visible action row is written in one D1 batch.
  const outcome = await runBatch(env, p, [
    env.PLATFORM_DB.prepare(
      `UPDATE property_restore
         SET status = 'restored', target_bookmark = ?, undo_bookmark = ?, fence_ari_version = ?,
             fence_outbox_seq = ?, updated_at = ?
       WHERE restore_id = ? AND status = 'pending'`,
    ).bind(armed.bookmark, armed.undoBookmark, armed.ariVersion, armed.outboxSeq, Date.now(), restoreId),
    actionStatement(
      env,
      restoreId,
      p,
      {
        commandId: 'ops.restore_property',
        orgId: org.orgId,
        propertyId: property.propertyId,
        before: null,
        after: { restoreId, kind, targetTime, undoOf, timeZone: property.timeZone },
      },
      true,
    ),
  ]);
  if (outcome.kind === 'failed') return outcome.failure;
  if (outcome.kind === 'replayed') {
    // A concurrent identical request recorded it first. Report it; the other request owns the fence.
    const bad = replayCheck(p, outcome.prior);
    if (bad) return bad;
    return { ok: true, actionId: outcome.prior.action_id, restoreId: outcome.prior.action_id, replayed: true };
  }
  if (outcome.changedFirst === 0) return opsFail(INTERNAL_ERROR, 'restore_row_conflict');

  // Step B: the fence, once the object has restarted.
  const row = await loadRestore(env, restoreId);
  if (!row) return opsFail(INTERNAL_ERROR);
  const failure = await finishFence(env, row);
  if (failure) return failure;
  return { ok: true, actionId: restoreId, restoreId, replayed: false };
}

/**
 * Runs the fence for a `restored` row and moves it to `fenced`. Returns null on success, or the failure to
 * hand the operator (the row stays `restored`, so the same request again retries only this step).
 */
async function finishFence(env: PmsEnv, row: RestoreRow): Promise<OpsFailure | null> {
  if (row.fence_ari_version === null || row.fence_outbox_seq === null) return opsFail(INTERNAL_ERROR);
  const property = await getProperty(env, row.property_id);
  if (!property) return opsFail(NOT_FOUND);
  const resolved = await resolvePropertyFromRegistry(env, property.propertyId, property);
  if (!resolved) return opsFail(NOT_FOUND);

  let lastDetail = 'restore_fence_pending';
  for (let attempt = 0; attempt <= RESTORE_FENCE_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) await sleep(RESTORE_FENCE_DELAYS_MS[attempt - 1]!);
    try {
      const fenced = await resolved.stub.fenceAfterRestore({
        restoreId: row.restore_id,
        targetTime: row.target_time,
        minAriVersion: row.fence_ari_version,
        minOutboxSeq: row.fence_outbox_seq,
      });
      if (fenced.ok) {
        await env.PLATFORM_DB.prepare(
          `UPDATE property_restore SET status = 'fenced', updated_at = ? WHERE restore_id = ? AND status = 'restored'`,
        )
          .bind(Date.now(), row.restore_id)
          .run();
        return null;
      }
      if (fenced.detail !== 'restore_not_applied') return opsFail(fenced.error, fenced.detail);
    } catch (e) {
      // The object is restarting: the next attempt reaches the restored instance.
      if (!isPropertyDoTransportFailure(e, env)) {
        logError({ moduleId: 'pms.core' }, { msg: 'ops.restore_property_fence_failed', restoreId: row.restore_id, error: String(e) });
        throw e;
      }
      lastDetail = 'property_unreachable';
    }
  }
  return opsFail(INTERNAL_ERROR, lastDetail);
}

// ---------------------------------------------------------------------------------------------
// Read: the ledger for one hotel
// ---------------------------------------------------------------------------------------------

const LEDGER_PAGE = 50;

export async function listPropertyRestores(
  env: PmsEnv,
  input: { operatorId: string; propertyId: string },
): Promise<PropertyRestoreList | OpsFailure> {
  const operator = await authorize(env, input?.operatorId, 'read');
  if ('ok' in operator) return operator;
  if (!tenantIdOk(input.propertyId)) return opsFail(INVALID_REQUEST, 'invalid_tenant_id');
  const property = await getProperty(env, input.propertyId);
  if (!property) return opsFail(NOT_FOUND);
  const org = await getOrg(env, property.orgId);
  if (!org) return opsFail(NOT_FOUND);
  await ensurePlatformSchema(env.PLATFORM_DB);
  const { results } = await env.PLATFORM_DB.prepare(
    `SELECT r.*, o.display_name AS operator_name FROM property_restore r
       JOIN operator o ON o.operator_id = r.operator_id
      WHERE r.property_id = ? ORDER BY r.created_at DESC, r.restore_id DESC LIMIT ?`,
  )
    .bind(property.propertyId, LEDGER_PAGE)
    .all<RestoreRow & { operator_name: string }>();
  const rows = results ?? [];
  // `canUndo`: the newest fenced row, when it is a restore. Undo of an undo is not offered.
  const newest = rows.find((r) => r.status === 'fenced') ?? null;
  const restores: PropertyRestoreRow[] = rows.map((r) => ({
    restoreId: r.restore_id,
    kind: r.kind,
    undoOf: r.undo_of,
    targetTime: r.target_time,
    status: r.status,
    operatorName: r.operator_name,
    reason: r.reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    canUndo: newest !== null && r.restore_id === newest.restore_id && r.kind === 'restore',
  }));
  return {
    ok: true,
    propertyId: property.propertyId,
    orgId: property.orgId,
    orgStatus: org.status,
    timeZone: property.timeZone,
    restores,
  };
}
