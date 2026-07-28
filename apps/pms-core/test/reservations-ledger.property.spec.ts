import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload } from '@hospai/contracts';
import { HORIZON_DAYS } from '@hospai/pms-inventory';
import { enumerateStayDates } from '@hospai/pms-reservations';
import { resolvePropertyStub } from '@hospai/tenant-router';
import type { PropertyDO } from '../src/property-do';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function propertyStub(name: string) {
  return resolvePropertyStub(env.PROPERTY_DO, {
    orgId: 'org_test',
    propertyId: name,
    jurisdiction: null,
  }) as DurableObjectStub<PropertyDO>;
}

async function provisionedStub(name: string): Promise<DurableObjectStub<PropertyDO>> {
  const stub = propertyStub(name);
  await stub.ensureMetaPropertyId(name);
  const fingerprint = await fingerprintPayload({ propertyId: name, timeZone: 'UTC' });
  await stub.ensureTimeZoneIfAbsent('UTC', { key: `provision:timezone:${name}`, fingerprint });
  await stub.ensureBusinessDateIfAbsent('UTC', new Date());
  await stub.ensureNightAuditSchedule('UTC', new Date());
  await stub.flushOutbox();
  return stub;
}

async function idemFor(key: string, payload: unknown) {
  return { key, fingerprint: await fingerprintPayload(payload) };
}

function addDays(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

type LiveReservation = {
  id: string;
  roomTypeId: string;
  arrival: string;
  departure: string;
};

async function assertSoldMatchesReservations(stub: DurableObjectStub<PropertyDO>, roomTypeId: string, fromDate: string) {
  const checkDays = Math.min(HORIZON_DAYS, 60);
  for (let i = 0; i < checkDays; i++) {
    const stayDate = addDays(fromDate, i);
    const row = await stub.readAvailabilityDay(roomTypeId, stayDate);
    if (!row) continue;
    const expected = await stub.countConfirmedReservationsCovering(roomTypeId, stayDate);
    expect(row.sold).toBe(expected);
  }
}

describe('PropertyDO sold ledger property tests', () => {
  it(
    'random create/cancel/modify sequences keep sold aligned with confirmed reservations',
    async () => {
    const name = `ledger-prop-${crypto.randomUUID()}`;
    const stub = await provisionedStub(name);
    const rand = mulberry32(0xdecaf);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 4,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(addInput, await idemFor('add-prop', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const anchor = added.fromDate;
    const live: LiveReservation[] = [];
    let seq = 0;

    for (let step = 0; step < 60; step++) {
      const op = rand();
      if (live.length === 0 || op < 0.45) {
        const offset = Math.floor(rand() * Math.min(30, HORIZON_DAYS - 3));
        const arrival = addDays(anchor, offset);
        const los = 1 + Math.floor(rand() * 3);
        const departure = addDays(arrival, los);
        const id = `res_${seq++}`;
        const input = {
          reservationId: id,
          roomTypeId: 'rt_king',
          arrivalDate: arrival,
          departureDate: departure,
        };
        const result = await stub.tryCreateReservation(input, await idemFor(`c-${step}-${id}`, input));
        if (result.ok) live.push({ id, roomTypeId: 'rt_king', arrival, departure });
      } else if (op < 0.7) {
        const idx = Math.floor(rand() * live.length);
        const target = live[idx]!;
        const cancelInput = { reservationId: target.id };
        const result = await stub.tryCancelReservation(
          cancelInput,
          await idemFor(`x-${step}-${target.id}`, cancelInput),
        );
        if (result.ok) live.splice(idx, 1);
      } else {
        const idx = Math.floor(rand() * live.length);
        const target = live[idx]!;
        const shift = Math.floor(rand() * 2) - 1;
        const newArrival = addDays(target.arrival, shift);
        const los = enumerateStayDates(target.arrival, target.departure).length;
        const newDeparture = addDays(newArrival, los);
        if (newArrival >= newDeparture) continue;
        const modifyInput = {
          reservationId: target.id,
          roomTypeId: target.roomTypeId,
          arrivalDate: newArrival,
          departureDate: newDeparture,
        };
        const result = await stub.tryModifyReservation(
          modifyInput,
          await idemFor(`m-${step}-${target.id}`, modifyInput),
        );
        if (result.ok) {
          target.arrival = newArrival;
          target.departure = newDeparture;
        }
      }

      if (step % 3 === 0) {
        await assertSoldMatchesReservations(stub, 'rt_king', anchor);
      }
    }

    await assertSoldMatchesReservations(stub, 'rt_king', anchor);
    },
    20_000,
  );
});
