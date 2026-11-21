import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REPORT_DEFINITIONS,
  ROLE_GRANTS,
  ROOM_BOARD_CONDITION_WORDS,
  V1_HTTP_ROUTE_AUDIT,
  averageDailyRateMinor,
  reportCodeWord,
  reportDefinition,
  revParMinor,
  roundedRatio,
  wholePercent,
  type ReportResponse,
  type ReportRow,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { reportObjectKey } from '../src/event-log.js';
import type { OrgDO } from '../src/org-do.js';
import { NIGHT_AUDIT_STEPS, type PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, insertProperty, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';
import { createHousekeeper } from './roster-helpers.js';

/** R4.14 Part C: night-audit and housekeeping reports (spec 2026-11-20-reports-c-night-audit-housekeeping). */

type Json = Record<string, unknown>;
const OWNER = { kind: 'user' as const, userId: 'user_owner' };
const asUser = (userId: string) => ({ kind: 'user' as const, userId });
const GUEST_NAME = 'Part C Report Guest';

async function call(method: string, path: string, actor: string, body?: Json, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-dev-actor': actor };
  if (key) headers['x-idempotency-key'] = key;
  return worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }),
    env,
  );
}
let keySeq = 0;
const nextKey = (p: string) => `${p}-${++keySeq}-${crypto.randomUUID()}`;

// ---------------------------------------------------------------------------------------------
// Night audit
// ---------------------------------------------------------------------------------------------

async function runAudit(
  stub: Awaited<ReturnType<typeof provisionedPropertyStub>>['stub'],
  d: string,
  beforeSnapshot?: () => Promise<void>,
) {
  expect((await stub.runAuditStep(d, 'PRE_CHECK', { pendingOpenCount: 0 })).status).toBe('COMPLETED');
  for (const step of NIGHT_AUDIT_STEPS.filter((s) => s !== 'PRE_CHECK')) {
    if (step === 'CLOSE_CASHIER_SHIFTS') await beforeSnapshot?.();
    const r = await stub.runAuditStep(d, step);
    expect(r, `${step}: ${JSON.stringify(r)}`).toMatchObject({ status: 'COMPLETED' });
  }
}

async function snapshotJson(propertyId: string, d: string, id: string) {
  const obj = await env.EVENT_LOG_R2!.get(reportObjectKey(propertyId, d, id));
  expect(obj).not.toBeNull();
  return JSON.parse(await obj!.text()) as Record<string, unknown>;
}

type AuditHotel = Awaited<ReturnType<typeof provisionedPropertyStub>> & {
  propertyId: string;
  d: string;
  orgId: string;
  actor: string;
};

const auditUrl = (propertyId: string, id: string, qs = '') =>
  `/v1/properties/${propertyId}/reports/night-audit/${id}${qs ? `?${qs}` : ''}`;

async function runAuditReport(h: { propertyId: string; actor: string }, id: string, qs = ''): Promise<ReportResponse> {
  const res = await call('GET', auditUrl(h.propertyId, id, qs), h.actor);
  expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as ReportResponse;
}

/**
 * Closed audit on a seeded day: a ROOM charge of 10000 from one checked-in stay, a stay that is
 * marked no-show, an open cashier shift that is force-closed, and the closing user in the audit log.
 */
async function closedAudit(opts: { rooms?: number; sold?: number } = {}): Promise<AuditHotel> {
  const propertyId = `na-rc-${crypto.randomUUID()}`;
  const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD');
  await insertProperty(env, { propertyId, orgId: p.orgId, name: 'Audit Hotel', jurisdiction: null, timeZone: 'UTC' });
  const { stub } = p;
  const d = (await stub.readBusinessDate())!;
  const rooms = opts.rooms ?? 5;
  if (rooms > 0) {
    const add = { roomTypeId: 'rt_a', code: 'RTA', name: 'RTA', roomCount: rooms, maxOccupancy: 2, maxAdults: 2 };
    expect((await stub.tryAddRoomType(OWNER, add, await idemFor('add-rt-a', add))).ok).toBe(true);
    const rate = { roomTypeId: 'rt_a', ratePlanId: DEFAULT_RATE_PLAN_ID, stayDate: d, amountMinor: 10000, currency: 'USD' };
    expect(await stub.tryUpsertRateDay(OWNER, rate, await idemFor('rate-a', rate))).toEqual({ ok: true });
    const sold = opts.sold ?? 1;
    if (sold > 0) {
      await stub.insertReservationForTest({
        reservationId: 'res_ci',
        roomTypeId: 'rt_a',
        guestRef: 'g1',
        piiKeyId: 'p1',
        arrivalDate: d,
        departureDate: addCalendarDays(d, 2),
        status: 'checked_in',
      });
      await stub.insertReservationForTest({
        reservationId: 'res_ns',
        roomTypeId: 'rt_a',
        guestRef: 'g2',
        piiKeyId: 'p2',
        arrivalDate: d,
        departureDate: addCalendarDays(d, 2),
        status: 'confirmed',
      });
      // The no-show releases its own two nights; `sold` is what stays sold after that.
      await stub.bumpSoldForTest('rt_a', d, sold + 1);
      await stub.bumpSoldForTest('rt_a', addCalendarDays(d, 1), sold + 1);
    }
  }
  const shift = { shiftId: `sh_rc_${crypto.randomUUID()}`, openingFloat: 1000 };
  await runAudit(stub, d, async () => {
    expect(await stub.tryOpenShift(OWNER, shift, await idemFor(`open-${shift.shiftId}`, shift))).toMatchObject({
      ok: true,
    });
  });
  await runInDurableObject(stub, (_i, state) => {
    const sql = state.storage.sql;
    sql.exec(
      `INSERT INTO audit_log (at, actor, command_id, entity_type, entity_id, after_json, created_at)
       VALUES (?, 'user_rc_closer', 'night_audit.run', 'night_audit_run', ?, '{"started":true}', ?)`,
      Date.now() - 1000,
      d,
      Date.now(),
    );
    // One resolved and one open exception raised on the closed date.
    for (const [id, resolved] of [
      ['ex_open', null],
      ['ex_done', Date.now()],
    ] as const) {
      sql.exec(
        `INSERT INTO provisional_exception (exception_id, idempotency_key, command_type, payload, issued_at, business_date, reason, detail, created_at, resolved_at)
         VALUES (?, ?, 'reservations.check_in', '{}', ?, ?, 'no_availability', NULL, ?, ?)`,
        id,
        `idem_${id}`,
        new Date().toISOString(),
        d,
        Date.now(),
        resolved,
      );
    }
  });
  return { ...p, propertyId, d, actor: 'user_owner' } as AuditHotel;
}

