import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fingerprintPayload } from '@hospai/contracts';
import { HORIZON_DAYS } from '@hospai/pms-inventory';
import { enumerateStayDates } from '@hospai/pms-reservations';
import type { PropertyDO } from '../src/property-do';
import { idemFor, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures';
import { createGuest, orgStub } from './guest-helpers';

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
    const expected = await stub.countSoldHoldingReservationsCovering(roomTypeId, stayDate);
    expect(row.sold).toBe(expected);
  }
}

/** Resolved at module load inside the worker isolate via vitest miniflare.bindings. */
function ledgerPropSeedCases(): Array<{ seed: number; label: string }> {
  const override = env.LEDGER_PROP_SEED?.trim();
  if (override) {
    const parsed = Number(override);
    if (!Number.isFinite(parsed)) {
      throw new Error(`LEDGER_PROP_SEED must be numeric, got: ${override}`);
    }
    const seed = parsed >>> 0;
    return [{ seed, label: `0x${seed.toString(16)}` }];
  }
  const defaults = [0xdecaf, 0xcafe, 0xbeef, 0xfeed, 0xface];
  return defaults.map((seed) => ({ seed, label: `0x${seed.toString(16)}` }));
}

describe('PropertyDO sold ledger property tests', () => {
  it.each(ledgerPropSeedCases())(
    'random create/cancel/modify sequences keep sold aligned (seed $label)',
    async ({ seed }) => {
    const name = `ledger-prop-${crypto.randomUUID()}`;
    const orgId = `org_${name}`;
    const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
    const org = orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
    const rand = mulberry32(seed);

    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 4,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('add-prop', addInput));

    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const anchor = added.fromDate;
    await seedBarRatesForHorizon(stub, 'rt_king', anchor, HORIZON_DAYS);
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
        const asPending = rand() < 0.2;
        const input = {
          reservationId: id,
          roomTypeId: 'rt_king',
          guestRef: guest.guestRef,
          arrivalDate: arrival,
          departureDate: departure,
          ...(asPending ? { status: 'pending' as const } : {}),
        };
        const result = await stub.tryCreateReservation(
          TEST_OWNER_ACTOR,
          input,
          await idemFor(`c-${step}-${id}`, input),
        );
        if (result.ok) live.push({ id, roomTypeId: 'rt_king', arrival, departure });
      } else if (op < 0.62) {
        const idx = Math.floor(rand() * live.length);
        const target = live[idx]!;
        const cancelInput = { reservationId: target.id };
        const result = await stub.tryCancelReservation(
          TEST_OWNER_ACTOR,
          cancelInput,
          await idemFor(`x-${step}-${target.id}`, cancelInput),
        );
        if (result.ok) live.splice(idx, 1);
      } else if (op < 0.88) {
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
          TEST_OWNER_ACTOR,
          modifyInput,
          await idemFor(`m-${step}-${target.id}`, modifyInput),
        );
        if (result.ok) {
          target.arrival = newArrival;
          target.departure = newDeparture;
        }
      } else {
        const idx = Math.floor(rand() * live.length);
        const target = live[idx]!;
        const checkIn = { reservationId: target.id };
        await stub.tryCheckIn(
          TEST_OWNER_ACTOR,
          checkIn,
          await idemFor(`i-${step}-${target.id}`, checkIn),
        );
      }

      if (step % 3 === 0) {
        await assertSoldMatchesReservations(stub, 'rt_king', anchor);
      }
    }

    await assertSoldMatchesReservations(stub, 'rt_king', anchor);
    },
    60_000,
  );
});
