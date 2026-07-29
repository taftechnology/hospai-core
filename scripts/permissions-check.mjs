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

// --- Drift check: verify V1_HTTP_ROUTE_AUDIT matches V1_ROUTES in v1-dispatch.ts ---
const dispatchPath = join(root, 'apps/pms-core/src/v1-dispatch.ts');
const dispatchSrc = readFileSync(dispatchPath, 'utf8');

const routesStart = dispatchSrc.indexOf('export const V1_ROUTES: V1RouteDef[] = [');
if (routesStart === -1) {
  console.error('Could not find V1_ROUTES in v1-dispatch.ts');
  process.exit(1);
}
const routesEnd = dispatchSrc.indexOf('];', routesStart);
if (routesEnd === -1) {
  console.error('Could not find end of V1_ROUTES in v1-dispatch.ts');
  process.exit(1);
}

const routesSrc = dispatchSrc.slice(routesStart, routesEnd);
const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];

const parsedRoutes = routeBlocks.map((block) => {
  const scopeMatch = block.match(/scope:\s*'([^']+)'/);
  const permissionMatch = block.match(/permission:\s*'([^']+)'/);
  const commandIdMatch = block.match(/commandId:\s*'([^']+)'/);
  const entitlementMatch = block.match(/entitlement:\s*'([^']+)'/);

  const res = {
    scope: scopeMatch ? scopeMatch[1] : undefined,
  };
  if (permissionMatch) res.permission = permissionMatch[1];
  if (commandIdMatch) res.commandId = commandIdMatch[1];
  if (entitlementMatch) res.entitlement = entitlementMatch[1];
  return res;
});

if (parsedRoutes.length !== V1_HTTP_ROUTE_AUDIT.length) {
  console.error(`Drift detected: V1_ROUTES in v1-dispatch.ts has ${parsedRoutes.length} entries, but V1_HTTP_ROUTE_AUDIT has ${V1_HTTP_ROUTE_AUDIT.length} entries.`);
  failed = true;
} else {
  for (let i = 0; i < parsedRoutes.length; i++) {
    const parsed = parsedRoutes[i];
    const audit = V1_HTTP_ROUTE_AUDIT[i];
    const keys = ['scope', 'permission', 'commandId', 'entitlement'];
    for (const key of keys) {
      if (parsed[key] !== audit[key]) {
        console.error(`Drift detected at route index ${i} (audit id: '${audit.id}'): field '${key}' mismatch. Dispatch: '${parsed[key]}', Audit: '${audit[key]}'`);
        failed = true;
      }
    }
  }
}


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
