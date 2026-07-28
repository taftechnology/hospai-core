import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
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
