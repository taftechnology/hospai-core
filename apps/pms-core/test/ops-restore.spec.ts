import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMMAND_BY_ID, OPS_WRITE_KILL_KEY, RESTORE_WINDOW_MS } from '@hospai/contracts';
import { OpsEntrypoint } from '../src/ops-entrypoint.js';
import * as ops from '../src/ops-platform.js';
import * as restore from '../src/ops-restore.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { trySetPropertyStatus } from '../src/registry.js';
import { actionRows, resetOperatorRegistry, seedOperator, uid } from './ops-helpers.js';
import { makeRecordingPitrPort, type RecordingPitrPort } from './pitr-fake.js';

/** Restore drill (spec 2026-11-25). PITR does not run locally: the PropertyDO gets a recording fake. */

let admin: { operatorId: string; email: string };
let viewer: { operatorId: string; email: string };

beforeAll(async () => {
  await resetOperatorRegistry();
  admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
  viewer = await seedOperator('ops_viewer');
});

afterEach(async () => {
  await env.ENTITLEMENT_KV.delete(OPS_WRITE_KILL_KEY);
});

let keyCounter = 0;
const w = (operatorId: string, reason = 'Bad bulk rate change at the hotel') => ({
  operatorId,
  clientKey: `rst-k${++keyCounter}-${crypto.randomUUID()}`,
  reason,
});

const HOUR = 60 * 60 * 1000;

type Hotel = { orgId: string; propertyId: string };

async function newHotel(opts: { suspend?: boolean } = {}): Promise<Hotel> {
  const orgId = uid('org_rs');
  expect(await ops.createOrg(env, { ...w(admin.operatorId), orgId, name: `Customer ${orgId}`, planCode: 'growth' })).toMatchObject({ ok: true });
  const propertyId = uid('prop_rs');
  expect(
    await ops.addProperty(env, {
      ...w(admin.operatorId),
      orgId,
      propertyId,
      name: `Hotel ${propertyId}`,
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'USD',
    }),
  ).toMatchObject({ ok: true });
  if (opts.suspend !== false) {
    expect(await ops.suspendOrg(env, { ...w(admin.operatorId), orgId })).toMatchObject({ ok: true });
  }
  return { orgId, propertyId };
}

async function stubFor(propertyId: string) {
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  expect(resolved).not.toBeNull();
  return resolved!.stub;
}

type Internals = { pitrPortOverride: RecordingPitrPort | null; restoreArmed: boolean };

/**
 * Installs the fake. `rewind` runs inside `abort`, where a real restart would apply the restore: it puts
 * the object's counters back to an earlier, smaller state, as a restore to the past does.
 */
async function installFake(
  propertyId: string,
  opts: { rewind?: boolean; restart?: boolean; failBookmarkForTime?: boolean } = {},
): Promise<RecordingPitrPort> {
  const stub = await stubFor(propertyId);
  const fake = makeRecordingPitrPort({ failBookmarkForTime: opts.failBookmarkForTime });
  await runInDurableObject(stub, (instance, state) => {
    const i = instance as unknown as Internals;
    i.pitrPortOverride = fake;
    fake.onAbort = () => {
      if (opts.rewind) {
        state.storage.sql.exec(`UPDATE property_config SET value_json = '1' WHERE key = '__meta.ari_version'`);
        state.storage.sql.exec(`DELETE FROM outbox`);
        state.storage.sql.exec(`UPDATE sqlite_sequence SET seq = 2 WHERE name = 'outbox'`);
      }
      if (opts.restart !== false) i.restoreArmed = false;
    };
  });
  return fake;
}

