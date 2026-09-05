import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage, ProvisionalExceptionRow } from '@hospai/contracts';
import { BUSINESS_DATE_CLOSED, OOO_VIA_RANGE, ROOM_ALREADY_ASSIGNED, ROOM_REQUIRED, BALANCE_DUE } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import {
  isPropertyDoTransportFailure,
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
} from '../src/property-do-transport.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { idemFor, idemForCommand, seedBarRatesForHorizon } from './fixtures';
import { createGuest, orgStub as testOrgStub } from './guest-helpers';
import { createHousekeeper } from './roster-helpers';

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Degraded Mode Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef,
        arrivalDate: arrival,
        departureDate: departure,
        idempotencyKey: `idem-res-${reservationId}`,
      }),
    }),
    env,
  );
}

async function postCheckIn(propertyId: string, actor: string, reservationId: string, idemKey: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': actor,
          'x-idempotency-key': idemKey,
        },
        body: JSON.stringify({}),
      },
    ),
    env,
  );
}

async function postFolioLine(
  propertyId: string,
  actor: string,
  reservationId: string,
  idemKey: string,
  body?: { chargeCode?: string; amountMinor?: number },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          chargeCode: body?.chargeCode ?? 'MISC',
          amountMinor: body?.amountMinor ?? 1000,
          idempotencyKey: idemKey,
        }),
      },
    ),
    env,
  );
}

async function postFolioSplit(
  propertyId: string,
  actor: string,
  sourceFolioLineId: string,
  idemKey: string,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(sourceFolioLineId)}/split`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          splits: [
            { folioLineId: 'split_1', amountMinor: 500 },
            { folioLineId: 'split_2', amountMinor: 500 },
          ],
          idempotencyKey: idemKey,
        }),
      },
    ),
    env,
  );
}

async function dispatchPendingBatch(messages: PendingCommandMessage[]): Promise<void> {
  const batch = createMessageBatch(
    'hospai-pending-commands',
    messages.map((body, i) => ({
      id: `pending-${i}-${body.provisional.idempotencyKey}`,
      timestamp: new Date(),
      attempts: 1,
      body,
    })),
  );
  await worker.queue(batch, env);
}

function mockQueueSendResponse(id = crypto.randomUUID()) {
  return {
    id,
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
  } as Awaited<ReturnType<typeof env.PENDING_COMMANDS_QUEUE.send>>;
}

function mockQueueSendCapture(sent: PendingCommandMessage[]) {
  return vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockImplementation(async (body) => {
    sent.push(body);
    return mockQueueSendResponse();
  });
}

async function provisionHotel(actor: string) {
  const orgId = `org_deg_${crypto.randomUUID()}`;
  const propertyId = `prop_deg_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Deg Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
    await resolved.stub.flushOutbox();
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, arrival, stub: resolved!.stub, guestRef: guest.guestRef };
}

async function assignCleanRoom(
  stub: DurableObjectStub<import('../src/property-do.js').PropertyDO>,
  actor: string,
  reservationId: string,
  roomId: string,
  code: string,
) {
  const owner = { kind: 'user' as const, userId: actor };
  const room = { roomId, roomTypeId: 'rt_king', code };
  expect(await stub.tryCreateRoom(owner, room, await idemFor(`rm-${roomId}`, room))).toMatchObject({ ok: true });
  const assign = { reservationId, roomId };
  expect(await stub.tryAssignRoom(owner, assign, await idemFor(`as-${reservationId}`, assign))).toMatchObject({
    ok: true,
  });
  await stub.flushOutbox();
}

