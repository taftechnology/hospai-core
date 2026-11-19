import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_PLAN_PROTECTED,
  IDEM_KEY_REUSED,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  RATE_PLAN_NOT_FOUND,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

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
        name: 'Rates Hotel',
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
  const orgId = `org_rates_${crypto.randomUUID()}`;
  const propertyId = `prop_rates_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Rates Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function postRatePlan(
  propertyId: string,
  actor: string,
  body: { ratePlanId: string; code: string; name: string; idempotencyKey?: string },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        ...body,
        idempotencyKey: body.idempotencyKey ?? `idem-plan-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function patchRatePlan(
  propertyId: string,
  actor: string,
  ratePlanId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function deleteRatePlan(propertyId: string, actor: string, ratePlanId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function getRatePlans(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function putRateDays(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

async function putRoomTypeRate(
  propertyId: string,
  actor: string,
  roomTypeId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types/${encodeURIComponent(roomTypeId)}/rates`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

async function postRatesBulk(
  propertyId: string,
  actor: string,
  body: {
    updates: Array<{
      roomTypeId: string;
      ratePlanId?: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
    }>;
    idempotencyKey: string;
  },
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rates/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('rate plans HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: fresh property seeds BAR rate plan', async () => {
    const actor = 'user_rates_1';
    const { propertyId } = await provisionHotel(actor);
    const res = await getRatePlans(propertyId, actor);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plans: Array<{
        ratePlanId: string;
        code: string;
        status: string;
        cancelPenaltyType?: string;
        cancelGraceHours?: number;
        cancelPenaltyNights?: number | null;
        cancelPenaltyBps?: number | null;
        cancelPolicyText?: string | null;
      }>;
    };
    expect(body.plans.some((p) => p.ratePlanId === DEFAULT_RATE_PLAN_ID && p.status === 'active')).toBe(
      true,
    );
    const bar = body.plans.find((p) => p.ratePlanId === DEFAULT_RATE_PLAN_ID);
    expect(bar).toMatchObject({
      cancelPenaltyType: 'none',
      cancelGraceHours: 0,
    });
    expect('cancelPenaltyNights' in (bar ?? {})).toBe(true);
    expect('cancelPenaltyBps' in (bar ?? {})).toBe(true);
    expect('cancelPolicyText' in (bar ?? {})).toBe(true);
  });

  it('2: POST /rate-plans creates active plan + rate_plan.changed', async () => {
    const actor = 'user_rates_2';
    const { propertyId, stub } = await provisionHotel(actor);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORP',
      name: 'Corporate',
    });
    expect(res.status).toBe(201);
    expect(await stub.listOutboxEventTypes()).toContain('rate_plan.changed');
  });

  it('3: POST /rate-plans duplicate active code → 422', async () => {
    const actor = 'user_rates_3';
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postRatePlan(propertyId, actor, { ratePlanId: 'A', code: 'CORP', name: 'A' })).status,
    ).toBe(201);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'B',
      code: 'CORP',
      name: 'B',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: RATE_PLAN_CODE_EXISTS });
  });

  it('4: PATCH /rate-plans/:id renames name', async () => {
    const actor = 'user_rates_4';
    const { propertyId, stub } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    await stub.flushOutbox();
    const res = await patchRatePlan(propertyId, actor, 'CORP', {
      name: 'Corporate Rate',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
    expect(await stub.listOutboxEventTypes()).toContain('rate_plan.changed');
  });

  it('5: PATCH BAR code away from BAR → 422 protected', async () => {
    const actor = 'user_rates_5';
    const { propertyId } = await provisionHotel(actor);
    const res = await patchRatePlan(propertyId, actor, DEFAULT_RATE_PLAN_ID, {
      code: 'NOTBAR',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DEFAULT_RATE_PLAN_PROTECTED });
  });

  it('6: DELETE non-BAR archives; code reusable', async () => {
    const actor = 'user_rates_6';
    const { propertyId } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    expect((await deleteRatePlan(propertyId, actor, 'CORP')).status).toBe(200);
    const listed = (await (await getRatePlans(propertyId, actor)).json()) as {
      plans: Array<{ ratePlanId: string }>;
    };
    expect(listed.plans.map((p) => p.ratePlanId)).not.toContain('CORP');
    expect(
      (await postRatePlan(propertyId, actor, { ratePlanId: 'CORP2', code: 'CORP', name: 'Corp2' }))
        .status,
    ).toBe(201);
  });

  it('7: DELETE BAR → 422 default_rate_plan_protected', async () => {
    const actor = 'user_rates_7';
    const { propertyId } = await provisionHotel(actor);
    const res = await deleteRatePlan(propertyId, actor, DEFAULT_RATE_PLAN_ID);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DEFAULT_RATE_PLAN_PROTECTED });
  });

  it('8: PUT rate-days with unknown CORP plan is 404', async () => {
    const actor = 'user_rates_8';
    const { propertyId } = await provisionHotel(actor);
    const res = await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      ratePlanId: 'CORP',
      stayDate: '2026-08-10',
      amountMinor: 10000,
      currency: 'USD',
      idempotencyKey: `idem-corp-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ ok: false, error: RATE_PLAN_NOT_FOUND });
  });

  it('9: CORP plan then rate-days under CORP; quoteStay default still BAR', async () => {
    const actor = 'user_rates_9';
    const { propertyId, stub } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: 'CORP',
          stayDate: '2026-08-10',
          amountMinor: 20000,
          currency: 'USD',
          idempotencyKey: `idem-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      stayDate: '2026-08-10',
      amountMinor: 10000,
      currency: 'USD',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    const quote = await stub.quoteStay({
      roomTypeId: 'rt_king',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-11',
    });
    expect(quote).toEqual({ ok: true, totalMinor: 10000, currency: 'USD', inclusionsMinor: 0 });
  });

  it('10: PUT rate-days omitting ratePlanId defaults to BAR', async () => {
    const actor = 'user_rates_10';
    const { propertyId } = await provisionHotel(actor);
    const res = await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      stayDate: '2026-08-10',
      amountMinor: 10000,
      currency: 'USD',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
  });

  it('11: alias route emits rate.changed not rate_plan.changed', async () => {
    const actor = 'user_rates_11';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.flushOutbox();
    const before = await stub.listOutboxEventTypes();
    const res = await putRoomTypeRate(propertyId, actor, 'rt_king', {
      stayDate: '2026-08-10',
      amountMinor: 12000,
      currency: 'USD',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
    const events = await stub.listOutboxEventTypes();
    const newEvents = events.slice(before.length);
    expect(newEvents).toContain('rate.changed');
    expect(newEvents).not.toContain('rate_plan.changed');
  });

  it('11a: alias and rate-days share fingerprint for omitted vs BAR (same key)', async () => {
    const actor = 'user_rates_11a';
    const { propertyId } = await provisionHotel(actor);
    // CRITICAL: one key string for both requests. Fresh keys make this pass vacuously.
    const sharedKey = `idem-norm-${crypto.randomUUID()}`;
    const stayDate = '2026-08-10';
    const base = {
      stayDate,
      amountMinor: 15000,
      currency: 'USD',
      idempotencyKey: sharedKey,
    };

    const first = await putRateDays(propertyId, actor, { roomTypeId: 'rt_king', ...base });
    expect(first.status).toBe(200);

    const second = await putRoomTypeRate(propertyId, actor, 'rt_king', {
      ...base,
      ratePlanId: DEFAULT_RATE_PLAN_ID,
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).not.toMatchObject({ error: IDEM_KEY_REUSED });
    expect(body).toMatchObject({ ok: true });
  });

  it('12: archived CORP rejects rate-days; rows remain', async () => {
    const actor = 'user_rates_12';
    const { propertyId, stub } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      ratePlanId: 'CORP',
      stayDate: '2026-08-10',
      amountMinor: 10000,
      currency: 'USD',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    await deleteRatePlan(propertyId, actor, 'CORP');
    const res = await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      ratePlanId: 'CORP',
      stayDate: '2026-08-11',
      amountMinor: 11000,
      currency: 'USD',
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    const quote = await stub.quoteStay({
      roomTypeId: 'rt_king',
      ratePlanId: 'CORP',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-11',
    });
    expect(quote).toEqual({ ok: true, totalMinor: 10000, currency: 'USD', inclusionsMinor: 0 });
  });

  it('13: bulk two valid cells', async () => {
    const actor = 'user_rates_13';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.flushOutbox();
    const before = (await stub.listOutboxEventTypes()).filter((t) => t === 'rate.changed').length;
    const res = await postRatesBulk(propertyId, actor, {
      updates: [
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-10',
          amountMinor: 10000,
          currency: 'USD',
        },
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-11',
          amountMinor: 11000,
          currency: 'USD',
        },
      ],
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(200);
    const after = (await stub.listOutboxEventTypes()).filter((t) => t === 'rate.changed').length;
    expect(after - before).toBe(2);
  });

  it('13a: bulk omit vs explicit BAR is idempotent under one key', async () => {
    const actor = 'user_rates_13a';
    const { propertyId } = await provisionHotel(actor);
    const sharedKey = `idem-bulk-norm-${crypto.randomUUID()}`;
    const cellOmit = {
      roomTypeId: 'rt_king',
      stayDate: '2026-08-11',
      amountMinor: 11000,
      currency: 'USD',
    };
    const cellBar = { ...cellOmit, ratePlanId: DEFAULT_RATE_PLAN_ID };

    const first = await postRatesBulk(propertyId, actor, {
      updates: [cellOmit],
      idempotencyKey: sharedKey,
    });
    expect(first.status).toBe(200);
    const second = await postRatesBulk(propertyId, actor, {
      updates: [cellBar],
      idempotencyKey: sharedKey,
    });
    expect(second.status).toBe(200);
    expect(await second.json()).not.toMatchObject({ error: IDEM_KEY_REUSED });
  });

  it('14: bulk aborts when one plan unknown', async () => {
    const actor = 'user_rates_14';
    const { propertyId, stub } = await provisionHotel(actor);
    const res = await postRatesBulk(propertyId, actor, {
      updates: [
        {
          roomTypeId: 'rt_king',
          stayDate: '2026-08-10',
          amountMinor: 10000,
          currency: 'USD',
        },
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'NOPE',
          stayDate: '2026-08-11',
          amountMinor: 11000,
          currency: 'USD',
        },
      ],
      idempotencyKey: `idem-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(404);
    const quote = await stub.quoteStay({
      roomTypeId: 'rt_king',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-11',
    });
    expect(quote.ok).toBe(false);
  });

  it('15/16: orphan rate_day adopted by create-with-matching-id', async () => {
    const actor = 'user_rates_16';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.seedOrphanRateDayForTest({
      roomTypeId: 'rt_king',
      ratePlanId: 'ORPHAN',
      stayDate: '2026-08-10',
      amountMinor: 9999,
      currency: 'USD',
    });
    const defaultQuote = await stub.quoteStay({
      roomTypeId: 'rt_king',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-11',
    });
    expect(defaultQuote.ok).toBe(false); // no BAR row
    const orphanQuote = await stub.quoteStay({
      roomTypeId: 'rt_king',
      ratePlanId: 'ORPHAN',
      arrivalDate: '2026-08-10',
      departureDate: '2026-08-11',
    });
    expect(orphanQuote).toEqual({ ok: true, totalMinor: 9999, currency: 'USD', inclusionsMinor: 0 });

    expect(
      (await postRatePlan(propertyId, actor, { ratePlanId: 'ORPHAN', code: 'ORPH', name: 'Orphan' }))
        .status,
    ).toBe(201);
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: 'ORPHAN',
          stayDate: '2026-08-11',
          amountMinor: 8888,
          currency: 'USD',
          idempotencyKey: `idem-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
  });

  it('16a: create with existing active ratePlanId → 422', async () => {
    const actor = 'user_rates_16a';
    const { propertyId } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORPX',
      name: 'Again',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: RATE_PLAN_ID_EXISTS });
  });

  it('16b: create with archived ratePlanId does not un-archive', async () => {
    const actor = 'user_rates_16b';
    const { propertyId } = await provisionHotel(actor);
    await postRatePlan(propertyId, actor, { ratePlanId: 'CORP', code: 'CORP', name: 'Corp' });
    await deleteRatePlan(propertyId, actor, 'CORP');
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORP2',
      name: 'Corp Again',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: RATE_PLAN_ID_EXISTS });
    const listed = (await (await getRatePlans(propertyId, actor)).json()) as {
      plans: Array<{ ratePlanId: string }>;
    };
    expect(listed.plans.map((p) => p.ratePlanId)).not.toContain('CORP');
  });

  it('17/18: staff forbidden on write, allowed on GET', async () => {
    const owner = 'user_rates_owner_staff';
    const staff = 'user_rates_staff';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const write = await postRatePlan(propertyId, staff, {
      ratePlanId: 'CORP',
      code: 'CORP',
      name: 'Corp',
    });
    expect(write.status).toBe(403);

    const read = await getRatePlans(propertyId, staff);
    expect(read.status).toBe(200);
  });

  it('19: non-member → 404', async () => {
    const owner = 'user_rates_owner_nm';
    const stranger = 'user_rates_stranger';
    const { propertyId } = await provisionHotel(owner);
    const res = await getRatePlans(propertyId, stranger);
    expect(res.status).toBe(404);
  });

  it('20: kill-switch on plan routes → 503', async () => {
    const actor = 'user_rates_20';
    const { propertyId } = await provisionHotel(actor);
    await setKillSwitch(env, 'pms.core', true);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORP',
      name: 'Corp',
    });
    expect(res.status).toBe(503);
  });

  it('21: unentitled org → 402', async () => {
    const actor = 'user_rates_21';
    const { orgId, propertyId } = await provisionHotel(actor);
    await cancelSubscription(env, orgId);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORP',
      name: 'Corp',
    });
    expect(res.status).toBe(402);
  });

  it('26: POST /rate-plans while blocked → FAIL_CLOSED 503, not queued', async () => {
    const actor = 'user_rates_26';
    const { propertyId, stub } = await provisionHotel(actor);
    await stub.setTransportBlockedForTest(true);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'CORP',
      code: 'CORP',
      name: 'Corp',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { degraded?: string; commandId?: string };
    expect(body.degraded).toBe('FAIL_CLOSED');
    expect(body.commandId).toBe('rates.create_plan');
    await stub.setTransportBlockedForTest(false);
  });
});