/** Give the hotel a non-trivial ARI version and outbox sequence to fence above. */
async function ageHotel(propertyId: string, bumps = 4): Promise<{ ari: number }> {
  const stub = await stubFor(propertyId);
  let ari = 0;
  for (let n = 0; n < bumps; n += 1) ari = await stub.bumpAriVersion();
  await runInDurableObject(stub, (_i, state) => {
    for (let n = 0; n < 6; n += 1) {
      state.storage.sql.exec(
        `INSERT INTO outbox (event_id, event_type, payload, acked, created_at) VALUES (?, 'availability.changed', '{}', 1, ?)`,
        crypto.randomUUID(),
        Date.now(),
      );
    }
  });
  return { ari };
}

async function outboxState(propertyId: string) {
  const stub = await stubFor(propertyId);
  return runInDurableObject(stub, (_i, state) => {
    const rows = state.storage.sql.exec(`SELECT seq, event_type, payload FROM outbox ORDER BY seq`).toArray() as Array<{
      seq: number;
      event_type: string;
      payload: string;
    }>;
    const seq = (state.storage.sql.exec(`SELECT seq FROM sqlite_sequence WHERE name = 'outbox'`).toArray() as Array<{ seq: number }>)[0]?.seq ?? 0;
    return { rows, seq };
  });
}

async function ledger(propertyId: string) {
  const { results } = await env.PLATFORM_DB.prepare(`SELECT * FROM property_restore WHERE property_id = ? ORDER BY created_at, restore_id`)
    .bind(propertyId)
    .all<Record<string, unknown>>();
  return results ?? [];
}

const restoreInput = (h: Hotel, over: Record<string, unknown> = {}) => ({
  ...w(admin.operatorId),
  propertyId: h.propertyId,
  targetTime: Date.now() - 2 * HOUR,
  confirmPropertyId: h.propertyId,
  ...over,
});

describe('ops.restore_property: catalog and entrypoint', () => {
  it('is the 163rd catalog entry, INTERACTIVE, publishes property.restored, and OpsEntrypoint exposes it', () => {
    const entry = COMMAND_BY_ID.get('ops.restore_property')!;
    expect(entry.lane).toBe('INTERACTIVE');
    expect(entry.permission).toBe('shell:internal');
    expect(entry.events).toEqual(['property.restored']);
    expect(typeof OpsEntrypoint.prototype.restoreProperty).toBe('function');
    expect(typeof OpsEntrypoint.prototype.listPropertyRestores).toBe('function');
  });
});

