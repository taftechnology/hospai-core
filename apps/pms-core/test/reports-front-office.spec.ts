import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  REPORT_DEFINITIONS,
  REPORT_ROW_CAP,
  V1_HTTP_ROUTE_AUDIT,
  freeAvailability,
  type ReportResponse,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { wholePercentHalfUp } from '../src/front-office-report.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { insertProperty, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, idemFor, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers.js';

/** R4.14 Part A: the six front-office reports (spec 2026-11-20-reports-a-framework-front-office). */

type Json = Record<string, unknown>;

async function call(method: string, path: string, actor: string, body?: Json) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-dev-actor': actor };
  return worker.fetch(
    new Request(`http://localhost${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }),
    env,
  );
}

const asUser = (userId: string) => ({ kind: 'user' as const, userId });
const GUEST_NAME = 'Reportable Guest';

async function provisionHotel(actor: string, label: string, opts?: { orgId?: string; suite?: boolean }) {
  const orgId = opts?.orgId ?? `org_rpt_${crypto.randomUUID()}`;
  const propertyId = `prop_rpt_${label}_${crypto.randomUUID()}`;
  let stub: DurableObjectStub<PropertyDO>;
  if (!opts?.orgId) {
    expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Report Org' })).status).toBe(201);
    expect(
      (
        await call('POST', `/v1/orgs/${encodeURIComponent(orgId)}/properties`, actor, {
          propertyId,
          name: `Report Hotel ${label}`,
          timeZone: 'UTC',
          currency: 'USD',
        })
      ).status,
    ).toBe(201);
    const rt = await call('POST', `/v1/properties/${propertyId}/room-types`, actor, {
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
    if (opts?.suite !== false) {
      const suite = await call('POST', `/v1/properties/${propertyId}/room-types`, actor, {
        roomTypeId: 'rt_suite',
        code: 'STE',
        name: 'Suite',
        roomCount: 3,
        maxOccupancy: 4,
        maxAdults: 3,
        idempotencyKey: `idem-rt2-${crypto.randomUUID()}`,
      });
      expect(suite.status).toBe(201);
    }
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    await resolved!.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved!.stub, 'rt_king', fromDate);
    stub = resolved!.stub as DurableObjectStub<PropertyDO>;
  } else {
    const p = await provisionedPropertyStub(propertyId, 'UTC', 'USD', orgId);
    await insertProperty(env, { propertyId, orgId, name: 'Second Hotel', jurisdiction: null, timeZone: 'UTC' });
    const rt = { roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 5, maxOccupancy: 4, maxAdults: 3 };
    expect((await p.stub.tryAddRoomType(asUser(actor), rt, await idemFor(`rt-${propertyId}`, rt))).ok).toBe(true);
    stub = p.stub as DurableObjectStub<PropertyDO>;
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, GUEST_NAME, asUser(actor));
  const bd = (await stub.readBusinessDate())!;
  return { orgId, propertyId, actor, bd, guest, stub };
}
type Hotel = Awaited<ReturnType<typeof provisionHotel>>;

async function book(h: Hotel, id: string, arrival: string, departure: string, status?: 'pending' | 'confirmed') {
  const create = {
    reservationId: id,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    adults: 2,
    children: 1,
    ...(status ? { status } : {}),
  };
  expect(await h.stub.tryCreateReservation(asUser(h.actor), create, await idemFor(`c-${id}`, create))).toMatchObject({
    ok: true,
  });
}

async function checkIn(h: Hotel, id: string, code: string) {
  const roomId = `rm_${code}_${h.propertyId.slice(-6)}`;
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(await h.stub.tryCreateRoom(asUser(h.actor), room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
  const ci = { reservationId: id, roomId };
  expect(await h.stub.tryCheckIn(asUser(h.actor), ci, await idemFor(`ci-${id}`, ci))).toMatchObject({ ok: true });
}

async function charge(h: Hotel, id: string, amountMinor: number) {
  const line = { folioLineId: `${id}:misc`, reservationId: id, chargeCode: 'MISC', amountMinor };
  expect(await h.stub.tryAddFolioLine(asUser(h.actor), line, await idemFor(`misc-${id}`, line))).toMatchObject({
    ok: true,
  });
}

async function cash(h: Hotel, id: string, amountMinor: number) {
  const res = await call('POST', `/v1/properties/${h.propertyId}/reservations/${id}/folio/payments/cash`, h.actor, {
    paymentId: `pay_${id}`,
    amountMinor,
    idempotencyKey: `idem-cash-${id}`,
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
}

const reportUrl = (h: Hotel, id: string, qs = '') =>
  `/v1/properties/${h.propertyId}/reports/front-office/${id}${qs ? `?${qs}` : ''}`;
async function run(h: Hotel, id: string, qs = ''): Promise<ReportResponse> {
  const res = await call('GET', reportUrl(h, id, qs), h.actor);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ReportResponse;
}
const confirmation = (id: string) => (id.length <= 8 ? id : id.slice(-8));

type Seeded = Hotel & { ids: Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5', string> };

/**
 * D0 = business date. R1 confirmed D0..D0+2 with a 5000 cash advance; R2 pending D0+1..D0+3; R3
 * checked in to 101 D0..D0+1 with a 7000 charge, a company window and a bill hold; R4 checked in
 * to 102 D0..D0+3 at zero balance; R5 cancelled D0..D0+1.
 */
async function seed(actor: string): Promise<Seeded> {
  const h = await provisionHotel(actor, 'a');
  const ids = {
    r1: `res_rpt_${crypto.randomUUID()}`,
    r2: `res_rpt_${crypto.randomUUID()}`,
    r3: `res_rpt_${crypto.randomUUID()}`,
    r4: `res_rpt_${crypto.randomUUID()}`,
    r5: `res_rpt_${crypto.randomUUID()}`,
  };
  await book(h, ids.r1, h.bd, addCalendarDays(h.bd, 2), 'confirmed');
  await cash(h, ids.r1, 5000);
  await book(h, ids.r2, addCalendarDays(h.bd, 1), addCalendarDays(h.bd, 3), 'pending');
  await book(h, ids.r3, h.bd, addCalendarDays(h.bd, 1), 'confirmed');
  await checkIn(h, ids.r3, '101');
  await charge(h, ids.r3, 7000);
  const acct = { name: 'Report Co' };
  expect(await h.stub.tryCreateCityLedgerAccount(asUser(actor), acct, await idemFor('cla-r3', acct))).toMatchObject({
    ok: true,
  });
  const co = { reservationId: ids.r3, kind: 'COMPANY' as const, billedParty: 'Report Co' };
  expect(await h.stub.tryOpenFolioWindow(asUser(actor), co, await idemFor('co-r3', co))).toMatchObject({ ok: true });
  await h.stub.writeConfigValueForTest('pms.folio.open_folio', {
    enabled: true,
    followUpDays: 3,
    closeByDays: 14,
    autoOpenOnDepartWithBalance: false,
    autoCloseAtZeroAfterDays: null,
  });
  const hold = { reservationId: ids.r3, reason: 'guest bill pending' };
  expect(await h.stub.tryPlaceFolioHold(asUser(actor), hold, await idemFor('hold-r3', hold))).toMatchObject({
    ok: true,
  });
  await book(h, ids.r4, h.bd, addCalendarDays(h.bd, 3), 'confirmed');
  await checkIn(h, ids.r4, '102');
  await h.stub.insertReservationForTest({
    reservationId: ids.r5,
    roomTypeId: 'rt_king',
    guestRef: h.guest.guestRef,
    piiKeyId: h.guest.piiKeyId,
    arrivalDate: h.bd,
    departureDate: addCalendarDays(h.bd, 1),
    status: 'cancelled',
  });
  return { ...h, ids };
}

async function availabilityRows(h: Hotel, from: string, to: string) {
  return runInDurableObject(h.stub, (_i, state) =>
    state.storage.sql
      .exec(
        `SELECT a.room_type_id AS roomTypeId, a.stay_date AS stayDate, rt.name AS name,
                a.physical, a.blocked, a.held, a.sold, a.oversell
           FROM availability_day a JOIN room_type rt ON rt.room_type_id = a.room_type_id
          WHERE a.stay_date >= ? AND a.stay_date <= ? ORDER BY a.stay_date, rt.name`,
        from,
        to,
      )
      .toArray(),
  ) as Promise<
    Array<{
      roomTypeId: string;
      stayDate: string;
      name: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
    }>
  >;
}

describe('R4.14 Part A: front-office reports', () => {
  it('1. arrivals, departures and in-house return the expected rows and totals', async () => {
    const h = await seed('user_rpt_1');
    const { ids } = h;

    const arrivals = await run(h, 'front_office_arrivals', `from=${h.bd}&to=${addCalendarDays(h.bd, 1)}`);
    expect(arrivals.reportId).toBe('front_office_arrivals');
    expect(arrivals.currency).toBe('USD');
    expect(arrivals.businessDate).toBe(h.bd);
    expect(arrivals.rows.map((r) => r.confirmation).sort()).toEqual(
      [ids.r1, ids.r2, ids.r3, ids.r4].map(confirmation).sort(),
    );
    const r1 = arrivals.rows.find((r) => r.confirmation === confirmation(ids.r1))!;
    expect(r1).toMatchObject({ nights: 2, adults: 2, children: 1, status: 'confirmed', advancePaid: 5000 });
    expect(r1.guest).toBe(h.guest.guestRef);
    expect(arrivals.rows.find((r) => r.confirmation === confirmation(ids.r3))).toMatchObject({
      room: '101',
      status: 'checked_in',
    });
    expect(arrivals.totals).toMatchObject({ nights: 2 + 2 + 1 + 3, adults: 8, children: 4, advancePaid: 5000 });
    // A status filter swaps the default set for exactly that status.
    const cancelled = await run(h, 'front_office_arrivals', `from=${h.bd}&to=${h.bd}&status=cancelled`);
    expect(cancelled.rows.map((r) => r.confirmation)).toEqual([confirmation(ids.r5)]);
    // No params: the business date.
    const defaults = await run(h, 'front_office_arrivals');
    expect(defaults.params).toEqual({ from: h.bd, to: h.bd });
    expect(defaults.rows).toHaveLength(3);

    const departures = await run(
      h,
      'front_office_departures',
      `from=${addCalendarDays(h.bd, 1)}&to=${addCalendarDays(h.bd, 1)}`,
    );
    expect(departures.rows).toHaveLength(1);
    expect(departures.rows[0]).toMatchObject({
      confirmation: confirmation(ids.r3),
      room: '101',
      status: 'checked_in',
      balance: 7000,
      onHold: 'Yes',
    });
    expect(departures.totals).toMatchObject({ balance: 7000 });
    const wide = await run(h, 'front_office_departures', `from=${h.bd}&to=${addCalendarDays(h.bd, 5)}`);
    // R1 and R2 are not checked in, so only the two in-house stays depart.
    expect(wide.rows.map((r) => r.confirmation)).toEqual([ids.r3, ids.r4].map(confirmation));
    expect(wide.rows[1]).toMatchObject({ balance: 0, onHold: 'No' });

    const inHouse = await run(h, 'front_office_in_house');
    expect(inHouse.params).toEqual({ date: h.bd });
    expect(inHouse.rows.map((r) => r.room)).toEqual(['101', '102']);
    expect(inHouse.rows[0]).toMatchObject({ roomType: 'King', balance: 7000, companyWindow: 'Yes', adults: 2, children: 1 });
    expect(inHouse.rows[1]).toMatchObject({ balance: 0, companyWindow: 'No' });
    expect(inHouse.totals).toMatchObject({ adults: 4, children: 2, balance: 7000 });
    // A date after both departures has nobody in house.
    const later = await run(h, 'front_office_in_house', `date=${addCalendarDays(h.bd, 3)}`);
    expect(later.rows.map((r) => r.room)).toEqual([]);
  });

  it('2. forecast and availability rows equal availability_day and freeAvailability', async () => {
    const h = await seed('user_rpt_2');
    const to = addCalendarDays(h.bd, 3);
    const ledger = await availabilityRows(h, h.bd, to);

    const forecast = await run(h, 'front_office_forecast', `from=${h.bd}&to=${to}`);
    expect(forecast.rows).toHaveLength(4);
    for (const row of forecast.rows) {
      const day = ledger.filter((r) => r.stayDate === row.date);
      const sum = (k: 'physical' | 'blocked' | 'held' | 'sold' | 'oversell') => day.reduce((n, r) => n + r[k], 0);
      const sellable = sum('physical') - sum('blocked');
      expect(row).toMatchObject({
        physical: sum('physical'),
        blocked: sum('blocked'),
        sellable,
        sold: sum('sold'),
        free: day.reduce((n, r) => n + freeAvailability(r), 0),
        occupancy: Math.floor((sum('sold') * 200 + sellable) / (sellable * 2)),
      });
    }
    expect(forecast.rows[0]!.physical).toBe(13);
    expect(forecast.rows[0]!.sold).toBeGreaterThan(0);
    // List counts for the date: R1, R3, R4 arrive (R5 is cancelled); R3 and R4 do not depart on D0.
    expect(forecast.rows[0]).toMatchObject({ arrivals: 3, departures: 0 });
    expect(forecast.rows[1]).toMatchObject({ arrivals: 1, departures: 1 });
    expect(forecast.totals).toMatchObject({
      physical: ledger.reduce((n, r) => n + r.physical, 0),
      sold: ledger.reduce((n, r) => n + r.sold, 0),
      free: ledger.reduce((n, r) => n + freeAvailability(r), 0),
    });

    const detailed = await run(h, 'front_office_availability_detailed', `from=${h.bd}&to=${to}`);
    expect(detailed.rows).toEqual(
      ledger.map((r) => ({
        date: r.stayDate,
        roomType: r.name,
        physical: r.physical,
        blocked: r.blocked,
        sold: r.sold,
        free: freeAvailability(r),
      })),
    );

    const end = addCalendarDays(h.bd, 89);
    const full = await availabilityRows(h, h.bd, end);
    const monthly = await run(h, 'front_office_availability_monthly', `from=${h.bd}&to=${end}`);
    const label = (m: string) =>
      new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const expected = new Map<string, { physical: number; blocked: number; sold: number; free: number }>();
    for (const r of full) {
      const key = `${r.stayDate.slice(0, 7)}|${r.name}`;
      const e = expected.get(key) ?? { physical: 0, blocked: 0, sold: 0, free: 0 };
      e.physical += r.physical;
      e.blocked += r.blocked;
      e.sold += r.sold;
      e.free += freeAvailability(r);
      expected.set(key, e);
    }
    expect(monthly.rows).toHaveLength(expected.size);
    for (const row of monthly.rows) {
      const hit = [...expected.entries()].find(([k]) => {
        const [m, name] = k.split('|');
        return label(m!) === row.month && name === row.roomType;
      });
      expect(hit, `${row.month} ${row.roomType}`).toBeDefined();
      const e = hit![1];
      expect(row).toMatchObject({ physical: e.physical, blocked: e.blocked, sold: e.sold, free: e.free });
      expect(row.occupancy).toBe(wholePercentHalfUp(e.sold, e.physical - e.blocked));
    }
  });

  it('2b. occupancy rounds half up to a whole percent', () => {
    expect(wholePercentHalfUp(1, 8)).toBe(13);
    expect(wholePercentHalfUp(1, 3)).toBe(33);
    expect(wholePercentHalfUp(2, 3)).toBe(67);
    expect(wholePercentHalfUp(0, 10)).toBe(0);
    expect(wholePercentHalfUp(10, 10)).toBe(100);
    expect(wholePercentHalfUp(0, 0)).toBeNull();
  });

  it('3. departures balance equals the GUEST window balance; arrivals advance equals the proforma', async () => {
    const h = await seed('user_rpt_3');
    const bal = await runInDurableObject(h.stub, (_i, state) => {
      const rows = state.storage.sql
        .exec(
          `SELECT COALESCE(SUM(ledger_amount_minor), 0) AS b FROM folio_line WHERE folio_window_id = ?`,
          `${h.ids.r3}:GUEST`,
        )
        .toArray() as Array<{ b: number }>;
      return Number(rows[0]!.b);
    });
    const departures = await run(h, 'front_office_departures', `from=${h.bd}&to=${addCalendarDays(h.bd, 1)}`);
    expect(departures.rows[0]!.balance).toBe(bal);

    const proforma = (await h.stub.readReservationProforma(h.ids.r1)) as unknown as {
      ok: boolean;
      totals: { advancePaidMinor: number };
    };
    expect(proforma.ok).toBe(true);
    const arrivals = await run(h, 'front_office_arrivals', `from=${h.bd}&to=${h.bd}`);
    const r1 = arrivals.rows.find((r) => r.confirmation === confirmation(h.ids.r1))!;
    expect(r1.advancePaid).toBe(proforma.totals.advancePaidMinor);
    expect(proforma.totals.advancePaidMinor).toBe(5000);
  });

  it('4. a span over the limit is 422, an unknown id 404, and an over-cap run is limit_exceeded', async () => {
    const h = await seed('user_rpt_4');
    const over = await call('GET', reportUrl(h, 'front_office_arrivals', `from=${h.bd}&to=${addCalendarDays(h.bd, 31)}`), h.actor);
    expect(over.status).toBe(422);
    expect(await over.json()).toMatchObject({ error: 'limit_exceeded', limit: 'span', max: 31 });
    const over90 = await call('GET', reportUrl(h, 'front_office_forecast', `from=${h.bd}&to=${addCalendarDays(h.bd, 90)}`), h.actor);
    expect(over90.status).toBe(422);
    expect((await call('GET', reportUrl(h, 'front_office_forecast', `from=${h.bd}&to=${addCalendarDays(h.bd, 89)}`), h.actor)).status).toBe(200);

    for (const id of ['nope', 'cashier_shift_close', 'housekeeping_room_status']) {
      const res = await call('GET', reportUrl(h, id), h.actor);
      expect(res.status, id).toBe(404);
    }
    expect((await call('GET', reportUrl(h, 'front_office_arrivals', 'from=2026-02-30&to=2026-03-01'), h.actor)).status).toBe(400);
    expect((await call('GET', reportUrl(h, 'front_office_arrivals', `from=${h.bd}`), h.actor)).status).toBe(400);
    expect((await call('GET', reportUrl(h, 'front_office_arrivals', `from=${h.bd}&to=${h.bd}&status=bogus`), h.actor)).status).toBe(400);

    const cap = await provisionHotel('user_rpt_4b', 'cap', { suite: false });
    const arrival = addCalendarDays(cap.bd, 5);
    await runInDurableObject(cap.stub, (_i, state) => {
      state.storage.sql.exec(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO reservation (reservation_id, room_type_id, guest_ref, pii_key_id, arrival_date, departure_date, status, created_at, updated_at)
         SELECT 'cap_' || i, 'rt_king', ?, ?, ?, ?, 'confirmed', 0, 0 FROM n`,
        REPORT_ROW_CAP + 1,
        cap.guest.guestRef,
        cap.guest.piiKeyId,
        arrival,
        addCalendarDays(arrival, 1),
      );
    });
    const capped = await call('GET', reportUrl(cap, 'front_office_arrivals', `from=${arrival}&to=${arrival}`), cap.actor);
    expect(capped.status).toBe(422);
    expect(await capped.json()).toMatchObject({ ok: false, error: 'limit_exceeded', limit: 'rows', max: REPORT_ROW_CAP });
    // Exactly the cap is allowed.
    await runInDurableObject(cap.stub, (_i, state) => {
      state.storage.sql.exec(`DELETE FROM reservation WHERE reservation_id = 'cap_1'`);
    });
    const exact = await run(cap, 'front_office_arrivals', `from=${arrival}&to=${arrival}`);
    expect(exact.rows).toHaveLength(REPORT_ROW_CAP);
  });

  it('5. two properties in one org do not see each other, and no row carries a name', async () => {
    const a = await seed('user_rpt_5');
    const b = await provisionHotel(a.actor, 'b', { orgId: a.orgId });
    const bRes = `res_rpt_b_${crypto.randomUUID()}`;
    await b.stub.insertReservationForTest({
      reservationId: bRes,
      roomTypeId: 'rt_king',
      guestRef: b.guest.guestRef,
      piiKeyId: b.guest.piiKeyId,
      arrivalDate: b.bd,
      departureDate: addCalendarDays(b.bd, 1),
      status: 'confirmed',
    });
    const roomB = { roomId: 'rm_B101', roomTypeId: 'rt_king', code: 'B101' };
    expect(await b.stub.tryCreateRoom(asUser(a.actor), roomB, await idemFor('rm-b', roomB))).toMatchObject({ ok: true });

    const aArr = await run(a, 'front_office_arrivals', `from=${a.bd}&to=${a.bd}`);
    const bArr = await run(b, 'front_office_arrivals', `from=${b.bd}&to=${b.bd}`);
    expect(bArr.rows.map((r) => r.confirmation)).toEqual([confirmation(bRes)]);
    expect(JSON.stringify(aArr)).not.toContain(confirmation(bRes));
    expect(JSON.stringify(bArr)).not.toContain(confirmation(a.ids.r1));
    const bForecast = await run(b, 'front_office_forecast', `from=${b.bd}&to=${b.bd}`);
    expect(bForecast.rows[0]!.physical).toBe(5);
    const aForecast = await run(a, 'front_office_forecast', `from=${a.bd}&to=${a.bd}`);
    expect(aForecast.rows[0]!.physical).toBe(13);

    for (const def of REPORT_DEFINITIONS) {
      const qs = def.params.kind === 'date' ? '' : `from=${a.bd}&to=${addCalendarDays(a.bd, 2)}`;
      const body = await run(a, def.id, qs);
      const text = JSON.stringify(body);
      expect(text, def.id).not.toContain(GUEST_NAME);
      expect(text, def.id).not.toContain('Report Co');
      expect(text, def.id).not.toContain('B101');
      // Every row and the totals use only declared columns.
      const keys = new Set(def.columns.map((c) => c.key));
      for (const row of [...body.rows, ...(body.totals ? [body.totals] : [])]) {
        for (const k of Object.keys(row)) expect(keys.has(k), `${def.id}.${k}`).toBe(true);
      }
    }
  });

  it('6. the route needs reservations:read and the pms.core entitlement', async () => {
    const h = await seed('user_rpt_6');
    expect(V1_HTTP_ROUTE_AUDIT.find((r) => r.id === 'get_front_office_report')).toMatchObject({
      scope: 'property',
      permission: 'reservations:read',
      entitlement: 'pms.core',
      degradedRead: 'FAIL_CLOSED',
    });
    const stranger = await call('GET', reportUrl(h, 'front_office_arrivals'), 'user_rpt_stranger');
    expect([403, 404]).toContain(stranger.status);
    await setKillSwitch(env, 'pms.core', true);
    try {
      const blocked = await call('GET', reportUrl(h, 'front_office_arrivals'), h.actor);
      expect(blocked.status).toBe(503);
    } finally {
      await setKillSwitch(env, 'pms.core', false);
    }
  });
});
