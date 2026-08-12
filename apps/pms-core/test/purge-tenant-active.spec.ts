import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { closeOrgForPurge } from '../src/purge-certificate.js';
import {
  createOrg,
  ensurePlatformSchema,
  insertProperty,
  resetPlatformSchemaGate,
  trySetPropertyStatus,
} from '../src/registry.js';

const actor = 'user_owner';

describe('assertTenantActive gates', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('resolvePropertyContext returns 404 not_found when property status is purging', async () => {
    const orgId = `org_gate_${crypto.randomUUID().slice(0, 8)}`;
    const propertyId = `prop_gate_${crypto.randomUUID().slice(0, 8)}`;
    expect(await createOrg(env, orgId, 'Gate')).toBe(true);
    await insertProperty(env, {
      propertyId,
      orgId,
      name: 'Gate',
      jurisdiction: null,
      timeZone: 'UTC',
    });
    expect((await trySetPropertyStatus(env, propertyId, 'purging')).ok).toBe(true);

    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms`, {
        headers: { 'x-dev-actor': actor },
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('provisionProperty refused with 409 tenant_not_active when org is closing', async () => {
    const orgId = `org_close_${crypto.randomUUID().slice(0, 8)}`;
    const createRes = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ orgId, name: 'Close' }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    expect((await closeOrgForPurge(env, orgId, { now: () => 1_000, retentionMs: 60_000 })).ok).toBe(
      true,
    );

    const propertyId = `prop_close_${crypto.randomUUID().slice(0, 8)}`;
    const res = await worker.fetch(
      new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          propertyId,
          name: 'Nope',
          timeZone: 'UTC',
          currency: 'USD',
        }),
      }),
      env,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'tenant_not_active' });
  });
});
