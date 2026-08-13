import type { FeatureKey, Jurisdiction, ProvisionPropertyInput } from '@hospai/contracts';
import {
  ARCHIVE_BLOCKED,
  ALREADY_CANCELLED,
  BUSINESS_DATE_UNSET,
  FORBIDDEN,
  GUEST_ALREADY_ERASED,
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
  IDEM_KEY_REUSED,
  INVALID_STATUS_TRANSITION,
  LEDGER_INCONSISTENT,
  NO_AVAILABILITY,
  NO_SHOW_BEFORE_ARRIVAL,
  NOT_MODIFIABLE,
  InvalidTenantIdError,
  NOT_FOUND,
  OVERSELL,
  RESTRICTION_VIOLATED,
  ROOM_TYPE_EXISTS,
  ROOM_TYPE_CODE_EXISTS,
  ROOM_CODE_EXISTS,
  ROOM_COUNT_EXCEEDED,
  ROOM_UNITS_EXCEED_COUNT,
  ROOM_TYPE_MISMATCH,
  ROOM_ALREADY_ASSIGNED,
  ROOM_NOT_ASSIGNABLE,
  BALANCE_DUE,
  RATE_PLAN_NOT_FOUND,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  DEFAULT_RATE_PLAN_PROTECTED,
  CHARGE_CODE_NOT_FOUND,
  CHARGE_CODE_EXISTS,
  SYSTEM_CHARGE_CODE_PROTECTED,
  TAX_RULE_NOT_FOUND,
  TAX_RULE_KEY_EXISTS,
  TAX_RULE_KEY_OVERLAP,
  TAX_RULE_TYPE_UNSUPPORTED,
  TAX_OUTPUT_CODE_TAXABLE,
  ROLE_GRANTS,
  STAFF_EXITED,
  STAFF_NOT_ASSIGNABLE,
  STAFF_NOT_FOUND,
  SHIFT_NOT_FOUND,
  SHIFT_ALREADY_OPEN,
  SHIFT_NOT_OPEN,
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  UNBOOKABLE,
  CURRENCY_UNSET,
  CROSS_CURRENCY_UNSUPPORTED,
  FX_RATE_INVALID,
  LEDGER_AMOUNT_MISMATCH,
  MONEY_INVALID,
  SPLIT_AMOUNT_MISMATCH,
  LINE_NOT_SPLITTABLE,
  PSP_UNAVAILABLE,
  PAYMENT_NOT_CAPTURABLE,
  HOLD_EXPIRED,
  INQUIRY_EXPIRED,
  ROOM_REQUIRED,
  ROOM_NOT_READY,
  ROOM_OUT_OF_ORDER,
  OCCUPANCY_EXCEEDED,
  fingerprintPayload,
  requireCatalogEntry,
  requiredPermissionForKey,
  validateTenantId,
  type Permission,
  type IdempotencyKey,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID, TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
import {
  checkKillSwitch,
  EntitlementRequiredError,
  EntitlementResolutionError,
  loadSnapshot,
  require,
} from '@hospai/entitlement-client';
import { logError, logWarn, type ObservabilityContext } from '@hospai/observability';
import { resolveOrgStub } from '@hospai/tenant-router';
import { resolveActor, requirePermission, type Actor } from './auth.js';
import {
  clerkUnreachableResponse,
  lookupDirectoryByUserIds,
  lookupUserIdByEmail,
} from './clerk-lookup.js';
import { isDevActorAllowed, type PmsEnv } from './env.js';
import {
  degradedFailClosedOrgReadResponse,
  degradedFailClosedReadResponse,
  degradedReadStaleResponse,
  invokePropertyDo,
} from './invoke-property-do.js';
import { isPropertyDoTransportFailure } from './property-do-transport.js';
import { OrgDO } from './org-do.js';
import { NIGHT_AUDIT_HALTED, NIGHT_AUDIT_STEPS, type NightAuditStep, type PropertyDO } from './property-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { countPendingOpen } from './night-audit-census.js';
import {
  getOrCreateNightAuditWorkflow,
  mapNightAuditInstanceHttp,
} from './night-audit-http.js';
import { guestPurgeWorkflowId, closeOrgForPurge, nextOrgPurgeWorkflowId, reopenOrg } from './purge-certificate.js';
import { ensurePurgeWorkflowInstance } from './purge-workflow-create.js';
import { createOrg, getOrg, getProperty, assertTenantActive, updatePropertyName } from './registry.js';
import { isOrgDoTransportFailure } from './org-do-transport.js';
import {
  compensationWriteDenied,
  effectiveRosterGrants,
  profileFromHttpBody,
  stripRosterRow,
} from './roster-http.js';

type MembershipDoError =
  | 'not_member'
  | 'forbidden'
  | 'already_member'
  | 'role_escalation'
  | 'last_owner'
  | 'invalid_role';

function membershipErrorResponse(
  error: MembershipDoError,
  /** Route permission — required on 403 so the body matches the forbidden-bodies contract if the DO branch is ever reached after the HTTP gate. */
  permission: Permission,
): Response {
  switch (error) {
    case 'role_escalation':
    case 'last_owner':
    case 'invalid_role':
      return json({ error }, 422);
    case 'already_member':
      // Prefer alreadyMemberResponse from create handlers (includes userId + role).
      return json({ error }, 409);
    case 'not_member':
      return json({ error: 'not_member' }, 404);
    case 'forbidden':
      return json({ error: 'forbidden', permission }, 403);
  }
}

function alreadyMemberResponse(
  userId: string,
  role: 'owner' | 'admin' | 'staff',
): Response {
  return json({ error: 'already_member', userId, role }, 409);
}

type DirectoryFields = { displayName: string | null; email: string | null };

async function enrichMembersDirectory<T extends { userId: string }>(
  env: PmsEnv,
  members: T[],
): Promise<{ members: Array<T & DirectoryFields>; directory?: 'unavailable' }> {
  let directory: 'unavailable' | undefined;
  let byUserId = new Map<string, DirectoryFields>();
  try {
    const dir = await lookupDirectoryByUserIds(
      env,
      members.map((m) => m.userId),
    );
    if (!dir.ok) directory = 'unavailable';
    else byUserId = dir.byUserId;
  } catch {
    directory = 'unavailable';
  }
  return {
    members: members.map((m) => {
      const entry = byUserId.get(m.userId);
      return {
        ...m,
        displayName: entry?.displayName ?? null,
        email: entry?.email ?? null,
      };
    }),
    ...(directory ? { directory } : {}),
  };
}

function isOrgRole(role: unknown): role is 'owner' | 'admin' | 'staff' {
  return role === 'owner' || role === 'admin' || role === 'staff';
}

function isPropertyWriteRole(role: unknown): role is 'admin' | 'staff' {
  return role === 'admin' || role === 'staff';
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

function encodeFrontDeskCursor(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeFrontDeskCursor<T>(raw: string | null): T | null | 'invalid' {
  if (raw === null || raw === '') return null;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const binary = atob(padded + '='.repeat(padLen));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return 'invalid';
  }
}

function parseOptionalFrontDeskLimit(url: URL): number | undefined {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function mapAddRoomTypeErrorStatus(error: string): number {
  if (error === IDEM_KEY_REUSED || error === ROOM_TYPE_EXISTS || error === ROOM_TYPE_CODE_EXISTS) {
    return 409;
  }
  return 422;
}

function mapReservationCommandErrorStatus(error: string): number {
  if (error === IDEM_KEY_REUSED || error === ALREADY_CANCELLED || error === LEDGER_INCONSISTENT) {
    return 409;
  }
  if (error === NO_AVAILABILITY) return 409;
  if (
    error === UNBOOKABLE ||
    error === RESTRICTION_VIOLATED ||
    error === NOT_MODIFIABLE ||
    error === INVALID_STATUS_TRANSITION ||
    error === NO_SHOW_BEFORE_ARRIVAL ||
    error === CURRENCY_UNSET ||
    error === FX_RATE_INVALID ||
    error === LEDGER_AMOUNT_MISMATCH ||
    error === MONEY_INVALID ||
    error === CROSS_CURRENCY_UNSUPPORTED ||
    error === SPLIT_AMOUNT_MISMATCH ||
    error === LINE_NOT_SPLITTABLE ||
    error === ROOM_CODE_EXISTS ||
    error === ROOM_COUNT_EXCEEDED ||
    error === ROOM_UNITS_EXCEED_COUNT ||
    error === ROOM_TYPE_MISMATCH ||
    error === ROOM_ALREADY_ASSIGNED ||
    error === ROOM_NOT_ASSIGNABLE ||
    error === BALANCE_DUE ||
    error === HOLD_EXPIRED ||
    error === INQUIRY_EXPIRED ||
    error === ROOM_REQUIRED ||
    error === ROOM_NOT_READY ||
    error === ROOM_OUT_OF_ORDER ||
    error === OCCUPANCY_EXCEEDED ||
    error === RATE_PLAN_CODE_EXISTS ||
    error === RATE_PLAN_ID_EXISTS ||
    error === DEFAULT_RATE_PLAN_PROTECTED ||
    error === CHARGE_CODE_EXISTS ||
    error === SYSTEM_CHARGE_CODE_PROTECTED ||
    error === TAX_RULE_KEY_EXISTS ||
    error === TAX_RULE_KEY_OVERLAP ||
    error === TAX_RULE_TYPE_UNSUPPORTED ||
    error === TAX_OUTPUT_CODE_TAXABLE ||
    error === SHIFT_ALREADY_OPEN ||
    error === SHIFT_NOT_OPEN
  ) {
    return 422;
  }
  if (
    error === RATE_PLAN_NOT_FOUND ||
    error === CHARGE_CODE_NOT_FOUND ||
    error === TAX_RULE_NOT_FOUND ||
    error === SHIFT_NOT_FOUND
  ) {
    return 404;
  }
  if (error === BUSINESS_DATE_UNSET) return 500;
  if (error === 'org_id_unset') return 500;
  return mapAddRoomTypeErrorStatus(error);
}

/** Shared by the four guest handlers + `POST /reservations` guestRef lookup. */
function mapGuestCommandErrorStatus(error: string): number {
  if (error === GUEST_NOT_FOUND) return 404;
  if (error === GUEST_ALREADY_ERASED) return 409;
  if (error === GUEST_EXISTS) return 409;
  if (error === IDEM_KEY_REUSED) return 409;
  if (error === FORBIDDEN || error === 'scope_mismatch') return 403;
  if (error === 'not_member') return 404;
  if (error === 'org_id_unset') return 500;
  return 422;
}

function mapRosterCommandErrorStatus(error: string): number {
  if (error === STAFF_NOT_FOUND) return 404;
  if (error === STAFF_EXITED) return 409;
  if (error === IDEM_KEY_REUSED) return 409;
  if (error === FORBIDDEN || error === 'scope_mismatch') return 403;
  if (error === 'not_member') return 404;
  if (error === 'org_id_unset') return 500;
  return 422;
}

function mapConfigErrorStatus(error: string): number {
  if (error.startsWith('undeclared:') || error.startsWith('Only DOMAIN config')) return 400;
  if (error === IDEM_KEY_REUSED) return 409;
  if (error === FORBIDDEN || error === 'scope_mismatch') return 403;
  if (error === 'not_member') return 404;
  if (error === ENTITLEMENT_REQUIRED || error === ENTITLEMENT_UNAVAILABLE) return 503;
  return 422;
}

/** Resolve optional wire ratePlanId before fingerprint + DO call (§2.5a). */
export function normalizeRateDayCell(input: {
  roomTypeId: string;
  ratePlanId?: string;
  stayDate: string;
  amountMinor: number;
  currency: string;
}) {
  return {
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanId ?? DEFAULT_RATE_PLAN_ID,
    stayDate: input.stayDate,
    amountMinor: input.amountMinor,
    currency: input.currency,
  };
}

function requireIdempotencyHeader(request: Request): string | Response {
  const key = request.headers.get('x-idempotency-key');
  if (!key) return json({ error: 'invalid_body' }, 400);
  return key;
}

async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function logAriRejectOnCommit(
  observability: ObservabilityContext,
  quoteAriVersion: number | undefined,
  result: { error: typeof NO_AVAILABILITY; date: string; ariVersion: number },
  roomTypeId: string,
): void {
  if (quoteAriVersion === undefined) return;
  const classification =
    quoteAriVersion < result.ariVersion ? 'stale_projection' : 'genuine_race';
  logWarn(observability, {
    msg: 'ari.reject_on_commit',
    classification,
    quote_ari_version: quoteAriVersion,
    current_ari_version: result.ariVersion,
    room_type_id: roomTypeId,
    date: result.date,
  });
}

async function resolvePropertyContext(
  ctx: V1DispatchContext,
  propertyId: string,
): Promise<{ property: NonNullable<Awaited<ReturnType<typeof getProperty>>>; resolved: NonNullable<Awaited<ReturnType<typeof resolvePropertyFromRegistry>>> } | Response> {
  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;
  const gate = await assertTenantActive(ctx.env, { propertyId, orgId: property.orgId });
  if (!gate.ok) {
    if (gate.error === 'tenant_not_active') {
      logWarn(ctx.observability, {
        msg: 'tenant_not_active',
        propertyId,
        orgId: property.orgId,
        status: gate.status,
      });
    }
    return json({ error: 'not_found' }, 404);
  }
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  return { property, resolved };
}

async function gateEntitlement(env: PmsEnv, orgId: string, feature: FeatureKey): Promise<Response | null> {
  try {
    const snap = await loadSnapshot(env, orgId);
    require(snap, feature);
  } catch (e) {
    if (e instanceof EntitlementRequiredError) {
      return json({ error: e.code, feature: e.featureKey }, 402);
    }
    if (e instanceof EntitlementResolutionError) {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 503 });
  }
  return null;
}

export type V1DispatchContext = {
  request: Request;
  env: PmsEnv;
  observability: ObservabilityContext;
  actor: Actor;
  url: URL;
  match: RegExpMatchArray;
};

type V1RouteBase = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: RegExp;
  handler: (ctx: V1DispatchContext) => Promise<Response>;
};

type CommandLink =
  | { commandId: string; entitlement?: FeatureKey }
  | { entitlement: FeatureKey; commandId?: never }
  | { commandId?: never; entitlement?: never };

export type V1RouteDef =
  | (V1RouteBase & { scope: 'bootstrap' })
  | (V1RouteBase & { scope: 'dev' })
  | (V1RouteBase & { scope: 'org' } & { permission: Permission } & CommandLink)
  | (V1RouteBase & { scope: 'property' } & { permission: Permission } & CommandLink);

type ResolvedTenant = { orgId: string; propertyId: string | null };

async function resolveTenant(
  env: PmsEnv,
  route: V1RouteDef,
  match: RegExpMatchArray,
): Promise<ResolvedTenant | Response> {
  if (route.scope === 'org') {
    const orgId = decodeURIComponent(match[1]!);
    try {
      validateTenantId(orgId);
    } catch (e) {
      if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
      throw e;
    }
    const orgRow = await getOrg(env, orgId);
    if (!orgRow) return json({ error: 'not_found' }, 404);
    return { orgId, propertyId: null };
  }

  if (route.scope === 'property') {
    const propertyId = decodeURIComponent(match[1]!);
    const property = await getProperty(env, propertyId);
    if (!property) return json({ error: 'not_found' }, 404);
    return { orgId: property.orgId, propertyId };
  }

  throw new Error(`resolveTenant called for scope ${(route as V1RouteDef).scope}`);
}

function entitlementForRoute(route: V1RouteDef): FeatureKey | undefined {
  if (route.scope !== 'org' && route.scope !== 'property') return undefined;
  // Route-declared entitlement wins so operator HTTP can gate pms.core while
  // `night_audit.run` stays catalog-opt-out for the alarm path.
  if ('entitlement' in route && route.entitlement) {
    return route.entitlement;
  }
  if ('commandId' in route && route.commandId) {
    return requireCatalogEntry(route.commandId).entitlement;
  }
  return undefined;
}

async function handlePostOrgs(ctx: V1DispatchContext): Promise<Response> {
  const body = (await ctx.request.json()) as { orgId: string; name: string };
  if (!body.orgId || !body.name) return json({ error: 'invalid_body' }, 400);
  try {
    validateTenantId(body.orgId);
  } catch (e) {
    if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
    throw e;
  }
  ctx.observability.orgId = body.orgId;
  const created = await createOrg(ctx.env, body.orgId, body.name);
  if (!created) {
    return json({ error: 'org_exists' }, 409);
  }
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: body.orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(body.orgId);
  await org.ensureMember(ctx.actor.userId, 'owner');
  return json({ orgId: body.orgId, name: body.name }, 201);
}

async function handlePostMigrationSweep(ctx: V1DispatchContext): Promise<Response> {
  const instance = await ctx.env.MIGRATION_SWEEP_WORKFLOW.create({
    id: `migration-sweep-${crypto.randomUUID()}`,
    params: { triggeredBy: ctx.actor.userId },
  });
  return json({ workflowId: instance.id }, 202);
}

async function handlePostOrgCancel(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const body = (await ctx.request.json()) as { action?: string };
  if (body.action !== 'close' && body.action !== 'reopen') {
    return json({ error: 'invalid_body' }, 422);
  }
  if (body.action === 'close') {
    const result = await closeOrgForPurge(ctx.env, orgId);
    if (!result.ok) return json({ error: result.error }, 409);
    return json({ ok: true, orgId, status: 'closing' }, 200);
  }
  const result = await reopenOrg(ctx.env, orgId);
  if (!result.ok) return json({ error: result.error }, 409);
  return json({ ok: true, orgId, status: 'active' }, 200);
}

async function handlePostOrgPurge(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const body = (await ctx.request.json()) as { orgId?: string; confirm?: boolean };
  if (body.confirm !== true || body.orgId !== orgId) {
    return json({ error: 'invalid_body' }, 422);
  }
  const workflowId = await nextOrgPurgeWorkflowId(ctx.env, orgId);
  await ensurePurgeWorkflowInstance(ctx.env.PURGE_WORKFLOW, {
    id: workflowId,
    params: {
      kind: 'org',
      workflowId,
      orgId,
      operatorUserId: ctx.actor.userId,
      started: Date.now(),
    },
  });
  return json({ workflowId, orgId }, 202);
}

async function handlePostOrgProperties(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;

  const body = (await ctx.request.json()) as {
    propertyId: string;
    name: string;
    jurisdiction?: Jurisdiction | null;
    timeZone: string;
    currency: string;
    orgName?: string;
  };
  if (!body.propertyId || !body.name || !body.timeZone || !body.currency) {
    return json({ error: 'invalid_body' }, 400);
  }
  ctx.observability.propertyId = body.propertyId;

  const input: ProvisionPropertyInput = {
    orgId,
    orgName: body.orgName,
    propertyId: body.propertyId,
    name: body.name,
    jurisdiction: body.jurisdiction === undefined ? null : body.jurisdiction,
    timeZone: body.timeZone,
    currency: body.currency,
    actorUserId: ctx.actor.userId,
  };
  const result = await provisionProperty(ctx.env, input);
  if (!result.ok) {
    if (result.error === 'jurisdiction_conflict') {
      return json({ error: result.error, existing: result.existing }, 409);
    }
    if (result.error === 'tenant_not_active') {
      return json({ error: 'tenant_not_active' }, 409);
    }
    if (
      result.error === 'invalid_timezone' ||
      result.error === 'invalid_currency' ||
      result.error === 'invalid_tenant_id'
    ) {
      return json({ error: result.error }, 400);
    }
    return json({ error: result.error }, 400);
  }
  return json(result, 201);
}

async function handleGetOrgProperties(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  try {
    return json({ orgId, properties: await org.listPropertyRefs() });
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleGetProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = resolved.property.orgId;

  try {
    const recorded = await resolved.stub.getRecordedJurisdiction();
    const schemaVersion = await resolved.stub.getSchemaVersion();
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: recorded ?? null,
      schemaVersion,
    });
  } catch (e) {
    if (!isPropertyDoTransportFailure(e)) throw e;
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: null,
      schemaVersion: null,
      propertyDo: 'unreachable',
    });
  }
}

