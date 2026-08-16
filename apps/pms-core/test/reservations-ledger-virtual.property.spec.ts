import { describe, expect, it } from 'vitest';
import { OOO_ROOM_ASSIGNED } from '@hospai/contracts';
import { HORIZON_DAYS } from '@hospai/pms-inventory';
import { enumerateStayDates } from '@hospai/pms-reservations';
import type { PropertyDO } from '../src/property-do';
import { idemFor, provisionedPropertyStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures';
import { createGuest, orgStub } from './guest-helpers';
import { ledgerPropSeedCases } from './ledger-prop-seeds.js';

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

type ReservationStatus = 'confirmed' | 'pending' | 'inquiry' | 'checked_in';

type BookedRoomType = 'rt_roh' | 'rt_king' | 'rt_queen';

type LiveReservation = {
  id: string;
  roomTypeId: BookedRoomType;
  allocatedRoomTypeId?: 'rt_king' | 'rt_queen';
  arrival: string;
  departure: string;
  status: ReservationStatus;
  roomId?: string;
};

const ROOM_BY_TYPE = {
  rt_king: 'room_k1',
  rt_queen: 'room_q1',
} as const;

type OpKind =
  | 'create_confirmed'
  | 'create_pending'
  | 'create_inquiry'
  | 'confirm'
  | 'hold'
  | 'cancel'
  | 'modify'
  | 'check_in'
  | 'no_show'
  | 'ooo';

const OP_WEIGHTS: Array<{ kind: OpKind; weight: number }> = [
  { kind: 'create_confirmed', weight: 0.28 },
  { kind: 'create_pending', weight: 0.1 },
  { kind: 'create_inquiry', weight: 0.07 },
  { kind: 'confirm', weight: 0.12 },
  { kind: 'hold', weight: 0.05 },
  { kind: 'cancel', weight: 0.12 },
  { kind: 'modify', weight: 0.1 },
  { kind: 'check_in', weight: 0.08 },
  { kind: 'no_show', weight: 0.05 },
  { kind: 'ooo', weight: 0.03 },
];

const CREATE_ROOM_TYPE_WEIGHTS: Array<{ roomTypeId: BookedRoomType; weight: number }> = [
  { roomTypeId: 'rt_roh', weight: 0.45 },
  { roomTypeId: 'rt_king', weight: 0.275 },
  { roomTypeId: 'rt_queen', weight: 0.275 },
];

function pickOp(rand: () => number): OpKind {
  const roll = rand();
  let cumulative = 0;
  for (const { kind, weight } of OP_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return kind;
  }
  return OP_WEIGHTS[OP_WEIGHTS.length - 1]!.kind;
}

function pickCreateRoomType(rand: () => number): BookedRoomType {
  const roll = rand();
  let cumulative = 0;
  for (const { roomTypeId, weight } of CREATE_ROOM_TYPE_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return roomTypeId;
  }
  return 'rt_roh';
}

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

function assignedRoomIds(live: LiveReservation[]): Set<string> {
  const ids = new Set<string>();
  for (const r of live) {
    if (r.roomId) ids.add(r.roomId);
  }
  return ids;
}

function unassignedPhysicalRooms(live: LiveReservation[]): string[] {
  const assigned = assignedRoomIds(live);
  return [ROOM_BY_TYPE.rt_king, ROOM_BY_TYPE.rt_queen].filter((id) => !assigned.has(id));
}

function freeRoomForReservation(live: LiveReservation[], target: LiveReservation): string | undefined {
  const allocated = target.allocatedRoomTypeId ?? target.roomTypeId;
  if (allocated !== 'rt_king' && allocated !== 'rt_queen') return undefined;
  const roomId = ROOM_BY_TYPE[allocated];
  return assignedRoomIds(live).has(roomId) ? undefined : roomId;
}

async function seedKingQueenRoh(stub: DurableObjectStub<PropertyDO>): Promise<{ anchor: string }> {
  const kingInput = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const king = await stub.tryAddRoomType(TEST_OWNER_ACTOR, kingInput, await idemFor('add-king', kingInput));
  expect(king).toMatchObject({ ok: true });
  if (!king.ok) throw new Error('add king failed');
  const anchor = king.fromDate;

  const queenInput = {
    roomTypeId: 'rt_queen',
    code: 'QUEEN',
    name: 'Queen Room',
    roomCount: 1,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, queenInput, await idemFor('add-queen', queenInput))).toMatchObject({
    ok: true,
  });

  const rohInput = {
    roomTypeId: 'rt_roh',
    code: 'ROH',
    name: 'Run of House',
    kind: 'virtual' as const,
    maxOccupancy: 2,
    maxAdults: 2,
    constituentRoomTypeIds: ['rt_king', 'rt_queen'],
  };
  expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, rohInput, await idemFor('add-roh', rohInput))).toMatchObject({
    ok: true,
  });

  await seedBarRatesForHorizon(stub, 'rt_roh', anchor);
  await seedBarRatesForHorizon(stub, 'rt_king', anchor);
  await seedBarRatesForHorizon(stub, 'rt_queen', anchor);

  for (const [roomId, roomTypeId, code] of [
    ['room_k1', 'rt_king', 'K1'],
    ['room_q1', 'rt_queen', 'Q1'],
  ] as const) {
    const room = { roomId, roomTypeId, code };
    expect(
      await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${roomId}`, room)),
    ).toMatchObject({ ok: true });
  }

  return { anchor };
}

describe('PropertyDO sold ledger virtual property tests', () => {
  it.each(ledgerPropSeedCases())(
    'virtual/physical interleave keeps physical sold aligned (seed $label)',
    async ({ seed }) => {
      const name = `ledger-vprop-${crypto.randomUUID()}`;
      const orgId = `org_${name}`;
      const { stub } = await provisionedPropertyStub(name, 'UTC', 'USD', orgId);
      const org = orgStub(orgId);
      await org.ensureMetaOrgId(orgId);
      const guest = await createGuest(org, name, `guest_${name}`, 'Test Guest');
      const rand = mulberry32(seed);

      const { anchor } = await seedKingQueenRoh(stub);

      const live: LiveReservation[] = [];
      let seq = 0;

      for (let step = 0; step < 48; step++) {
        if (live.length === 0) {
          const r = rand();
          const status: ReservationStatus = r < 30 / 45 ? 'confirmed' : r < 38 / 45 ? 'pending' : 'inquiry';
          await runCreate(stub, guest.guestRef, live, rand, anchor, seq++, step, status);
        } else {
          const op = pickOp(rand);

          if (op === 'create_confirmed' || op === 'create_pending' || op === 'create_inquiry') {
            await runCreate(
              stub,
              guest.guestRef,
              live,
              rand,
              anchor,
              seq++,
              step,
              op === 'create_confirmed' ? 'confirmed' : op === 'create_pending' ? 'pending' : 'inquiry',
            );
          } else if (op === 'confirm') {
            const candidates = live.filter((r) => r.status === 'inquiry' || r.status === 'pending');
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
            const confirmInput = { reservationId: target.id };
            const result = await stub.tryConfirm(
              TEST_OWNER_ACTOR,
              confirmInput,
              await idemFor(`cf-${step}-${target.id}`, confirmInput),
            );
            if (result.ok) {
              target.status = 'confirmed';
              if (target.roomTypeId === 'rt_roh') {
                const read = await stub.readReservation(target.id);
                if (read.ok && read.reservation.allocatedRoomTypeId) {
                  target.allocatedRoomTypeId = read.reservation.allocatedRoomTypeId as 'rt_king' | 'rt_queen';
                }
              }
            }
          } else if (op === 'hold') {
            const candidates = live.filter((r) => r.status === 'inquiry');
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
            const holdInput = { reservationId: target.id };
            const result = await stub.tryHold(
              TEST_OWNER_ACTOR,
              holdInput,
              await idemFor(`h-${step}-${target.id}`, holdInput),
            );
            if (result.ok) {
              target.status = 'pending';
              if (target.roomTypeId === 'rt_roh') {
                const read = await stub.readReservation(target.id);
                if (read.ok && read.reservation.allocatedRoomTypeId) {
                  target.allocatedRoomTypeId = read.reservation.allocatedRoomTypeId as 'rt_king' | 'rt_queen';
                }
              }
            }
          } else if (op === 'cancel') {
            const candidates = live.filter((r) => r.status !== 'checked_in');
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
            const cancelInput = { reservationId: target.id };
            const result = await stub.tryCancelReservation(
              TEST_OWNER_ACTOR,
              cancelInput,
              await idemFor(`x-${step}-${target.id}`, cancelInput),
            );
            if (result.ok) {
              const idx = live.indexOf(target);
              if (idx >= 0) live.splice(idx, 1);
            }
          } else if (op === 'modify') {
            const candidates = live.filter((r) => r.status !== 'checked_in');
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
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
              if (target.roomTypeId === 'rt_roh') {
                const read = await stub.readReservation(target.id);
                if (read.ok && read.reservation.allocatedRoomTypeId) {
                  target.allocatedRoomTypeId = read.reservation.allocatedRoomTypeId as 'rt_king' | 'rt_queen';
                }
              }
            }
          } else if (op === 'check_in') {
            const candidates = live.filter((r) => r.status === 'confirmed');
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
            const freeRoom = freeRoomForReservation(live, target);
            const checkInInput = freeRoom
              ? { reservationId: target.id, roomId: freeRoom }
              : { reservationId: target.id };
            const result = await stub.tryCheckIn(
              TEST_OWNER_ACTOR,
              checkInInput,
              await idemFor(`i-${step}-${target.id}`, checkInInput),
            );
            if (result.ok) {
              target.status = 'checked_in';
              const read = await stub.readReservation(target.id);
              if (read.ok && read.reservation.roomId) {
                target.roomId = read.reservation.roomId;
              } else if ('roomId' in checkInInput && checkInInput.roomId) {
                target.roomId = checkInInput.roomId;
              }
            }
          } else if (op === 'no_show') {
            const businessDate = (await stub.readBusinessDate())!;
            const candidates = live.filter((r) => r.status === 'confirmed' && r.arrival <= businessDate);
            if (candidates.length === 0) continue;
            const target = candidates[Math.floor(rand() * candidates.length)]!;
            const noShowInput = { reservationId: target.id };
            const result = await stub.tryNoShow(
              TEST_OWNER_ACTOR,
              noShowInput,
              await idemFor(`ns-${step}-${target.id}`, noShowInput),
            );
            if (result.ok) {
              const idx = live.indexOf(target);
              if (idx >= 0) live.splice(idx, 1);
            }
          } else if (op === 'ooo') {
            const freeRooms = unassignedPhysicalRooms(live);
            if (freeRooms.length === 0) continue;
            const roomId = freeRooms[Math.floor(rand() * freeRooms.length)]!;
            const offset = Math.floor(rand() * Math.min(14, HORIZON_DAYS - 2));
            const startDate = addDays(anchor, offset);
            const endDate = addDays(startDate, 1 + Math.floor(rand() * 2));
            const oooInput = { roomId, startDate, endDate };
            const result = await stub.trySetOooRange(
              TEST_OWNER_ACTOR,
              oooInput,
              await idemFor(`ooo-${step}-${roomId}`, oooInput),
            );
            if (!result.ok && result.error === OOO_ROOM_ASSIGNED) continue;
          }
        }

        if (step % 3 === 0) {
          await assertSoldMatchesReservations(stub, 'rt_king', anchor);
          await assertSoldMatchesReservations(stub, 'rt_queen', anchor);
        }
      }

      await assertSoldMatchesReservations(stub, 'rt_king', anchor);
      await assertSoldMatchesReservations(stub, 'rt_queen', anchor);
    },
    60_000,
  );
});

async function runCreate(
  stub: DurableObjectStub<PropertyDO>,
  guestRef: string,
  live: LiveReservation[],
  rand: () => number,
  anchor: string,
  idSeq: number,
  step: number,
  status: ReservationStatus | 'confirmed' | 'pending' | 'inquiry',
) {
  const roomTypeId = pickCreateRoomType(rand);
  const offset = Math.floor(rand() * Math.min(30, HORIZON_DAYS - 3));
  const arrival = addDays(anchor, offset);
  const los = 1 + Math.floor(rand() * 3);
  const departure = addDays(arrival, los);
  const id = `res_${idSeq}`;
  const input = {
    reservationId: id,
    roomTypeId,
    guestRef,
    arrivalDate: arrival,
    departureDate: departure,
    ...(status === 'pending' ? { status: 'pending' as const } : status === 'inquiry' ? { status: 'inquiry' as const } : {}),
  };
  const result = await stub.tryCreateReservation(
    TEST_OWNER_ACTOR,
    input,
    await idemFor(`c-${step}-${id}`, input),
  );
  if (result.ok) {
    const entry: LiveReservation = {
      id,
      roomTypeId,
      arrival,
      departure,
      status: status === 'pending' ? 'pending' : status === 'inquiry' ? 'inquiry' : 'confirmed',
    };
    if (roomTypeId === 'rt_roh' && (status === 'confirmed' || status === 'pending')) {
      const read = await stub.readReservation(id);
      if (read.ok && read.reservation.allocatedRoomTypeId) {
        entry.allocatedRoomTypeId = read.reservation.allocatedRoomTypeId as 'rt_king' | 'rt_queen';
      }
    }
    live.push(entry);
  }
}
