import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_CODE_REMOVED,
  CONFIG_KEY_NOT_WRITABLE,
  IDEM_KEY_REUSED,
  LIMIT_EXCEEDED,
  VALIDATION_ERROR,
} from '@hospai/contracts';
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

async function postProperty(orgId: string, propertyId: string, actor: string, name = 'OpCfg Hotel') {
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

async function provisionHotel(actor: string, propertyId?: string) {
  const orgId = `org_opcfg_${crypto.randomUUID()}`;
  const pid = propertyId ?? `prop_opcfg_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'OpCfg Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, pid, actor)).status).toBe(201);
  return { orgId, propertyId: pid, actor };
}

async function getOperationalConfig(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/operational-config`, {
      method: 'GET',
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function putOperationalConfig(
  propertyId: string,
  key: string,
  actor: string,
  body: { value: unknown; reason: string; idempotencyKey: string },
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/operational-config/${encodeURIComponent(key)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify(body),
      },
    ),
    env,
  );
}

const sampleSource = [{ code: 'WALKIN', name: 'Walk-in', status: 'active' as const }];

describe('operational config HTTP routes', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('default read returns register defaults for both keys', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_default');
    const res = await getOperationalConfig(propertyId, actor);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      items: Array<{ key: string; version: number; source: string; value: unknown[] }>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items.every((i) => i.source === 'default' && i.version === 0)).toBe(true);
    expect(body.items.every((i) => Array.isArray(i.value) && i.value.length === 0)).toBe(true);
  });

  it('put sources then read back with version 1 then 2', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_put');
    const key = 'pms.property.sources';

    const first = await putOperationalConfig(propertyId, key, actor, {
      value: sampleSource,
      reason: 'ops:seed',
      idempotencyKey: 'idem-opcfg-1',
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, version: 1 });

    const second = await putOperationalConfig(propertyId, key, actor, {
      value: [...sampleSource, { code: 'PHONE', name: 'Phone', status: 'active' }],
      reason: 'ops:add-phone',
      idempotencyKey: 'idem-opcfg-2',
    });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ ok: true, version: 2 });

    const read = await getOperationalConfig(propertyId, actor);
    const items = ((await read.json()) as { items: Array<{ key: string; version: number; source: string }> }).items;
    const sources = items.find((i) => i.key === key)!;
    expect(sources.version).toBe(2);
    expect(sources.source).toBe('stored');
  });

  it('emits config.operational_changed without values in payload', async () => {
    const { orgId, propertyId, actor } = await provisionHotel('user_opcfg_evt');
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await putOperationalConfig(propertyId, 'pms.property.sources', actor, {
      value: sampleSource,
      reason: 'ops:event',
      idempotencyKey: 'idem-opcfg-evt',
    });
    const payloads = await org.listOutboxPayloads();
    const evt = payloads.find((p) => p.eventType === 'config.operational_changed');
    expect(evt).toBeDefined();
    const parsed = JSON.parse(evt!.payload) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      orgId,
      propertyId,
      key: 'pms.property.sources',
      version: 1,
    });
    expect(parsed).not.toHaveProperty('value');
    expect(Object.keys(parsed)).not.toContain('value_json');
  });

  it('removing a stored code returns config_code_removed', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_rm');
    const key = 'pms.property.sources';
    expect(
      (
        await putOperationalConfig(propertyId, key, actor, {
          value: sampleSource,
          reason: 'ops:seed',
          idempotencyKey: 'idem-opcfg-rm-1',
        })
      ).status,
    ).toBe(200);
    const removed = await putOperationalConfig(propertyId, key, actor, {
      value: [],
      reason: 'ops:bad-remove',
      idempotencyKey: 'idem-opcfg-rm-2',
    });
    expect(removed.status).toBe(422);
    expect(await removed.json()).toMatchObject({ ok: false, error: CONFIG_CODE_REMOVED });
  });

  it('51 entries returns limit_exceeded', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_lim');
    const value = Array.from({ length: 51 }, (_, i) => ({
      code: `C${String(i).padStart(2, '0')}`,
      name: `Name ${i}`,
      status: 'active' as const,
    }));
    const res = await putOperationalConfig(propertyId, 'pms.property.sources', actor, {
      value,
      reason: 'ops:too-many',
      idempotencyKey: 'idem-opcfg-51',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: LIMIT_EXCEEDED });
  });

  it('bad code format returns validation_error', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_fmt');
    const res = await putOperationalConfig(propertyId, 'pms.property.sources', actor, {
      value: [{ code: 'bad-code', name: 'Bad', status: 'active' }],
      reason: 'ops:fmt',
      idempotencyKey: 'idem-opcfg-fmt',
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: VALIDATION_ERROR });
  });

  it('non-allowlisted OPERATIONAL and DOMAIN keys return config_key_not_writable', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_key');
    const ops = await putOperationalConfig(propertyId, 'pms.ops.tags', actor, {
      value: [],
      reason: 'ops:tags',
      idempotencyKey: 'idem-opcfg-tags',
    });
    expect(ops.status).toBe(400);
    expect(await ops.json()).toMatchObject({ ok: false, error: CONFIG_KEY_NOT_WRITABLE });

    const domain = await putOperationalConfig(propertyId, 'pms.time.time_zone', actor, {
      value: 'UTC',
      reason: 'ops:tz',
      idempotencyKey: 'idem-opcfg-tz',
    });
    expect(domain.status).toBe(400);
    expect(await domain.json()).toMatchObject({ ok: false, error: CONFIG_KEY_NOT_WRITABLE });
  });

  it('staff can GET but cannot PUT', async () => {
    const owner = 'user_opcfg_owner_staff';
    const staff = 'user_opcfg_staff';
    const { orgId, propertyId } = await provisionHotel(owner);
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await org.ensureMember(staff, 'staff');

    expect((await getOperationalConfig(propertyId, staff)).status).toBe(200);

    const denied = await putOperationalConfig(propertyId, 'pms.property.sources', staff, {
      value: sampleSource,
      reason: 'ops:staff',
      idempotencyKey: 'idem-opcfg-staff',
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'forbidden', permission: 'settings:configure' });
  });

  it('idempotent replay and fingerprint conflict', async () => {
    const { propertyId, actor } = await provisionHotel('user_opcfg_idem');
    const req = {
      value: sampleSource,
      reason: 'ops:replay',
      idempotencyKey: 'idem-opcfg-replay',
    };
    const first = await putOperationalConfig(propertyId, 'pms.property.sources', actor, req);
    expect(first.status).toBe(200);
    const v1 = ((await first.json()) as { version: number }).version;

    const second = await putOperationalConfig(propertyId, 'pms.property.sources', actor, req);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { version: number }).version).toBe(v1);

    const conflict = await putOperationalConfig(propertyId, 'pms.property.sources', actor, {
      value: [{ code: 'OTHER', name: 'Other', status: 'active' }],
      reason: 'ops:conflict',
      idempotencyKey: 'idem-opcfg-replay',
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ ok: false, error: IDEM_KEY_REUSED });
  });

  it('kill-switch 503 and unentitled 402', async () => {
    const owner = 'user_opcfg_kill';
    const { orgId, propertyId } = await provisionHotel(owner);
    await setKillSwitch(env, 'pms.core', true);
    expect(
      (
        await putOperationalConfig(propertyId, 'pms.property.sources', owner, {
          value: sampleSource,
          reason: 'ops:kill',
          idempotencyKey: 'idem-opcfg-kill',
        })
      ).status,
    ).toBe(503);

    await setKillSwitch(env, 'pms.core', false);
    await cancelSubscription(env, orgId);
    expect(
      (
        await putOperationalConfig(propertyId, 'pms.property.sources', owner, {
          value: sampleSource,
          reason: 'ops:unentitled',
          idempotencyKey: 'idem-opcfg-unentitled',
        })
      ).status,
    ).toBe(402);
  });

  it('two properties in one org keep separate lists', async () => {
    const owner = 'user_opcfg_two_prop';
    const orgId = `org_opcfg_two_${crypto.randomUUID()}`;
    const propertyA = `prop_opcfg_a_${crypto.randomUUID()}`;
    const propertyB = `prop_opcfg_b_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, 'Two Prop Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyA, owner, 'Hotel A')).status).toBe(201);
    expect((await postProperty(orgId, propertyB, owner, 'Hotel B')).status).toBe(201);

    expect(
      (
        await putOperationalConfig(propertyA, 'pms.property.sources', owner, {
          value: sampleSource,
          reason: 'ops:a',
          idempotencyKey: 'idem-opcfg-a',
        })
      ).status,
    ).toBe(200);

    const readB = await getOperationalConfig(propertyB, owner);
    const itemsB = ((await readB.json()) as { items: Array<{ key: string; source: string }> }).items;
    const sourcesB = itemsB.find((i) => i.key === 'pms.property.sources')!;
    expect(sourcesB.source).toBe('default');
  });

  it('foreign org member cannot read another org property operational config', async () => {
    const ownerA = 'user_opcfg_org_a';
    const ownerB = 'user_opcfg_org_b';
    const { propertyId: propA } = await provisionHotel(ownerA);
    await provisionHotel(ownerB);

    const denied = await getOperationalConfig(propA, ownerB);
    expect(denied.status).toBe(404);
  });

  it('purge clears operational_config rows', async () => {
    const { orgId, propertyId, actor } = await provisionHotel('user_opcfg_purge');
    expect(
      (
        await putOperationalConfig(propertyId, 'pms.property.sources', actor, {
          value: sampleSource,
          reason: 'ops:purge',
          idempotencyKey: 'idem-opcfg-purge',
        })
      ).status,
    ).toBe(200);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const storedBefore = (await org.listOperationalConfig(propertyId)) as {
      ok: true;
      items: Array<{ key: string; source: string }>;
    };
    expect(storedBefore.items.find((i) => i.key === 'pms.property.sources')!.source).toBe('stored');

    await org.resetLaneGuardForTest({ quietMs: 60_000 });
    expect((await org.purgeStorageForTenant()).ok).toBe(true);

    expect(await org.countNonBookkeepingRows()).toBe(0);
  });
});
