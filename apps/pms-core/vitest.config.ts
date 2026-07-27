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
          },
        },
      },
    },
  },
});
