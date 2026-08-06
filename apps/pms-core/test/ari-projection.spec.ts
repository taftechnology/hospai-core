import { env, createMessageBatch } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import type { AriProjectionEntry } from '../src/event-consumer.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';
import { createGuest, idemFor, orgStub } from './guest-helpers.js';

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

async function postProperty(
  orgId: string,
  propertyId: string,
  actor: string,
  timeZone = 'UTC',
  currency = 'USD',
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'ARI Projection Hotel',
        timeZone,
        currency,
      }),
    }),
    env,
  );
}

async function postRoomType(
  propertyId: string,
  actor: string,
  body: {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function putRoomType(
  propertyId: string,
  roomTypeId: string,
  actor: string,
  body: {
    code?: string;
    name?: string;
    roomCount?: number;
    maxOccupancy?: number;
    maxAdults?: number;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function deleteRoomType(
  propertyId: string,
  roomTypeId: string,
  actor: string,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'x-dev-actor': actor };
  if (idempotencyKey) {
    headers['x-idempotency-key'] = idempotencyKey;
  }
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}`,
      {
        method: 'DELETE',
        headers,
      },
    ),
    env,
  );
}

async function dispatchQueueConsumer(rows: OutboxRow[], source: EventSource): Promise<void> {
  const batch = createMessageBatch(
    'hospai-events',
    rows.map((row) => ({
      id: row.eventId,
      timestamp: new Date(row.createdAt),
      attempts: 1,
      body: toQueueMessage(row, source),
    })),
  );
  await worker.queue(batch as MessageBatch<DomainEventMessage>, env);
}

describe('ARI KV Projection', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('Test 1: tryAddRoomType + outbox flush + consumer projects ARI KV entries', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari1_${crypto.randomUUID()}`;
    const propertyId = `prop_ari1_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 1', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const roomTypeRes = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_deluxe',
      code: 'DLX',
      name: 'Deluxe Suite',
      roomCount: 5,
      maxOccupancy: 3,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });
    expect(roomTypeRes.status).toBe(201);
    const roomTypeData = (await roomTypeRes.json()) as {
      ok: boolean;
      roomTypeId: string;
      ariVersion: number;
      fromDate: string;
      toDate: string;
    };
    expect(roomTypeData.ok).toBe(true);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);

    // Verify KV projection entry for the first night
    const key = `ari:${propertyId}:rt_deluxe:${roomTypeData.fromDate}`;
    const kvJson = await env.ARI_KV.get(key);
    expect(kvJson).not.toBeNull();

    const entry = JSON.parse(kvJson!) as AriProjectionEntry;
    expect(entry.physical).toBe(5);
    expect(entry.blocked).toBe(0);
    expect(entry.held).toBe(0);
    expect(entry.sold).toBe(0);
    expect(entry.oversell).toBe(0);
    expect(entry.free).toBe(entry.physical - entry.blocked - entry.held - entry.sold + entry.oversell);
    expect(entry.ariVersion).toBe(roomTypeData.ariVersion);
  });

  it('Test 2: tryBookAvailability updates sold and free in KV projection', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari2_${crypto.randomUUID()}`;
    const propertyId = `prop_ari2_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 2', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_standard',
      code: 'STD',
      name: 'Standard Room',
      roomCount: 10,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;

    // Flush initial room type addition
    await stub.resetLaneGuardForTest();
    const flush1 = await stub.runOutboxAlarmForTest();
    const source = { do: 'property' as const, id: propertyId };
    if (flush1) await dispatchQueueConsumer(flush1.rows, source);

    // Book a stay
    const today = await stub.readBusinessDate();
    expect(today).not.toBeNull();
    const actorCtx = { kind: 'user' as const, userId: actor };
    const org = orgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, propertyId, 'g_test', 'Test Guest', actorCtx);
    const bookInput = {
      reservationId: `res_${crypto.randomUUID()}`,
      roomTypeId: 'rt_standard',
      arrivalDate: today!,
      departureDate: addDays(today!, 1), // 1-night stay
      guestRef: guest.guestRef,
    };
    const bookRes = await stub.tryCreateReservation(
      actorCtx,
      bookInput,
      await idemFor('book-test', bookInput),
    );
    expect(bookRes.ok).toBe(true);

    // Flush booking events
    await stub.resetLaneGuardForTest();
    const flush2 = await stub.runOutboxAlarmForTest();
    expect(flush2).not.toBeNull();
    await dispatchQueueConsumer(flush2!.rows, source);

    const key = `ari:${propertyId}:rt_standard:${today}`;
    const kvJson = await env.ARI_KV.get(key);
    expect(kvJson).not.toBeNull();

    const entry = JSON.parse(kvJson!) as AriProjectionEntry;
    expect(entry.sold).toBe(1);
    expect(entry.free).toBe(9); // 10 physical - 1 sold
  });

  it('Test 3: tryUpdateRoomType (roomCount change) updates physical in KV', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari3_${crypto.randomUUID()}`;
    const propertyId = `prop_ari3_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 3', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_update',
      code: 'UPD',
      name: 'Updatable Room',
      roomCount: 4,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;

    // Update room count to 8
    const putRes = await putRoomType(propertyId, 'rt_update', actor, {
      roomCount: 8,
      idempotencyKey: `idem-put-${crypto.randomUUID()}`,
    });
    expect(putRes.status).toBe(200);

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);

    const today = await stub.readBusinessDate();
    const key = `ari:${propertyId}:rt_update:${today}`;
    const kvJson = await env.ARI_KV.get(key);
    expect(kvJson).not.toBeNull();

    const entry = JSON.parse(kvJson!) as AriProjectionEntry;
    expect(entry.physical).toBe(8);
    expect(entry.free).toBe(8);
  });

  it('Test 4: tryDeleteRoomType writes physical=0, free=0 in KV projection', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari4_${crypto.randomUUID()}`;
    const propertyId = `prop_ari4_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 4', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_delete',
      code: 'DEL',
      name: 'Deletable Room',
      roomCount: 3,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;

    const delRes = await deleteRoomType(propertyId, 'rt_delete', actor, `idem-del-${crypto.randomUUID()}`);
    expect(delRes.status).toBe(200);

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);

    const today = await stub.readBusinessDate();
    const key = `ari:${propertyId}:rt_delete:${today}`;
    const kvJson = await env.ARI_KV.get(key);
    expect(kvJson).not.toBeNull();

    const entry = JSON.parse(kvJson!) as AriProjectionEntry;
    expect(entry.physical).toBe(0);
    expect(entry.free).toBe(0);
  });

  it('Test 5: Duplicate availability.changed delivery skips duplicate KV processing', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari5_${crypto.randomUUID()}`;
    const propertyId = `prop_ari5_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 5', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_dedupe',
      code: 'DDP',
      name: 'Dedupe Room',
      roomCount: 2,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const stub = resolved!.stub;

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    // First delivery
    await dispatchQueueConsumer(flush!.rows, source);

    const today = await stub.readBusinessDate();
    const key = `ari:${propertyId}:rt_dedupe:${today}`;
    const firstKv = await env.ARI_KV.get(key);
    expect(firstKv).not.toBeNull();

    // Redeliver same outbox rows (simulates queue retry after initial ack)
    await dispatchQueueConsumer(flush!.rows, source);

    const secondKv = await env.ARI_KV.get(key);
    expect(secondKv).toBe(firstKv);
  });

  it('Test 6: readAvailabilityRange on property with no availability_day rows returns rows: []', async () => {
    const actor = 'user_ari_owner';
    const orgId = `org_ari6_${crypto.randomUUID()}`;
    const propertyId = `prop_ari6_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'ARI Org 6', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    const res = await stub.readAvailabilityRange('2026-01-01', '2026-01-10');
    expect(res).toHaveProperty('ariVersion');
    expect(typeof res.ariVersion).toBe('number');
    expect(res.rows).toEqual([]);
    expect(res.rows.length).toBe(0);
  });
});
