import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import {
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
        name: 'Me Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_me_${crypto.randomUUID()}`;
  const propertyId = `prop_me_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Me Org', owner)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(orgId);
  return { orgId, propertyId, org };
}

async function fetchMe(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/me`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

describe('GET /v1/properties/:propertyId/me', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('readPropertyMe: unknown user → not_member', async () => {
    const owner = 'user_me_owner_nobody';
    const { propertyId, org } = await provisionHotel(owner);
    const result = await org.readPropertyMe(
      { kind: 'user', userId: 'user_nobody' },
      propertyId,
    );
    expect(result).toEqual({ ok: false, error: 'not_member' });
  });

  it('readPropertyMe: staff has folio:post, lacks folio:adjust; orgPermissions has org:read not org:manage', async () => {
    const owner = 'user_me_owner_staff';
    const staffId = 'user_me_staff';
    const { propertyId, org } = await provisionHotel(owner);
    await org.ensureMember(staffId, 'staff');

    const result = await org.readPropertyMe({ kind: 'user', userId: staffId }, propertyId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.role).toBe('staff');
    expect(result.permissions).toContain('folio:post');
    expect(result.permissions).not.toContain('folio:adjust');
    expect(result.orgPermissions).toContain('org:read');
    expect(result.orgPermissions).not.toContain('org:manage');
    expect(result.permissions).not.toContain('shell:internal');
    expect(result.orgPermissions).not.toContain('shell:internal');
  });

  it('GET /me: member 200 + orgId + Cache-Control private, no-store', async () => {
    const owner = 'user_me_owner_http';
    const { orgId, propertyId } = await provisionHotel(owner);
    const res = await fetchMe(propertyId, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      orgId,
      propertyId,
      userId: owner,
      role: 'owner',
    });
    expect(Array.isArray(body.permissions)).toBe(true);
    expect(Array.isArray(body.orgPermissions)).toBe(true);
  });

  it('GET /me: non-member 404 (dispatcher gate)', async () => {
    const owner = 'user_me_owner_stranger';
    const { propertyId } = await provisionHotel(owner);
    const res = await fetchMe(propertyId, 'user_stranger');
    expect(res.status).toBe(404);
  });

  // Proves handler catch + Cache-Control on FAIL_CLOSED — NOT a real OrgDO outage.
  // Gate assertPermission has no assertRpcAvailable; requirePermission has no try/catch.
  // Fault injection is method-selective: gate succeeds while readPropertyMe throws.
  // Genuine outage would fail the gate first and bypass this handler path.
  // Leftover: "OrgDO gate failures bypass the FAIL_CLOSED read design" (spec §6 #11).
  it('GET /me: OrgDO blocked → 503 org_unreachable + Cache-Control + no commandId', async () => {
    const owner = 'user_me_owner_blocked';
    const { propertyId, org } = await provisionHotel(owner);
    await org.setTransportBlockedForTest(true);
    try {
      const res = await fetchMe(propertyId, owner);
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ error: 'org_unreachable', degraded: 'FAIL_CLOSED' });
      expect(body).not.toHaveProperty('commandId');
    } finally {
      await org.setTransportBlockedForTest(false);
    }
  });
});
