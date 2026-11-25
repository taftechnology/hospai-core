import { createExecutionContext, createMessageBatch, env, getQueueResult, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeHeadOfficeTotal,
  type DomainEventMessage,
  type HeadOfficeResponse,
  type HeadOfficeRowRead,
} from '@hospai/contracts';
import { consumerIdempotencyKey, toQueueMessage } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { PmsEnv } from '../src/env.js';
import { CORE_CONSUMERS } from '../src/event-consumers.js';
import type { OrgDO } from '../src/org-do.js';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, seedSubscription } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, TEST_OWNER_ACTOR } from './fixtures.js';

/** R7.4 head-office view (spec 2026-11-24-head-office-view-design). */

const OWNER = 'user_owner';
const CONSUMER = 'pms.head_office_projection';

function suffix(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function http(method: string, path: string, actor: string, body?: unknown) {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
}

function orgOf(orgId: string) {
  return resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
}

async function newOrg(plan: 'starter' | 'group', label = 'ho'): Promise<string> {
  const orgId = `org_${label}_${suffix()}`;
  expect((await http('POST', '/v1/orgs', OWNER, { orgId, name: 'Group Hotels' })).status).toBe(201);
  await seedSubscription(env, orgId, plan);
  return orgId;
}

async function newHotel(orgId: string, name: string, currency = 'USD'): Promise<string> {
  const propertyId = `prop_${name.toLowerCase()}_${suffix()}`;
  const res = await http('POST', `/v1/orgs/${orgId}/properties`, OWNER, {
    propertyId,
    name,
    timeZone: 'UTC',
    currency,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return propertyId;
}

async function stubOf(propertyId: string) {
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) throw new Error('property missing');
  return resolved.stub;
}

async function deliver(messages: DomainEventMessage[]): Promise<void> {
  const batch = createMessageBatch(
    'hospai-events',
    messages.map((body) => ({ id: body.eventId, timestamp: new Date(body.createdAt), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await (worker.queue as (b: MessageBatch<DomainEventMessage>, e: PmsEnv, c: ExecutionContext) => Promise<void>)(
    batch as MessageBatch<DomainEventMessage>,
    env,
    ctx,
  );
  await getQueueResult(batch, ctx);
}

function triggerMessage(propertyId: string, eventType: string, businessDate: string, extra = {}): DomainEventMessage {
  return {
    eventId: `evt_${suffix()}_${suffix()}`,
    eventType,
    payload: { propertyId, businessDate, ...extra },
    seq: 1,
    source: { do: 'property', id: propertyId },
    createdAt: Date.now(),
  };
}

/** Open date backed up `daysBack` days, then every audit step. Returns the closed date. */
async function closeNight(propertyId: string, daysBack = 1) {
  const stub = await stubOf(propertyId);
  const open = (await stub.readBusinessDate())!;
  const closed = addCalendarDays(open, -daysBack);
  await stub.setBusinessDateForTest(closed);
  expect((await stub.runAuditStep(closed, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
  for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
    const r = await stub.runAuditStep(closed, step);
    expect(r, `${step}: ${JSON.stringify(r)}`).toMatchObject({ status: 'COMPLETED' });
  }
  return { stub, closed, open };
}

/** The audit wrote a stats row; make it a known day: 10 rooms, 1 out of order, 8 sold. */
async function setClosedDay(propertyId: string, closed: string, revenueMinor: number) {
  const stub = await stubOf(propertyId);
  await stub.execSqlForTest(
    `UPDATE night_audit_day_stats SET physical = 10, blocked = 1, sold = 8, room_revenue_minor = ? WHERE business_date = ?`,
    revenueMinor,
    closed,
  );
}

async function deliverOutbox(propertyId: string) {
  const stub = await stubOf(propertyId);
  const rows = await stub.drainOutboxBatch();
  const messages = rows.map((r) => toQueueMessage(r, { do: 'property', id: propertyId }));
  await deliver(messages);
  return messages;
}

async function readView(orgId: string, actor = OWNER): Promise<{ status: number; body: HeadOfficeResponse & Record<string, unknown> }> {
  const res = await http('GET', `/v1/orgs/${orgId}/head-office`, actor);
  return { status: res.status, body: (await res.json()) as HeadOfficeResponse & Record<string, unknown> };
}

describe('R7.4 head-office projection', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('declares the consumer on the four night-audit events, gated by pms.core', () => {
    const decl = CORE_CONSUMERS.find((c) => c.consumer === CONSUMER);
    expect(decl).toMatchObject({
      entitlement: 'pms.core',
      events: ['night_audit.started', 'night_audit.completed', 'night_audit.halted', 'night_audit.halt_resolved', 'property.restored'],
    });
    expect(decl?.gateExempt).toBeUndefined();
  });

  it("after hotel A's audit A has the closed day and today's counts; B is untouched; two hotels never mix", async () => {
    const orgId = await newOrg('group');
    const a = await newHotel(orgId, 'Alpha');
    const b = await newHotel(orgId, 'Bravo');
    const { stub, closed, open } = await closeNight(a);
    await setClosedDay(a, closed, 1_250_000);
    // Today's movement at A: two arrivals and one in-house stay (the board's counts, not a scan of availability).
    const rt = { roomTypeId: 'rt_a', code: 'RTA', name: 'RTA', roomCount: 10, maxOccupancy: 2, maxAdults: 2 };
    expect((await stub.tryAddRoomType(TEST_OWNER_ACTOR, rt, await idemFor(`rt-${a}`, rt))).ok).toBe(true);
    for (const [id, status] of [
      ['res_arr1', 'confirmed'],
      ['res_arr2', 'confirmed'],
      ['res_inh', 'checked_in'],
    ] as const) {
      await stub.insertReservationForTest({
        reservationId: id,
        roomTypeId: 'rt_a',
        guestRef: `g_${id}`,
        piiKeyId: `p_${id}`,
        arrivalDate: status === 'confirmed' ? open : closed,
        departureDate: addCalendarDays(open, 2),
        status,
      });
    }
    await deliverOutbox(a);

    const view = await readView(orgId);
    expect(view.status).toBe(200);
    expect(view.body.rows.map((r) => r.propertyId)).toEqual([a]);
    expect(view.body.missing).toEqual([b]);
    const rowA = view.body.rows[0]!;
    expect(rowA).toMatchObject({
      propertyName: 'Alpha',
      businessDate: open,
      audit: { state: 'idle', failedStep: null, lastCompletedDate: closed },
      closed: { businessDate: closed, currency: 'USD', roomRevenueMinor: 1_250_000, roomsSold: 8, roomsSellable: 9 },
      today: { arrivals: 2, departuresDue: 0, inHouse: 1 },
    });
    // The default Manager Report occupancy setting decides whether the out-of-order room leaves the base.
    expect(typeof rowA.audit.lastCompletedAt).toBe('number');
    expect(JSON.stringify(view.body)).not.toContain('guest');
    // A hotel with no summary yet is not in the sum, so there is no group total.
    expect(view.body.total).toBeNull();

    // B closes its own night: A's row is unchanged, and the group total is the integer sum.
    const aBefore = JSON.stringify(rowA);
    const nightB = await closeNight(b);
    await setClosedDay(b, nightB.closed, 750_000);
    await deliverOutbox(b);
    const after = await readView(orgId);
    expect(after.body.missing).toEqual([]);
    expect(after.body.rows.map((r) => r.propertyId).sort()).toEqual([a, b].sort());
    expect(JSON.stringify(after.body.rows.find((r) => r.propertyId === a))).toBe(aBefore);
    expect(after.body.total).toEqual({ currency: 'USD', roomRevenueMinor: 2_000_000, roomsSold: 16, roomsSellable: 18 });
  });

  it('total is null for mixed currencies', async () => {
    const orgId = await newOrg('group', 'fx');
    const a = await newHotel(orgId, 'Alpha', 'USD');
    const b = await newHotel(orgId, 'Bravo', 'EUR');
    for (const id of [a, b]) {
      const n = await closeNight(id);
      await setClosedDay(id, n.closed, 100_000);
      await deliverOutbox(id);
    }
    const view = await readView(orgId);
    expect(view.body.rows).toHaveLength(2);
    expect(view.body.rows.map((r) => r.closed?.currency).sort()).toEqual(['EUR', 'USD']);
    expect(view.body.total).toBeNull();
  });

  it('total is null when the hotels closed different dates', async () => {
    const orgId = await newOrg('group', 'dt');
    const a = await newHotel(orgId, 'Alpha');
    const b = await newHotel(orgId, 'Bravo');
    for (const [id, back] of [[a, 1], [b, 2]] as const) {
      const n = await closeNight(id, back);
      await setClosedDay(id, n.closed, 100_000);
      await deliverOutbox(id);
    }
    const view = await readView(orgId);
    expect(new Set(view.body.rows.map((r) => r.closed?.businessDate)).size).toBe(2);
    expect(view.body.total).toBeNull();
  });

  it('a failed step emits night_audit.halted without error text; the row shows halted and the step; completion clears it', async () => {
    const orgId = await newOrg('group', 'halt');
    const a = await newHotel(orgId, 'Alpha');
    const stub = await stubOf(a);
    const open = (await stub.readBusinessDate())!;
    const closed = addCalendarDays(open, -1);
    await stub.setBusinessDateForTest(closed);
    await stub.flushOutbox();
    await stub.setRollFailureForTest('boom: Ada Lovelace owes 500.00');
    for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'ROLL_BUSINESS_DATE' && s !== 'ARCHIVE')) {
      const r = await stub.runAuditStep(closed, step, step === 'PRE_CHECK' ? { pendingOpenCount: 0 } : undefined);
      expect(r.status).toBe('COMPLETED');
    }
    expect((await stub.runAuditStep(closed, 'ROLL_BUSINESS_DATE')).status).toBe('FAILED');

    const rows = await stub.drainOutboxBatch();
    const halted = rows.filter((r) => r.eventType === 'night_audit.halted');
    expect(halted).toHaveLength(1);
    expect(JSON.parse(String(halted[0]!.payload))).toEqual({
      propertyId: a,
      businessDate: closed,
      step: 'ROLL_BUSINESS_DATE',
    });
    expect(JSON.stringify(rows)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(rows)).not.toContain('boom');

    await deliver(rows.map((r) => toQueueMessage(r, { do: 'property', id: a })));
    const view = await readView(orgId);
    expect(view.body.rows[0]).toMatchObject({
      audit: { state: 'halted', failedStep: 'ROLL_BUSINESS_DATE' },
    });
    expect(JSON.stringify(view.body)).not.toContain('boom');

    // Fix it, finish the run: the completed event clears the halt.
    await stub.setRollFailureForTest(null);
    for (const step of ['ROLL_BUSINESS_DATE', 'ARCHIVE'] as const) {
      expect((await stub.runAuditStep(closed, step)).status).toBe('COMPLETED');
    }
    await deliverOutbox(a);
    const cleared = await readView(orgId);
    expect(cleared.body.rows[0]).toMatchObject({
      audit: { state: 'idle', failedStep: null, lastCompletedDate: closed },
    });
  });

  it('replaying an event with the same consumer key is a no-op; a lower stateVersion never overwrites', async () => {
    const orgId = await newOrg('group', 'ord');
    const a = await newHotel(orgId, 'Alpha');
    const n = await closeNight(a);
    const org = orgOf(orgId);
    const read = await n.stub.readHeadOfficeRow();
    if (!read.ok) throw new Error('row unreadable');
    const row: HeadOfficeRowRead = read.row;
    const key = consumerIdempotencyKey(CONSUMER, 'evt_replay');

    expect(await org.tryUpsertHeadOfficeRow({ row, propertyName: 'Alpha', consumerIdempotencyKey: key })).toEqual({
      ok: true,
      written: true,
    });
    // Same key again, even with a different row: the first result is returned, nothing is written.
    const newer = { ...row, stateVersion: row.stateVersion + 5, today: { ...row.today, inHouse: 99 } };
    expect(await org.tryUpsertHeadOfficeRow({ row: newer, propertyName: 'Alpha', consumerIdempotencyKey: key })).toEqual({
      ok: true,
      written: true,
    });
    expect((await org.readHeadOfficeRows(OWNER)).rows[0]?.today.inHouse).toBe(row.today.inHouse);

    // A new event with a higher version writes; one with a lower version is a no-op.
    expect(
      await org.tryUpsertHeadOfficeRow({ row: newer, propertyName: 'Alpha', consumerIdempotencyKey: 'consumer:x:new' }),
    ).toEqual({ ok: true, written: true });
    expect((await org.readHeadOfficeRows(OWNER)).rows[0]?.today.inHouse).toBe(99);
    const older = { ...row, stateVersion: row.stateVersion + 1, today: { ...row.today, inHouse: 1 } };
    expect(
      await org.tryUpsertHeadOfficeRow({ row: older, propertyName: 'Alpha', consumerIdempotencyKey: 'consumer:x:late' }),
    ).toEqual({ ok: true, written: false });
    expect((await org.readHeadOfficeRows(OWNER)).rows[0]?.today.inHouse).toBe(99);
  });

  it('refuses a row for a hotel that is not in the org, and delivering the same event twice leaves no exception', async () => {
    const orgId = await newOrg('group', 'ref');
    const a = await newHotel(orgId, 'Alpha');
    const n = await closeNight(a);
    const read = await n.stub.readHeadOfficeRow();
    if (!read.ok) throw new Error('row unreadable');
    const org = orgOf(orgId);
    expect(
      await org.tryUpsertHeadOfficeRow({
        row: { ...read.row, propertyId: 'prop_elsewhere' },
        propertyName: 'Other',
        consumerIdempotencyKey: 'consumer:x:foreign',
      }),
    ).toEqual({ ok: false, error: 'property_ref_not_found' });
    expect((await org.readHeadOfficeRows(OWNER)).rows).toEqual([]);

    const msg = triggerMessage(a, 'night_audit.completed', n.closed);
    await deliver([msg]);
    const pms = env as PmsEnv;
    await pms.EVENT_DEDUPE_KV.delete(`seen:${msg.eventId}`);
    await pms.EVENT_DEDUPE_KV.delete(`seen:${CONSUMER}:${msg.eventId}`);
    await deliver([msg]);
    expect(await n.stub.listEventConsumerExceptions({ status: 'all' })).toMatchObject({ ok: true, exceptions: [] });
    expect((await org.readHeadOfficeRows(OWNER)).rows).toHaveLength(1);
  });

  it('a user who can open one of two hotels sees one row and no missing entry for the other', async () => {
    const orgId = await newOrg('group', 'scope');
    const a = await newHotel(orgId, 'Alpha');
    const b = await newHotel(orgId, 'Bravo');
    for (const id of [a, b]) {
      await closeNight(id);
      await deliverOutbox(id);
    }
    const org = orgOf(orgId);
    await org.upsertPropertyMember('user_front', a, 'admin');
    const view = await org.readHeadOfficeRows('user_front');
    expect(view.rows.map((r) => r.propertyId)).toEqual([a]);
    expect(view.missing).toEqual([]);
    expect(JSON.stringify(view)).not.toContain(b);
  });

  it('head_office_row is in the org purge inventory (counted, and not an unexpected table)', async () => {
    const orgId = await newOrg('group', 'purge');
    const a = await newHotel(orgId, 'Alpha');
    const n = await closeNight(a);
    const read = await n.stub.readHeadOfficeRow();
    if (!read.ok) throw new Error('row unreadable');
    const org = orgOf(orgId);
    const before = await org.countNonBookkeepingRows();
    expect(
      await org.tryUpsertHeadOfficeRow({ row: read.row, propertyName: 'Alpha', consumerIdempotencyKey: 'consumer:x:purge' }),
    ).toMatchObject({ ok: true, written: true });
    const stored = await runInDurableObject(org, (_i, state) =>
      state.storage.sql.exec(`SELECT COUNT(*) AS n FROM head_office_row`).toArray(),
    );
    expect(Number((stored[0] as { n: number }).n)).toBe(1);
    // The row and its idempotency record are both counted; an unlisted table would throw.
    expect(await org.countNonBookkeepingRows()).toBe(before + 2);
  });
});

describe('R7.4 route get_org_head_office', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('refuses staff (org:manage), and a plan without pms.multi_property gets 402 entitlement_required', async () => {
    const orgId = await newOrg('group', 'authz');
    await newHotel(orgId, 'Alpha');
    await orgOf(orgId).ensureMember('user_staff', 'staff');
    const staff = await readView(orgId, 'user_staff');
    expect(staff.status).toBe(403);
    expect(staff.body).toMatchObject({ error: 'forbidden', permission: 'org:manage' });
    expect((await readView(orgId, OWNER)).status).toBe(200);

    const starter = await newOrg('starter', 'nomulti');
    await newHotel(starter, 'Solo');
    const denied = await readView(starter, OWNER);
    expect(denied.status).toBe(402);
    expect(denied.body).toMatchObject({ error: 'entitlement_required' });
  });

  it("another org's URL returns nothing of this org, and a hotel-only admin (no org membership) is refused", async () => {
    const orgId = await newOrg('group', 'mine');
    const a = await newHotel(orgId, 'Alpha');
    await closeNight(a);
    await deliverOutbox(a);
    expect((await readView(orgId)).body.rows).toHaveLength(1);

    const other = await newOrg('group', 'theirs');
    // user_stranger owns `other`; they are not a member of `orgId`.
    expect((await http('POST', '/v1/orgs', 'user_stranger', { orgId: `org_x_${suffix()}`, name: 'X' })).status).toBe(201);
    const crossed = await http('GET', `/v1/orgs/${orgId}/head-office`, 'user_stranger');
    expect([403, 404]).toContain(crossed.status);
    expect(JSON.stringify(await crossed.json())).not.toContain(a);

    // The other org's own view never carries this org's hotel.
    const theirs = await readView(other, OWNER);
    expect(theirs.status).toBe(200);
    expect(theirs.body.rows).toEqual([]);
    expect(JSON.stringify(theirs.body)).not.toContain(a);

    // Only an org member passes `org:manage`; a grant on one hotel alone does not.
    await orgOf(orgId).upsertPropertyMember('user_front', a, 'admin');
    const front = await http('GET', `/v1/orgs/${orgId}/head-office`, 'user_front');
    expect(front.status).toBe(404);
  });
});

describe('computeHeadOfficeTotal', () => {
  const closed = (businessDate: string, currency: string, rev: number, sold: number, sellable: number) => ({
    closed: { businessDate, currency, roomRevenueMinor: rev, roomsSold: sold, roomsSellable: sellable },
  });

  it('sums integers when every row closed the same date in one currency', () => {
    expect(
      computeHeadOfficeTotal([closed('2026-11-23', 'INR', 100, 4, 10), closed('2026-11-23', 'INR', 250, 5, 12)]),
    ).toEqual({ currency: 'INR', roomRevenueMinor: 350, roomsSold: 9, roomsSellable: 22 });
  });

  it('is null for mixed currency, mixed dates, a missing close, or no rows', () => {
    expect(computeHeadOfficeTotal([closed('2026-11-23', 'INR', 1, 1, 1), closed('2026-11-23', 'USD', 1, 1, 1)])).toBeNull();
    expect(computeHeadOfficeTotal([closed('2026-11-23', 'INR', 1, 1, 1), closed('2026-11-22', 'INR', 1, 1, 1)])).toBeNull();
    expect(computeHeadOfficeTotal([closed('2026-11-23', 'INR', 1, 1, 1), { closed: null }])).toBeNull();
    expect(computeHeadOfficeTotal([])).toBeNull();
  });
});
