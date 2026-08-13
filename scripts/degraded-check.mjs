#!/usr/bin/env node
/**
 * Verify degraded-mode route audit + replay registry alignment.
 *
 *   node scripts/degraded-check.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsPath = join(root, 'packages/contracts/dist/index.js');
const consumerSrcPath = join(root, 'apps/pms-core/src/pending-commands-consumer.ts');
const replaySrcPath = join(root, 'apps/pms-core/src/replay-dispatch.ts');

let COMMAND_CATALOG;
let V1_HTTP_ROUTE_AUDIT;

try {
  ({ COMMAND_CATALOG, V1_HTTP_ROUTE_AUDIT } = await import(contractsPath));
} catch (e) {
  console.error('Build packages first: pnpm --filter @hospai/contracts build');
  console.error(e);
  process.exit(1);
}

const consumerSrc = readFileSync(consumerSrcPath, 'utf8');
const replaySrc = readFileSync(replaySrcPath, 'utf8');
const replayBlock =
  replaySrc.match(/export const REPLAY_DISPATCH[^=]*=\s*\{([\s\S]*?)\n\};/) ??
  consumerSrc.match(/export const REPLAY_DISPATCH[^=]*=\s*\{([\s\S]*?)\n\};/);
const REPLAY_COMMAND_IDS = replayBlock
  ? [...replayBlock[1].matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1])
  : [];

const dispatchPath = join(root, 'apps/pms-core/src/v1-dispatch.ts');
const dispatchSrc = readFileSync(dispatchPath, 'utf8');
const routesStart = dispatchSrc.indexOf('export const V1_ROUTES: V1RouteDef[] = [');
const routesEnd = dispatchSrc.indexOf('];', routesStart);
const routesSrc = dispatchSrc.slice(routesStart, routesEnd);
const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];

let failed = false;

if (routeBlocks.length !== V1_HTTP_ROUTE_AUDIT.length) {
  console.error(
    `Route count drift: V1_ROUTES=${routeBlocks.length}, V1_HTTP_ROUTE_AUDIT=${V1_HTTP_ROUTE_AUDIT.length}`,
  );
  failed = true;
}

for (const row of V1_HTTP_ROUTE_AUDIT) {
  if (row.scope !== 'property') continue;
  const hasCommand = 'commandId' in row && row.commandId;
  const hasDegradedRead = 'degradedRead' in row && row.degradedRead;
  if (hasCommand && hasDegradedRead) {
    console.error(`Route ${row.id}: commandId and degradedRead are mutually exclusive`);
    failed = true;
  }
}

const httpCommandIds = V1_HTTP_ROUTE_AUDIT.filter(
  (row) => row.scope === 'property' && 'commandId' in row && row.commandId,
).map((row) => row.commandId);

for (const commandId of httpCommandIds) {
  const entry = COMMAND_CATALOG.find((c) => c.id === commandId);
  if (entry?.degraded === 'QUEUE_PROVISIONAL' && !REPLAY_COMMAND_IDS.includes(commandId)) {
    console.error(`HTTP-routed QUEUE_PROVISIONAL command ${commandId} has no replay dispatch entry`);
    failed = true;
  }
}

for (const id of REPLAY_COMMAND_IDS) {
  const entry = COMMAND_CATALOG.find((c) => c.id === id);
  if (!entry || entry.degraded !== 'QUEUE_PROVISIONAL') {
    console.error(`Replay dispatch entry ${id} is not QUEUE_PROVISIONAL in catalog`);
    failed = true;
  }
}

for (const entry of COMMAND_CATALOG) {
  if (!entry.events?.includes('availability.changed')) continue;
  if (entry.degraded !== 'FAIL_CLOSED') {
    console.error(
      `Command ${entry.id} emits availability.changed but degraded=${entry.degraded} (must be FAIL_CLOSED)`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('check:degraded OK');
