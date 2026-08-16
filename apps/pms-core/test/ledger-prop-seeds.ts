import { env } from 'cloudflare:test';

/** Resolved at module load inside the worker isolate via vitest miniflare.bindings. */
export function ledgerPropSeedCases(): Array<{ seed: number; label: string }> {
  const override = env.LEDGER_PROP_SEED?.trim();
  if (override) {
    const parsed = Number(override);
    if (!Number.isFinite(parsed)) {
      throw new Error(`LEDGER_PROP_SEED must be numeric, got: ${override}`);
    }
    const seed = parsed >>> 0;
    return [{ seed, label: `0x${seed.toString(16)}` }];
  }
  const defaults = [
    0xdecaf, 0xcafe, 0xbeef, 0xfeed, 0xface,
    0x1a2b, 0x2b3c, 0x3c4d, 0x4d5e, 0x5e6f,
    0x6f70, 0x7081, 0x8192, 0x92a3, 0xa3b4,
    0xb4c5, 0xc5d6, 0xd6e7, 0xe7f8, 0xf809,
    0xabcd, 0xbcde, 0xcdef, 0xdef0,
  ];
  return defaults.map((seed) => ({ seed, label: `0x${seed.toString(16)}` }));
}
