import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolvePropertyFromRegistry, provisionProperty } from '../src/provision';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  tryUpdatePropertyJurisdiction,
} from '../src/registry';
import { resolveOrgStub, resolvePropertyStub } from '@hospai/tenant-router';
import type { OrgDO } from '../src/org-do';
import type { PropertyDO } from '../src/property-do';
import type { PmsEnv } from '../src/env';

describe('tenancy spine', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('provisions EU property, records jurisdiction, mirrors in OrgDO', async () => {
    const propertyId = `prop_eu_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'EU Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locationHint).toBe('weur');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(resolved!.property.jurisdiction).toBe('eu');
    expect(await resolved!.stub.getRecordedJurisdiction()).toBe('eu');
    expect(await resolved!.stub.getSchemaVersion()).toBe(8);

    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const refs = await org.listPropertyRefs();
    expect(refs.some((r) => r.propertyId === propertyId && r.jurisdiction === 'eu')).toBe(true);
    const members = await org.listMembers();
    expect(members.some((m) => m.userId === 'user_owner')).toBe(true);
  });

  it('rejects jurisdiction conflict with 409 semantics', async () => {
    const propertyId = `prop_conflict_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const first = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      actorUserId: 'user_a',
    });
    expect(first.ok).toBe(true);

    const second = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Hotel',
      jurisdiction: 'us',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      actorUserId: 'user_a',
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toBe('jurisdiction_conflict');
    expect(second.existing?.jurisdiction).toBe('eu');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved!.property.jurisdiction).toBe('eu');
  });

  it('storage trigger aborts jurisdiction UPDATE', async () => {
    const propertyId = `prop_trig_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const first = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_a',
    });
    expect(first.ok).toBe(true);

    const upd = await tryUpdatePropertyJurisdiction(env, propertyId, 'us');
    expect(upd.ok).toBe(false);
    expect(upd.ok === false && /immutable/i.test(upd.error)).toBe(true);

    const row = await resolvePropertyFromRegistry(env, propertyId);
    expect(row!.property.jurisdiction).toBe('eu');
  });

  it('provisions null-jurisdiction property on default namespace', async () => {
    const propertyId = `prop_null_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Local Dev Hotel',
      jurisdiction: null,
      timeZone: 'America/New_York',
      currency: 'USD',
      actorUserId: 'user_dev',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.locationHint).toBe('enam');

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved!.property.jurisdiction).toBeNull();
    expect(await resolved!.stub.getRecordedJurisdiction()).toBeNull();
  });

  it('provision writes __meta.property_id and timezone into PropertyDO on first write only', async () => {
    const propertyId = `prop_tz_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'TZ Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(result.ok).toBe(true);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();
    expect(await resolved!.stub.getPropertyId()).toBe(propertyId);
    expect(await resolved!.stub.readStoredTimeZone()).toBe('Europe/Berlin');

    // Re-provision with a different timezone must not overwrite the stored one.
    await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'TZ Hotel',
      jurisdiction: 'eu',
      timeZone: 'America/Chicago',
      currency: 'USD',
      actorUserId: 'user_owner',
    });
    expect(await resolved!.stub.readStoredTimeZone()).toBe('Europe/Berlin');
  });

  it('provision writes ledger currency into PropertyDO on first write only', async () => {
    const propertyId = `prop_ccy_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Currency Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/London',
      currency: 'GBP',
      actorUserId: 'user_owner',
    });
    expect(result.ok).toBe(true);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(await resolved!.stub.readStoredLedgerCurrency()).toBe('GBP');

    await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Currency Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/London',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(await resolved!.stub.readStoredLedgerCurrency()).toBe('GBP');
  });

  it('rejects invalid ledger currency at provision', async () => {
    const result = await provisionProperty(env, {
      orgId: `org_${crypto.randomUUID()}`,
      propertyId: `prop_bad_ccy_${crypto.randomUUID()}`,
      name: 'Bad Currency Hotel',
      jurisdiction: null,
      timeZone: 'UTC',
      currency: 'nonsense',
      actorUserId: 'user_dev',
    });
    expect(result).toEqual({ ok: false, error: 'invalid_currency' });
  });

  it('provision sets __meta.business_date and arms the night-audit alarm schedule', async () => {
    const propertyId = `prop_bd_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const result = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'BD Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(result.ok).toBe(true);

    const resolved = await resolvePropertyFromRegistry(env, propertyId);
    expect(resolved).not.toBeNull();

    const businessDate = await resolved!.stub.readBusinessDate();
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const schedule = await resolved!.stub.getAlarmSchedule('night-audit');
    expect(schedule).not.toBeNull();
    expect(schedule!.nextRunAt).toBeGreaterThan(Date.now());

    // Re-provisioning must never overwrite the first-write business_date.
    await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'BD Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(await resolved!.stub.readBusinessDate()).toBe(businessDate);
  });

  it('readStoredTimeZone returns null for a PropertyDO that was never provisioned', async () => {
    const propertyId = `prop_unprovisioned_${crypto.randomUUID()}`;
    const stub = resolvePropertyStub(env.PROPERTY_DO, {
      orgId: `org_${crypto.randomUUID()}`,
      propertyId,
      jurisdiction: null,
      locationHint: 'enam',
    }) as DurableObjectStub<PropertyDO>;
    expect(await stub.readStoredTimeZone()).toBeNull();
    expect(await stub.getPropertyId()).toBeNull();
  });

  it('HTTP refuses simulate without HOSPAI_UNSAFE_LOCAL', async () => {
    const { default: worker } = await import('../src/index');
    const badEnv = {
      ...env,
      HOSPAI_JURISDICTION_MODE: 'simulate',
      HOSPAI_UNSAFE_LOCAL: undefined,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
    } as PmsEnv;
    const res = await worker.fetch(new Request('http://localhost/'), badEnv);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('misconfigured');
  });

  it('HTTP provision requires gated X-Dev-Actor on all /v1 routes', async () => {
    const propertyId = `prop_http_${crypto.randomUUID()}`;
    const orgId = `org_${crypto.randomUUID()}`;
    const { default: worker } = await import('../src/index');

    const orgCreated = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-dev-actor': 'user_http',
        },
        body: JSON.stringify({ orgId, name: 'HTTP Org' }),
      }),
      env,
    );
    expect(orgCreated.status).toBe(201);

    const denied = await worker.fetch(
      new Request('http://localhost/v1/orgs/' + orgId + '/properties', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          name: 'HTTP Hotel',
          jurisdiction: null,
          timeZone: 'America/Chicago',
          currency: 'USD',
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
          currency: 'USD',
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const gotDenied = await worker.fetch(
      new Request('http://localhost/v1/properties/' + propertyId),
      env,
    );
    expect(gotDenied.status).toBe(401);

    const got = await worker.fetch(
      new Request('http://localhost/v1/properties/' + propertyId, {
        headers: { 'x-dev-actor': 'user_http' },
      }),
      env,
    );
    expect(got.status).toBe(200);
    const body = (await got.json()) as { property: { propertyId: string } };
    expect(body.property.propertyId).toBe(propertyId);
  });
});
