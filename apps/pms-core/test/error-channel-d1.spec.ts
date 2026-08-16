import { env } from 'cloudflare:test';
import {
  CONFIG_CLASS_NOT_DOMAIN,
  NO_AVAILABILITY,
  NOT_MEMBER,
} from '@hospai/contracts';
import { NIGHT_AUDIT_STEPS } from '../src/property-do.js';
import { resolveOrgStub } from '@hospai/tenant-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import * as invokePropertyDoModule from '../src/invoke-property-do.js';
import type { OrgDO } from '../src/org-do.js';
import type { PropertyDO } from '../src/property-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, idemFor } from './guest-helpers.js';

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
        name: 'D1 Error Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string, roomCount = 10) {
  const orgId = `org_d1_${crypto.randomUUID()}`;
  const propertyId = `prop_d1_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'D1 Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(orgId);
  return { orgId, propertyId, actor, stub: resolved!.stub, org };
}

async function postRoomType(propertyId: string, actor: string, roomTypeId = 'rt_king', roomCount = 10) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId,
        code: 'KNG',
        name: 'King',
        roomCount,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function putRoomType(propertyId: string, actor: string, roomTypeId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          name: 'King Updated',
          idempotencyKey: `idem-put-rt-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}

async function deleteRoomType(propertyId: string, actor: string, roomTypeId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-rt-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function deleteRoom(propertyId: string, actor: string, roomId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-room-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function putDomainConfig(
  propertyId: string,
  actor: string,
  body: { key: string; value: unknown; reason: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/config/domain`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

function nightAuditUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/night-audit${suffix}`;
}

async function postNightAuditRun(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/run'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-na-run-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function postNightAuditRetry(propertyId: string, actor: string, businessDate: string) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/retry'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-na-retry-${crypto.randomUUID()}`,
        businessDate,
        step: NIGHT_AUDIT_STEPS[0],
      }),
    }),
    env,
  );
}

async function postNightAuditResolveHalt(propertyId: string, actor: string, businessDate: string) {
  return worker.fetch(
    new Request(nightAuditUrl(propertyId, '/resolve-halt'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-na-halt-${crypto.randomUUID()}`,
        businessDate,
      }),
    }),
    env,
  );
}

function exceptionUrl(propertyId: string, exceptionId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/provisional-exceptions/${encodeURIComponent(exceptionId)}${suffix}`;
}

async function postProvisionalResolve(propertyId: string, exceptionId: string, actor: string) {
  return worker.fetch(
    new Request(exceptionUrl(propertyId, exceptionId, '/resolve'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-exc-res-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function postProvisionalRetry(propertyId: string, exceptionId: string, actor: string) {
  return worker.fetch(
    new Request(exceptionUrl(propertyId, exceptionId, '/retry'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-exc-retry-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function postProvisionalAssign(
  propertyId: string,
  exceptionId: string,
  actor: string,
  assignedTo: string,
) {
  return worker.fetch(
    new Request(exceptionUrl(propertyId, exceptionId, '/assign'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        assignedTo,
        idempotencyKey: `idem-exc-as-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function postProvisionalNote(propertyId: string, exceptionId: string, actor: string) {
  return worker.fetch(
    new Request(exceptionUrl(propertyId, exceptionId, '/notes'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        noteId: crypto.randomUUID(),
        text: 'ops note',
        idempotencyKey: `idem-exc-note-${crypto.randomUUID()}`,
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
        idempotencyKey: `idem-book-${reservationId}`,
      }),
    }),
    env,
  );
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Mock invokePropertyDo for a route so worker.fetch hits dispatch not_member handling. */
function mockRouteCommandError(routeId: string, error: typeof NOT_MEMBER | typeof NO_AVAILABILITY) {
  const original = invokePropertyDoModule.invokePropertyDo;
  return vi.spyOn(invokePropertyDoModule, 'invokePropertyDo').mockImplementation(async (opts) => {
    if (opts.routeId === routeId) {
      return { kind: 'ok', result: { ok: false, error } };
    }
    return original(opts);
  });
}

