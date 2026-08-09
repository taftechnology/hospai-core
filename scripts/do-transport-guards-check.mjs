#!/usr/bin/env node
/**
 * GET handlers that await PropertyDO/OrgDO must contain a transport-failure guard.
 *
 *   node scripts/do-transport-guards-check.mjs
 *   node scripts/do-transport-guards-check.mjs --self-test
 *
 * Allowlist: GET handlers with no DO await (D1/registry-only). Re-scan when adding GET routes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Handlers that intentionally do not touch a DO stub. */
const ALLOWLIST = new Set([
  'handleGetRegistryProperty', // D1 getProperty only
]);

const DO_AWAIT_SIGNAL =
  /\.stub\.|resolveOrgStub|listPropertyRefs|ORG_DO|getRecordedJurisdiction|getSchemaVersion/;

const GUARD_SIGNAL = /isPropertyDoTransportFailure|isOrgDoTransportFailure/;

function extractHandlerBody(src, handlerName) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${handlerName}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  let i = src.indexOf('{', m.index);
  if (i === -1) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

function parseGetHandlers(dispatchSrc) {
  const routesStart = dispatchSrc.indexOf('export const V1_ROUTES: V1RouteDef[] = [');
  if (routesStart === -1) throw new Error('Could not find V1_ROUTES');
  const routesEnd = dispatchSrc.indexOf('];', routesStart);
  if (routesEnd === -1) throw new Error('Could not find end of V1_ROUTES');
  const routesSrc = dispatchSrc.slice(routesStart, routesEnd);
  const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];
  const handlers = new Set();
  for (const block of routeBlocks) {
    if (!/method:\s*'GET'/.test(block)) continue;
    const handlerMatch = block.match(/handler:\s*([A-Za-z0-9_]+)/);
    if (handlerMatch) handlers.add(handlerMatch[1]);
  }
  return [...handlers];
}

export function checkDoTransportGuards(dispatchSrc, allowlist = ALLOWLIST) {
  const errors = [];
  for (const handler of parseGetHandlers(dispatchSrc)) {
    if (allowlist.has(handler)) continue;
    const body = extractHandlerBody(dispatchSrc, handler);
    if (!body) {
      errors.push(`${handler}: could not extract function body`);
      continue;
    }
    if (!DO_AWAIT_SIGNAL.test(body)) continue;
    if (!GUARD_SIGNAL.test(body)) {
      errors.push(`${handler}: GET handler awaits DO without transport guard`);
    }
  }
  return errors;
}

function selfTest() {
  let failed = false;
  const unguarded = `
async function handleGetBad(ctx) {
  const resolved = await resolvePropertyFromRegistry(ctx.env, 'p');
  return json(await resolved.stub.listProvisionalExceptions(), 200);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'GET', pattern: /^\\/bad$/, permission: 'property:read', handler: handleGetBad },
];
`;
  if (checkDoTransportGuards(unguarded, new Set()).length === 0) {
    console.error('self-test 8b FAILED: expected unguarded GET to fail');
    failed = true;
  }

  const guarded = `
async function handleGetOk(ctx) {
  try {
    return json(await resolved.stub.listProvisionalExceptions(), 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'GET', pattern: /^\\/ok$/, permission: 'property:read', handler: handleGetOk },
];
`;
  if (checkDoTransportGuards(guarded, new Set()).length !== 0) {
    console.error('self-test FAILED: guarded GET should pass');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:do-transport-guards --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const dispatchSrc = readFileSync(join(root, 'apps/pms-core/src/v1-dispatch.ts'), 'utf8');
  const errors = checkDoTransportGuards(dispatchSrc);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log('OK do-transport-guards');
}
