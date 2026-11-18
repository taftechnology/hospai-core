import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMIT_EXCEEDED, type PlanCode } from '@hospai/contracts';
import { PLATFORM_ENTITLEMENT_CATALOG_STATEMENTS } from '@hospai/do-runtime';
import { loadSnapshot } from '@hospai/entitlement-client';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index';
import type { OrgDO } from '../src/org-do';
import { provisionProperty } from '../src/provision';
import {
  ensurePlatformSchema,
  getProperty,
  resetPlatformSchemaGate,
  seedSubscription,
} from '../src/registry';

const UNLIMITED = Number.MAX_SAFE_INTEGER;

type FeatureMap = Record<string, boolean | number | string>;
type LimitMap = Record<string, { limit: number; used: number; behavior: 'hard' | 'soft' | 'grace' }>;

function hard(limit: number | 'unlimited') {
  return { limit: limit === 'unlimited' ? UNLIMITED : limit, used: 0, behavior: 'hard' as const };
}

const PLAN_COLUMNS: Record<PlanCode, { features: FeatureMap; limits: LimitMap }> = {
  starter: {
    features: {
      'pms.core': true,
      'pms.properties.limit': 1,
      'pms.units.limit': 40,
      'pms.housekeeping': true,
      'payments.enabled': 'required',
      'booking_engine.enabled': true,
      'channel_manager.enabled': true,
      'channel_manager.connections.limit': 3,
      'agentic_distribution.enabled': true,
      'mcp.enabled': true,
      'mcp.clients.limit': 1,
      'compliance.fiscalization': true,
      'accounting_export.enabled': true,
    },
    limits: {
      'pms.properties.limit': hard(1),
      'pms.units.limit': hard(40),
      'channel_manager.connections.limit': hard(3),
      'mcp.clients.limit': hard(1),
    },
  },
  growth: {
    features: {
      'pms.core': true,
      'pms.properties.limit': 1,
      'pms.units.limit': 400,
      'pms.housekeeping': true,
      'payments.enabled': 'enabled',
      'booking_engine.enabled': true,
      'booking_engine.custom_domain': true,
      'channel_manager.enabled': true,
      'channel_manager.connections.limit': 15,
      'agentic_distribution.enabled': true,
      'mcp.enabled': true,
      'mcp.clients.limit': 5,
      'api.public_access': true,
      'compliance.fiscalization': true,
      'accounting_export.enabled': true,
    },
    limits: {
      'pms.properties.limit': hard(1),
      'pms.units.limit': hard(400),
      'channel_manager.connections.limit': hard(15),
      'mcp.clients.limit': hard(5),
    },
  },
  group: {
    features: {
      'pms.core': true,
      'pms.properties.limit': 10,
      'pms.units.limit': 'unlimited',
      'pms.multi_property': true,
      'pms.housekeeping': true,
      'payments.enabled': 'enabled',
      'booking_engine.enabled': true,
      'booking_engine.custom_domain': true,
      'channel_manager.enabled': true,
      'channel_manager.connections.limit': 'unlimited',
      'agentic_distribution.enabled': true,
      'mcp.enabled': true,
      'mcp.clients.limit': 'unlimited',
      'api.public_access': true,
      'sso.saml': true,
      'compliance.fiscalization': true,
      'accounting_export.enabled': true,
    },
    limits: {
      'pms.properties.limit': hard(10),
      'pms.units.limit': hard('unlimited'),
      'channel_manager.connections.limit': hard('unlimited'),
      'mcp.clients.limit': hard('unlimited'),
    },
  },
};

async function entitlementVersion(orgId: string): Promise<number> {
  const row = await env.PLATFORM_DB.prepare(
    `SELECT entitlement_version FROM subscription WHERE org_id = ?`,
  )
    .bind(orgId)
    .first<{ entitlement_version: number }>();
  return row?.entitlement_version ?? 0;
}

async function insertAddon(orgId: string, addonCode: string, quantity: number): Promise<void> {
  await env.PLATFORM_DB.prepare(
    `INSERT INTO subscription_addon (org_id, addon_code, quantity) VALUES (?, ?, ?)`,
  )
    .bind(orgId, addonCode, quantity)
    .run();
}

function provisionInput(orgId: string, propertyId: string, jurisdiction: 'eu' | null = null) {
  return {
    orgId,
    propertyId,
    name: 'Catalog Hotel',
    jurisdiction,
    timeZone: 'UTC',
    currency: 'USD',
    actorUserId: 'user_catalog',
  };
}

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'Catalog Org' }),
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
        name: 'Catalog Hotel',
        jurisdiction: null,
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

