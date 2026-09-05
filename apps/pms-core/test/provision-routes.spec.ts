import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

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

async function postProperty(
  orgId: string,
  propertyId: string,
  actor: string,
  overrides: {
    name?: string;
    jurisdiction?: 'eu' | 'us' | 'fedramp' | null;
    timeZone?: string;
    currency?: string;
  } = {},
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: overrides.name ?? 'Provision Hotel',
        jurisdiction: overrides.jurisdiction ?? null,
        timeZone: overrides.timeZone ?? 'UTC',
        currency: overrides.currency ?? 'USD',
      }),
    }),
    env,
  );
}

function assertPropertyExistsBody(body: unknown) {
  expect(body).toEqual({ error: 'property_exists' });
  const record = body as Record<string, unknown>;
  for (const key of ['orgId', 'propertyId', 'name', 'jurisdiction', 'existing'] as const) {
    expect(record).not.toHaveProperty(key);
  }
}

describe('provision HTTP routes (cross-tenant)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('T5: cross-org POST with victim propertyId returns 409 property_exists without identifiers', async () => {
    const orgA = `org_a_http_${crypto.randomUUID()}`;
    const orgB = `org_b_http_${crypto.randomUUID()}`;
    const victimPropertyId = `prop_victim_http_${crypto.randomUUID()}`;
    const victimOwner = 'user_victim_http';
    const attacker = 'user_attacker_http';

    expect((await postOrg(orgB, 'Org B', victimOwner)).status).toBe(201);
    expect(
      (
        await postProperty(orgB, victimPropertyId, victimOwner, {
          jurisdiction: 'eu',
          timeZone: 'Europe/Berlin',
          currency: 'EUR',
        })
      ).status,
    ).toBe(201);

    const victimOrgBefore = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    const membersBefore = await victimOrgBefore.listMembers();

    expect((await postOrg(orgA, 'Org A', attacker)).status).toBe(201);

    const res = await postProperty(orgA, victimPropertyId, attacker, {
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
    });
    expect(res.status).toBe(409);
    assertPropertyExistsBody(await res.json());

    const victimOrgAfter = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    expect(await victimOrgAfter.listMembers()).toEqual(membersBefore);
    expect((await victimOrgAfter.listMembers()).some((m) => m.userId === attacker)).toBe(false);
  });

  it('T6: cross-org POST with jurisdiction mismatch still returns property_exists', async () => {
    const orgA = `org_a_jx_http_${crypto.randomUUID()}`;
    const orgB = `org_b_jx_http_${crypto.randomUUID()}`;
    const victimPropertyId = `prop_victim_jx_http_${crypto.randomUUID()}`;

    expect((await postOrg(orgB, 'Org B', 'user_b')).status).toBe(201);
    expect(
      (
        await postProperty(orgB, victimPropertyId, 'user_b', {
          jurisdiction: 'eu',
          timeZone: 'Europe/Berlin',
          currency: 'EUR',
        })
      ).status,
    ).toBe(201);

    expect((await postOrg(orgA, 'Org A', 'user_a')).status).toBe(201);

    const res = await postProperty(orgA, victimPropertyId, 'user_a', {
      jurisdiction: 'us',
      timeZone: 'America/New_York',
      currency: 'USD',
    });
    expect(res.status).toBe(409);
    assertPropertyExistsBody(await res.json());
  });

  it('T7: same-org re-provision via HTTP returns 201', async () => {
    const orgId = `org_idem_http_${crypto.randomUUID()}`;
    const propertyId = `prop_idem_http_${crypto.randomUUID()}`;
    const owner = 'user_idem_http';

    expect((await postOrg(orgId, 'Idem Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  });
});