describe('D1 error channel behaviour', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  it('POST room-types with not_member → 404 not_found (was 500)', async () => {
    const actor = 'user_d1_rt_post';
    const { propertyId, stub } = await provisionHotel(actor);
    mockRouteCommandError('post_room_types', NOT_MEMBER);
    const res = await postRoomType(propertyId, actor);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('PUT room-type with not_member → 404', async () => {
    const actor = 'user_d1_rt_put';
    const { propertyId, stub } = await provisionHotel(actor);
    expect((await postRoomType(propertyId, actor)).status).toBe(201);
    mockRouteCommandError('put_room_type', NOT_MEMBER);
    const res = await putRoomType(propertyId, actor, 'rt_king');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('DELETE room-type with not_member → 404', async () => {
    const actor = 'user_d1_rt_del';
    const { propertyId, stub } = await provisionHotel(actor);
    expect((await postRoomType(propertyId, actor)).status).toBe(201);
    mockRouteCommandError('delete_room_type', NOT_MEMBER);
    const res = await deleteRoomType(propertyId, actor, 'rt_king');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('DELETE room with not_member → 404', async () => {
    const actor = 'user_d1_room_del';
    const owner = { kind: 'user' as const, userId: actor };
    const { propertyId, stub } = await provisionHotel(actor);
    const rtRes = await postRoomType(propertyId, actor);
    expect(rtRes.status).toBe(201);
    const room = { roomId: 'rm_d1', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(owner, room, await idemFor('rm-d1', room))).toMatchObject({ ok: true });
    mockRouteCommandError('delete_room', NOT_MEMBER);
    const res = await deleteRoom(propertyId, actor, 'rm_d1');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST night-audit run with not_member → 404', async () => {
    const actor = 'user_d1_na_run';
    const { propertyId, stub } = await provisionHotel(actor);
    mockRouteCommandError('post_night_audit_run', NOT_MEMBER);
    const res = await postNightAuditRun(propertyId, actor);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST night-audit retry with not_member → 404', async () => {
    const actor = 'user_d1_na_retry';
    const { propertyId, stub } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    mockRouteCommandError('post_night_audit_retry', NOT_MEMBER);
    const res = await postNightAuditRetry(propertyId, actor, naStatus.businessDate);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST night-audit resolve-halt with not_member → 404', async () => {
    const actor = 'user_d1_na_halt';
    const { propertyId, stub } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    mockRouteCommandError('post_night_audit_resolve_halt', NOT_MEMBER);
    const res = await postNightAuditResolveHalt(propertyId, actor, naStatus.businessDate);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('POST provisional resolve with not_member → 404', async () => {
    const actor = 'user_d1_exc_res';
    const { propertyId, stub, orgId } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem-pe-${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: naStatus.businessDate,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const exceptionId = (
      (await stub.listProvisionalExceptions()) as { exceptions: Array<{ exceptionId: string }> }
    ).exceptions[0]!.exceptionId;
    mockRouteCommandError('post_provisional_exception_resolve', NOT_MEMBER);
    const res = await postProvisionalResolve(propertyId, exceptionId, actor);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('provisional retry via mapExceptionWriterError with not_member → 404', async () => {
    const actor = 'user_d1_exc_retry';
    const { propertyId, stub, orgId } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem-pe2-${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: naStatus.businessDate,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const exceptionId = (
      (await stub.listProvisionalExceptions()) as { exceptions: Array<{ exceptionId: string }> }
    ).exceptions[0]!.exceptionId;
    mockRouteCommandError('post_provisional_exception_retry', NOT_MEMBER);
    const res = await postProvisionalRetry(propertyId, exceptionId, actor);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('provisional assign with not_member → 404 via mapExceptionWriterError', async () => {
    const actor = 'user_d1_exc_assign';
    const { propertyId, stub, orgId } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem-pe3-${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: naStatus.businessDate,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const exceptionId = (
      (await stub.listProvisionalExceptions()) as { exceptions: Array<{ exceptionId: string }> }
    ).exceptions[0]!.exceptionId;
    mockRouteCommandError('post_provisional_exception_assign', NOT_MEMBER);
    const res = await postProvisionalAssign(propertyId, exceptionId, actor, 'user_ops');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('provisional note with not_member → 404 via mapExceptionWriterError', async () => {
    const actor = 'user_d1_exc_note';
    const { propertyId, stub, orgId } = await provisionHotel(actor);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    await stub.recordProvisionalException(
      {
        idempotencyKey: `idem-pe4-${crypto.randomUUID()}`,
        requestFingerprint: 'fp',
        propertyId,
        orgId,
        issuedAt: new Date().toISOString(),
        businessDate: naStatus.businessDate,
        actor: { userId: actor },
        command: { type: 'folio.add_item', payload: {} },
        routeId: 'post_folio_add_item',
      },
      'domain_error',
      null,
    );
    const exceptionId = (
      (await stub.listProvisionalExceptions()) as { exceptions: Array<{ exceptionId: string }> }
    ).exceptions[0]!.exceptionId;
    mockRouteCommandError('post_provisional_exception_note', NOT_MEMBER);
    const res = await postProvisionalNote(propertyId, exceptionId, actor);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('config non-DOMAIN class → 400 config_class_not_domain via HTTP', async () => {
    const actor = 'user_d1_cfg_domain';
    const { propertyId } = await provisionHotel(actor);
    const res = await putDomainConfig(propertyId, actor, {
      key: 'pms.ui.date_format',
      value: 'ISO',
      reason: 'ops',
      idempotencyKey: 'idem-cfg-nondomain-d1',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: CONFIG_CLASS_NOT_DOMAIN });
  });

  it('undeclared config key → 400 undeclared:<key>', async () => {
    const actor = 'user_d1_cfg_undecl';
    const { propertyId } = await provisionHotel(actor);
    const res = await putDomainConfig(propertyId, actor, {
      key: 'pms.unknown.key',
      value: true,
      reason: 'ops',
      idempotencyKey: 'idem-cfg-undecl-d1',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'undeclared:pms.unknown.key' });
  });

  it('NO_AVAILABILITY status unchanged (409)', async () => {
    const actor = 'user_d1_no_avail';
    const owner = { kind: 'user' as const, userId: actor };
    const { propertyId, stub, org } = await provisionHotel(actor);
    expect((await postRoomType(propertyId, actor)).status).toBe(201);
    const naStatus = await stub.readNightAuditStatus();
    if (!naStatus.ok) throw new Error('night audit status unavailable');
    const guest = await createGuest(org, propertyId, `guest_${propertyId}`, 'Guest', owner);
    mockRouteCommandError('post_reservations', NO_AVAILABILITY);
    const res = await postReservation(
      propertyId,
      actor,
      'res_d1_blocked',
      naStatus.businessDate,
      addDays(naStatus.businessDate, 2),
      guest.guestRef,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: NO_AVAILABILITY });
  });
});
