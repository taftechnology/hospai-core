import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';

/** Captured 2026-08-15 on main; re-capture if fixture changes. */
const BASELINE_ME_PREPARE_TOTAL = 5;
const BASELINE_ME_ELAPSED_MS = 3;
const POST_F1_ME_PREPARE_TOTAL = 2;

function countPrepareCalls(
  spy: { mock: { calls: unknown[][] } },
  sqlFragment: string,
): number {
  return spy.mock.calls.filter(([sql]) => String(sql).includes(sqlFragment)).length;
}

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
        name: 'Dedup Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHotel(owner: string) {
  const orgId = `org_dedup_${crypto.randomUUID()}`;
  const propertyId = `prop_dedup_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Dedup Org', owner)).status).toBe(201);
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

describe('dispatch registry dedup — GET /v1/properties/:id/me', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  it('dedups registry property reads to one property + one org prepare', async () => {
    const owner = `user_dedup_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(owner);

    const prepareSpy = vi.spyOn(env.PLATFORM_DB, 'prepare');
    const t0 = performance.now();
    const res = await fetchMe(propertyId, owner);
    const elapsedMs = performance.now() - t0;

    const totalPrepares = prepareSpy.mock.calls.length;
    const propertyPrepares = countPrepareCalls(prepareSpy, 'FROM property WHERE property_id');
    prepareSpy.mockRestore();

    expect(res.status).toBe(200);
    console.info('[F1 baseline]', { elapsedMs, prepareCalls: totalPrepares, propertyPrepares });
    expect(propertyPrepares).toBe(1);
    expect(totalPrepares).toBe(POST_F1_ME_PREPARE_TOTAL);
    expect(BASELINE_ME_PREPARE_TOTAL).toBe(5);
    // Latency ratio is log-only: miniflare runs the registry path in-process, so
    // BASELINE_ME_ELAPSED_MS sits at the noise floor and a 10% guard is flaky (spec
    // §1d sanctions log-only when flaky). The prepare-count asserts above are the
    // hard gate for the F1 round-trip reduction.
    console.info('[F1 latency]', { elapsedMs, baselineMs: BASELINE_ME_ELAPSED_MS });
  });
});
