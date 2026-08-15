import { env, createMessageBatch } from 'cloudflare:test';
import {
  fingerprintPayload,
  ROOM_ALREADY_ASSIGNED,
  type PendingCommandMessage,
} from '@hospai/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { idemFor, orgStub, seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './guest-helpers.js';
import { createGuest } from './guest-helpers.js';

type ExceptionList = Awaited<ReturnType<PropertyDO['listProvisionalExceptions']>>;

async function listExceptions(
  stub: DurableObjectStub<PropertyDO>,
  filters?: Parameters<PropertyDO['listProvisionalExceptions']>[0],
): Promise<ExceptionList> {
  return (await stub.listProvisionalExceptions(filters)) as ExceptionList;
}

const EMPTY_CENSUS = { pendingOpenCount: 0 };

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
        name: 'Exception Workbench Hotel',
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
        idempotencyKey: `idem-book-${reservationId}-${crypto.randomUUID()}`,
      }),
    }),
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

async function provisionHotel(actor: string) {
  const orgId = `org_ew_${crypto.randomUUID()}`;
  const propertyId = `prop_ew_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'EW Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await postRoomType(propertyId, actor);
  expect(roomTypeRes.status).toBe(201);
  const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', arrival);
    await resolved.stub.flushOutbox();
  }
  const org = orgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Test Guest', {
    kind: 'user',
    userId: actor,
  });
  return { orgId, propertyId, actor, arrival, stub: resolved!.stub, guestRef: guest.guestRef };
}

function sampleCmd(opts: {
  propertyId: string;
  orgId: string;
  businessDate: string;
  type?: string;
  payload?: unknown;
  reason?: string;
}) {
  return {
    idempotencyKey: `idem_${crypto.randomUUID()}`,
    requestFingerprint: 'fp',
    propertyId: opts.propertyId,
    orgId: opts.orgId,
    issuedAt: new Date().toISOString(),
    businessDate: opts.businessDate,
    actor: { userId: 'user_owner' },
    command: {
      type: opts.type ?? 'folio.add_item',
      payload: opts.payload ?? {},
    },
    routeId: 'post_folio_add_item',
  };
}

function listUrl(propertyId: string, query = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exceptions${query}`;
}

function detailUrl(propertyId: string, exceptionId: string) {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exceptions/${encodeURIComponent(exceptionId)}`;
}

async function getList(propertyId: string, actor: string, query = '') {
  return worker.fetch(new Request(listUrl(propertyId, query), { headers: { 'x-dev-actor': actor } }), env);
}

async function getDetail(propertyId: string, exceptionId: string, actor: string) {
  return worker.fetch(new Request(detailUrl(propertyId, exceptionId), { headers: { 'x-dev-actor': actor } }), env);
}

async function postRetry(propertyId: string, exceptionId: string, actor: string, idempotencyKey: string) {
  return worker.fetch(
    new Request(`${detailUrl(propertyId, exceptionId)}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey }),
    }),
    env,
  );
}

async function postAssign(
  propertyId: string,
  exceptionId: string,
  actor: string,
  assignedTo: string | null,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(`${detailUrl(propertyId, exceptionId)}/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ assignedTo, idempotencyKey }),
    }),
    env,
  );
}

async function postNote(
  propertyId: string,
  exceptionId: string,
  actor: string,
  noteId: string,
  text: string,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(`${detailUrl(propertyId, exceptionId)}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ noteId, text, idempotencyKey }),
    }),
    env,
  );
}

