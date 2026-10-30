import { createMessageBatch, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingCommandMessage, ProvisionalExceptionRow } from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { seedBarRatesForHorizon } from './fixtures';
import { createGuest, orgStub as testOrgStub } from './guest-helpers';

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
        name: 'Priority Hotel',
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

async function provisionHotel(actor: string) {
  const orgId = `org_hkp_${crypto.randomUUID()}`;
  const propertyId = `prop_hkp_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Priority Org', actor)).status).toBe(201);
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

async function postRoom(propertyId: string, actor: string, roomId: string, code: string) {
  const res = await worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomId,
        roomTypeId: 'rt_king',
        code,
        idempotencyKey: `idem-rm-${roomId}`,
      }),
    }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
}

async function postStatus(propertyId: string, actor: string, roomId: string, status: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/${encodeURIComponent(roomId)}/status`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ status, idempotencyKey: `idem-st-${roomId}-${status}` }),
      },
    ),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

async function postReservation(
  propertyId: string,
  actor: string,
  reservationId: string,
  arrival: string,
  departure: string,
  guestRef: string,
) {
  const res = await worker.fetch(
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
  expect(res.status, await res.clone().text()).toBe(201);
}

async function assignRoom(propertyId: string, actor: string, reservationId: string, roomId: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/assign-room`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ roomId, idempotencyKey: `idem-as-${reservationId}` }),
      },
    ),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

async function postCheckIn(propertyId: string, actor: string, reservationId: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/check-in`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-ci-${reservationId}`,
        },
        body: JSON.stringify({}),
      },
    ),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

async function postVip(propertyId: string, actor: string, reservationId: string) {
  const res = await worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/front-office`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          vipFlag: true,
          idempotencyKey: `idem-vip-${reservationId}`,
        }),
      },
    ),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