describe('degraded mode §4.6 fault injection', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  it('transport allowlist: harness blocked message excluded in production mode (N7)', () => {
    expect(isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(false);
    expect(
      isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE), env),
    ).toBe(true);
  });

  it('1: check-in while blocked returns 202 and leaves DO state unchanged', async () => {
    const actor = 'user_deg_1';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_1', arrival, departure, guestRef)).status).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);

    await stub.setTransportBlockedForTest(true);
    const idemKey = 'idem-ci-deg-1';
    const res = await postCheckIn(propertyId, actor, 'res_deg_1', idemKey);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, provisional: true, commandId: 'reservations.check_in' });
    expect(sent).toHaveLength(1);

    await stub.setTransportBlockedForTest(false);
    expect(await stub.getReservationStatus('res_deg_1')).toBe('confirmed');
  });

  it('2: unblock and consumer replay checks in with issuedAt/replayedAt on outbox', async () => {
    const actor = 'user_deg_2';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_2', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_2', 'rm_deg_2', '302');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);

    await stub.setTransportBlockedForTest(true);
    const idemKey = 'idem-ci-deg-2';
    expect((await postCheckIn(propertyId, actor, 'res_deg_2', idemKey)).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    await dispatchPendingBatch(sent);
    expect(await stub.getReservationStatus('res_deg_2')).toBe('checked_in');
    const payloads = await stub.listOutboxPayloads();
    expect(payloads.filter((p) => p.eventType === 'reservation.status_changed')).toHaveLength(1);
    const payload = JSON.parse(payloads.find((p) => p.eventType === 'reservation.status_changed')!.payload) as {
      issuedAt: string;
      replayedAt: string;
      provisional: boolean;
    };
    expect(payload.provisional).toBe(true);
    expect(payload.issuedAt).toBe(sent[0]!.provisional.issuedAt);
    expect(typeof payload.replayedAt).toBe('string');
  });

  it('3: same idempotency key provisional then live yields one mutation', async () => {
    const actor = 'user_deg_3';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_3', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_3', 'rm_deg_3', '303');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);

    const idemKey = 'idem-ci-deg-3';
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_deg_3', idemKey)).status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    await dispatchPendingBatch(sent);

    const live = await postCheckIn(propertyId, actor, 'res_deg_3', idemKey);
    expect(live.status).toBe(200);
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['reservation.status_changed']),
    );
    expect((await stub.listOutboxEventTypes()).filter((t) => t === 'reservation.status_changed')).toHaveLength(1);
  });

  it('4: FAIL_CLOSED create reservation while blocked returns degraded 503 without ledger mutation', async () => {
    const actor = 'user_deg_4';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    await stub.setTransportBlockedForTest(true);
    const res = await postReservation(propertyId, actor, 'res_deg_4', arrival, departure, guestRef);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'reservations.create',
    });
    expect(res.headers.get('Retry-After')).toBe('30');
    await stub.setTransportBlockedForTest(false);
    expect((await stub.readAvailabilityDay('rt_king', arrival))?.sold ?? 0).toBe(0);
  });

  it('4b: FAIL_CLOSED cancel reservation while blocked returns degraded 503', async () => {
    const actor = 'user_deg_4b';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect(
      (await postReservation(propertyId, actor, 'res_deg_4b', arrival, departure, guestRef)).status,
    ).toBe(201);

    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent('res_deg_4b')}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ idempotencyKey: 'idem-cancel-4b' }),
        },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'reservations.cancel',
    });
    expect(res.headers.get('Retry-After')).toBe('30');
    await stub.setTransportBlockedForTest(false);
    expect(await stub.getReservationStatus('res_deg_4b')).toBe('confirmed');
  });

  it('4c: FAIL_CLOSED modify reservation while blocked returns degraded 503', async () => {
    const actor = 'user_deg_4c';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect(
      (await postReservation(propertyId, actor, 'res_deg_4c', arrival, departure, guestRef)).status,
    ).toBe(201);

    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent('res_deg_4c')}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            roomTypeId: 'rt_king',
            arrivalDate: arrival,
            departureDate: addDays(arrival, 3),
            idempotencyKey: 'idem-modify-4c',
          }),
        },
      ),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
      commandId: 'reservations.modify',
    });
    expect(res.headers.get('Retry-After')).toBe('30');
    await stub.setTransportBlockedForTest(false);
    const read = await stub.readReservation('res_deg_4c');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.reservation.departureDate).toBe(departure);
    }
  });

  it('5a: replay before apply after business date rolled records business_date_closed exception', async () => {
    const actor = 'user_deg_5a';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_5a', arrival, departure, guestRef)).status).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);

    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_deg_5a', 'idem-5a')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const closedDate = addDays(sent[0]!.provisional.businessDate, 1);
    await stub.setBusinessDateForTest(closedDate);
    await dispatchPendingBatch(sent);

    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions.length).toBe(1);
    expect(exceptions[0]!.reason).toBe('business_date_closed');
    expect(await stub.getReservationStatus('res_deg_5a')).toBe('confirmed');
  });

  it('5b: replay after successful apply with rolled date returns cached idempotency without exception', async () => {
    const actor = 'user_deg_5b';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_5b', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_5b', 'rm_deg_5b', '305');

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-5b',
        requestFingerprint: (
          await idemForCommand('reservations.check_in', 'idem-5b', { reservationId: 'res_deg_5b' })
        ).fingerprint,
        propertyId,
        orgId: `org_deg_${propertyId}`,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_deg_5b' } },
        routeId: 'post_reservation_check_in',
      },
    };
    msg.provisional.orgId = (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId;

    await dispatchPendingBatch([msg]);
    expect(await stub.getReservationStatus('res_deg_5b')).toBe('checked_in');

    const closedDate = addDays(arrival, 1);
    await stub.setBusinessDateForTest(closedDate);
    await dispatchPendingBatch([msg]);

    expect(await stub.countProvisionalExceptions()).toBe(0);
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['reservation.status_changed']),
    );
    expect((await stub.listOutboxEventTypes()).filter((t) => t === 'reservation.status_changed')).toHaveLength(1);
  });

  it('6: duplicate queue delivery applies once', async () => {
    const actor = 'user_deg_6';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_6', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_6', 'rm_deg_6', '306');

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-6',
        requestFingerprint: (
          await idemForCommand('reservations.check_in', 'idem-6', { reservationId: 'res_deg_6' })
        ).fingerprint,
        propertyId,
        orgId: '',
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_deg_6' } },
        routeId: 'post_reservation_check_in',
      },
    };
    msg.provisional.orgId = (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId;

    await dispatchPendingBatch([msg, msg]);
    expect(await stub.listOutboxEventTypes()).toEqual(
      expect.arrayContaining(['reservation.status_changed']),
    );
    expect((await stub.listOutboxEventTypes()).filter((t) => t === 'reservation.status_changed')).toHaveLength(1);
  });

  it('6b: duplicate delivery after offboard does not create false exception', async () => {
    const actor = 'user_deg_6b';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_6b', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_6b', 'rm_deg_6b', '316');

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-6b',
        requestFingerprint: (
          await idemForCommand('reservations.check_in', 'idem-6b', { reservationId: 'res_deg_6b' })
        ).fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_deg_6b' } },
        routeId: 'post_reservation_check_in',
      },
    };

    await dispatchPendingBatch([msg]);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();
    await dispatchPendingBatch([msg]);
    expect(await stub.countProvisionalExceptions()).toBe(0);
  });

  it('7: queue.send failure does not return 202', async () => {
    const actor = 'user_deg_7';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_7', arrival, departure, guestRef)).status).toBe(201);

    let calls = 0;
    vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('send_failed');
      return mockQueueSendResponse();
    });

    await stub.setTransportBlockedForTest(true);
    const first = await postCheckIn(propertyId, actor, 'res_deg_7', 'idem-7');
    expect(first.status).not.toBe(202);
    expect(calls).toBe(1);

    const second = await postCheckIn(propertyId, actor, 'res_deg_7', 'idem-7');
    expect(second.status).toBe(202);
    expect(calls).toBe(2);
    await stub.setTransportBlockedForTest(false);
  });

  it('9: missing idempotency key while blocked still returns 400', async () => {
    const actor = 'user_deg_9';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_9', arrival, departure, guestRef)).status).toBe(201);
    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_deg_9/check-in`,
        { method: 'POST', headers: { 'x-dev-actor': actor } },
      ),
      env,
    );
    expect(res.status).toBe(400);
    await stub.setTransportBlockedForTest(false);
  });

  it('10: unknown DO throw returns 500 and does not queue', async () => {
    const actor = 'user_deg_10';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_10', arrival, departure, guestRef)).status).toBe(201);

    const sendSpy = vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send');
    await stub.setSimulateBugForTest(true);
    const res = await postCheckIn(propertyId, actor, 'res_deg_10', 'idem-10');
    expect(res.status).toBe(500);
    expect(sendSpy).not.toHaveBeenCalled();
    await stub.setSimulateBugForTest(false);
  });

  it('11: direct DO tryCheckIn with non-member actor returns not_member without mutation', async () => {
    const { propertyId, arrival, stub, guestRef } = await provisionHotel('user_deg_11');
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, 'user_deg_11', 'res_gate_11', arrival, departure, guestRef)).status).toBe(
      201,
    );
    const unackedBefore = await stub.outboxUnackedCount();

    const result = await stub.tryCheckIn(
      { kind: 'user', userId: 'user_non_member' },
      { reservationId: 'res_gate_11' },
      await idemFor('ci-11', { reservationId: 'res_gate_11' }),
    );
    expect(result).toEqual({ ok: false, error: 'not_member' });
    expect(await stub.getReservationStatus('res_gate_11')).toBe('confirmed');
    expect(await stub.outboxUnackedCount()).toBe(unackedBefore);
  });

  it('X2a: first replay after offboard before apply → not_member exception; not checked in', async () => {
    const actor = 'user_deg_x2a';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_x2a', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_deg_x2a', 'rm_deg_x2a', '317');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_deg_x2a', 'idem-x2a')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();

    await dispatchPendingBatch(sent);
    expect(await stub.countProvisionalExceptions()).toBe(1);
    expect(await stub.getReservationStatus('res_deg_x2a')).toBe('confirmed');
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions[0]!.reason).toBe('not_member');
  });

  it('13 (= degraded-suite 8): folio.add_item queues while blocked and replays once', async () => {
    const actor = 'user_deg_folio13';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio13';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await postFolioLine(propertyId, actor, reservationId, 'idem-folio-13');
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.provisional.command.type).toBe('folio.add_item');
    await dispatchPendingBatch(sent);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
    expect(await stub.listOutboxEventTypes()).toContain('folio.line_posted');
  });

  it('X2b: folio.add_item replay after offboard → exception; no folio line', async () => {
    const actor = 'user_deg_x2b';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_x2b';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const folioLineId = `${reservationId}:item:idem-x2b`;
    const payload = {
      reservationId,
      folioLineId,
      chargeCode: 'MISC',
      amountMinor: 1500,
    };
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-x2b',
        requestFingerprint: (await idemForCommand('folio.add_item', 'idem-x2b', payload)).fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload },
        routeId: 'post_folio_line',
      },
    };

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();

    await dispatchPendingBatch([msg]);
    expect(await stub.countProvisionalExceptions()).toBe(1);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(0);
  });

  it('14: folio.split_charge while blocked returns FAIL_CLOSED 503 and does not queue', async () => {
    const actor = 'user_deg_folio14';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio14';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);
    const sourceId = `${reservationId}:item:source-14`;
    expect((await postFolioLine(propertyId, actor, reservationId, 'source-14')).status).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await postFolioSplit(propertyId, actor, sourceId, 'idem-split-14');
    expect(blocked.status).toBe(503);
    const body = (await blocked.json()) as { degraded?: string; commandId?: string };
    expect(body.degraded).toBe('FAIL_CLOSED');
    expect(body.commandId).toBe('folio.split_charge');
    expect(sent).toHaveLength(0);
    await stub.setTransportBlockedForTest(false);
  });

  it('15: duplicate folio.add_item replay applies once', async () => {
    const actor = 'user_deg_folio15';
    const { orgId, propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio15';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-folio-15',
        requestFingerprint: (
          await idemForCommand('folio.add_item', 'idem-folio-15', {
            reservationId,
            folioLineId: `${reservationId}:item:idem-folio-15`,
            chargeCode: 'MISC',
            amountMinor: 1000,
          })
        ).fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: {
          type: 'folio.add_item',
          payload: {
            reservationId,
            folioLineId: `${reservationId}:item:idem-folio-15`,
            chargeCode: 'MISC',
            amountMinor: 1000,
          },
        },
        routeId: 'post_folio_lines',
      },
    };

    await dispatchPendingBatch([msg, msg]);
    expect(await stub.countFolioLinesForReservation(reservationId)).toBe(1);
  });

  it('22: room status queues while blocked and replays once', async () => {
    const actor = 'user_deg_room22';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              roomId: 'room_deg_22',
              roomTypeId: 'rt_king',
              code: '622',
              idempotencyKey: 'idem-create-22',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    await stub.flushOutbox();

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/room_deg_22/status`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ status: 'dirty', idempotencyKey: 'idem-st-22' }),
        },
      ),
      env,
    );
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.provisional.command.type).toBe('rooms.update_status');
    await dispatchPendingBatch(sent);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'room_deg_22')?.status).toBe(
      'dirty',
    );
    expect(await stub.listOutboxEventTypes()).toEqual(['room.status_changed']);
    const payloads = await stub.listOutboxPayloads();
    const statusEvt = payloads.find((p) => p.eventType === 'room.status_changed');
    expect(statusEvt).toBeTruthy();
    const payload = JSON.parse(statusEvt!.payload) as {
      provisional?: boolean;
      issuedAt?: string;
      replayedAt?: string;
    };
    expect(payload.provisional).toBe(true);
    expect(payload.issuedAt).toBe(sent[0]!.provisional.issuedAt);
    expect(typeof payload.replayedAt).toBe('string');
  });

  it('22b: bulk room status queues while blocked and replays with provisional extras', async () => {
    const actor = 'user_deg_room22b';
    const { propertyId, stub } = await provisionHotel(actor);
    for (const [roomId, code] of [
      ['room_deg_22b_a', '62A'],
      ['room_deg_22b_b', '62B'],
    ] as const) {
      expect(
        (
          await worker.fetch(
            new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
              body: JSON.stringify({
                roomId,
                roomTypeId: 'rt_king',
                code,
                idempotencyKey: `idem-create-${roomId}`,
              }),
            }),
            env,
          )
        ).status,
      ).toBe(201);
    }
    await stub.flushOutbox();

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/bulk-status`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            updates: [
              { roomId: 'room_deg_22b_a', status: 'dirty' },
              { roomId: 'room_deg_22b_b', status: 'dirty' },
            ],
            idempotencyKey: 'idem-bulk-22b',
          }),
        },
      ),
      env,
    );
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.provisional.command.type).toBe('rooms.bulk_update_status');
    await dispatchPendingBatch(sent);
    const rooms = (await stub.listRooms()).rooms;
    expect(rooms.find((r) => r.roomId === 'room_deg_22b_a')?.status).toBe('dirty');
    expect(rooms.find((r) => r.roomId === 'room_deg_22b_b')?.status).toBe('dirty');
    const payloads = await stub.listOutboxPayloads();
    const statusEvts = payloads.filter((p) => p.eventType === 'room.status_changed');
    expect(statusEvts).toHaveLength(2);
    for (const evt of statusEvts) {
      const payload = JSON.parse(evt.payload) as {
        provisional?: boolean;
        issuedAt?: string;
        replayedAt?: string;
      };
      expect(payload.provisional).toBe(true);
      expect(payload.issuedAt).toBe(sent[0]!.provisional.issuedAt);
      expect(typeof payload.replayedAt).toBe('string');
    }
  });

  it('29: queued rooms.update_status with out_of_order drains to provisional_exception OOO_VIA_RANGE', async () => {
    const actor = 'user_deg_ooo29';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              roomId: 'room_deg_29',
              roomTypeId: 'rt_king',
              code: '629',
              idempotencyKey: 'idem-create-29',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    await stub.flushOutbox();

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/room_deg_29/status`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ status: 'out_of_order', idempotencyKey: 'idem-st-29' }),
        },
      ),
      env,
    );
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.provisional.command.type).toBe('rooms.update_status');
    await dispatchPendingBatch(sent);
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions.length).toBe(1);
    expect(exceptions[0]!.reason).toBe(OOO_VIA_RANGE);
    expect((await stub.listRooms()).rooms.find((r) => r.roomId === 'room_deg_29')?.status).toBe('clean');
  });

  it('23: housekeeping.assign queues while blocked and replays once', async () => {
    const actor = 'user_deg_room23';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const org = testOrgStub(orgId);
    const hk = await createHousekeeper(org, propertyId, 'Deg', undefined, {
      kind: 'user',
      userId: actor,
    });
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              roomId: 'room_deg_23',
              roomTypeId: 'rt_king',
              code: '623',
              idempotencyKey: 'idem-create-23',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/assignments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            roomId: 'room_deg_23',
            businessDate: arrival,
            assigneeRef: hk.staffId,
            idempotencyKey: 'idem-hk-23',
          }),
        },
      ),
      env,
    );
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    expect(sent[0]!.provisional.command.type).toBe('housekeeping.assign');
    await dispatchPendingBatch(sent);
    const listed = await stub.readHousekeepingAssignments(arrival);
    expect(listed.ok && listed.assignments).toHaveLength(1);
    const payloads = await stub.listOutboxPayloads();
    const assigned = payloads.find((p) => p.eventType === 'housekeeping.assigned');
    expect(assigned).toBeTruthy();
    const payload = JSON.parse(assigned!.payload) as {
      provisional?: boolean;
      issuedAt?: string;
      replayedAt?: string;
    };
    expect(payload.provisional).toBe(true);
    expect(payload.issuedAt).toBe(sent[0]!.provisional.issuedAt);
    expect(typeof payload.replayedAt).toBe('string');
  });

  it('24: assign-room while blocked returns FAIL_CLOSED 503', async () => {
    const actor = 'user_deg_room24';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              roomId: 'room_deg_24',
              roomTypeId: 'rt_king',
              code: '624',
              idempotencyKey: 'idem-create-24',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_deg_24', arrival, departure, guestRef)).status).toBe(
      201,
    );

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const blocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/res_deg_24/assign-room`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ roomId: 'room_deg_24', idempotencyKey: 'idem-as-24' }),
        },
      ),
      env,
    );
    expect(blocked.status).toBe(503);
    const body = (await blocked.json()) as { degraded?: string; commandId?: string };
    expect(body.degraded).toBe('FAIL_CLOSED');
    expect(body.commandId).toBe('reservations.assign_room');
    expect(sent).toHaveLength(0);
    await stub.setTransportBlockedForTest(false);
  });

  it('25: POST /rooms and PATCH while blocked return 503', async () => {
    const actor = 'user_deg_room25';
    const { propertyId, stub } = await provisionHotel(actor);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
            body: JSON.stringify({
              roomId: 'room_deg_25',
              roomTypeId: 'rt_king',
              code: '625',
              idempotencyKey: 'idem-create-25',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    const createBlocked = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          roomId: 'room_deg_25b',
          roomTypeId: 'rt_king',
          code: '626',
          idempotencyKey: 'idem-create-25b',
        }),
      }),
      env,
    );
    expect(createBlocked.status).toBe(503);
    const patchBlocked = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/room_deg_25`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({ code: '627', idempotencyKey: 'idem-patch-25' }),
        },
      ),
      env,
    );
    expect(patchBlocked.status).toBe(503);
    expect(sent).toHaveLength(0);
    await stub.setTransportBlockedForTest(false);
  });

  it('26: check-in while blocked with no room_id still queues and replays', async () => {
    const actor = 'user_deg_room26';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_26', arrival, departure, guestRef)).status).toBe(
      201,
    );
    await assignCleanRoom(stub, actor, 'res_deg_26', 'rm_deg_26', '326');
    const before = await stub.readReservation('res_deg_26');
    expect(before.ok && before.reservation.roomId).toBe('rm_deg_26');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_deg_26', 'idem-ci-26')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    await dispatchPendingBatch(sent);
    expect(await stub.getReservationStatus('res_deg_26')).toBe('checked_in');
  });

  it('31: replay check-in roomId A after live-assign A to another stay → exception, first still confirmed', async () => {
    const actor = 'user_deg_31';
    const owner = { kind: 'user' as const, userId: actor };
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_31a', arrival, departure, guestRef)).status).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_deg_31b', arrival, departure, guestRef)).status).toBe(201);
    const room = { roomId: 'rm_31', roomTypeId: 'rt_king', code: '331' };
    expect(await stub.tryCreateRoom(owner, room, await idemFor('rm31', room))).toMatchObject({ ok: true });

    const payload = { reservationId: 'res_deg_31a', roomId: 'rm_31' };
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-31',
        requestFingerprint: (await idemForCommand('reservations.check_in', 'idem-31', payload)).fingerprint,
        propertyId,
        orgId: (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload },
        routeId: 'post_reservation_check_in',
      },
    };
    const assignB = { reservationId: 'res_deg_31b', roomId: 'rm_31' };
    expect(await stub.tryAssignRoom(owner, assignB, await idemFor('as31b', assignB))).toMatchObject({ ok: true });
    await dispatchPendingBatch([msg]);
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions.length).toBe(1);
    expect(exceptions[0]!.reason).toBe(ROOM_ALREADY_ASSIGNED);
    expect(await stub.getReservationStatus('res_deg_31a')).toBe('confirmed');
  });

  it('32: replay check-in without room and without pre-assign → exception ROOM_REQUIRED', async () => {
    const actor = 'user_deg_32';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_32', arrival, departure, guestRef)).status).toBe(201);
    const payload = { reservationId: 'res_deg_32' };
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-32',
        requestFingerprint: (await idemForCommand('reservations.check_in', 'idem-32', payload)).fingerprint,
        propertyId,
        orgId: (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload },
        routeId: 'post_reservation_check_in',
      },
    };
    await dispatchPendingBatch([msg]);
    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions.length).toBe(1);
    expect(exceptions[0]!.reason).toBe(ROOM_REQUIRED);
    expect(await stub.getReservationStatus('res_deg_32')).toBe('confirmed');
  });

  it('39: replay check-out vs folio.add_item orderings', async () => {
    async function setupCheckedIn(actor: string, reservationId: string) {
      const { propertyId, arrival, stub, guestRef, orgId } = await provisionHotel(actor);
      await stub.writeConfigValueForTest('pms.invoice.gen_mode', 'Manually');
      const departure = addDays(arrival, 2);
      expect((await postReservation(propertyId, actor, reservationId, arrival, departure, guestRef)).status).toBe(
        201,
      );
      await assignCleanRoom(stub, actor, reservationId, `rm_${reservationId}`, reservationId.slice(-3));
      expect(
        await stub.tryCheckIn(
          { kind: 'user', userId: actor },
          { reservationId },
          await idemFor(`ci-${reservationId}`, { reservationId }),
        ),
      ).toMatchObject({ ok: true });
      return { propertyId, arrival, stub, orgId };
    }

    const chargeFirst = await setupCheckedIn('user_deg_39a', 'res_deg_39a');
    const chargePayload = {
      reservationId: 'res_deg_39a',
      folioLineId: 'res_deg_39a:item:late',
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    const checkoutPayload = { reservationId: 'res_deg_39a' };
    const chargeMsg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-39a-charge',
        requestFingerprint: (await idemForCommand('folio.add_item', 'idem-39a-charge', chargePayload)).fingerprint,
        propertyId: chargeFirst.propertyId,
        orgId: chargeFirst.orgId,
        issuedAt: new Date().toISOString(),
        businessDate: chargeFirst.arrival,
        actor: { userId: 'user_deg_39a' },
        command: { type: 'folio.add_item', payload: chargePayload },
        routeId: 'post_folio_lines',
      },
    };
    const checkoutMsg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-39a-co',
        requestFingerprint: (await idemForCommand('reservations.check_out', 'idem-39a-co', checkoutPayload)).fingerprint,
        propertyId: chargeFirst.propertyId,
        orgId: chargeFirst.orgId,
        issuedAt: new Date().toISOString(),
        businessDate: chargeFirst.arrival,
        actor: { userId: 'user_deg_39a' },
        command: { type: 'reservations.check_out', payload: checkoutPayload },
        routeId: 'post_reservation_check_out',
      },
    };
    await dispatchPendingBatch([chargeMsg, checkoutMsg]);
    expect(await chargeFirst.stub.getReservationStatus('res_deg_39a')).toBe('checked_in');
    const { exceptions } = (await chargeFirst.stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions.some((e) => e.reason === BALANCE_DUE)).toBe(true);

    const outFirst = await setupCheckedIn('user_deg_39b', 'res_deg_39b');
    const chargePayloadB = {
      reservationId: 'res_deg_39b',
      folioLineId: 'res_deg_39b:item:late',
      chargeCode: 'MISC',
      amountMinor: 1000,
    };
    const checkoutPayloadB = { reservationId: 'res_deg_39b' };
    const checkoutMsgB: PendingCommandMessage = {
      ...checkoutMsg,
      provisional: {
        ...checkoutMsg.provisional,
        idempotencyKey: 'idem-39b-co',
        requestFingerprint: (await idemForCommand('reservations.check_out', 'idem-39b-co', checkoutPayloadB)).fingerprint,
        propertyId: outFirst.propertyId,
        orgId: outFirst.orgId,
        businessDate: outFirst.arrival,
        actor: { userId: 'user_deg_39b' },
        command: { type: 'reservations.check_out', payload: checkoutPayloadB },
      },
    };
    const chargeMsgB: PendingCommandMessage = {
      ...chargeMsg,
      provisional: {
        ...chargeMsg.provisional,
        idempotencyKey: 'idem-39b-charge',
        requestFingerprint: (await idemForCommand('folio.add_item', 'idem-39b-charge', chargePayloadB)).fingerprint,
        propertyId: outFirst.propertyId,
        orgId: outFirst.orgId,
        businessDate: outFirst.arrival,
        actor: { userId: 'user_deg_39b' },
        command: { type: 'folio.add_item', payload: chargePayloadB },
      },
    };
    await dispatchPendingBatch([checkoutMsgB, chargeMsgB]);
    expect(await outFirst.stub.getReservationStatus('res_deg_39b')).toBe('checked_out');
    expect(await outFirst.stub.countFolioLinesForReservation('res_deg_39b')).toBe(1);
    const window = await outFirst.stub.readGuestFolioWindowForTest('res_deg_39b');
    expect(window?.status).toBe('OPEN');
  });

  it('get_property: PropertyDO blocked returns 200 partial with propertyDo unreachable', async () => {
    const actor = 'user_get_prop_partial';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.setTransportBlockedForTest(true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      property: { timeZone: string };
      propertyDo?: string;
      schemaVersion: unknown;
      recordedJurisdiction: unknown;
    };
    expect(body.property.timeZone).toBeTruthy();
    expect(body.propertyDo).toBe('unreachable');
    expect(body.schemaVersion).toBeNull();
    expect(body.recordedJurisdiction).toBeNull();
  });

  it('get_property: healthy omits propertyDo', async () => {
    const actor = 'user_get_prop_ok';
    const { propertyId } = await provisionHotel(actor);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { propertyDo?: string; schemaVersion: number };
    expect(body.propertyDo).toBeUndefined();
    expect(typeof body.schemaVersion).toBe('number');
  });
});

