import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import {
  COMMAND_BY_ID,
  OPS_COMMAND_IDS,
  OPS_WRITE_KILL_KEY,
  type ActorContext,
} from '@hospai/contracts';
import worker from '../src/index.js';
import { __setLookupUserIdByEmailForTest } from '../src/clerk-lookup.js';
import { OpsEntrypoint } from '../src/ops-entrypoint.js';
import * as ops from '../src/ops-platform.js';
import type { OrgDO } from '../src/org-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from '../src/provision.js';
import { getOrg, trySetOrgStatus } from '../src/registry.js';
import { actionRows, failingBatchDb, resetOperatorRegistry, seedOperator, uid, withEnv } from './ops-helpers.js';
import { idemFor } from './fixtures.js';

let admin: { operatorId: string; email: string };
let viewer: { operatorId: string; email: string };

beforeAll(async () => {
  await resetOperatorRegistry();
  admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
  viewer = await seedOperator('ops_viewer');
});

afterEach(async () => {
  await env.ENTITLEMENT_KV.delete(OPS_WRITE_KILL_KEY);
  __setLookupUserIdByEmailForTest(null);
});

let keyCounter = 0;
const w = (operatorId: string, reason: string | null = 'Pilot onboarding') => ({
  operatorId,
  clientKey: `k${++keyCounter}-${crypto.randomUUID()}`,
  reason: reason as string,
});

async function newOrg(planCode: 'starter' | 'growth' | 'group' = 'growth') {
  const orgId = uid('org_ops');
  const res = await ops.createOrg(env, { ...w(admin.operatorId), orgId, name: `Customer ${orgId}`, planCode });
  expect(res.ok).toBe(true);
  return orgId;
}

function addProp(orgId: string, propertyId: string, extra?: Partial<Parameters<typeof ops.addProperty>[1]>) {
  return ops.addProperty(env, {
    ...w(admin.operatorId),
    orgId,
    propertyId,
    name: `Hotel ${propertyId}`,
    jurisdiction: null,
    timeZone: 'UTC',
    currency: 'USD',
    ...extra,
  });
}

async function entitlementVersion(orgId: string): Promise<number> {
  const row = await env.PLATFORM_DB.prepare(`SELECT entitlement_version AS v FROM subscription WHERE org_id = ?`)
    .bind(orgId)
    .first<{ v: number }>();
  return row!.v;
}

describe('platform schema (R7.1)', () => {
  it('operator rows are retained and operator_action is append-only', async () => {
    const ghost = await seedOperator('ops_viewer');
    await expect(
      env.PLATFORM_DB.prepare(`DELETE FROM operator WHERE operator_id = ?`).bind(ghost.operatorId).run(),
    ).rejects.toThrow(/retained/);
    const orgId = await newOrg();
    const [row] = await actionRows('org_id = ?', orgId);
    await expect(
      env.PLATFORM_DB.prepare(`UPDATE operator_action SET reason = 'x' WHERE action_id = ?`)
        .bind(row!.action_id)
        .run(),
    ).rejects.toThrow(/append-only/);
    await expect(
      env.PLATFORM_DB.prepare(`DELETE FROM operator_action WHERE action_id = ?`).bind(row!.action_id).run(),
    ).rejects.toThrow(/append-only/);
  });

  it('org status: active to suspended to active, suspended to closing; not suspended to purging', async () => {
    const orgId = await newOrg();
    expect((await trySetOrgStatus(env, orgId, 'suspended')).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'active')).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'suspended')).ok).toBe(true);
    expect((await trySetOrgStatus(env, orgId, 'purging')).ok).toBe(false);
    expect((await trySetOrgStatus(env, orgId, 'closing')).ok).toBe(true);
  });

  it('the ten ops.* commands are INTERACTIVE catalog entries and none is a tenant permission', () => {
    expect(OPS_COMMAND_IDS).toHaveLength(10);
    for (const id of OPS_COMMAND_IDS) {
      const entry = COMMAND_BY_ID.get(id)!;
      expect(entry.lane).toBe('INTERACTIVE');
      expect(entry.permission).toBe('shell:internal');
    }
  });
});