function putPriority(
  propertyId: string,
  actor: string,
  body: { roomId: string; businessDate: string; level: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/priority`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

function getPriorities(propertyId: string, actor: string, date: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/priorities?date=${encodeURIComponent(date)}`,
      { headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

type QueueRow = {
  roomId: string;
  code: string;
  level: string | null;
  score: number;
  reasons: string[];
  stay: string;
};

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

describe('housekeeping priority', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    vi.restoreAllMocks();
  });

  it('sets, replaces, and clears a level; the level is absent on the next date', async () => {
    const actor = 'user_hkp_set';
    const { propertyId, arrival, stub } = await provisionHotel(actor);
    await postRoom(propertyId, actor, 'rm_101', '101');
    await postStatus(propertyId, actor, 'rm_101', 'dirty');
    const next = addCalendarDays(arrival, 1);

    const set = await putPriority(propertyId, actor, {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'vip',
      idempotencyKey: 'idem-pri-vip',
    });
    expect(set.status, await set.clone().text()).toBe(200);
    expect(await set.json()).toMatchObject({
      ok: true,
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'vip',
    });

    const vipQueue = await getPriorities(propertyId, actor, arrival);
    expect(vipQueue.status).toBe(200);
    const vipBody = (await vipQueue.json()) as { queue: QueueRow[] };
    expect(vipBody.queue).toEqual([
      expect.objectContaining({
        roomId: 'rm_101',
        code: '101',
        level: 'vip',
        score: 180,
        reasons: ['vip'],
        stay: 'vacant',
      }),
    ]);

    const replaced = await putPriority(propertyId, actor, {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'rush',
      idempotencyKey: 'idem-pri-rush',
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ level: 'rush' });
    const rushQueue = (await (await getPriorities(propertyId, actor, arrival)).json()) as {
      queue: QueueRow[];
    };
    expect(rushQueue.queue[0]).toMatchObject({ level: 'rush', score: 100, reasons: ['rush'] });

    const cleared = await putPriority(propertyId, actor, {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'standard',
      idempotencyKey: 'idem-pri-std',
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ level: null });
    const standardQueue = (await (await getPriorities(propertyId, actor, arrival)).json()) as {
      queue: QueueRow[];
    };
    expect(standardQueue.queue[0]).toMatchObject({ level: null, score: 20, reasons: [] });

    await putPriority(propertyId, actor, {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'vip',
      idempotencyKey: 'idem-pri-vip-again',
    });
    const tomorrow = (await (await getPriorities(propertyId, actor, next)).json()) as {
      queue: QueueRow[];
    };
    expect(tomorrow.queue[0]).toMatchObject({ level: null, score: 20 });
    expect(await stub.listOutboxEventTypes()).toContain('housekeeping.priority_changed');
  });

  it('orders the dirty queue by score then room code and skips clean, inspected, OOO, and archived', async () => {
    const actor = 'user_hkp_score';
    const { propertyId, arrival, guestRef } = await provisionHotel(actor);
    const day = addCalendarDays(arrival, 1);
    const later = addCalendarDays(arrival, 3);

    await postRoom(propertyId, actor, 'rm_201', '201');
    await postRoom(propertyId, actor, 'rm_150', '150');
    await postRoom(propertyId, actor, 'rm_301', '301');
    await postRoom(propertyId, actor, 'rm_302', '302');
    await postRoom(propertyId, actor, 'rm_101', '101');
    await postRoom(propertyId, actor, 'rm_102', '102');
    await postRoom(propertyId, actor, 'rm_clean', '401');
    await postRoom(propertyId, actor, 'rm_insp', '402');
    await postRoom(propertyId, actor, 'rm_ooo', '403');
    await postRoom(propertyId, actor, 'rm_arch', '404');

    await postReservation(propertyId, actor, 'res_arr', day, later, guestRef);
    await assignRoom(propertyId, actor, 'res_arr', 'rm_150');
    await postVip(propertyId, actor, 'res_arr');

    await postReservation(propertyId, actor, 'res_dep', arrival, day, guestRef);
    await assignRoom(propertyId, actor, 'res_dep', 'rm_301');
    await postCheckIn(propertyId, actor, 'res_dep');

    await postReservation(propertyId, actor, 'res_stay', arrival, later, guestRef);
    await assignRoom(propertyId, actor, 'res_stay', 'rm_302');
    await postCheckIn(propertyId, actor, 'res_stay');

    for (const roomId of ['rm_201', 'rm_150', 'rm_301', 'rm_302', 'rm_101', 'rm_102', 'rm_ooo', 'rm_arch']) {
      await postStatus(propertyId, actor, roomId, 'dirty');
    }
    await postStatus(propertyId, actor, 'rm_insp', 'inspected');

    const ooo = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/rm_ooo/ooo`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
          body: JSON.stringify({
            startDate: arrival,
            endDate: later,
            idempotencyKey: 'idem-ooo-403',
          }),
        },
      ),
      env,
    );
    expect(ooo.status, await ooo.clone().text()).toBe(200);

    const archived = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/rm_arch`,
        {
          method: 'DELETE',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': 'idem-arch-404' },
        },
      ),
      env,
    );
    expect(archived.status, await archived.clone().text()).toBe(200);

    const set = await putPriority(propertyId, actor, {
      roomId: 'rm_201',
      businessDate: day,
      level: 'vip',
      idempotencyKey: 'idem-pri-201',
    });
    expect(set.status, await set.clone().text()).toBe(200);

    const listed = await getPriorities(propertyId, actor, day);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { queue: QueueRow[] };
    expect(body.queue.map((row) => row.code)).toEqual(['201', '150', '301', '302', '101', '102']);
    expect(body.queue.map((row) => row.score)).toEqual([180, 165, 45, 25, 20, 20]);
    expect(body.queue[0]).toMatchObject({ level: 'vip', reasons: ['vip'], stay: 'vacant' });
    expect(body.queue[1]).toMatchObject({
      level: null,
      reasons: ['stay_vip', 'arriving'],
      stay: 'arriving',
      vip: true,
    });
    expect(body.queue[2]).toMatchObject({ stay: 'departing', reasons: ['departing'] });
    expect(body.queue[3]).toMatchObject({ stay: 'stayover', reasons: ['stayover'] });
    expect(body.queue.map((row) => row.code)).not.toContain('401');
    expect(body.queue.map((row) => row.code)).not.toContain('402');
    expect(body.queue.map((row) => row.code)).not.toContain('403');
    expect(body.queue.map((row) => row.code)).not.toContain('404');
  });

  it('retries the same idempotency key with the same result', async () => {
    const actor = 'user_hkp_idem';
    const { propertyId, arrival } = await provisionHotel(actor);
    await postRoom(propertyId, actor, 'rm_101', '101');
    await postStatus(propertyId, actor, 'rm_101', 'dirty');
    const body = {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'high',
      idempotencyKey: 'idem-pri-same',
    };
    const first = await putPriority(propertyId, actor, body);
    const second = await putPriority(propertyId, actor, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('rejects an unknown level and an unknown or archived room', async () => {
    const actor = 'user_hkp_reject';
    const { propertyId, arrival } = await provisionHotel(actor);
    await postRoom(propertyId, actor, 'rm_arch', '404');

    const unknownLevel = await putPriority(propertyId, actor, {
      roomId: 'rm_arch',
      businessDate: arrival,
      level: 'nope',
      idempotencyKey: 'idem-pri-nope',
    });
    expect(unknownLevel.status).toBe(400);
    expect(await unknownLevel.json()).toEqual({ error: 'invalid_body' });

    const unknownRoom = await putPriority(propertyId, actor, {
      roomId: 'rm_missing',
      businessDate: arrival,
      level: 'vip',
      idempotencyKey: 'idem-pri-missing',
    });
    expect(unknownRoom.status).toBe(404);
    expect(await unknownRoom.json()).toMatchObject({ ok: false, error: 'room_not_found' });

    const archived = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/rm_arch`,
        {
          method: 'DELETE',
          headers: { 'x-dev-actor': actor, 'x-idempotency-key': 'idem-arch-reject' },
        },
      ),
      env,
    );
    expect(archived.status, await archived.clone().text()).toBe(200);
    const archivedPriority = await putPriority(propertyId, actor, {
      roomId: 'rm_arch',
      businessDate: arrival,
      level: 'vip',
      idempotencyKey: 'idem-pri-arch',
    });
    expect(archivedPriority.status).toBe(404);
    expect(await archivedPriority.json()).toMatchObject({ ok: false, error: 'room_not_found' });
  });

  it('queued replay re-checks housekeeping write and does not apply after offboard', async () => {
    const owner = 'user_hkp_replay_owner';
    const clerkId = 'user_hkp_replay_clerk';
    const { orgId, propertyId, arrival, stub } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<
      import('../src/org-do.js').OrgDO
    >;
    await org.upsertPropertyMember(clerkId, propertyId, 'staff');
    await postRoom(propertyId, owner, 'rm_101', '101');
    await postStatus(propertyId, owner, 'rm_101', 'dirty');

    const sent: PendingCommandMessage[] = [];
    vi.spyOn(env.PENDING_COMMANDS_QUEUE, 'send').mockImplementation(async (body) => {
      sent.push(body);
      return {
        id: crypto.randomUUID(),
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      } as Awaited<ReturnType<typeof env.PENDING_COMMANDS_QUEUE.send>>;
    });

    await stub.setTransportBlockedForTest(true);
    const blocked = await putPriority(propertyId, clerkId, {
      roomId: 'rm_101',
      businessDate: arrival,
      level: 'vip',
      idempotencyKey: 'idem-pri-replay',
    });
    expect(blocked.status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    await org.removePropertyMemberForTest(clerkId, propertyId);
    await stub.clearPermissionCacheForTest();
    expect(sent[0]!.provisional.command.type).toBe('housekeeping.set_priority');
    await dispatchPendingBatch(sent);

    const { exceptions } = (await stub.listProvisionalExceptions()) as {
      exceptions: ProvisionalExceptionRow[];
    };
    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.reason).toBe('not_member');

    const listed = await getPriorities(propertyId, owner, arrival);
    const body = (await listed.json()) as { queue: QueueRow[] };
    expect(body.queue[0]).toMatchObject({ level: null, score: 20 });
  });
});
