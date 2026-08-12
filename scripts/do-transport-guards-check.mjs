#!/usr/bin/env node
/**
 * GET handlers that await PropertyDO/OrgDO must contain a transport-failure guard.
 * Mutation handlers with FAIL_CLOSED/QUEUE_PROVISIONAL commandId must use
 * invokePropertyDo (or a known wrapper whose body has a rail) or an OrgDO
 * transport guard. PropertyDO mutations may not satisfy the gate via a bare
 * isPropertyDoTransportFailure catch — that path historically omitted catalog
 * shape (degraded/commandId/reason/Retry-After).
 *
 *   node scripts/do-transport-guards-check.mjs
 *   node scripts/do-transport-guards-check.mjs --self-test
 *
 * Allowlist: GET handlers with no DO await (D1/registry-only). Re-scan when adding GET routes.
 */
import { realpathSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contractsPath = join(root, 'packages/contracts/dist/index.js');

/** Handlers that intentionally do not touch a DO stub. */
const ALLOWLIST = new Set([
  'handleGetRegistryProperty', // D1 getProperty only
]);

const DO_AWAIT_SIGNAL =
  /\.stub\.|resolveOrgStub|listPropertyRefs|ORG_DO|getRecordedJurisdiction|getSchemaVersion/;

const GUARD_SIGNAL = /isPropertyDoTransportFailure|isOrgDoTransportFailure/;
/** Mutation OrgDO-backed routes (guests / property details) — not PropertyDO. */
const MUTATION_ORG_GUARD_SIGNAL = /isOrgDoTransportFailure/;
const INVOKE_SIGNAL = /invokePropertyDo/;
const WRAPPER_SIGNAL = /handlePostReservationStatusAction\s*\(/;
const STATUS_ACTION_WRAPPER = 'handlePostReservationStatusAction';

export function extractHandlerBody(src, handlerName) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${handlerName}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  // Walk the parameter list first — typed params may contain `{ ... }` objects
  // (e.g. handlePostReservationStatusAction's actor shape) before the body brace.
  let i = m.index + m[0].length - 1; // opening '(' of params
  let depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length || src[i] !== '{') return null;
  const bodyStart = i;
  depth = 0;
  for (let j = bodyStart; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, j + 1);
    }
  }
  return null;
}

function parseV1RoutesSlice(dispatchSrc) {
  const routesStart = dispatchSrc.indexOf('export const V1_ROUTES: V1RouteDef[] = [');
  if (routesStart === -1) throw new Error('Could not find V1_ROUTES');
  const routesEnd = dispatchSrc.indexOf('];', routesStart);
  if (routesEnd === -1) throw new Error('Could not find end of V1_ROUTES');
  return dispatchSrc.slice(routesStart, routesEnd);
}

function parseGetHandlers(dispatchSrc) {
  const routesSrc = parseV1RoutesSlice(dispatchSrc);
  const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];
  const handlers = new Set();
  for (const block of routeBlocks) {
    if (!/method:\s*'GET'/.test(block)) continue;
    const handlerMatch = block.match(/handler:\s*([A-Za-z0-9_]+)/);
    if (handlerMatch) handlers.add(handlerMatch[1]);
  }
  return [...handlers];
}

function parseCommandMutationRoutes(dispatchSrc) {
  const routesSrc = parseV1RoutesSlice(dispatchSrc);
  const routeBlocks = routesSrc.match(/\{[^{}]+\}/gs) || [];
  const routes = [];
  for (const block of routeBlocks) {
    if (/method:\s*'GET'/.test(block)) continue;
    const commandMatch = block.match(/commandId:\s*'([^']+)'/);
    if (!commandMatch) continue;
    const handlerMatch = block.match(/handler:\s*([A-Za-z0-9_]+)/);
    if (!handlerMatch) continue;
    routes.push({ handler: handlerMatch[1], commandId: commandMatch[1] });
  }
  return routes;
}

