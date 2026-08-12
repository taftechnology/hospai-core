import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { hasEventLogR2 } from '../src/event-log.js';
import { initialStores, replaceStore } from '../src/purge-certificate.js';
import type { PmsEnv } from '../src/env.js';

describe('initialStores', () => {
  it('in-scope stores start pending; iceberg skipped; r2 pending when bound', () => {
    expect(hasEventLogR2(env)).toBe(true);
    const stores = initialStores(env);
    for (const name of ['key_store', 'property_do', 'org_do', 'r2'] as const) {
      const row = stores.find((s) => s.store === name)!;
      expect(row).toEqual({ store: name, status: 'pending' });
      expect('deleted' in row).toBe(false);
    }
    expect(stores.find((s) => s.store === 'iceberg')).toEqual({
      store: 'iceberg',
      status: 'skipped',
      reason: 'no_iceberg_binding',
    });
  });

  it('no binding → r2 skipped no_r2_binding; DOs still pending', () => {
    const bare = { PLATFORM_DB: env.PLATFORM_DB } as PmsEnv;
    const stores = initialStores(bare);
    expect(stores.find((s) => s.store === 'r2')).toEqual({
      store: 'r2',
      status: 'skipped',
      reason: 'no_r2_binding',
    });
    expect(stores.find((s) => s.store === 'property_do')).toEqual({
      store: 'property_do',
      status: 'pending',
    });
  });

  it('replaceStore drops pending fields on reached', () => {
    const stores = initialStores(env);
    replaceStore(stores, { store: 'r2', status: 'reached', deleted: 3 });
    expect(stores.find((s) => s.store === 'r2')).toEqual({
      store: 'r2',
      status: 'reached',
      deleted: 3,
    });
  });
});