describe('OpsEntrypoint.resolveOperator (spec §15 A5)', () => {
  it('bootstrap: an empty registry plus a listed verified email makes the first ops_admin once; the var is then ignored', async () => {
    await resetOperatorRegistry();
    const listed = withEnv({ OPS_BOOTSTRAP_EMAILS: 'Boss@HospAI.test, second@hospai.test' });

    const unlisted = await ops.resolveOperator(listed, { clerkUserId: 'user_c0', verifiedEmail: 'nobody@x.test' });
    expect(unlisted).toMatchObject({ ok: false, error: 'not_an_operator', status: 403 });
    const unverified = await ops.resolveOperator(listed, { clerkUserId: 'user_c1', verifiedEmail: null });
    expect(unverified).toMatchObject({ ok: false, error: 'not_an_operator' });

    const first = await ops.resolveOperator(listed, { clerkUserId: 'user_c1', verifiedEmail: 'boss@hospai.test' });
    expect(first).toMatchObject({ ok: true, via: 'bootstrap', operator: { role: 'ops_admin', status: 'active' } });
    expect(await actionRows(`command_id = 'operator.bootstrap'`)).toHaveLength(1);

    // Second request after any row exists: the var is ignored.
    const second = await ops.resolveOperator(listed, { clerkUserId: 'user_c2', verifiedEmail: 'second@hospai.test' });
    expect(second).toMatchObject({ ok: false, error: 'not_an_operator' });
    expect(await actionRows(`command_id = 'operator.bootstrap'`)).toHaveLength(1);

    // The bootstrapped operator now resolves by Clerk user id alone.
    const again = await ops.resolveOperator(listed, { clerkUserId: 'user_c1', verifiedEmail: null });
    expect(again).toMatchObject({ ok: true, via: 'clerk_user_id' });

    admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
    viewer = await seedOperator('ops_viewer');
  });

  it('link: a verified email links an active row with no Clerk id, once, with an operator.link action', async () => {
    const seeded = await seedOperator('ops_viewer', { email: `link-${crypto.randomUUID()}@hospai.test` });
    const clerkUserId = `user_link_${crypto.randomUUID()}`;
    const linked = await ops.resolveOperator(env, { clerkUserId, verifiedEmail: seeded.email.toUpperCase() });
    expect(linked).toMatchObject({ ok: true, via: 'link', operator: { operatorId: seeded.operatorId } });
    const rows = await actionRows(`command_id = 'operator.link' AND operator_id = ?`, seeded.operatorId);
    expect(rows).toHaveLength(1);

    // Afterwards the Clerk id alone is enough, and a different Clerk user with the same email is refused.
    expect(await ops.resolveOperator(env, { clerkUserId, verifiedEmail: null })).toMatchObject({ ok: true, via: 'clerk_user_id' });
    expect(
      await ops.resolveOperator(env, { clerkUserId: `user_other_${crypto.randomUUID()}`, verifiedEmail: seeded.email }),
    ).toMatchObject({ ok: false, error: 'not_an_operator' });
    expect(await actionRows(`command_id = 'operator.link' AND operator_id = ?`, seeded.operatorId)).toHaveLength(1);
  });

  it('an unverified email never links, a disabled row never links, and nobody bootstraps once rows exist', async () => {
    const seeded = await seedOperator('ops_admin', { email: `unv-${crypto.randomUUID()}@hospai.test` });
    const clerkUserId = `user_unv_${crypto.randomUUID()}`;
    expect(await ops.resolveOperator(env, { clerkUserId, verifiedEmail: null })).toMatchObject({ ok: false });
    expect((await loadClerkId(seeded.operatorId)) ?? null).toBeNull();

    const disabled = await seedOperator('ops_viewer', { status: 'disabled', email: `dis-${crypto.randomUUID()}@hospai.test` });
    expect(await ops.resolveOperator(env, { clerkUserId: `user_d_${crypto.randomUUID()}`, verifiedEmail: disabled.email })).toMatchObject({
      ok: false,
      error: 'not_an_operator',
    });
    const withBootstrapVar = withEnv({ OPS_BOOTSTRAP_EMAILS: 'late@hospai.test' });
    expect(
      await ops.resolveOperator(withBootstrapVar, { clerkUserId: `user_late_${crypto.randomUUID()}`, verifiedEmail: 'late@hospai.test' }),
    ).toMatchObject({ ok: false, error: 'not_an_operator' });
  });

  it('a disabled operator that already has a Clerk id is refused', async () => {
    const clerkUserId = `user_off_${crypto.randomUUID()}`;
    await seedOperator('ops_admin', { status: 'disabled', clerkUserId });
    expect(await ops.resolveOperator(env, { clerkUserId, verifiedEmail: null })).toMatchObject({
      ok: false,
      error: 'not_an_operator',
    });
  });
});

async function loadClerkId(operatorId: string): Promise<string | null> {
  const row = await env.PLATFORM_DB.prepare(`SELECT clerk_user_id FROM operator WHERE operator_id = ?`)
    .bind(operatorId)
    .first<{ clerk_user_id: string | null }>();
  return row?.clerk_user_id ?? null;
}