describe('ops.restore_property: refusals (nothing is armed, nothing is recorded)', () => {
  async function refused(h: Hotel, input: Awaited<ReturnType<typeof restoreInput>>, fake: RecordingPitrPort) {
    const res = await restore.restoreProperty(env, input);
    expect(fake.calls).toEqual([]);
    expect(await actionRows("command_id = 'ops.restore_property' AND property_id = ?", h.propertyId)).toHaveLength(0);
    return res;
  }

  it('refuses a viewer', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId);
    expect(await refused(h, restoreInput(h, { operatorId: viewer.operatorId }), fake)).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await ledger(h.propertyId)).toHaveLength(0);
  });

  it('refuses a missing reason and a wrong typed property id', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId);
    expect(await refused(h, restoreInput(h, { reason: '  ' }), fake)).toMatchObject({ ok: false, error: 'reason_required' });
    expect(await refused(h, restoreInput(h, { confirmPropertyId: `${h.propertyId}x` }), fake)).toMatchObject({
      ok: false,
      error: 'invalid_request',
      detail: 'confirm_property_id',
    });
    expect(await ledger(h.propertyId)).toHaveLength(0);
  });

  it('refuses an org that is not suspended (409 org_not_suspended)', async () => {
    const h = await newHotel({ suspend: false });
    const fake = await installFake(h.propertyId);
    expect(await refused(h, restoreInput(h), fake)).toMatchObject({ ok: false, error: 'org_not_suspended', status: 409 });
  });

  it('refuses a target older than 29 days, in the future, and both or neither of target and undo', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId);
    expect(await refused(h, restoreInput(h, { targetTime: Date.now() - RESTORE_WINDOW_MS - HOUR }), fake)).toMatchObject({
      ok: false,
      detail: 'target_time_too_old',
    });
    expect(await refused(h, restoreInput(h, { targetTime: Date.now() + HOUR }), fake)).toMatchObject({ ok: false, detail: 'target_time' });
    expect(await refused(h, restoreInput(h, { undoOf: 'opa_x' }), fake)).toMatchObject({ ok: false, detail: 'target_or_undo' });
    expect(await refused(h, restoreInput(h, { targetTime: null }), fake)).toMatchObject({ ok: false, detail: 'target_or_undo' });
  });

  it('refuses a target at or before the newest purge certificate of the org, and allows one just after it', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId, { restart: true });
    const recordedAt = Date.now() - 3 * HOUR;
    await env.PLATFORM_DB.prepare(
      `INSERT INTO purge_certificate (certificate_id, workflow_id, kind, org_id, subject_json, stores_json, limitations_json, outcome, started, recorded_at)
       VALUES (?, ?, 'guest', ?, '{}', '[]', '[]', 'halted', ?, ?)`,
    )
      .bind(uid('pc'), uid('wf'), h.orgId, recordedAt - 1000, recordedAt)
      .run();
    expect(await refused(h, restoreInput(h, { targetTime: recordedAt }), fake)).toMatchObject({ ok: false, error: 'restore_before_purge', status: 409 });
    expect(await refused(h, restoreInput(h, { targetTime: recordedAt - HOUR }), fake)).toMatchObject({ ok: false, error: 'restore_before_purge' });
    const ok = await restore.restoreProperty(env, restoreInput(h, { targetTime: recordedAt + 1000 }));
    expect(ok).toMatchObject({ ok: true });
  });

  it('refuses a property that is purging', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId);
    expect((await trySetPropertyStatus(env, h.propertyId, 'purging')).ok).toBe(true);
    expect(await refused(h, restoreInput(h), fake)).toMatchObject({ ok: false, error: 'tenant_not_active' });
  });

  it('refuses while another restore of the hotel is pending, and refuses a property that does not exist', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId);
    await env.PLATFORM_DB.prepare(
      `INSERT INTO property_restore (restore_id, property_id, org_id, kind, status, operator_id, reason, created_at, updated_at)
       VALUES (?, ?, ?, 'restore', 'pending', ?, 'earlier', ?, ?)`,
    )
      .bind(uid('opa'), h.propertyId, h.orgId, admin.operatorId, Date.now(), Date.now())
      .run();
    expect(await refused(h, restoreInput(h), fake)).toMatchObject({ ok: false, error: 'restore_in_progress', status: 409 });
    expect(await restore.restoreProperty(env, restoreInput(h, { propertyId: 'prop_nope_zz', confirmPropertyId: 'prop_nope_zz' }))).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('marks the row failed and arms nothing when the PropertyDO cannot resolve the time, then allows a retry', async () => {
    const h = await newHotel();
    const fake = await installFake(h.propertyId, { failBookmarkForTime: true });
    const res = await restore.restoreProperty(env, restoreInput(h));
    expect(res).toMatchObject({ ok: false, error: 'invalid_request', detail: 'target_time_unavailable' });
    expect(fake.calls.filter((c) => c.startsWith('onNextSessionRestoreBookmark'))).toEqual([]);
    expect((await ledger(h.propertyId)).map((r) => r.status)).toEqual(['failed']);
    expect(await actionRows("command_id = 'ops.restore_property' AND property_id = ?", h.propertyId)).toHaveLength(0);
    await installFake(h.propertyId);
    expect(await restore.restoreProperty(env, restoreInput(h))).toMatchObject({ ok: true });
  });
});

