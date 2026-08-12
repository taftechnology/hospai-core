import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROPERTY_SCHEMA_HEAD } from '@hospai/do-runtime';
import { provisionedPropertyStub } from './fixtures.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

describe('purge DO smoke', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('deleteAll remigrates empty; purge does not touchInteractive', async () => {
    const propertyId = `purge_smoke_${crypto.randomUUID().slice(0, 8)}`;
    const stub = await provisionedPropertyStub(propertyId, 'UTC', 'USD');

    await stub.resetLaneGuardForTest({ quietMs: 60_000 });
    await stub.touchInteractiveForTest();
    const touched = await stub.getLaneGuardLastInteractiveAtForTest();
    expect(touched).toBeGreaterThan(0);

    const denied = await stub.purgeStorageForTenant();
    expect(denied).toEqual({ ok: false, error: 'bulk_not_admitted' });
    expect(await stub.getLaneGuardLastInteractiveAtForTest()).toBe(touched);

    await stub.resetLaneGuardForTest();
    expect(await stub.countNonBookkeepingRows()).toBeGreaterThan(0);

    const beforePurge = await stub.getLaneGuardLastInteractiveAtForTest();
    const wiped = await stub.purgeStorageForTenant();
    expect(wiped.ok).toBe(true);
    expect(await stub.getLaneGuardLastInteractiveAtForTest()).toBe(beforePurge);

    // Post-deleteAll, pre-remigrate: no user schema → 0 residue
    expect(await stub.countNonBookkeepingRows()).toBe(0);
    // Remigrate path (VERIFY re-open / getSchemaVersion)
    expect(await stub.getSchemaVersion()).toBe(PROPERTY_SCHEMA_HEAD);
  });
});
