#!/usr/bin/env node
/**
 * Verify COMMAND_CATALOG permissions, ROLE_GRANTS coverage, and HTTP route audit.
 *
 *   node scripts/permissions-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsPath = join(root, 'packages/contracts/dist/index.js');

let PERMISSIONS;
let PLATFORM_ONLY_PERMISSIONS;
let ROLE_GRANTS;
let COMMAND_CATALOG;
let COMMAND_BY_ID;
let V1_HTTP_ROUTE_AUDIT;

try {
  ({
    PERMISSIONS,
    PLATFORM_ONLY_PERMISSIONS,
    ROLE_GRANTS,
    COMMAND_CATALOG,
    COMMAND_BY_ID,
    V1_HTTP_ROUTE_AUDIT,
  } = await import(contractsPath));
} catch (e) {
  console.error('Build packages first: pnpm --filter @hospai/contracts build');
  console.error(e);
  process.exit(1);
}

const allowed = new Set(PERMISSIONS);
const platformOnly = new Set(PLATFORM_ONLY_PERMISSIONS);
let failed = false;

for (const entry of COMMAND_CATALOG) {
  if (!entry.permission) {
    console.error(`Catalog entry missing permission: ${entry.id}`);
    failed = true;
    continue;
  }
  if (!allowed.has(entry.permission)) {
    console.error(`Catalog permission not in PERMISSIONS: ${entry.id} → ${entry.permission}`);
    failed = true;
  }
}

const granted = new Set();
for (const role of Object.keys(ROLE_GRANTS)) {
  for (const p of ROLE_GRANTS[role]) {
    granted.add(p);
  }
}

const catalogPermissions = new Set(COMMAND_CATALOG.map((e) => e.permission));
for (const p of catalogPermissions) {
  if (platformOnly.has(p)) continue;
  if (!granted.has(p)) {
    console.error(`Catalog permission not granted to any role (and not platform-only): ${p}`);
    failed = true;
  }
}

for (const route of V1_HTTP_ROUTE_AUDIT) {
  if (route.scope === 'bootstrap' || route.scope === 'dev') continue;
  if (!route.permission) {
    console.error(`HTTP route audit missing permission: ${route.id}`);
    failed = true;
    continue;
  }
  if (platformOnly.has(route.permission)) {
    console.error(`HTTP route uses platform-only permission: ${route.id} → ${route.permission}`);
    failed = true;
  }
  if (route.commandId && !COMMAND_BY_ID.has(route.commandId)) {
    console.error(`HTTP route commandId not in catalog: ${route.id} → ${route.commandId}`);
    failed = true;
  }
}

const catalogSrc = readFileSync(join(root, 'packages/contracts/src/commands/catalog.ts'), 'utf8');
if (/\|\s*string/.test(catalogSrc.match(/permission: Permission[^;]*;/)?.[0] ?? '')) {
  console.error('CommandEntry.permission must not include | string (defeats closed union)');
  failed = true;
}

const permissionsSrc = readFileSync(join(root, 'packages/contracts/src/permissions.ts'), 'utf8');
if (/\|\s*string/.test(permissionsSrc.match(/type Permission[^;]+;/)?.[0] ?? '')) {
  console.error('Permission must not include | string (defeats closed union)');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(
  `OK permissions: ${PERMISSIONS.length} keys, ${COMMAND_CATALOG.length} catalog entries, ${V1_HTTP_ROUTE_AUDIT.length} HTTP routes`,
);
