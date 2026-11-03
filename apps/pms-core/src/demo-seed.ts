import {
  fingerprintPayload,
  GUEST_EXISTS,
  ROOM_CODE_EXISTS,
  ROOM_TYPE_EXISTS,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { enumerateHorizonDates } from '@hospai/pms-inventory';
import { resolveOrgStub } from '@hospai/tenant-router';
import type { PmsEnv } from './env.js';
import { OrgDO } from './org-do.js';
import { resolvePropertyFromRegistry } from './provision.js';
import {
  addIsoDate,
  buildDemoSeedPlan,
  DEMO_CURRENCY,
  DEMO_GUESTS,
  DEMO_RATE_AMOUNTS,
  DEMO_ROOMS,
  DEMO_ROOM_TYPES,
  demoIdempotencyKey,
  type DemoRoomType,
} from './demo-seed-fixture.js';
import { runIndiaDemoSeed } from './demo-seed-india.js';

export type DemoSeedResult = {
  ok: true;
  orgId: string;
  propertyId: string;
  propertyName: string;
  timeZone: string;
  today: string;
  alreadySeeded: boolean;
  rooms: number;
  roomTypes: Array<{ roomTypeId: string; code: string; name: string; roomCount: number }>;
  board: { inHouse: number; arrivals: number; departures: number; unassignedArrivals: number };
};

function enumerateInclusive(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  for (let d = fromDate; d <= toDate; d = addIsoDate(d, 1)) days.push(d);
  return days;
}

function roomTypeDiffers(
  existing: { code: string; name: string; roomCount: number; maxOccupancy: number; maxAdults: number },
  wanted: DemoRoomType,
): boolean {
  return (
    existing.code !== wanted.code ||
    existing.name !== wanted.name ||
    existing.roomCount !== wanted.roomCount ||
    existing.maxOccupancy !== wanted.maxOccupancy ||
    existing.maxAdults !== wanted.maxAdults
  );
}

export async function runDemoSeed(input: {
  env: PmsEnv;
  actor: { kind: 'user'; userId: string };
  orgId: string;
  propertyId: string;
  propertyName: string;
  timeZone: string;
}): Promise<DemoSeedResult> {
  const today = enumerateHorizonDates(input.timeZone, new Date(), 1)[0]!;
  const mutated = { value: false };

  const resolved = await resolvePropertyFromRegistry(input.env, input.propertyId);
  if (!resolved) throw new Error('property_do_missing');
  const stub = resolved.stub;
  const org = resolveOrgStub(input.env.ORG_DO, { orgId: input.orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(input.orgId);

  const existingTypes = await stub.listRoomTypes('all');
  for (const rt of DEMO_ROOM_TYPES) {
    const found = existingTypes.find((t) => t.roomTypeId === rt.roomTypeId);
    if (!found) {
      const addFp = await fingerprintPayload({
        roomTypeId: rt.roomTypeId,
        code: rt.code,
        name: rt.name,
        roomCount: rt.roomCount,
        maxOccupancy: rt.maxOccupancy,
        maxAdults: rt.maxAdults,
      });
      const added = await stub.tryAddRoomType(
        input.actor,
        {
          roomTypeId: rt.roomTypeId,
          code: rt.code,
          name: rt.name,
          roomCount: rt.roomCount,
          maxOccupancy: rt.maxOccupancy,
          maxAdults: rt.maxAdults,
        },
        { key: demoIdempotencyKey('rt', rt.roomTypeId), fingerprint: addFp },
      );
      if (added.ok) {
        mutated.value = true;
        continue;
      }
      if (added.error !== ROOM_TYPE_EXISTS) {
        throw new Error(`demo_seed_room_type:${rt.roomTypeId}:${added.error}`);
      }
    }
    const current =
      found ??
      (await stub.listRoomTypes('all')).find((t) => t.roomTypeId === rt.roomTypeId);
    if (current && roomTypeDiffers(current, rt)) {
      const updFp = await fingerprintPayload({
        roomTypeId: rt.roomTypeId,
        code: rt.code,
        name: rt.name,
        roomCount: rt.roomCount,
        maxOccupancy: rt.maxOccupancy,
        maxAdults: rt.maxAdults,
      });
      const updated = await stub.tryUpdateRoomType(
        input.actor,
        {
          roomTypeId: rt.roomTypeId,
          code: rt.code,
          name: rt.name,
          roomCount: rt.roomCount,
          maxOccupancy: rt.maxOccupancy,
          maxAdults: rt.maxAdults,
        },
        { key: demoIdempotencyKey('rt-upd', rt.roomTypeId), fingerprint: updFp },
      );
      if (!updated.ok) throw new Error(`demo_seed_room_type_update:${rt.roomTypeId}:${updated.error}`);
      mutated.value = true;
    }
  }

  const listedRooms = await stub.listRooms();
  const roomIds = new Set(listedRooms.rooms.map((r) => r.roomId));
  const roomCodes = new Set(listedRooms.rooms.map((r) => r.code));
  for (const room of DEMO_ROOMS) {
    if (roomIds.has(room.roomId) || roomCodes.has(room.code)) continue;
    const payload = {
      roomId: room.roomId,
      roomTypeId: room.roomTypeId,
      code: room.code,
      floor: room.floor,
    };
    const fp = await fingerprintPayload(payload);
    const created = await stub.tryCreateRoom(input.actor, payload, {
      key: demoIdempotencyKey('room', room.roomId),
      fingerprint: fp,
    });
    if (created.ok) {
      mutated.value = true;
      continue;
    }
    if (created.error === ROOM_CODE_EXISTS) continue;
    throw new Error(`demo_seed_room:${room.roomId}:${created.error}`);
  }

  const currency = (await stub.readStoredLedgerCurrency()) ?? DEMO_CURRENCY;

  if (currency === 'INR') {
    await runIndiaDemoSeed({
      actor: input.actor,
      orgId: input.orgId,
      propertyId: input.propertyId,
      stub,
      org,
      today,
      currency,
      mutated,
    });
  } else {
    const plan = buildDemoSeedPlan(today);
    await stub.ensurePastAvailabilityDays(plan.backfillFrom, plan.backfillToExclusive);
    for (const rt of DEMO_ROOM_TYPES) {
      for (const stayDate of enumerateInclusive(plan.rateFrom, plan.rateTo)) {
        const cell = {
          roomTypeId: rt.roomTypeId,
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          stayDate,
          amountMinor: DEMO_RATE_AMOUNTS[rt.roomTypeId],
          currency,
        };
        const fp = await fingerprintPayload(cell);
        const upserted = await stub.tryUpsertRateDay(input.actor, cell, {
          key: demoIdempotencyKey('rate', `${rt.roomTypeId}:${stayDate}`),
          fingerprint: fp,
        });
        if (!upserted.ok) throw new Error(`demo_seed_rate:${rt.roomTypeId}:${stayDate}:${upserted.error}`);
      }
    }

    for (const guest of DEMO_GUESTS) {
      const existingGuest = await org.readGuest(input.actor, input.propertyId, guest.guestId);
      if (existingGuest.ok) continue;
      const profile = { displayName: guest.displayName, email: guest.email };
      const fp = await fingerprintPayload({ guestId: guest.guestId, ...profile });
      const created = await org.tryCreateGuest(
        input.actor,
        input.propertyId,
        { guestId: guest.guestId, profile },
        { key: demoIdempotencyKey('guest', guest.guestId), fingerprint: fp },
      );
      if (created.ok) {
        mutated.value = true;
        continue;
      }
      if (created.error === GUEST_EXISTS) continue;
      throw new Error(`demo_seed_guest:${guest.guestId}:${created.error}`);
    }

    for (const stay of plan.stays) {
      const existing = await stub.readReservation(stay.reservationId);
      if (!existing.ok) {
        await stub.readAvailabilityRange(plan.rateFrom, plan.rateTo);
        const createPayload = {
          reservationId: stay.reservationId,
          roomTypeId: stay.roomTypeId,
          guestRef: stay.guestId,
          arrivalDate: stay.arrivalDate,
          departureDate: stay.departureDate,
          status: 'confirmed' as const,
          ratePlanId: DEFAULT_RATE_PLAN_ID,
        };
        const fp = await fingerprintPayload({
          reservationId: stay.reservationId,
          roomTypeId: stay.roomTypeId,
          arrivalDate: stay.arrivalDate,
          departureDate: stay.departureDate,
          guestRef: stay.guestId,
          status: 'confirmed',
        });
        const created = await stub.tryCreateReservation(input.actor, createPayload, {
          key: demoIdempotencyKey('res', stay.reservationId),
          fingerprint: fp,
        });
        if (!created.ok) {
          throw new Error(`demo_seed_res:${stay.reservationId}:${created.error}`);
        }
        const link = await org.upsertGuestPropertyAssociation(
          input.actor,
          input.propertyId,
          stay.guestId,
        );
        if (!link.ok) {
          throw new Error(`demo_seed_guest_link:${stay.reservationId}:${link.error}`);
        }
        mutated.value = true;
      }

      const current = await stub.readReservation(stay.reservationId);
      if (!current.ok) throw new Error(`demo_seed_res_missing:${stay.reservationId}`);

      if (stay.roomId && current.reservation.roomId == null) {
        const fp = await fingerprintPayload({ reservationId: stay.reservationId, roomId: stay.roomId });
        const assigned = await stub.tryAssignRoom(
          input.actor,
          { reservationId: stay.reservationId, roomId: stay.roomId },
          { key: demoIdempotencyKey('assign', stay.reservationId), fingerprint: fp },
        );
        if (!assigned.ok) throw new Error(`demo_seed_assign:${stay.reservationId}:${assigned.error}`);
        mutated.value = true;
      }

      const afterAssign = await stub.readReservation(stay.reservationId);
      if (!afterAssign.ok) throw new Error(`demo_seed_res_missing:${stay.reservationId}`);
      if (stay.checkIn && afterAssign.reservation.status === 'confirmed') {
        const fp = await fingerprintPayload({ reservationId: stay.reservationId });
        const checked = await stub.tryCheckIn(
          input.actor,
          { reservationId: stay.reservationId },
          { key: demoIdempotencyKey('checkin', stay.reservationId), fingerprint: fp },
        );
        if (!checked.ok) throw new Error(`demo_seed_checkin:${stay.reservationId}:${checked.error}`);
        mutated.value = true;
      }
    }
  }

  const summary = await stub.readFrontOfficeSummary(today);
  const arrivals = await stub.listArrivals(today, { limit: 50 });
  const unassignedArrivals =
    arrivals.ok ? arrivals.items.filter((item) => item.roomId == null).length : 0;
  const rooms = await stub.listRooms();
  const demoTypeIds = new Set(DEMO_ROOM_TYPES.map((t) => t.roomTypeId));
  const roomTypes = (await stub.listRoomTypes('active'))
    .filter((t) => demoTypeIds.has(t.roomTypeId as DemoRoomType['roomTypeId']))
    .map((t) => ({
      roomTypeId: t.roomTypeId,
      code: t.code,
      name: t.name,
      roomCount: t.roomCount,
    }));

  return {
    ok: true,
    orgId: input.orgId,
    propertyId: input.propertyId,
    propertyName: input.propertyName,
    timeZone: input.timeZone,
    today,
    alreadySeeded: !mutated.value,
    rooms: rooms.rooms.length,
    roomTypes,
    board: {
      inHouse: summary.inHouse,
      arrivals: summary.arrivals,
      departures: summary.departuresDue,
      unassignedArrivals,
    },
  };
}
