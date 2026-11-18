import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDEM_KEY_REUSED,
  INVALID_KINDS,
  LIMIT_EXCEEDED,
  NOT_FOUND,
  STAFF_EXITED,
  STAFF_NOT_ASSIGNABLE,
  VALIDATION_ERROR,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, seedSubscription, setKillSwitch } from '../src/registry.js';
import { idemForCommand } from './fixtures.js';

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

async function postProperty(orgId: string, propertyId: string, actor: string, name: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name,
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_ops_${crypto.randomUUID()}`;
  const propertyId = `prop_ops_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Ops Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor, 'Ops Hotel')).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  return { orgId, propertyId, actor, stub: resolved!.stub, org };
}

async function provisionTwoHotels(actor: string) {
  const orgId = `org_ops2_${crypto.randomUUID()}`;
  const propertyA = `prop_ops_a_${crypto.randomUUID()}`;
  const propertyB = `prop_ops_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Two Ops Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyA, actor, 'Hotel Alpha')).status).toBe(201);
  await seedSubscription(env, orgId, 'group');
  expect((await postProperty(orgId, propertyB, actor, 'Hotel Bravo')).status).toBe(201);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  return { orgId, propertyA, propertyB, actor, org };
}

function rosterUrl(propertyId: string, suffix = '') {
  return `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/roster${suffix}`;
}

async function postRoster(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(rosterUrl(propertyId), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-roster-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function patchRoster(
  propertyId: string,
  actor: string,
  staffId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-roster-upd-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function postRosterExit(propertyId: string, actor: string, staffId: string) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}/exit`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ idempotencyKey: `idem-roster-exit-${crypto.randomUUID()}` }),
    }),
    env,
  );
}