describe('ops.restore_property: happy path with the fake', () => {
  it('arms the restore, restarts, fences, and writes the ledger, the action row and one property.restored', async () => {
    const h = await newHotel();
    const stub = await stubFor(h.propertyId);
    const before = await ageHotel(h.propertyId);
    const pre = await outboxState(h.propertyId);
    const fake = await installFake(h.propertyId, { rewind: true });
    const input = restoreInput(h);

    const res = await restore.restoreProperty(env, input);
    expect(res).toMatchObject({ ok: true, replayed: false });
    if (!res.ok) throw new Error('unreachable');

    // Ledger: pending went to restored (bookmarks and fence values filled) and on to fenced.
    const rows = await ledger(h.propertyId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      restore_id: res.restoreId,
      kind: 'restore',
      undo_of: null,
      target_time: input.targetTime,
      status: 'fenced',
      operator_id: admin.operatorId,
      reason: input.reason,
      fence_ari_version: before.ari,
      fence_outbox_seq: pre.seq,
    });
    expect(row.target_bookmark).toBe(`fake-bookmark-${input.targetTime}`);
    expect(row.undo_bookmark).toBe(`fake-undo-1-of-fake-bookmark-${input.targetTime}`);

    // Fake saw the bookmark armed, then the restart.
    const armedAt = fake.calls.indexOf(`onNextSessionRestoreBookmark:fake-bookmark-${input.targetTime}`);
    const abortAt = fake.calls.indexOf('abort');
    expect(armedAt).toBeGreaterThanOrEqual(0);
    expect(abortAt).toBeGreaterThan(armedAt);
    expect(fake.calls.filter((c) => c === 'abort')).toHaveLength(1);

    // The hotel-visible operator action.
    const actions = await actionRows(`command_id = 'ops.restore_property' AND property_id = ?`, h.propertyId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action_id: res.restoreId, org_id: h.orgId, operator_id: admin.operatorId, reason: input.reason });
    expect(JSON.parse(String(actions[0]!.after_json))).toMatchObject({ restoreId: res.restoreId, kind: 'restore', targetTime: input.targetTime });
    expect(String(actions[0]!.after_json)).not.toContain('bookmark');

    // Fence: ARI above the pre-restore value, outbox sequence above the pre-restore sequence, one event.
    expect(await stub.readAriVersion()).toBeGreaterThan(before.ari);
    const post = await outboxState(h.propertyId);
    const events = post.rows.filter((r) => r.event_type === 'property.restored');
    expect(events).toHaveLength(1);
    expect(events[0]!.seq).toBeGreaterThan(pre.seq);
    expect(JSON.parse(events[0]!.payload)).toEqual({ propertyId: h.propertyId, restoreId: res.restoreId, targetTime: input.targetTime });
    expect(events[0]!.payload).not.toContain('reason');
  });

  it('a replay with the same key and payload is the same action, and does not arm again', async () => {
    const h = await newHotel();
    await ageHotel(h.propertyId);
    const fake = await installFake(h.propertyId);
    const input = restoreInput(h);
    const first = await restore.restoreProperty(env, input);
    const again = await restore.restoreProperty(env, input);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(again).toMatchObject({ ok: true, replayed: true });
    if (first.ok && again.ok) expect(again.restoreId).toBe(first.restoreId);
    expect(fake.calls.filter((c) => c.startsWith('onNextSessionRestoreBookmark'))).toHaveLength(1);
    expect(await ledger(h.propertyId)).toHaveLength(1);
    expect(await restore.restoreProperty(env, { ...input, targetTime: (input.targetTime as number) - HOUR })).toMatchObject({
      ok: false,
      error: 'idempotency_key_reused',
    });
  });

  it('when the restart has not happened the row stays restored, and sending the request again finishes only the fence', async () => {
    const h = await newHotel();
    await ageHotel(h.propertyId);
    const fake = await installFake(h.propertyId, { restart: false });
    const input = restoreInput(h);
    const first = await restore.restoreProperty(env, input);
    expect(first).toMatchObject({ ok: false, error: 'internal_error', detail: 'restore_fence_pending' });
    expect((await ledger(h.propertyId)).map((r) => r.status)).toEqual(['restored']);
    expect(await actionRows(`command_id = 'ops.restore_property' AND property_id = ?`, h.propertyId)).toHaveLength(1);

    // The restart finally happens; the same request finishes the fence without arming again.
    const stub = await stubFor(h.propertyId);
    await runInDurableObject(stub, (instance) => {
      (instance as unknown as Internals).restoreArmed = false;
    });
    const done = await restore.restoreProperty(env, input);
    expect(done).toMatchObject({ ok: true, replayed: true });
    expect((await ledger(h.propertyId)).map((r) => r.status)).toEqual(['fenced']);
    expect(fake.calls.filter((c) => c.startsWith('onNextSessionRestoreBookmark'))).toHaveLength(1);
  }, 20_000);
});