describe('degraded replay attribution (C1)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  it('successful replay writes admission operator to audit_log, not system:queue_replay', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_ok', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_c1_ok', 'rm_c1_ok', '401');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_c1_ok', 'idem-c1-ok')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    await dispatchPendingBatch(sent);

    const audit = await stub.listAuditLog({ kind: 'user', userId: actor }, { reservationId: 'res_c1_ok' });
    expect(audit.ok).toBe(true);
    const rows = (audit as unknown as { ok: true; rows: Array<{ commandId: string; actor: string }> }).rows;
    const checkInRow = rows.find((r) => r.commandId === 'reservations.check_in');
    expect(checkInRow?.actor).toBe('user_alice');
    expect(checkInRow?.actor).not.toBe('system:queue_replay');
  });

  it('failed replay persists actor_user_id on provisional_exception row', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_fail', arrival, departure, guestRef)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-c1-fail',
        requestFingerprint: (
          await idemForCommand('reservations.check_in', 'idem-c1-fail', { reservationId: 'res_c1_fail' })
        ).fingerprint,
        propertyId,
        orgId: '',
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_c1_fail' } },
        routeId: 'post_reservation_check_in',
      },
    };
    msg.provisional.orgId = (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId;

    await dispatchPendingBatch([msg]);
    expect(await stub.countProvisionalExceptions()).toBe(1);

    const actorUserId = await stub.readProvisionalExceptionActorUserIdForTest('idem-c1-fail');
    expect(actorUserId).toBe('user_alice');
  });

  it('degraded.replayed log includes actorUserId', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_log', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_c1_log', 'rm_c1_log', '402');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_c1_log', 'idem-c1-log')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const logSpy = vi.spyOn(await import('@hospai/observability'), 'logInfo');
    await dispatchPendingBatch(sent);
    expect(logSpy.mock.calls.some(([, fields]) => (fields as { actorUserId?: string }).actorUserId === 'user_alice')).toBe(true);
    logSpy.mockRestore();
  });

  it('degraded.exception log includes actorUserId', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_exc', arrival, departure, guestRef)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-c1-exc',
        requestFingerprint: (
          await idemForCommand('reservations.check_in', 'idem-c1-exc', { reservationId: 'res_c1_exc' })
        ).fingerprint,
        propertyId,
        orgId: '',
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_c1_exc' } },
        routeId: 'post_reservation_check_in',
      },
    };
    msg.provisional.orgId = (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId;

    const logSpy = vi.spyOn(await import('@hospai/observability'), 'logWarn');
    await dispatchPendingBatch([msg]);
    expect(logSpy.mock.calls.some(([, fields]) => (fields as { actorUserId?: string }).actorUserId === 'user_alice')).toBe(true);
    logSpy.mockRestore();
  });
});
