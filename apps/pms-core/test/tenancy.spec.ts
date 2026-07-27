import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { resolvePropertyFromRegistry, provisionProperty } from '../src/provision';
import { resetPlatformSchemaGate } from '../src/registry';
import { resolveOrgStub } from '@hospai/tenant-router';
import type { OrgDO } from '../src/org-do';

describe('tenancy spine', () => {
  it('provisions EU property, records jurisdiction, mirrors in OrgDO', async () => {
    resetPlatformSchemaGate();
    const propertyId = `prop_eu_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'EU Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      actorUserId: 'user_owner',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locationHint).toBe('weur');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(resolved!.property.jurisdiction).toBe('eu');
    expect(await resolved!.stub.getRecordedJurisdiction()).toBe('eu');
    expect(await resolved!.stub.getSchemaVersion()).toBe(1);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const refs = await org.listPropertyRefs();
    expect(refs.some((r) => r.propertyId === propertyId && r.jurisdiction === 'eu')).toBe(true);
    const members = await org.listMembers();
    expect(members.some((m) => m.userId === 'user_owner')).toBe(true);
  });

  it('rejects jurisdiction conflict with 409 semantics', async () => {
    resetPlatformSchemaGate();
    const propertyId = `prop_conflict_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const first = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Paris',
      actorUserId: 'user_a',
    });
    expect(first.ok).toBe(true);

    const second = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Hotel',
      jurisdiction: 'us',
      timeZone: 'Europe/Paris',
      actorUserId: 'user_a',
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('jurisdiction_conflict');
    expect(second.existing?.jurisdiction).toBe('eu');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved!.property.jurisdiction).toBe('eu');
  });

  it('provisions null-jurisdiction property on default namespace', async () => {
    resetPlatformSchemaGate();
    const propertyId = `prop_null_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Local Dev Hotel',
      jurisdiction: null,
      timeZone: 'America/New_York',
      actorUserId: 'user_dev',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locationHint).toBe('enam');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved!.property.jurisdiction).toBeNull();
    expect(await resolved!.stub.getRecordedJurisdiction()).toBeNull();
  });

  it('HTTP provision requires X-Dev-Actor and resolves via GET', async () => {
    resetPlatformSchemaGate();
    const propertyId = `prop_http_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const { default: worker } = await import('../src/index');

    const denied = await worker.fetch(
      new Request('http://localhost/v1/orgs/' + orgId + '/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          name: 'HTTP Hotel',
          jurisdiction: null,
          timeZone: 'America/Chicago',
        }),
      }),
      env,
    );
    expect(denied.status).toBe(401);

    const created = await worker.fetch(
      new Request('http://localhost/v1/orgs/' + orgId + '/properties', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': 'user_http',
        },
        body: JSON.stringify({
          propertyId,
          name: 'HTTP Hotel',
          jurisdiction: null,
          timeZone: 'America/Chicago',
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const got = await worker.fetch(
      new Request('http://localhost/v1/properties/' + propertyId),
      env,
    );
    expect(got.status).toBe(200);
    const body = (await got.json()) as { property: { propertyId: string } };
    expect(body.property.propertyId).toBe(propertyId);
  });
});
