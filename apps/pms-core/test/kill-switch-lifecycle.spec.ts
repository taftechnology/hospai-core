import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { __setLookupUserIdByEmailForTest } from '../src/clerk-lookup.js';
import { ensurePlatformSchema, getOrg, resetPlatformSchemaGate, setKillSwitch } from '../src/registry.js';

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'Kill Switch Org' }),
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
        name: 'Kill Switch Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

describe('kill-switch lifecycle routes (R0.9 S4)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
    __setLookupUserIdByEmailForTest(async (_env, email) => ({
      ok: true,
      userId: `user_from_${email.split('@')[0]}`,
    }));
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
    __setLookupUserIdByEmailForTest(null);
  });

  // T1 — cancel close blocked during kill-switch
  it('T1: kill-switch on → POST …/cancel close → 503 empty; org not closing', async () => {
    const actor = 'user_ks_cancel';
    const orgId = `org_ks_${crypto.randomUUID()}`;
    const propertyId = `prop_ks_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ action: 'close' }),
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
    expect((await getOrg(env, orgId))?.status).not.toBe('closing');
  });

  // T2 — purge blocked during kill-switch
  it('T2: kill-switch on → POST …/purge → 503 empty', async () => {
    const actor = 'user_ks_purge';
    const orgId = `org_ks_purge_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/purge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ orgId, confirm: true }),
      }),
      env,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('');
  });

  // T3 — membership POST not kill-switched
  it('T3: kill-switch on → POST …/properties/…/members → not 503 from kill-switch', async () => {
    const actor = 'user_ks_member';
    const orgId = `org_ks_mem_${crypto.randomUUID()}`;
    const propertyId = `prop_ks_mem_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);

    await setKillSwitch(env, 'pms.core', true);
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
      }),
      env,
    );
    expect(res.status).not.toBe(503);
  });

  // T4 — sanity: cancel succeeds when kill-switch off
  it('T4: kill-switch off → cancel close → 200 closing', async () => {
    const actor = 'user_ks_sanity';
    const orgId = `org_ks_ok_${crypto.randomUUID()}`;
    expect((await postOrg(orgId, actor)).status).toBe(201);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ action: 'close' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'closing' });
  });
});
