import { env, createMessageBatch } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEventMessage, EventSource } from '@hospai/contracts';
import { toQueueMessage, type OutboxRow } from '@hospai/do-runtime';
import worker from '../src/index.js';
import { resolveOrgStub } from '@hospai/tenant-router';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

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
        name: 'Availability Test Hotel',
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

describe('GET /v1/properties/:id/availability', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('Test 1: GET /v1/properties/:id/availability?roomTypeId=... post-mutation returns KV cache hit', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail1_${crypto.randomUUID()}`;
    const propertyId = `prop_avail1_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 1', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const roomTypeRes = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_suite',
      code: 'STE',
      name: 'Suite',
      roomCount: 4,
      maxOccupancy: 3,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });
    expect(roomTypeRes.status).toBe(201);
    const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    const stub = resolved!.stub;

    await stub.resetLaneGuardForTest();
    const flush = await stub.runOutboxAlarmForTest();
    expect(flush).not.toBeNull();

    const source = { do: 'property' as const, id: propertyId };
    await dispatchQueueConsumer(flush!.rows, source);

    const fromDate = roomTypeData.fromDate;
    const toDate = addDays(fromDate, 4);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=${fromDate}&toDate=${toDate}&roomTypeId=rt_suite`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      propertyId: string;
      fromDate: string;
      toDate: string;
      ariVersion: number;
      source: string;
      cache: string;
      items: Array<{ roomTypeId: string; stayDate: string; physical: number; free: number }>;
    };

    expect(body.propertyId).toBe(propertyId);
    expect(body.cache).toBe('hit');
    expect(body.source).toBe('kv');
    expect(body.items.length).toBe(5);
    expect(body.items[0]!.physical).toBe(4);
    expect(body.items[0]!.free).toBe(4);
  });

  it('Test 2: Query range with roomTypeId omitted goes straight to DO', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail2_${crypto.randomUUID()}`;
    const propertyId = `prop_avail2_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 2', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_room',
      code: 'RM',
      name: 'Standard Room',
      roomCount: 2,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-06-01&toDate=2026-06-03`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; cache: string };
    expect(body.source).toBe('do');
    expect(body.cache).toBe('miss');
  });

  it('Test 3: Query range with roomTypeId supplied but KV cache miss falls back to DO', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail3_${crypto.randomUUID()}`;
    const propertyId = `prop_avail3_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 3', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const roomTypeRes = await postRoomType(propertyId, actor, {
      roomTypeId: 'rt_miss',
      code: 'MSS',
      name: 'Miss Room',
      roomCount: 3,
      maxOccupancy: 2,
      maxAdults: 2,
      idempotencyKey: `idem-add-${crypto.randomUUID()}`,
    });
    expect(roomTypeRes.status).toBe(201);
    const roomTypeData = (await roomTypeRes.json()) as { fromDate: string };
    const fromDate = roomTypeData.fromDate;
    const toDate = addDays(fromDate, 1);

    // Do NOT dispatch queue consumer -> KV entries do NOT exist
    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=${fromDate}&toDate=${toDate}&roomTypeId=rt_miss`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; cache: string; items: unknown[] };
    expect(body.source).toBe('do');
    expect(body.cache).toBe('miss');
    expect(body.items.length).toBe(2);
  });

  it('Test 4: Single-day query (fromDate === toDate) succeeds', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail4_${crypto.randomUUID()}`;
    const propertyId = `prop_avail4_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 4', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-08-01&toDate=2026-08-01`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fromDate: string; toDate: string };
    expect(body.fromDate).toBe('2026-08-01');
    expect(body.toDate).toBe('2026-08-01');
  });

  it('Test 5: Query range exceeding 90 days returns 400 date_range_exceeds_max', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail5_${crypto.randomUUID()}`;
    const propertyId = `prop_avail5_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 5', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-01-01&toDate=2026-04-05`, // > 90 days
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'date_range_exceeds_max' });
  });

  it('Test 6: Invalid date strings return 400 invalid_date', async () => {
    const actor = 'user_avail_owner';
    const orgId = `org_avail6_${crypto.randomUUID()}`;
    const propertyId = `prop_avail6_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 6', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=invalid&toDate=2026-01-05`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_date' });
  });

  it('Test 7: Non-member user query returns 404 not_found', async () => {
    const ownerActor = 'user_avail_owner7';
    const nonMemberActor = 'user_avail_stranger';
    const orgId = `org_avail7_${crypto.randomUUID()}`;
    const propertyId = `prop_avail7_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 7', ownerActor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, ownerActor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-01-01&toDate=2026-01-05`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': nonMemberActor },
        },
      ),
      env,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('Test 8: Member with staff role user query returns 200 OK', async () => {
    const ownerActor = 'user_avail_owner8';
    const staffActor = 'user_avail_staff';
    const orgId = `org_avail8_${crypto.randomUUID()}`;
    const propertyId = `prop_avail8_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 8', ownerActor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, ownerActor)).status).toBe(201);

    // Add staff member to org
    const orgStub = resolveOrgStub(env.ORG_DO, { orgId }) as any;
    await orgStub.ensureMember(staffActor, 'staff');

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-01-01&toDate=2026-01-05`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': staffActor },
        },
      ),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('Test 9: Active kill-switch on pms.core returns 503 Service Unavailable', async () => {
    const actor = 'user_avail_owner9';
    const orgId = `org_avail9_${crypto.randomUUID()}`;
    const propertyId = `prop_avail9_${crypto.randomUUID()}`;

    expect((await postOrg(orgId, 'Avail Org 9', actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);

    const res = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/availability?fromDate=2026-01-01&toDate=2026-01-05`,
        {
          method: 'GET',
          headers: { 'x-dev-actor': actor },
        },
      ),
      env,
    );
    expect(res.status).toBe(503);

    // Reset killswitch
    await setKillSwitch(env, 'pms.core', false);
  });
});