describe('roles, reason, kill-switch', () => {
  it('ops_viewer calling any of the ten writes is 403 forbidden and changes nothing', async () => {
    const orgId = await newOrg();
    const target = await seedOperator('ops_viewer');
    const v = (): ReturnType<typeof w> => w(viewer.operatorId);
    const results = await Promise.all([
      ops.createOrg(env, { ...v(), orgId: uid('org_v'), name: 'X', planCode: 'growth' }),
      ops.addProperty(env, { ...v(), orgId, propertyId: uid('prop_v'), name: 'X', timeZone: 'UTC', currency: 'USD' }),
      ops.addOrgOwner(env, { ...v(), orgId, email: 'a@b.test' }),
      ops.setPlan(env, { ...v(), orgId, planCode: 'group' }),
      ops.setAddon(env, { ...v(), orgId, addonCode: 'pos', quantity: 1 }),
      ops.suspendOrg(env, { ...v(), orgId }),
      ops.reinstateOrg(env, { ...v(), orgId }),
      ops.addOperator(env, { ...v(), email: 'v@hospai.test', displayName: 'V', role: 'ops_viewer' }),
      ops.setOperatorStatus(env, { ...v(), targetOperatorId: target.operatorId, status: 'disabled' }),
      ops.setOperatorRole(env, { ...v(), targetOperatorId: target.operatorId, role: 'ops_admin' }),
    ]);
    expect(results).toHaveLength(10);
    for (const r of results) expect(r).toMatchObject({ ok: false, error: 'forbidden', status: 403 });
    expect(await actionRows('operator_id = ?', viewer.operatorId)).toHaveLength(0);
    expect((await getOrg(env, orgId))!.status).toBe('active');
  });

  it('an unknown or disabled operator is not_an_operator on every call', async () => {
    const off = await seedOperator('ops_admin', { status: 'disabled' });
    expect(await ops.listCustomers(env, { operatorId: 'op_nobody' })).toMatchObject({ ok: false, error: 'not_an_operator' });
    expect(await ops.createOrg(env, { ...w(off.operatorId), orgId: uid('org_x'), name: 'X', planCode: 'growth' })).toMatchObject({
      ok: false,
      error: 'not_an_operator',
    });
  });

  it('every write without a reason is 422 reason_required, and a blank one too', async () => {
    const orgId = await newOrg();
    const target = await seedOperator('ops_viewer');
    const bad = (reason: string | null) => w(admin.operatorId, reason);
    for (const reason of [null, '', '   ', 'x'.repeat(501)]) {
      const results = await Promise.all([
        ops.createOrg(env, { ...bad(reason), orgId: uid('org_r'), name: 'X', planCode: 'growth' }),
        ops.addProperty(env, { ...bad(reason), orgId, propertyId: uid('prop_r'), name: 'X', timeZone: 'UTC', currency: 'USD' }),
        ops.addOrgOwner(env, { ...bad(reason), orgId, email: 'a@b.test' }),
        ops.setPlan(env, { ...bad(reason), orgId, planCode: 'group' }),
        ops.setAddon(env, { ...bad(reason), orgId, addonCode: 'pos', quantity: 1 }),
        ops.suspendOrg(env, { ...bad(reason), orgId }),
        ops.reinstateOrg(env, { ...bad(reason), orgId }),
        ops.addOperator(env, { ...bad(reason), email: 'r@hospai.test', displayName: 'R', role: 'ops_viewer' }),
        ops.setOperatorStatus(env, { ...bad(reason), targetOperatorId: target.operatorId, status: 'disabled' }),
        ops.setOperatorRole(env, { ...bad(reason), targetOperatorId: target.operatorId, role: 'ops_admin' }),
      ]);
      for (const r of results) expect(r).toMatchObject({ ok: false, error: 'reason_required', status: 422 });
    }
    expect((await getOrg(env, orgId))!.status).toBe('active');
  });

  it('with a reason, exactly one operator_action row carries it, the ticket and before/after', async () => {
    const orgId = await newOrg('growth');
    const res = await ops.setPlan(env, { ...w(admin.operatorId, 'Hotel 2 is joining'), ticketRef: 'HOSP-42', orgId, planCode: 'group' });
    expect(res).toMatchObject({ ok: true, replayed: false });
    const rows = await actionRows(`org_id = ? AND command_id = 'ops.set_plan'`, orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operator_id: admin.operatorId,
      reason: 'Hotel 2 is joining',
      ticket_ref: 'HOSP-42',
      before_json: '{"planCode":"growth"}',
      after_json: '{"planCode":"group"}',
    });
  });

  it('a forced D1 failure leaves neither the change nor the row', async () => {
    const orgId = uid('org_fail');
    const failing = withEnv({ PLATFORM_DB: failingBatchDb(env.PLATFORM_DB) });
    await expect(
      ops.createOrg(failing, { ...w(admin.operatorId), orgId, name: 'Never', planCode: 'growth' }),
    ).rejects.toThrow();
    expect(await getOrg(env, orgId)).toBeNull();
    expect(await actionRows('org_id = ?', orgId)).toHaveLength(0);
    const sub = await env.PLATFORM_DB.prepare(`SELECT 1 AS one FROM subscription WHERE org_id = ?`).bind(orgId).first();
    expect(sub).toBeNull();

    const existing = await newOrg('growth');
    await expect(ops.setPlan(failing, { ...w(admin.operatorId), orgId: existing, planCode: 'group' })).rejects.toThrow();
    const row = await env.PLATFORM_DB.prepare(`SELECT plan_code FROM subscription WHERE org_id = ?`).bind(existing).first<{ plan_code: string }>();
    expect(row!.plan_code).toBe('growth');
    expect(await actionRows(`org_id = ? AND command_id = 'ops.set_plan'`, existing)).toHaveLength(0);
  });

  it('kill:ops.write refuses every write with 503 ops_writes_disabled and leaves reads working', async () => {
    const orgId = await newOrg();
    const target = await seedOperator('ops_viewer');
    await env.ENTITLEMENT_KV.put(OPS_WRITE_KILL_KEY, '1');
    const a = (): ReturnType<typeof w> => w(admin.operatorId);
    const results = await Promise.all([
      ops.createOrg(env, { ...a(), orgId: uid('org_k'), name: 'X', planCode: 'growth' }),
      ops.addProperty(env, { ...a(), orgId, propertyId: uid('prop_k'), name: 'X', timeZone: 'UTC', currency: 'USD' }),
      ops.addOrgOwner(env, { ...a(), orgId, email: 'a@b.test' }),
      ops.setPlan(env, { ...a(), orgId, planCode: 'group' }),
      ops.setAddon(env, { ...a(), orgId, addonCode: 'pos', quantity: 1 }),
      ops.suspendOrg(env, { ...a(), orgId }),
      ops.reinstateOrg(env, { ...a(), orgId }),
      ops.addOperator(env, { ...a(), email: 'k@hospai.test', displayName: 'K', role: 'ops_viewer' }),
      ops.setOperatorStatus(env, { ...a(), targetOperatorId: target.operatorId, status: 'disabled' }),
      ops.setOperatorRole(env, { ...a(), targetOperatorId: target.operatorId, role: 'ops_admin' }),
    ]);
    for (const r of results) expect(r).toMatchObject({ ok: false, error: 'ops_writes_disabled', status: 503 });

    expect(await ops.listCustomers(env, { operatorId: viewer.operatorId })).toMatchObject({ ok: true });
    expect(await ops.getCustomer(env, { operatorId: viewer.operatorId, orgId })).toMatchObject({ ok: true });
    expect(await ops.listOperatorActions(env, { operatorId: viewer.operatorId })).toMatchObject({ ok: true });
    expect(await ops.listOperators(env, { operatorId: admin.operatorId })).toMatchObject({ ok: true });
    expect((await getOrg(env, orgId))!.status).toBe('active');
  });
});