async function handleGetRegistryProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;
  return json({ property });
}

async function handlePostRoomTypes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomTypeId: string;
    code: string;
    name: string;
    roomCount: number;
    maxOccupancy: number;
    maxAdults: number;
    idempotencyKey: string;
  };
  if (
    !body.roomTypeId ||
    !body.code ||
    !body.name ||
    typeof body.roomCount !== 'number' ||
    typeof body.maxOccupancy !== 'number' ||
    typeof body.maxAdults !== 'number' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({
    roomTypeId: body.roomTypeId,
    code: body.code,
    name: body.name,
    roomCount: body.roomCount,
    maxOccupancy: body.maxOccupancy,
    maxAdults: body.maxAdults,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    roomTypeId: body.roomTypeId,
    code: body.code,
    name: body.name,
    roomCount: body.roomCount,
    maxOccupancy: body.maxOccupancy,
    maxAdults: body.maxAdults,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAddRoomType']>>>({
    env: ctx.env,
    commandId: 'inventory.add_room_type',
    routeId: 'post_room_types',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryAddRoomType(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    if (result.error === 'forbidden') {
      return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    return json({ ok: false, error: result.error }, mapAddRoomTypeErrorStatus(result.error));
  }
  return json(result, 201);
}

async function handlePutRoomType(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    code?: string;
    name?: string;
    roomCount?: number;
    maxOccupancy?: number;
    maxAdults?: number;
    idempotencyKey: string;
  };
  if (!body || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const payload: Record<string, unknown> = { roomTypeId };
  if (body.code !== undefined) payload.code = body.code;
  if (body.name !== undefined) payload.name = body.name;
  if (body.roomCount !== undefined) payload.roomCount = body.roomCount;
  if (body.maxOccupancy !== undefined) payload.maxOccupancy = body.maxOccupancy;
  if (body.maxAdults !== undefined) payload.maxAdults = body.maxAdults;

  const fingerprint = await fingerprintPayload(payload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    roomTypeId,
    code: body.code,
    name: body.name,
    roomCount: body.roomCount,
    maxOccupancy: body.maxOccupancy,
    maxAdults: body.maxAdults,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoomType']>>>({
    env: ctx.env,
    commandId: 'inventory.update_room_type',
    routeId: 'put_room_type',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpdateRoomType(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) {
      return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    if (result.error === OVERSELL) {
      return json({ ok: false, error: result.error, dates: result.dates }, 409);
    }
    return json({ ok: false, error: result.error }, mapAddRoomTypeErrorStatus(result.error));
  }
  return json(result, 200);
}

async function handleDeleteRoomType(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey =
    ctx.request.headers.get('x-idempotency-key') ?? ctx.url.searchParams.get('idempotencyKey');
  if (!idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ roomTypeId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { roomTypeId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRoomType']>>>({
    env: ctx.env,
    commandId: 'inventory.delete_room_type',
    routeId: 'delete_room_type',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryDeleteRoomType(actor, commandPayload, {
        key: idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) {
      return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    if (result.error === ARCHIVE_BLOCKED) {
      return json({ ok: false, error: result.error }, 409);
    }
    return json({ ok: false, error: result.error }, 422);
  }
  return json(result, 200);
}

async function handlePatchPropertyDetails(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { name?: string; idempotencyKey?: string };
  if (!body?.name || !body.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const updated = await updatePropertyName(ctx.env, propertyId, body.name);
  if (!updated) return json({ error: 'not_found' }, 404);

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({ propertyId, name: body.name });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryUpdatePropertyDetails(
      actor,
      propertyId,
      { name: body.name },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      if (result.error === FORBIDDEN || result.error === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'config:write' }, 403);
      }
      if (result.error === 'property_ref_not_found') return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, result.error === IDEM_KEY_REUSED ? 409 : 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'property.update_details' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePutDomainConfig(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    key?: string;
    value?: unknown;
    reason?: string;
    effectiveFrom?: string;
    idempotencyKey?: string;
  };
  if (!body?.key || body.value === undefined || !body.reason || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const { key, value, reason, idempotencyKey, effectiveFrom } = body;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({
    key,
    value,
    reason,
  });
  const meta = {
    reason,
    ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
  };
  const commandPayload = {
    key,
    value,
    reason,
    ...(effectiveFrom !== undefined ? { effectiveFrom } : {}),
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryPutDomainConfig']>>>({
    env: ctx.env,
    commandId: 'config.put_domain',
    routeId: 'put_domain_config',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryPutDomainConfig(actor, key, value, meta, {
        key: idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    let perm: Permission = 'settings:configure';
    try {
      perm = requiredPermissionForKey(key);
    } catch {
      /* undeclared — mapConfigErrorStatus handles */
    }
    if (result.error === FORBIDDEN || result.error === 'scope_mismatch') {
      return json({ error: 'forbidden', permission: perm }, 403);
    }
    return json({ ok: false, error: result.error }, mapConfigErrorStatus(result.error));
  }
  return json({ ok: true, key: result.key, version: result.version, events: result.events }, 200);
}

async function handlePostGuests(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    guestId: string;
    displayName: string;
    email?: string;
    phone?: string;
    idempotencyKey: string;
  };
  if (!body?.guestId || !body.displayName || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const profile: { displayName: string; email?: string; phone?: string } = { displayName: body.displayName };
  if (body.email !== undefined) profile.email = body.email;
  if (body.phone !== undefined) profile.phone = body.phone;
  const fingerprint = await fingerprintPayload({ guestId: body.guestId, ...profile });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryCreateGuest(
      actor,
      propertyId,
      { guestId: body.guestId, profile },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'guests:write' }, 403);
      }
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'guests.create' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePatchGuest(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const guestId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    displayName: string;
    email?: string;
    phone?: string;
    idempotencyKey: string;
  };
  if (!body?.displayName || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const profile: { displayName: string; email?: string; phone?: string } = { displayName: body.displayName };
  if (body.email !== undefined) profile.email = body.email;
  if (body.phone !== undefined) profile.phone = body.phone;
  const fingerprint = await fingerprintPayload({ guestId, ...profile });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryUpdateGuest(
      actor,
      propertyId,
      { guestId, profile },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'guests:write' }, 403);
      }
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'guests.update' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePostGuestErase(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const guestId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { idempotencyKey: string };
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({ guestId });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryEraseGuest(
      actor,
      propertyId,
      { guestId },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'guests:erase' }, 403);
      }
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    return json(
      {
        ok: true,
        guestId: result.guestId,
        piiKeyId: result.piiKeyId,
        erased: true,
        purgeWorkflowId: guestPurgeWorkflowId(result.guestId),
      },
      200,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'guests.erase' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handleGetGuest(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const guestId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readGuest(actor, propertyId, guestId);
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'guests:read' }, 403);
      }
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    if (e instanceof Error) {
      logError(ctx.observability, {
        msg: 'guests.read.decrypt_incident',
        error: e.message,
      });
      return json({ error: 'internal_error' }, 500);
    }
    throw e;
  }
}

const ROSTER_GET_HEADERS = { 'Cache-Control': 'private, no-store' };

type RosterHttpBody = {
  displayName?: string;
  email?: string;
  phone?: string;
  hourlyRate?: { amountMinor: number; currency: string };
  rating?: number;
  skills?: string[];
  kinds?: string[];
  idempotencyKey?: string;
  status?: string;
};

function rosterGetJson(data: unknown, status = 200): Response {
  return json(data, status, ROSTER_GET_HEADERS);
}

function rosterGetDegraded(): Response {
  const degraded = degradedFailClosedOrgReadResponse();
  const headers = new Headers(degraded.headers);
  headers.set('Cache-Control', 'private, no-store');
  return new Response(degraded.body, { status: degraded.status, headers });
}

function rosterWriteErrorResponse(err: string, permission: Permission): Response {
  if (err === 'not_member') return json({ error: 'not_found' }, 404);
  if (err === FORBIDDEN || err === 'scope_mismatch') {
    return json({ error: 'forbidden', permission }, 403);
  }
  return json({ ok: false, error: err }, mapRosterCommandErrorStatus(err));
}

async function rosterGrants(
  org: DurableObjectStub<OrgDO>,
  userId: string,
  propertyId: string,
  env: PmsEnv,
): Promise<readonly Permission[]> {
  const role = await org.getEffectiveRole(userId, propertyId);
  return effectiveRosterGrants(role ? ROLE_GRANTS[role] : [], env);
}

function parseRosterProfile(body: RosterHttpBody): ReturnType<typeof profileFromHttpBody> | Response {
  try {
    return profileFromHttpBody(body);
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
}

async function handleGetRoster(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.listRoster(actor, propertyId);
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return rosterGetJson({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return rosterGetJson({ error: 'forbidden', permission: 'roster:read' }, 403);
      }
      return rosterGetJson({ ok: false, error: err }, mapRosterCommandErrorStatus(err));
    }
    const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
    const kind = ctx.url.searchParams.get('kind');
    const staff = result.staff
      .filter((row) => !kind || row.kinds.includes(kind))
      .map((row) => stripRosterRow(grants, row));
    return rosterGetJson({ ok: true, staff }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return rosterGetDegraded();
    throw e;
  }
}

async function handleGetRosterOne(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readRoster(actor, propertyId, staffId);
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return rosterGetJson({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return rosterGetJson({ error: 'forbidden', permission: 'roster:read' }, 403);
      }
      return rosterGetJson({ ok: false, error: err }, mapRosterCommandErrorStatus(err));
    }
    const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
    return rosterGetJson({ ok: true, ...stripRosterRow(grants, result) }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return rosterGetDegraded();
    throw e;
  }
}

async function handlePostRoster(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as RosterHttpBody & { staffId?: unknown };
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'staffId' in body) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!body.displayName || !Array.isArray(body.kinds) || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
  if (compensationWriteDenied(grants, body)) {
    const permission: Permission = 'roster:compensation';
    return json({ error: 'forbidden', permission }, 403);
  }

  const profile = parseRosterProfile(body);
  if (profile instanceof Response) return profile;
  const kinds = [...body.kinds].sort();
  const fingerprint = await fingerprintPayload({ profile, kinds });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryCreateRoster(
      actor,
      propertyId,
      { profile: { ...profile, displayName: body.displayName }, kinds },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return rosterWriteErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.add' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePatchRoster(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as RosterHttpBody;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.kinds !== undefined && !Array.isArray(body.kinds)) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
  if (compensationWriteDenied(grants, body)) {
    const permission: Permission = 'roster:compensation';
    return json({ error: 'forbidden', permission }, 403);
  }

  const profile = parseRosterProfile(body);
  if (profile instanceof Response) return profile;
  const kinds = body.kinds ? [...body.kinds].sort() : undefined;
  const fingerprint = await fingerprintPayload({ staffId, profile, kinds });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryUpdateRoster(
      actor,
      propertyId,
      {
        staffId,
        ...(Object.keys(profile).length > 0 ? { profile } : {}),
        ...(kinds ? { kinds } : {}),
      },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return rosterWriteErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.update' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePostRosterStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as RosterHttpBody;
  if (!body?.idempotencyKey || (body.status !== 'active' && body.status !== 'inactive')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({ staffId, status: body.status });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.trySetRosterStatus(
      actor,
      propertyId,
      { staffId, status: body.status },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return rosterWriteErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.status' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePostRosterExit(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as RosterHttpBody;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await fingerprintPayload({ staffId });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryExitRoster(
      actor,
      propertyId,
      { staffId },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return rosterWriteErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.exit' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePostReservations(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    reservationId: string;
    roomTypeId: string;
    guestRef: string;
    arrivalDate: string;
    departureDate: string;
    idempotencyKey: string;
    quoteAriVersion?: number;
    status?: 'inquiry' | 'pending' | 'confirmed';
    adults?: number;
    children?: number;
    ratePlanId?: string;
    confirmBy?: number;
    expiresAt?: number;
  };
  if (
    !body.reservationId ||
    !body.roomTypeId ||
    !body.guestRef ||
    !body.arrivalDate ||
    !body.departureDate ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({
    reservationId: body.reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    guestRef: body.guestRef,
    status: body.status,
  });

  const commandPayload = {
    reservationId: body.reservationId,
    roomTypeId: body.roomTypeId,
    guestRef: body.guestRef,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.adults !== undefined ? { adults: body.adults } : {}),
    ...(body.children !== undefined ? { children: body.children } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
    ...(body.confirmBy !== undefined ? { confirmBy: body.confirmBy } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
  };
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateReservation']>>>({
    env: ctx.env,
    commandId: 'reservations.create',
    routeId: 'post_reservations',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryCreateReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === 'org_unreachable') {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'reservations.create' },
        503,
        { 'Retry-After': '30' },
      );
    }
    if (err === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      logAriRejectOnCommit(ctx.observability, body.quoteAriVersion, fail, body.roomTypeId);
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
    if (err === RESTRICTION_VIOLATED) {
      const fail = result as {
        ok: false;
        error: typeof RESTRICTION_VIOLATED;
        rule: string;
        date: string;
        required?: number;
      };
      return json(
        {
          ok: false,
          error: fail.error,
          rule: fail.rule,
          date: fail.date,
          ...(fail.required !== undefined ? { required: fail.required } : {}),
        },
        422,
      );
    }
    if (err === UNBOOKABLE) {
      const fail = result as { ok: false; error: typeof UNBOOKABLE; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 422);
    }
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (err === GUEST_NOT_FOUND || err === GUEST_ALREADY_ERASED) {
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 201);
}

async function handleGetReservation(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readReservation(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result.reservation, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePatchReservation(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomTypeId: string;
    arrivalDate: string;
    departureDate: string;
    idempotencyKey: string;
    quoteAriVersion?: number;
    adults?: number;
    children?: number;
    ratePlanId?: string;
  };
  if (!body.roomTypeId || !body.arrivalDate || !body.departureDate || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({
    reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    adults: body.adults,
    children: body.children,
    ratePlanId: body.ratePlanId,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    ...(body.adults !== undefined ? { adults: body.adults } : {}),
    ...(body.children !== undefined ? { children: body.children } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryModifyReservation']>>>({
    env: ctx.env,
    commandId: 'reservations.modify',
    routeId: 'patch_reservation',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryModifyReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      logAriRejectOnCommit(ctx.observability, body.quoteAriVersion, fail, body.roomTypeId);
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
    if (err === RESTRICTION_VIOLATED) {
      const fail = result as {
        ok: false;
        error: typeof RESTRICTION_VIOLATED;
        rule: string;
        date: string;
        required?: number;
      };
      return json(
        {
          ok: false,
          error: fail.error,
          rule: fail.rule,
          date: fail.date,
          ...(fail.required !== undefined ? { required: fail.required } : {}),
        },
        422,
      );
    }
    if (err === UNBOOKABLE || err === LEDGER_INCONSISTENT) {
      const fail = result as { ok: false; error: typeof UNBOOKABLE | typeof LEDGER_INCONSISTENT; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, mapReservationCommandErrorStatus(fail.error));
    }
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostReservationCancel(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { idempotencyKey: string };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ reservationId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { reservationId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCancelReservation']>>>({
    env: ctx.env,
    commandId: 'reservations.cancel',
    routeId: 'post_reservation_cancel',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryCancelReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (err === LEDGER_INCONSISTENT) {
      const fail = result as { ok: false; error: typeof LEDGER_INCONSISTENT; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 409);
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostReservationConfirm(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { idempotencyKey: string; ratePlanId?: string };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryConfirm']>>>({
    env: ctx.env,
    commandId: 'reservations.confirm',
    routeId: 'post_reservation_confirm',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryConfirm(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (err === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostReservationHold(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    idempotencyKey: string;
    ratePlanId?: string;
    confirmBy?: number;
  };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
    ...(body.confirmBy !== undefined ? { confirmBy: body.confirmBy } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryHold']>>>({
    env: ctx.env,
    commandId: 'reservations.hold',
    routeId: 'post_reservation_hold',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryHold(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (err === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostReservationFrontOffice(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    idempotencyKey: string;
    frontOfficeComment?: string;
    vipFlag?: boolean;
  };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.frontOfficeComment !== undefined ? { frontOfficeComment: body.frontOfficeComment } : {}),
    ...(body.vipFlag !== undefined ? { vipFlag: body.vipFlag } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateFrontOffice']>>>({
    env: ctx.env,
    commandId: 'reservations.update_status',
    routeId: 'post_reservation_front_office',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpdateFrontOffice(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostReservationStatusAction(
  ctx: V1DispatchContext,
  reservationId: string,
  commandId: string,
  routeId: string,
  action: (
    stub: DurableObjectStub<PropertyDO>,
    actor: { kind: 'user'; userId: string },
    idem: IdempotencyKey,
  ) => Promise<{ ok: boolean; error?: string; date?: string }>,
): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ reservationId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };
  const commandPayload = { reservationId };

  const invoked = await invokePropertyDo({
    env: ctx.env,
    commandId,
    routeId,
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => action(resolvedCtx.resolved.stub, actor, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'reservations:write' }, 403);
    if (err === LEDGER_INCONSISTENT) {
      return json({ ok: false, error: err, date: result.date }, 409);
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostReservationCheckIn(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  const roomId = typeof extra?.roomId === 'string' ? extra.roomId : undefined;
  const overrideCleanliness = typeof extra?.overrideCleanliness === 'boolean' ? extra.overrideCleanliness : undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, ...(roomId !== undefined ? { roomId } : {}), ...(overrideCleanliness !== undefined ? { overrideCleanliness } : {}) };
  const fingerprint = await fingerprintPayload({ reservationId, roomId, overrideCleanliness });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCheckIn']>>>({
    env: ctx.env,
    commandId: 'reservations.check_in',
    routeId: 'post_reservation_check_in',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCheckIn(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'reservations:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostReservationCheckOut(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  const overrideBalance = typeof extra?.overrideBalance === 'boolean' ? extra.overrideBalance : undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, ...(overrideBalance !== undefined ? { overrideBalance } : {}) };
  const fingerprint = await fingerprintPayload({ reservationId, overrideBalance });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCheckOut']>>>({
    env: ctx.env,
    commandId: 'reservations.check_out',
    routeId: 'post_reservation_check_out',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCheckOut(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'reservations:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostReservationNoShow(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  return handlePostReservationStatusAction(
    ctx,
    reservationId,
    'reservations.no_show',
    'post_reservation_no_show',
    (stub, actor, idem) => stub.tryNoShow(actor, { reservationId }, idem),
  );
}

async function handlePostReservationCancelCheckIn(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  return handlePostReservationStatusAction(
    ctx,
    reservationId,
    'reservations.cancel_check_in',
    'post_reservation_cancel_check_in',
    (stub, actor, idem) => stub.tryCancelCheckIn(actor, { reservationId }, idem),
  );
}

async function handleGetProvisionalExceptions(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listProvisionalExceptions();
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetProvisionalExceptionCount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const exceptionCount = await resolvedCtx.resolved.stub.countProvisionalExceptions();
    return json({ propertyId, exceptionCount }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskArrivals(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const url = new URL(ctx.request.url);
  const date = url.searchParams.get('date');
  if (!date) return json({ error: 'invalid_body', detail: 'date_required' }, 400);

  const cursorRaw = url.searchParams.get('cursor');
  const decoded = decodeFrontDeskCursor<{ reservationId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listArrivals(date, {
      limit: parseOptionalFrontDeskLimit(url),
      cursor: decoded,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskDepartures(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const url = new URL(ctx.request.url);
  const date = url.searchParams.get('date');
  if (!date) return json({ error: 'invalid_body', detail: 'date_required' }, 400);

  const cursorRaw = url.searchParams.get('cursor');
  const decoded = decodeFrontDeskCursor<{ status: string; reservationId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listDepartures(date, {
      limit: parseOptionalFrontDeskLimit(url),
      cursor: decoded,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskInHouse(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const url = new URL(ctx.request.url);

  const cursorRaw = url.searchParams.get('cursor');
  const decoded = decodeFrontDeskCursor<{ departureDate: string; reservationId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listInHouse({
      limit: parseOptionalFrontDeskLimit(url),
      cursor: decoded,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskShift(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await resolvedCtx.resolved.stub.readCurrentOpenShift(actor);
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json({ ok: true, shift: result.shift }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskRecentShifts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await resolvedCtx.resolved.stub.readRecentShiftsForActor(actor, { limit: 5 });
    return json({ ok: true, shifts: result.shifts }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

const ME_HEADERS = { 'Cache-Control': 'private, no-store' };

async function handleListOrgMembers(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.listOrgMembers(actor);
    if (!result.ok) return membershipErrorResponse(result.error, 'org:manage');
    const enriched = await enrichMembersDirectory(ctx.env, result.members);
    return json({ ok: true, ...enriched }, 200, ME_HEADERS);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleCreateOrgMember(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  const body = (await ctx.request.json()) as { email?: string; role?: string };
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !isOrgRole(body.role)) {
    return json({ error: 'invalid_body' }, 422);
  }
  const looked = await lookupUserIdByEmail(ctx.env, email);
  if (!looked.ok) {
    if (looked.error === 'clerk_unreachable') return clerkUnreachableResponse();
    return json({ error: looked.error }, 422);
  }
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.setOrgMember(actor, {
      targetUserId: looked.userId,
      role: body.role,
      mode: 'create',
    });
    if (!result.ok) {
      if (result.error === 'already_member') {
        return alreadyMemberResponse(looked.userId, result.role);
      }
      return membershipErrorResponse(result.error, 'org:manage');
    }
    return json({ ok: true, userId: result.userId, role: result.role }, 201);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleUpdateOrgMember(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.orgId = orgId;
  const body = (await ctx.request.json()) as { role?: string };
  if (!isOrgRole(body.role)) {
    return json({ error: 'invalid_body' }, 422);
  }
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.setOrgMember(actor, {
      targetUserId,
      role: body.role,
      mode: 'update',
    });
    if (!result.ok) return membershipErrorResponse(result.error, 'org:manage');
    return json(
      {
        ok: true,
        userId: result.userId,
        role: result.role,
        previousRole: result.previousRole,
      },
      200,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleDeleteOrgMember(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.orgId = orgId;
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.removeOrgMember(actor, targetUserId);
    if (!result.ok) return membershipErrorResponse(result.error, 'org:manage');
    return json({ ok: true, userId: result.userId }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleListPropertyMembers(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.listPropertyMembers(actor, propertyId);
    if (!result.ok) return membershipErrorResponse(result.error, 'staff:read');
    const enriched = await enrichMembersDirectory(ctx.env, result.members);
    return json({ ok: true, ...enriched }, 200, ME_HEADERS);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleCreatePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { email?: string; role?: string };
  // Body email wins over any query param (person-identifier hygiene).
  const queryEmail = ctx.url.searchParams.get('email');
  void queryEmail;
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email) {
    return json({ error: 'invalid_body' }, 422);
  }
  if (body.role === 'owner') {
    return json({ error: 'invalid_role' }, 422);
  }
  if (!isPropertyWriteRole(body.role)) {
    return json({ error: 'invalid_body' }, 422);
  }
  const looked = await lookupUserIdByEmail(ctx.env, email);
  if (!looked.ok) {
    if (looked.error === 'clerk_unreachable') return clerkUnreachableResponse();
    return json({ error: looked.error }, 422);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.setPropertyMember(actor, propertyId, {
      targetUserId: looked.userId,
      role: body.role,
      mode: 'create',
    });
    if (!result.ok) {
      if (result.error === 'already_member') {
        return alreadyMemberResponse(looked.userId, result.role);
      }
      return membershipErrorResponse(result.error, 'staff:write');
    }
    return json({ ok: true, userId: result.userId, role: result.role }, 201);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleUpdatePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { role?: string };
  if (body.role === 'owner') {
    return json({ error: 'invalid_role' }, 422);
  }
  if (!isPropertyWriteRole(body.role)) {
    return json({ error: 'invalid_body' }, 422);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.setPropertyMember(actor, propertyId, {
      targetUserId,
      role: body.role,
      mode: 'update',
    });
    if (!result.ok) return membershipErrorResponse(result.error, 'staff:write');
    return json(
      {
        ok: true,
        userId: result.userId,
        role: result.role,
        previousRole: result.previousRole,
      },
      200,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleDeletePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await org.removePropertyMember(actor, propertyId, targetUserId);
    if (!result.ok) return membershipErrorResponse(result.error, 'staff:write');
    return json({ ok: true, userId: result.userId }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleGetPropertyMe(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, {
    orgId: resolvedCtx.property.orgId,
  }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    const result = await org.readPropertyMe(actor, propertyId);
    if (!result.ok) {
      // Defensive: HTTP gate normally 404s before handler; keep for direct-style parity
      return json({ error: 'not_found' }, 404, ME_HEADERS);
    }
    return json(
      {
        ok: true,
        orgId: resolvedCtx.property.orgId,
        propertyId,
        userId: ctx.actor.userId,
        role: result.role,
        permissions: result.permissions,
        orgPermissions: result.orgPermissions,
      },
      200,
      ME_HEADERS,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e)) {
      const degraded = degradedFailClosedOrgReadResponse();
      const headers = new Headers(degraded.headers);
      headers.set('Cache-Control', 'private, no-store');
      return new Response(degraded.body, { status: degraded.status, headers });
    }
    throw e;
  }
}

async function handlePostGuestsBatch(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { refs?: string[] };
  if (!Array.isArray(body?.refs) || body.refs.length === 0) {
    return json({ error: 'invalid_body', detail: 'refs_required' }, 400);
  }
  const refs = [...new Set(body.refs.filter((r) => typeof r === 'string' && r.length > 0))];
  if (refs.length === 0) return json({ error: 'invalid_body', detail: 'refs_required' }, 400);
  if (refs.length > 50) return json({ error: 'refs_limit_exceeded', max: 50 }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readGuests(actor, propertyId, refs);
    if (!result.ok) {
      const err = result.error;
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      if (err === FORBIDDEN || err === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'guests:read' }, 403);
      }
      if (err === ENTITLEMENT_REQUIRED) return json({ error: ENTITLEMENT_REQUIRED, feature: 'pms.core' }, 402);
      if (err === ENTITLEMENT_UNAVAILABLE) return json({ error: ENTITLEMENT_UNAVAILABLE }, 503);
      return json({ ok: false, error: err }, mapGuestCommandErrorStatus(err));
    }
    for (const [guestId, entry] of Object.entries(result.guests)) {
      if (!entry.ok && entry.error === 'decrypt_unresolved') {
        logError(ctx.observability, {
          msg: 'guests.read.decrypt_incident',
          guestId,
        });
      }
    }
    return json({ ok: true, guests: result.guests }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetOrgEntitlements(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  try {
    const snap = await loadSnapshot(ctx.env, orgId);
    return json(snap, 200);
  } catch (e) {
    if (e instanceof EntitlementResolutionError) {
      return json({ error: ENTITLEMENT_UNAVAILABLE }, 503);
    }
    throw e;
  }
}

async function handlePutRateDays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  };
  if (
    !body.roomTypeId ||
    !body.stayDate ||
    typeof body.amountMinor !== 'number' ||
    !body.currency ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const cell = normalizeRateDayCell(body);
  const fingerprint = await fingerprintPayload(cell);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { ...cell, auditCommandId: 'rates.upsert_day' as const };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRateDay']>>>({
    env: ctx.env,
    commandId: 'rates.upsert_day',
    routeId: 'put_rate_days',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRateDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePutRestrictionDays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    minLos?: number | null;
    maxLos?: number | null;
    cta?: boolean;
    ctd?: boolean;
    stopSell?: boolean;
    idempotencyKey: string;
  };
  if (!body.roomTypeId || !body.stayDate || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const ratePlanId = body.ratePlanId ?? TYPE_WIDE_RATE_PLAN;
  const fingerprint = await fingerprintPayload({
    roomTypeId: body.roomTypeId,
    ratePlanId,
    stayDate: body.stayDate,
    minLos: body.minLos ?? null,
    maxLos: body.maxLos ?? null,
    cta: body.cta ?? false,
    ctd: body.ctd ?? false,
    stopSell: body.stopSell ?? false,
  });

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    roomTypeId: body.roomTypeId,
    ratePlanId,
    stayDate: body.stayDate,
    minLos: body.minLos ?? null,
    maxLos: body.maxLos ?? null,
    cta: body.cta ?? false,
    ctd: body.ctd ?? false,
    stopSell: body.stopSell ?? false,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRestrictionDay']>>>({
    env: ctx.env,
    commandId: 'restrictions.upsert_day',
    routeId: 'put_restriction_days',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRestrictionDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    return json({ ok: false, error: result.error }, mapReservationCommandErrorStatus(result.error));
  }
  return json(result, 200);
}

async function handlePostFolioLines(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    chargeCode: string;
    amountMinor: number;
    idempotencyKey: string;
  };
  if (!body?.chargeCode || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const folioLineId = `${reservationId}:item:${body.idempotencyKey}`;
  const commandPayload = {
    reservationId,
    folioLineId,
    chargeCode: body.chargeCode,
    amountMinor: body.amountMinor,
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAddFolioLine']>>>({
    env: ctx.env,
    commandId: 'folio.add_item',
    routeId: 'post_folio_lines',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryAddFolioLine(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === CHARGE_CODE_NOT_FOUND) {
      return json({ error: CHARGE_CODE_NOT_FOUND }, 404);
    }
    if (err === NOT_FOUND || err === 'not_member') {
      return json({ error: 'not_found' }, 404);
    }
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handleGetFolio(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readFolio(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRooms(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomId: string;
    roomTypeId: string;
    code: string;
    floor?: string;
    idempotencyKey: string;
  };
  if (!body?.roomId || !body.roomTypeId || !body.code || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload: { roomId: string; roomTypeId: string; code: string; floor?: string } = {
    roomId: body.roomId,
    roomTypeId: body.roomTypeId,
    code: body.code,
  };
  if (body.floor !== undefined) commandPayload.floor = body.floor;
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateRoom']>>>({
    env: ctx.env,
    commandId: 'rooms.create',
    routeId: 'post_rooms',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCreateRoom(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handlePatchRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    code?: string;
    floor?: string;
    roomTypeId?: string;
    idempotencyKey: string;
  };
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.roomTypeId !== undefined) {
    return json({ error: 'invalid_body', detail: 'room_type_id_immutable' }, 422);
  }
  if (body.code === undefined && body.floor === undefined) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload: { roomId: string; code?: string; floor?: string } = { roomId };
  if (body.code !== undefined) commandPayload.code = body.code;
  if (body.floor !== undefined) commandPayload.floor = body.floor;
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoom']>>>({
    env: ctx.env,
    commandId: 'rooms.update',
    routeId: 'patch_room',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRoom(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handleGetRooms(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const url = new URL(ctx.request.url);
  const roomTypeId = url.searchParams.get('roomTypeId') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  try {
    const result = await resolvedCtx.resolved.stub.listRooms({ roomTypeId, status });
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRoomStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { status: string; idempotencyKey: string };
  if (!body?.status || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { roomId, status: body.status };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoomStatus']>>>({
    env: ctx.env,
    commandId: 'rooms.update_status',
    routeId: 'post_room_status',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRoomStatus(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'housekeeping:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostRoomsBulkStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    updates: Array<{ roomId: string; status: string }>;
    idempotencyKey: string;
  };
  if (!body?.updates?.length || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const updates = [...body.updates].sort((a, b) => a.roomId.localeCompare(b.roomId));
  const commandPayload = { updates };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryBulkUpdateRoomStatus']>>>({
    env: ctx.env,
    commandId: 'rooms.bulk_update_status',
    routeId: 'post_rooms_bulk_status',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryBulkUpdateRoomStatus(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'housekeeping:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostReservationAssignRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as { roomId: string; idempotencyKey: string };
  if (!body?.roomId || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, roomId: body.roomId };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAssignRoom']>>>({
    env: ctx.env,
    commandId: 'reservations.assign_room',
    routeId: 'post_reservation_assign_room',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryAssignRoom(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'reservations:write' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostHousekeepingAssign(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    roomId: string;
    businessDate: string;
    assigneeRef: string;
    idempotencyKey: string;
  };
  if (!body?.roomId || !body.businessDate || !body.assigneeRef || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    roomId: body.roomId,
    businessDate: body.businessDate,
    assigneeRef: body.assigneeRef,
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAssignHousekeeping']>>>({
    env: ctx.env,
    commandId: 'housekeeping.assign',
    routeId: 'post_housekeeping_assign',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryAssignHousekeeping(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === 'org_unreachable') {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'housekeeping.assign' },
        503,
        { 'Retry-After': '30' },
      );
    }
    if (err === STAFF_NOT_FOUND || err === STAFF_EXITED || err === STAFF_NOT_ASSIGNABLE) {
      return json({ ok: false, error: err }, 422);
    }
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'housekeeping:write' }, 403);
    if (err === 'invalid_assignee_ref' || err === 'invalid_business_date') {
      return json({ ok: false, error: err }, 400);
    }
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handleGetHousekeepingAssignments(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const businessDate = new URL(ctx.request.url).searchParams.get('businessDate');
  if (!businessDate) {
    return json({ error: 'invalid_body', detail: 'businessDate_required' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readHousekeepingAssignments(businessDate);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRatePlans(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    ratePlanId: string;
    code: string;
    name: string;
    idempotencyKey: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    cancelPolicyText?: string | null;
  };
  if (!body?.ratePlanId || !body.code || !body.name || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ratePlanId: body.ratePlanId,
    code: body.code,
    name: body.name,
    ...(body.cancelPenaltyType !== undefined ? { cancelPenaltyType: body.cancelPenaltyType } : {}),
    ...(body.cancelGraceHours !== undefined ? { cancelGraceHours: body.cancelGraceHours } : {}),
    ...(body.cancelPenaltyNights !== undefined ? { cancelPenaltyNights: body.cancelPenaltyNights } : {}),
    ...(body.cancelPenaltyBps !== undefined ? { cancelPenaltyBps: body.cancelPenaltyBps } : {}),
    ...(body.cancelPolicyText !== undefined ? { cancelPolicyText: body.cancelPolicyText } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateRatePlan']>>>({
    env: ctx.env,
    commandId: 'rates.create_plan',
    routeId: 'post_rate_plans',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCreateRatePlan(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handlePatchRatePlan(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ratePlanId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    code?: string;
    name?: string;
    idempotencyKey: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    cancelPolicyText?: string | null;
  };
  if (
    !body?.idempotencyKey ||
    (body.code === undefined &&
      body.name === undefined &&
      body.cancelPenaltyType === undefined &&
      body.cancelGraceHours === undefined &&
      body.cancelPenaltyNights === undefined &&
      body.cancelPenaltyBps === undefined &&
      body.cancelPolicyText === undefined)
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ratePlanId,
    code: body.code,
    name: body.name,
    ...(body.cancelPenaltyType !== undefined ? { cancelPenaltyType: body.cancelPenaltyType } : {}),
    ...(body.cancelGraceHours !== undefined ? { cancelGraceHours: body.cancelGraceHours } : {}),
    ...(body.cancelPenaltyNights !== undefined ? { cancelPenaltyNights: body.cancelPenaltyNights } : {}),
    ...(body.cancelPenaltyBps !== undefined ? { cancelPenaltyBps: body.cancelPenaltyBps } : {}),
    ...(body.cancelPolicyText !== undefined ? { cancelPolicyText: body.cancelPolicyText } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRatePlan']>>>({
    env: ctx.env,
    commandId: 'rates.update_plan',
    routeId: 'patch_rate_plan',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRatePlan(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member' || err === RATE_PLAN_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handleDeleteRatePlan(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ratePlanId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey =
    ctx.request.headers.get('x-idempotency-key') ?? ctx.url.searchParams.get('idempotencyKey');
  if (!idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { ratePlanId };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRatePlan']>>>({
    env: ctx.env,
    commandId: 'rates.delete_plan',
    routeId: 'delete_rate_plan',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryDeleteRatePlan(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member' || err === RATE_PLAN_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostChargeCodes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    code: string;
    name: string;
    idempotencyKey: string;
  };
  if (!body?.code || !body.name || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { code: body.code, name: body.name };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateChargeCode']>>>({
    env: ctx.env,
    commandId: 'folio.create_charge_code',
    routeId: 'post_charge_codes',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCreateChargeCode(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handlePatchChargeCode(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const code = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    name?: string;
    taxGroup?: string | null;
    idempotencyKey: string;
  };
  if (!body?.idempotencyKey || (body.name === undefined && body.taxGroup === undefined)) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    code,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.taxGroup !== undefined ? { taxGroup: body.taxGroup } : {}),
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateChargeCode']>>>({
    env: ctx.env,
    commandId: 'folio.update_charge_code',
    routeId: 'patch_charge_code',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryUpdateChargeCode(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
    if (err === 'not_member' || err === CHARGE_CODE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePutChargeCodeStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const code = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    status: 'active' | 'archived';
    idempotencyKey: string;
  };
  if (!body?.status || !body.idempotencyKey || (body.status !== 'active' && body.status !== 'archived')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { code, status: body.status };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySetChargeCodeStatus']>>>({
    env: ctx.env,
    commandId: 'folio.set_charge_code_status',
    routeId: 'put_charge_code_status',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.trySetChargeCodeStatus(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
    if (err === 'not_member' || err === CHARGE_CODE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handleGetChargeCodes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'archived' || statusParam === 'all' ? statusParam : ('active' as const);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const codes = await resolvedCtx.resolved.stub.listChargeCodes(status);
    return json({ ok: true, codes }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostTaxRules(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    taxRuleId: string;
    ruleKey: string;
    name: string;
    ruleType: string;
    rate: string;
    taxGroup: string;
    outputChargeCode: string;
    validFrom: string;
    validTo?: string | null;
    idempotencyKey: string;
  };
  if (
    !body?.taxRuleId ||
    !body.ruleKey ||
    !body.name ||
    !body.ruleType ||
    !body.rate ||
    !body.taxGroup ||
    !body.outputChargeCode ||
    !body.validFrom ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    taxRuleId: body.taxRuleId,
    ruleKey: body.ruleKey,
    name: body.name,
    ruleType: body.ruleType,
    rate: body.rate,
    taxGroup: body.taxGroup,
    outputChargeCode: body.outputChargeCode,
    validFrom: body.validFrom,
    validTo: body.validTo ?? null,
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateTaxRule']>>>({
    env: ctx.env,
    commandId: 'folio.create_tax_rule',
    routeId: 'post_tax_rules',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCreateTaxRule(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handlePutTaxRuleSupersede(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ruleKey = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    taxRuleId: string;
    name: string;
    ruleType: string;
    rate: string;
    taxGroup: string;
    outputChargeCode: string;
    validFrom: string;
    validTo?: string | null;
    idempotencyKey: string;
  };
  if (
    !body?.taxRuleId ||
    !body.name ||
    !body.ruleType ||
    !body.rate ||
    !body.taxGroup ||
    !body.outputChargeCode ||
    !body.validFrom ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ruleKey,
    taxRuleId: body.taxRuleId,
    name: body.name,
    ruleType: body.ruleType,
    rate: body.rate,
    taxGroup: body.taxGroup,
    outputChargeCode: body.outputChargeCode,
    validFrom: body.validFrom,
    validTo: body.validTo ?? null,
  };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySupersedeTaxRule']>>>({
    env: ctx.env,
    commandId: 'folio.supersede_tax_rule',
    routeId: 'put_tax_rule_supersede',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.trySupersedeTaxRule(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
    if (err === 'not_member' || err === TAX_RULE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handleGetTaxRules(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const taxGroup = url.searchParams.get('taxGroup') ?? undefined;
  const effectiveDate = url.searchParams.get('effectiveDate') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const rules = await resolvedCtx.resolved.stub.listTaxRules({ taxGroup, effectiveDate });
    return json({ ok: true, rules }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostShifts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    shiftId: string;
    openingFloat: number;
    idempotencyKey: string;
  };
  if (!body?.shiftId || body.openingFloat == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { shiftId: body.shiftId, openingFloat: body.openingFloat };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryOpenShift']>>>({
    env: ctx.env,
    commandId: 'folio.open_shift',
    routeId: 'post_shifts',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryOpenShift(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 201);
}

async function handlePutShiftClose(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const shiftId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    closingCount: number;
    idempotencyKey: string;
  };
  if (body?.closingCount == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { shiftId, closingCount: body.closingCount };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCloseShift']>>>({
    env: ctx.env,
    commandId: 'folio.close_shift',
    routeId: 'put_shift_close',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCloseShift(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    if (err === 'not_member' || err === SHIFT_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostCashPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    paymentId: string;
    amountMinor: number;
    idempotencyKey: string;
  };
  if (!body?.paymentId || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const requestFingerprint = await fingerprintPayload({
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRecordCashPayment']>>>({
    env: ctx.env,
    commandId: 'folio.record_cash_payment',
    routeId: 'post_cash_payment',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryRecordCashPayment(actor, commandPayload),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapPaymentCommandErrorStatus(err));
  }
  return json(result, 201);
}

async function handleGetShift(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const shiftId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readShift(shiftId);
    if (!result.ok) return json({ ok: false, error: result.error }, 404);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetAuditLog(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const parseOptionalInt = (key: string): number | undefined => {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };

  const filters = {
    actor: url.searchParams.get('actor') ?? undefined,
    shiftId: url.searchParams.get('shiftId') ?? undefined,
    reservationId: url.searchParams.get('reservationId') ?? undefined,
    fromAt: parseOptionalInt('fromAt'),
    toAt: parseOptionalInt('toAt'),
    limit: parseOptionalInt('limit'),
  };

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const actor = { kind: 'user' as const, userId: ctx.actor.userId };
    const result = await resolvedCtx.resolved.stub.listAuditLog(actor, filters);
    if (!result.ok) {
      const err = result.error;
      if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:read' }, 403);
      if (err === 'not_member') return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: err }, 400);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetRatePlans(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const plans = await resolvedCtx.resolved.stub.listRatePlans();
    return json({ ok: true, plans }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePutRoomTypeRate(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    ratePlanId?: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  };
  if (!body.stayDate || typeof body.amountMinor !== 'number' || !body.currency || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const cell = normalizeRateDayCell({
    roomTypeId,
    ratePlanId: body.ratePlanId,
    stayDate: body.stayDate,
    amountMinor: body.amountMinor,
    currency: body.currency,
  });
  const fingerprint = await fingerprintPayload(cell);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { ...cell, auditCommandId: 'rates.update_room_type_rate' as const };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRateDay']>>>({
    env: ctx.env,
    commandId: 'rates.update_room_type_rate',
    routeId: 'put_room_type_rate',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRateDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostRatesBulk(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    updates: Array<{
      roomTypeId: string;
      ratePlanId?: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
    }>;
    idempotencyKey: string;
  };
  if (!Array.isArray(body.updates) || body.updates.length === 0 || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const normalized = body.updates
    .map((u) => normalizeRateDayCell(u))
    .sort((a, b) => {
      const c1 = a.roomTypeId.localeCompare(b.roomTypeId);
      if (c1 !== 0) return c1;
      const c2 = a.ratePlanId.localeCompare(b.ratePlanId);
      if (c2 !== 0) return c2;
      return a.stayDate.localeCompare(b.stayDate);
    });
  const fingerprint = await fingerprintPayload({ updates: normalized });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { updates: normalized };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryBulkUpdateRates']>>>({
    env: ctx.env,
    commandId: 'rates.bulk_update',
    routeId: 'post_rates_bulk',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryBulkUpdateRates(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'rates:write' }, 403);
    if (err === 'not_member') return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

async function handlePostFolioSplit(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const sourceFolioLineId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    splits: Array<{ folioLineId: string; amountMinor: number }>;
    idempotencyKey: string;
  };
  if (!body?.splits?.length || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { sourceFolioLineId, splits: body.splits };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySplitFolioLine']>>>({
    env: ctx.env,
    commandId: 'folio.split_charge',
    routeId: 'post_folio_split',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.trySplitFolioLine(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;

  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:adjust' }, 403);
    return json({ ok: false, error: err }, mapReservationCommandErrorStatus(err ?? 'unknown'));
  }
  return json(result, 200);
}

function mapPaymentCommandErrorStatus(error: string): number {
  if (error === PSP_UNAVAILABLE) return 501;
  if (error === IDEM_KEY_REUSED) return 409;
  if (error === NOT_FOUND) return 404;
  if (
    error === PAYMENT_NOT_CAPTURABLE ||
    error === LINE_NOT_SPLITTABLE ||
    error === SPLIT_AMOUNT_MISMATCH ||
    error === MONEY_INVALID ||
    error === CURRENCY_UNSET
  ) {
    return 422;
  }
  if (error === ENTITLEMENT_REQUIRED) return 402;
  if (error === ENTITLEMENT_UNAVAILABLE) return 503;
  return mapReservationCommandErrorStatus(error);
}

async function handlePostFolioAuthorize(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    paymentId: string;
    amountMinor: number;
    idempotencyKey: string;
  };
  if (!body?.paymentId || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const requestFingerprint = await fingerprintPayload({
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAuthorizePayment']>>>({
    env: ctx.env,
    commandId: 'folio.authorize',
    routeId: 'post_folio_authorize',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryAuthorizePayment(actor, commandPayload),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    return json({ ok: false, error: err }, mapPaymentCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostFolioCapture(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    amountMinor: number;
    idempotencyKey: string;
  };
  if (body?.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const captureFingerprint = await fingerprintPayload({
    paymentId,
    amountMinor: body.amountMinor,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId,
    amountMinor: body.amountMinor,
    idempotencyKey: body.idempotencyKey,
    captureFingerprint,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCapturePayment']>>>({
    env: ctx.env,
    commandId: 'folio.capture',
    routeId: 'post_folio_capture',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: captureFingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.tryCapturePayment(actor, commandPayload),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:post' }, 403);
    return json({ ok: false, error: err }, mapPaymentCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handlePostFolioSplitPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const sourceFolioLineId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    splits: Array<{ folioLineId: string; amountMinor: number }>;
    idempotencyKey: string;
  };
  if (!body?.splits?.length || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { sourceFolioLineId, splits: body.splits };
  const fingerprint = await fingerprintPayload(commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySplitChargePayment']>>>({
    env: ctx.env,
    commandId: 'folio.split_charge_payment',
    routeId: 'post_folio_split_payment',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload,
    observability: ctx.observability,
    invoke: () => resolvedCtx.resolved.stub.trySplitChargePayment(actor, commandPayload, idem),
  });

  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    const err = result.error;
    if (err === NOT_FOUND || err === 'not_member') return json({ error: 'not_found' }, 404);
    if (err === FORBIDDEN) return json({ error: 'forbidden', permission: 'folio:adjust' }, 403);
    return json({ ok: false, error: err }, mapPaymentCommandErrorStatus(err));
  }
  return json(result, 200);
}

async function handleGetFolioPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readPayment(paymentId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetFolioPayments(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listPaymentsForReservation(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetNightAudit(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const status = await resolvedCtx.resolved.stub.readNightAuditStatus();
    if (!status.ok) return json({ ok: false, error: status.error }, 422);
    const pendingOpenCount = await countPendingOpen(ctx.env.PLATFORM_DB, propertyId);
    return json({ ...status, pendingOpenCount }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetNightAuditReport(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const businessDate = decodeURIComponent(ctx.match[2]!);
  const reportId = decodeURIComponent(ctx.match[3]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const index = await resolvedCtx.resolved.stub.readNightAuditReportIndex(businessDate, reportId);
    if (!index) return json({ error: 'not_found' }, 404);
    const obj = await ctx.env.EVENT_LOG_R2?.get(index.r2Key);
    if (!obj) return json({ error: 'not_found' }, 404);
    return new Response(await obj.text(), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    if (isPropertyDoTransportFailure(e)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostNightAuditRun(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { idempotencyKey?: string };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const status = await resolvedCtx.resolved.stub.readNightAuditStatus();
  if (!status.ok) return json({ ok: false, error: status.error }, 422);
  const businessDate = status.businessDate;
  const fingerprint = await fingerprintPayload({ propertyId, businessDate });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryStartNightAudit']>>>({
    env: ctx.env,
    commandId: 'night_audit.run',
    routeId: 'post_night_audit_run',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload: { propertyId, businessDate },
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryStartNightAudit(actor, {
        key: body.idempotencyKey!,
        fingerprint,
      }),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.error === 'forbidden') {
      return json({ error: 'forbidden', permission: 'night_audit:run' }, 403);
    }
    if (result.error === NIGHT_AUDIT_HALTED || result.error === 'night_audit_not_due') {
      return json({ error: result.error }, 409);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    return json({ ok: false, error: result.error }, 422);
  }

  const created = await getOrCreateNightAuditWorkflow(
    ctx.env.NIGHT_AUDIT_WORKFLOW,
    propertyId,
    result.businessDate,
  );
  if (created.created) {
    return json(
      { workflowId: created.workflowId, businessDate: result.businessDate, instanceStatus: 'queued' },
      202,
    );
  }
  const mapped = mapNightAuditInstanceHttp(
    created.workflowId,
    result.businessDate,
    created.instanceStatus,
  );
  if (mapped.status === 409 && mapped.body.error === 'night_audit_workflow_exists') {
    if (await resolvedCtx.resolved.stub.isNightAuditHalted()) {
      return json({ error: NIGHT_AUDIT_HALTED }, 409);
    }
  }
  return json(mapped.body, mapped.status);
}

async function handlePostNightAuditRetry(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as {
    idempotencyKey?: string;
    businessDate?: string;
    step?: string;
  };
  if (!body?.idempotencyKey || !body.businessDate || !body.step) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!(NIGHT_AUDIT_STEPS as readonly string[]).includes(body.step)) {
    return json({ error: 'invalid_body' }, 400);
  }
  const step = body.step as NightAuditStep;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({
    propertyId,
    businessDate: body.businessDate,
    step,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const census = { pendingOpenCount: await countPendingOpen(ctx.env.PLATFORM_DB, propertyId) };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRetryAuditStep']>>>({
    env: ctx.env,
    commandId: 'night_audit.retry_step',
    routeId: 'post_night_audit_retry',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload: { propertyId, businessDate: body.businessDate, step },
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryRetryAuditStep(
        actor,
        { businessDate: body.businessDate!, step },
        { key: body.idempotencyKey!, fingerprint },
        census,
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.error === 'forbidden') {
      return json({ error: 'forbidden', permission: 'night_audit:run' }, 403);
    }
    if (result.error === 'night_audit_step_not_failed') {
      return json({ error: result.error }, 409);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    return json({ ok: false, error: result.error }, 422);
  }
  return json({ status: result.status, error: result.error }, 200);
}

async function handlePostNightAuditResolveHalt(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { idempotencyKey?: string; businessDate?: string };
  if (!body?.idempotencyKey || !body.businessDate) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ propertyId, businessDate: body.businessDate });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const census = { pendingOpenCount: await countPendingOpen(ctx.env.PLATFORM_DB, propertyId) };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryResolveHalt']>>>({
    env: ctx.env,
    commandId: 'night_audit.resolve_halt',
    routeId: 'post_night_audit_resolve_halt',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload: { propertyId, businessDate: body.businessDate },
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryResolveHalt(
        actor,
        { businessDate: body.businessDate! },
        { key: body.idempotencyKey!, fingerprint },
        census,
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.error === 'forbidden') {
      return json({ error: 'forbidden', permission: 'night_audit:run' }, 403);
    }
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    return json({ ok: false, error: result.error }, 422);
  }
  return json({ status: result.status, error: result.error, halted: result.halted }, 200);
}

async function handlePostProvisionalExceptionResolve(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const body = (await ctx.request.json()) as { idempotencyKey?: string };
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await fingerprintPayload({ propertyId, exceptionId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryResolveProvisionalException']>>
  >({
    env: ctx.env,
    commandId: 'provisional.resolve_exception',
    routeId: 'post_provisional_exception_resolve',
    orgId: resolvedCtx.property.orgId,
    propertyId,
    timeZone: resolvedCtx.property.timeZone,
    actorUserId: ctx.actor.userId,
    idempotencyKey: body.idempotencyKey,
    requestFingerprint: fingerprint,
    commandPayload: { propertyId, exceptionId },
    observability: ctx.observability,
    invoke: () =>
      resolvedCtx.resolved.stub.tryResolveProvisionalException(
        actor,
        { exceptionId },
        { key: body.idempotencyKey!, fingerprint },
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.error === 'forbidden') {
      return json({ error: 'forbidden', permission: 'night_audit:run' }, 403);
    }
    if (result.error === NOT_FOUND) return json({ error: NOT_FOUND }, 404);
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    return json({ ok: false, error: result.error }, 422);
  }
  if (result.alreadyResolved) {
    return json({ ok: true, alreadyResolved: true }, 200);
  }
  return json({ ok: true }, 200);
}

export const V1_ROUTES: V1RouteDef[] = [
  {
    scope: 'bootstrap',
    method: 'POST',
    pattern: /^\/v1\/orgs$/,
    handler: handlePostOrgs,
  },
  {
    scope: 'dev',
    method: 'POST',
    pattern: /^\/v1\/admin\/migration-sweep$/,
    handler: handlePostMigrationSweep,
  },
  {
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/properties$/,
    permission: 'property:provision',
    entitlement: 'pms.core',
    handler: handlePostOrgProperties,
  },
  {
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/properties$/,
    permission: 'org:read',
    handler: handleGetOrgProperties,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)$/,
    permission: 'property:read',
    handler: handleGetProperty,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/registry\/properties\/([^/]+)$/,
    permission: 'property:read',
    handler: handleGetRegistryProperty,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types$/,
    permission: 'inventory:write',
    commandId: 'inventory.add_room_type',
    handler: handlePostRoomTypes,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'inventory.update_room_type',
    handler: handlePutRoomType,
  },
  {
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'inventory.delete_room_type',
    handler: handleDeleteRoomType,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/availability$/,
    permission: 'inventory:read',
    entitlement: 'pms.core',
    handler: handleGetAvailability,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations$/,
    permission: 'reservations:write',
    commandId: 'reservations.create',
    handler: handlePostReservations,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetReservation,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/,
    permission: 'reservations:write',
    commandId: 'reservations.modify',
    handler: handlePatchReservation,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel$/,
    permission: 'reservations:write',
    commandId: 'reservations.cancel',
    handler: handlePostReservationCancel,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-in$/,
    permission: 'reservations:write',
    commandId: 'reservations.check_in',
    handler: handlePostReservationCheckIn,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-out$/,
    permission: 'reservations:write',
    commandId: 'reservations.check_out',
    handler: handlePostReservationCheckOut,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/no-show$/,
    permission: 'reservations:write',
    commandId: 'reservations.no_show',
    handler: handlePostReservationNoShow,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel-check-in$/,
    permission: 'reservations:write',
    commandId: 'reservations.cancel_check_in',
    handler: handlePostReservationCancelCheckIn,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exception-count$/,
    permission: 'property:read',
    handler: handleGetProvisionalExceptionCount,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions$/,
    permission: 'property:read',
    handler: handleGetProvisionalExceptions,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-days$/,
    permission: 'rates:write',
    commandId: 'rates.upsert_day',
    handler: handlePutRateDays,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/restriction-days$/,
    permission: 'rates:write',
    commandId: 'restrictions.upsert_day',
    handler: handlePutRestrictionDays,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/lines$/,
    permission: 'folio:post',
    commandId: 'folio.add_item',
    handler: handlePostFolioLines,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolio,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/split$/,
    permission: 'folio:adjust',
    commandId: 'folio.split_charge',
    handler: handlePostFolioSplit,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms$/,
    permission: 'inventory:write',
    commandId: 'rooms.create',
    handler: handlePostRooms,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'rooms.update',
    handler: handlePatchRoom,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetRooms,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/status$/,
    permission: 'housekeeping:write',
    commandId: 'rooms.update_status',
    handler: handlePostRoomStatus,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/bulk-status$/,
    permission: 'housekeeping:write',
    commandId: 'rooms.bulk_update_status',
    handler: handlePostRoomsBulkStatus,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/assign-room$/,
    permission: 'reservations:write',
    commandId: 'reservations.assign_room',
    handler: handlePostReservationAssignRoom,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.assign',
    handler: handlePostHousekeepingAssign,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetHousekeepingAssignments,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans$/,
    permission: 'rates:write',
    commandId: 'rates.create_plan',
    handler: handlePostRatePlans,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.update_plan',
    handler: handlePatchRatePlan,
  },
  {
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.delete_plan',
    handler: handleDeleteRatePlan,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRatePlans,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)\/rates$/,
    permission: 'rates:write',
    commandId: 'rates.update_room_type_rate',
    handler: handlePutRoomTypeRate,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rates\/bulk$/,
    permission: 'rates:write',
    commandId: 'rates.bulk_update',
    handler: handlePostRatesBulk,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests$/,
    permission: 'guests:write',
    commandId: 'guests.create',
    handler: handlePostGuests,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/,
    permission: 'guests:write',
    commandId: 'guests.update',
    handler: handlePatchGuest,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/erase$/,
    permission: 'guests:erase',
    commandId: 'guests.erase',
    handler: handlePostGuestErase,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handleGetGuest,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)$/,
    permission: 'config:write',
    commandId: 'property.update_details',
    handler: handlePatchPropertyDetails,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/config\/domain$/,
    permission: 'settings:configure',
    commandId: 'config.put_domain',
    handler: handlePutDomainConfig,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments\/authorize$/,
    permission: 'folio:post',
    commandId: 'folio.authorize',
    handler: handlePostFolioAuthorize,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/capture$/,
    permission: 'folio:post',
    commandId: 'folio.capture',
    handler: handlePostFolioCapture,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/split-payment$/,
    permission: 'folio:adjust',
    commandId: 'folio.split_charge_payment',
    handler: handlePostFolioSplitPayment,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolioPayment,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolioPayments,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes$/,
    permission: 'settings:configure',
    commandId: 'folio.create_charge_code',
    handler: handlePostChargeCodes,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'folio.update_charge_code',
    handler: handlePatchChargeCode,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes\/([^/]+)\/status$/,
    permission: 'settings:configure',
    commandId: 'folio.set_charge_code_status',
    handler: handlePutChargeCodeStatus,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetChargeCodes,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules$/,
    permission: 'settings:configure',
    commandId: 'folio.create_tax_rule',
    handler: handlePostTaxRules,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules\/([^/]+)\/supersede$/,
    permission: 'settings:configure',
    commandId: 'folio.supersede_tax_rule',
    handler: handlePutTaxRuleSupersede,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetTaxRules,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts$/,
    permission: 'folio:post',
    commandId: 'folio.open_shift',
    handler: handlePostShifts,
  },
  {
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts\/([^/]+)\/close$/,
    permission: 'folio:post',
    commandId: 'folio.close_shift',
    handler: handlePutShiftClose,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments\/cash$/,
    permission: 'folio:post',
    commandId: 'folio.record_cash_payment',
    handler: handlePostCashPayment,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetShift,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/audit-log$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetAuditLog,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/arrivals$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskArrivals,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/departures$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskDepartures,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/in-house$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskInHouse,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/batch$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handlePostGuestsBatch,
  },
  {
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/entitlements$/,
    permission: 'org:read',
    handler: handleGetOrgEntitlements,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/shift$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskShift,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/shifts\/recent$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskRecentShifts,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/me$/,
    permission: 'property:read',
    // no entitlement — kill-switch must not brick /me
    handler: handleGetPropertyMe,
  },
  {
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/members$/,
    permission: 'org:manage',
    handler: handleListOrgMembers,
  },
  {
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/members$/,
    permission: 'org:manage',
    handler: handleCreateOrgMember,
  },
  {
    scope: 'org',
    method: 'PATCH',
    pattern: /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/,
    permission: 'org:manage',
    handler: handleUpdateOrgMember,
  },
  {
    scope: 'org',
    method: 'DELETE',
    pattern: /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/,
    permission: 'org:manage',
    handler: handleDeleteOrgMember,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/members$/,
    permission: 'staff:read',
    handler: handleListPropertyMembers,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/members$/,
    permission: 'staff:write',
    handler: handleCreatePropertyMember,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/,
    permission: 'staff:write',
    handler: handleUpdatePropertyMember,
  },
  {
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/,
    permission: 'staff:write',
    handler: handleDeletePropertyMember,
  },
  {
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/cancel$/,
    permission: 'org:cancel',
    handler: handlePostOrgCancel,
  },
  {
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/purge$/,
    permission: 'org:purge',
    handler: handlePostOrgPurge,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/roster$/,
    permission: 'roster:read',
    entitlement: 'pms.core',
    handler: handleGetRoster,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)$/,
    permission: 'roster:read',
    entitlement: 'pms.core',
    handler: handleGetRosterOne,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster$/,
    permission: 'roster:write',
    commandId: 'roster.add',
    entitlement: 'pms.core',
    handler: handlePostRoster,
  },
  {
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)$/,
    permission: 'roster:write',
    commandId: 'roster.update',
    entitlement: 'pms.core',
    handler: handlePatchRoster,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)\/status$/,
    permission: 'roster:write',
    commandId: 'roster.status',
    entitlement: 'pms.core',
    handler: handlePostRosterStatus,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)\/exit$/,
    permission: 'roster:write',
    commandId: 'roster.exit',
    entitlement: 'pms.core',
    handler: handlePostRosterExit,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit$/,
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    handler: handleGetNightAudit,
  },
  {
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/reports\/([^/]+)\/([^/]+)$/,
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    handler: handleGetNightAuditReport,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/run$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.run',
    entitlement: 'pms.core',
    handler: handlePostNightAuditRun,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/retry$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.retry_step',
    entitlement: 'pms.core',
    handler: handlePostNightAuditRetry,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/resolve-halt$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.resolve_halt',
    entitlement: 'pms.core',
    handler: handlePostNightAuditResolveHalt,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/resolve$/,
    permission: 'night_audit:run',
    commandId: 'provisional.resolve_exception',
    entitlement: 'pms.core',
    handler: handlePostProvisionalExceptionResolve,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/confirm$/,
    permission: 'reservations:write',
    commandId: 'reservations.confirm',
    entitlement: 'pms.core',
    handler: handlePostReservationConfirm,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/hold$/,
    permission: 'reservations:write',
    commandId: 'reservations.hold',
    entitlement: 'pms.core',
    handler: handlePostReservationHold,
  },
  {
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/front-office$/,
    permission: 'reservations:write',
    commandId: 'reservations.update_status',
    handler: handlePostReservationFrontOffice,
  },
];

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function enumerateDaysInclusive(fromDate: string, toDate: string): string[] {
  const days: string[] = [];
  let curr = fromDate;
  while (curr <= toDate) {
    days.push(curr);
    curr = addDays(curr, 1);
  }
  return days;
}

async function getKvBulkBounded(
  kv: KVNamespace,
  keys: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const limit = 100;
  for (let i = 0; i < keys.length; i += limit) {
    const chunk = keys.slice(i, i + limit);
    try {
      const batchRes = await (kv as { get(k: string[]): Promise<Map<string, string | null>> }).get(chunk);
      if (batchRes instanceof Map) {
        for (const [k, v] of batchRes.entries()) {
          result.set(k, v);
        }
      }
    } catch {
      await Promise.all(
        chunk.map(async (k) => {
          const val = await kv.get(k);
          result.set(k, val);
        }),
      );
    }
  }
  return result;
}

async function serveStaleKvAvailability(
  ctx: V1DispatchContext,
  propertyId: string,
  fromDate: string,
  toDate: string,
  roomTypeId: string,
): Promise<Response | null> {
  const stayDates = enumerateDaysInclusive(fromDate, toDate);
  const keys = stayDates.map((date) => `ari:${propertyId}:${roomTypeId}:${date}`);
  const kvMap = await getKvBulkBounded(ctx.env.ARI_KV, keys);
  const items: Array<{
    roomTypeId: string;
    stayDate: string;
    physical: number;
    blocked: number;
    held: number;
    sold: number;
    oversell: number;
    free: number;
  }> = [];
  const versions: number[] = [];
  const now = Date.now();
  let oldestWrittenAt = now;

  for (const key of keys) {
    const val = kvMap.get(key);
    if (!val) return null;
    try {
      const parsed = JSON.parse(val) as {
        physical: number;
        blocked: number;
        held: number;
        sold: number;
        oversell: number;
        free: number;
        ariVersion: number;
        writtenAt: number;
      };
      oldestWrittenAt = Math.min(oldestWrittenAt, parsed.writtenAt);
      const stayDate = key.split(':').pop()!;
      items.push({
        roomTypeId,
        stayDate,
        physical: parsed.physical,
        blocked: parsed.blocked,
        held: parsed.held,
        sold: parsed.sold,
        oversell: parsed.oversell,
        free: parsed.free,
      });
      versions.push(parsed.ariVersion);
    } catch {
      return null;
    }
  }

  return json({
    propertyId,
    fromDate,
    toDate,
    ariVersion: Math.min(...versions),
    source: 'kv',
    cache: 'stale',
    degraded: true,
    projectionAgeMs: now - oldestWrittenAt,
    items,
  });
}

async function handleGetAvailability(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const fromDate = ctx.url.searchParams.get('fromDate');
  const toDate = ctx.url.searchParams.get('toDate');
  const roomTypeId = ctx.url.searchParams.get('roomTypeId') || undefined;

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!fromDate || !toDate || !dateRe.test(fromDate) || !dateRe.test(toDate)) {
    return json({ error: 'invalid_date' }, 400);
  }
  if (fromDate > toDate) {
    return json({ error: 'invalid_date_range' }, 400);
  }
  const horizonCapDate = addDays(fromDate, 89);
  if (toDate > horizonCapDate) {
    return json({ error: 'date_range_exceeds_max' }, 400);
  }

  // Branch 1: roomTypeId supplied -> Attempt KV Bulk Read (Pure KV path - zero D1 reads)
  if (roomTypeId) {
    const stayDates = enumerateDaysInclusive(fromDate, toDate);
    const keys = stayDates.map((date) => `ari:${propertyId}:${roomTypeId}:${date}`);
    const kvMap = await getKvBulkBounded(ctx.env.ARI_KV, keys);

    const items: Array<{
      roomTypeId: string;
      stayDate: string;
      physical: number;
      blocked: number;
      held: number;
      sold: number;
      oversell: number;
      free: number;
    }> = [];
    const versions: number[] = [];
    const now = Date.now();
    let allFresh = true;

    for (const key of keys) {
      const val = kvMap.get(key);
      if (!val) {
        allFresh = false;
        break;
      }
      try {
        const parsed = JSON.parse(val) as {
          physical: number;
          blocked: number;
          held: number;
          sold: number;
          oversell: number;
          free: number;
          ariVersion: number;
          writtenAt: number;
        };
        if (now - parsed.writtenAt >= 60_000) {
          allFresh = false;
          break;
        }
        const stayDate = key.split(':').pop()!;
        items.push({
          roomTypeId,
          stayDate,
          physical: parsed.physical,
          blocked: parsed.blocked,
          held: parsed.held,
          sold: parsed.sold,
          oversell: parsed.oversell,
          free: parsed.free,
        });
        versions.push(parsed.ariVersion);
      } catch (err) {
        logError(ctx.observability, {
          msg: 'ari.projection.parse_error',
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        allFresh = false;
        break;
      }
    }

    if (allFresh && items.length === keys.length) {
      return json({
        propertyId,
        fromDate,
        toDate,
        ariVersion: Math.min(...versions),
        source: 'kv',
        cache: 'hit',
        items,
      });
    }
  }

  // Branch 2: roomTypeId omitted OR KV cache miss/expired -> Fallback to PropertyDO
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) {
    return json({ error: 'not_found' }, 404);
  }

  try {
    const { ariVersion, rows } = await resolved.stub.readAvailabilityRange(fromDate, toDate, roomTypeId);

    const items = rows.map((row) => ({
      roomTypeId: row.roomTypeId,
      stayDate: row.stayDate,
      physical: row.physical,
      blocked: row.blocked,
      held: row.held,
      sold: row.sold,
      oversell: row.oversell,
      free: row.physical - row.blocked - row.held - row.sold + row.oversell,
    }));

    return json({
      propertyId,
      fromDate,
      toDate,
      ariVersion,
      source: 'do',
      cache: 'miss',
      items,
    });
  } catch (e) {
    if (!isPropertyDoTransportFailure(e)) throw e;
    if (roomTypeId) {
      const stale = await serveStaleKvAvailability(ctx, propertyId, fromDate, toDate, roomTypeId);
      if (stale) return stale;
    }
    return degradedReadStaleResponse();
  }
}


for (const route of V1_ROUTES) {
  if ('commandId' in route && route.commandId) {
    requireCatalogEntry(route.commandId);
  }
}

function findRoute(method: string, pathname: string): { route: V1RouteDef; match: RegExpMatchArray } | null {
  for (const route of V1_ROUTES) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) return { route, match };
  }
  return null;
}

export async function dispatchV1(
  request: Request,
  env: PmsEnv,
  observability: ObservabilityContext,
  route: V1RouteDef,
  match: RegExpMatchArray,
): Promise<Response> {
  const actor = await resolveActor(request, env);
  if (actor instanceof Response) return actor;
  observability.userId = actor.userId;

  if (route.scope === 'dev') {
    if (!isDevActorAllowed(env) || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }
    return route.handler({ request, env, observability, actor, url: new URL(request.url), match });
  }

  if (route.scope === 'bootstrap') {
    return route.handler({ request, env, observability, actor, url: new URL(request.url), match });
  }

  const feature = entitlementForRoute(route);
  if (feature && (await checkKillSwitch(env, feature))) {
    return new Response(null, { status: 503 });
  }

  const tenant = await resolveTenant(env, route, match);
  if (tenant instanceof Response) return tenant;
  observability.orgId = tenant.orgId;
  if (tenant.propertyId) observability.propertyId = tenant.propertyId;

  const denied = await requirePermission(
    env,
    tenant.orgId,
    tenant.propertyId,
    actor.userId,
    route.permission,
  );
  if (denied) return denied;

  if (feature) {
    const gated = await gateEntitlement(env, tenant.orgId, feature);
    if (gated) return gated;
  }

  return route.handler({
    request,
    env,
    observability,
    actor,
    url: new URL(request.url),
    match,
  });
}

export async function handleV1(
  request: Request,
  env: PmsEnv,
  observability: ObservabilityContext,
): Promise<Response> {
  const url = new URL(request.url);
  const found = findRoute(request.method, url.pathname);
  if (!found) return json({ error: 'not_found' }, 404);

  if (found.route.scope === 'dev') {
    if (!isDevActorAllowed(env) || request.method !== 'POST') {
      return json({ error: 'not_found' }, 404);
    }
  }

  return dispatchV1(request, env, observability, found.route, found.match);
}
