import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineWorkersConfig({
  test: {
    alias: {
      '@hospai/crypto-shredding/keystore-conformance': join(
        root,
        'packages/crypto-shredding/src/keystore-conformance.ts',
      ),
    },
    poolOptions: {
      workers: {
        // Queue consumer binding requires a single worker — one consumer per queue name.
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: false,
        miniflare: {
          bindings: {
            HOSPAI_UNSAFE_LOCAL: '1',
            HOSPAI_JURISDICTION_MODE: 'simulate',
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