describe('idempotency', () => {
  it('the same key and payload twice is one change and one row; another payload is 409', async () => {
    const input = { ...w(admin.operatorId), orgId: uid('org_idem'), name: 'Idem', planCode: 'growth' };
    const first = await ops.createOrg(env, input);
    const second = await ops.createOrg(env, input);
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect((second as { actionId: string }).actionId).toBe((first as { actionId: string }).actionId);
    expect(await actionRows('org_id = ?', input.orgId)).toHaveLength(1);

    const different = await ops.createOrg(env, { ...input, name: 'Another name' });
    expect(different).toMatchObject({ ok: false, error: 'idempotency_key_reused', status: 409 });
    expect((await getOrg(env, input.orgId))!.name).toBe('Idem');
    expect(await actionRows('org_id = ?', input.orgId)).toHaveLength(1);
  });

  it('the key is per operator: another operator may reuse the same clientKey', async () => {
    const other = await seedOperator('ops_admin');
    const clientKey = `shared-${crypto.randomUUID()}`;
    const a = await ops.createOrg(env, { operatorId: admin.operatorId, clientKey, reason: 'r', orgId: uid('org_pk'), name: 'A', planCode: 'growth' });
    const b = await ops.createOrg(env, { operatorId: other.operatorId, clientKey, reason: 'r', orgId: uid('org_pk'), name: 'B', planCode: 'growth' });
    expect(a).toMatchObject({ ok: true, replayed: false });
    expect(b).toMatchObject({ ok: true, replayed: false });
  });

  it('a replayed set_plan does not bump the entitlement version again', async () => {
    const orgId = await newOrg('growth');
    const input = { ...w(admin.operatorId), orgId, planCode: 'group' };
    const before = await entitlementVersion(orgId);
    expect(await ops.setPlan(env, input)).toMatchObject({ ok: true, replayed: false });
    expect(await ops.setPlan(env, input)).toMatchObject({ ok: true, replayed: true });
    expect(await entitlementVersion(orgId)).toBe(before + 1);
  });
});

