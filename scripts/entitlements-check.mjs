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
let ENTITLEMENT_FAIL_CLOSED_OPT_OUT;
let PLATFORM_SEED_FEATURE_KEYS;

try {
  ({ FEATURE_KEYS, COMMAND_CATALOG, ENTITLEMENT_FAIL_CLOSED_OPT_OUT } = await import(contractsPath));
  ({ PLATFORM_SEED_FEATURE_KEYS } = await import(doRuntimePath));
} catch (e) {
  console.error('Build packages first: pnpm --filter @hospai/contracts build && pnpm --filter @hospai/do-runtime build');
  console.error(e);
  process.exit(1);
}

const allowed = new Set(FEATURE_KEYS);
const optOut = new Set(ENTITLEMENT_FAIL_CLOSED_OPT_OUT.map((entry) => entry.id));
let failed = false;

for (const entry of COMMAND_CATALOG) {
  if (!entry.entitlement) continue;
  if (!allowed.has(entry.entitlement)) {
    console.error(`Catalog entitlement not in FEATURE_KEYS: ${entry.id} → ${entry.entitlement}`);
    failed = true;
  }
}

for (const entry of COMMAND_CATALOG) {
  if (entry.degraded !== 'FAIL_CLOSED') continue;
  if (!entry.events?.length) continue;
  if (optOut.has(entry.id)) continue;
  if (!entry.entitlement) {
    console.error(
      `FAIL_CLOSED command missing entitlement (add entitlement or ENTITLEMENT_FAIL_CLOSED_OPT_OUT): ${entry.id}`,
    );
    failed = true;
  }
}

for (const { id, reason } of ENTITLEMENT_FAIL_CLOSED_OPT_OUT) {
  if (!reason?.trim()) {
    console.error(`ENTITLEMENT_FAIL_CLOSED_OPT_OUT missing reason: ${id}`);
    failed = true;
  }
  const entry = COMMAND_CATALOG.find((c) => c.id === id);
  if (!entry) {
    console.error(`ENTITLEMENT_FAIL_CLOSED_OPT_OUT references unknown command: ${id}`);
    failed = true;
    continue;
  }
  if (entry.degraded !== 'FAIL_CLOSED' || !entry.events?.length) {
    console.error(`ENTITLEMENT_FAIL_CLOSED_OPT_OUT entry is not FAIL_CLOSED with events: ${id}`);
    failed = true;
  }
  if (entry.entitlement) {
    console.error(`ENTITLEMENT_FAIL_CLOSED_OPT_OUT entry already has entitlement (remove from opt-out): ${id}`);
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