describe('PropertyDO.fenceAfterRestore', () => {
  it('raises the ARI version and the outbox sequence above the floor of a rewound object, once per restore id', async () => {
    const h = await newHotel();
    const stub = await stubFor(h.propertyId);
    await installFake(h.propertyId);
    // A rewound object: small counters.
    await runInDurableObject(stub, (_i, state) => {
      state.storage.sql.exec(`DELETE FROM outbox`);
      state.storage.sql.exec(`DELETE FROM sqlite_sequence WHERE name = 'outbox'`);
    });
    const input = { restoreId: uid('opa'), targetTime: Date.now() - HOUR, minAriVersion: 40, minOutboxSeq: 500 };
    const first = await stub.fenceAfterRestore(input);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(await stub.readAriVersion()).toBe(41);
    const s1 = await outboxState(h.propertyId);
    expect(s1.rows).toHaveLength(1);
    expect(s1.rows[0]!.seq).toBe(501);

    const replay = await stub.fenceAfterRestore(input);
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(await stub.readAriVersion()).toBe(41);
    const s2 = await outboxState(h.propertyId);
    expect(s2.rows.filter((r) => r.event_type === 'property.restored')).toHaveLength(1);

    // A different restore fences again and keeps going up.
    await stub.fenceAfterRestore({ ...input, restoreId: uid('opa') });
    expect(await stub.readAriVersion()).toBe(42);
  });

  it('never lowers a counter that is already above the floor, and refuses a malformed input', async () => {
    const h = await newHotel();
    const stub = await stubFor(h.propertyId);
    await ageHotel(h.propertyId, 9);
    const high = await stub.readAriVersion();
    const res = await stub.fenceAfterRestore({ restoreId: uid('opa'), targetTime: null, minAriVersion: 1, minOutboxSeq: 1 });
    expect(res).toMatchObject({ ok: true });
    expect(await stub.readAriVersion()).toBe(high + 1);
    expect(await stub.fenceAfterRestore({ restoreId: '', targetTime: null, minAriVersion: 1, minOutboxSeq: 1 })).toMatchObject({ ok: false });
    expect(await stub.fenceAfterRestore({ restoreId: 'x', targetTime: null, minAriVersion: -1, minOutboxSeq: 1 })).toMatchObject({ ok: false });
  });

  it('answers restore_not_applied while this instance has armed a restore and not restarted', async () => {
    const h = await newHotel();
    const stub = await stubFor(h.propertyId);
    await installFake(h.propertyId, { restart: false });
    const armed = await stub.prepareRestore({ restoreId: uid('opa'), targetTime: Date.now() - HOUR });
    expect(armed).toMatchObject({ ok: true });
    expect(await stub.prepareRestore({ restoreId: uid('opa'), targetTime: Date.now() - HOUR })).toMatchObject({ ok: false, error: 'restore_in_progress' });
    expect(await stub.fenceAfterRestore({ restoreId: uid('opa'), targetTime: null, minAriVersion: 1, minOutboxSeq: 1 })).toMatchObject({
      ok: false,
      detail: 'restore_not_applied',
    });
  });
});

