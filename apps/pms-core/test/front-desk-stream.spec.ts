import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PropertyDO } from '../src/property-do.js';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures.js';
import { createGuest, orgStub as testOrgStub } from './guest-helpers.js';

type SnapshotMsg = {
  type: 'snapshot';
  asOf: number;
  fromDate: string;
  toDate: string;
  blocks: Array<{ reservationId: string; displayName?: unknown }>;
};

type DeltaMsg = {
  type: 'delta';
  asOf: number;
  blocks?: Array<{ reservationId: string }>;
};

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
        name: 'Stream Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_stream_${crypto.randomUUID()}`;
  const propertyId = `prop_stream_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Stream Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const roomTypeRes = await worker.fetch(
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
  expect(roomTypeRes.status).toBe(201);
  const { fromDate } = (await roomTypeRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await resolved.stub.flushOutbox();
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', fromDate);
  }
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  const guest = await createGuest(org, propertyId, `guest_${crypto.randomUUID()}`, 'Stream Guest', {
    kind: 'user',
    userId: actor,
  });
  await resolved!.stub.insertReservationForTest({
    reservationId: `res_occ_${crypto.randomUUID()}`,
    roomTypeId: 'rt_king',
    guestRef: guest.guestRef,
    piiKeyId: guest.piiKeyId,
    arrivalDate: fromDate,
    departureDate: addCalendarDays(fromDate, 2),
    status: 'confirmed',
  });
  return {
    orgId,
    propertyId,
    A: fromDate,
    stub: resolved!.stub as DurableObjectStub<PropertyDO>,
    guestRef: guest.guestRef,
  };
}

async function getTape(propertyId: string, actor: string, fromDate: string, toDate: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/tape?fromDate=${fromDate}&toDate=${toDate}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

function streamUrl(propertyId: string, extraQuery = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/front-desk/stream${extraQuery}`;
}

async function upgradeStream(
  propertyId: string,
  headers: HeadersInit,
  extraQuery = '',
  fetchEnv: typeof env = env,
) {
  return worker.fetch(
    new Request(streamUrl(propertyId, extraQuery), {
      headers: {
        Upgrade: 'websocket',
        Connection: 'Upgrade',
        ...headers,
      },
    }),
    fetchEnv,
  );
}

function waitJson(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws message timeout')), timeoutMs);
    const onMsg = (ev: MessageEvent) => {
      clearTimeout(t);
      ws.removeEventListener('message', onMsg);
      try {
        resolve(JSON.parse(String(ev.data)) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    };
    ws.addEventListener('message', onMsg);
  });
}

