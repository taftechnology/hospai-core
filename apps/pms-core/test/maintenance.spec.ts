import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ModuleManifest, ModuleTxnCtx } from '@hospai/contracts';
import {
  IDEM_KEY_REUSED,
  INVALID_TICKET_TRANSITION,
  OOO_ROOM_ASSIGNED,
  STAFF_NOT_ASSIGNABLE,
  TICKET_CLOSED,
  VALIDATION_ERROR,
} from '@hospai/contracts';
import type { PropertyDO } from '../src/property-do';
import {
  dispatchModuleSubscribers,
  type ModuleEventHandler,
} from '../src/module-outbox-dispatch.js';
import worker from '../src/index.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import { ensurePlatformSchema, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';
import { addCalendarDays } from './date-helpers';
import { seedBarRatesForHorizon, TEST_OWNER_ACTOR } from './fixtures';
import { createGuest, orgStub as testOrgStub, provisionedPropertyStub } from './guest-helpers';
import { createHousekeeper, idemFor } from './roster-helpers';

function call(
  method: string,
  path: string,
  actor: string,
  body?: unknown,
): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
}

const key = () => `idem-mnt-${crypto.randomUUID()}`;

async function provisionHotel(actor: string) {
  const orgId = `org_mnt_${crypto.randomUUID()}`;
  const propertyId = `prop_mnt_${crypto.randomUUID()}`;
  expect((await call('POST', '/v1/orgs', actor, { orgId, name: 'Maint Org' })).status).toBe(201);
  const propRes = await call('POST', `/v1/orgs/${orgId}/properties`, actor, {
    propertyId,
    name: 'Maint Hotel',
    timeZone: 'UTC',
    currency: 'USD',
  });
  expect(propRes.status).toBe(201);
  const rtRes = await call('POST', `/v1/properties/${propertyId}/room-types`, actor, {
    roomTypeId: 'rt_king',
    code: 'KNG',
    name: 'King',
    roomCount: 10,
    maxOccupancy: 2,
    maxAdults: 2,
    idempotencyKey: key(),
  });
  expect(rtRes.status).toBe(201);
  const { fromDate: open } = (await rtRes.json()) as { fromDate: string };
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) {
    await seedBarRatesForHorizon(resolved.stub, 'rt_king', open);
    await resolved.stub.flushOutbox();
  }
  expect(
    (
      await call('POST', `/v1/properties/${propertyId}/rooms`, actor, {
        roomId: 'rm_1',
        roomTypeId: 'rt_king',
        code: '101',
        idempotencyKey: key(),
      })
    ).status,
  ).toBe(201);
  return {
    orgId,
    propertyId,
    open,
    stub: resolved!.stub,
    p: `/v1/properties/${propertyId}`,
  };
}

async function setupOoo(name: string) {
  const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
  const org = testOrgStub(orgId);
  await org.ensureMetaOrgId(orgId);
  await createGuest(org, name, `guest_${name}`, 'Test Guest');
  const input = {
    roomTypeId: 'rt_king',
    code: 'KING',
    name: 'King Room',
    roomCount: 5,
    maxOccupancy: 2,
    maxAdults: 2,
  };
  const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`add-${name}`, input));
  expect(added.ok).toBe(true);
  if (!added.ok) throw new Error('add room type');
  await stub.flushOutbox();
  await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
  const room = { roomId: 'rm_1', roomTypeId: 'rt_king', code: '101' };
  expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`rm-${name}`, room))).toMatchObject({
    ok: true,
  });
  return { stub, open: added.fromDate };
}

async function setOoo(
  stub: DurableObjectStub<PropertyDO>,
  input: { roomId: string; startDate: string; endDate: string; oooId?: string; reason?: string },
  idemKey: string,
) {
  const payload = {
    roomId: input.roomId,
    startDate: input.startDate,
    endDate: input.endDate,
    ...(input.oooId ? { oooId: input.oooId } : {}),
  };
  return stub.trySetOooRange(TEST_OWNER_ACTOR, input, await idemFor(idemKey, payload));
}