async function postResolve(propertyId: string, exceptionId: string, actor: string, idempotencyKey: string) {
  return worker.fetch(
    new Request(`${detailUrl(propertyId, exceptionId)}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey }),
    }),
    env,
  );
}

describe('exception-queue workbench HTTP', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('6: no-query list still open-uncapped', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    const listed = await listExceptions(stub);
    expect(listed.exceptions).toHaveLength(3);
    const resolved = await stub.tryResolveProvisionalException(
      TEST_OWNER_ACTOR,
      { exceptionId: listed.exceptions[0]!.exceptionId },
      await idemFor(`resolve-${listed.exceptions[0]!.exceptionId}`, {
        exceptionId: listed.exceptions[0]!.exceptionId,
      }),
    );
    expect(resolved).toMatchObject({ ok: true });

    const res = await getList(propertyId, actor);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; exceptions: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.exceptions).toHaveLength(2);
  });

  it('7: filters resolution commandType dates assigned; invalid query 400', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    const d0 = addDays(arrival, -1);
    const d1 = arrival;
    const d2 = addDays(arrival, 1);
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: d0,
        type: 'reservations.check_in',
        payload: { reservationId: 'res_a' },
      }),
      'domain_error',
      null,
    );
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: d1,
        type: 'reservations.check_in',
        payload: { reservationId: 'res_b' },
      }),
      'domain_error',
      null,
    );
    await stub.recordProvisionalException(
      sampleCmd({ propertyId, orgId, businessDate: d2, type: 'folio.add_item', payload: {} }),
      'domain_error',
      null,
    );
    const listed = (await listExceptions(stub, { resolution: 'all' })).exceptions;
    expect(listed).toHaveLength(3);
    const toResolve = listed.find((e) => e.businessDate === d2)!;
    expect(
      await stub.tryResolveProvisionalException(
        TEST_OWNER_ACTOR,
        { exceptionId: toResolve.exceptionId },
        await idemFor(`resolve-${toResolve.exceptionId}`, { exceptionId: toResolve.exceptionId }),
      ),
    ).toMatchObject({ ok: true });
    const toAssign = listed.find((e) => e.businessDate === d0)!;
    expect(
      await stub.tryAssignProvisionalException(
        TEST_OWNER_ACTOR,
        { exceptionId: toAssign.exceptionId, assignedTo: 'user_owner' },
        await idemFor(`assign-${toAssign.exceptionId}`, {
          exceptionId: toAssign.exceptionId,
          assignedTo: 'user_owner',
        }),
      ),
    ).toMatchObject({ ok: true });

    const all = await getList(propertyId, actor, '?resolution=all');
    expect(all.status).toBe(200);
    expect(((await all.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(3);

    const resolvedOnly = await getList(propertyId, actor, '?resolution=resolved');
    expect(((await resolvedOnly.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(1);

    const checkIn = await getList(propertyId, actor, '?commandType=reservations.check_in');
    expect(((await checkIn.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(2);

    const dated = await getList(
      propertyId,
      actor,
      `?resolution=all&businessDateFrom=${encodeURIComponent(d1)}&businessDateTo=${encodeURIComponent(d1)}`,
    );
    expect(((await dated.json()) as { exceptions: Array<{ businessDate: string }> }).exceptions).toEqual([
      expect.objectContaining({ businessDate: d1 }),
    ]);

    const unassigned = await getList(propertyId, actor, '?assigned=unassigned');
    expect(((await unassigned.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(1);

    expect((await getList(propertyId, actor, '?resolution=bogus')).status).toBe(400);
    expect(await (await getList(propertyId, actor, '?resolution=bogus')).json()).toEqual({
      error: 'invalid_query',
    });
    expect((await getList(propertyId, actor, '?limit=0')).status).toBe(400);
    expect((await getList(propertyId, actor, '?limit=201')).status).toBe(400);
    expect((await getList(propertyId, actor, '?cursor=not-a-cursor')).status).toBe(400);
    expect(await (await getList(propertyId, actor, '?cursor=not-a-cursor')).json()).toEqual({
      error: 'invalid_cursor',
    });
  });

  it('8: GET detail 200 for resolved; 404 unknown; actions after resolve; affected.reservationId', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: arrival,
        type: 'reservations.check_in',
        payload: { reservationId: 'res_detail' },
      }),
      'domain_error',
      null,
    );
    const listed = (await listExceptions(stub)).exceptions;
    const exceptionId = listed[0]!.exceptionId;
    expect(
      await stub.tryResolveProvisionalException(
        TEST_OWNER_ACTOR,
        { exceptionId },
        await idemFor(`resolve-${exceptionId}`, { exceptionId }),
      ),
    ).toMatchObject({ ok: true });

    const res = await getDetail(propertyId, exceptionId, actor);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      exception: { affected: { reservationId: string | null } };
      actions: Array<{ action: string }>;
    };
    expect(body.exception.affected.reservationId).toBe('res_detail');
    expect(body.actions.some((a) => a.action === 'resolved')).toBe(true);

    const missing = await getDetail(propertyId, 'exc_missing', actor);
    expect(missing.status).toBe(404);
  });

  it('9: staff without night_audit:run GET 200, POST retry 403; missing property:read GET 403; DO blocked FAIL_CLOSED', async () => {
    const actor = 'user_owner';
    const staff = 'user_ew_staff';
    const stranger = 'user_ew_stranger';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    const org = orgStub(orgId);
    await org.ensureMember(staff, 'staff');
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    const exceptionId = (await listExceptions(stub)).exceptions[0]!.exceptionId;

    const staffList = await getList(propertyId, staff);
    expect(staffList.status).toBe(200);
    const staffDetail = await getDetail(propertyId, exceptionId, staff);
    expect(staffDetail.status).toBe(200);
    const staffRetry = await postRetry(propertyId, exceptionId, staff, `idem-staff-${crypto.randomUUID()}`);
    expect(staffRetry.status).toBe(403);
    expect(await staffRetry.json()).toMatchObject({ error: 'forbidden', permission: 'night_audit:run' });

    const strangerList = await getList(propertyId, stranger);
    expect(strangerList.status).toBe(404);

    await stub.setTransportBlockedForTest(true);
    const blockedList = await getList(propertyId, actor);
    expect(blockedList.status).toBe(503);
    expect(await blockedList.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
    const blockedDetail = await getDetail(propertyId, exceptionId, actor);
    expect(blockedDetail.status).toBe(503);
    expect(await blockedDetail.json()).toMatchObject({
      error: 'property_unreachable',
      degraded: 'FAIL_CLOSED',
    });
  });

  it('10: ROOM_ALREADY_ASSIGNED retry conflict then success', async () => {
    const actor = 'user_owner';
    const owner = { kind: 'user' as const, userId: actor };
    const { propertyId, arrival, stub, guestRef, orgId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_ew_10a', arrival, departure, guestRef)).status).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_ew_10b', arrival, departure, guestRef)).status).toBe(201);
    const room = { roomId: 'rm_ew_10', roomTypeId: 'rt_king', code: '410' };
    expect(await stub.tryCreateRoom(owner, room, await idemFor('rm10', room))).toMatchObject({ ok: true });
    const payload = { reservationId: 'res_ew_10a', roomId: 'rm_ew_10' };
    const originalKey = `idem-ew-10-${crypto.randomUUID()}`;
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: originalKey,
        requestFingerprint: (await idemFor(originalKey, payload)).fingerprint,
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload },
        routeId: 'post_reservation_check_in',
      },
    };
    const assignB = { reservationId: 'res_ew_10b', roomId: 'rm_ew_10' };
    expect(await stub.tryAssignRoom(owner, assignB, await idemFor('as10b', assignB))).toMatchObject({ ok: true });
    await dispatchPendingBatch([msg]);
    const open = (await listExceptions(stub)).exceptions;
    expect(open).toHaveLength(1);
    expect(open[0]!.reason).toBe(ROOM_ALREADY_ASSIGNED);
    const exceptionId = open[0]!.exceptionId;

    const conflictRetry = await postRetry(propertyId, exceptionId, actor, `idem-retry-conflict-${crypto.randomUUID()}`);
    expect(conflictRetry.status).toBe(422);
    const conflictBody = (await conflictRetry.json()) as { ok: false; error: string; retried: false };
    expect(conflictBody.retried).toBe(false);
    const stillOpen = (await listExceptions(stub)).exceptions;
    expect(stillOpen).toHaveLength(1);
    expect(stillOpen[0]!.exceptionId).toBe(exceptionId);
    expect(stillOpen[0]!.resolvedAt).toBeNull();

    const otherRoom = { roomId: 'rm_ew_10b', roomTypeId: 'rt_king', code: '411' };
    expect(await stub.tryCreateRoom(owner, otherRoom, await idemFor('rm10b', otherRoom))).toMatchObject({ ok: true });
    const reassignB = { reservationId: 'res_ew_10b', roomId: 'rm_ew_10b' };
    expect(await stub.tryAssignRoom(owner, reassignB, await idemFor('as10b2', reassignB))).toMatchObject({
      ok: true,
    });

    const okRetry = await postRetry(propertyId, exceptionId, actor, `idem-retry-ok-${crypto.randomUUID()}`);
    expect(okRetry.status).toBe(200);
    expect(await stub.getReservationStatus('res_ew_10a')).toBe('checked_in');
    const payloads = await stub.listOutboxPayloads();
    const retried = payloads.filter((p) => p.eventType === 'provisional.exception_retried');
    const resolvedEv = payloads.filter((p) => p.eventType === 'provisional.exception_resolved');
    expect(retried.length).toBeGreaterThan(0);
    expect(resolvedEv.some((p) => (JSON.parse(p.payload) as { action?: string }).action === 'retried')).toBe(true);
  });

  it('11: inner key is open_retry_key ≠ original; second retry after success does not double check-in', async () => {
    const actor = 'user_owner';
    const owner = { kind: 'user' as const, userId: actor };
    const { propertyId, arrival, stub, guestRef, orgId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_ew_11a', arrival, departure, guestRef)).status).toBe(201);
    expect((await postReservation(propertyId, actor, 'res_ew_11b', arrival, departure, guestRef)).status).toBe(201);
    const room = { roomId: 'rm_ew_11', roomTypeId: 'rt_king', code: '412' };
    expect(await stub.tryCreateRoom(owner, room, await idemFor('rm11', room))).toMatchObject({ ok: true });
    const payload = { reservationId: 'res_ew_11a', roomId: 'rm_ew_11' };
    const originalKey = `idem-ew-11-${crypto.randomUUID()}`;
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: originalKey,
        requestFingerprint: (await fingerprintPayload(payload)),
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload },
        routeId: 'post_reservation_check_in',
      },
    };
    const assignB = { reservationId: 'res_ew_11b', roomId: 'rm_ew_11' };
    expect(await stub.tryAssignRoom(owner, assignB, await idemFor('as11b', assignB))).toMatchObject({ ok: true });
    await dispatchPendingBatch([msg]);
    const exception = (await listExceptions(stub)).exceptions[0]!;
    expect(exception.idempotencyKey).toBe(originalKey);
    expect(exception.openRetryKey).toBeNull();

    const otherRoom = { roomId: 'rm_ew_11b', roomTypeId: 'rt_king', code: '413' };
    expect(await stub.tryCreateRoom(owner, otherRoom, await idemFor('rm11b', otherRoom))).toMatchObject({ ok: true });
    const reassignB = { reservationId: 'res_ew_11b', roomId: 'rm_ew_11b' };
    expect(await stub.tryAssignRoom(owner, reassignB, await idemFor('as11b2', reassignB))).toMatchObject({
      ok: true,
    });

    const first = await postRetry(propertyId, exception.exceptionId, actor, `idem-r11a-${crypto.randomUUID()}`);
    expect(first.status).toBe(200);
    const detail = (await (await getDetail(propertyId, exception.exceptionId, actor)).json()) as {
      exception: { idempotencyKey: string; openRetryKey: string | null };
    };
    expect(detail.exception.idempotencyKey).toBe(originalKey);
    expect(detail.exception.openRetryKey).toBeNull();
    expect(await stub.getReservationStatus('res_ew_11a')).toBe('checked_in');

    const second = await postRetry(propertyId, exception.exceptionId, actor, `idem-r11b-${crypto.randomUUID()}`);
    expect(second.status).toBe(422);
    expect(await second.json()).toMatchObject({ error: 'already_resolved' });
    expect(await stub.getReservationStatus('res_ew_11a')).toBe('checked_in');
  });

  it('12: business_date_closed retry stays open; resolve then PRE_CHECK does not count it', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    const closed = addDays(arrival, -1);
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: closed,
        type: 'reservations.check_in',
        payload: { reservationId: 'res_closed' },
      }),
      'domain_error',
      null,
    );
    const exceptionId = (await listExceptions(stub)).exceptions[0]!.exceptionId;
    const retry = await postRetry(propertyId, exceptionId, actor, `idem-closed-${crypto.randomUUID()}`);
    expect(retry.status).toBe(422);
    expect(await retry.json()).toMatchObject({ error: 'business_date_closed', retried: false });
    expect((await listExceptions(stub)).exceptions).toHaveLength(1);

    expect(
      (
        await postResolve(propertyId, exceptionId, actor, `idem-res-closed-${crypto.randomUUID()}`)
      ).status,
    ).toBe(200);
    const pre = await stub.runAuditStep(arrival, 'PRE_CHECK', EMPTY_CENSUS);
    expect(pre.status).toBe('COMPLETED');
  });

  it('13: unknown_command retry 422; resolve 200', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    await stub.recordProvisionalException(
      sampleCmd({ propertyId, orgId, businessDate: arrival, type: 'noop.unknown_command', payload: {} }),
      'unknown_command',
      null,
    );
    const exceptionId = (await listExceptions(stub)).exceptions[0]!.exceptionId;
    const retry = await postRetry(propertyId, exceptionId, actor, `idem-unk-${crypto.randomUUID()}`);
    expect(retry.status).toBe(422);
    expect(await retry.json()).toMatchObject({ error: 'unknown_command' });
    expect((await postResolve(propertyId, exceptionId, actor, `idem-unk-res-${crypto.randomUUID()}`)).status).toBe(
      200,
    );
  });

  it('14: assign / unassign / list filters; assign on resolved 422 already_resolved', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    const exceptionId = (await listExceptions(stub)).exceptions[0]!.exceptionId;

    expect(
      (await postAssign(propertyId, exceptionId, actor, 'user_a', `idem-as-${crypto.randomUUID()}`)).status,
    ).toBe(200);
    const assigned = await getList(propertyId, actor, '?assignedTo=user_a');
    expect(((await assigned.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(1);

    expect(
      (await postAssign(propertyId, exceptionId, actor, null, `idem-unas-${crypto.randomUUID()}`)).status,
    ).toBe(200);
    const unassigned = await getList(propertyId, actor, '?assigned=unassigned');
    expect(((await unassigned.json()) as { exceptions: unknown[] }).exceptions).toHaveLength(1);

    expect((await postResolve(propertyId, exceptionId, actor, `idem-res-${crypto.randomUUID()}`)).status).toBe(200);
    const assignResolved = await postAssign(
      propertyId,
      exceptionId,
      actor,
      'user_a',
      `idem-as-res-${crypto.randomUUID()}`,
    );
    expect(assignResolved.status).toBe(422);
    expect(await assignResolved.json()).toMatchObject({ error: 'already_resolved' });
  });

  it('15: notes on open + resolved; empty 400; 51st 422 note_limit; detail notes length 2', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub } = await provisionHotel(actor);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    await stub.recordProvisionalException(sampleCmd({ propertyId, orgId, businessDate: arrival }), 'domain_error', null);
    const [first, second] = (await listExceptions(stub)).exceptions;
    const openId = first!.exceptionId;
    const limitId = second!.exceptionId;

    expect(
      (await postNote(propertyId, openId, actor, crypto.randomUUID(), 'first note', `idem-n1-${crypto.randomUUID()}`))
        .status,
    ).toBe(200);
    expect((await postResolve(propertyId, openId, actor, `idem-res-n-${crypto.randomUUID()}`)).status).toBe(200);
    expect(
      (
        await postNote(propertyId, openId, actor, crypto.randomUUID(), 'second note', `idem-n2-${crypto.randomUUID()}`)
      ).status,
    ).toBe(200);

    const empty = await postNote(propertyId, openId, actor, crypto.randomUUID(), '   ', `idem-empty-${crypto.randomUUID()}`);
    expect(empty.status).toBe(400);

    const detail = (await (await getDetail(propertyId, openId, actor)).json()) as {
      notes: unknown[];
    };
    expect(detail.notes).toHaveLength(2);

    for (let i = 0; i < 50; i++) {
      expect(
        await stub.tryAddExceptionNote(
          TEST_OWNER_ACTOR,
          { exceptionId: limitId, noteId: crypto.randomUUID(), text: `n${i}` },
          await idemFor(`note-limit-${limitId}-${i}`, { exceptionId: limitId, noteId: `n${i}` }),
        ),
      ).toMatchObject({ ok: true });
    }
    const fiftyFirst = await postNote(
      propertyId,
      limitId,
      actor,
      crypto.randomUUID(),
      'overflow',
      `idem-n51-${crypto.randomUUID()}`,
    );
    expect(fiftyFirst.status).toBe(422);
    expect(await fiftyFirst.json()).toMatchObject({ error: 'note_limit' });
  });

  it('16: resolve idempotent alreadyResolved; does not apply original command', async () => {
    const actor = 'user_owner';
    const { propertyId, orgId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_ew_16', arrival, departure, guestRef)).status).toBe(201);
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: arrival,
        type: 'reservations.check_in',
        payload: { reservationId: 'res_ew_16' },
      }),
      'domain_error',
      null,
    );
    const exceptionId = (await listExceptions(stub)).exceptions[0]!.exceptionId;
    const key = `idem-res16-${crypto.randomUUID()}`;
    expect((await postResolve(propertyId, exceptionId, actor, key)).status).toBe(200);
    const again = await postResolve(propertyId, exceptionId, actor, `idem-res16b-${crypto.randomUUID()}`);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ ok: true, alreadyResolved: true });
    expect(await stub.getReservationStatus('res_ew_16')).toBe('confirmed');
  });

  it('17: folio.add_item retry success appends one line; resolve-without-retry appends zero', async () => {
    const actor = 'user_owner';
    const { propertyId, arrival, stub, guestRef, orgId } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    const folioPayload = {
      folioLineId: 'fl_ew_17',
      reservationId: 'res_ew_17',
      chargeCode: 'ROOM',
      amountMinor: 2500,
    };
    const originalKey = `idem-ew-17-${crypto.randomUUID()}`;
    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: originalKey,
        requestFingerprint: await fingerprintPayload(folioPayload),
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: folioPayload },
        routeId: 'post_folio_add_item',
      },
    };
    await dispatchPendingBatch([msg]);
    const retryId = (await listExceptions(stub)).exceptions[0]!.exceptionId;
    expect(await stub.countFolioLinesForReservation('res_ew_17')).toBe(0);

    expect((await postReservation(propertyId, actor, 'res_ew_17', arrival, departure, guestRef)).status).toBe(201);
    expect((await postRetry(propertyId, retryId, actor, `idem-fl-ok-${crypto.randomUUID()}`)).status).toBe(200);
    const lines = await stub.listFolioLinesForReservation('res_ew_17');
    expect(lines.some((l) => l.folioLineId === 'fl_ew_17' && l.amountMinor === 2500)).toBe(true);

    const resolvePayload = {
      folioLineId: 'fl_ew_17b',
      reservationId: 'res_ew_17b',
      chargeCode: 'ROOM',
      amountMinor: 2500,
    };
    await stub.recordProvisionalException(
      sampleCmd({
        propertyId,
        orgId,
        businessDate: arrival,
        type: 'folio.add_item',
        payload: resolvePayload,
      }),
      'not_found',
      null,
    );
    const resolveId = (await listExceptions(stub)).exceptions[0]!.exceptionId;
    const before = await stub.countFolioLines();
    expect((await postResolve(propertyId, resolveId, actor, `idem-fl-res-${crypto.randomUUID()}`)).status).toBe(200);
    expect(await stub.countFolioLines()).toBe(before);
  });
});
