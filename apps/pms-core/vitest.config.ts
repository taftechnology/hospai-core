import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineWorkersConfig({
  test: {
    // Cancels DO alarms a spec file leaves armed, so they cannot fire during later files.
    setupFiles: ['./test/setup/cancel-do-alarms.ts'],
    alias: {
      '@hospai/crypto-shredding/keystore-conformance': join(
        root,
        'packages/crypto-shredding/src/keystore-conformance.ts',
      ),
    },
    poolOptions: {
      workers: {
        // Queue consumer binding requires a single worker — one consumer per queue name.
        // isolatedStorage must stay false: @cloudflare/vitest-pool-workers refuses true when
        // the wrangler project defines Workflows (NightAuditWorkflow, MigrationSweepWorkflow, PurgeWorkflow).
        // That is a pool hard-error, not a shared-state preference — so the unbounded D1/DO
        // accumulation under singleWorker is mitigated by CI/local sharding, not isolation.
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: false,
        miniflare: {
          // A second, test-only registry for migration-sweep.spec.ts. The sweep visits every org
          // and property in the registry it reads; with shared storage the real PLATFORM_DB holds
          // every tenant the earlier files in the shard created, so a sweep over it wakes hundreds
          // of DOs and crashed shard 5. The spec copies only its own rows into this one.
          d1Databases: { MIGRATION_SWEEP_TEST_DB: { id: 'migration-sweep-test' } },
          bindings: {
            HOSPAI_UNSAFE_LOCAL: '1',
            HOSPAI_JURISDICTION_MODE: 'simulate',
            HOSPAI_PSP_MODE: 'simulate',
            HOSPAI_ALLOW_DEV_ACTOR: '1',
            HOSPAI_ORG_MASTER_KEY:
              '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
            ...(process.env.LEDGER_PROP_SEED
              ? { LEDGER_PROP_SEED: process.env.LEDGER_PROP_SEED }
              : {}),
          },
        },
      },
    },
  },
});