describe('R4.14 Part C: night-audit reports', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. the audit report lists the steps, the check outcomes and the stored snapshots with their hashes', async () => {
    const h = await closedAudit();
    const body = await runAuditReport(h, 'night_audit_report', `date=${h.d}`);
    expect(body.params).toEqual({ date: h.d });
    expect(body.emptyReason).toBeUndefined();
    const steps = body.rows.filter((r) => r.section === 'Step');
    expect(steps).toHaveLength(NIGHT_AUDIT_STEPS.length);
    expect(steps.map((r) => r.name)).toEqual([
      'Pre-check',
      'Post room charges',
      'Process no-shows',
      'Auto transfer',
      'Close cashier shifts',
      'Snapshot reports',
      'Roll business date',
      'Archive',
    ]);
    const runs = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(`SELECT step, attempt, started_at, completed_at FROM night_audit_run WHERE business_date = ?`, h.d)
        .toArray(),
    );
    for (const [i, step] of NIGHT_AUDIT_STEPS.entries()) {
      const run = (runs as Array<{ step: string; attempt: number; started_at: number; completed_at: number }>).find(
        (r) => r.step === step,
      )!;
      expect(steps[i]).toMatchObject({
        outcome: 'Completed',
        attempts: run.attempt,
        startedAt: run.started_at,
        completedAt: run.completed_at,
      });
    }
    const checks = body.rows.filter((r) => r.section === 'Check');
    expect(checks.find((r) => r.name === 'Arrivals not checked in')).toMatchObject({ outcome: 'Warn', count: 1 });
    const stored = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(`SELECT report_id, sha256, generated_at FROM night_audit_report WHERE business_date = ? ORDER BY report_id`, h.d)
        .toArray(),
    );
    const snaps = body.rows.filter((r) => r.section === 'Snapshot');
    expect(snaps).toHaveLength((stored as unknown[]).length);
    expect(snaps.map((r) => r.hash).sort()).toEqual(
      (stored as Array<{ sha256: string }>).map((r) => r.sha256).sort(),
    );
    expect(snaps.map((r) => r.name).sort()).toEqual(['Archive manifest', 'Cashier', 'Occupancy', 'Revenue']);
  });

  it('2. revenue is the stored snapshot, copied: categories, tax apart, totals equal the snapshot', async () => {
    const h = await closedAudit();
    const snap = (await snapshotJson(h.propertyId, h.d, 'revenue')) as {
      roomNet: number;
      taxTotal: number;
      byChargeCodeAndSource: Array<{ chargeCode: string; source: string | null; ledgerAmountMinor: number }>;
    };
    const body = await runAuditReport(h, 'night_audit_revenue', `date=${h.d}`);
    const entries = snap.byChargeCodeAndSource.filter((e) => e.chargeCode !== 'PAYMENT');
    expect(body.totals).toEqual({
      category: null,
      charges: entries.filter((e) => e.source !== 'TAX').reduce((n, e) => n + e.ledgerAmountMinor, 0),
      tax: snap.taxTotal,
      total: entries.reduce((n, e) => n + e.ledgerAmountMinor, 0),
    });
    expect(body.rows.map((r) => r.total).reduce<number>((n, v) => n + Number(v), 0)).toBe(Number(body.totals!.total));
    expect(body.rows.find((r) => r.category === 'Room')).toMatchObject({ charges: 10000, tax: 0, total: 10000 });
    expect(snap.roomNet).toBe(10000);
    // Default date (none sent) is the last closed date.
    const dflt = await runAuditReport(h, 'night_audit_revenue');
    expect(dflt.params).toEqual({ date: h.d });
    expect(dflt.rows).toEqual(body.rows);
  });

  it('3. daily statistics: occupancy, ADR and RevPAR come from snapshot figures with the shared helper', async () => {
    const h = await closedAudit({ rooms: 3, sold: 1 });
    const occ = (await snapshotJson(h.propertyId, h.d, 'occupancy')) as { physical: number; blocked: number; sold: number };
    const rev = (await snapshotJson(h.propertyId, h.d, 'revenue')) as { roomNet: number };
    const body = await runAuditReport(h, 'night_audit_daily_statistics', `date=${h.d}`);
    const available = occ.physical - occ.blocked;
    expect(body.rows).toEqual([
      {
        roomsAvailable: 3,
        roomsSold: occ.sold,
        occupancy: wholePercent(occ.sold, available), // 33
        roomRevenue: rev.roomNet,
        adr: averageDailyRateMinor(rev.roomNet, occ.sold),
        revpar: revParMinor(rev.roomNet, available), // 3333
        arrivals: 1,
        departures: 0,
        inHousePersons: 1,
      },
    ]);
    expect(body.rows[0]).toMatchObject({ occupancy: 33, adr: 10000, revpar: 3333 });
    // Rounds half up: 1 / 8 rooms is 13 %, 12.5 rounds up; the helper is the contracts one.
    expect(roundedRatio(25, 2)).toBe(13);
  });

  it('3b. a division by zero is null (no rooms: occupancy and RevPAR; no rooms sold: ADR)', async () => {
    const none = await closedAudit({ rooms: 0 });
    const a = await runAuditReport(none, 'night_audit_daily_statistics', `date=${none.d}`);
    expect(a.rows[0]).toMatchObject({
      roomsAvailable: 0,
      roomsSold: 0,
      occupancy: null,
      adr: null,
      revpar: null,
      roomRevenue: 0,
    });
    const unsold = await closedAudit({ rooms: 4, sold: 0 });
    const b = await runAuditReport(unsold, 'night_audit_daily_statistics', `date=${unsold.d}`);
    expect(b.rows[0]).toMatchObject({ roomsAvailable: 4, roomsSold: 0, occupancy: 0, adr: null, revpar: 0, roomRevenue: 0 });
  });

  it('4. end-of-day control: closer, checks, exceptions, room charges, shifts, no-shows and hashes', async () => {
    const h = await closedAudit();
    const body = await runAuditReport(h, 'night_audit_end_of_day', `date=${h.d}`);
    const sec = (s: string) => body.rows.filter((r) => r.section === s);
    const roll = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(`SELECT completed_at FROM night_audit_run WHERE business_date = ? AND step = 'ROLL_BUSINESS_DATE'`, h.d)
        .toArray(),
    );
    expect(sec('Business date')).toEqual([
      expect.objectContaining({
        item: 'Business date closed',
        detail: 'Closed',
        by: 'user_rc_closer',
        at: (roll as Array<{ completed_at: number }>)[0]!.completed_at,
      }),
    ]);
    expect(sec('Checks')).toEqual(
      expect.arrayContaining([expect.objectContaining({ item: 'Arrivals not checked in', detail: 'Warned', count: 1 })]),
    );
    // Only checks that counted something and blocked or warned are on the sheet.
    for (const c of sec('Checks')) {
      expect(['Warned', 'Blocked the audit']).toContain(c.detail);
      expect(Number(c.count)).toBeGreaterThan(0);
    }
    expect(sec('Exceptions').map((r) => [r.item, r.detail, r.count])).toEqual([
      ['Reservations check in', 'No availability · Open', 1],
      ['Reservations check in', 'No availability · Resolved', 1],
    ]);
    const lines = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql
        .exec(
          `SELECT COUNT(*) AS n, COALESCE(SUM(ledger_amount_minor), 0) AS total FROM folio_line
            WHERE business_date = ? AND source = 'NIGHT_AUDIT'`,
          h.d,
        )
        .toArray(),
    );
    expect(sec('Room charges')).toEqual([
      expect.objectContaining({
        item: 'Room charges posted',
        count: (lines as Array<{ n: number }>)[0]!.n,
        amount: (lines as Array<{ total: number }>)[0]!.total,
      }),
    ]);
    expect(Number(sec('Room charges')[0]!.count)).toBeGreaterThan(0);
    const shifts = sec('Shifts');
    expect(shifts[0]).toMatchObject({ item: 'Shifts force-closed', count: 1 });
    expect(shifts[1]).toMatchObject({ item: 'Cashier shift force-closed', by: 'user_owner' });
    expect(sec('No-shows')).toEqual([expect.objectContaining({ item: 'No-shows processed', count: 1 })]);
    const stored = await runInDurableObject(h.stub, (_i, state) =>
      state.storage.sql.exec(`SELECT sha256 FROM night_audit_report WHERE business_date = ?`, h.d).toArray(),
    );
    expect(sec('Snapshots').map((r) => r.detail).sort()).toEqual(
      (stored as Array<{ sha256: string }>).map((r) => r.sha256).sort(),
    );
  });

  it('5. a date with no completed audit is an empty state, not an error', async () => {
    const h = await closedAudit();
    const open = addCalendarDays(h.d, 3);
    for (const def of REPORT_DEFINITIONS.filter((x) => x.routeId === 'get_audit_report')) {
      const body = await runAuditReport(h, def.id, `date=${open}`);
      expect(body.rows, def.id).toEqual([]);
      expect(body.totals, def.id).toBeNull();
      expect(body.emptyReason, def.id).toBe('no_closed_audit');
      expect(body.params).toEqual({ date: open });
    }
    // A property that has never closed a date: the default is the day before the business date.
    const freshId = `na-rc-none-${crypto.randomUUID()}`;
    const fresh = await provisionedPropertyStub(freshId, 'UTC', 'USD');
    await insertProperty(env, { propertyId: freshId, orgId: fresh.orgId, name: 'Fresh', jurisdiction: null, timeZone: 'UTC' });
    const bd = (await fresh.stub.readBusinessDate())!;
    const none = await runAuditReport({ propertyId: freshId, actor: 'user_owner' }, 'night_audit_report');
    expect(none.rows).toEqual([]);
    expect(none.emptyReason).toBe('no_closed_audit');
    expect(none.params).toEqual({ date: addCalendarDays(bd, -1) });
  });

  it('6. permissions: night_audit:run is required; ids from another group are 404', async () => {
    const h = await closedAudit();
    expect(V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_audit_report')).toMatchObject({
      scope: 'property',
      permission: 'night_audit:run',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    const grants = ROLE_GRANTS.staff as unknown as string[];
    expect(grants).not.toContain('night_audit:run');
    const staffId = `user_rc_staff_${crypto.randomUUID()}`;
    const org = resolveOrgStub(env.ORG_DO, { orgId: h.orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staffId, 'staff');
    for (const def of REPORT_DEFINITIONS.filter((x) => x.routeId === 'get_audit_report')) {
      const denied = await call('GET', auditUrl(h.propertyId, def.id), staffId);
      expect(denied.status, def.id).toBe(403);
      expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'night_audit:run' });
    }
    expect((await call('GET', auditUrl(h.propertyId, 'housekeeping_requests'), h.actor)).status).toBe(404);
    expect((await call('GET', auditUrl(h.propertyId, 'cashier_summary'), h.actor)).status).toBe(404);
    expect((await call('GET', auditUrl(h.propertyId, 'night_audit_nope'), h.actor)).status).toBe(404);
    expect(
      (await call('GET', `/v1/properties/${h.propertyId}/reports/housekeeping/night_audit_report`, h.actor)).status,
    ).toBe(404);
    expect((await call('GET', auditUrl(h.propertyId, 'night_audit_report', 'date=2026-02-30'), h.actor)).status).toBe(400);
  });

  it('7. two properties: one hotel closes a date, the other has nothing; no response carries a name', async () => {
    const a = await closedAudit();
    const bId = `na-rc-b-${crypto.randomUUID()}`;
    const b = await provisionedPropertyStub(bId, 'UTC', 'USD', a.orgId);
    await insertProperty(env, { propertyId: bId, orgId: a.orgId, name: 'Audit Hotel B', jurisdiction: null, timeZone: 'UTC' });
    const bd = (await b.stub.readBusinessDate())!;
    const bBody = await runAuditReport({ propertyId: bId, actor: 'user_owner' }, 'night_audit_report', `date=${bd}`);
    expect(bBody.emptyReason).toBe('no_closed_audit');
    expect(bBody.rows).toEqual([]);
    // Hotel A's closed date is unknown to hotel B.
    const bSame = await runAuditReport({ propertyId: bId, actor: 'user_owner' }, 'night_audit_report', `date=${a.d}`);
    expect(bSame.rows).toEqual([]);
    for (const def of REPORT_DEFINITIONS.filter((x) => x.routeId === 'get_audit_report')) {
      const body = await runAuditReport(a, def.id, `date=${a.d}`);
      const text = JSON.stringify(body);
      expect(text, def.id).not.toContain(GUEST_NAME);
      const keys = new Set(def.columns.map((c) => c.key));
      for (const row of [...body.rows, ...(body.totals ? [body.totals] : [])]) {
        for (const k of Object.keys(row)) expect(keys.has(k), `${def.id}.${k}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------------------------

async function provisionHotel(actor: string, label = 'a') {
  const orgId = `org_rch_${crypto.randomUUID()}`;
  const propertyId = `prop_rch_${label}_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Part C Org' })).status).toBe(201);
  const created = await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
    propertyId,
    name: `Part C Hotel ${label}`,
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const p = `/v1/properties/${propertyId}`;
  const rt = await call('POST', `${p}/room-types`, actor, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 10,
    maxOccupancy: 4,
    maxAdults: 3,
    idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
  });
  expect(rt.status).toBe(201);
  const { fromDate } = (await rt.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  await resolved!.stub.flushOutbox();
  await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, GUEST_NAME, asUser(actor));
  const bd = (await resolved!.stub.readBusinessDate())!;
  const attendant = await createHousekeeper(org, propertyId, 'Ada', undefined, asUser(actor));
  const inspector = await createHousekeeper(org, propertyId, 'Ines', undefined, asUser(actor));
  return {
    orgId,
    propertyId,
    p,
    actor,
    org,
    bd,
    guest,
    attendant,
    inspector,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
  };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function addRoom(h: Hotel, code: string, floor?: string): Promise<string> {
  const roomId = `rm_${code}_${h.propertyId.slice(-6)}`;
  const res = await call('POST', `${h.p}/rooms`, h.actor, {
    roomId,
    roomTypeId: 'rt_king',
    code,
    ...(floor ? { floor } : {}),
    idempotencyKey: `idem-room-${roomId}`,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return roomId;
}

async function createStay(h: Hotel, roomId: string, adults = 1, children = 0): Promise<string> {
  const reservationId = `res_${crypto.randomUUID()}`;
  const create = {
    reservationId,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 2),
    adults,
    children,
  };
  expect(
    await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  const ci = { reservationId, roomId };
  expect(await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${reservationId}`, ci))).toMatchObject({
    ok: true,
  });
  return reservationId;
}

const base = (h: Hotel) => `${h.p}/housekeeping`;
const write = (h: Hotel, method: string, path: string, body: Json, key = nextKey('k')) =>
  call(method, `${base(h)}${path}`, h.actor, body, key);
const read = async <T = Json>(h: Hotel, path: string): Promise<T> => {
  const res = await call('GET', `${base(h)}${path}`, h.actor);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as T;
};
const hkReport = async (h: Hotel, id: string, qs = ''): Promise<ReportResponse> => {
  const res = await call(
    'GET',
    `${h.p}/reports/housekeeping/${id}${qs ? `?${qs}` : ''}`,
    h.actor,
  );
  expect(res.status, `${id}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as ReportResponse;
};
const range = (h: Hotel) => `from=${h.bd}&to=${h.bd}`;
const mustOk = async (res: Response, status = 200) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as Json;
};

async function createStock(h: Hotel, itemId: string, name: string, category: string, onHand: number) {
  await mustOk(
    await call('POST', `${base(h)}/inventory/items`, h.actor, {
      itemId,
      name,
      category,
      unit: 'each',
      parLevel: 0,
      onHand,
      idempotencyKey: `idem-stock-${itemId}`,
    }),
    201,
  );
}

async function setupMinibar(h: Hotel) {
  const key = () => `idem-${crypto.randomUUID()}`;
  const post = async (path: string, body: Json) => {
    await mustOk(await call('POST', `${h.p}${path}`, h.actor, { ...body, idempotencyKey: key() }), 201);
  };
  await post('/charge-codes', { code: 'MBAR', name: 'Minibar' });
  await post('/product-categories', { categoryId: 'cat_mb', name: 'Minibar' });
  await post('/products', {
    productId: 'prod_water',
    categoryId: 'cat_mb',
    name: 'Water',
    chargeCode: 'MBAR',
    defaultAmountMinor: 400,
  });
  await post('/products', {
    productId: 'prod_cola',
    categoryId: 'cat_mb',
    name: 'Cola',
    chargeCode: 'MBAR',
    defaultAmountMinor: 600,
  });
  await createStock(h, 'stk_water', 'Water bottle', 'minibar', 10);
  await createStock(h, 'stk_cola', 'Cola can', 'minibar', 5);
  await mustOk(
    await call('PUT', `${h.p}/config/domain`, h.actor, {
      key: 'pms.housekeeping.minibar',
      value: {
        enabled: true,
        items: [
          { productId: 'prod_water', inventoryItemId: 'stk_water' },
          { productId: 'prod_cola', inventoryItemId: null },
        ],
      },
      reason: 'test:minibar',
      idempotencyKey: key(),
    }),
  );
}

type Seeded = Hotel & {
  r101: string;
  r102: string;
  r201: string;
  stay: string;
  sessionId: string;
  inspectionIds: string[];
};

/** Every housekeeping record the twelve reports read, on one property. */
async function seedHousekeeping(actor: string, label = 'a'): Promise<Seeded> {
  const h = await provisionHotel(actor, label);
  const r101 = await addRoom(h, '101', '1');
  const r102 = await addRoom(h, '102', '1');
  const r201 = await addRoom(h, '201', '2');
  const stay = await createStay(h, r101, 2, 1);

  // Status changes and blocks.
  await mustOk(
    await call('POST', `${h.p}/rooms/${r102}/status`, h.actor, {
      status: 'dirty',
      reason: 'Guest spill',
      comment: 'Red wine',
      idempotencyKey: nextKey('st'),
    }),
  );
  await mustOk(
    await call('POST', `${h.p}/rooms/${r102}/status`, h.actor, { status: 'clean', idempotencyKey: nextKey('st') }),
  );
  await mustOk(
    await call('POST', `${h.p}/rooms/${r201}/ooo`, h.actor, {
      startDate: h.bd,
      endDate: addCalendarDays(h.bd, 2),
      reason: 'Leak',
      blockType: 'maintenance',
      idempotencyKey: nextKey('ooo'),
    }),
  );
  const futureBlock = (await mustOk(
    await call('POST', `${h.p}/rooms/${r102}/ooo`, h.actor, {
      startDate: addCalendarDays(h.bd, 4),
      endDate: addCalendarDays(h.bd, 6),
      reason: 'Repaint',
      blockType: 'renovation',
      startTime: '08:00',
      endTime: '17:00',
      idempotencyKey: nextKey('ooo'),
    }),
  )) as { oooId: string };
  await mustOk(
    await call('POST', `${h.p}/rooms/${r102}/ooo`, h.actor, {
      oooId: futureBlock.oooId,
      startDate: addCalendarDays(h.bd, 4),
      endDate: addCalendarDays(h.bd, 4),
      releaseReason: 'Done early',
      idempotencyKey: nextKey('ooo'),
    }),
  );

  // Tasks, an assignment and an overdue task.
  await mustOk(
    await call('POST', `${base(h)}/assignments`, h.actor, {
      roomId: r101,
      businessDate: h.bd,
      assigneeRef: h.attendant.staffId,
      idempotencyKey: nextKey('assign'),
    }),
  );
  const t1 = (await mustOk(
    await write(h, 'POST', '/tasks', {
      businessDate: h.bd,
      taskType: 'departure_clean',
      roomId: r101,
      assigneeRef: h.attendant.staffId,
    }),
    201,
  )) as { task: { taskId: string } };
  await mustOk(await write(h, 'POST', `/tasks/${t1.task.taskId}/transition`, { action: 'start' }));
  await mustOk(await write(h, 'POST', `/tasks/${t1.task.taskId}/transition`, { action: 'complete' }));
  await mustOk(
    await write(h, 'POST', '/tasks', {
      businessDate: h.bd,
      taskType: 'departure_clean',
      roomId: r102,
      assigneeRef: h.attendant.staffId,
    }),
    201,
  );
  await runInDurableObject(h.stub, (_i, state) => {
    state.storage.sql.exec(
      `INSERT INTO housekeeping_task (task_id, business_date, task_type, room_id, assignee_ref, priority, status,
                                      created_at, created_by, updated_at)
       VALUES ('task_old', ?, 'departure_clean', ?, ?, 'normal', 'pending', 1, 'user_x', 1)`,
      addCalendarDays(h.bd, -1),
      r102,
      h.attendant.staffId,
    );
  });

  // Inspections.
  const tpl = (await mustOk(
    await write(h, 'POST', '/inspection-templates', {
      name: 'Departure clean',
      items: [
        { section: 'Bath', label: 'Surfaces', weight: 3, mandatory: false },
        { section: 'Bath', label: 'Towels', weight: 2, mandatory: false },
        { section: 'Bed', label: 'Bed made', weight: 5, mandatory: false },
      ],
    }),
  )) as { template: { templateId: string; items: Array<{ itemId: string }> } };
  const inspectionIds: string[] = [];
  for (const [room, results] of [
    [r101, ['pass', 'pass', 'pass']],
    [r102, ['pass', 'fail', 'not_applicable']],
  ] as const) {
    const rec = (await mustOk(
      await write(h, 'POST', '/inspections', {
        businessDate: h.bd,
        inspectorRef: h.inspector.staffId,
        roomId: room,
        templateId: tpl.template.templateId,
        answers: tpl.template.items.map((item, i) => ({ itemId: item.itemId, result: results[i] })),
      }),
      201,
    )) as { inspection: { inspectionId: string } };
    inspectionIds.push(rec.inspection.inspectionId);
  }

  // Guest audit: one room counted with a difference, then closed.
  const started = (await mustOk(await write(h, 'POST', '/guest-audits', { businessDate: h.bd }), 201)) as {
    detail: { session: { sessionId: string } };
  };
  const sessionId = started.detail.session.sessionId;
  await mustOk(
    await write(h, 'POST', `/guest-audits/${sessionId}/counts`, {
      lines: [{ roomId: r101, adults: 3, children: 1, varianceReason: 'Extra guest', evidenceNote: 'Two bags' }],
    }),
  );
  await mustOk(await write(h, 'POST', `/guest-audits/${sessionId}/close`, {}));

  // Requests, lost and found, cases.
  const req1 = (await mustOk(
    await write(h, 'POST', '/requests', { businessDate: h.bd, roomId: r101, requestType: 'extra_towels', note: 'Two' }),
    201,
  )) as { request: { requestId: string } };
  await mustOk(
    await write(h, 'POST', '/requests', { businessDate: h.bd, roomId: r101, requestType: 'wake_up_call' }),
    201,
  );
  await mustOk(
    await call('PATCH', `${base(h)}/requests/${req1.request.requestId}`, h.actor, { action: 'start' }, nextKey('k')),
  );
  await mustOk(
    await call(
      'PATCH',
      `${base(h)}/requests/${req1.request.requestId}`,
      h.actor,
      { action: 'resolve', resolution: 'Delivered' },
      nextKey('k'),
    ),
  );
  const item = (await mustOk(
    await write(h, 'POST', '/lost-items', {
      businessDate: h.bd,
      description: 'Silver watch',
      category: 'jewellery',
      foundWhere: 'Bathroom',
      roomId: r101,
      foundByRef: h.attendant.staffId,
      storageLocation: 'Safe 2',
    }),
    201,
  )) as { item: { itemId: string } };
  await mustOk(
    await call(
      'PATCH',
      `${base(h)}/lost-items/${item.item.itemId}`,
      h.actor,
      { action: 'hand_over', handedToRef: h.attendant.staffId },
      nextKey('k'),
    ),
  );
  await mustOk(
    await write(h, 'POST', '/lost-items', {
      businessDate: h.bd,
      description: 'Phone charger',
      category: 'electronics',
      foundWhere: 'Desk',
    }),
    201,
  );
  await mustOk(
    await write(h, 'POST', '/cases', {
      businessDate: h.bd,
      kind: 'damaged',
      roomId: r101,
      reservationId: stay,
      item: 'Bedside lamp',
      inspectionDetail: 'Shade cracked',
      returnedStatus: 'not_applicable',
    }),
    201,
  );

  // Linen.
  await createStock(h, 'lin_sheet', 'Sheet', 'linens', 20);
  for (const body of [
    { kind: 'issue', quantity: 4, roomId: r101, attendantRef: h.attendant.staffId },
    { kind: 'laundry_out', quantity: 3, note: 'Weekly wash' },
  ]) {
    await mustOk(await write(h, 'POST', '/linen-movements', { businessDate: h.bd, itemId: 'lin_sheet', ...body }), 201);
  }

  // Minibar.
  await setupMinibar(h);
  await mustOk(
    await write(h, 'POST', '/minibar-pickups', {
      businessDate: h.bd,
      roomId: r101,
      reservationId: stay,
      lines: [
        { productId: 'prod_water', quantity: 2 },
        { productId: 'prod_cola', quantity: 1 },
      ],
      attendantRef: h.attendant.staffId,
    }),
    201,
  );
  await mustOk(
    await write(h, 'POST', '/minibar-pickups', {
      businessDate: h.bd,
      roomId: r101,
      reservationId: stay,
      lines: [{ productId: 'prod_water', quantity: 1 }],
      complimentary: true,
      complimentaryReason: 'Apology',
    }),
    201,
  );

  // Amenities.
  await createStock(h, 'am_soap', 'Soap bar', 'amenities', 10);
  const soap = (await mustOk(
    await write(h, 'POST', '/amenities', { name: 'Soap', unit: 'bar', standardQuantity: 2, inventoryItemId: 'am_soap' }),
  )) as { amenity: { amenityId: string } };
  const rule = (await mustOk(
    await write(h, 'POST', '/amenity-rules', {
      name: 'Arrival kit',
      when: 'arrival',
      lines: [{ amenityId: soap.amenity.amenityId, quantity: 2 }],
    }),
  )) as { rule: { ruleId: string } };
  await mustOk(
    await write(h, 'POST', '/amenity-dispatches/plan', {
      businessDate: h.bd,
      ruleId: rule.rule.ruleId,
      roomIds: [r101, r102],
    }),
    201,
  );
  return { ...h, r101, r102, r201, stay, sessionId, inspectionIds };
}

const col = (rows: ReportRow[], key: string) => rows.map((r) => r[key]);

describe('R4.14 Part C: housekeeping reports equal their tab lists', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });
  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1. room status equals the live room view: condition word, block and in-house guest', async () => {
    const h = await seedHousekeeping('user_rch_1');
    const board = (await (await call('GET', `${h.p}/room-board`, h.actor)).json()) as {
      rooms: Array<{
        code: string;
        floor: string | null;
        roomTypeName: string;
        housekeepingStatus: string;
        condition: keyof typeof ROOM_BOARD_CONDITION_WORDS;
        ooo: { reason: string | null; endDate: string } | null;
        inHouse: { guestRef: string } | null;
      }>;
    };
    const body = await hkReport(h, 'housekeeping_room_status');
    expect(body.params).toEqual({});
    expect(col(body.rows, 'room')).toEqual(board.rooms.map((r) => r.code));
    expect(col(body.rows, 'condition')).toEqual(board.rooms.map((r) => ROOM_BOARD_CONDITION_WORDS[r.condition]));
    expect(col(body.rows, 'guest')).toEqual(board.rooms.map((r) => r.inHouse?.guestRef ?? null));
    expect(col(body.rows, 'block')).toEqual(board.rooms.map((r) => (r.ooo ? (r.ooo.reason ?? 'Blocked') : null)));
    expect(col(body.rows, 'blockUntil')).toEqual(board.rooms.map((r) => r.ooo?.endDate ?? null));
    expect(body.rows.find((r) => r.room === '201')).toMatchObject({ condition: 'Maintenance', block: 'Leak', floor: '2' });
    expect(body.rows.find((r) => r.room === '101')).toMatchObject({ condition: 'Occupied', guest: h.guest.guestRef });
    expect(JSON.stringify(body)).not.toContain(GUEST_NAME);
  });

  it('2. status-change history equals the per-room history; the room filter narrows it', async () => {
    const h = await seedHousekeeping('user_rch_2');
    type Hist = { history: Array<{ createdAt: number }> };
    const hist = async (room: string) =>
      ((await (await call('GET', `${h.p}/rooms/${room}/status-history`, h.actor)).json()) as Hist).history;
    const expected = [...(await hist(h.r101)), ...(await hist(h.r102)), ...(await hist(h.r201))].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    const body = await hkReport(h, 'housekeeping_status_history', range(h));
    expect(body.rows).toHaveLength(expected.length);
    expect(expected.length).toBeGreaterThanOrEqual(3);
    expect(new Set(col(body.rows, 'at'))).toEqual(new Set(expected.map((r) => r.createdAt)));
    const spill = body.rows.find((r) => r.reason === 'Guest spill')!;
    expect(spill).toMatchObject({ room: '102', to: 'Dirty', comment: 'Red wine', source: 'Front desk' });
    const only = await hkReport(h, 'housekeeping_status_history', `${range(h)}&room=${h.r102}`);
    const onlyExpected = await hist(h.r102);
    expect(col(only.rows, 'at')).toEqual(onlyExpected.map((r) => r.createdAt));
    expect(only.params).toMatchObject({ room: h.r102 });
    // Outside the dates nothing is listed.
    const later = addCalendarDays(h.bd, 3);
    expect((await hkReport(h, 'housekeeping_status_history', `from=${later}&to=${later}`)).rows).toEqual([]);
  });

  it('3. blocks equal the per-room block events: created, changed and released', async () => {
    const h = await seedHousekeeping('user_rch_3');
    const events = async (room: string) =>
      (await (await call('GET', `${h.p}/rooms/${room}/ooo-history`, h.actor)).json() as { events: Array<{ at: number; kind: string }> }).events;
    const all = [...(await events(h.r102)), ...(await events(h.r201))];
    const body = await hkReport(h, 'housekeeping_blocks', range(h));
    expect(body.rows).toHaveLength(all.length);
    expect(new Set(col(body.rows, 'at'))).toEqual(new Set(all.map((e) => e.at)));
    const released = body.rows.find((r) => r.event === 'Released')!;
    expect(released).toMatchObject({
      room: '102',
      blockType: 'Renovation',
      startDate: addCalendarDays(h.bd, 4),
      endDate: addCalendarDays(h.bd, 6),
      times: '08:00 to 17:00',
      reason: 'Done early',
    });
    expect(body.rows.filter((r) => r.event === 'Created').map((r) => r.room).sort()).toEqual(['102', '201']);
  }, 15_000);

  it('4. attendant workload equals the task list for each attendant and date; overdue counts earlier open tasks', async () => {
    const h = await seedHousekeeping('user_rch_4');
    const yesterday = addCalendarDays(h.bd, -1);
    const body = await hkReport(h, 'housekeeping_attendant_workload', `from=${yesterday}&to=${h.bd}`);
    const list = async (date: string) =>
      (await read<{ tasks: Array<{ status: string; assigneeRef: string | null }> }>(
        h,
        `/tasks?date=${date}&assigneeRef=${h.attendant.staffId}`,
      )).tasks;
    for (const date of [yesterday, h.bd]) {
      const tasks = (await list(date)).filter((t) => t.status !== 'cancelled');
      const row = body.rows.find((r) => r.date === date && r.attendant === h.attendant.staffId)!;
      expect(row.assigned).toBe(tasks.length);
      expect(row.completed).toBe(tasks.filter((t) => t.status === 'completed' || t.status === 'reviewed').length);
      expect(row.reviewed).toBe(tasks.filter((t) => t.status === 'reviewed').length);
      expect(row.open).toBe(tasks.filter((t) => ['pending', 'in_progress', 'paused'].includes(t.status)).length);
    }
    expect(body.rows.find((r) => r.date === yesterday)).toMatchObject({ assigned: 1, open: 1, overdue: 1, rooms: 0 });
    expect(body.rows.find((r) => r.date === h.bd)).toMatchObject({ assigned: 2, completed: 1, open: 1, overdue: 0, rooms: 1 });
    expect(body.totals).toMatchObject({ assigned: 3, completed: 1, open: 2, overdue: 1, rooms: 1 });
  }, 15_000);

  it('5. inspection scores equal the inspection list; the average per inspector uses the shared half-up rule', async () => {
    const h = await seedHousekeeping('user_rch_5');
    const list = await read<{ inspections: Array<{ inspectionId: string; scorePercent: number; roomCode: string }> }>(
      h,
      `/inspections?from=${h.bd}&to=${h.bd}`,
    );
    const body = await hkReport(h, 'housekeeping_inspection_scores', range(h));
    const detail = body.rows.filter((r) => r.subtotal !== 1);
    expect(col(detail, 'score')).toEqual(list.inspections.map((i) => i.scorePercent));
    expect(col(detail, 'room')).toEqual(list.inspections.map((i) => i.roomCode));
    // 100 % and (3 / 5 = 60 %): average 80.
    const avg = body.rows.filter((r) => r.subtotal === 1);
    expect(avg).toEqual([
      expect.objectContaining({
        room: 'Average',
        inspector: h.inspector.staffId,
        score: roundedRatio(list.inspections.reduce((n, i) => n + i.scorePercent, 0), list.inspections.length),
        result: '2 inspections',
      }),
    ]);
    expect(avg[0]!.score).toBe(80);
    const byRoom = await hkReport(h, 'housekeeping_inspection_scores', `${range(h)}&room=${h.r102}`);
    expect(byRoom.rows.filter((r) => r.subtotal !== 1)).toHaveLength(1);
    const byOther = await hkReport(h, 'housekeeping_inspection_scores', `${range(h)}&inspector=nobody`);
    expect(byOther.rows).toEqual([]);
  });

  it('6. guest audit: sessions with the rooms whose count differed, with reasons', async () => {
    const h = await seedHousekeeping('user_rch_6');
    const sessions = await read<{ sessions: Array<{ sessionId: string; status: string; varianceCount: number }> }>(
      h,
      `/guest-audits?from=${h.bd}&to=${h.bd}`,
    );
    const detail = await read<{ lines: Array<{ roomCode: string; varianceReason: string | null }> }>(
      h,
      `/guest-audits/${h.sessionId}`,
    );
    const body = await hkReport(h, 'housekeeping_guest_audit', range(h));
    expect(sessions.sessions).toHaveLength(1);
    expect(body.rows).toHaveLength(sessions.sessions[0]!.varianceCount);
    expect(body.rows[0]).toMatchObject({
      date: h.bd,
      session: 'Closed',
      room: '101',
      frontOffice: 3,
      housekeeping: 4,
      difference: 1,
      reason: 'Extra guest',
      evidence: 'Two bags',
    });
    expect(detail.lines.filter((l) => l.varianceReason).map((l) => l.roomCode)).toEqual(['101']);
  });

  it('7. requests equal the request list for the same filters', async () => {
    const h = await seedHousekeeping('user_rch_7');
    const list = await read<{ requests: Array<{ requestId: string; roomCode: string; status: string; department: string }> }>(
      h,
      `/requests?from=${h.bd}&to=${h.bd}`,
    );
    const body = await hkReport(h, 'housekeeping_requests', range(h));
    expect(body.rows).toHaveLength(list.requests.length);
    expect(list.requests).toHaveLength(2);
    expect(col(body.rows, 'room')).toEqual(list.requests.map((r) => r.roomCode));
    expect(body.rows.find((r) => r.type === 'Extra towels')).toMatchObject({
      department: 'Housekeeping',
      status: 'Resolved',
      resolution: 'Delivered',
      note: 'Two',
    });
    for (const [qs, q] of [
      ['status=open', 'status=open'],
      ['department=front_office', 'department=front_office'],
    ] as const) {
      const tab = await read<{ requests: unknown[] }>(h, `/requests?from=${h.bd}&to=${h.bd}&${q}`);
      const rep = await hkReport(h, 'housekeeping_requests', `${range(h)}&${qs}`);
      expect(rep.rows, qs).toHaveLength(tab.requests.length);
      expect(rep.rows.length, qs).toBe(1);
    }
  });

  it('8. the lost and found register equals the custody list, with each custody step', async () => {
    const h = await seedHousekeeping('user_rch_8');
    const list = await read<{ items: Array<{ description: string; status: string; handedOverAt: number | null }> }>(
      h,
      `/lost-items?from=${h.bd}&to=${h.bd}`,
    );
    const body = await hkReport(h, 'housekeeping_lost_found', range(h));
    expect(col(body.rows, 'item')).toEqual(list.items.map((i) => i.description));
    expect(col(body.rows, 'handedOverAt')).toEqual(list.items.map((i) => i.handedOverAt));
    expect(body.rows.find((r) => r.item === 'Silver watch')).toMatchObject({
      category: 'Jewellery',
      status: 'Handed over',
      handedTo: h.attendant.staffId,
      foundBy: h.attendant.staffId,
      storage: 'Safe 2',
    });
    const tab = await read<{ items: unknown[] }>(h, `/lost-items?from=${h.bd}&to=${h.bd}&status=found`);
    expect((await hkReport(h, 'housekeeping_lost_found', `${range(h)}&status=found`)).rows).toHaveLength(tab.items.length);
  });

  it('9. damage and missing cases equal the case list', async () => {
    const h = await seedHousekeeping('user_rch_9');
    const list = await read<{ cases: Array<{ item: string; status: string }> }>(h, `/cases?from=${h.bd}&to=${h.bd}`);
    const body = await hkReport(h, 'housekeeping_cases', range(h));
    expect(col(body.rows, 'item')).toEqual(list.cases.map((c) => c.item));
    expect(body.rows[0]).toMatchObject({ kind: 'Damage', room: '101', status: 'Open', detail: 'Shade cracked', guest: h.guest.guestRef });
    expect((await hkReport(h, 'housekeeping_cases', `${range(h)}&status=closed`)).rows).toEqual([]);
  });

  it('10. the linen log equals the movement list, item and kind filters included', async () => {
    const h = await seedHousekeeping('user_rch_10');
    const list = await read<{ movements: Array<{ movementId: string; kind: string; quantity: number; onHandAfter: number }> }>(
      h,
      `/linen-movements?from=${h.bd}&to=${h.bd}`,
    );
    const body = await hkReport(h, 'housekeeping_linen', range(h));
    expect(col(body.rows, 'kind')).toEqual(list.movements.map((m) => reportCodeWord(m.kind)));
    expect(col(body.rows, 'quantity')).toEqual(list.movements.map((m) => m.quantity));
    expect(col(body.rows, 'onHandAfter')).toEqual(list.movements.map((m) => m.onHandAfter));
    const tab = await read<{ movements: unknown[] }>(h, `/linen-movements?from=${h.bd}&to=${h.bd}&itemId=lin_sheet&kind=issue`);
    const rep = await hkReport(h, 'housekeeping_linen', `${range(h)}&item=lin_sheet&kind=issue`);
    expect(rep.rows).toHaveLength(tab.movements.length);
    expect(rep.rows[0]).toMatchObject({ item: 'Sheet', kind: 'Issue', room: '101', attendant: h.attendant.staffId });
  });

  it('11. minibar equals the reconciliation list; totals count charged pickups only', async () => {
    const h = await seedHousekeeping('user_rch_11');
    const tab = await read<{
      rows: Array<{ lineId: string; productName: string; quantity: number; amountMinor: number; status: string }>;
      totals: Array<{ postedAmountMinor: number }>;
    }>(h, `/minibar-reconciliation?from=${h.bd}&to=${h.bd}`);
    const body = await hkReport(h, 'housekeeping_minibar', range(h));
    expect(col(body.rows, 'product')).toEqual(tab.rows.map((r) => r.productName));
    expect(col(body.rows, 'amount')).toEqual(tab.rows.map((r) => r.amountMinor));
    expect(body.totals).toEqual({
      date: null,
      quantity: tab.rows.filter((r) => r.status === 'posted').reduce((n, r) => n + r.quantity, 0),
      amount: tab.totals.reduce((n, t) => n + t.postedAmountMinor, 0),
    });
    expect(Number(body.totals!.amount)).toBe(2 * 400 + 600);
    expect(body.rows.some((r) => r.status === 'Complimentary' && r.folio === 'No charge')).toBe(true);
    expect(body.rows.some((r) => r.status === 'Charged' && r.folio === 'Posted')).toBe(true);
  });

  it('12. amenity dispatches equal the dispatch ledger, line by line', async () => {
    const h = await seedHousekeeping('user_rch_12');
    const tab = await read<{ dispatches: Array<{ roomCode: string; status: string; lines: unknown[] }> }>(
      h,
      `/amenity-dispatches?from=${h.bd}&to=${h.bd}`,
    );
    const body = await hkReport(h, 'housekeeping_amenities', range(h));
    expect(tab.dispatches.length).toBeGreaterThan(0);
    expect(body.rows).toHaveLength(tab.dispatches.reduce((n, d) => n + d.lines.length, 0));
    expect(new Set(col(body.rows, 'room'))).toEqual(new Set(tab.dispatches.map((d) => d.roomCode)));
    expect(body.rows[0]).toMatchObject({ rule: 'Arrival kit', amenity: 'Soap (bar)', expected: 2, actual: null, status: 'Planned' });
    expect((await hkReport(h, 'housekeeping_amenities', `${range(h)}&status=confirmed`)).rows).toEqual([]);
  });

  it('13. permissions, group routing and parameter errors', async () => {
    const h = await seedHousekeeping('user_rch_13');
    expect(V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_housekeeping_report')).toMatchObject({
      scope: 'property',
      permission: 'housekeeping:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    const staffId = `user_rch_staff_${crypto.randomUUID()}`;
    await h.org.ensureMember(staffId, 'staff');
    const url = (id: string, qs = '') => `${h.p}/reports/housekeeping/${id}${qs ? `?${qs}` : ''}`;
    expect((await call('GET', url('housekeeping_room_status'), staffId)).status).toBe(200);
    const grants = ROLE_GRANTS.staff as unknown as string[];
    const idx = grants.indexOf('housekeeping:read');
    expect(idx).toBeGreaterThanOrEqual(0);
    grants.splice(idx, 1);
    try {
      for (const def of REPORT_DEFINITIONS.filter((d) => d.routeId === 'get_housekeeping_report')) {
        const denied = await call('GET', url(def.id), staffId);
        expect(denied.status, def.id).toBe(403);
        expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'housekeeping:read' });
      }
    } finally {
      grants.splice(idx, 0, 'housekeeping:read');
    }
    expect((await call('GET', url('night_audit_report'), h.actor)).status).toBe(404);
    expect((await call('GET', url('cashier_summary'), h.actor)).status).toBe(404);
    expect((await call('GET', url('housekeeping_nope'), h.actor)).status).toBe(404);
    expect((await call('GET', url('housekeeping_requests', `from=${h.bd}&to=${addCalendarDays(h.bd, 31)}`), h.actor)).status).toBe(422);
    expect((await call('GET', url('housekeeping_requests', `${range(h)}&department=kitchen`), h.actor)).status).toBe(400);
    expect((await call('GET', url('housekeeping_linen', `${range(h)}&kind=bogus`), h.actor)).status).toBe(400);
  });

  it('14. two properties in one org: hotel A has no hotel B rows, and no response carries a name', async () => {
    const a = await seedHousekeeping('user_rch_14');
    // A second hotel in the same org with its own request, lost item and room.
    const bId = `prop_rch_b_${crypto.randomUUID()}`;
    const bProv = await provisionedPropertyStub(bId, 'UTC', 'USD', a.orgId);
    await insertProperty(env, { propertyId: bId, orgId: a.orgId, name: 'Part C Hotel B', jurisdiction: null, timeZone: 'UTC' });
    const rtB = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 2, maxOccupancy: 2, maxAdults: 2 };
    expect((await bProv.stub.tryAddRoomType(asUser(a.actor), rtB, await idemFor(`rt-${bId}`, rtB))).ok).toBe(true);
    const bp = `/v1/properties/${bId}`;
    await mustOk(
      await call('POST', `${bp}/rooms`, a.actor, { roomId: 'rm_B900', roomTypeId: 'rt_king', code: 'B900', idempotencyKey: nextKey('rm') }),
      201,
    );
    const bd = (await bProv.stub.readBusinessDate())!;
    await mustOk(
      await call('POST', `${bp}/housekeeping/requests`, a.actor, { businessDate: bd, roomId: 'rm_B900', requestType: 'cot' }, nextKey('k')),
      201,
    );
    await mustOk(
      await call(
        'POST',
        `${bp}/housekeeping/lost-items`,
        a.actor,
        { businessDate: bd, description: 'Hotel B umbrella', category: 'other', foundWhere: 'Lobby' },
        nextKey('k'),
      ),
      201,
    );
    const bRep = await (await call('GET', `${bp}/reports/housekeeping/housekeeping_requests?from=${bd}&to=${bd}`, a.actor)).json() as ReportResponse;
    expect(bRep.rows).toHaveLength(1);
    expect(bRep.rows[0]).toMatchObject({ room: 'B900' });

    for (const def of REPORT_DEFINITIONS.filter((d) => d.routeId === 'get_housekeeping_report')) {
      const qs = def.params.kind === 'range' ? range(a) : '';
      const body = await hkReport(a, def.id, qs);
      const text = JSON.stringify(body);
      expect(text, def.id).not.toContain('B900');
      expect(text, def.id).not.toContain('Hotel B umbrella');
      expect(text, def.id).not.toContain(GUEST_NAME);
      const keys = new Set([...def.columns.map((c) => c.key), 'subtotal']);
      for (const row of [...body.rows, ...(body.totals ? [body.totals] : [])]) {
        for (const k of Object.keys(row)) expect(keys.has(k), `${def.id}.${k}`).toBe(true);
      }
      expect(body.columns).toEqual(def.columns);
    }
    expect(reportDefinition('housekeeping_minibar')!.hasTotals).toBe(true);
  });
});