describe('maintenance (Part D)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('OOO create opens one ooo ticket; replay idempotency does not add a row', async () => {
    const { stub, open } = await setupOoo(`mnt-ooo-1-${crypto.randomUUID()}`);
    const endDate = addCalendarDays(open, 3);
    const input = { roomId: 'rm_1', startDate: open, endDate, reason: '  Leak  ' };
    const first = await setOoo(stub, input, 'mnt-ooo-1a');
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('ooo');
    const list = await stub.readMaintenanceTicketsList('all');
    expect(list.tickets).toHaveLength(1);
    const t = list.tickets[0]!;
    expect(t).toMatchObject({
      source: 'ooo',
      category: 'other',
      priority: 'high',
      description: 'Leak',
      status: 'open',
      createdBy: 'user_owner',
      oooId: first.oooId,
      oooReleasedAt: null,
      oooActive: true,
      oooStartDate: open,
    });
    const second = await setOoo(stub, input, 'mnt-ooo-1a');
    expect(second).toMatchObject({ ok: true, alreadyApplied: true });
    expect((await stub.readMaintenanceTicketsList('all')).tickets).toHaveLength(1);
  });

  it('forced handler failure rolls OOO back', async () => {
    const { stub, open } = await setupOoo(`mnt-ooo-2-${crypto.randomUUID()}`);
    const blockedBefore = (await stub.readAvailabilityDay('rt_king', open))?.blocked ?? 0;
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('DROP TABLE maintenance_ticket');
    });
    const endDate = addCalendarDays(open, 2);
    const result = await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate }, 'mnt-ooo-2');
    expect(result.ok).toBe(false);
    await runInDurableObject(stub, (_instance, state) => {
      const rows = state.storage.sql.exec(`SELECT COUNT(*) AS n FROM room_ooo`).toArray() as Array<{
        n: number;
      }>;
      expect(rows[0]?.n).toBe(0);
    });
    expect((await stub.readAvailabilityDay('rt_king', open))?.blocked).toBe(blockedBefore);
  });

  it('full OOO release stamps ooo_released_at; ticket stays open', async () => {
    const { stub, open } = await setupOoo(`mnt-ooo-3-${crypto.randomUUID()}`);
    const created = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 2) },
      'mnt-ooo-3a',
    );
    if (!created.ok) throw new Error('ooo');
    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', oooId: created.oooId, startDate: open, endDate: open },
        'mnt-ooo-3b',
      ),
    ).toMatchObject({ ok: true });
    const t = (await stub.readMaintenanceTicketsList('all')).tickets[0]!;
    expect(t.status).toBe('open');
    expect(t.oooReleasedAt).not.toBeNull();
    expect(t.oooActive).toBe(false);
    expect(t.oooStartDate).toBeNull();
  });

  it('oooActive follows the live range: running, naturally ended, and shrunk', async () => {
    const { stub, open } = await setupOoo(`mnt-ooo-active-${crypto.randomUUID()}`);
    const room2 = { roomId: 'rm_2', roomTypeId: 'rt_king', code: '102' };
    expect(
      await stub.tryCreateRoom(TEST_OWNER_ACTOR, room2, await idemFor(`rm2-${open}`, room2)),
    ).toMatchObject({ ok: true });
    const longEnd = addCalendarDays(open, 5);
    const shortEnd = addCalendarDays(open, 1);
    const long = await setOoo(
      stub,
      { roomId: 'rm_1', startDate: open, endDate: longEnd },
      'mnt-active-long',
    );
    const short = await setOoo(
      stub,
      { roomId: 'rm_2', startDate: open, endDate: shortEnd },
      'mnt-active-short',
    );
    if (!long.ok || !short.ok) throw new Error('ooo');

    const running = (await stub.readMaintenanceTicketsList('all')).tickets.find((t) => t.roomId === 'rm_1')!;
    expect(running.oooActive).toBe(true);
    expect(running.oooStartDate).toBe(open);
    expect(running.status).toBe('open');

    const later = addCalendarDays(open, 2);
    await stub.setBusinessDateForTest(later);
    const advanced = await stub.readMaintenanceTicketsList('all');
    const still = advanced.tickets.find((t) => t.roomId === 'rm_1')!;
    const ended = advanced.tickets.find((t) => t.roomId === 'rm_2')!;
    expect(still.oooActive).toBe(true);
    expect(still.oooStartDate).toBe(open);
    expect(ended.oooActive).toBe(false);
    expect(ended.oooStartDate).toBe(open);
    expect(ended.oooReleasedAt).toBeNull();
    expect(ended.status).toBe('open');

    expect(
      await setOoo(
        stub,
        { roomId: 'rm_1', oooId: long.oooId, startDate: open, endDate: later },
        'mnt-active-shrink',
      ),
    ).toMatchObject({ ok: true });
    const shrunk = (await stub.readMaintenanceTicketsList('all')).tickets.find((t) => t.roomId === 'rm_1')!;
    expect(shrunk.oooActive).toBe(false);
    expect(shrunk.oooStartDate).toBe(open);
    expect(shrunk.status).toBe('open');
    expect(shrunk.oooReleasedAt).toBeNull();
  });

  it('OOO on assigned arriving stay fails with OOO_ROOM_ASSIGNED and writes no ticket', async () => {
    const name = `mnt-ooo-4-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = testOrgStub(orgId);
    await org.ensureMetaOrgId(orgId);
    const guest = await createGuest(org, name, `guest_${name}`, 'Guest');
    const input = {
      roomTypeId: 'rt_king',
      code: 'KING',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor('rt', input));
    if (!added.ok) throw new Error('rt');
    await seedBarRatesForHorizon(stub, 'rt_king', added.fromDate);
    const open = added.fromDate;
    for (const [id, code] of [
      ['rm_1', '101'],
      ['rm_2', '102'],
    ] as const) {
      const room = { roomId: id, roomTypeId: 'rt_king', code };
      expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(id, room))).toMatchObject({
        ok: true,
      });
    }
    const reservationId = 'res_mnt_4';
    const create = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      arrivalDate: open,
      departureDate: addCalendarDays(open, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, create, await idemFor('c', create)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.tryAssignRoom(
        TEST_OWNER_ACTOR,
        { reservationId, roomId: 'rm_1' },
        await idemFor('as', { reservationId, roomId: 'rm_1' }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await setOoo(stub, { roomId: 'rm_1', startDate: open, endDate: addCalendarDays(open, 1) }, 'mnt-ooo-4'),
    ).toMatchObject({ ok: false, error: OOO_ROOM_ASSIGNED });
    expect((await stub.readMaintenanceTicketsList('all')).tickets).toHaveLength(0);
  });

  it('nested dispatch does not re-dispatch; depth-0 does; throws propagate', () => {
    let secondCalls = 0;
    const testRegistry = [
      {
        id: 'test.outer',
        subscribes: [{ event: 'outer.event', handler: 'outerHandler' }],
      },
      {
        id: 'test.inner',
        subscribes: [{ event: 'inner.event', handler: 'innerHandler' }],
      },
      {
        id: 'test.throw',
        subscribes: [{ event: 'throw.event', handler: 'thrower' }],
      },
    ] as unknown as ModuleManifest[];

    const depth = { n: 0 };
    const handlers: Record<string, ModuleEventHandler> = {
      outerHandler: (ctx, payload) => {
        dispatchModuleSubscribers({
          depth,
          eventType: 'inner.event',
          ctx,
          payload,
          handlers,
          registry: testRegistry,
        });
      },
      innerHandler: () => {
        secondCalls++;
      },
      thrower: () => {
        throw new Error('handler_boom');
      },
    };

    const ctx = {
      sql: { exec: () => ({ toArray: () => [] }) },
      appendOutbox: () => {},
      orgId: 'org_test',
      propertyId: 'prop_test',
    } satisfies ModuleTxnCtx;
    dispatchModuleSubscribers({
      depth,
      eventType: 'outer.event',
      ctx,
      payload: {},
      handlers,
      registry: testRegistry,
    });
    expect(secondCalls).toBe(0);

    dispatchModuleSubscribers({
      depth,
      eventType: 'inner.event',
      ctx,
      payload: {},
      handlers,
      registry: testRegistry,
    });
    expect(secondCalls).toBe(1);

    expect(() =>
      dispatchModuleSubscribers({
        depth,
        eventType: 'throw.event',
        ctx,
        payload: {},
        handlers,
        registry: testRegistry,
      }),
    ).toThrow('handler_boom');
  });

  describe('HTTP maintenance routes', () => {
    it('default list is active: open and in-progress, never closed; unknown status is 400', async () => {
      const owner = 'user_mnt_owner_active';
      const { p } = await provisionHotel(owner);
      const create = async (description: string) => {
        const ticketId = `tkt_${crypto.randomUUID()}`;
        const res = await call('POST', `${p}/maintenance/tickets`, owner, {
          ticketId,
          roomId: 'rm_1',
          description,
          category: 'other',
          priority: 'low',
          idempotencyKey: key(),
        });
        expect(res.status).toBe(201);
        return ticketId;
      };
      const patch = async (ticketId: string, body: Record<string, unknown>) => {
        const res = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
          ...body,
          idempotencyKey: key(),
        });
        expect(res.status).toBe(200);
      };
      const list = async (query: string) => {
        const res = await call('GET', `${p}/maintenance/tickets${query}`, owner);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { tickets: Array<{ ticketId: string }> };
        return data.tickets.map((t) => t.ticketId).sort();
      };

      const open = await create('Stays open');
      const started = await create('Gets started');
      const resolved = await create('Gets resolved');
      await patch(started, { status: 'in_progress' });
      await patch(resolved, { status: 'resolved' });

      expect(await list('')).toEqual([open, started].sort());
      expect(await list('?status=active')).toEqual([open, started].sort());
      expect(await list('?status=open')).toEqual([open]);
      expect(await list('?status=closed')).toEqual([resolved]);
      expect((await call('GET', `${p}/maintenance/tickets?status=nope`, owner)).status).toBe(400);
    });

    it('illegal transitions, terminal ticket_closed, cancel without note', async () => {
      const owner = 'user_mnt_owner1';
      const { p } = await provisionHotel(owner);
      const ticketId = `tkt_${crypto.randomUUID()}`;
      const createBody = {
        ticketId,
        roomId: 'rm_1',
        description: 'Broken lock',
        category: 'locks',
        priority: 'medium',
        idempotencyKey: key(),
      };
      expect((await call('POST', `${p}/maintenance/tickets`, owner, createBody)).status).toBe(201);

      const cancelNoNote = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
        status: 'cancelled',
        idempotencyKey: key(),
      });
      expect(cancelNoNote.status).toBe(422);
      expect(await cancelNoNote.json()).toMatchObject({ ok: false, error: VALIDATION_ERROR });

      expect(
        (
          await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
            status: 'in_progress',
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(200);

      const illegal = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
        status: 'open',
        idempotencyKey: key(),
      });
      expect(illegal.status).toBe(409);
      expect(await illegal.json()).toMatchObject({ ok: false, error: INVALID_TICKET_TRANSITION });

      expect(
        (
          await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
            status: 'resolved',
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(200);

      const closed = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
        priority: 'low',
        idempotencyKey: key(),
      });
      expect(closed.status).toBe(409);
      expect(await closed.json()).toMatchObject({ ok: false, error: TICKET_CLOSED });
    });

    it('task type checklist snapshot survives task type edit', async () => {
      const owner = 'user_mnt_owner2';
      const { p } = await provisionHotel(owner);
      const ttId = 'tt_leak';
      expect(
        (
          await call('POST', `${p}/maintenance/task-types`, owner, {
            taskTypeId: ttId,
            name: 'Leak',
            category: 'plumbing',
            defaultPriority: 'high',
            checklist: ['Check trap'],
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(201);
      const ticketId = `tkt_${crypto.randomUUID()}`;
      expect(
        (
          await call('POST', `${p}/maintenance/tickets`, owner, {
            ticketId,
            roomId: 'rm_1',
            description: 'Slow drain',
            taskTypeId: ttId,
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await call('PATCH', `${p}/maintenance/task-types/${ttId}`, owner, {
            name: 'Leak',
            category: 'plumbing',
            defaultPriority: 'high',
            checklist: ['Check trap', 'Replace washer'],
            active: true,
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(200);
      const list = await call('GET', `${p}/maintenance/tickets?status=all`, owner);
      const body = (await list.json()) as { tickets: Array<{ checklist: Array<{ label: string }> }> };
      expect(body.tickets[0]!.checklist.map((c) => c.label)).toEqual(['Check trap']);
    });

    it('assignee gate: housekeeper rejected; maintenance ok; null clears', async () => {
      const owner = 'user_mnt_owner3';
      const { orgId, p, propertyId } = await provisionHotel(owner);
      const org = testOrgStub(orgId);
      const ownerActor = { kind: 'user' as const, userId: owner };
      const hkOnly = await createHousekeeper(org, propertyId, 'HK Only', { kinds: ['housekeeper'] }, ownerActor);
      const maintOk = await createHousekeeper(org, propertyId, 'Maint OK', { kinds: ['maintenance'] }, ownerActor);

      const ticketId = `tkt_${crypto.randomUUID()}`;
      expect(
        (
          await call('POST', `${p}/maintenance/tickets`, owner, {
            ticketId,
            roomId: 'rm_1',
            description: 'Tap drip',
            category: 'other',
            priority: 'medium',
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(201);

      const badAssign = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
        assigneeRef: hkOnly.staffId,
        description: 'Tap drip updated',
        idempotencyKey: key(),
      });
      expect(badAssign.status).toBe(422);
      expect(await badAssign.json()).toMatchObject({ ok: false, error: STAFF_NOT_ASSIGNABLE });

      const getBefore = await call('GET', `${p}/maintenance/tickets?status=all`, owner);
      const before = (await getBefore.json()) as { tickets: Array<{ assigneeRef: string | null; description: string }> };
      expect(before.tickets[0]!.assigneeRef).toBeNull();
      expect(before.tickets[0]!.description).toBe('Tap drip');

      expect(
        (
          await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
            assigneeRef: maintOk.staffId,
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(200);

      expect(
        (
          await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
            assigneeRef: null,
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(200);
      const after = (await (await call('GET', `${p}/maintenance/tickets?status=all`, owner)).json()) as {
        tickets: Array<{ assigneeRef: string | null }>;
      };
      expect(after.tickets[0]!.assigneeRef).toBeNull();
    });

    it('assignee linked only to another hotel in the org is rejected', async () => {
      const owner = 'user_mnt_owner_other';
      const { orgId, p } = await provisionHotel(owner);
      const otherPropertyId = `prop_mnt_b_${crypto.randomUUID()}`;
      expect(
        (
          await call('POST', `/v1/orgs/${orgId}/properties`, owner, {
            propertyId: otherPropertyId,
            name: 'Other Hotel',
            timeZone: 'UTC',
            currency: 'USD',
          })
        ).status,
      ).toBe(201);
      const other = await createHousekeeper(
        testOrgStub(orgId),
        otherPropertyId,
        'Other Maint',
        { kinds: ['maintenance'] },
        { kind: 'user', userId: owner },
      );
      const ticketId = `tkt_${crypto.randomUUID()}`;
      const created = await call('POST', `${p}/maintenance/tickets`, owner, {
        ticketId,
        roomId: 'rm_1',
        description: 'Tap',
        category: 'other',
        priority: 'medium',
        idempotencyKey: key(),
      });
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({
        ok: true,
        ticket: { oooActive: false, oooStartDate: null },
      });
      const bad = await call('PATCH', `${p}/maintenance/tickets/${ticketId}`, owner, {
        assigneeRef: other.staffId,
        idempotencyKey: key(),
      });
      expect(bad.status).toBe(422);
      expect(await bad.json()).toMatchObject({ ok: false, error: STAFF_NOT_ASSIGNABLE });
      const list = (await (
        await call('GET', `${p}/maintenance/tickets?status=all`, owner)
      ).json()) as { tickets: Array<{ assigneeRef: string | null }> };
      expect(list.tickets[0]!.assigneeRef).toBeNull();
    });

    it('idempotent retry and key reuse', async () => {
      const owner = 'user_mnt_owner4';
      const { p } = await provisionHotel(owner);
      const ticketId = `tkt_${crypto.randomUUID()}`;
      const k = key();
      const body = {
        ticketId,
        roomId: 'rm_1',
        description: 'Light out',
        category: 'other',
        priority: 'medium',
        idempotencyKey: k,
      };
      const first = await call('POST', `${p}/maintenance/tickets`, owner, body);
      expect(first.status).toBe(201);
      const replay = await call('POST', `${p}/maintenance/tickets`, owner, body);
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(await first.json());
      const count = await call('GET', `${p}/maintenance/tickets?status=all`, owner);
      expect(((await count.json()) as { tickets: unknown[] }).tickets).toHaveLength(1);
      const reused = await call('POST', `${p}/maintenance/tickets`, owner, {
        ...body,
        description: 'Different',
      });
      expect(reused.status).toBe(409);
      expect(await reused.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
    });

    it('validation limits and wrong JSON types', async () => {
      const owner = 'user_mnt_owner5';
      const { p } = await provisionHotel(owner);
      const badType = await call('POST', `${p}/maintenance/tickets`, owner, {
        ticketId: 'tkt_bad',
        roomId: 'rm_1',
        description: 123,
        idempotencyKey: key(),
      });
      expect(badType.status).toBe(400);

      const longDesc = 'x'.repeat(2001);
      expect(
        (
          await call('POST', `${p}/maintenance/tickets`, owner, {
            ticketId: `tkt_${crypto.randomUUID()}`,
            roomId: 'rm_1',
            description: longDesc,
            category: 'other',
            priority: 'medium',
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(422);

      const bigChecklist = Array.from({ length: 21 }, (_, i) => `step ${i}`);
      expect(
        (
          await call('POST', `${p}/maintenance/task-types`, owner, {
            taskTypeId: 'tt_big',
            name: 'Big',
            category: 'other',
            defaultPriority: 'low',
            checklist: bigChecklist,
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(422);

      expect(
        (
          await call('POST', `${p}/maintenance/task-types`, owner, {
            taskTypeId: 'tt_name',
            name: 'n'.repeat(81),
            category: 'other',
            defaultPriority: 'low',
            checklist: [],
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(422);

      for (let i = 0; i < 100; i++) {
        expect(
          (
            await call('POST', `${p}/maintenance/task-types`, owner, {
              taskTypeId: `tt_${i}`,
              name: `Type ${i}`,
              category: 'other',
              defaultPriority: 'low',
              checklist: [],
              idempotencyKey: key(),
            })
          ).status,
        ).toBe(201);
      }
      expect(
        (
          await call('POST', `${p}/maintenance/task-types`, owner, {
            taskTypeId: 'tt_101',
            name: 'One too many',
            category: 'other',
            defaultPriority: 'low',
            checklist: [],
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(422);
    });

    it('staff can POST tickets but not task types', async () => {
      const owner = 'user_mnt_owner6';
      const staff = 'user_mnt_staff6';
      const { orgId, p } = await provisionHotel(owner);
      await testOrgStub(orgId).ensureMember(staff, 'staff');
      expect((await call('GET', `${p}/maintenance/tickets`, staff)).status).toBe(200);
      expect(
        (
          await call('POST', `${p}/maintenance/tickets`, staff, {
            ticketId: `tkt_${crypto.randomUUID()}`,
            roomId: 'rm_1',
            description: 'Staff report',
            category: 'other',
            priority: 'medium',
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await call('POST', `${p}/maintenance/task-types`, staff, {
            taskTypeId: 'tt_denied',
            name: 'Denied',
            category: 'other',
            defaultPriority: 'low',
            checklist: [],
            idempotencyKey: key(),
          })
        ).status,
      ).toBe(403);
    });
  });
});
