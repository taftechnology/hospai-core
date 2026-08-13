import { describe, expect, it } from 'vitest';
import { RATE_MISSING } from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import type { PropertyDO } from '../src/property-do';
import { addCalendarDays } from './date-helpers';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers';

async function provisionedPropertyWithGuest(name: string, timeZone = 'UTC', currency = 'USD') {
  const { stub, orgId } = await provisionedPropertyStub(name, timeZone, currency);
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
  return { stub, guestRef: guest.guestRef };
}

async function addRoomType(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, roomCount: number) {
  const input = {
    roomTypeId,
    code: 'KING',
    name: 'King Room',
    roomCount,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const result = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${roomTypeId}`, input));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('add room type failed');
  await stub.flushOutbox();
  return result;
}

describe('folio quote snapshot writers', () => {
  it('44: create pending without rate_day → RATE_MISSING, no reservation, no snapshot, sold unchanged', async () => {
    const name = `snap-44-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const arrival = added.fromDate;
    const departure = addCalendarDays(arrival, 1);
    const reservationId = `res_${crypto.randomUUID()}`;
    const input = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: arrival,
      departureDate: departure,
      status: 'pending' as const,
    };
    const result = await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c44', input));
    expect(result).toMatchObject({ ok: false, error: RATE_MISSING });
    expect(await stub.readReservation(reservationId)).toMatchObject({ ok: false });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([]);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold).toBe(0);
  });

  it('42 write: create confirmed 2-night stay snapshots both rate_day amounts', async () => {
    const name = `snap-42-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const night1 = added.fromDate;
    const night2 = addCalendarDays(night1, 1);
    const departure = addCalendarDays(night1, 2);
    const r1 = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night1,
      amountMinor: 11100,
      currency: 'USD',
    };
    const r2 = { ...r1, stayDate: night2, amountMinor: 22200 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, r1, await idemFor('r1', r1))).toMatchObject({ ok: true });
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, r2, await idemFor('r2', r2))).toMatchObject({ ok: true });
    const reservationId = `res_${crypto.randomUUID()}`;
    const input = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: night1,
      departureDate: departure,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor('c42', input))).toMatchObject({
      ok: true,
    });
    const nights = await stub.listReservationRateNightsForTest(reservationId);
    expect(nights).toEqual([
      { stayDate: night1, amountMinor: 11100, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
      { stayDate: night2, amountMinor: 22200, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);

    const edited = { ...r1, amountMinor: 99999 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, edited, await idemFor('edit1', edited))).toMatchObject({
      ok: true,
    });
    const plan = {
      ratePlanId: 'PEN',
      code: 'PEN',
      name: 'Penalty',
      cancelPenaltyType: 'first_night' as const,
      cancelGraceHours: 0,
    };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('ppen', plan))).toMatchObject({
      ok: true,
    });
    const penRate = { ...r1, ratePlanId: 'PEN', amountMinor: 11100 };
    const penRate2 = { ...r2, ratePlanId: 'PEN', amountMinor: 22200 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, penRate, await idemFor('pr1', penRate))).toMatchObject({
      ok: true,
    });
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, penRate2, await idemFor('pr2', penRate2))).toMatchObject({
      ok: true,
    });
    const penId = `res_${crypto.randomUUID()}`;
    const penCreate = {
      reservationId: penId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: night1,
      departureDate: departure,
      ratePlanId: 'PEN',
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, penCreate, await idemFor('cpen', penCreate))).toMatchObject(
      { ok: true },
    );
    const bumpPen = { ...penRate, amountMinor: 88888 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, bumpPen, await idemFor('bpen', bumpPen))).toMatchObject({
      ok: true,
    });
    expect(
      await stub.tryCancelReservation(TEST_OWNER_ACTOR, { reservationId: penId }, await idemFor('xpen', { reservationId: penId })),
    ).toMatchObject({ ok: true });
    const cancelLines = await stub.listFolioLinesForReservation(penId);
    expect(cancelLines.some((l) => l.chargeCode === 'CANCEL' && l.amountMinor === 11100)).toBe(true);

    const posted = await stub.runAuditStep(night1, 'POST_ROOM_CHARGES');
    expect(posted.status).toBe('COMPLETED');
    const roomLines = await stub.listFolioLinesForReservation(reservationId);
    expect(roomLines.some((l) => l.chargeCode === 'ROOM' && l.amountMinor === 11100)).toBe(true);
  });

  it('43: insertReservationForTest lazy-backfills snapshot from rate_day', async () => {
    const name = `snap-43-${crypto.randomUUID()}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const night1 = (await stub.readBusinessDate())!;
    const departure = addCalendarDays(night1, 1);
    await addRoomType(stub, 'rt_king', 5);
    const rate = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night1,
      amountMinor: 15000,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor('r43', rate))).toMatchObject({ ok: true });
    await stub.insertReservationForTest({
      reservationId: 'res_lazy',
      roomTypeId: 'rt_king',
      guestRef: 'g',
      piiKeyId: 'p',
      arrivalDate: night1,
      departureDate: departure,
      status: 'confirmed',
    });
    expect(await stub.listReservationRateNightsForTest('res_lazy')).toEqual([]);
    expect((await stub.runAuditStep(night1, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    expect(await stub.listReservationRateNightsForTest('res_lazy')).toEqual([
      { stayDate: night1, amountMinor: 15000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
    const bumped = { ...rate, amountMinor: 1 };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, bumped, await idemFor('b43', bumped))).toMatchObject({
      ok: true,
    });
    expect((await stub.runAuditStep(night1, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const lines = await stub.listFolioLinesForReservation('res_lazy');
    expect(lines.filter((l) => l.chargeCode === 'ROOM')).toHaveLength(1);
    expect(lines.find((l) => l.chargeCode === 'ROOM')?.amountMinor).toBe(15000);
  });

  it('45: modify adding a night snapshots the new night from current rate_day', async () => {
    const name = `snap-45-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const night1 = added.fromDate;
    const night2 = addCalendarDays(night1, 1);
    const dep1 = addCalendarDays(night1, 1);
    const dep2 = addCalendarDays(night1, 2);
    for (const [stayDate, amountMinor] of [
      [night1, 10000],
      [night2, 20000],
    ] as const) {
      const rate = {
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor,
        currency: 'USD',
      };
      expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor(stayDate, rate))).toMatchObject({
        ok: true,
      });
    }
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: night1,
      departureDate: dep1,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c45', create))).toMatchObject({
      ok: true,
    });
    const bump = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night1,
      amountMinor: 99999,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, bump, await idemFor('b45', bump))).toMatchObject({ ok: true });
    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: night1,
      departureDate: dep2,
    };
    expect(await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m45', modify))).toMatchObject({
      ok: true,
    });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night1, amountMinor: 10000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
      { stayDate: night2, amountMinor: 20000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });

  it('46: shorten after ROOM posted retains consumed snapshot and deletes unconsumed', async () => {
    const name = `snap-46-${crypto.randomUUID()}`;
    const { stub, guestRef } = await provisionedPropertyWithGuest(name);
    const added = await addRoomType(stub, 'rt_king', 5);
    const night1 = added.fromDate;
    const night2 = addCalendarDays(night1, 1);
    const dep2 = addCalendarDays(night1, 2);
    const dep1 = addCalendarDays(night1, 1);
    for (const [stayDate, amountMinor] of [
      [night1, 10000],
      [night2, 20000],
    ] as const) {
      const rate = {
        roomTypeId: 'rt_king',
        ratePlanId: DEFAULT_RATE_PLAN_ID,
        stayDate,
        amountMinor,
        currency: 'USD',
      };
      expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, rate, await idemFor(stayDate, rate))).toMatchObject({
        ok: true,
      });
    }
    const reservationId = `res_${crypto.randomUUID()}`;
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef,
      arrivalDate: night1,
      departureDate: dep2,
    };
    expect(await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c46', create))).toMatchObject({
      ok: true,
    });
    expect((await stub.runAuditStep(night1, 'POST_ROOM_CHARGES')).status).toBe('COMPLETED');
    const modify = {
      reservationId,
      roomTypeId: 'rt_king',
      arrivalDate: night1,
      departureDate: dep1,
    };
    expect(await stub.tryModifyReservation(TEST_OWNER_ACTOR, modify, await idemFor('m46', modify))).toMatchObject({
      ok: true,
    });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night1, amountMinor: 10000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
    const bump = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night1,
      amountMinor: 1,
      currency: 'USD',
    };
    expect(await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, bump, await idemFor('b46', bump))).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night1, amountMinor: 10000, currency: 'USD', ratePlanId: DEFAULT_RATE_PLAN_ID },
    ]);
  });
});