describe('undo', () => {
  it('uses the stored undo bookmark, skips the purge floor check, and is offered only on the newest fenced restore', async () => {
    const h = await newHotel();
    await ageHotel(h.propertyId);
    const fake = await installFake(h.propertyId);
    const first = await restore.restoreProperty(env, restoreInput(h));
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('unreachable');

    const list = await restore.listPropertyRestores(env, { operatorId: viewer.operatorId, propertyId: h.propertyId });
    expect(list).toMatchObject({ ok: true, orgStatus: 'suspended', timeZone: 'UTC' });
    if (!list.ok) throw new Error('unreachable');
    expect(list.restores).toHaveLength(1);
    expect(list.restores[0]).toMatchObject({ restoreId: first.restoreId, status: 'fenced', canUndo: true, operatorName: 'HospAI support: Sam' });
    expect(JSON.stringify(list)).not.toContain('bookmark');

    // A purge certificate recorded after the restore does not stop an undo (it goes forward in time).
    await env.PLATFORM_DB.prepare(
      `INSERT INTO purge_certificate (certificate_id, workflow_id, kind, org_id, subject_json, stores_json, limitations_json, outcome, started, recorded_at)
       VALUES (?, ?, 'guest', ?, '{}', '[]', '[]', 'certified', ?, ?)`,
    )
      .bind(uid('pc'), uid('wf'), h.orgId, Date.now() - 1000, Date.now())
      .run();

    const stored = (await ledger(h.propertyId))[0]!;
    const undo = await restore.restoreProperty(env, {
      ...w(admin.operatorId, 'Undo: the earlier restore was the wrong time'),
      propertyId: h.propertyId,
      undoOf: first.restoreId,
      confirmPropertyId: h.propertyId,
    });
    expect(undo).toMatchObject({ ok: true });
    if (!undo.ok) throw new Error('unreachable');
    expect(fake.calls).toContain(`onNextSessionRestoreBookmark:${stored.undo_bookmark as string}`);
    expect(fake.calls.filter((c) => c.startsWith('getBookmarkForTime'))).toHaveLength(1);

    const rows = await ledger(h.propertyId);
    expect(rows.map((r) => [r.kind, r.status, r.undo_of])).toEqual([
      ['restore', 'fenced', null],
      ['undo', 'fenced', first.restoreId],
    ]);
    expect(rows[1]!.target_time).toBeNull();
    expect(rows[1]!.target_bookmark).toBe(stored.undo_bookmark);

    // The undo is the newest fenced row: nothing is offered for undo any more.
    const after = await restore.listPropertyRestores(env, { operatorId: admin.operatorId, propertyId: h.propertyId });
    if (!after.ok) throw new Error('unreachable');
    expect(after.restores.map((r) => r.canUndo)).toEqual([false, false]);
    // And the first restore can no longer be undone.
    expect(
      await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: h.propertyId, undoOf: first.restoreId, confirmPropertyId: h.propertyId }),
    ).toMatchObject({ ok: false, detail: 'undo_not_available' });
  });

  it('refuses an undo of another hotel, of a missing restore, and of an undo', async () => {
    const a = await newHotel();
    const b = await newHotel();
    await installFake(a.propertyId);
    await installFake(b.propertyId);
    const ra = await restore.restoreProperty(env, restoreInput(a));
    if (!ra.ok) throw new Error('unreachable');
    expect(
      await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: b.propertyId, undoOf: ra.restoreId, confirmPropertyId: b.propertyId }),
    ).toMatchObject({ ok: false, error: 'not_found' });
    expect(
      await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: a.propertyId, undoOf: 'opa_missing', confirmPropertyId: a.propertyId }),
    ).toMatchObject({ ok: false, error: 'not_found' });
    const un = await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: a.propertyId, undoOf: ra.restoreId, confirmPropertyId: a.propertyId });
    if (!un.ok) throw new Error('unreachable');
    expect(
      await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: a.propertyId, undoOf: un.restoreId, confirmPropertyId: a.propertyId }),
    ).toMatchObject({ ok: false, detail: 'undo_not_available' });
  });

  it('an undo also needs the org to be suspended', async () => {
    const h = await newHotel();
    await installFake(h.propertyId);
    const r = await restore.restoreProperty(env, restoreInput(h));
    if (!r.ok) throw new Error('unreachable');
    expect(await ops.reinstateOrg(env, { ...w(admin.operatorId), orgId: h.orgId })).toMatchObject({ ok: true });
    expect(
      await restore.restoreProperty(env, { ...w(admin.operatorId), propertyId: h.propertyId, undoOf: r.restoreId, confirmPropertyId: h.propertyId }),
    ).toMatchObject({ ok: false, error: 'org_not_suspended' });
  });
});