describe('cross-tenant (fail-first)', () => {
  it('ops.add_property with a property id that exists in another org is 409 property_exists, with no foreign field and no membership', async () => {
    const victimOrg = uid('org_victim');
    const propertyId = uid('prop_victim');
    const seeded = await provisionProperty(env, {
      orgId: victimOrg,
      orgName: 'Victim Holdings',
      propertyId,
      name: 'Victim Palace',
      jurisdiction: null,
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_victim_owner',
    });
    expect(seeded.ok).toBe(true);

    const attackerOrg = await newOrg('growth');
    const res = await addProp(attackerOrg, propertyId, { name: 'Mine now', jurisdiction: 'eu' });
    expect(res).toMatchObject({ ok: false, error: 'property_exists', status: 409 });
    const body = JSON.stringify(res);
    for (const leaked of [victimOrg, 'Victim Palace', 'Victim Holdings', 'Europe/Berlin', 'user_victim_owner']) {
      expect(body).not.toContain(leaked);
    }
    // The property is still the victim's, with its one owner; nothing was added to either org.
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved!.property.orgId).toBe(victimOrg);
    const victim = resolveOrgStub(env.ORG_DO, { orgId: victimOrg }) as DurableObjectStub<OrgDO>;
    expect((await victim.listMembers()).map((m) => m.userId)).toEqual(['user_victim_owner']);
    const attacker = resolveOrgStub(env.ORG_DO, { orgId: attackerOrg }) as DurableObjectStub<OrgDO>;
    expect(await attacker.listMembers()).toEqual([]);
    expect(await actionRows('property_id = ?', propertyId)).toHaveLength(0);
  });

  it('ops.create_org on an existing id is 409 org_exists with no field of that org', async () => {
    const existing = await newOrg('growth');
    const res = await ops.createOrg(env, { ...w(admin.operatorId), orgId: existing, name: 'Hijack', planCode: 'group' });
    expect(res).toMatchObject({ ok: false, error: 'org_exists', status: 409 });
    expect(JSON.stringify(res)).not.toContain(existing);
    expect(JSON.stringify(res)).not.toContain('Customer');
    expect((await getOrg(env, existing))!.name).toBe(`Customer ${existing}`);
  });

  it('ops.add_property into an org that does not exist is 404 and creates no org', async () => {
    const orgId = uid('org_ghost');
    expect(await addProp(orgId, uid('prop_ghost'))).toMatchObject({ ok: false, error: 'not_found', status: 404 });
    expect(await getOrg(env, orgId)).toBeNull();
  });
});

describe('plan limits', () => {
  it('Growth with one hotel: add_property is 422 limit_exceeded; after set_plan group the retry works and the version went up by one', async () => {
    const orgId = await newOrg('growth');
    expect(await addProp(orgId, uid('prop_g1'))).toMatchObject({ ok: true });
    const second = uid('prop_g2');
    expect(await addProp(orgId, second)).toMatchObject({ ok: false, error: 'limit_exceeded', status: 422 });

    const before = await entitlementVersion(orgId);
    expect(await ops.setPlan(env, { ...w(admin.operatorId), orgId, planCode: 'group' })).toMatchObject({ ok: true });
    expect(await entitlementVersion(orgId)).toBe(before + 1);

    expect(await addProp(orgId, second)).toMatchObject({ ok: true, property: { propertyId: second, orgId } });
  });

  it('Group with three hotels: set_plan growth is 422 plan_below_usage and the plan is unchanged', async () => {
    const orgId = await newOrg('group');
    for (let i = 0; i < 3; i++) expect(await addProp(orgId, uid(`prop_u${i}`))).toMatchObject({ ok: true });
    const before = await entitlementVersion(orgId);
    const res = await ops.setPlan(env, { ...w(admin.operatorId), orgId, planCode: 'growth' });
    expect(res).toMatchObject({ ok: false, error: 'plan_below_usage', status: 422 });
    const row = await env.PLATFORM_DB.prepare(`SELECT plan_code FROM subscription WHERE org_id = ?`).bind(orgId).first<{ plan_code: string }>();
    expect(row!.plan_code).toBe('group');
    expect(await entitlementVersion(orgId)).toBe(before);
  });

  it('set_addon: the +1 property add-on raises the ceiling, and removing it below use is plan_below_usage', async () => {
    const orgId = await newOrg('growth');
    expect(await addProp(orgId, uid('prop_a1'))).toMatchObject({ ok: true });
    const v0 = await entitlementVersion(orgId);
    expect(await ops.setAddon(env, { ...w(admin.operatorId), orgId, addonCode: 'properties_plus_1', quantity: 1 })).toMatchObject({ ok: true });
    expect(await entitlementVersion(orgId)).toBe(v0 + 1);
    expect(await addProp(orgId, uid('prop_a2'))).toMatchObject({ ok: true });
    const removed = await ops.setAddon(env, { ...w(admin.operatorId), orgId, addonCode: 'properties_plus_1', quantity: 0 });
    expect(removed).toMatchObject({ ok: false, error: 'plan_below_usage', status: 422 });
    expect(await ops.setAddon(env, { ...w(admin.operatorId), orgId, addonCode: 'pos', quantity: 1 })).toMatchObject({ ok: true });
    expect(await ops.setAddon(env, { ...w(admin.operatorId), orgId, addonCode: 'pos', quantity: 0 })).toMatchObject({ ok: true });
    expect(await ops.setAddon(env, { ...w(admin.operatorId), orgId, addonCode: 'nope', quantity: 1 })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await ops.setPlan(env, { ...w(admin.operatorId), orgId, planCode: 'platinum' })).toMatchObject({ ok: false, error: 'invalid_request' });
  });
});

