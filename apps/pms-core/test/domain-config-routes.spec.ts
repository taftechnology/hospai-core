import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDEM_KEY_REUSED } from '@hospai/contracts';
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
        name: 'Config Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_cfg_${crypto.randomUUID()}`;
  const propertyId = `prop_cfg_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Config Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  return { orgId, propertyId, actor, stub: resolved!.stub };
}

async function putDomainConfig(
  propertyId: string,
  actor: string,
  body: {
    key: string;
    value: unknown;
    reason: string;
    idempotencyKey: string;
    effectiveFrom?: string;
    actor?: string;
  },
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

describe('domain config HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('1: PUT pms.time.time_zone succeeds and reschedules night audit', async () => {
    const owner = 'user_cfg_owner_1';
    const { propertyId, stub } = await provisionHotel(owner);
    const before = await stub.getAlarmSchedule('night-audit');

    const res = await putDomainConfig(propertyId, owner, {
      key: 'pms.time.time_zone',
      value: 'America/Chicago',
      reason: 'ops:tz',
      idempotencyKey: 'idem-cfg-tz',
    });
    expect(res.status).toBe(200);
    expect(await stub.readConfig('pms.time.time_zone')).toBe('America/Chicago');

    const after = await stub.getAlarmSchedule('night-audit');
    expect(after!.nextRunAt).not.toBe(before!.nextRunAt);
  });

  it('2: PUT overbooking as owner succeeds', async () => {
    const owner = 'user_cfg_owner_2';
    const { propertyId, stub } = await provisionHotel(owner);

    const res = await putDomainConfig(propertyId, owner, {
      key: 'pms.availability.allow_overbooking',
      value: true,
      reason: 'ops:overbook',
      idempotencyKey: 'idem-cfg-overbook',
    });
    expect(res.status).toBe(200);
    expect(await stub.readConfig('pms.availability.allow_overbooking')).toBe(true);
  });

  it('3: undeclared / non-DOMAIN keys map to client errors', async () => {
    const owner = 'user_cfg_owner_3';
    const { propertyId } = await provisionHotel(owner);

    const undeclared = await putDomainConfig(propertyId, owner, {
      key: 'pms.unknown.key',
      value: true,
      reason: 'ops',
      idempotencyKey: 'idem-cfg-undeclared',
    });
    expect(undeclared.status).toBe(400);

    const nonDomain = await putDomainConfig(propertyId, owner, {
      key: 'pms.ui.date_format',
      value: 'ISO',
      reason: 'ops',
      idempotencyKey: 'idem-cfg-nondomain',
    });
    expect(nonDomain.status).toBe(400);
  });

  it('4: spoof body actor does not win audit (M2)', async () => {
    const owner = 'user_cfg_owner_4';
    const { propertyId, stub } = await provisionHotel(owner);

    const res = await putDomainConfig(propertyId, owner, {
      key: 'pms.availability.allow_overbooking',
      value: false,
      reason: 'ops:spoof',
      idempotencyKey: 'idem-cfg-spoof',
      actor: 'user_imposter',
    });
    expect(res.status).toBe(200);

    const payloads = await stub.listOutboxPayloads();
    const changed = payloads
      .filter((p) => p.eventType === 'config.changed')
      .map((p) => ({ eventType: p.eventType, payload: JSON.parse(p.payload) as { key: string; actor: string } }))
      .find((p) => p.payload.key === 'pms.availability.allow_overbooking');
    expect(changed).toBeDefined();
    expect(changed!.payload.actor).toBe(owner);
    expect(changed!.payload.actor).not.toBe('user_imposter');
  });

  it('5: staff forbidden at edge', async () => {
    const owner = 'user_cfg_owner_5';
    const staff = 'user_cfg_staff_5';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    const res = await putDomainConfig(propertyId, staff, {
      key: 'pms.time.time_zone',
      value: 'Europe/Berlin',
      reason: 'ops:staff',
      idempotencyKey: 'idem-cfg-staff',
    });
    expect(res.status).toBe(403);
  });

  it('6: kill-switch / unentitled returns 503 / 402', async () => {
    const owner = 'user_cfg_owner_6';
    const { orgId, propertyId } = await provisionHotel(owner);
    await setKillSwitch(env, 'pms.core', true);

    const killed = await putDomainConfig(propertyId, owner, {
      key: 'pms.time.time_zone',
      value: 'Europe/Paris',
      reason: 'ops:kill',
      idempotencyKey: 'idem-cfg-kill',
    });
    expect(killed.status).toBe(503);

    await setKillSwitch(env, 'pms.core', false);
    await cancelSubscription(env, orgId);

    const unentitled = await putDomainConfig(propertyId, owner, {
      key: 'pms.time.time_zone',
      value: 'Europe/Rome',
      reason: 'ops:unentitled',
      idempotencyKey: 'idem-cfg-unentitled',
    });
    expect(unentitled.status).toBe(402);
  });

  it('7: replay returns identical response without double-write', async () => {
    const owner = 'user_cfg_owner_7';
    const { propertyId, stub } = await provisionHotel(owner);
    const countOversellEvents = async () =>
      (await stub.listOutboxPayloads())
        .filter((p) => p.eventType === 'config.changed')
        .map((p) => JSON.parse(p.payload) as { key: string })
        .filter((p) => p.key === 'pms.availability.oversell_allowance').length;

    const before = await countOversellEvents();
    const req = {
      key: 'pms.availability.oversell_allowance',
      value: 2,
      reason: 'ops:replay',
      idempotencyKey: 'idem-cfg-replay',
    };

    const first = await putDomainConfig(propertyId, owner, req);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { ok: true; version: number };
    const version1 = firstBody.version;

    const second = await putDomainConfig(propertyId, owner, req);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { ok: true; version: number };
    expect(secondBody.version).toBe(version1);

    expect(await countOversellEvents()).toBe(before + 1);
  });

  it('fingerprint conflict returns idempotency_key_reused', async () => {
    const owner = 'user_cfg_owner_conflict';
    const { propertyId } = await provisionHotel(owner);
    const key = 'idem-cfg-conflict';
    expect(
      (
        await putDomainConfig(propertyId, owner, {
          key: 'pms.availability.allow_overbooking',
          value: true,
          reason: 'ops:a',
          idempotencyKey: key,
        })
      ).status,
    ).toBe(200);
    const conflict = await putDomainConfig(propertyId, owner, {
      key: 'pms.availability.allow_overbooking',
      value: false,
      reason: 'ops:b',
      idempotencyKey: key,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('PUT pms.ops.auto_assign_rooms succeeds after DOMAIN reclass', async () => {
    const owner = 'user_cfg_auto_assign';
    const { propertyId, stub } = await provisionHotel(owner);
    const res = await putDomainConfig(propertyId, owner, {
      key: 'pms.ops.auto_assign_rooms',
      value: false,
      reason: 'ops:explicit-assign',
      idempotencyKey: 'idem-cfg-auto-assign',
    });
    expect(res.status).toBe(200);
    expect(await stub.readConfig('pms.ops.auto_assign_rooms')).toBe(false);
  });
});
