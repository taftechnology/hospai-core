#!/usr/bin/env node
/**
 * Run @hospai/pms-core vitest in 8 sequential shards (matches CI matrix width).
 *
 * Do NOT put `--` before --shard: pnpm forwards a bare `--`, and vitest
 * then treats --shard as a file filter — every shard silently runs the full suite.
 *
 * CI test-pms-core excludes test/reservations-ledger.property.spec.ts (separate
 * test-pms-core-ledger-prop job). This script has NO --exclude so local shards
 * cover the full spec tree including the ledger property spec.
 */
import { spawnSync } from 'node:child_process';

const SHARD_COUNT = 8;

for (let shard = 1; shard <= SHARD_COUNT; shard++) {
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@hospai/pms-core',
      'exec',
      'vitest',
      'run',
      `--shard=${shard}/${SHARD_COUNT}`,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