describe('operator actor', () => {
  it('ops.add_property writes no membership for the operator; ops.add_org_owner writes the owner and that user /me works', async () => {
    const orgId = await newOrg('growth');
    const propertyId = uid('prop_own');
    expect(await addProp(orgId, propertyId)).toMatchObject({ ok: true });
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    expect(await org.listMembers()).toEqual([]);
    const indexed = await env.PLATFORM_DB.prepare(`SELECT user_id FROM user_org WHERE org_id = ?`).bind(orgId).all();
    expect(indexed.results).toHaveLength(0);

    __setLookupUserIdByEmailForTest(async (_env, email) =>
      email === 'gm@hotel.test' ? { ok: true, userId: 'user_ops_owner_gm' } : { ok: false, error: 'no_such_user' },
    );
    const missing = await ops.addOrgOwner(env, { ...w(admin.operatorId), orgId, email: 'nobody@hotel.test' });
    expect(missing).toMatchObject({ ok: false, error: 'user_not_found', status: 404 });
    expect(await actionRows(`org_id = ? AND command_id = 'ops.add_org_owner'`, orgId)).toHaveLength(0);

    const added = await ops.addOrgOwner(env, { ...w(admin.operatorId), orgId, email: 'GM@hotel.test' });
    expect(added).toMatchObject({ ok: true });
    expect(await org.listMembers()).toEqual([{ userId: 'user_ops_owner_gm', role: 'owner' }]);
    const [row] = await actionRows(`org_id = ? AND command_id = 'ops.add_org_owner'`, orgId);
    expect(row!.after_json).toBe('{"userId":"user_ops_owner_gm","role":"owner"}');
    expect(JSON.stringify(row)).not.toContain('hotel.test');

    const me = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/me`, { headers: { 'x-dev-actor': 'user_ops_owner_gm' } }),
      env,
    );
    expect(me.status).toBe(200);

    // Already a member: refused, nothing recorded for the second attempt.
    const again = await ops.addOrgOwner(env, { ...w(admin.operatorId), orgId, email: 'gm@hotel.test' });
    expect(again).toMatchObject({ ok: false, error: 'already_member' });
  });

  it('gatePermission never accepts an operator actor for a tenant permission', async () => {
    const orgId = await newOrg('growth');
    const propertyId = uid('prop_gate');
    expect(await addProp(orgId, propertyId)).toMatchObject({ ok: true });
    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    const operator: ActorContext = { kind: 'operator', operatorId: admin.operatorId };
    const input = { roomTypeId: 'rt_op', code: 'OP', name: 'Op', roomCount: 1, maxOccupancy: 2, maxAdults: 2 };
    const res = await resolved!.stub.tryAddRoomType(operator, input, await idemFor('op-add-rt', input));
    expect(res).toMatchObject({ ok: false, error: 'forbidden' });

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const members = await org.listOrgMembers(operator);
    expect(members.ok).toBe(false);
  });
});

describe('console reads', () => {
  it('getPropertyHealth returns only counts, dates and statuses (the key set is asserted)', async () => {
    const orgId = await newOrg('growth');
    const propertyId = uid('prop_health');
    expect(await addProp(orgId, propertyId)).toMatchObject({ ok: true });
    const res = await ops.getPropertyHealth(env, { operatorId: viewer.operatorId, propertyId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(Object.keys(res).sort()).toEqual(
      [
        'activeMemberCount',
        'businessDate',
        'lastNightAudit',
        'ok',
        'oldestOutboxAgeMs',
        'orgId',
        'propertyId',
        'roomCount',
        'roomTypeCount',
        'schemaVersion',
      ].sort(),
    );
    expect(res.lastNightAudit === null || Object.keys(res.lastNightAudit).sort().join() === 'businessDate,exceptionCount,status').toBe(true);
    expect(res.roomCount).toBe(0);
    expect(res.roomTypeCount).toBe(0);
    expect(res.activeMemberCount).toBe(0);
    expect(res.schemaVersion).toBeGreaterThan(0);
    expect(typeof res.businessDate).toBe('string');
    expect(await ops.getPropertyHealth(env, { operatorId: viewer.operatorId, propertyId: uid('prop_none') })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('listCustomers reads the registry only (no Durable Object is touched) and searches by name or id', async () => {
    const orgId = await newOrg('growth');
    expect(await addProp(orgId, uid('prop_list'))).toMatchObject({ ok: true });
    const guarded = withEnv({
      ORG_DO: new Proxy({}, { get: () => { throw new Error('no DO calls from the customer list'); } }),
      PROPERTY_DO: new Proxy({}, { get: () => { throw new Error('no DO calls from the customer list'); } }),
    });
    const byId = await ops.listCustomers(guarded, { operatorId: viewer.operatorId, query: orgId.slice(0, 14) });
    expect(byId.ok).toBe(true);
    if (!byId.ok) return;
    const row = byId.customers.find((c) => c.orgId === orgId)!;
    expect(row).toMatchObject({ planCode: 'growth', status: 'active', propertiesUsed: 1, propertiesLimit: 1, addons: [] });
    const byName = await ops.listCustomers(guarded, { operatorId: viewer.operatorId, query: `Customer ${orgId}` });
    expect(byName.ok && byName.customers.map((c) => c.orgId)).toEqual([orgId]);
    const wild = await ops.listCustomers(guarded, { operatorId: viewer.operatorId, query: '%' });
    expect(wild.ok && wild.customers.every((c) => c.orgId.includes('%') || c.name.includes('%'))).toBe(true);
  });

  it('listCustomers pages at 50', async () => {
    for (let i = 0; i < 52; i++) {
      await env.PLATFORM_DB.prepare(`INSERT OR IGNORE INTO org (org_id, name, status, created_at) VALUES (?, ?, 'active', ?)`)
        .bind(`org_page_${String(i).padStart(3, '0')}_${crypto.randomUUID().slice(0, 6)}`, 'Pager', Date.now())
        .run();
    }
    const first = await ops.listCustomers(env, { operatorId: viewer.operatorId, query: 'Pager' });
    expect(first.ok && first.customers.length).toBe(50);
    expect(first.ok && first.hasMore).toBe(true);
    const second = await ops.listCustomers(env, { operatorId: viewer.operatorId, query: 'Pager', page: 2 });
    expect(second.ok && second.customers.length).toBeGreaterThanOrEqual(2);
    expect(await ops.listCustomers(env, { operatorId: viewer.operatorId, page: 0 })).toMatchObject({ ok: false });
  });

  it('getCustomer shows hotels, plan and owners (ids and role only); the operator log filters by org and operator', async () => {
    const orgId = await newOrg('growth');
    const propertyId = uid('prop_detail');
    expect(await addProp(orgId, propertyId)).toMatchObject({ ok: true });
    __setLookupUserIdByEmailForTest(async () => ({ ok: true, userId: 'user_detail_owner' }));
    expect(await ops.addOrgOwner(env, { ...w(admin.operatorId), orgId, email: 'o@hotel.test' })).toMatchObject({ ok: true });

    const detail = await ops.getCustomer(env, { operatorId: viewer.operatorId, orgId });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.subscription).toMatchObject({ planCode: 'growth', status: 'active' });
    expect(detail.properties).toEqual([
      { propertyId, name: `Hotel ${propertyId}`, timeZone: 'UTC', jurisdiction: null, status: 'active' },
    ]);
    expect(detail.owners).toEqual([{ userId: 'user_detail_owner', role: 'owner' }]);
    expect(detail.actions.map((a) => a.commandId)).toEqual(['ops.add_org_owner', 'ops.add_property', 'ops.create_org']);

    const log = await ops.listOperatorActions(env, { operatorId: viewer.operatorId, orgId });
    expect(log.ok && log.actions.every((a) => a.orgId === orgId)).toBe(true);
    const mine = await ops.listOperatorActions(env, { operatorId: viewer.operatorId, filterOperatorId: admin.operatorId });
    expect(mine.ok && mine.actions.every((a) => a.operatorId === admin.operatorId)).toBe(true);

    expect(await ops.listOperators(env, { operatorId: viewer.operatorId })).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('the OpsEntrypoint class delegates to the same checks', async () => {
    const entry = new OpsEntrypoint({} as ExecutionContext, env);
    expect(await entry.listCustomers({ operatorId: 'op_missing' })).toMatchObject({ ok: false, error: 'not_an_operator' });
    expect(await entry.listCustomers({ operatorId: viewer.operatorId })).toMatchObject({ ok: true });
  });
});

describe('operator registry commands', () => {
  it('add_operator: 409 operator_exists on a repeated email, and the log never holds the email', async () => {
    const email = `new-${crypto.randomUUID()}@hospai.test`;
    const added = await ops.addOperator(env, { ...w(admin.operatorId), email: email.toUpperCase(), displayName: 'New Person', role: 'ops_viewer' });
    expect(added).toMatchObject({ ok: true });
    expect(await ops.addOperator(env, { ...w(admin.operatorId), email, displayName: 'Dup', role: 'ops_viewer' })).toMatchObject({
      ok: false,
      error: 'operator_exists',
      status: 409,
    });
    const [row] = await actionRows(`command_id = 'ops.add_operator' AND after_json LIKE ?`, `%${(added as { operatorId: string }).operatorId}%`);
    expect(JSON.stringify(row)).not.toContain(email.split('@')[0]);
  });

  it('the last active ops_admin cannot be disabled or demoted (409 last_ops_admin), others can', async () => {
    await resetOperatorRegistry();
    const only = await seedOperator('ops_admin');
    const second = await seedOperator('ops_admin');
    const reader = await seedOperator('ops_viewer');
    const a = (id: string) => w(id);

    expect(await ops.setOperatorStatus(env, { ...a(only.operatorId), targetOperatorId: second.operatorId, status: 'disabled' })).toMatchObject({ ok: true });
    expect(await ops.setOperatorStatus(env, { ...a(only.operatorId), targetOperatorId: only.operatorId, status: 'disabled' })).toMatchObject({
      ok: false,
      error: 'last_ops_admin',
      status: 409,
    });
    expect(await ops.setOperatorRole(env, { ...a(only.operatorId), targetOperatorId: only.operatorId, role: 'ops_viewer' })).toMatchObject({
      ok: false,
      error: 'last_ops_admin',
    });
    // Re-enable the second, then the first may step down.
    expect(await ops.setOperatorStatus(env, { ...a(only.operatorId), targetOperatorId: second.operatorId, status: 'active' })).toMatchObject({ ok: true });
    expect(await ops.setOperatorRole(env, { ...a(only.operatorId), targetOperatorId: only.operatorId, role: 'ops_viewer' })).toMatchObject({ ok: true });
    // Promote the reader, disable the old admin who is now a viewer.
    expect(await ops.setOperatorRole(env, { ...a(second.operatorId), targetOperatorId: reader.operatorId, role: 'ops_admin' })).toMatchObject({ ok: true });
    expect(await ops.setOperatorStatus(env, { ...a(second.operatorId), targetOperatorId: only.operatorId, status: 'disabled' })).toMatchObject({ ok: true });
    // A disabled operator can no longer act.
    expect(await ops.listCustomers(env, { operatorId: only.operatorId })).toMatchObject({ ok: false, error: 'not_an_operator' });

    admin = await seedOperator('ops_admin', { displayName: 'HospAI support: Sam' });
    viewer = await seedOperator('ops_viewer');
  });
});

describe('hotel view: get_org_operator_actions (fail-first)', () => {
  async function getActions(orgId: string, actor: string, query = '') {
    return worker.fetch(
      new Request(`http://localhost/v1/orgs/${orgId}/operator-actions${query}`, { headers: { 'x-dev-actor': actor } }),
      env,
    );
  }

  it('org A never sees org B rows; rows show display_name and never an email or ticket', async () => {
    const orgA = await newOrg('growth');
    const orgB = await newOrg('growth');
    await ops.suspendOrg(env, { ...w(admin.operatorId, 'Late payment'), ticketRef: 'HOSP-9', orgId: orgA });
    await ops.setAddon(env, { ...w(admin.operatorId, 'Secret B change'), orgId: orgB, addonCode: 'pos', quantity: 1 });
    const ownerA = 'user_view_owner_a';
    const stubA = resolveOrgStub(env.ORG_DO, { orgId: orgA }) as DurableObjectStub<OrgDO>;
    await stubA.ensureMember(ownerA, 'owner');
    await ops.reinstateOrg(env, { ...w(admin.operatorId, 'Paid up'), orgId: orgA });

    const res = await getActions(orgA, ownerA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orgId: string; page: number; hasMore: boolean; actions: Array<Record<string, unknown>> };
    expect(body.orgId).toBe(orgA);
    expect(body.actions.map((a) => a.commandId)).toEqual(['ops.reinstate_org', 'ops.suspend_org', 'ops.create_org']);
    expect(body.actions[0]).toMatchObject({ operatorName: 'HospAI support: Sam', reason: 'Paid up', before: { status: 'suspended' }, after: { status: 'active' } });
    const text = JSON.stringify(body);
    expect(text).not.toContain(admin.email);
    expect(text).not.toContain('@');
    expect(text).not.toContain('HOSP-9');
    expect(text).not.toContain(orgB);
    expect(text).not.toContain('Secret B change');

    // The owner of A has no standing in B: not found, no rows.
    const cross = await getActions(orgB, ownerA);
    expect(cross.status).toBe(404);
    expect(JSON.stringify(await cross.json())).not.toContain('Secret B change');
  });

  it('a non-member is refused, a staff member (org:read) reads, bad paging is 422, and a suspended org still reads', async () => {
    const orgId = await newOrg('growth');
    expect((await getActions(orgId, 'user_not_a_member')).status).toBe(404);
    const stub = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    await stub.ensureMember('user_view_staff', 'staff');
    expect((await getActions(orgId, 'user_view_staff')).status).toBe(200);
    expect((await getActions(orgId, 'user_view_staff', '?page=0')).status).toBe(422);
    expect((await getActions(orgId, 'user_view_staff', '?page=abc')).status).toBe(422);
    await ops.suspendOrg(env, { ...w(admin.operatorId), orgId });
    expect((await getActions(orgId, 'user_view_staff')).status).toBe(200);
  });
});