export function handlerHasDegradedRail(dispatchSrc, body) {
  if (INVOKE_SIGNAL.test(body) || MUTATION_ORG_GUARD_SIGNAL.test(body)) return true;
  if (!WRAPPER_SIGNAL.test(body)) return false;
  const wrapper = extractHandlerBody(dispatchSrc, STATUS_ACTION_WRAPPER);
  // One-level resolve: name alone is not a rail — wrapper body must invokePropertyDo.
  return wrapper != null && INVOKE_SIGNAL.test(wrapper);
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

export function checkMutationDegradedRails(dispatchSrc, commandCatalog) {
  const catalogById = new Map(commandCatalog.map((entry) => [entry.id, entry]));
  const errors = [];

  for (const { handler, commandId } of parseCommandMutationRoutes(dispatchSrc)) {
    const entry = catalogById.get(commandId);
    if (!entry || entry.degraded === 'N/A') continue;

    const body = extractHandlerBody(dispatchSrc, handler);
    if (!body) {
      errors.push(`${handler} (${commandId}): could not extract function body`);
      continue;
    }
    if (!handlerHasDegradedRail(dispatchSrc, body)) {
      errors.push(
        `${handler} (${commandId}): mutation lacks invokePropertyDo, wrapper rail, or OrgDO transport guard`,
      );
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
    console.error('self-test GET FAILED: expected unguarded GET to fail');
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
    console.error('self-test GET FAILED: guarded GET should pass');
    failed = true;
  }

  const mockCatalog = [
    { id: 'reservations.create', degraded: 'FAIL_CLOSED' },
    { id: 'reservations.check_in', degraded: 'QUEUE_PROVISIONAL' },
  ];

  const mutationUnguarded = `
async function handlePostBad(ctx) {
  const result = await resolved.stub.tryCreateReservation(actor, payload, idem);
  return json(result, 201);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/bad$/, permission: 'reservations:write', commandId: 'reservations.create', handler: handlePostBad },
];
`;
  if (checkMutationDegradedRails(mutationUnguarded, mockCatalog).length === 0) {
    console.error('self-test mutation FAILED: expected unguarded mutation to fail');
    failed = true;
  }

  const mutationInvoke = `
async function handlePostOk(ctx) {
  const invoked = await invokePropertyDo({ invoke: () => stub.tryCreateReservation() });
  return json(invoked.result, 201);
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/ok$/, permission: 'reservations:write', commandId: 'reservations.create', handler: handlePostOk },
];
`;
  if (checkMutationDegradedRails(mutationInvoke, mockCatalog).length !== 0) {
    console.error('self-test mutation FAILED: invokePropertyDo handler should pass');
    failed = true;
  }

  const mutationGuard = `
async function handlePostGuard(ctx) {
  try {
    return json(await org.tryCreateGuest(), 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return json({ error: 'org_unreachable' }, 503);
    throw e;
  }
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/guard$/, permission: 'guests:write', commandId: 'reservations.create', handler: handlePostGuard },
];
`;
  if (checkMutationDegradedRails(mutationGuard, mockCatalog).length !== 0) {
    console.error('self-test mutation FAILED: OrgDO transport-guard handler should pass');
    failed = true;
  }

  const mutationPropertyGuardOnly = `
async function handlePostPropGuard(ctx) {
  try {
    return json(await stub.tryCreateReservation(), 201);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return json({ error: 'property_unreachable' }, 503);
    throw e;
  }
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/prop$/, permission: 'reservations:write', commandId: 'reservations.create', handler: handlePostPropGuard },
];
`;
  if (checkMutationDegradedRails(mutationPropertyGuardOnly, mockCatalog).length === 0) {
    console.error(
      'self-test mutation FAILED: bare isPropertyDoTransportFailure must not satisfy FAIL_CLOSED mutation gate',
    );
    failed = true;
  }

  const mutationWrapperOk = `
async function handlePostReservationStatusAction(
  ctx,
  reservationId,
  commandId,
  routeId,
  action: (actor: { kind: 'user'; userId: string }) => Promise<{ ok: boolean }>,
): Promise<Response> {
  const invoked = await invokePropertyDo({ commandId, invoke: () => action() });
  if (invoked.kind === 'response') return invoked.response;
  return json(invoked.result, 200);
}
async function handlePostCheckIn(ctx) {
  return handlePostReservationStatusAction(ctx, 'r', 'reservations.check_in', 'post_check_in', () => stub.tryCheckIn());
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/ci$/, permission: 'reservations:write', commandId: 'reservations.check_in', handler: handlePostCheckIn },
];
`;
  if (checkMutationDegradedRails(mutationWrapperOk, mockCatalog).length !== 0) {
    console.error('self-test mutation FAILED: wrapper with invokePropertyDo should pass');
    failed = true;
  }

  const mutationWrapperBare = `
async function handlePostReservationStatusAction(
  ctx,
  reservationId,
  commandId,
  routeId,
  action: (actor: { kind: 'user'; userId: string }) => Promise<{ ok: boolean }>,
): Promise<Response> {
  const result = await action();
  return json(result, 200);
}
async function handlePostCheckIn(ctx) {
  return handlePostReservationStatusAction(ctx, 'r', 'reservations.check_in', 'post_check_in', () => stub.tryCheckIn());
}
export const V1_ROUTES: V1RouteDef[] = [
  { scope: 'property', method: 'POST', pattern: /^\\/ci$/, permission: 'reservations:write', commandId: 'reservations.check_in', handler: handlePostCheckIn },
];
`;
  if (checkMutationDegradedRails(mutationWrapperBare, mockCatalog).length === 0) {
    console.error('self-test mutation FAILED: wrapper without rail must fail');
    failed = true;
  }

  if (failed) process.exit(1);
  console.log('check:do-transport-guards --self-test OK');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  let COMMAND_CATALOG;
  try {
    ({ COMMAND_CATALOG } = await import(contractsPath));
  } catch (e) {
    console.error('Build packages first: pnpm --filter @hospai/contracts build');
    console.error(e);
    process.exit(1);
  }

  const dispatchSrc = readFileSync(join(root, 'apps/pms-core/src/v1-dispatch.ts'), 'utf8');
  const errors = [
    ...checkDoTransportGuards(dispatchSrc),
    ...checkMutationDegradedRails(dispatchSrc, COMMAND_CATALOG),
  ];

  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  console.log('OK do-transport-guards');
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  await main();
} else if (process.argv[1]) {
  // Imported as a module — do not run. If argv looks like a script entry but
  // realpath comparison failed, refuse silent no-op when --self-test / check
  // intent is present on argv.
  const wantsRun =
    process.argv.includes('--self-test') ||
    process.argv.some((a) => a.endsWith('do-transport-guards-check.mjs'));
  if (wantsRun) {
    console.error(
      'check:do-transport-guards: refused to run — process.argv[1] did not resolve to this module',
    );
    process.exit(1);
  }
}