async function getRosterList(propertyId: string, actor: string, kind?: string) {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return worker.fetch(
    new Request(rosterUrl(propertyId, q), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function getRosterOne(propertyId: string, actor: string, staffId: string) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}`), {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function putRosterOps(
  propertyId: string,
  actor: string,
  staffId: string,
  body: Record<string, unknown>,
  idempotencyKey = `idem-ops-${crypto.randomUUID()}`,
) {
  return worker.fetch(
    new Request(rosterUrl(propertyId, `/${encodeURIComponent(staffId)}/ops`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ ...body, idempotencyKey }),
    }),
    env,
  );
}

type OpsRow = {
  staffId: string;
  displayName?: string;
  kinds: string[];
  ops: { shift: string | null; maxRooms: number | null; skills: string[] };
};

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

async function postRoom(propertyId: string, actor: string, roomId: string, code: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomId,
        roomTypeId: 'rt_king',
        code,
        idempotencyKey: `idem-room-${roomId}`,
      }),
    }),
    env,
  );
}

async function postAssign(
  propertyId: string,
  actor: string,
  body: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/housekeeping/assignments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

describe('roster ops', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('10: maintenance is accepted on add and update and filtered by kind', async () => {
    const actor = 'user_ops_kind';
    const { propertyId } = await provisionHotel(actor);

    const added = await postRoster(propertyId, actor, {
      displayName: 'Mina Maint',
      kinds: ['maintenance'],
    });
    expect(added.status).toBe(200);
    const { staffId } = (await added.json()) as { staffId: string };

    const onlyMaint = (await (await getRosterList(propertyId, actor, 'maintenance')).json()) as {
      staff: OpsRow[];
    };
    expect(onlyMaint.staff.map((row) => row.staffId)).toEqual([staffId]);
    expect(onlyMaint.staff[0]?.kinds).toEqual(['maintenance']);
    expect(onlyMaint.staff[0]?.ops).toEqual({ shift: null, maxRooms: null, skills: [] });

    const housekeepers = (await (await getRosterList(propertyId, actor, 'housekeeper')).json()) as {
      staff: OpsRow[];
    };
    expect(housekeepers.staff).toEqual([]);

    const unknown = await postRoster(propertyId, actor, {
      displayName: 'Nope',
      kinds: ['concierge'],
    });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ ok: false, error: INVALID_KINDS });

    const updated = await patchRoster(propertyId, actor, staffId, {
      kinds: ['housekeeper', 'maintenance'],
    });
    expect(updated.status).toBe(200);
    const both = (await (await getRosterList(propertyId, actor)).json()) as { staff: OpsRow[] };
    expect(both.staff[0]?.kinds).toEqual(['housekeeper', 'maintenance']);
    const one = (await (await getRosterOne(propertyId, actor, staffId)).json()) as OpsRow;
    expect(one.kinds).toEqual(['housekeeper', 'maintenance']);
    expect(one.ops).toEqual({ shift: null, maxRooms: null, skills: [] });
  });

  it('11: set_ops on staff not linked to the URL property is 404 with no foreign data', async () => {
    const actor = 'user_ops_unlinked';
    const { propertyA, propertyB } = await provisionTwoHotels(actor);
    const added = await postRoster(propertyA, actor, {
      displayName: 'Ada Unlinked',
      kinds: ['housekeeper'],
    });
    expect(added.status).toBe(200);
    const { staffId } = (await added.json()) as { staffId: string };

    const res = await putRosterOps(propertyB, actor, staffId, {
      shift: 'morning',
      maxRooms: 8,
      skills: ['linen'],
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: NOT_FOUND });
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain(propertyA);
    expect(encoded).not.toContain(propertyB);
    expect(encoded).not.toContain('Ada');
    expect(encoded).not.toContain('linen');
  });

  it('12: ops at hotel A are invisible at hotel B for the same staff member', async () => {
    const actor = 'user_ops_two';
    const { propertyA, propertyB, org } = await provisionTwoHotels(actor);
    const added = await postRoster(propertyA, actor, {
      displayName: 'Sam Shared',
      kinds: ['housekeeper'],
    });
    expect(added.status).toBe(200);
    const { staffId } = (await added.json()) as { staffId: string };

    await runInDurableObject(org, (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO roster_property (staff_id, property_id, created_at) VALUES (?, ?, ?)`,
        staffId,
        propertyB,
        1,
      );
    });

    expect(
      (
        await putRosterOps(propertyA, actor, staffId, {
          shift: 'morning',
          maxRooms: 8,
          skills: ['linen'],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await putRosterOps(propertyB, actor, staffId, {
          shift: 'night',
          maxRooms: 4,
          skills: ['hvac'],
        })
      ).status,
    ).toBe(200);

    const atA = (await (await getRosterOne(propertyA, actor, staffId)).json()) as OpsRow;
    const atB = (await (await getRosterOne(propertyB, actor, staffId)).json()) as OpsRow;
    expect(atA.ops).toEqual({ shift: 'morning', maxRooms: 8, skills: ['linen'] });
    expect(atB.ops).toEqual({ shift: 'night', maxRooms: 4, skills: ['hvac'] });
    expect(JSON.stringify(atA)).not.toContain('hvac');
    expect(JSON.stringify(atB)).not.toContain('linen');

    const listA = (await (await getRosterList(propertyA, actor)).json()) as { staff: OpsRow[] };
    const listB = (await (await getRosterList(propertyB, actor)).json()) as { staff: OpsRow[] };
    expect(listA.staff.find((row) => row.staffId === staffId)?.ops.shift).toBe('morning');
    expect(listB.staff.find((row) => row.staffId === staffId)?.ops.shift).toBe('night');
  });

  it('13: housekeeping.assign over capacity succeeds; maintenance-only is rejected', async () => {
    const actor = 'user_ops_assign';
    const { propertyId } = await provisionHotel(actor);
    const roomTypeRes = await postRoomType(propertyId, actor);
    expect(roomTypeRes.status).toBe(201);
    const { fromDate: arrival } = (await roomTypeRes.json()) as { fromDate: string };
    expect((await postRoom(propertyId, actor, 'room_ops_1', '701')).status).toBe(201);
    expect((await postRoom(propertyId, actor, 'room_ops_2', '702')).status).toBe(201);

    const hkRes = await postRoster(propertyId, actor, {
      displayName: 'Over Cap',
      kinds: ['housekeeper'],
    });
    expect(hkRes.status).toBe(200);
    const hk = (await hkRes.json()) as { staffId: string };
    expect(
      (
        await putRosterOps(propertyId, actor, hk.staffId, {
          shift: 'morning',
          maxRooms: 1,
          skills: [],
        })
      ).status,
    ).toBe(200);

    const first = await postAssign(propertyId, actor, {
      roomId: 'room_ops_1',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-ops-assign-1',
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, assignmentId: expect.any(String) });

    const second = await postAssign(propertyId, actor, {
      roomId: 'room_ops_2',
      businessDate: arrival,
      assigneeRef: hk.staffId,
      idempotencyKey: 'idem-ops-assign-2',
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true });

    const maintRes = await postRoster(propertyId, actor, {
      displayName: 'Wrench Only',
      kinds: ['maintenance'],
    });
    expect(maintRes.status).toBe(200);
    const maint = (await maintRes.json()) as { staffId: string };
    const rejected = await postAssign(propertyId, actor, {
      roomId: 'room_ops_1',
      businessDate: arrival,
      assigneeRef: maint.staffId,
      idempotencyKey: 'idem-ops-assign-maint',
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ ok: false, error: STAFF_NOT_ASSIGNABLE });
  });

  it('normalises skills, caps at HTTP and in OrgDO, and rejects wrong types', async () => {
    const actor = 'user_ops_norm';
    const { propertyId, org } = await provisionHotel(actor);
    const added = await postRoster(propertyId, actor, {
      displayName: 'Norm',
      kinds: ['housekeeper'],
    });
    const { staffId } = (await added.json()) as { staffId: string };

    const normalised = await putRosterOps(propertyId, actor, staffId, {
      shift: 'evening',
      maxRooms: 12,
      skills: ['  Linen  ', 'linen', '  Suites   West '],
    });
    expect(normalised.status).toBe(200);
    const row = (await (await getRosterOne(propertyId, actor, staffId)).json()) as OpsRow;
    expect(row.ops).toEqual({ shift: 'evening', maxRooms: 12, skills: ['Linen', 'Suites West'] });

    const tooMany = await putRosterOps(propertyId, actor, staffId, {
      shift: null,
      maxRooms: null,
      skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    });
    expect(tooMany.status).toBe(422);
    expect(await tooMany.json()).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    const tooLong = await putRosterOps(propertyId, actor, staffId, {
      shift: null,
      maxRooms: null,
      skills: ['x'.repeat(33)],
    });
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    for (const bad of [
      { shift: 'noon', maxRooms: null, skills: [] },
      { shift: null, maxRooms: 0, skills: [] },
      { shift: null, maxRooms: 51, skills: [] },
      { shift: null, maxRooms: 1.5, skills: [] },
      { shift: null, maxRooms: null, skills: 'linen' },
      { shift: 'morning', maxRooms: 8 },
    ]) {
      const res = await putRosterOps(propertyId, actor, staffId, bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_body' });
    }

    const actorCtx = { kind: 'user' as const, userId: actor };
    const over = {
      staffId,
      propertyId,
      shift: null,
      maxRooms: null,
      skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'],
    };
    expect(
      await org.trySetRosterOps(actorCtx, over, await idemForCommand('roster.set_ops', 'ops-do-cap', over)),
    ).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    const long = {
      staffId,
      propertyId,
      shift: null,
      maxRooms: null,
      skills: ['y'.repeat(33)],
    };
    expect(
      await org.trySetRosterOps(actorCtx, long, await idemForCommand('roster.set_ops', 'ops-do-long', long)),
    ).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });

    const badMax = {
      staffId,
      propertyId,
      shift: 'morning' as const,
      maxRooms: 0,
      skills: [] as string[],
    };
    expect(
      await org.trySetRosterOps(
        actorCtx,
        badMax,
        await idemForCommand('roster.set_ops', 'ops-do-max', badMax),
      ),
    ).toMatchObject({ ok: false, error: VALIDATION_ERROR });
  });

  it('retries the same idempotency key and rejects a reused key with a different body', async () => {
    const actor = 'user_ops_idem';
    const { propertyId } = await provisionHotel(actor);
    const added = await postRoster(propertyId, actor, {
      displayName: 'Idem',
      kinds: ['housekeeper'],
    });
    const { staffId } = (await added.json()) as { staffId: string };
    const key = 'idem-ops-retry';
    const body = { shift: 'any', maxRooms: 5, skills: ['turndown'] };

    const first = await putRosterOps(propertyId, actor, staffId, body, key);
    const second = await putRosterOps(propertyId, actor, staffId, body, key);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());

    const reused = await putRosterOps(
      propertyId,
      actor,
      staffId,
      { shift: 'night', maxRooms: 5, skills: ['turndown'] },
      key,
    );
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('set_ops on exited staff returns staff_exited', async () => {
    const actor = 'user_ops_exit';
    const { propertyId } = await provisionHotel(actor);
    const added = await postRoster(propertyId, actor, {
      displayName: 'Gone',
      kinds: ['housekeeper'],
    });
    const { staffId } = (await added.json()) as { staffId: string };
    expect((await postRosterExit(propertyId, actor, staffId)).status).toBe(200);

    const res = await putRosterOps(propertyId, actor, staffId, {
      shift: 'morning',
      maxRooms: null,
      skills: [],
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: STAFF_EXITED });
  });
});