describe('property_restore ledger triggers', () => {
  async function seedRow(status: string) {
    const h = await newHotel();
    const id = uid('opa');
    const filled = status === 'pending' || status === 'failed';
    await env.PLATFORM_DB.prepare(
      `INSERT INTO property_restore (restore_id, property_id, org_id, kind, status, operator_id, reason, created_at, updated_at,
         target_bookmark, undo_bookmark, fence_ari_version, fence_outbox_seq)
       VALUES (?, ?, ?, 'restore', ?, ?, 'r', 1, 1, ?, ?, ?, ?)`,
    )
      .bind(id, h.propertyId, h.orgId, status, admin.operatorId, filled ? null : 'b', filled ? null : 'u', filled ? null : 1, filled ? null : 1)
      .run();
    return id;
  }
  const move = (id: string, to: string) =>
    env.PLATFORM_DB.prepare(`UPDATE property_restore SET status = ? WHERE restore_id = ?`).bind(to, id).run();

  it('allows only pending to restored to fenced, and pending to failed', async () => {
    const p = await seedRow('pending');
    await expect(move(p, 'fenced')).rejects.toThrow(/transition forbidden/);
    await expect(
      env.PLATFORM_DB.prepare(`UPDATE property_restore SET status = 'restored' WHERE restore_id = ?`).bind(p).run(),
    ).rejects.toThrow(); // the CHECK wants bookmarks and fence values from restored on
    await env.PLATFORM_DB.prepare(
      `UPDATE property_restore SET status = 'restored', target_bookmark = 'b', undo_bookmark = 'u', fence_ari_version = 1, fence_outbox_seq = 1 WHERE restore_id = ?`,
    )
      .bind(p)
      .run();
    await move(p, 'fenced');
    for (const back of ['restored', 'pending', 'failed']) {
      await expect(move(p, back), `fenced to ${back}`).rejects.toThrow(/transition forbidden/);
    }
    const f = await seedRow('failed');
    for (const to of ['pending', 'restored', 'fenced']) {
      await expect(move(f, to), `failed to ${to}`).rejects.toThrow(/transition forbidden/);
    }
    const q = await seedRow('pending');
    await move(q, 'failed');
  });

  it('refuses a delete, and allows one unfinished restore per hotel', async () => {
    const id = await seedRow('pending');
    await expect(env.PLATFORM_DB.prepare(`DELETE FROM property_restore WHERE restore_id = ?`).bind(id).run()).rejects.toThrow(/append-only/);
    const row = await env.PLATFORM_DB.prepare(`SELECT property_id, org_id FROM property_restore WHERE restore_id = ?`).bind(id).first<{ property_id: string; org_id: string }>();
    await expect(
      env.PLATFORM_DB.prepare(
        `INSERT INTO property_restore (restore_id, property_id, org_id, kind, status, operator_id, reason, created_at, updated_at)
         VALUES (?, ?, ?, 'restore', 'pending', ?, 'r', 1, 1)`,
      )
        .bind(uid('opa'), row!.property_id, row!.org_id, admin.operatorId)
        .run(),
    ).rejects.toThrow(/property_restore\.property_id/);
  });
});