describe('front-desk hibernating stream HTTP [119]', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('without Upgrade is 400 expected_websocket', async () => {
    const actor = 'user_stream_1';
    const { propertyId } = await provisionHotel(actor);
    const res = await worker.fetch(
      new Request(streamUrl(propertyId), { headers: { 'x-dev-actor': actor } }),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'expected_websocket' });
  });

  it('upgrade + subscribe snapshot matches tape; no displayName', async () => {
    const actor = 'user_stream_2';
    const { propertyId, A } = await provisionHotel(actor);
    const toDate = addCalendarDays(A, 1);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeDefined();
    ws!.accept();
    ws!.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate }));
    const snap = (await waitJson(ws!)) as SnapshotMsg;
    expect(snap.type).toBe('snapshot');
    expect('displayName' in (snap.blocks[0] ?? {})).toBe(false);

    const tapeRes = await getTape(propertyId, actor, A, toDate);
    expect(tapeRes.status).toBe(200);
    const tape = (await tapeRes.json()) as { blocks: Array<{ reservationId: string }> };
    expect(snap.blocks.map((b) => b.reservationId).sort()).toEqual(
      tape.blocks.map((b) => b.reservationId).sort(),
    );
    ws!.close(1000, 'done');
  });

  it('stranger is 404 before 101', async () => {
    const actor = 'user_stream_3';
    const { propertyId } = await provisionHotel(actor);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': 'user_stream_stranger' });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
  });

  it('second subscribe window filters deltas', async () => {
    const actor = 'user_stream_4';
    const { propertyId, A, guestRef } = await provisionHotel(actor);
    const oldTo = addCalendarDays(A, 1);
    const newFrom = addCalendarDays(A, 10);
    const newTo = addCalendarDays(A, 11);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    ws.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate: oldTo }));
    expect((await waitJson(ws)).type).toBe('snapshot');
    ws.send(JSON.stringify({ type: 'subscribe', fromDate: newFrom, toDate: newTo }));
    expect((await waitJson(ws)).type).toBe('snapshot');

    const oldCreate = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: `res_old_${crypto.randomUUID()}`,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: A,
          departureDate: addCalendarDays(A, 1),
          idempotencyKey: `idem-old-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(oldCreate.status).toBe(201);

    const leaked: Record<string, unknown>[] = [];
    const leakHandler = (ev: MessageEvent) => leaked.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
    ws.addEventListener('message', leakHandler);
    await new Promise((r) => setTimeout(r, 50));
    ws.removeEventListener('message', leakHandler);
    expect(leaked.filter((m) => m.type === 'delta')).toEqual([]);

    const waitDelta = waitJson(ws);
    const newCreate = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: `res_new_${crypto.randomUUID()}`,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: newFrom,
          departureDate: addCalendarDays(newFrom, 1),
          idempotencyKey: `idem-new-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(newCreate.status).toBe(201);
    const delta = (await waitDelta) as DeltaMsg;
    expect(delta.type).toBe('delta');
    expect(delta.blocks?.some((b) => b.reservationId.startsWith('res_new_'))).toBe(true);
    ws.close(1000, 'done');
  });

  it('reservation.created broadcasts delta; folio line does not', async () => {
    const actor = 'user_stream_5';
    const { propertyId, A, guestRef } = await provisionHotel(actor);
    const toDate = addCalendarDays(A, 1);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    ws.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate }));
    expect((await waitJson(ws)).type).toBe('snapshot');

    const reservationId = `res_live_${crypto.randomUUID()}`;
    const waitDelta = waitJson(ws);
    const created = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: A,
          departureDate: addCalendarDays(A, 1),
          idempotencyKey: `idem-live-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);
    const delta = (await waitDelta) as DeltaMsg;
    expect(delta.type).toBe('delta');
    expect(delta.blocks?.some((b) => b.reservationId === reservationId)).toBe(true);
    expect('displayName' in (delta.blocks?.[0] ?? {})).toBe(false);

    const extras: Record<string, unknown>[] = [];
    const extraHandler = (ev: MessageEvent) =>
      extras.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
    ws.addEventListener('message', extraHandler);
    const folio = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            chargeCode: 'MISC',
            amountMinor: 1000,
            idempotencyKey: `idem-folio-${crypto.randomUUID()}`,
          }),
        },
      ),
      env,
    );
    expect(folio.status).toBe(201);
    await new Promise((r) => setTimeout(r, 50));
    ws.removeEventListener('message', extraHandler);
    expect(extras.filter((m) => m.type === 'delta' || m.type === 'snapshot')).toEqual([]);
    ws.close(1000, 'done');
  });

  it('dev-actor via Sec-WebSocket-Protocol selects front-office; no JWT echo', async () => {
    const actor = 'user_stream_6';
    const { propertyId } = await provisionHotel(actor);
    const proto = `hospai.dev-actor.${actor}, front-office`;
    const viaProto = await upgradeStream(propertyId, { 'Sec-WebSocket-Protocol': proto });
    expect(viaProto.status).toBe(101);
    const selected = viaProto.headers.get('Sec-WebSocket-Protocol');
    expect(selected).toBe('front-office');
    expect(selected).not.toMatch(/hospai\.clerk\./);
    expect(selected).not.toMatch(/hospai\.dev-actor\./);
    viaProto.webSocket?.accept();
    viaProto.webSocket?.close(1000, 'done');

    const flagsOff = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined,
    };
    const deniedProto = await upgradeStream(propertyId, { 'Sec-WebSocket-Protocol': proto }, '', flagsOff);
    expect(deniedProto.status).toBe(401);

    const viaQuery = await worker.fetch(
      new Request(streamUrl(propertyId, `?actor=${actor}`), {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
      env,
    );
    expect(viaQuery.status).toBe(401);
  });

  it('client close does not throw', async () => {
    const actor = 'user_stream_7';
    const { propertyId } = await provisionHotel(actor);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    ws.close(1000, 'client-done');
  });

  it('hibernation eviction still delivers a post-eviction subscribe snapshot', async () => {
    const actor = 'user_stream_8';
    const { propertyId, A, stub } = await provisionHotel(actor);
    const toDate = addCalendarDays(A, 1);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    let ws = res.webSocket!;
    ws.accept();
    ws.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate }));
    expect((await waitJson(ws)).type).toBe('snapshot');

    const cf = (await import('cloudflare:test')) as typeof import('cloudflare:test') & {
      evictDurableObject?: (
        s: DurableObjectStub,
        opts?: { webSockets?: 'hibernate' | 'close' },
      ) => Promise<void>;
    };
    if (typeof cf.evictDurableObject === 'function') {
      await cf.evictDurableObject(stub, { webSockets: 'hibernate' });
    } else {
      try {
        await runInDurableObject(stub, (_instance, state) => {
          state.abort('hibernate');
        });
      } catch {
        /* 0.8.71 abort tears down the isolate and closes sockets */
      }
      const again = await upgradeStream(propertyId, { 'x-dev-actor': actor });
      expect(again.status).toBe(101);
      ws = again.webSocket!;
      ws.accept();
    }

    ws.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate }));
    const snap = await waitJson(ws, 4000);
    expect(snap.type).toBe('snapshot');
    ws.close(1000, 'done');
  });

  it('kill-switch on stream GET is 503 without 101', async () => {
    const actor = 'user_stream_kill';
    const { propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(streamUrl(propertyId), { headers: { 'x-dev-actor': actor } }),
      env,
    );
    expect(res.status).toBe(503);
    expect(res.webSocket).toBeNull();
  });
});
