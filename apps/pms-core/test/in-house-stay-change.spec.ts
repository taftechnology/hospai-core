/**
 * R4.24 in-house stay changes — characterization (§4 of design spec).
 * TDD: written before tryChangeInHouseStay.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import {
  commandFingerprint,
  ROLE_GRANTS,
  type ActorContext,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { enumerateStayDates } from '@hospai/pms-reservations';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do.js';
import { insertProperty } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { idemFor, idemForCommand, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures.js';
import { createGuest, orgStub } from './guest-helpers.js';

type ChangeInHouseStayInput = {
  reservationId: string;
  departureDate?: string;
  roomTypeId?: string;
  roomId?: string;
  ratePlanId?: string;
  adults?: number;
  children?: number;
  reason: string;
};

type ChangeInHouseStayResult =
  | { ok: true; reservationId: string }
  | { ok: false; error: string; date?: string };

type PropertyDOWithChange = PropertyDO & {
  tryChangeInHouseStay(
    actor: ActorContext,
    input: ChangeInHouseStayInput,
    idem: { key: string; fingerprint: string },
  ): Promise<ChangeInHouseStayResult>;
};

function stubChange(stub: DurableObjectStub<PropertyDO>): DurableObjectStub<PropertyDOWithChange> {
  return stub as unknown as DurableObjectStub<PropertyDOWithChange>;
}

async function changeStay(
  stub: DurableObjectStub<PropertyDO>,
  input: ChangeInHouseStayInput,
  key: string,
  actor: ActorContext = TEST_OWNER_ACTOR,
) {
  return stubChange(stub).tryChangeInHouseStay(
    actor,
    input,
    await idemForCommand('reservations.change_in_house_stay', key, input),
  );
}

async function hotel(prefix: string, roomCount = 8) {
  const name = `ihc-${prefix}-${crypto.randomUUID()}`;
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'In House Guest');
  const roomType = {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount,
    maxOccupancy: 4,
    maxAdults: 4,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, roomType, await idemFor(`rt-${name}`, roomType));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error('room type');
  await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
  await stub.flushOutbox();
  return {
    stub,
    org,
    orgId,
    propertyId: name,
    guestRef: guest.guestRef,
    arrival: added.fromDate,
  };
}

async function addSuiteType(stub: DurableObjectStub<PropertyDO>, fromDate: string, roomCount = 8) {
  const suite = {
    roomTypeId: 'rt_suite',
    code: 'STE',
    name: 'Suite',
    roomCount,
    maxOccupancy: 4,
    maxAdults: 4,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, suite, await idemFor('rt-suite', suite));
  expect(added.ok).toBe(true);
  await seedBarRatesForHorizon(stub, 'rt_suite', fromDate);
  await stub.flushOutbox();
}

async function createRoom(
  stub: DurableObjectStub<PropertyDO>,
  roomId: string,
  code: string,
  roomTypeId = 'rt_king',
) {
  const room = { roomId, roomTypeId, code };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({
    ok: true,
  });
}

async function checkedInStay(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  reservationId: string,
  roomId: string,
  arrival: string,
  nights: number,
  extras: { roomTypeId?: string; adults?: number; children?: number; ratePlanId?: string } = {},
) {
  const roomTypeId = extras.roomTypeId ?? 'rt_king';
  const departure = addCalendarDays(arrival, nights);
  const create = {
    reservationId,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    adults: extras.adults ?? 1,
    children: extras.children ?? 0,
    ...(extras.ratePlanId ? { ratePlanId: extras.ratePlanId } : {}),
  };
  expect(
    await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor(`c-${reservationId}`, create)),
  ).toMatchObject({ ok: true });
  const assign = { reservationId, roomId };
  expect(await stub.tryAssignRoom(TEST_OWNER_ACTOR, assign, await idemFor(`as-${reservationId}`, assign))).toMatchObject({
    ok: true,
  });
  expect(
    await stub.tryCheckIn(
      TEST_OWNER_ACTOR,
      { reservationId, roomId },
      await idemFor(`ci-${reservationId}`, { reservationId, roomId }),
    ),
  ).toMatchObject({ ok: true });
  await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
  await stub.flushOutbox();
  return { departure };
}

async function soldOn(
  stub: DurableObjectStub<PropertyDO>,
  roomTypeId: string,
  stayDate: string,
): Promise<number> {
  return (await stub.readAvailabilityDay(roomTypeId, stayDate))?.sold ?? 0;
}

async function seedRate(
  stub: DurableObjectStub<PropertyDO>,
  stayDate: string,
  amountMinor: number,
  roomTypeId = 'rt_king',
  ratePlanId = DEFAULT_RATE_PLAN_ID,
) {
  const rate = { roomTypeId, ratePlanId, stayDate, amountMinor, currency: 'USD' };
  expect(
    await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor(`rate-${roomTypeId}-${ratePlanId}-${stayDate}`, rate)),
  ).toMatchObject({ ok: true });
}

async function registerPropertyForHttp(propertyId: string, orgId: string) {
  await insertProperty(env, {
    propertyId,
    orgId,
    name: 'In-House Change Hotel',
    jurisdiction: null,
    timeZone: 'UTC',
  });
}

function changeUrl(propertyId: string, reservationId: string) {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/in-house-change`;
}

describe('in-house stay change (R4.24 §4)', () => {
  it('1. extending into a sold-out night → no_availability; sold/departure/rate nights/audit unchanged', async () => {
    const { stub, guestRef, arrival } = await hotel('soldout', 1);
    await createRoom(stub, 'rm_a', '101');
    const reservationId = 'res_soldout';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_a', arrival, 2);

    const blockerNight = departure;
    const blockerDep = addCalendarDays(blockerNight, 1);
    await seedRate(stub, blockerNight, 10_000);
    const other = {
      reservationId: 'res_blocker',
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: blockerNight,
      departureDate: blockerDep,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, other, await idemFor('c-blocker', other)),
    ).toMatchObject({ ok: true });

    const soldBefore = await soldOn(stub, 'rt_king', blockerNight);
    expect(soldBefore).toBe(1);
    const ratesBefore = await stub.listReservationRateNightsForTest(reservationId);
    const auditBefore = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    const auditCountBefore = auditBefore.ok
      ? (auditBefore as unknown as { ok: true; rows: unknown[] }).rows.length
      : 0;

    const result = await changeStay(stub, {
      reservationId,
      departureDate: addCalendarDays(departure, 1),
      reason: 'Guest asked to stay',
    }, 'ext-soldout');

    expect(result).toEqual({ ok: false, error: 'no_availability', date: blockerNight });
    expect(await soldOn(stub, 'rt_king', blockerNight)).toBe(soldBefore);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(departure);
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual(ratesBefore);
    const auditAfter = await stub.listAuditLog(TEST_OWNER_ACTOR, { reservationId });
    const auditCountAfter = auditAfter.ok
      ? (auditAfter as unknown as { ok: true; rows: unknown[] }).rows.length
      : 0;
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('2. extending by two nights → sold +1 on those nights; rate nights exist; same-key replay no-op', async () => {
    const { stub, guestRef, arrival } = await hotel('ext2');
    await createRoom(stub, 'rm_ext', '101');
    const reservationId = 'res_ext2';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_ext', arrival, 2);
    const n1 = departure;
    const n2 = addCalendarDays(departure, 1);
    const newDeparture = addCalendarDays(departure, 2);
    await seedRate(stub, n1, 12_000);
    await seedRate(stub, n2, 13_000);

    expect(await soldOn(stub, 'rt_king', n1)).toBe(0);
    expect(await soldOn(stub, 'rt_king', n2)).toBe(0);

    const input: ChangeInHouseStayInput = {
      reservationId,
      departureDate: newDeparture,
      reason: 'Extend two nights',
    };
    const idem = await idemForCommand('reservations.change_in_house_stay', 'ext-two', input);
    expect(await stubChange(stub).tryChangeInHouseStay(TEST_OWNER_ACTOR, input, idem)).toEqual({
      ok: true,
      reservationId,
    });

    expect(await soldOn(stub, 'rt_king', n1)).toBe(1);
    expect(await soldOn(stub, 'rt_king', n2)).toBe(1);
    const rates = await stub.listReservationRateNightsForTest(reservationId);
    expect(rates.some((r) => r.stayDate === n1 && r.amountMinor === 12_000)).toBe(true);
    expect(rates.some((r) => r.stayDate === n2 && r.amountMinor === 13_000)).toBe(true);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(newDeparture);

    expect(await stubChange(stub).tryChangeInHouseStay(TEST_OWNER_ACTOR, input, idem)).toEqual({
      ok: true,
      reservationId,
    });
    expect(await soldOn(stub, 'rt_king', n1)).toBe(1);
    expect(await soldOn(stub, 'rt_king', n2)).toBe(1);
  });

  it('3. type change from E: inventory flip, posted lines intact, old room dirty, new room assigned', async () => {
    const { stub, guestRef, arrival } = await hotel('type');
    await addSuiteType(stub, arrival);
    await createRoom(stub, 'rm_old', '101', 'rt_king');
    await createRoom(stub, 'rm_new', '301', 'rt_suite');
    const reservationId = 'res_type';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_old', arrival, 3);

    for (const d of enumerateStayDates(arrival, departure)) {
      await seedRate(stub, d, 10_000, 'rt_king');
      await seedRate(stub, d, 20_000, 'rt_suite');
    }

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const postedBefore = (await stub.listFolioLinesForReservation(reservationId))
      .filter((l) => l.chargeCode === 'ROOM' || l.chargeCode === 'TAX')
      .map((l) => ({
        folioLineId: l.folioLineId,
        chargeCode: l.chargeCode,
        businessDate: l.businessDate,
        ledgerAmountMinor: l.ledgerAmountMinor,
        taxOf: l.taxOf,
      }));
    expect(postedBefore.some((l) => l.chargeCode === 'ROOM' && l.businessDate === arrival)).toBe(true);

    const e = addCalendarDays(arrival, 1);
    const nightsFromE = enumerateStayDates(e, departure);
    for (const night of nightsFromE) {
      expect(await soldOn(stub, 'rt_king', night)).toBe(1);
      expect(await soldOn(stub, 'rt_suite', night)).toBe(0);
    }
    expect(await soldOn(stub, 'rt_king', arrival)).toBe(1);

    await stub.flushOutbox();
    const result = await changeStay(
      stub,
      {
        reservationId,
        roomTypeId: 'rt_suite',
        roomId: 'rm_new',
        reason: 'Upgrade to suite',
      },
      'type-e',
    );
    expect(result).toEqual({ ok: true, reservationId });

    expect(await soldOn(stub, 'rt_king', arrival)).toBe(1);
    for (const night of nightsFromE) {
      expect(await soldOn(stub, 'rt_king', night)).toBe(0);
      expect(await soldOn(stub, 'rt_suite', night)).toBe(1);
    }

    const availChanged = (await stub.listOutboxPayloads())
      .filter((row) => row.eventType === 'availability.changed')
      .map((row) => JSON.parse(row.payload) as { roomTypeId: string; version: number });
    expect(availChanged.map((p) => p.roomTypeId).sort()).toEqual(['rt_king', 'rt_suite']);
    expect(new Set(availChanged.map((p) => p.version)).size).toBe(1);

    const postedAfter = (await stub.listFolioLinesForReservation(reservationId))
      .filter((l) => l.chargeCode === 'ROOM' || l.chargeCode === 'TAX')
      .map((l) => ({
        folioLineId: l.folioLineId,
        chargeCode: l.chargeCode,
        businessDate: l.businessDate,
        ledgerAmountMinor: l.ledgerAmountMinor,
        taxOf: l.taxOf,
      }));
    expect(postedAfter).toEqual(postedBefore);

    const rooms = (await stub.listRooms()).rooms;
    expect(rooms.find((r) => r.roomId === 'rm_old')?.status).toBe('dirty');
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.roomId).toBe('rm_new');
    expect(read.ok && read.reservation.roomTypeId).toBe('rt_suite');
  });

  it('4. type without roomId → room_id_required; wrong type → mismatch; occupied → vacancy error', async () => {
    const { stub, guestRef, arrival, org, propertyId } = await hotel('typegate');
    await addSuiteType(stub, arrival);
    await createRoom(stub, 'rm_a', '101', 'rt_king');
    await createRoom(stub, 'rm_suite', '301', 'rt_suite');
    await createRoom(stub, 'rm_busy', '302', 'rt_suite');
    const reservationId = 'res_typegate';
    await checkedInStay(stub, guestRef, reservationId, 'rm_a', arrival, 2);

    expect(
      await changeStay(
        stub,
        { reservationId, roomTypeId: 'rt_suite', reason: 'Need suite' },
        'no-room',
      ),
    ).toEqual({ ok: false, error: 'room_id_required' });

    expect(
      await changeStay(
        stub,
        {
          reservationId,
          roomTypeId: 'rt_suite',
          roomId: 'rm_a',
          reason: 'Wrong type room',
        },
        'wrong-type',
      ),
    ).toEqual({ ok: false, error: 'room_type_mismatch' });

    const busyGuest = await createGuest(
      org,
      propertyId,
      `guest_busy_${crypto.randomUUID().slice(0, 8)}`,
      'Busy',
    );
    await checkedInStay(stub, busyGuest.guestRef, 'res_busy', 'rm_busy', arrival, 2, {
      roomTypeId: 'rt_suite',
    });

    expect(
      await changeStay(
        stub,
        {
          reservationId,
          roomTypeId: 'rt_suite',
          roomId: 'rm_busy',
          reason: 'Into occupied',
        },
        'occupied',
      ),
    ).toEqual({ ok: false, error: 'room_already_assigned' });
  });

  it('5b. extend + plan change re-snapshots unconsumed nights and new nights onto the new plan', async () => {
    const { stub, guestRef, arrival } = await hotel('extplan');
    await createRoom(stub, 'rm_extplan', '101');
    const second = addCalendarDays(arrival, 1);
    const third = addCalendarDays(arrival, 2);
    const fourth = addCalendarDays(arrival, 3);
    for (const d of [arrival, second, third, fourth]) {
      await seedRate(stub, d, 10_000);
      await stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: 'RACK',
        stayDate: d,
        amountMinor: 15_000,
        currency: 'USD',
      });
    }
    const plan = { ratePlanId: 'RACK', code: 'RACK', name: 'Rack' };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('plan-rack-ext', plan))).toMatchObject({
      ok: true,
    });

    const reservationId = 'res_extplan';
    // 3-night stay [arrival, arrival+3); extend to arrival+4 and switch plan
    await checkedInStay(stub, guestRef, reservationId, 'rm_extplan', arrival, 3);

    const ov = {
      reservationId,
      nights: [{ stayDate: second, amountMinor: 12_000 }],
      reason: 'Walk-in deal',
    };
    expect(
      await stub.tryOverrideNightRates(
        TEST_OWNER_ACTOR,
        ov,
        await idemForCommand('reservations.override_night_rate', 'ov-extplan', ov),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    const newDeparture = addCalendarDays(arrival, 4);
    expect(
      await changeStay(
        stub,
        { reservationId, departureDate: newDeparture, ratePlanId: 'RACK', reason: 'Extend on rack' },
        'ext-plan',
      ),
    ).toEqual({ ok: true, reservationId });

    const nights = await stub.listReservationRateNightsForTest(reservationId);
    expect(nights).toEqual(
      expect.arrayContaining([
        // posted night stays on the old plan/amount
        { stayDate: arrival, amountMinor: 10_000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
        // overridden night keeps amount; plan id updated by resnapshot
        { stayDate: second, amountMinor: 12_000, currency: 'USD', ratePlanId: 'RACK' },
        // existing unconsumed night re-snapshotted to new plan
        { stayDate: third, amountMinor: 15_000, currency: 'USD', ratePlanId: 'RACK' },
        // new night from the extension on the new plan
        { stayDate: fourth, amountMinor: 15_000, currency: 'USD', ratePlanId: 'RACK' },
      ]),
    );
    expect(nights).toHaveLength(4);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.ratePlanId).toBe('RACK');
    expect(read.ok && read.reservation.departureDate).toBe(newDeparture);
  });

  it('5. rate plan change keeps posted + overridden; re-snapshots others', async () => {
    const { stub, guestRef, arrival } = await hotel('plan');
    await createRoom(stub, 'rm_plan', '101');
    const second = addCalendarDays(arrival, 1);
    const third = addCalendarDays(arrival, 2);
    for (const d of [arrival, second, third]) {
      await seedRate(stub, d, 10_000);
      await stub.seedOrphanRateDayForTest({
        roomTypeId: 'rt_king',
        ratePlanId: 'RACK',
        stayDate: d,
        amountMinor: 15_000,
        currency: 'USD',
      });
    }
    const plan = { ratePlanId: 'RACK', code: 'RACK', name: 'Rack' };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('plan-rack', plan))).toMatchObject({
      ok: true,
    });

    const reservationId = 'res_plan';
    await checkedInStay(stub, guestRef, reservationId, 'rm_plan', arrival, 3);

    const ov = {
      reservationId,
      nights: [{ stayDate: second, amountMinor: 12_000 }],
      reason: 'Walk-in deal',
    };
    expect(
      await stub.tryOverrideNightRates(
        TEST_OWNER_ACTOR,
        ov,
        await idemForCommand('reservations.override_night_rate', 'ov-plan', ov),
      ),
    ).toMatchObject({ ok: true });

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');

    expect(
      await changeStay(
        stub,
        { reservationId, ratePlanId: 'RACK', reason: 'Corporate rate' },
        'plan-chg',
      ),
    ).toEqual({ ok: true, reservationId });

    const nights = await stub.listReservationRateNightsForTest(reservationId);
    expect(nights).toEqual(
      expect.arrayContaining([
        { stayDate: arrival, amountMinor: 10_000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
        { stayDate: second, amountMinor: 12_000, currency: 'USD', ratePlanId: 'RACK' },
        { stayDate: third, amountMinor: 15_000, currency: 'USD', ratePlanId: 'RACK' },
      ]),
    );
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.ratePlanId).toBe('RACK');
  });

  it('6a. Order A: clerk extends then auto-extend does not double-count', async () => {
    const { stub, guestRef, arrival } = await hotel('aea');
    await createRoom(stub, 'rm_aea', '101');
    // due out D+1 so auto-extend would fire if still due out
    const reservationId = 'res_aea';
    await checkedInStay(stub, guestRef, reservationId, 'rm_aea', arrival, 1);
    const dueOut = addCalendarDays(arrival, 1);
    const extended = addCalendarDays(arrival, 2);
    await seedRate(stub, dueOut, 10_000);
    await seedRate(stub, extended, 10_000);

    expect(await soldOn(stub, 'rt_king', dueOut)).toBe(0);

    expect(
      await changeStay(
        stub,
        { reservationId, departureDate: extended, reason: 'Clerk first' },
        'aea-clerk',
      ),
    ).toEqual({ ok: true, reservationId });
    expect(await soldOn(stub, 'rt_king', dueOut)).toBe(1);

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(extended);
    expect(await soldOn(stub, 'rt_king', dueOut)).toBe(1);
  });

  it('6b. Order B: auto-extend then clerk extends a further night — each night +1 once', async () => {
    const { stub, guestRef, arrival } = await hotel('aeb');
    await createRoom(stub, 'rm_aeb', '101');
    const reservationId = 'res_aeb';
    await checkedInStay(stub, guestRef, reservationId, 'rm_aeb', arrival, 1);
    const dueOut = addCalendarDays(arrival, 1);
    const afterAuto = addCalendarDays(arrival, 2);
    const afterClerk = addCalendarDays(arrival, 3);
    await seedRate(stub, dueOut, 10_000);
    await seedRate(stub, afterAuto, 10_000);
    await seedRate(stub, afterClerk, 10_000);

    expect((await stub.runAuditStep(arrival, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const afterAudit = await stub.readReservation(reservationId);
    expect(afterAudit.ok && afterAudit.reservation.departureDate).toBe(afterAuto);
    expect(await soldOn(stub, 'rt_king', dueOut)).toBe(1);
    expect(await soldOn(stub, 'rt_king', afterAuto)).toBe(0);

    expect(
      await changeStay(
        stub,
        { reservationId, departureDate: afterClerk, reason: 'Clerk after audit' },
        'aeb-clerk',
      ),
    ).toEqual({ ok: true, reservationId });

    expect(await soldOn(stub, 'rt_king', dueOut)).toBe(1);
    expect(await soldOn(stub, 'rt_king', afterAuto)).toBe(1);
    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.departureDate).toBe(afterClerk);
  });

  it('7. earlier departure → use_early_depart; not checked_in → not_in_house', async () => {
    const { stub, guestRef, arrival } = await hotel('gates');
    await createRoom(stub, 'rm_g', '101');
    const reservationId = 'res_gates';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_g', arrival, 3);

    expect(
      await changeStay(
        stub,
        {
          reservationId,
          departureDate: addCalendarDays(departure, -1),
          reason: 'Leave early',
        },
        'earlier',
      ),
    ).toEqual({ ok: false, error: 'use_early_depart' });

    const confirmedId = 'res_confirmed';
    const create = {
      reservationId: confirmedId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c-conf', create)),
    ).toMatchObject({ ok: true });
    expect(
      await changeStay(
        stub,
        { reservationId: confirmedId, adults: 2, reason: 'Party' },
        'not-ci',
      ),
    ).toEqual({ ok: false, error: 'not_in_house' });
  });

  it('8. missing permission → 403; queued replay re-checks permission', async () => {
    const { stub, guestRef, arrival, orgId, propertyId, org } = await hotel('perm');
    await createRoom(stub, 'rm_p', '101');
    const reservationId = 'res_perm';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_p', arrival, 2);
    await seedRate(stub, departure, 10_000);
    await registerPropertyForHttp(propertyId, orgId);

    const adminId = 'user_ihc_admin';
    const staffId = 'user_ihc_staff';
    await org.upsertPropertyMember(adminId, propertyId, 'admin');
    await org.upsertPropertyMember(staffId, propertyId, 'staff');
    await stub.clearPermissionCacheForTest();

    const grants = ROLE_GRANTS.staff as unknown as string[];
    const idx = grants.indexOf('reservations:change_in_house');
    expect(idx).toBeGreaterThanOrEqual(0);
    grants.splice(idx, 1);
    try {
      const denied = await worker.fetch(
        new Request(changeUrl(propertyId, reservationId), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-actor': staffId,
            'x-idempotency-key': `idem-deny-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({
            departureDate: addCalendarDays(departure, 1),
            reason: 'No permission',
          }),
        }),
        env,
      );
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({
        error: 'forbidden',
        permission: 'reservations:change_in_house',
      });

      // Catalog is FAIL_CLOSED (no provisional queue). Replay re-check: demote admin to
      // staff while permission is spliced out of ROLE_GRANTS.staff, then call the DO.
      expect((ROLE_GRANTS.admin as readonly string[]).includes('reservations:change_in_house')).toBe(
        true,
      );
      const commandPayload = {
        reservationId,
        departureDate: addCalendarDays(departure, 1),
        reason: 'Queued extend',
      };
      const fingerprint = await commandFingerprint('reservations.change_in_house_stay', commandPayload);
      await org.upsertPropertyMember(adminId, propertyId, 'staff');
      await stub.clearPermissionCacheForTest();
      const demoted = await stubChange(stub).tryChangeInHouseStay(
        { kind: 'user', userId: adminId },
        commandPayload,
        { key: 'idem-replay', fingerprint },
      );
      expect(demoted).toMatchObject({ ok: false, error: 'forbidden' });
    } finally {
      grants.splice(idx, 0, 'reservations:change_in_house');
      vi.restoreAllMocks();
    }
  });

  it('9. party above occupancy → occupancy_exceeded; valid party updates adults/children', async () => {
    const { stub, guestRef, arrival } = await hotel('party');
    await createRoom(stub, 'rm_party', '101');
    const reservationId = 'res_party';
    await checkedInStay(stub, guestRef, reservationId, 'rm_party', arrival, 2, {
      adults: 1,
      children: 0,
    });

    expect(
      await changeStay(
        stub,
        { reservationId, adults: 5, children: 0, reason: 'Too many' },
        'party-over',
      ),
    ).toEqual({ ok: false, error: 'occupancy_exceeded' });

    expect(
      await changeStay(
        stub,
        { reservationId, adults: 2, children: 1, reason: 'Family joined' },
        'party-ok',
      ),
    ).toEqual({ ok: true, reservationId });

    const read = await stub.readReservation(reservationId);
    expect(read.ok && read.reservation.adults).toBe(2);
    expect(read.ok && read.reservation.children).toBe(1);
  });
});

describe('in-house stay change HTTP', () => {
  it('POST succeeds with x-idempotency-key; missing key → 400', async () => {
    const { stub, guestRef, arrival, orgId, propertyId } = await hotel('http');
    await createRoom(stub, 'rm_http', '101');
    const reservationId = 'res_http';
    const { departure } = await checkedInStay(stub, guestRef, reservationId, 'rm_http', arrival, 2);
    await seedRate(stub, departure, 10_000);
    await registerPropertyForHttp(propertyId, orgId);

    const missing = await worker.fetch(
      new Request(changeUrl(propertyId, reservationId), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_owner' },
        body: JSON.stringify({ departureDate: addCalendarDays(departure, 1), reason: 'Stay' }),
      }),
      env,
    );
    expect(missing.status).toBe(400);

    const ok = await worker.fetch(
      new Request(changeUrl(propertyId, reservationId), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': 'user_owner',
          'x-idempotency-key': `idem-ihc-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          departureDate: addCalendarDays(departure, 1),
          reason: 'Stay another night',
        }),
      }),
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, reservationId });
  });
});