describe('entitlement catalog', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  describe('plan columns', () => {
    it.each(['starter', 'growth', 'group'] as const)('%s resolves to its §6.7 column', async (plan) => {
      const orgId = `org_cat_${plan}_${crypto.randomUUID()}`;
      await seedSubscription(env, orgId, plan);
      const snap = await loadSnapshot(env, orgId);
      expect(snap.features).toEqual(PLAN_COLUMNS[plan].features);
      expect(snap.limits).toEqual(PLAN_COLUMNS[plan].limits);
    });
  });

  it('migration updates a database still holding the Phase 0 20 / 100 unit caps', async () => {
    await env.PLATFORM_DB.prepare(
      `UPDATE plan_feature SET value = '20' WHERE plan_code = 'starter' AND feature_key = 'pms.units.limit'`,
    ).run();
    await env.PLATFORM_DB.prepare(
      `UPDATE plan_feature SET value = '100' WHERE plan_code = 'growth' AND feature_key = 'pms.units.limit'`,
    ).run();

    for (const stmt of PLATFORM_ENTITLEMENT_CATALOG_STATEMENTS) {
      await env.PLATFORM_DB.prepare(stmt).run();
    }

    const starter = await env.PLATFORM_DB.prepare(
      `SELECT value FROM plan_feature WHERE plan_code = 'starter' AND feature_key = 'pms.units.limit'`,
    ).first<{ value: string }>();
    const growth = await env.PLATFORM_DB.prepare(
      `SELECT value FROM plan_feature WHERE plan_code = 'growth' AND feature_key = 'pms.units.limit'`,
    ).first<{ value: string }>();
    expect(starter?.value).toBe('40');
    expect(growth?.value).toBe('400');
  });

  it('applies property increments and grant add-ons, and bumps entitlement_version', async () => {
    const groupId = `org_cat_addon_g_${crypto.randomUUID()}`;
    await seedSubscription(env, groupId, 'group');
    const before = await loadSnapshot(env, groupId);
    expect(before.limits['pms.properties.limit']?.limit).toBe(10);
    const versionBefore = await entitlementVersion(groupId);

    await insertAddon(groupId, 'properties_plus_1', 2);
    expect(await entitlementVersion(groupId)).toBe(versionBefore + 1);
    const withTwo = await loadSnapshot(env, groupId);
    expect(withTwo.limits['pms.properties.limit']?.limit).toBe(12);
    expect(withTwo.features['pms.properties.limit']).toBe(12);

    await env.PLATFORM_DB.prepare(
      `UPDATE subscription_addon SET quantity = ? WHERE org_id = ? AND addon_code = ?`,
    )
      .bind(1, groupId, 'properties_plus_1')
      .run();
    expect(await entitlementVersion(groupId)).toBe(versionBefore + 2);

    const starterId = `org_cat_addon_s_${crypto.randomUUID()}`;
    await seedSubscription(env, starterId, 'starter');
    await insertAddon(starterId, 'revenue_mgmt', 1);
    const starter = await loadSnapshot(env, starterId);
    expect(starter.features['revenue_mgmt.enabled']).toBe(true);
    expect(starter.features['pms.core']).toBe(true);
  });

  it('starter HTTP ceiling: first property 201, second 422, replay does not count', async () => {
    const orgId = `org_cat_http_${crypto.randomUUID()}`;
    const firstId = `prop_cat_http_a_${crypto.randomUUID()}`;
    const secondId = `prop_cat_http_b_${crypto.randomUUID()}`;
    const actor = 'user_catalog_http';

    expect((await postOrg(orgId, actor)).status).toBe(201);

    const first = await postProperty(orgId, firstId, actor);
    expect(first.status).toBe(201);

    const second = await postProperty(orgId, secondId, actor);
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual({
      error: LIMIT_EXCEEDED,
      featureKey: 'pms.properties.limit',
    });
    expect(await getProperty(env, secondId)).toBeNull();

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const refs = await org.listPropertyRefs();
    expect(refs.some((r) => r.propertyId === secondId)).toBe(false);

    const replay = await postProperty(orgId, firstId, actor);
    expect(replay.status).toBe(201);
    expect(await getProperty(env, secondId)).toBeNull();
  }, 30_000);

  it('group allows ten properties and refuses the eleventh', async () => {
    const orgId = `org_cat_ten_${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'group');
    for (let i = 0; i < 10; i++) {
      const result = await provisionProperty(env, provisionInput(orgId, `prop_cat_ten_${i}_${crypto.randomUUID()}`));
      expect(result.ok).toBe(true);
    }
    const eleventh = await provisionProperty(env, provisionInput(orgId, `prop_cat_ten_x_${crypto.randomUUID()}`));
    expect(eleventh).toEqual({
      ok: false,
      error: 'limit_exceeded',
      featureKey: 'pms.properties.limit',
    });
  }, 60_000);

  it('two concurrent creates for the last slot: exactly one succeeds', async () => {
    const orgId = `org_cat_race_${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'starter');
    const idA = `prop_cat_race_a_${crypto.randomUUID()}`;
    const idB = `prop_cat_race_b_${crypto.randomUUID()}`;
    const [a, b] = await Promise.all([
      provisionProperty(env, provisionInput(orgId, idA)),
      provisionProperty(env, provisionInput(orgId, idB)),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: 'limit_exceeded', featureKey: 'pms.properties.limit' },
    ]);
    const rows = [await getProperty(env, idA), await getProperty(env, idB)];
    expect(rows.filter((row) => row !== null)).toHaveLength(1);
  }, 30_000);

  it('a failed insert after reservation leaves the property count unchanged', async () => {
    const orgId = `org_cat_fail_${crypto.randomUUID()}`;
    const badId = `prop_cat_bad_${crypto.randomUUID()}`;
    const goodId = `prop_cat_good_${crypto.randomUUID()}`;
    await seedSubscription(env, orgId, 'starter');

    await expect(
      provisionProperty(env, {
        ...provisionInput(orgId, badId),
        jurisdiction: 'not-a-jurisdiction' as 'eu',
      }),
    ).rejects.toThrow();

    expect(await getProperty(env, badId)).toBeNull();
    const good = await provisionProperty(env, provisionInput(orgId, goodId));
    expect(good.ok).toBe(true);
    expect(await getProperty(env, goodId)).not.toBeNull();
  });
});
