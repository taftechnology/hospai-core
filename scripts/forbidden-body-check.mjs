#!/usr/bin/env node
/**
 * Verify handler-level 403 forbidden bodies name a permission matching the route audit.
 *
 *   node scripts/forbidden-body-check.mjs
 *   node scripts/forbidden-body-check.mjs --self-test
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function parseRoutes(dispatchSrc) {
  const routesStart = dispatchSrc.indexOf('export const V1_ROUTES: V1RouteDef[] = [');
  if (routesStart === -1) throw new Error('Could not find V1_ROUTES');
  const routesEnd = dispatchSrc.indexOf('];', routesStart);
  if (routesEnd === -1) throw new Error('Could not find end of V1_ROUTES');
  const routesSrc = dispatchSrc.slice(routesStart, routesEnd);
  const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];
  return routeBlocks.map((block, index) => {
    const handlerMatch = block.match(/handler:\s*([A-Za-z0-9_]+)/);
    const permissionMatch = block.match(/permission:\s*'([^']+)'/);
    return {
      index,
      handler: handlerMatch ? handlerMatch[1] : undefined,
      permission: permissionMatch ? permissionMatch[1] : undefined,
    };
  });
}

function findForbidden403Returns(handlerBody) {
  const results = [];
  const re = /return\s+json\s*\(\s*(\{[\s\S]*?\})\s*,\s*403\s*\)/g;
  let m;
  while ((m = re.exec(handlerBody))) {
    const obj = m[1];
    if (!/error:\s*'forbidden'/.test(obj)) continue;
    const permLit = obj.match(/permission:\s*'([^']+)'/);
    const permNonLit = obj.match(/permission:\s*([A-Za-z0-9_.()]+)/);
    results.push({
      hasPermission: /permission\s*:/.test(obj),
      literal: permLit ? permLit[1] : null,
      nonLiteral: !permLit && permNonLit ? permNonLit[1] : null,
      snippet: obj.replace(/\s+/g, ' ').slice(0, 120),
    });
  }
  return results;
}

export function checkForbiddenBodies(dispatchSrc, auditPermissionsByIndex) {
  const errors = [];
  const routes = parseRoutes(dispatchSrc);
  if (routes.length !== auditPermissionsByIndex.length) {
    errors.push(
      `Route count drift: V1_ROUTES=${routes.length}, audit=${auditPermissionsByIndex.length}`,
    );
    return errors;
  }

  /** @type {Map<string, Set<string>>} */
  const handlerPerms = new Map();
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    if (!r.handler || !auditPermissionsByIndex[i]) continue;
    if (!handlerPerms.has(r.handler)) handlerPerms.set(r.handler, new Set());
    handlerPerms.get(r.handler).add(auditPermissionsByIndex[i]);
  }

  for (const [handler, perms] of handlerPerms) {
    const body = extractHandlerBody(dispatchSrc, handler);
    if (!body) continue;
    for (const hit of findForbidden403Returns(body)) {
      if (!hit.hasPermission) {
        errors.push(`${handler}: 403 forbidden missing permission (${hit.snippet})`);
        continue;
      }
      if (hit.literal != null) {
        for (const p of perms) {
          if (hit.literal !== p) {
            errors.push(
              `${handler}: 403 permission literal '${hit.literal}' !== audit '${p}'`,
            );
          }
        }
      }
      // non-literal accepted
    }
  }
  return errors;
}

function selfTest() {
  let failed = false;
  const multiRoute = `
async function handleFoo(ctx) {
  return json({ error: 'forbidden', permission: 'a:read' }, 403);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'GET', pattern: /^\\/a$/, permission: 'a:read', handler: handleFoo },
  { scope: 'property', method: 'GET', pattern: /^\\/b$/, permission: 'b:write', handler: handleFoo },
];
`;
  const e1 = checkForbiddenBodies(multiRoute, ['a:read', 'b:write']);
  if (e1.length === 0) {
    console.error('self-test 7a FAILED: expected multi-route mismatch to fail');
    failed = true;
  }

  const nonLit = `
async function handleBar(ctx) {
  const perm = 'x:write';
  return json({ error: 'forbidden', permission: perm }, 403);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/x$/, permission: 'x:write', handler: handleBar },
];
`;
  const e2 = checkForbiddenBodies(nonLit, ['x:write']);
  if (e2.length !== 0) {
    console.error('self-test 7b FAILED: non-literal should pass', e2);
    failed = true;
  }

  const missing = `
async function handleBaz(ctx) {
  return json({ error: 'forbidden' }, 403);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/z$/, permission: 'z:write', handler: handleBaz },
];
`;
  const e3 = checkForbiddenBodies(missing, ['z:write']);
  if (e3.length === 0) {
    console.error('self-test 7c FAILED: missing permission should fail');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:forbidden-bodies --self-test OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const contractsPath = join(root, 'packages/contracts/dist/index.js');
  let V1_HTTP_ROUTE_AUDIT;
  try {
    ({ V1_HTTP_ROUTE_AUDIT } = await import(contractsPath));
  } catch (e) {
    console.error('Build packages first: pnpm --filter @hospai/contracts build');
    console.error(e);
    process.exit(1);
  }
  const dispatchSrc = readFileSync(join(root, 'apps/pms-core/src/v1-dispatch.ts'), 'utf8');
  const auditPerms = V1_HTTP_ROUTE_AUDIT.map((r) => r.permission);
  const errors = checkForbiddenBodies(dispatchSrc, auditPerms);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log(`OK forbidden-bodies: ${V1_HTTP_ROUTE_AUDIT.length} routes`);
}
