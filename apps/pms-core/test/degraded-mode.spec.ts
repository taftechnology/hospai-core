import { env, createMessageBatch } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage, ProvisionalExceptionRow } from '@hospai/contracts';
import { BUSINESS_DATE_CLOSED } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import {
  isPropertyDoTransportFailure,
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
} from '../src/property-do-transport.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { idemFor } from './fixtures';

const LEGACY_GUEST = { guestRef: 'legacy', piiKeyId: 'legacy' } as const;

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
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        reservationId,
        roomTypeId: 'rt_king',
        guestRef: LEGACY_GUEST.guestRef,
        piiKeyId: LEGACY_GUEST.piiKeyId,
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
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, arrival, stub: resolved!.stub };
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

  it('transport allowlist matches fault-injection harness error', () => {
    expect(isPropertyDoTransportFailure(new Error(PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE))).toBe(true);
    expect(isPropertyDoTransportFailure(new Error('simulated_internal_bug'))).toBe(false);
  });

  it('1: check-in while blocked returns 202 and leaves DO state unchanged', async () => {
    const actor = 'user_deg_1';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_1', arrival, departure)).status).toBe(201);

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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_2', arrival, departure)).status).toBe(201);

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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_3', arrival, departure)).status).toBe(201);

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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);

    await stub.setTransportBlockedForTest(true);
    const res = await postReservation(propertyId, actor, 'res_deg_4', arrival, departure);
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

  it('5a: replay before apply after business date rolled records business_date_closed exception', async () => {
    const actor = 'user_deg_5a';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_5a', arrival, departure)).status).toBe(201);

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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_5b', arrival, departure)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-5b',
        requestFingerprint: (await idemFor('idem-5b', { reservationId: 'res_deg_5b' })).fingerprint,
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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_6', arrival, departure)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-6',
        requestFingerprint: (await idemFor('idem-6', { reservationId: 'res_deg_6' })).fingerprint,
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
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_6b', arrival, departure)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-6b',
        requestFingerprint: (await idemFor('idem-6b', { reservationId: 'res_deg_6b' })).fingerprint,
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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_7', arrival, departure)).status).toBe(201);

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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_9', arrival, departure)).status).toBe(201);
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
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_deg_10', arrival, departure)).status).toBe(201);

    const sendSpy = vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send');
    await stub.setSimulateBugForTest(true);
    const res = await postCheckIn(propertyId, actor, 'res_deg_10', 'idem-10');
    expect(res.status).toBe(500);
    expect(sendSpy).not.toHaveBeenCalled();
    await stub.setSimulateBugForTest(false);
  });

  it('11: direct DO tryCheckIn with non-member actor returns not_member without mutation', async () => {
    const { propertyId, arrival, stub } = await provisionHotel('user_deg_11');
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, 'user_deg_11', 'res_gate_11', arrival, departure)).status).toBe(
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

  it('13 (= degraded-suite 8): folio.add_item queues while blocked and replays once', async () => {
    const actor = 'user_deg_folio13';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio13';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure)).status).toBe(201);

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

  it('14: folio.split_charge while blocked returns FAIL_CLOSED 503 and does not queue', async () => {
    const actor = 'user_deg_folio14';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio14';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure)).status).toBe(201);
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
    const { orgId, propertyId, arrival, stub } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const reservationId = 'res_deg_folio15';
    expect((await postReservation(propertyId, actor, reservationId, arrival, departure)).status).toBe(201);

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-folio-15',
        requestFingerprint: (
          await idemFor('idem-folio-15', {
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
});
