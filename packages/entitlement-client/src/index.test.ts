import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntitlementSnapshot } from '@hospai/contracts';
import {
  EntitlementDoCache,
  EntitlementRequiredError,
  parseFeatureValue,
  readActiveEntitlementVersion,
  require,
  type EntitlementEnv,
} from './index.js';

describe('require', () => {
  const base: EntitlementSnapshot = {
    orgId: 'org_1',
    version: 1,
    features: { 'pms.core': true, 'pms.units.limit': 20 },
    limits: {},
    computedAt: '2026-01-01T00:00:00.000Z',
  };

  it('passes when pms.core is true', () => {
    expect(() => require(base, 'pms.core')).not.toThrow();
  });

  it('throws when pms.core is absent', () => {
    expect(() => require({ ...base, features: {} }, 'pms.core')).toThrow(EntitlementRequiredError);
  });

  it('passes when a unit limit is unlimited', () => {
    expect(() =>
      require({ ...base, features: { 'pms.core': true, 'pms.units.limit': 'unlimited' } }, 'pms.units.limit'),
    ).not.toThrow();
  });

  it('parses feature values', () => {
    expect(parseFeatureValue('BOOLEAN', 'true')).toBe(true);
    expect(parseFeatureValue('LIMIT', '20')).toBe(20);
    expect(parseFeatureValue('LIMIT', 'unlimited')).toBe('unlimited');
    expect(parseFeatureValue('CONFIG', 'required')).toBe('required');
  });
});

describe('EntitlementDoCache', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function mockEnv(version: number, d1Calls: { count: number }): EntitlementEnv {
    const snap: EntitlementSnapshot = {
      orgId: 'org_1',
      version,
      features: version > 0 ? { 'pms.core': true } : {},
      limits: {},
      computedAt: '2026-01-01T00:00:00.000Z',
    };
    return {
      PLATFORM_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => {
              d1Calls.count += 1;
              return version > 0 ? { entitlement_version: version } : null;
            },
          }),
        }),
      } as unknown as D1Database,
      ENTITLEMENT_KV: {
        get: async () => snap,
        put: async () => {},
      } as unknown as KVNamespace,
      ORG_ENTITLEMENT_DO: {} as DurableObjectNamespace,
    };
  }

  it('serves cached snapshot without D1 read within MAX_AGE_MS', async () => {
    const d1Calls = { count: 0 };
    const cache = new EntitlementDoCache();
    const env = mockEnv(1, d1Calls);

    await cache.load(env, 'org_1');
    const afterFirst = d1Calls.count;
    expect(afterFirst).toBeGreaterThan(0);

    await cache.load(env, 'org_1');
    expect(d1Calls.count).toBe(afterFirst);
  });

  it('re-resolves from D1 after MAX_AGE_MS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

    const d1Calls = { count: 0 };
    const cache = new EntitlementDoCache();
    const env = mockEnv(1, d1Calls);

    await cache.load(env, 'org_1');
    const afterFirst = d1Calls.count;

    vi.advanceTimersByTime(EntitlementDoCache.MAX_AGE_MS + 1);
    await cache.load(env, 'org_1');
    expect(d1Calls.count).toBeGreaterThan(afterFirst);
  });
});

describe('readActiveEntitlementVersion', () => {
  it('returns 0 when no active subscription', async () => {
    const env = {
      PLATFORM_DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
          }),
        }),
      } as unknown as D1Database,
    } as EntitlementEnv;
    await expect(readActiveEntitlementVersion(env, 'org_x')).resolves.toBe(0);
  });
});
