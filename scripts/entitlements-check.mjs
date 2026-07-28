#!/usr/bin/env node
/**
 * Verify COMMAND_CATALOG entitlement keys and D1 seed feature keys ⊆ FEATURE_KEYS.
 *
 *   node scripts/entitlements-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsPath = join(root, 'packages/contracts/dist/index.js');
const doRuntimePath = join(root, 'packages/do-runtime/dist/index.js');

let FEATURE_KEYS;
let COMMAND_CATALOG;
let PLATFORM_SEED_FEATURE_KEYS;

try {
  ({ FEATURE_KEYS, COMMAND_CATALOG } = await import(contractsPath));
  ({ PLATFORM_SEED_FEATURE_KEYS } = await import(doRuntimePath));
} catch (e) {
  console.error('Build packages first: pnpm --filter @hospai/contracts build && pnpm --filter @hospai/do-runtime build');
  console.error(e);
  process.exit(1);
}

const allowed = new Set(FEATURE_KEYS);
let failed = false;

for (const entry of COMMAND_CATALOG) {
  if (!entry.entitlement) continue;
  if (!allowed.has(entry.entitlement)) {
    console.error(`Catalog entitlement not in FEATURE_KEYS: ${entry.id} → ${entry.entitlement}`);
    failed = true;
  }
}

for (const key of PLATFORM_SEED_FEATURE_KEYS) {
  if (!allowed.has(key)) {
    console.error(`D1 seed feature key not in FEATURE_KEYS: ${key}`);
    failed = true;
  }
}

// Guard against union-with-string drift in entitlements.ts source
const entitlementsSrc = readFileSync(join(root, 'packages/contracts/src/entitlements.ts'), 'utf8');
if (/\|\s*string/.test(entitlementsSrc.match(/type FeatureKey[^;]+;/)?.[0] ?? '')) {
  console.error('FeatureKey must not include | string (defeats closed union)');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`OK entitlements: ${FEATURE_KEYS.length} keys, catalog + D1 seed aligned`);
