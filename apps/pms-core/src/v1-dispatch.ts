import type { CommandError, FeatureKey, Jurisdiction, PropertyRecord, ProvisionPropertyInput, RouteId } from '@hospai/contracts';
import {
  ARCHIVE_BLOCKED,
  ALREADY_CANCELLED,
  BUSINESS_DATE_UNSET,
  FORBIDDEN,
  GUEST_ALREADY_ERASED,
  GUEST_EXISTS,
  GUEST_NOT_FOUND,
  guestCrmBodyTypesValid,
  guestCrmExceedsCaps,
  normalizeGuestCrmFields,
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
  RATE_MISSING,
  INVALID_CANCEL_POLICY,
  RATE_PLAN_CODE_EXISTS,
  RATE_PLAN_ID_EXISTS,
  DEFAULT_RATE_PLAN_PROTECTED,
  DERIVED_RATE_PLAN_INVALID,
  DERIVED_RATE_PLAN_WRITE_FORBIDDEN,
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
  VIRTUAL_TYPE_NO_ROOMS,
  CURRENCY_UNSET,
  CROSS_CURRENCY_UNSUPPORTED,
  FX_RATE_INVALID,
  FX_RATE_MISSING,
  FX_RATE_NOT_LEDGER,
  FX_RATE_OPEN_EXISTS,
  FX_REASON_REQUIRED,
  PAYMENT_NOT_CHARGEBACKABLE,
  REFUND_EXCEEDS_REMAINING,
  LEDGER_AMOUNT_MISMATCH,
  MONEY_INVALID,
  SPLIT_AMOUNT_MISMATCH,
  LINE_NOT_SPLITTABLE,
  PSP_UNAVAILABLE,
  PAYMENT_NOT_CAPTURABLE,
  PAYMENT_NOT_RECONCILABLE,
  HOLD_EXPIRED,
  INQUIRY_EXPIRED,
  ROOM_REQUIRED,
  ROOM_NOT_READY,
  ROOM_OUT_OF_ORDER,
  OOO_VIA_RANGE,
  OOO_ROOM_ASSIGNED,
  OOO_RANGE_OVERLAP,
  OOO_INVALID_RANGE,
  FRONT_OFFICE_COMMENT_TOO_LONG,
  OCCUPANCY_EXCEEDED,
  WINDOW_CLOSED,
  WINDOW_NOT_CLOSABLE,
  WINDOW_BALANCE_DUE,
  WINDOW_NOT_REOPENABLE,
  WINDOW_NOT_OPENABLE,
  GUEST_WINDOW_NOT_OPENABLE,
  TRANSFER_CROSS_RESERVATION,
  TRANSFER_SAME_WINDOW,
  LINE_NOT_TRANSFERABLE,
  LINE_ALREADY_TRANSFERRED,
  PAYMENT_NOT_VOIDABLE,
  PAYMENT_NOT_REFUNDABLE,
  LINE_NOT_DISCOUNTABLE,
  DISCOUNT_REASON_REQUIRED,
  PROMO_NOT_FOUND,
  PROMO_NOT_APPLICABLE,
  PROMO_CODE_EXISTS,
  INVOICE_ALREADY_EXISTS,
  INVOICE_NOT_FOUND,
  INVOICE_VOIDED,
  INVOICE_R2_UNBOUND,
  INVOICE_REQUIRED,
  FOLIO_BALANCE_DUE,
  CITY_LEDGER_ACCOUNT_EXISTS,
  CITY_LEDGER_ACCOUNT_NOT_FOUND,
  CITY_LEDGER_ACCOUNT_ARCHIVED,
  CITY_LEDGER_CREDIT_LIMIT_EXCEEDED,
  CITY_LEDGER_BILLED_PARTY_INVALID,
  CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE,
  CITY_LEDGER_STATEMENT_NOT_FOUND,
  CITY_LEDGER_R2_UNBOUND,
  CITY_LEDGER_CHARGE_ALREADY_POSTED,
  commandFingerprint,
  freeAvailability,
  requireCatalogEntry,
  requiredPermissionForKey,
  RESERVATION_STATUSES,
  validateTenantId,
  type Permission,
  type IdempotencyKey,
  ALREADY_MEMBER,
  ALREADY_RESOLVED,
  BULK_NOT_ADMITTED,
  BUSINESS_DATE_CLOSED,
  CONFIG_CLASS_NOT_DOMAIN,
  CONSTITUENT_IN_USE,
  DECRYPT_UNRESOLVED,
  DOMAIN_ERROR,
  EMPTY_KINDS,
  GUEST_REF_REQUIRED,
  INTERNAL_ERROR,
  INVALID_ASSIGNEE_REF,
  INVALID_BUSINESS_DATE,
  INVALID_DATE,
  INVALID_DATE_RANGE,
  INVALID_KINDS,
  INVALID_PROMO_CODE,
  INVALID_PROMO_KIND_FIELD,
  INVALID_PROMO_WINDOW,
  INVALID_ROLE,
  INVALID_STATUS,
  INVALID_STAY_RANGE,
  INVALID_VOID_REASON,
  INVALID_WINDOW,
  INVOICE_COUNTER_RACE,
  KEY_SHRED_FAILED,
  LAST_OWNER,
  LIMIT_EXCEEDED,
  NAMED_LIST_MAX_ENTRIES,
  RATES_BULK_UPDATE_MAX,
  ROOMS_BULK_STATUS_MAX,
  FOLIO_SPLIT_MAX,
  ROSTER_KINDS_MAX,
  RESERVATION_SEARCH_GUEST_REF_CAP,
  RESERVATION_SEARCH_ROW_LIMIT,
  ROSTER_OPS_SKILLS_MAX,
  normalizeRosterOpsSkills,
  rosterOpsFieldsValid,
  rosterOpsSkillsExceedCaps,
  type RosterSetOpsPayload,
  NIGHT_AUDIT_NOT_DUE,
  NIGHT_AUDIT_STEP_NOT_FAILED,
  NIGHT_AUDIT_WORKFLOW_EXISTS,
  NOTE_LIMIT,
  NOTE_TOO_LONG,
  NOT_MEMBER,
  ORG_ID_UNSET,
  ORG_UNREACHABLE,
  PAYMENT_INSERT_FAILED,
  PENDING_CENSUS_REQUIRED,
  PENDING_COMMANDS_UNDRAINED,
  PROMO_ID_EXISTS,
  PROPERTY_ID_UNSET,
  PROPERTY_REF_NOT_FOUND,
  PROVISIONAL_EXCEPTIONS_OPEN,
  PSP_ADAPTER_FAILED,
  REPORTS_R2_UNBOUND,
  ROOM_TYPE_KIND_IMMUTABLE,
  ROUTING_RULE_CONFLICT,
  SCOPE_MISMATCH,
  TENANT_NOT_ACTIVE,
  TIMEZONE_UNSET,
  isCommandError,
  isHousekeepingInventoryCategory,
  isHousekeepingInventoryMovementKind,
  isHousekeepingPriorityLevelInput,
  isMaintenanceCategory,
  isMaintenancePriority,
  UNDECLARED_CONFIG_PREFIX,
  UNKNOWN_COMMAND,
  VALIDATION_ERROR,
  VIRTUAL_CONSTITUENTS_DUPLICATE,
  VIRTUAL_CONSTITUENTS_MIN_TWO,
  VIRTUAL_CONSTITUENTS_ON_PHYSICAL,
  VIRTUAL_CONSTITUENTS_REQUIRED,
  VIRTUAL_CONSTITUENT_NOT_PHYSICAL,
  VIRTUAL_NESTED_FORBIDDEN,
  VIRTUAL_OCCUPANCY_EXCEEDS_CONSTITUENTS,
  VIRTUAL_ROOM_COUNT_MUST_BE_ZERO,
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
import { authorizedParties, resolveActor, requirePermission, type Actor } from './auth.js';
import { applySecurityHeaders } from './security-headers.js';
import { parseRequestJson } from './parse-request-json.js';
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
import { commandErrorHttpStatus, commandFailureResponse } from './command-error-http.js';
import { finishPropertyDoInvoke } from './finish-property-do-invoke.js';
import { commandEnvelope } from './command-envelope.js';
import { isPropertyDoTransportFailure } from './property-do-transport.js';
import { OrgDO } from './org-do.js';
import { NIGHT_AUDIT_HALTED } from '@hospai/contracts';
import { NIGHT_AUDIT_STEPS, type NightAuditStep, type PropertyDO } from './property-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { countPendingOpen } from './night-audit-census.js';
import {
  getOrCreateNightAuditWorkflow,
  mapNightAuditInstanceHttp,
} from './night-audit-http.js';
import { guestPurgeWorkflowId, closeOrgForPurge, nextOrgPurgeWorkflowId, reopenOrg } from './purge-certificate.js';
import { ensurePurgeWorkflowInstance } from './purge-workflow-create.js';
import { runDemoSeed } from './demo-seed.js';
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
  | 'invalid_role'
  | typeof INTERNAL_ERROR;

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
    case INTERNAL_ERROR:
      return json({ ok: false, error: INTERNAL_ERROR }, 500);
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseOptionalFrontDeskLimit(url: URL): number | undefined {
  const raw = url.searchParams.get('limit');
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Directory/search/stays: default 25, max 50. Garbage / out of range → invalid (400). */
function parseGuestDirectoryLimit(raw: string | null | undefined): number | 'invalid' {
  if (raw === null || raw === undefined || raw === '') return 25;
  if (!/^-?\d+$/.test(raw)) return 'invalid';
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 50) return 'invalid';
  return n;
}

function parseGuestDirectoryLimitValue(raw: unknown): number | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return 25;
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw < 1 || raw > 50) return 'invalid';
    return raw;
  }
  if (typeof raw === 'string') return parseGuestDirectoryLimit(raw);
  return 'invalid';
}

function coerceCommandError(error: string | undefined): CommandError {
  return error !== undefined && isCommandError(error) ? error : INTERNAL_ERROR;
}

function commandErrorResponse(err: CommandError, permission: Permission): Response {
  return commandFailureResponse(err, permission);
}

const PROMO_CODE_CHARSET = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function promoCodeCharsetOk(code: string): boolean {
  return PROMO_CODE_CHARSET.test(code);
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

async function readOptionalJsonBody(
  request: Request,
): Promise<Record<string, unknown> | null | Response> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return json({ error: 'invalid_json' }, 400);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
}

async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  const raw = await parseRequestJson(request);
  if (raw instanceof Response) return raw;
  if (raw === null) return json({ error: 'invalid_body' }, 400);
  return raw as T;
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
  prefetched?: PropertyRecord,
): Promise<{ property: PropertyRecord; resolved: NonNullable<Awaited<ReturnType<typeof resolvePropertyFromRegistry>>> } | Response> {
  const validatedPrefetch =
    prefetched?.propertyId === propertyId ? prefetched : undefined;
  const property = validatedPrefetch ?? (await getProperty(ctx.env, propertyId));
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;
  const gate = await assertTenantActive(ctx.env, {
    propertyId,
    orgId: property.orgId,
    prefetchedProperty: validatedPrefetch,
  });
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
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId, validatedPrefetch);
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
  tenantProperty?: PropertyRecord;
};

type V1RouteBase = {
  id: RouteId;
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

type ResolvedTenant =
  | { orgId: string; propertyId: null }
  | { orgId: string; propertyId: string; property: PropertyRecord };

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
    return { orgId: property.orgId, propertyId, property };
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
    const bodyParsed = await parseJsonBody<{ orgId: string; name: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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

async function handlePostDemoSeed(ctx: V1DispatchContext): Promise<Response> {
  if (!isDevActorAllowed(ctx.env)) return json({ error: 'not_found' }, 404);

  const demoSeedRaw = await parseRequestJson(ctx.request);
  if (demoSeedRaw instanceof Response) return demoSeedRaw;
  if (demoSeedRaw === null) return json({ error: 'invalid_body' }, 400);
  const body = demoSeedRaw as { orgId?: string; propertyId?: string };
  if (!body?.orgId || !body.propertyId) return json({ error: 'invalid_body' }, 400);

  try {
    validateTenantId(body.orgId);
    validateTenantId(body.propertyId);
  } catch (e) {
    if (e instanceof InvalidTenantIdError) return json({ error: 'invalid_tenant_id' }, 400);
    throw e;
  }

  const property = await getProperty(ctx.env, body.propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  if (property.orgId !== body.orgId) return json({ error: 'org_property_mismatch' }, 400);

  const denied = await requirePermission(
    ctx.env,
    body.orgId,
    null,
    ctx.actor.userId,
    'property:provision',
  );
  if (denied) return denied;

  const resolved = await resolvePropertyFromRegistry(ctx.env, body.propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  resolveOrgStub(ctx.env.ORG_DO, { orgId: body.orgId });

  try {
    const result = await runDemoSeed({
      env: ctx.env,
      actor: { kind: 'user', userId: ctx.actor.userId },
      orgId: body.orgId,
      propertyId: body.propertyId,
      propertyName: property.name,
      timeZone: property.timeZone,
    });
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env) || isOrgDoTransportFailure(e, ctx.env)) {
      return json({ error: 'unavailable', degraded: 'FAIL_CLOSED' }, 503, { 'Retry-After': '30' });
    }
    throw e;
  }
}

async function handlePostOrgCancel(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
    const bodyParsed = await parseJsonBody<{ action?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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
    const bodyParsed = await parseJsonBody<{ orgId?: string; confirm?: boolean }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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

    const bodyParsed = await parseJsonBody<{
    propertyId: string;
    name: string;
    jurisdiction?: Jurisdiction | null;
    timeZone: string;
    currency: string;
    orgName?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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
    if (result.error === 'property_exists') {
      return json({ error: 'property_exists' }, 409);
    }
    if (result.error === 'jurisdiction_conflict') {
      return json({ error: 'jurisdiction_conflict' }, 409);
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleGetProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  // Bootstrap/degraded partial read — tenant-active intentionally skipped; orgId from registry row.
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = resolved.property.orgId;

  try {
    const recorded = await resolved.stub.getRecordedJurisdiction();
    const schemaVersion = await resolved.stub.getSchemaVersion();
    const ledgerCurrency = await resolved.stub.readStoredLedgerCurrency();
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: recorded ?? null,
      schemaVersion,
      ledgerCurrency,
    });
  } catch (e) {
    if (!isPropertyDoTransportFailure(e, ctx.env)) throw e;
    return json({
      property: resolved.property,
      locationHint: resolved.locationHint,
      recordedJurisdiction: null,
      schemaVersion: null,
      propertyDo: 'unreachable',
      ledgerCurrency: null,
    });
  }
}

async function handleGetRegistryProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  // Global registry lookup for routing/bootstrap — no property DO sync or tenant-active gate.
  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;
  return json({ property });
}

async function handlePostRoomTypes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomTypeId: string;
    code: string;
    name: string;
    kind?: 'physical' | 'virtual';
    roomCount?: number;
    maxOccupancy: number;
    maxAdults: number;
    constituentRoomTypeIds?: string[];
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  const kind = body.kind ?? 'physical';

  if (kind === 'virtual') {
    if (
      !body.roomTypeId ||
      !body.code ||
      !body.name ||
      typeof body.maxOccupancy !== 'number' ||
      typeof body.maxAdults !== 'number' ||
      !body.idempotencyKey ||
      !body.constituentRoomTypeIds ||
      body.constituentRoomTypeIds.length === 0
    ) {
      return json({ error: 'invalid_body' }, 400);
    }
  } else if (
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const sortedConstituents =
    kind === 'virtual'
      ? [...body.constituentRoomTypeIds!].sort((a, b) => a.localeCompare(b))
      : undefined;
  const commandPayload =
    kind === 'virtual'
      ? {
          roomTypeId: body.roomTypeId,
          code: body.code,
          name: body.name,
          kind: 'virtual' as const,
          roomCount: 0,
          maxOccupancy: body.maxOccupancy,
          maxAdults: body.maxAdults,
          constituentRoomTypeIds: sortedConstituents!,
        }
      : {
          roomTypeId: body.roomTypeId,
          code: body.code,
          name: body.name,
          roomCount: body.roomCount!,
          maxOccupancy: body.maxOccupancy,
          maxAdults: body.maxAdults,
        };
  const fingerprint = await commandFingerprint('inventory.add_room_type', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAddRoomType']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'inventory.add_room_type',
      routeId: 'post_room_types',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryAddRoomType(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 201,
  });
}

async function handlePutRoomType(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    code?: string;
    name?: string;
    roomCount?: number;
    maxOccupancy?: number;
    maxAdults?: number;
    constituentRoomTypeIds?: string[];
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const sortedConstituents =
    body.constituentRoomTypeIds !== undefined
      ? [...body.constituentRoomTypeIds].sort((a, b) => a.localeCompare(b))
      : undefined;
  const commandPayload = {
    roomTypeId,
    code: body.code,
    name: body.name,
    roomCount: body.roomCount,
    maxOccupancy: body.maxOccupancy,
    maxAdults: body.maxAdults,
    constituentRoomTypeIds: sortedConstituents,
  };
  const fingerprint = await commandFingerprint('inventory.update_room_type', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoomType']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'inventory.update_room_type',
      routeId: 'put_room_type',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpdateRoomType(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 200,
    onFailure: (result) => {if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) {
      return json({ error: 'forbidden', permission: 'inventory:write' }, 403);
    }
    if (result.error === OVERSELL && 'dates' in result) {
      return json({ ok: false, error: result.error, dates: result.dates }, 409);
    }
      return null;
    },
  });
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('inventory.delete_room_type', { roomTypeId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { roomTypeId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRoomType']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'inventory.delete_room_type',
      routeId: 'delete_room_type',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryDeleteRoomType(actor, commandPayload, {
        key: idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      if (result.error === ARCHIVE_BLOCKED) {
        return json({ ok: false, error: result.error }, 409);
      }
      return null;
    },
  });
}

async function handleDeleteRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey =
    ctx.request.headers.get('x-idempotency-key') ?? ctx.url.searchParams.get('idempotencyKey');
  if (!idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('rooms.delete', { roomId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { roomId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRoom']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.delete',
      routeId: 'delete_room',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryDeleteRoom(actor, commandPayload, {
        key: idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      if (result.error === ARCHIVE_BLOCKED) {
        return json({ ok: false, error: result.error }, 409);
      }
      return null;
    },
  });
}

async function handlePatchPropertyDetails(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ name?: string; idempotencyKey?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.name || !body.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const updated = await updatePropertyName(ctx.env, propertyId, body.name);
  if (!updated) return json({ error: 'not_found' }, 404);

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await commandFingerprint('property.update_details', { propertyId, name: body.name });

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
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<{
    key?: string;
    value?: unknown;
    reason?: string;
    effectiveFrom?: string;
    idempotencyKey?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.key || body.value === undefined || !body.reason || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const { key, value, reason, idempotencyKey, effectiveFrom } = body;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await commandFingerprint('config.put_domain', {
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
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'config.put_domain',
      routeId: 'put_domain_config',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
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
      /* undeclared — commandErrorHttpStatus handles */
    }
    if (result.error === FORBIDDEN || result.error === 'scope_mismatch') {
      return json({ error: 'forbidden', permission: perm }, 403);
    }
    return commandFailureResponse(result.error, perm);
  }
  return json({ ok: true, key: result.key, version: result.version, events: result.events }, 200);
}

async function handleGetOperationalConfig(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.listOperationalConfig(propertyId);
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handlePutOperationalConfig(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const key = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<{
    value?: unknown;
    reason?: string;
    idempotencyKey?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    body?.value === undefined ||
    typeof body.reason !== 'string' ||
    !body.reason.trim() ||
    typeof body.idempotencyKey !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (Array.isArray(body.value) && body.value.length > NAMED_LIST_MAX_ENTRIES) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { key, value: body.value, reason: body.reason };
  const fingerprint = await commandFingerprint('config.put_operational', commandPayload);

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryPutOperationalConfig(actor, propertyId, commandPayload, {
      key: body.idempotencyKey,
      fingerprint,
    });
    if (!result.ok) {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      if (result.error === FORBIDDEN || result.error === 'scope_mismatch') {
        return json({ error: 'forbidden', permission: 'settings:configure' }, 403);
      }
      return commandFailureResponse(result.error, 'settings:configure');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'config.put_operational' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePostGuests(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    guestId: string;
    displayName: string;
    email?: string;
    phone?: string;
    tags?: string[];
    vip?: boolean;
    notes?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.guestId || !body.displayName || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!guestCrmBodyTypesValid(body)) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const profile = normalizeGuestCrmFields({
    displayName: body.displayName,
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
    ...(body.vip !== undefined ? { vip: body.vip } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  });
  if (guestCrmExceedsCaps(profile)) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }
  const fingerprint = await commandFingerprint('guests.create', { guestId: body.guestId, ...profile });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryCreateGuest(
      actor,
      propertyId,
      { guestId: body.guestId, profile },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'guests:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<{
    displayName: string;
    email?: string;
    phone?: string;
    tags?: string[];
    vip?: boolean;
    notes?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.displayName || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!guestCrmBodyTypesValid(body)) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const profile = normalizeGuestCrmFields({
    displayName: body.displayName,
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.phone !== undefined ? { phone: body.phone } : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
    ...(body.vip !== undefined ? { vip: body.vip } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
  });
  if (guestCrmExceedsCaps(profile)) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }
  const fingerprint = await commandFingerprint('guests.update', { guestId, ...profile });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryUpdateGuest(
      actor,
      propertyId,
      { guestId, profile },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'guests:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await commandFingerprint('guests.erase', { guestId });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryEraseGuest(
      actor,
      propertyId,
      { guestId },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'guests:erase');
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
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readGuest(actor, propertyId, guestId);
    if (!result.ok) {
      if ('guestId' in result && result.error === DECRYPT_UNRESOLVED) {
        logError(ctx.observability, { msg: 'guests.read.decrypt_incident', guestId: result.guestId });
        return commandFailureResponse(DECRYPT_UNRESOLVED, 'guests:read');
      }
      return commandErrorResponse(result.error, 'guests:read');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

const ROSTER_GET_HEADERS = { 'Cache-Control': 'private, no-store' };
const GUEST_HEADERS = { 'Cache-Control': 'private, no-store' };

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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
      return rosterGetJson({ ok: false, error: err }, commandErrorHttpStatus(err));
    }
    const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
    const kind = ctx.url.searchParams.get('kind');
    const staff = result.staff
      .filter((row) => !kind || row.kinds.includes(kind))
      .map((row) => stripRosterRow(grants, row));
    return rosterGetJson({ ok: true, staff }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) return rosterGetDegraded();
    throw e;
  }
}

async function handleGetRosterOne(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
      return rosterGetJson({ ok: false, error: err }, commandErrorHttpStatus(err));
    }
    const grants = await rosterGrants(org, ctx.actor.userId, propertyId, ctx.env);
    return rosterGetJson({ ok: true, ...stripRosterRow(grants, result) }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) return rosterGetDegraded();
    throw e;
  }
}

async function handlePostRoster(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<RosterHttpBody & { staffId?: unknown }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'staffId' in body) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!body.displayName || !Array.isArray(body.kinds) || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.kinds.length > ROSTER_KINDS_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
  const fingerprint = await commandFingerprint('roster.add', { profile, kinds });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryCreateRoster(
      actor,
      propertyId,
      { profile: { ...profile, displayName: body.displayName }, kinds },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<RosterHttpBody>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.kinds !== undefined && !Array.isArray(body.kinds)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.kinds !== undefined && body.kinds.length > ROSTER_KINDS_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
  const fingerprint = await commandFingerprint('roster.update', { staffId, profile, kinds });

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
      return commandErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<RosterHttpBody>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || (body.status !== 'active' && body.status !== 'inactive')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await commandFingerprint('roster.status', { staffId, status: body.status });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.trySetRosterStatus(
      actor,
      propertyId,
      { staffId, status: body.status },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<RosterHttpBody>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const fingerprint = await commandFingerprint('roster.exit', { staffId });

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.tryExitRoster(
      actor,
      propertyId,
      { staffId },
      { key: body.idempotencyKey, fingerprint },
    );
    if (!result.ok) {
      return commandErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.exit' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}

async function handlePutRosterOps(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const staffId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!('shift' in body) || !('maxRooms' in body) || !('skills' in body)) {
    return json({ error: 'invalid_body' }, 400);
  }
  const candidate = { shift: body.shift, maxRooms: body.maxRooms, skills: body.skills };
  if (!rosterOpsFieldsValid(candidate)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (candidate.skills.length > ROSTER_OPS_SKILLS_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }
  const skills = normalizeRosterOpsSkills(candidate.skills);
  if (rosterOpsSkillsExceedCaps(skills)) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const payload: RosterSetOpsPayload = {
    staffId,
    propertyId,
    shift: candidate.shift,
    maxRooms: candidate.maxRooms,
    skills,
  };
  const fingerprint = await commandFingerprint('roster.set_ops', payload);
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.trySetRosterOps(actor, payload, { key: body.idempotencyKey, fingerprint });
    if (!result.ok) {
      return commandErrorResponse(result.error, 'roster:write');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'roster.set_ops' },
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

    const bodyParsed = await parseJsonBody<{
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
    promoCode?: string;
    confirmBy?: number;
    expiresAt?: number;
    sourceCode?: string;
    marketSegmentCode?: string;
    frontOfficeComment?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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

  const frontOfficeCommentRaw: unknown = (body as { frontOfficeComment?: unknown })
    .frontOfficeComment;
  if (
    frontOfficeCommentRaw !== undefined &&
    frontOfficeCommentRaw !== null &&
    typeof frontOfficeCommentRaw !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const normalizedPromoCode =
    body.promoCode != null && body.promoCode.trim() !== ''
      ? normalizePromoCode(body.promoCode)
      : null;
  const normalizedFrontOfficeComment =
    typeof frontOfficeCommentRaw === 'string' && frontOfficeCommentRaw.trim() !== ''
      ? frontOfficeCommentRaw.trim()
      : undefined;

  const fingerprint = await commandFingerprint('reservations.create', {
    reservationId: body.reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    guestRef: body.guestRef,
    status: body.status,
    adults: body.adults,
    children: body.children,
    ratePlanId: body.ratePlanId ?? 'BAR',
    ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
    ...(body.sourceCode !== undefined ? { sourceCode: body.sourceCode } : {}),
    ...(body.marketSegmentCode !== undefined ? { marketSegmentCode: body.marketSegmentCode } : {}),
    ...(normalizedFrontOfficeComment !== undefined
      ? { frontOfficeComment: normalizedFrontOfficeComment }
      : {}),
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
    ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
    ...(body.confirmBy !== undefined ? { confirmBy: body.confirmBy } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    ...(body.sourceCode !== undefined ? { sourceCode: body.sourceCode } : {}),
    ...(body.marketSegmentCode !== undefined ? { marketSegmentCode: body.marketSegmentCode } : {}),
    ...(normalizedFrontOfficeComment !== undefined
      ? { frontOfficeComment: normalizedFrontOfficeComment }
      : {}),
  };
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateReservation']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.create',
      routeId: 'post_reservations',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
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
    if (err === RATE_MISSING) {
      const fail = result as { ok: false; error: typeof RATE_MISSING; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 422);
    }
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (err === GUEST_NOT_FOUND || err === GUEST_ALREADY_ERASED) {
      return commandFailureResponse(err, 'reservations:write');
    }
    return commandFailureResponse(err, 'reservations:write');
  }

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const link = await org.upsertGuestPropertyAssociation(actor, propertyId, body.guestRef);
    if (!link.ok && link.error !== GUEST_NOT_FOUND) {
      logError(ctx.observability, {
        msg: 'guest_property.link_failed',
        propertyId,
        guestRef: body.guestRef,
        error: link.error,
      });
    }
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      logError(ctx.observability, {
        msg: 'guest_property.link_transport_failed',
        propertyId,
        guestRef: body.guestRef,
      });
    } else {
      throw e;
    }
  }

  return json(result, 201);
}

async function handleGetReservation(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readReservation(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result.reservation, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePatchReservation(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomTypeId: string;
    arrivalDate: string;
    departureDate: string;
    idempotencyKey: string;
    quoteAriVersion?: number;
    adults?: number;
    children?: number;
    ratePlanId?: string;
    noPost?: boolean;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body.roomTypeId || !body.arrivalDate || !body.departureDate || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    roomTypeId: body.roomTypeId,
    arrivalDate: body.arrivalDate,
    departureDate: body.departureDate,
    ...(body.adults !== undefined ? { adults: body.adults } : {}),
    ...(body.children !== undefined ? { children: body.children } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
    ...(body.noPost !== undefined ? { noPost: body.noPost } : {}),
  };
  const fingerprint = await commandFingerprint('reservations.modify', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryModifyReservation']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.modify',
      routeId: 'patch_reservation',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryModifyReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === NO_AVAILABILITY) {
        const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
        logAriRejectOnCommit(ctx.observability, body.quoteAriVersion, fail, body.roomTypeId);
        return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
      }
      if (result.error === RESTRICTION_VIOLATED) {
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
      if (result.error === UNBOOKABLE || result.error === LEDGER_INCONSISTENT) {
        const fail = result as { ok: false; error: typeof UNBOOKABLE | typeof LEDGER_INCONSISTENT; date: string };
        return json({ ok: false, error: fail.error, date: fail.date }, commandErrorHttpStatus(fail.error));
      }
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePostReservationCancel(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('reservations.cancel', { reservationId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { reservationId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCancelReservation']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.cancel',
      routeId: 'post_reservation_cancel',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryCancelReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === LEDGER_INCONSISTENT) {
      const fail = result as { ok: false; error: typeof LEDGER_INCONSISTENT; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 409);
    }
      return null;
    },
  });
}

async function handlePostReservationConfirm(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ idempotencyKey: string; ratePlanId?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };
  const fingerprint = await commandFingerprint('reservations.confirm', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryConfirm']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.confirm',
      routeId: 'post_reservation_confirm',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryConfirm(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
      return null;
    },
  });
}

async function handlePostReservationHold(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    ratePlanId?: string;
    confirmBy?: number;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
    ...(body.confirmBy !== undefined ? { confirmBy: body.confirmBy } : {}),
  };
  const fingerprint = await commandFingerprint('reservations.hold', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryHold']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.hold',
      routeId: 'post_reservation_hold',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryHold(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === NO_AVAILABILITY) {
      const fail = result as { ok: false; error: typeof NO_AVAILABILITY; date: string; ariVersion: number };
      return json({ ok: false, error: fail.error, date: fail.date, ariVersion: fail.ariVersion }, 409);
    }
      return null;
    },
  });
}

async function handlePostReservationFrontOffice(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    frontOfficeComment?: string;
    vipFlag?: boolean;
    dndFlag?: boolean;
    noPost?: boolean;
    sourceCode?: string | null;
    marketSegmentCode?: string | null;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    reservationId,
    ...(body.frontOfficeComment !== undefined ? { frontOfficeComment: body.frontOfficeComment } : {}),
    ...(body.vipFlag !== undefined ? { vipFlag: body.vipFlag } : {}),
    ...(body.dndFlag !== undefined ? { dndFlag: body.dndFlag } : {}),
    ...(body.noPost !== undefined ? { noPost: body.noPost } : {}),
    ...(body.sourceCode !== undefined ? { sourceCode: body.sourceCode } : {}),
    ...(body.marketSegmentCode !== undefined ? { marketSegmentCode: body.marketSegmentCode } : {}),
  };
  const fingerprint = await commandFingerprint('reservations.update_status', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateFrontOffice']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.update_status',
      routeId: 'post_reservation_front_office',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpdateFrontOffice(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handleGetReservationSearch(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const qRaw = ctx.url.searchParams.get('q');
  const q = (qRaw ?? '').trim();
  if (!q || q.length < 1 || q.length > 128) {
    return json({ error: 'invalid_query' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    const found = await resolvedCtx.resolved.stub.searchReservations(q);
    if (found.items.length === 0) {
      return json({ ok: true, items: [] }, 200);
    }

    const row = found.items[0]!;
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const hydrated = await org.readGuests(actor, propertyId, [row.guestRef]);
    if (!hydrated.ok) {
      return degradedFailClosedReadResponse();
    }
    const entry = hydrated.guests[row.guestRef];
    const displayName =
      entry && entry.ok && !entry.erased ? (entry.profile.displayName ?? null) : null;
    return json({ ok: true, items: [{ ...row, displayName }] }, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env) || isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

type DeskSearchRow = Awaited<
  ReturnType<PropertyDO['searchReservationsForDesk']>
>['items'][number];

function deskSearchItems(
  rows: DeskSearchRow[],
  names: ReadonlyMap<string, string | null> | 'forbidden',
): Array<DeskSearchRow & { displayName: string | null }> {
  return rows.slice(0, RESERVATION_SEARCH_ROW_LIMIT).map((row) => ({
    ...row,
    displayName: names === 'forbidden' ? null : (names.get(row.guestRef) ?? null),
  }));
}

async function handlePostReservationSearch(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const raw = await parseRequestJson(ctx.request);
  if (raw instanceof Response) return raw;
  const body = (raw ?? null) as { q?: unknown } | null;
  const q = typeof body?.q === 'string' ? body.q.trim() : '';
  if (q.length < 1 || q.length > 128) {
    return json({ error: 'invalid_query' }, 400, GUEST_HEADERS);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    const found = await resolvedCtx.resolved.stub.searchReservationsForDesk(q);
    let rows = found.items.slice(0, RESERVATION_SEARCH_ROW_LIMIT);
    let profiles: Map<string, string | null> | null = null;

    if (rows.length === 0 && q.length >= 2) {
      await org.ensureMetaOrgId(resolvedCtx.property.orgId);
      const searched = await org.searchGuests(actor, propertyId, {
        q,
        limit: RESERVATION_SEARCH_GUEST_REF_CAP,
      });
      if (!searched.ok) {
        if (searched.error === FORBIDDEN) {
          return json({ ok: true, items: [] }, 200, GUEST_HEADERS);
        }
        return guestDirectoryErrorResponse(searched.error);
      }
      const refs = searched.items.map((item) => item.guestId);
      if (refs.length > RESERVATION_SEARCH_GUEST_REF_CAP) {
        return json({ ok: false, error: LIMIT_EXCEEDED }, 422, GUEST_HEADERS);
      }
      if (refs.length > 0) {
        const stays = await resolvedCtx.resolved.stub.listStaysForGuests(
          refs,
          RESERVATION_SEARCH_ROW_LIMIT,
        );
        if (!stays.ok) {
          return json({ ok: false, error: stays.error }, 422, GUEST_HEADERS);
        }
        rows = stays.items.slice(0, RESERVATION_SEARCH_ROW_LIMIT);
        profiles = new Map(
          searched.items.map((item) => [item.guestId, item.profile.displayName ?? null]),
        );
      }
    }

    if (rows.length === 0) {
      return json({ ok: true, items: [] }, 200, GUEST_HEADERS);
    }

    if (profiles) {
      return json({ ok: true, items: deskSearchItems(rows, profiles) }, 200, GUEST_HEADERS);
    }

    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const hydrated = await org.readGuests(actor, propertyId, [
      ...new Set(rows.map((row) => row.guestRef)),
    ]);
    if (!hydrated.ok) {
      if (hydrated.error === FORBIDDEN) {
        return json({ ok: true, items: deskSearchItems(rows, 'forbidden') }, 200, GUEST_HEADERS);
      }
      return guestDirectoryErrorResponse(hydrated.error);
    }
    const names = new Map<string, string | null>();
    for (const row of rows) {
      const entry = hydrated.guests[row.guestRef];
      names.set(
        row.guestRef,
        entry && entry.ok && !entry.erased ? (entry.profile.displayName ?? null) : null,
      );
    }
    return json({ ok: true, items: deskSearchItems(rows, names) }, 200, GUEST_HEADERS);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env) || isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostReservationStatusAction(
  ctx: V1DispatchContext,
  reservationId: string,
  commandId: string,
  routeId: RouteId,
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId };
  const fingerprint = await commandFingerprint(commandId, commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<{ ok: true } | { ok: false; error?: string; date?: string }>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId,
      routeId,
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => action(resolvedCtx.resolved.stub, actor, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === LEDGER_INCONSISTENT) {
        return json(
          { ok: false, error: result.error, date: (result as { date?: string }).date },
          409,
        );
      }
      return null;
    },
  });
}

async function handlePostReservationCheckIn(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  if (extra instanceof Response) return extra;
  const roomId = typeof extra?.roomId === 'string' ? extra.roomId : undefined;
  const overrideCleanliness = typeof extra?.overrideCleanliness === 'boolean' ? extra.overrideCleanliness : undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, ...(roomId !== undefined ? { roomId } : {}), ...(overrideCleanliness !== undefined ? { overrideCleanliness } : {}) };
  const fingerprint = await commandFingerprint('reservations.check_in', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCheckIn']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.check_in',
      routeId: 'post_reservation_check_in',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCheckIn(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostReservationCheckOut(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  if (extra instanceof Response) return extra;
  const overrideBalance = typeof extra?.overrideBalance === 'boolean' ? extra.overrideBalance : undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, ...(overrideBalance !== undefined ? { overrideBalance } : {}) };
  const fingerprint = await commandFingerprint('reservations.check_out', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCheckOut']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.check_out',
      routeId: 'post_reservation_check_out',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCheckOut(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostReservationEarlyDepart(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  if (extra instanceof Response) return extra;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId };
  const fingerprint = await commandFingerprint('reservations.early_depart', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryEarlyDepart']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.early_depart',
      routeId: 'post_reservation_early_depart',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryEarlyDepart(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: () => null,
  });
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

  const resolutionRaw = ctx.url.searchParams.get('resolution');
  if (resolutionRaw !== null && resolutionRaw !== '') {
    if (resolutionRaw !== 'open' && resolutionRaw !== 'resolved' && resolutionRaw !== 'all') {
      return json({ error: 'invalid_query' }, 400);
    }
  }
  const assignedRaw = ctx.url.searchParams.get('assigned');
  if (assignedRaw !== null && assignedRaw !== '') {
    if (assignedRaw !== 'all' && assignedRaw !== 'unassigned' && assignedRaw !== 'assigned') {
      return json({ error: 'invalid_query' }, 400);
    }
  }
  const fromDate = ctx.url.searchParams.get('businessDateFrom');
  const toDate = ctx.url.searchParams.get('businessDateTo');
  if (fromDate !== null && fromDate !== '' && !ISO_DATE_RE.test(fromDate)) {
    return json({ error: 'invalid_query' }, 400);
  }
  if (toDate !== null && toDate !== '' && !ISO_DATE_RE.test(toDate)) {
    return json({ error: 'invalid_query' }, 400);
  }
  if (
    fromDate !== null &&
    fromDate !== '' &&
    toDate !== null &&
    toDate !== '' &&
    fromDate > toDate
  ) {
    return json({ error: 'invalid_query' }, 400);
  }

  const limitRaw = ctx.url.searchParams.get('limit');
  let limit: number | undefined;
  if (limitRaw !== null && limitRaw !== '') {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > 200) return json({ error: 'invalid_query' }, 400);
    limit = n;
  }

  const cursorRaw = ctx.url.searchParams.get('cursor');
  const decoded = decodeFrontDeskCursor<{ createdAt: number; exceptionId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400);
  if (
    decoded &&
    (typeof decoded.createdAt !== 'number' || typeof decoded.exceptionId !== 'string')
  ) {
    return json({ error: 'invalid_cursor' }, 400);
  }

  const commandType = ctx.url.searchParams.get('commandType');
  const reason = ctx.url.searchParams.get('reason');
  const assignedTo = ctx.url.searchParams.get('assignedTo');

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = (await resolvedCtx.resolved.stub.listProvisionalExceptions({
      ...(resolutionRaw ? { resolution: resolutionRaw as 'open' | 'resolved' | 'all' } : {}),
      ...(commandType ? { commandType } : {}),
      ...(reason ? { reason } : {}),
      ...(fromDate ? { businessDateFrom: fromDate } : {}),
      ...(toDate ? { businessDateTo: toDate } : {}),
      ...(assignedRaw ? { assigned: assignedRaw as 'all' | 'unassigned' | 'assigned' } : {}),
      ...(assignedTo ? { assignedTo } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(decoded ? { cursor: decoded } : {}),
    })) as Awaited<ReturnType<PropertyDO['listProvisionalExceptions']>>;
    return json(
      {
        ok: true,
        exceptions: result.exceptions,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetProvisionalExceptionCount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const exceptionCount = await resolvedCtx.resolved.stub.countProvisionalExceptions();
    return json({ propertyId, exceptionCount }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskShift(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await resolvedCtx.resolved.stub.readCurrentOpenShift(actor);
    return json({ ok: true, shift: result.shift }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskRecentShifts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  try {
    const result = await resolvedCtx.resolved.stub.readRecentShiftsForActor(actor, { limit: 5 });
    return json({ ok: true, shifts: result.shifts }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleCreateOrgMember(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
    const bodyParsed = await parseJsonBody<{ email?: string; role?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleUpdateOrgMember(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.orgId = orgId;
    const bodyParsed = await parseJsonBody<{ role?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleListPropertyMembers(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleCreatePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ email?: string; role?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleUpdatePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ role?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (body.role === 'owner') {
    return json({ error: 'invalid_role' }, 422);
  }
  if (!isPropertyWriteRole(body.role)) {
    return json({ error: 'invalid_body' }, 422);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleDeletePropertyMember(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const targetUserId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedOrgReadResponse();
    throw e;
  }
}

async function handleGetPropertyMe(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isOrgDoTransportFailure(e, ctx.env)) {
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

    const bodyParsed = await parseJsonBody<{ refs?: string[] }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!Array.isArray(body?.refs) || body.refs.length === 0) {
    return json({ error: 'invalid_body', detail: 'refs_required' }, 400);
  }
  const refs = [...new Set(body.refs.filter((r) => typeof r === 'string' && r.length > 0))];
  if (refs.length === 0) return json({ error: 'invalid_body', detail: 'refs_required' }, 400);
  if (refs.length > 50) return json({ error: 'refs_limit_exceeded', max: 50 }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
        if (err === ENTITLEMENT_UNAVAILABLE) return json({ error: ENTITLEMENT_UNAVAILABLE }, 503);
      return commandFailureResponse(err, 'reservations:write');
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
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
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

    const bodyParsed = await parseJsonBody<{
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !body.roomTypeId ||
    !body.stayDate ||
    typeof body.amountMinor !== 'number' ||
    !body.currency ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const cell = normalizeRateDayCell(body);
  const fingerprint = await commandFingerprint('rates.upsert_day', cell);
  const commandPayload = { ...cell, auditCommandId: 'rates.upsert_day' as const };
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRateDay']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.upsert_day',
      routeId: 'put_rate_days',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRateDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePutRestrictionDays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomTypeId: string;
    ratePlanId?: string;
    stayDate: string;
    minLos?: number | null;
    maxLos?: number | null;
    cta?: boolean;
    ctd?: boolean;
    stopSell?: boolean;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body.roomTypeId || !body.stayDate || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const ratePlanId = body.ratePlanId ?? TYPE_WIDE_RATE_PLAN;
  const fingerprint = await commandFingerprint('restrictions.upsert_day', {
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
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'restrictions.upsert_day',
      routeId: 'put_restriction_days',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRestrictionDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
  });
}

async function handlePostFolioLines(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    chargeCode: string;
    amountMinor: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.chargeCode || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const folioLineId = `${reservationId}:item:${body.idempotencyKey}`;
  const commandPayload = {
    reservationId,
    folioLineId,
    chargeCode: body.chargeCode,
    amountMinor: body.amountMinor,
  };
  const fingerprint = await commandFingerprint('folio.add_item', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAddFolioLine']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.add_item',
      routeId: 'post_folio_lines',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryAddFolioLine(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 201,
    onFailure: (result) => {    if (result.error === CHARGE_CODE_NOT_FOUND) {
      return json({ error: CHARGE_CODE_NOT_FOUND }, 404);
    }
    if (result.error === NOT_FOUND || result.error === 'not_member') {
      return json({ error: 'not_found' }, 404);
    }
    return null;
    },
  });
}

async function handleGetFolio(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readFolio(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRooms(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomId: string;
    roomTypeId: string;
    code: string;
    floor?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.roomId || !body.roomTypeId || !body.code || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload: { roomId: string; roomTypeId: string; code: string; floor?: string } = {
    roomId: body.roomId,
    roomTypeId: body.roomTypeId,
    code: body.code,
  };
  if (body.floor !== undefined) commandPayload.floor = body.floor;
  const fingerprint = await commandFingerprint('rooms.create', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateRoom']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.create',
      routeId: 'post_rooms',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateRoom(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 201,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePatchRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    code?: string;
    floor?: string;
    roomTypeId?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.roomTypeId !== undefined) {
    return json({ error: 'invalid_body', detail: 'room_type_id_immutable' }, 422);
  }
  if (body.code === undefined && body.floor === undefined) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload: { roomId: string; code?: string; floor?: string } = { roomId };
  if (body.code !== undefined) commandPayload.code = body.code;
  if (body.floor !== undefined) commandPayload.floor = body.floor;
  const fingerprint = await commandFingerprint('rooms.update', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoom']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.update',
      routeId: 'patch_room',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRoom(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handleGetRooms(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const url = new URL(ctx.request.url);
  const roomTypeId = url.searchParams.get('roomTypeId') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;

  try {
    const result = await resolvedCtx.resolved.stub.listRooms({ roomTypeId, status });
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRoomStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ status: string; idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.status || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { roomId, status: body.status };
  const fingerprint = await commandFingerprint('rooms.update_status', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRoomStatus']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.update_status',
      routeId: 'post_room_status',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRoomStatus(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostRoomOooRange(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomId?: string;
    startDate: string;
    endDate: string;
    oooId?: string;
    reason?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.startDate || !body.endDate || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.roomId !== undefined && body.roomId !== roomId) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload: {
    roomId: string;
    startDate: string;
    endDate: string;
    oooId?: string;
    reason?: string;
  } = { roomId, startDate: body.startDate, endDate: body.endDate };
  if (body.oooId !== undefined) commandPayload.oooId = body.oooId;
  if (body.reason !== undefined) commandPayload.reason = body.reason;
  const fingerprint = await commandFingerprint('rooms.set_ooo_range', {
    roomId,
    startDate: body.startDate,
    endDate: body.endDate,
    ...(body.oooId ? { oooId: body.oooId } : {}),
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySetOooRange']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.set_ooo_range',
      routeId: 'post_room_ooo_range',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.trySetOooRange(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'inventory:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === OOO_ROOM_ASSIGNED && 'reservationId' in result && result.reservationId) {
        return json(
          { ok: false, error: result.error, reservationId: result.reservationId },
          commandErrorHttpStatus(coerceCommandError(result.error)),
        );
      }
      return null;
    },
  });
}

async function handlePostRoomsBulkStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    updates: Array<{ roomId: string; status: string }>;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.updates?.length || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.updates.length > ROOMS_BULK_STATUS_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const updates = [...body.updates].sort((a, b) => a.roomId.localeCompare(b.roomId));
  const commandPayload = { updates };
  const fingerprint = await commandFingerprint('rooms.bulk_update_status', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryBulkUpdateRoomStatus']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rooms.bulk_update_status',
      routeId: 'post_rooms_bulk_status',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryBulkUpdateRoomStatus(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostReservationAssignRoom(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ roomId: string; idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.roomId || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId, roomId: body.roomId };
  const fingerprint = await commandFingerprint('reservations.assign_room', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAssignRoom']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.assign_room',
      routeId: 'post_reservation_assign_room',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryAssignRoom(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostHousekeepingAssign(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    roomId: string;
    businessDate: string;
    assigneeRef: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.roomId || !body.businessDate || !body.assigneeRef || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    roomId: body.roomId,
    businessDate: body.businessDate,
    assigneeRef: body.assigneeRef,
  };
  const fingerprint = await commandFingerprint('housekeeping.assign', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAssignHousekeeping']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'housekeeping.assign',
      routeId: 'post_housekeeping_assign',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryAssignHousekeeping(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === 'org_unreachable') {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'housekeeping.assign' },
        503,
        { 'Retry-After': '30' },
      );
    }
    if (result.error === STAFF_NOT_FOUND || result.error === STAFF_EXITED || result.error === STAFF_NOT_ASSIGNABLE) {
      return json({ ok: false, error: result.error }, 422);
    }
    if (result.error === 'invalid_assignee_ref' || result.error === 'invalid_business_date') {
      return json({ ok: false, error: result.error }, 400);
    }
    return null;
    },
  });
}

async function handleGetHousekeepingAssignments(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const businessDate = new URL(ctx.request.url).searchParams.get('businessDate');
  if (!businessDate) {
    return json({ error: 'invalid_body', detail: 'businessDate_required' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readHousekeepingAssignments(businessDate);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePutHousekeepingPriority(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<{
    roomId: string;
    businessDate: string;
    level: unknown;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.roomId !== 'string' ||
    !body.roomId ||
    typeof body.businessDate !== 'string' ||
    !body.businessDate ||
    typeof body.idempotencyKey !== 'string' ||
    !body.idempotencyKey ||
    !isHousekeepingPriorityLevelInput(body.level)
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    roomId: body.roomId,
    businessDate: body.businessDate,
    level: body.level,
  };
  const fingerprint = await commandFingerprint('housekeeping.set_priority', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySetHousekeepingPriority']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'housekeeping.set_priority',
      routeId: 'put_housekeeping_priority',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.trySetHousekeepingPriority(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === 'invalid_business_date') {
        return json({ ok: false, error: result.error }, 400);
      }
      return null;
    },
  });
}

async function handleGetHousekeepingPriorities(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const date = new URL(ctx.request.url).searchParams.get('date');
  if (!date) {
    return json({ error: 'invalid_body', detail: 'date_required' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readHousekeepingPriorities(date);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostHousekeepingInventoryItem(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.itemId !== 'string' ||
    !body.itemId ||
    typeof body?.name !== 'string' ||
    typeof body?.unit !== 'string' ||
    !isHousekeepingInventoryCategory(body.category) ||
    !Number.isInteger(body.parLevel) ||
    !Number.isInteger(body.onHand) ||
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    itemId: body.itemId,
    name: body.name,
    category: body.category,
    unit: body.unit,
    parLevel: body.parLevel,
    onHand: body.onHand,
  };
  const fingerprint = await commandFingerprint('housekeeping.inventory_create_item', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryCreateHousekeepingInventoryItem']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'housekeeping.inventory_create_item',
      routeId: 'post_housekeeping_inventory_item',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateHousekeepingInventoryItem(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 201,
    onFailure: (result) => {
      if (result.error === VALIDATION_ERROR) return json({ error: 'invalid_body' }, 400);
      return null;
    },
  });
}

async function handlePatchHousekeepingInventoryItem(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const itemId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.name !== 'string' ||
    typeof body?.unit !== 'string' ||
    !isHousekeepingInventoryCategory(body.category) ||
    !Number.isInteger(body.parLevel) ||
    typeof body?.archived !== 'boolean' ||
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.itemId !== undefined && body.itemId !== itemId) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    itemId,
    name: body.name,
    category: body.category,
    unit: body.unit,
    parLevel: body.parLevel,
    archived: body.archived,
  };
  const fingerprint = await commandFingerprint('housekeeping.inventory_update_item', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryUpdateHousekeepingInventoryItem']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'housekeeping.inventory_update_item',
      routeId: 'patch_housekeeping_inventory_item',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateHousekeepingInventoryItem(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === VALIDATION_ERROR) return json({ error: 'invalid_body' }, 400);
      return null;
    },
  });
}

async function handlePostHousekeepingInventoryAdjust(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const itemId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !isHousekeepingInventoryMovementKind(body.kind) ||
    !Number.isInteger(body.quantity) ||
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.itemId !== undefined && body.itemId !== itemId) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    itemId,
    kind: body.kind,
    quantity: body.quantity,
    ...(body.note !== undefined ? { note: body.note } : {}),
  };
  const fingerprint = await commandFingerprint('housekeeping.inventory_adjust', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryAdjustHousekeepingInventoryItem']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'housekeeping.inventory_adjust',
      routeId: 'post_housekeeping_inventory_adjust',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryAdjustHousekeepingInventoryItem(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'housekeeping:write',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === VALIDATION_ERROR) return json({ error: 'invalid_body' }, 400);
      return null;
    },
  });
}

async function handleGetHousekeepingInventory(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const archivedParam = new URL(ctx.request.url).searchParams.get('archived');
  const includeArchived = archivedParam === '1';

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readHousekeepingInventoryList(includeArchived);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetHousekeepingInventoryMovements(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const itemId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readHousekeepingInventoryMovementsForItem(itemId);
    if (!result.ok) {
      return json({ ok: false, error: result.error }, 404);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostMaintenanceTicket(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.ticketId !== 'string' ||
    !body.ticketId ||
    typeof body?.roomId !== 'string' ||
    !body.roomId ||
    typeof body?.description !== 'string' ||
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.category !== undefined && !isMaintenanceCategory(body.category)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.priority !== undefined && !isMaintenancePriority(body.priority)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.taskTypeId !== undefined && body.taskTypeId !== null && typeof body.taskTypeId !== 'string') {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ticketId: body.ticketId,
    roomId: body.roomId,
    description: body.description,
    ...(body.category !== undefined ? { category: body.category } : {}),
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.taskTypeId !== undefined ? { taskTypeId: body.taskTypeId } : {}),
  };
  const fingerprint = await commandFingerprint('maintenance.create_ticket', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryCreateMaintenanceTicket']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'maintenance.create_ticket',
      routeId: 'post_maintenance_ticket',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateMaintenanceTicket(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'maintenance:write',
    successStatus: 201,
  });
}

async function handlePatchMaintenanceTicket(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ticketId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (typeof body?.idempotencyKey !== 'string' || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.ticketId !== undefined && body.ticketId !== ticketId) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.priority !== undefined && !isMaintenancePriority(body.priority)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.checklistDone !== undefined && !Array.isArray(body.checklistDone)) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (
    body.assigneeRef !== undefined &&
    body.assigneeRef !== null &&
    typeof body.assigneeRef !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ticketId,
    ...(body.priority !== undefined ? { priority: body.priority } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.assigneeRef !== undefined
      ? { assigneeRef: body.assigneeRef as string | null }
      : {}),
    ...(body.checklistDone !== undefined ? { checklistDone: body.checklistDone } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.resolutionNote !== undefined ? { resolutionNote: body.resolutionNote } : {}),
  };
  const fingerprint = await commandFingerprint('maintenance.update_ticket', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryUpdateMaintenanceTicket']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'maintenance.update_ticket',
      routeId: 'patch_maintenance_ticket',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateMaintenanceTicket(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'maintenance:write',
    successStatus: 200,
  });
}

async function handleGetMaintenanceTickets(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const statusParam = url.searchParams.get('status');
  const roomId = url.searchParams.get('roomId') ?? undefined;
  let status: 'active' | 'open' | 'in_progress' | 'closed' | 'all' = 'active';
  if (statusParam !== null) {
    if (
      statusParam !== 'active' &&
      statusParam !== 'open' &&
      statusParam !== 'in_progress' &&
      statusParam !== 'closed' &&
      statusParam !== 'all'
    ) {
      return json({ error: 'invalid_body' }, 400);
    }
    status = statusParam;
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readMaintenanceTicketsList(status, roomId);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostMaintenanceTaskType(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.taskTypeId !== 'string' ||
    !body.taskTypeId ||
    typeof body?.name !== 'string' ||
    !isMaintenanceCategory(body.category) ||
    !isMaintenancePriority(body.defaultPriority) ||
    !Array.isArray(body.checklist) ||
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    taskTypeId: body.taskTypeId,
    name: body.name,
    category: body.category,
    defaultPriority: body.defaultPriority,
    checklist: body.checklist,
  };
  const fingerprint = await commandFingerprint('maintenance.create_task_type', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryCreateMaintenanceTaskType']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'maintenance.create_task_type',
      routeId: 'post_maintenance_task_type',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateMaintenanceTaskType(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
      if (result.error === VALIDATION_ERROR) return json({ error: 'invalid_body' }, 400);
      return null;
    },
  });
}

async function handlePatchMaintenanceTaskType(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const taskTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.idempotencyKey !== 'string' ||
    !body.idempotencyKey ||
    typeof body?.name !== 'string' ||
    !isMaintenanceCategory(body.category) ||
    !isMaintenancePriority(body.defaultPriority) ||
    !Array.isArray(body.checklist) ||
    typeof body?.active !== 'boolean'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.taskTypeId !== undefined && body.taskTypeId !== taskTypeId) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    taskTypeId,
    name: body.name,
    category: body.category,
    defaultPriority: body.defaultPriority,
    checklist: body.checklist,
    active: body.active,
  };
  const fingerprint = await commandFingerprint('maintenance.update_task_type', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryUpdateMaintenanceTaskType']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'maintenance.update_task_type',
      routeId: 'patch_maintenance_task_type',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateMaintenanceTaskType(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === VALIDATION_ERROR) return json({ error: 'invalid_body' }, 400);
      return null;
    },
  });
}

async function handleGetMaintenanceTaskTypes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readMaintenanceTaskTypesList();
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostRatePlans(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    ratePlanId: string;
    code: string;
    name: string;
    idempotencyKey: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    cancelPolicyText?: string | null;
    parentRatePlanId?: string | null;
    deriveBps?: number | null;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.ratePlanId || !body.code || !body.name || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    ...(body.parentRatePlanId !== undefined ? { parentRatePlanId: body.parentRatePlanId } : {}),
    ...(body.deriveBps !== undefined ? { deriveBps: body.deriveBps } : {}),
  };
  const fingerprint = await commandFingerprint('rates.create_plan', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateRatePlan']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.create_plan',
      routeId: 'post_rate_plans',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateRatePlan(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 201,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePatchRatePlan(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ratePlanId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    code?: string;
    name?: string;
    idempotencyKey: string;
    cancelPenaltyType?: string;
    cancelGraceHours?: number;
    cancelPenaltyNights?: number | null;
    cancelPenaltyBps?: number | null;
    cancelPolicyText?: string | null;
    parentRatePlanId?: string | null;
    deriveBps?: number | null;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !body?.idempotencyKey ||
    (body.code === undefined &&
      body.name === undefined &&
      body.cancelPenaltyType === undefined &&
      body.cancelGraceHours === undefined &&
      body.cancelPenaltyNights === undefined &&
      body.cancelPenaltyBps === undefined &&
      body.cancelPolicyText === undefined &&
      body.parentRatePlanId === undefined &&
      body.deriveBps === undefined)
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    ...(body.parentRatePlanId !== undefined ? { parentRatePlanId: body.parentRatePlanId } : {}),
    ...(body.deriveBps !== undefined ? { deriveBps: body.deriveBps } : {}),
  };
  const fingerprint = await commandFingerprint('rates.update_plan', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateRatePlan']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.update_plan',
      routeId: 'patch_rate_plan',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateRatePlan(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === RATE_PLAN_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { ratePlanId };
  const fingerprint = await commandFingerprint('rates.delete_plan', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryDeleteRatePlan']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.delete_plan',
      routeId: 'delete_rate_plan',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryDeleteRatePlan(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === RATE_PLAN_NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === ARCHIVE_BLOCKED) {
      return json({ ok: false, error: result.error }, 409);
    }
    return null;
    },
  });
}

async function handlePostChargeCodes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    code: string;
    name: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.code || !body.name || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { code: body.code, name: body.name };
  const fingerprint = await commandFingerprint('folio.create_charge_code', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateChargeCode']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.create_charge_code',
      routeId: 'post_charge_codes',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateChargeCode(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePatchChargeCode(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const code = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    name?: string;
    taxGroup?: string | null;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || (body.name === undefined && body.taxGroup === undefined)) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    code,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.taxGroup !== undefined ? { taxGroup: body.taxGroup } : {}),
  };
  const fingerprint = await commandFingerprint('folio.update_charge_code', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateChargeCode']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.update_charge_code',
      routeId: 'patch_charge_code',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateChargeCode(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === CHARGE_CODE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePutChargeCodeStatus(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const code = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    status: 'active' | 'archived';
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.status || !body.idempotencyKey || (body.status !== 'active' && body.status !== 'archived')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { code, status: body.status };
  const fingerprint = await commandFingerprint('folio.set_charge_code_status', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySetChargeCodeStatus']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.set_charge_code_status',
      routeId: 'put_charge_code_status',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.trySetChargeCodeStatus(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === CHARGE_CODE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handleGetChargeCodes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'archived' || statusParam === 'all' ? statusParam : ('active' as const);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const codes = await resolvedCtx.resolved.stub.listChargeCodes(status);
    return json({ ok: true, codes }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

/** Products catalog (R1.5) — body fields copied only when present, so the hashed object is the sent object. */
function pickDefined<K extends string>(
  body: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

async function handleGetProducts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const statusParam = new URL(ctx.request.url).searchParams.get('status');
  const status = statusParam === 'all' ? ('all' as const) : ('active' as const);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listProducts(status);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostProductCategories(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.categoryId !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.idempotencyKey !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  const idempotencyKey = body.idempotencyKey;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    categoryId: body.categoryId,
    name: body.name,
    ...pickDefined(body, ['sortOrder'] as const),
  } as { categoryId: string; name: string; sortOrder?: number };
  const fingerprint = await commandFingerprint('products.create_category', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryCreateProductCategory']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'products.create_category',
      routeId: 'post_product_categories',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateProductCategory(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePatchProductCategory(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const categoryId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (typeof body?.idempotencyKey !== 'string') return json({ error: 'invalid_body' }, 400);
  const idempotencyKey = body.idempotencyKey;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    categoryId,
    ...pickDefined(body, ['name', 'sortOrder', 'status'] as const),
  } as { categoryId: string; name?: string; sortOrder?: number; status?: 'active' | 'archived' };
  const fingerprint = await commandFingerprint('products.update_category', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryUpdateProductCategory']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'products.update_category',
      routeId: 'patch_product_category',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateProductCategory(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePostProducts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    typeof body?.productId !== 'string' ||
    typeof body.categoryId !== 'string' ||
    typeof body.name !== 'string' ||
    typeof body.chargeCode !== 'string' ||
    body.defaultAmountMinor === undefined ||
    typeof body.idempotencyKey !== 'string'
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  const idempotencyKey = body.idempotencyKey;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    productId: body.productId,
    categoryId: body.categoryId,
    name: body.name,
    chargeCode: body.chargeCode,
    defaultAmountMinor: body.defaultAmountMinor,
    ...pickDefined(body, ['sku'] as const),
  } as {
    productId: string;
    categoryId: string;
    name: string;
    chargeCode: string;
    defaultAmountMinor: number;
    sku?: string | null;
  };
  const fingerprint = await commandFingerprint('products.create_item', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateProduct']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'products.create_item',
      routeId: 'post_products',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateProduct(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePatchProduct(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const productId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const bodyParsed = await parseJsonBody<Record<string, unknown>>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (typeof body?.idempotencyKey !== 'string') return json({ error: 'invalid_body' }, 400);
  const idempotencyKey = body.idempotencyKey;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    productId,
    ...pickDefined(body, [
      'categoryId',
      'name',
      'sku',
      'chargeCode',
      'defaultAmountMinor',
      'status',
    ] as const),
  } as {
    productId: string;
    categoryId?: string;
    name?: string;
    sku?: string | null;
    chargeCode?: string;
    defaultAmountMinor?: number;
    status?: 'active' | 'archived';
  };
  const fingerprint = await commandFingerprint('products.update_item', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateProduct']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'products.update_item',
      routeId: 'patch_product',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateProduct(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
      if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handleGetFolioRoutingRules(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'archived' || statusParam === 'all' ? statusParam : ('active' as const);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const rules = await resolvedCtx.resolved.stub.listFolioRoutingRules(status);
    return json({ ok: true, rules }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePutFolioRoutingRule(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ruleId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    chargeCode: string;
    destWindowKind: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !body?.chargeCode ||
    !body.idempotencyKey ||
    (body.destWindowKind !== 'COMPANY' && body.destWindowKind !== 'MASTER')
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    ruleId,
    chargeCode: body.chargeCode,
    destWindowKind: body.destWindowKind as 'COMPANY' | 'MASTER',
  };
  const fingerprint = await commandFingerprint('folio.upsert_routing_rule', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRoutingRule']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.upsert_routing_rule',
      routeId: 'put_folio_routing_rule',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpsertRoutingRule(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === CHARGE_CODE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePostFolioRoutingRuleArchive(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ruleId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { ruleId };
  const fingerprint = await commandFingerprint('folio.archive_routing_rule', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryArchiveRoutingRule']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.archive_routing_rule',
      routeId: 'post_folio_routing_rule_archive',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryArchiveRoutingRule(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePostTaxRules(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
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
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
  const fingerprint = await commandFingerprint('folio.create_tax_rule', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateTaxRule']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.create_tax_rule',
      routeId: 'post_tax_rules',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateTaxRule(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePutTaxRuleSupersede(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const ruleKey = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    taxRuleId: string;
    name: string;
    ruleType: string;
    rate: string;
    taxGroup: string;
    outputChargeCode: string;
    validFrom: string;
    validTo?: string | null;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
  const fingerprint = await commandFingerprint('folio.supersede_tax_rule', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySupersedeTaxRule']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.supersede_tax_rule',
      routeId: 'put_tax_rule_supersede',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.trySupersedeTaxRule(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === TAX_RULE_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handleGetTaxRules(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const url = new URL(ctx.request.url);
  const taxGroup = url.searchParams.get('taxGroup') ?? undefined;
  const effectiveDate = url.searchParams.get('effectiveDate') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const rules = await resolvedCtx.resolved.stub.listTaxRules({ taxGroup, effectiveDate });
    return json({ ok: true, rules }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handlePostShifts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    shiftId: string;
    openingFloat: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.shiftId || body.openingFloat == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { shiftId: body.shiftId, openingFloat: body.openingFloat };
  const fingerprint = await commandFingerprint('folio.open_shift', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryOpenShift']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.open_shift',
      routeId: 'post_shifts',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryOpenShift(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 201,
    onFailure: (result) => {    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePutShiftClose(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const shiftId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    closingCount: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (body?.closingCount == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { shiftId, closingCount: body.closingCount };
  const fingerprint = await commandFingerprint('folio.close_shift', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCloseShift']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.close_shift',
      routeId: 'put_shift_close',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCloseShift(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    if (result.error === 'not_member' || result.error === SHIFT_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePostCashPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    paymentId: string;
    amountMinor: number;
    currency?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.paymentId || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const requestFingerprint = await commandFingerprint('folio.record_cash_payment', {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    ...(body.currency ? { currency: body.currency } : {}),
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    ...(body.currency ? { currency: body.currency } : {}),
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRecordCashPayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.record_cash_payment',
      routeId: 'post_cash_payment',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryRecordCashPayment(actor, commandPayload),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 201,
  });
}

async function handleGetShift(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const shiftId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readShift(shiftId);
    if (!result.ok) return json({ ok: false, error: result.error }, 404);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetRatePlans(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const plans = await resolvedCtx.resolved.stub.listRatePlans();
    return json({ ok: true, plans }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetRatePromos(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const promos = await resolvedCtx.resolved.stub.listRatePromos();
    return json({ ok: true, promos }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostRatePromos(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    promoId: string;
    code: string;
    name: string;
    kind: 'percent' | 'fixed_per_night';
    bps?: number;
    amountMinor?: number;
    validFrom?: string | null;
    validTo?: string | null;
    ratePlanId?: string | null;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.promoId || !body.code || !body.name || !body.kind || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const normalized = normalizePromoCode(body.code);
  if (!promoCodeCharsetOk(normalized)) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    promoId: body.promoId,
    code: body.code,
    name: body.name,
    kind: body.kind,
    ...(body.bps !== undefined ? { bps: body.bps } : {}),
    ...(body.amountMinor !== undefined ? { amountMinor: body.amountMinor } : {}),
    ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
    ...(body.validTo !== undefined ? { validTo: body.validTo } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };
  const fingerprint = await commandFingerprint('rates.create_promo', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreatePromo']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.create_promo',
      routeId: 'post_rate_promos',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreatePromo(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 201,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    if (result.error === 'invalid_promo_code') return json({ error: 'invalid_body' }, 400);
    if (result.error === PROMO_CODE_EXISTS) return json({ ok: false, error: result.error }, 409);
    return null;
    },
  });
}

async function handlePatchRatePromo(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const promoId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    name?: string;
    bps?: number;
    amountMinor?: number;
    validFrom?: string | null;
    validTo?: string | null;
    ratePlanId?: string | null;
    code?: string;
    kind?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.code !== undefined || body.kind !== undefined) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (
    body.name === undefined &&
    body.bps === undefined &&
    body.amountMinor === undefined &&
    body.validFrom === undefined &&
    body.validTo === undefined &&
    body.ratePlanId === undefined
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    promoId,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.bps !== undefined ? { bps: body.bps } : {}),
    ...(body.amountMinor !== undefined ? { amountMinor: body.amountMinor } : {}),
    ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
    ...(body.validTo !== undefined ? { validTo: body.validTo } : {}),
    ...(body.ratePlanId !== undefined ? { ratePlanId: body.ratePlanId } : {}),
  };
  const fingerprint = await commandFingerprint('rates.update_promo', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdatePromo']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.update_promo',
      routeId: 'patch_rate_promo',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdatePromo(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === PROMO_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handleDeleteRatePromo(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const promoId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey =
    ctx.request.headers.get('x-idempotency-key') ?? ctx.url.searchParams.get('idempotencyKey');
  if (!idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { promoId };
  const fingerprint = await commandFingerprint('rates.archive_promo', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryArchivePromo']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.archive_promo',
      routeId: 'delete_rate_promo',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryArchivePromo(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member' || result.error === PROMO_NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePostInvoices(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    reservationId: string;
    folioWindowId?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || !body.reservationId) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const resolvedWindow = body.folioWindowId ?? `${body.reservationId}:GUEST`;
  const commandPayload = {
    reservationId: body.reservationId,
    ...(body.folioWindowId ? { folioWindowId: body.folioWindowId } : {}),
  };
  const fingerprint = await commandFingerprint('invoice.generate', {
    reservationId: body.reservationId,
    folioWindowId: resolvedWindow,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryGenerateInvoice']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'invoice.generate',
      routeId: 'post_invoices',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryGenerateInvoice(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 201,
    onFailure: (result) => {    if (result.error === 'not_member' || result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handleGetInvoice(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const invoiceId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const index = await resolvedCtx.resolved.stub.readInvoiceIndex(invoiceId);
    if (!index) return json({ error: 'not_found' }, 404);
    const obj = await ctx.env.EVENT_LOG_R2?.get(index.r2Key);
    if (!obj) return json({ error: 'not_found' }, 404);
    const snapshot = JSON.parse(await obj.text()) as Record<string, unknown>;
    return json({ ...index, snapshot }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostInvoiceVoid(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const invoiceId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey: string; reason?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    invoiceId,
    ...(body.reason ? { reason: body.reason } : {}),
  };
  const fingerprint = await commandFingerprint('invoice.void', { invoiceId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryVoidInvoice']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'invoice.void',
      routeId: 'post_invoice_void',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryVoidInvoice(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

function mapCityLedgerCommandFailure(
  error: CommandError,
  permission: 'folio:adjust' | 'folio:read',
): Response {
  if (error === INVOICE_NOT_FOUND) return json({ error: 'not_found' }, 404);
  return commandFailureResponse(error, permission);
}

async function handlePostCityLedgerAccounts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    name: string;
    creditLimitMinor?: number;
    termsDays?: number;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || !body.name) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    name: body.name,
    ...(body.creditLimitMinor !== undefined ? { creditLimitMinor: body.creditLimitMinor } : {}),
    ...(body.termsDays !== undefined ? { termsDays: body.termsDays } : {}),
  };
  const fingerprint = await commandFingerprint('city_ledger.create_account', { name: body.name.trim() });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateCityLedgerAccount']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'city_ledger.create_account',
      routeId: 'post_city_ledger_accounts',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCreateCityLedgerAccount(actor, commandPayload, idem),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapCityLedgerCommandFailure(result.error, 'folio:adjust');
  return json(result, 201);
}

async function handleGetCityLedgerAccounts(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const url = new URL(ctx.request.url);
  const accountId = url.searchParams.get('accountId');
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam === 'all' || statusParam === 'active' ? statusParam : ('active' as const);

  try {
    if (accountId) {
      const detail = await resolvedCtx.resolved.stub.readCityLedgerAccount(accountId);
      if (!detail.ok) {
        if (detail.error === CITY_LEDGER_ACCOUNT_NOT_FOUND) {
          return json({ ok: false, error: detail.error }, 404);
        }
        return json({ ok: false, error: detail.error }, 422);
      }
      return json({ ...detail, statements: [] }, 200);
    }

    const list = await resolvedCtx.resolved.stub.readCityLedgerAccounts({ status });
    if (!list.ok) return json({ ok: false, error: list.error }, 422);
    return json({ accounts: list.accounts }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePatchCityLedgerAccount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const accountId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    name?: string;
    creditLimitMinor?: number;
    termsDays?: number;
    status?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  if (body.status === 'archived') {
    const commandPayload = { accountId };
    const fingerprint = await commandFingerprint('city_ledger.archive_account', { accountId });
    const idem = { key: body.idempotencyKey, fingerprint };
    const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryArchiveCityLedgerAccount']>>>({
      ...commandEnvelope(ctx, resolvedCtx, {
        commandId: 'city_ledger.archive_account',
        routeId: 'patch_city_ledger_account',
        idempotencyKey: body.idempotencyKey,
        requestFingerprint: fingerprint,
        commandPayload,
      }),
      invoke: () => resolvedCtx.resolved.stub.tryArchiveCityLedgerAccount(actor, commandPayload, idem),
    });
    if (invoked.kind === 'response') return invoked.response;
    const result = invoked.result;
    if (!result.ok) return mapCityLedgerCommandFailure(result.error, 'folio:adjust');
    return json(result, 200);
  }

  if (
    body.name === undefined &&
    body.creditLimitMinor === undefined &&
    body.termsDays === undefined
  ) {
    return json({ error: 'invalid_body' }, 400);
  }

  const commandPayload = {
    accountId,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.creditLimitMinor !== undefined ? { creditLimitMinor: body.creditLimitMinor } : {}),
    ...(body.termsDays !== undefined ? { termsDays: body.termsDays } : {}),
  };
  const fingerprint = await commandFingerprint('city_ledger.archive_account', 
    Object.fromEntries(
      Object.entries(commandPayload).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpdateCityLedgerAccount']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'city_ledger.update_account',
      routeId: 'patch_city_ledger_account',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryUpdateCityLedgerAccount(actor, commandPayload, idem),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapCityLedgerCommandFailure(result.error, 'folio:adjust');
  return json(result, 200);
}

async function handlePostCityLedgerAccountPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const accountId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    idempotencyKey: string;
    amountMinor: number;
    businessDate?: string;
    reference?: string | null;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || body.amountMinor === undefined) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = {
    accountId,
    amountMinor: body.amountMinor,
    ...(body.businessDate !== undefined ? { businessDate: body.businessDate } : {}),
    ...(body.reference !== undefined ? { reference: body.reference } : {}),
  };
  const fingerprint = await commandFingerprint('city_ledger.receive_payment', {
    accountId,
    amountMinor: body.amountMinor,
    businessDate: body.businessDate ?? null,
    reference: body.reference ?? null,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryReceiveCityLedgerPayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'city_ledger.receive_payment',
      routeId: 'post_city_ledger_account_payment',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryReceiveCityLedgerPayment(actor, commandPayload, idem),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapCityLedgerCommandFailure(result.error, 'folio:adjust');
  return json(result, 201);
}

async function handleGetCityLedgerStatement(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const accountId = decodeURIComponent(ctx.match[2]!);
  const statementId = decodeURIComponent(ctx.match[3]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readCityLedgerStatement({ accountId, statementId });
    if (result.ok) {
      const ok = result as unknown as {
        ok: true;
        snapshot: Record<string, unknown>;
        r2Key: string;
        statementId: string;
        accountId: string;
      };
      const { snapshot, r2Key, statementId: stmtId, accountId: acctId } = ok;
      const asOfDate = typeof snapshot.asOfDate === 'string' ? snapshot.asOfDate : null;
      const generatedAt = typeof snapshot.generatedAt === 'number' ? snapshot.generatedAt : null;
      let sha256: string | null = null;
      const obj = await ctx.env.EVENT_LOG_R2?.get(r2Key);
      if (obj) {
        const encoded = new TextEncoder().encode(await obj.text());
        const digest = await crypto.subtle.digest('SHA-256', encoded);
        sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }

      return json(
        {
          statementId: stmtId,
          accountId: acctId,
          asOfDate,
          r2Key,
          sha256,
          generatedAt,
          snapshot,
        },
        200,
      );
    }
    if (result.error === CITY_LEDGER_STATEMENT_NOT_FOUND) {
      return json({ ok: false, error: result.error }, 404);
    }
    if (result.error === CITY_LEDGER_R2_UNBOUND) {
      return json({ ok: false, error: result.error }, 503);
    }
    return json({ ok: false, error: result.error }, 422);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

function inclusiveDateRangeError(fromDate: string | null, toDate: string | null): Response | null {
  if (!fromDate || !toDate || !ISO_DATE_RE.test(fromDate) || !ISO_DATE_RE.test(toDate)) {
    return json({ error: 'invalid_date' }, 400);
  }
  if (fromDate > toDate) {
    return json({ error: 'invalid_date_range' }, 400);
  }
  if (toDate > addDays(fromDate, 89)) {
    return json({ error: 'date_range_exceeds_max' }, 400);
  }
  return null;
}

async function handleGetRoomTypes(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const statusParam = ctx.url.searchParams.get('status');
  const status =
    statusParam == null || statusParam === ''
      ? 'active'
      : statusParam === 'active' || statusParam === 'archived' || statusParam === 'all'
        ? statusParam
        : null;
  if (status == null) {
    return json({ error: 'invalid_query' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const roomTypes = await resolvedCtx.resolved.stub.listRoomTypes(status);
    return json({ ok: true, roomTypes }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetRateDays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const fromDate = ctx.url.searchParams.get('fromDate');
  const toDate = ctx.url.searchParams.get('toDate');
  const rangeErr = inclusiveDateRangeError(fromDate, toDate);
  if (rangeErr) return rangeErr;

  const roomTypeId = ctx.url.searchParams.get('roomTypeId') ?? undefined;
  const ratePlanId = ctx.url.searchParams.get('ratePlanId') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const days = await resolvedCtx.resolved.stub.listRateDays({
      fromDate: fromDate!,
      toDate: toDate!,
      roomTypeId,
      ratePlanId,
    });
    return json({ ok: true, days }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetRestrictionDays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const ratePlanId = ctx.url.searchParams.get('ratePlanId');
  if (ratePlanId != null && ratePlanId !== '' && ratePlanId !== TYPE_WIDE_RATE_PLAN) {
    return json({ error: 'invalid_query', detail: 'type_wide_only' }, 400);
  }

  const fromDate = ctx.url.searchParams.get('fromDate');
  const toDate = ctx.url.searchParams.get('toDate');
  const rangeErr = inclusiveDateRangeError(fromDate, toDate);
  if (rangeErr) return rangeErr;

  const roomTypeId = ctx.url.searchParams.get('roomTypeId') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const days = await resolvedCtx.resolved.stub.listRestrictionDays({
      fromDate: fromDate!,
      toDate: toDate!,
      roomTypeId,
    });
    return json({ ok: true, days }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetDomainConfig(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const keys = await resolvedCtx.resolved.stub.listDomainConfig();
    return json({ ok: true, keys }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

const DIRECTORY_WINDOWS = new Set(['today', 'tomorrow', 'week', 'all']);
const RESERVATION_STATUS_SET = new Set<string>(RESERVATION_STATUSES);

async function handleGetFrontDeskTape(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const fromDate = ctx.url.searchParams.get('fromDate');
  const toDate = ctx.url.searchParams.get('toDate');
  const rangeErr = inclusiveDateRangeError(fromDate, toDate);
  if (rangeErr) return rangeErr;
  const roomTypeId = ctx.url.searchParams.get('roomTypeId') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readFrontOfficeTape(fromDate!, toDate!, roomTypeId);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskDirectory(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const url = new URL(ctx.request.url);
  const windowRaw = url.searchParams.get('window');
  if (!windowRaw || !DIRECTORY_WINDOWS.has(windowRaw)) {
    return json({ error: 'invalid_window' }, 400);
  }
  const window = windowRaw as 'today' | 'tomorrow' | 'week' | 'all';
  const date = url.searchParams.get('date');
  if (window !== 'all' && (!date || !ISO_DATE_RE.test(date))) {
    return json({ error: 'invalid_date' }, 400);
  }

  const statusRaw = url.searchParams.get('status');
  let statuses: string[] | undefined;
  if (statusRaw != null && statusRaw !== '') {
    const tokens = statusRaw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    if (tokens.length === 0 || tokens.some((t) => !RESERVATION_STATUS_SET.has(t))) {
      return json({ error: 'invalid_status' }, 400);
    }
    statuses = tokens;
  }

  const cursorRaw = url.searchParams.get('cursor');
  const decoded = decodeFrontDeskCursor<{ arrivalDate: string; reservationId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400);
  if (
    decoded &&
    (typeof decoded.arrivalDate !== 'string' || typeof decoded.reservationId !== 'string')
  ) {
    return json({ error: 'invalid_cursor' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listFrontOfficeDirectory({
      window,
      date: date ?? undefined,
      statuses,
      limit: parseOptionalFrontDeskLimit(url),
      cursor: decoded,
    });
    if (!result.ok) {
      const status = result.error === 'invalid_window' || result.error === 'invalid_date' ? 400 : 422;
      return json({ error: result.error }, status);
    }
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskAvailableRooms(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const fromDate = ctx.url.searchParams.get('fromDate');
  const toDate = ctx.url.searchParams.get('toDate');
  const rangeErr = inclusiveDateRangeError(fromDate, toDate);
  if (rangeErr) return rangeErr;
  const roomTypeId = ctx.url.searchParams.get('roomTypeId') ?? undefined;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listAvailableRooms({
      fromDate: fromDate!,
      toDate: toDate!,
      roomTypeId,
    });
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontDeskSummary(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const date = ctx.url.searchParams.get('date');
  if (!date || !ISO_DATE_RE.test(date)) {
    return json({ error: 'invalid_date' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readFrontOfficeSummary(date);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetFrontOfficeStream(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const upgrade = ctx.request.headers.get('Upgrade');
  if (upgrade?.toLowerCase() !== 'websocket') {
    return json({ error: 'expected_websocket' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const headers = new Headers(ctx.request.headers);
  headers.delete('x-hospai-ws-actor');
  headers.set('x-hospai-ws-actor', ctx.actor.userId);
  const forward = new Request(ctx.request.url, { method: 'GET', headers });
  try {
    return await resolvedCtx.resolved.stub.fetch(forward);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePutRoomTypeRate(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const roomTypeId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    ratePlanId?: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body.stayDate || typeof body.amountMinor !== 'number' || !body.currency || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const cell = normalizeRateDayCell({
    roomTypeId,
    ratePlanId: body.ratePlanId,
    stayDate: body.stayDate,
    amountMinor: body.amountMinor,
    currency: body.currency,
  });
  const fingerprint = await commandFingerprint('rates.upsert_day', cell);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { ...cell, auditCommandId: 'rates.update_room_type_rate' as const };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryUpsertRateDay']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.update_room_type_rate',
      routeId: 'put_room_type_rate',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryUpsertRateDay(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
      return null;
    },
  });
}

async function handlePostRatesBulk(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    updates: Array<{
      roomTypeId: string;
      ratePlanId?: string;
      stayDate: string;
      amountMinor: number;
      currency: string;
    }>;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!Array.isArray(body.updates) || body.updates.length === 0 || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.updates.length > RATES_BULK_UPDATE_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
  const fingerprint = await commandFingerprint('rates.bulk_update', { updates: normalized });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = { updates: normalized };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryBulkUpdateRates']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'rates.bulk_update',
      routeId: 'post_rates_bulk',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryBulkUpdateRates(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'rates:write',
    successStatus: 200,
    onFailure: (result) => {
    if (result.error === 'not_member') return json({ error: 'not_found' }, 404);
    return null;
    },
  });
}

async function handlePostFolioSplit(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const sourceFolioLineId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    splits: Array<{ folioLineId: string; amountMinor: number; folioWindowId?: string }>;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.splits?.length || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (body.splits.length > FOLIO_SPLIT_MAX) {
    return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { sourceFolioLineId, splits: body.splits };
  const fingerprint = await commandFingerprint('folio.split_charge', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySplitFolioLine']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.split_charge',
      routeId: 'post_folio_split',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.trySplitFolioLine(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioWindow(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    kind: 'GUEST' | 'COMPANY' | 'MASTER';
    billedParty?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.kind || !body.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { reservationId, kind: body.kind, billedParty: body.billedParty };
  const fingerprint = await commandFingerprint('folio.open_window', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryOpenFolioWindow']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.open_window',
      routeId: 'post_folio_window',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryOpenFolioWindow(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioWindowClose(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const folioWindowId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { folioWindowId };
  const fingerprint = await commandFingerprint('folio.close_window', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCloseFolioWindow']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.close_window',
      routeId: 'post_folio_window_close',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCloseFolioWindow(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioWindowReopen(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const folioWindowId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { folioWindowId };
  const fingerprint = await commandFingerprint('folio.reopen_window', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryReopenFolioWindow']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.reopen_window',
      routeId: 'post_folio_window_reopen',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryReopenFolioWindow(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioTransfer(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const sourceFolioLineId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    destinationFolioWindowId: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.destinationFolioWindowId || !body.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { sourceFolioLineId, destinationFolioWindowId: body.destinationFolioWindowId };
  const fingerprint = await commandFingerprint('folio.transfer_charge', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryTransferCharge']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.transfer_charge',
      routeId: 'post_folio_transfer',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryTransferCharge(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioVoid(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { paymentId };
  const fingerprint = await commandFingerprint('folio.void', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryVoidPayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.void',
      routeId: 'post_folio_void',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryVoidPayment(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioReconcilePayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    outcome?: string;
    gatewayReference?: string;
    idempotencyKey?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  if (body.outcome !== 'authorized' && body.outcome !== 'declined') {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprintInput =
    body.gatewayReference != null
      ? { paymentId, outcome: body.outcome, gatewayReference: body.gatewayReference }
      : { paymentId, outcome: body.outcome };
  const fingerprint = await commandFingerprint('folio.reconcile_payment', fingerprintInput);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId,
    outcome: body.outcome as 'authorized' | 'declined',
    ...(body.gatewayReference != null ? { gatewayReference: body.gatewayReference } : {}),
  };
  const idem = { key: body.idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryReconcilePayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.reconcile_payment',
      routeId: 'post_folio_reconcile_payment',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryReconcilePayment(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioRefund(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ amountMinor?: number; idempotencyKey?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !body?.idempotencyKey ||
    typeof body.amountMinor !== 'number' ||
    !Number.isInteger(body.amountMinor) ||
    body.amountMinor <= 0
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { paymentId, amountMinor: body.amountMinor };
  const fingerprint = await commandFingerprint('folio.refund', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRefundPayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.refund',
      routeId: 'post_folio_refund',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryRefundPayment(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioDiscount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const sourceFolioLineId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    kind: 'percent' | 'fixed';
    bps?: number;
    amountMinor?: number;
    reason: string;
    folioLineId: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.kind || !body.folioLineId || body.reason == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    sourceFolioLineId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
    folioLineId: body.folioLineId,
  };
  const fingerprint = await commandFingerprint('folio.post_discount', {
    sourceFolioLineId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryPostDiscount']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.post_discount',
      routeId: 'post_folio_discount',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryPostDiscount(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioStayDiscount(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    kind: 'percent' | 'fixed';
    bps?: number;
    amountMinor?: number;
    reason: string;
    folioLineId: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.kind || !body.folioLineId || body.reason == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    reservationId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
    folioLineId: body.folioLineId,
  };
  const fingerprint = await commandFingerprint('folio.post_discount', {
    reservationId,
    kind: body.kind,
    bps: body.bps,
    amountMinor: body.amountMinor,
    reason: body.reason,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryPostDiscount']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.post_discount',
      routeId: 'post_folio_stay_discount',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryPostDiscount(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioCaptureDue(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { reservationId };
  const fingerprint = await commandFingerprint('folio.capture_due', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: body.idempotencyKey, fingerprint };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCaptureDueHolds']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.capture_due',
      routeId: 'post_folio_capture_due',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCaptureDueHolds(actor, commandPayload, idem),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
    onFailure: (result) => {    return null;
    },
  });
}

async function handlePostFolioAuthorize(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    paymentId: string;
    amountMinor: number;
    currency?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.paymentId || body.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const requestFingerprint = await commandFingerprint('folio.authorize', {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    ...(body.currency ? { currency: body.currency } : {}),
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const commandPayload = {
    paymentId: body.paymentId,
    reservationId,
    amountMinor: body.amountMinor,
    ...(body.currency ? { currency: body.currency } : {}),
    idempotencyKey: body.idempotencyKey,
    requestFingerprint,
  };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAuthorizePayment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.authorize',
      routeId: 'post_folio_authorize',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryAuthorizePayment(actor, commandPayload),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
  });
}

async function handlePostFolioCapture(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

    const bodyParsed = await parseJsonBody<{
    amountMinor: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (body?.amountMinor == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const captureFingerprint = await commandFingerprint('folio.capture', {
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
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.capture',
      routeId: 'post_folio_capture',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: captureFingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryCapturePayment(actor, commandPayload),
  });

  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
  });
}

async function handleGetFolioPayment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readPayment(paymentId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetFolioPayments(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listPaymentsForReservation(reservationId);
    if (!result.ok) {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      return json({ ok: false, error: result.error }, 422);
    }
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
}

async function handleGetNightAudit(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const status = await resolvedCtx.resolved.stub.readNightAuditStatus();
    if (!status.ok) return json({ ok: false, error: status.error }, 422);
    const pendingOpenCount = await countPendingOpen(ctx.env.PLATFORM_DB, propertyId);
    return json({ ...status, pendingOpenCount }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetNightAuditCheckLog(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const log = await resolvedCtx.resolved.stub.readNightAuditCheckLog();
    return json(log, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetNightAuditReport(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const businessDate = decodeURIComponent(ctx.match[2]!);
  const reportId = decodeURIComponent(ctx.match[3]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
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
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostNightAuditRun(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const status = await resolvedCtx.resolved.stub.readNightAuditStatus();
  if (!status.ok) return json({ ok: false, error: status.error }, 422);
  const businessDate = status.businessDate;
  const fingerprint = await commandFingerprint('night_audit.run', { propertyId, businessDate });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryStartNightAudit']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'night_audit.run',
      routeId: 'post_night_audit_run',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { propertyId, businessDate },
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryStartNightAudit(actor, {
        key: body.idempotencyKey!,
        fingerprint,
      }),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.error === NIGHT_AUDIT_HALTED || result.error === 'night_audit_not_due') {
      return json({ error: result.error }, 409);
    }
    return commandFailureResponse(result.error, 'night_audit:run');
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
    const bodyParsed = await parseJsonBody<{
    idempotencyKey?: string;
    businessDate?: string;
    step?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || !body.businessDate || !body.step) {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!(NIGHT_AUDIT_STEPS as readonly string[]).includes(body.step)) {
    return json({ error: 'invalid_body' }, 400);
  }
  const step = body.step as NightAuditStep;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('night_audit.retry_step', {
    propertyId,
    businessDate: body.businessDate,
    step,
  });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const census = { pendingOpenCount: await countPendingOpen(ctx.env.PLATFORM_DB, propertyId) };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRetryAuditStep']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'night_audit.retry_step',
      routeId: 'post_night_audit_retry',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { propertyId, businessDate: body.businessDate, step },
    }),
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
    if (result.error === 'night_audit_step_not_failed') {
      return json({ error: result.error }, 409);
    }
    return commandFailureResponse(result.error, 'night_audit:run');
  }
  return json({ status: result.status, error: result.error }, 200);
}

async function handlePostNightAuditResolveHalt(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey?: string; businessDate?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || !body.businessDate) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('night_audit.resolve_halt', { propertyId, businessDate: body.businessDate });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const census = { pendingOpenCount: await countPendingOpen(ctx.env.PLATFORM_DB, propertyId) };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryResolveHalt']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'night_audit.resolve_halt',
      routeId: 'post_night_audit_resolve_halt',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { propertyId, businessDate: body.businessDate },
    }),
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
    return commandFailureResponse(result.error, 'night_audit:run');
  }
  return json({ status: result.status, error: result.error, halted: result.halted }, 200);
}

async function handlePostProvisionalExceptionResolve(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('provisional.resolve_exception', { propertyId, exceptionId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryResolveProvisionalException']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'provisional.resolve_exception',
      routeId: 'post_provisional_exception_resolve',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { propertyId, exceptionId },
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryResolveProvisionalException(
        actor,
        { exceptionId },
        { key: body.idempotencyKey!, fingerprint },
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapExceptionWriterError(result.error);
  if (result.alreadyResolved) {
    return json({ ok: true, alreadyResolved: true }, 200);
  }
  return json({ ok: true }, 200);
}

async function handleGetProvisionalException(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.readProvisionalException(exceptionId);
    if (!result.ok) return json({ error: NOT_FOUND }, 404);
    return json(result, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

function mapExceptionWriterError(error: CommandError): Response {
  if (error === 'org_unreachable') {
    return json(
      { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'provisional.retry_exception' },
      503,
      { 'Retry-After': '30' },
    );
  }
  if (error === FORBIDDEN || error === SCOPE_MISMATCH) {
    return commandFailureResponse(error, 'night_audit:run');
  }
  if (error === NOT_MEMBER) return json({ error: 'not_found' }, 404);
  if (error === NOT_FOUND) return json({ error: NOT_FOUND }, 404);
  return json({ ok: false, error }, 422);
}

async function handlePostProvisionalExceptionRetry(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey?: string }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('provisional.retry_exception', { exceptionId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryRetryProvisionalException']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'provisional.retry_exception',
      routeId: 'post_provisional_exception_retry',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { exceptionId },
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryRetryProvisionalException(
        actor,
        { exceptionId },
        { key: body.idempotencyKey!, fingerprint },
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) {
    if (result.retried === false && result.error !== 'forbidden' && result.error !== NOT_FOUND && result.error !== 'not_member' && result.error !== 'org_unreachable') {
      return json({ ok: false, error: result.error, retried: false }, 422);
    }
    return mapExceptionWriterError(result.error);
  }
  return json({ ok: true, retried: true }, 200);
}

async function handlePostProvisionalExceptionAssign(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{ idempotencyKey?: string; assignedTo?: string | null }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey) return json({ error: 'invalid_body' }, 400);
  if (!('assignedTo' in body)) return json({ error: 'invalid_body' }, 400);
  if (body.assignedTo !== null && (typeof body.assignedTo !== 'string' || body.assignedTo === '')) {
    return json({ error: 'invalid_body' }, 400);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('provisional.assign_exception', { exceptionId, assignedTo: body.assignedTo });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<
    Awaited<ReturnType<PropertyDO['tryAssignProvisionalException']>>
  >({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'provisional.assign_exception',
      routeId: 'post_provisional_exception_assign',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { exceptionId, assignedTo: body.assignedTo },
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryAssignProvisionalException(
        actor,
        { exceptionId, assignedTo: body.assignedTo ?? null },
        { key: body.idempotencyKey!, fingerprint },
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapExceptionWriterError(result.error);
  return json({ ok: true }, 200);
}

async function handlePostProvisionalExceptionNote(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const exceptionId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    idempotencyKey?: string;
    noteId?: string;
    text?: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.idempotencyKey || !body.noteId) return json({ error: 'invalid_body' }, 400);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: 'invalid_body' }, 400);

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const fingerprint = await commandFingerprint('provisional.add_exception_note', { exceptionId, noteId: body.noteId });
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryAddExceptionNote']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'provisional.add_exception_note',
      routeId: 'post_provisional_exception_note',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload: { exceptionId, noteId: body.noteId },
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryAddExceptionNote(
        actor,
        { exceptionId, noteId: body.noteId!, text },
        { key: body.idempotencyKey!, fingerprint },
      ),
  });
  if (invoked.kind === 'response') return invoked.response;
  const result = invoked.result;
  if (!result.ok) return mapExceptionWriterError(result.error);
  return json({ ok: true }, 200);
}

function guestDirectoryErrorResponse(err: string): Response {
  if (err === ENTITLEMENT_UNAVAILABLE) {
    return json({ error: ENTITLEMENT_UNAVAILABLE }, 503, GUEST_HEADERS);
  }
  return commandFailureResponse(err as CommandError, 'guests:read', { headers: GUEST_HEADERS });
}

async function handleGetGuests(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const limit = parseGuestDirectoryLimit(ctx.url.searchParams.get('limit'));
  if (limit === 'invalid') return json({ error: 'invalid_limit' }, 400, GUEST_HEADERS);

  const decoded = decodeFrontDeskCursor<{ createdAt: number; guestId: string }>(
    ctx.url.searchParams.get('cursor'),
  );
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  if (
    decoded &&
    (typeof decoded.createdAt !== 'number' || typeof decoded.guestId !== 'string')
  ) {
    return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.listGuests(actor, propertyId, {
      limit,
      ...(decoded ? { cursor: decoded } : {}),
    });
    if (!result.ok) return guestDirectoryErrorResponse(result.error);
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
      GUEST_HEADERS,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostGuestsSearch(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const guestSearchRaw = await parseRequestJson(ctx.request);
  if (guestSearchRaw instanceof Response) return guestSearchRaw;
  const body = (guestSearchRaw ?? null) as {
    q?: unknown;
    cursor?: unknown;
    limit?: unknown;
  } | null;
  const q = typeof body?.q === 'string' ? body.q.trim() : '';
  if (!q || q.length > 128) return json({ error: 'invalid_query' }, 400, GUEST_HEADERS);

  const limit = parseGuestDirectoryLimitValue(body?.limit);
  if (limit === 'invalid') return json({ error: 'invalid_limit' }, 400, GUEST_HEADERS);

  const cursorRaw = typeof body?.cursor === 'string' ? body.cursor : body?.cursor == null ? null : 'invalid';
  if (cursorRaw === 'invalid') return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  const decoded = decodeFrontDeskCursor<{ guestId: string }>(cursorRaw);
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  if (decoded && typeof decoded.guestId !== 'string') {
    return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };

  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.searchGuests(actor, propertyId, {
      q,
      limit,
      ...(decoded ? { cursor: decoded } : {}),
    });
    if (!result.ok) return guestDirectoryErrorResponse(result.error);
    return json(
      {
        ok: true,
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
      GUEST_HEADERS,
    );
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handleGetGuestStays(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const guestId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const limit = parseGuestDirectoryLimit(ctx.url.searchParams.get('limit'));
  if (limit === 'invalid') return json({ error: 'invalid_limit' }, 400, GUEST_HEADERS);

  const decoded = decodeFrontDeskCursor<{ arrivalDate: string; reservationId: string }>(
    ctx.url.searchParams.get('cursor'),
  );
  if (decoded === 'invalid') return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  if (
    decoded &&
    (typeof decoded.arrivalDate !== 'string' || typeof decoded.reservationId !== 'string')
  ) {
    return json({ error: 'invalid_cursor' }, 400, GUEST_HEADERS);
  }

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  try {
    const result = await resolvedCtx.resolved.stub.listReservationsByGuestRef(guestId, {
      limit,
      ...(decoded ? { cursor: decoded } : {}),
    });
    return json(
      {
        ok: true,
        propertyId,
        guestId,
        scope: 'this_property',
        items: result.items,
        nextCursor: result.nextCursor ? encodeFrontDeskCursor(result.nextCursor) : null,
      },
      200,
      GUEST_HEADERS,
    );
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostFxRates(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    quoteId: string;
    fromCurrency: string;
    toCurrency: string;
    rate: string;
    effectiveFrom: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (
    !body?.quoteId ||
    !body.fromCurrency ||
    !body.toCurrency ||
    !body.rate ||
    body.effectiveFrom == null ||
    !body.idempotencyKey
  ) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    quoteId: body.quoteId,
    fromCurrency: body.fromCurrency,
    toCurrency: body.toCurrency,
    rate: body.rate,
    effectiveFrom: body.effectiveFrom,
  };
  const fingerprint = await commandFingerprint('folio.create_fx_rate', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryCreateFxRate']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.create_fx_rate',
      routeId: 'post_fx_rates',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryCreateFxRate(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 201,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handlePostFxRateSupersede(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const supersedeQuoteId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    quoteId: string;
    rate: string;
    effectiveFrom: number;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.quoteId || !body.rate || body.effectiveFrom == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    quoteId: body.quoteId,
    supersedeQuoteId,
    rate: body.rate,
    effectiveFrom: body.effectiveFrom,
  };
  const fingerprint = await commandFingerprint('folio.supersede_fx_rate', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['trySupersedeFxRate']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.supersede_fx_rate',
      routeId: 'post_fx_rate_supersede',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.trySupersedeFxRate(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'settings:configure',
    successStatus: 200,
    onFailure: (result) => {
    return null;
    },
  });
}

async function handleGetFxRates(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  try {
    const pair = new URL(ctx.request.url).searchParams.get('pair');
    const [rates, ledgerCurrency] = await Promise.all([
      resolvedCtx.resolved.stub.listFxRates(),
      resolvedCtx.resolved.stub.readStoredLedgerCurrency(),
    ]);
    let listed = rates.filter((r) => r.effectiveTo === null);
    if (pair && pair.length === 6) {
      const fromCurrency = pair.slice(0, 3).toUpperCase();
      const toCurrency = pair.slice(3).toUpperCase();
      listed = rates.filter((r) => r.fromCurrency === fromCurrency && r.toCurrency === toCurrency);
    }
    return json({ ledgerCurrency, rates: listed }, 200);
  } catch (e) {
    if (isPropertyDoTransportFailure(e, ctx.env)) return degradedFailClosedReadResponse();
    throw e;
  }
}

async function handlePostFolioChargeback(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const paymentId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    feeLedgerMinor: number;
    reason: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (body?.feeLedgerMinor == null || body.reason == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = { paymentId, feeLedgerMinor: body.feeLedgerMinor, reason: body.reason };
  const fingerprint = await commandFingerprint('folio.record_chargeback', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryRecordChargeback']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.record_chargeback',
      routeId: 'post_folio_chargeback',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryRecordChargeback(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 200,
  });
}

async function handlePostFolioFxAdjustment(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;
    const bodyParsed = await parseJsonBody<{
    folioWindowId: string;
    kind: 'gain' | 'loss';
    amountMinor: number;
    reason: string;
    sourcePaymentId?: string;
    idempotencyKey: string;
  }>(ctx.request);
  if (bodyParsed instanceof Response) return bodyParsed;
  const body = bodyParsed;
  if (!body?.folioWindowId || !body.kind || body.amountMinor == null || body.reason == null || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const commandPayload = {
    reservationId,
    folioWindowId: body.folioWindowId,
    kind: body.kind,
    amountMinor: body.amountMinor,
    reason: body.reason,
    ...(body.sourcePaymentId ? { sourcePaymentId: body.sourcePaymentId } : {}),
  };
  const fingerprint = await commandFingerprint('folio.post_fx_adjustment', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const invoked = await invokePropertyDo<Awaited<ReturnType<PropertyDO['tryPostFxAdjustment']>>>({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'folio.post_fx_adjustment',
      routeId: 'post_folio_fx_adjustment',
      idempotencyKey: body.idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () =>
      resolvedCtx.resolved.stub.tryPostFxAdjustment(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
  });
  return finishPropertyDoInvoke({
    invoked,
    permission: 'folio:post',
    successStatus: 201,
    onFailure: (result) => {    return null;
    },
  });
}

export const V1_ROUTES: V1RouteDef[] = [
  {
    id: 'post_orgs',
    scope: 'bootstrap',
    method: 'POST',
    pattern: /^\/v1\/orgs$/,
    handler: handlePostOrgs,
  },
  {
    id: 'post_migration_sweep',
    scope: 'dev',
    method: 'POST',
    pattern: /^\/v1\/admin\/migration-sweep$/,
    handler: handlePostMigrationSweep,
  },
  {
    id: 'post_org_properties',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/properties$/,
    permission: 'property:provision',
    entitlement: 'pms.core',
    handler: handlePostOrgProperties,
  },
  {
    id: 'get_org_properties',
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/properties$/,
    permission: 'org:read',
    handler: handleGetOrgProperties,
  },
  {
    id: 'get_property',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)$/,
    permission: 'property:read',
    handler: handleGetProperty,
  },
  {
    id: 'get_registry_property',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/registry\/properties\/([^/]+)$/,
    permission: 'property:read',
    handler: handleGetRegistryProperty,
  },
  {
    id: 'post_room_types',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types$/,
    permission: 'inventory:write',
    commandId: 'inventory.add_room_type',
    handler: handlePostRoomTypes,
  },
  {
    id: 'put_room_type',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'inventory.update_room_type',
    handler: handlePutRoomType,
  },
  {
    id: 'delete_room_type',
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'inventory.delete_room_type',
    handler: handleDeleteRoomType,
  },
  {
    id: 'get_property_availability',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/availability$/,
    permission: 'inventory:read',
    entitlement: 'pms.core',
    handler: handleGetAvailability,
  },
  {
    id: 'post_reservations',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations$/,
    permission: 'reservations:write',
    commandId: 'reservations.create',
    handler: handlePostReservations,
  },
  {
    id: 'get_reservation',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetReservation,
  },
  {
    id: 'patch_reservation',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)$/,
    permission: 'reservations:write',
    commandId: 'reservations.modify',
    handler: handlePatchReservation,
  },
  {
    id: 'post_reservation_cancel',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel$/,
    permission: 'reservations:write',
    commandId: 'reservations.cancel',
    handler: handlePostReservationCancel,
  },
  {
    id: 'post_reservation_check_in',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-in$/,
    permission: 'reservations:write',
    commandId: 'reservations.check_in',
    handler: handlePostReservationCheckIn,
  },
  {
    id: 'post_reservation_check_out',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/check-out$/,
    permission: 'reservations:write',
    commandId: 'reservations.check_out',
    handler: handlePostReservationCheckOut,
  },
  {
    id: 'post_reservation_no_show',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/no-show$/,
    permission: 'reservations:write',
    commandId: 'reservations.no_show',
    handler: handlePostReservationNoShow,
  },
  {
    id: 'post_reservation_cancel_check_in',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/cancel-check-in$/,
    permission: 'reservations:write',
    commandId: 'reservations.cancel_check_in',
    handler: handlePostReservationCancelCheckIn,
  },
  {
    id: 'get_provisional_exceptions',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exception-count$/,
    permission: 'property:read',
    handler: handleGetProvisionalExceptionCount,
  },
  {
    id: 'get_provisional_exception_count',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions$/,
    permission: 'property:read',
    handler: handleGetProvisionalExceptions,
  },
  {
    id: 'put_rate_days',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-days$/,
    permission: 'rates:write',
    commandId: 'rates.upsert_day',
    handler: handlePutRateDays,
  },
  {
    id: 'put_restriction_days',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/restriction-days$/,
    permission: 'rates:write',
    commandId: 'restrictions.upsert_day',
    handler: handlePutRestrictionDays,
  },
  {
    id: 'post_folio_lines',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/lines$/,
    permission: 'folio:post',
    commandId: 'folio.add_item',
    handler: handlePostFolioLines,
  },
  {
    id: 'get_folio',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolio,
  },
  {
    id: 'post_folio_split',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/split$/,
    permission: 'folio:adjust',
    commandId: 'folio.split_charge',
    entitlement: 'pms.core',
    handler: handlePostFolioSplit,
  },
  {
    id: 'post_rooms',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms$/,
    permission: 'inventory:write',
    commandId: 'rooms.create',
    handler: handlePostRooms,
  },
  {
    id: 'patch_room',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'rooms.update',
    handler: handlePatchRoom,
  },
  {
    id: 'get_rooms',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetRooms,
  },
  {
    id: 'post_room_status',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/status$/,
    permission: 'housekeeping:write',
    commandId: 'rooms.update_status',
    handler: handlePostRoomStatus,
  },
  {
    id: 'post_rooms_bulk_status',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/bulk-status$/,
    permission: 'housekeeping:write',
    commandId: 'rooms.bulk_update_status',
    handler: handlePostRoomsBulkStatus,
  },
  {
    id: 'post_reservation_assign_room',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/assign-room$/,
    permission: 'reservations:write',
    commandId: 'reservations.assign_room',
    handler: handlePostReservationAssignRoom,
  },
  {
    id: 'post_housekeeping_assign',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.assign',
    handler: handlePostHousekeepingAssign,
  },
  {
    id: 'get_housekeeping_assignments',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/assignments$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetHousekeepingAssignments,
  },
  {
    id: 'post_rate_plans',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans$/,
    permission: 'rates:write',
    commandId: 'rates.create_plan',
    handler: handlePostRatePlans,
  },
  {
    id: 'patch_rate_plan',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.update_plan',
    handler: handlePatchRatePlan,
  },
  {
    id: 'delete_rate_plan',
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.delete_plan',
    handler: handleDeleteRatePlan,
  },
  {
    id: 'get_rate_plans',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-plans$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRatePlans,
  },
  {
    id: 'put_room_type_rate',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types\/([^/]+)\/rates$/,
    permission: 'rates:write',
    commandId: 'rates.update_room_type_rate',
    handler: handlePutRoomTypeRate,
  },
  {
    id: 'post_rates_bulk',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rates\/bulk$/,
    permission: 'rates:write',
    commandId: 'rates.bulk_update',
    handler: handlePostRatesBulk,
  },
  {
    id: 'post_guests',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests$/,
    permission: 'guests:write',
    commandId: 'guests.create',
    handler: handlePostGuests,
  },
  {
    id: 'patch_guest',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/,
    permission: 'guests:write',
    commandId: 'guests.update',
    handler: handlePatchGuest,
  },
  {
    id: 'post_guest_erase',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/erase$/,
    permission: 'guests:erase',
    commandId: 'guests.erase',
    handler: handlePostGuestErase,
  },
  {
    id: 'get_guest',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handleGetGuest,
  },
  {
    id: 'patch_property_details',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)$/,
    permission: 'config:write',
    commandId: 'property.update_details',
    handler: handlePatchPropertyDetails,
  },
  {
    id: 'put_domain_config',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/config\/domain$/,
    permission: 'settings:configure',
    commandId: 'config.put_domain',
    handler: handlePutDomainConfig,
  },
  {
    id: 'post_folio_authorize',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments\/authorize$/,
    permission: 'folio:post',
    commandId: 'folio.authorize',
    handler: handlePostFolioAuthorize,
  },
  {
    id: 'post_folio_capture',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/capture$/,
    permission: 'folio:post',
    commandId: 'folio.capture',
    handler: handlePostFolioCapture,
  },
  {
    id: 'get_folio_payment',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolioPayment,
  },
  {
    id: 'get_folio_payments',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolioPayments,
  },
  {
    id: 'post_charge_codes',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes$/,
    permission: 'settings:configure',
    commandId: 'folio.create_charge_code',
    handler: handlePostChargeCodes,
  },
  {
    id: 'patch_charge_code',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'folio.update_charge_code',
    handler: handlePatchChargeCode,
  },
  {
    id: 'put_charge_code_status',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes\/([^/]+)\/status$/,
    permission: 'settings:configure',
    commandId: 'folio.set_charge_code_status',
    handler: handlePutChargeCodeStatus,
  },
  {
    id: 'get_charge_codes',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/charge-codes$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetChargeCodes,
  },
  {
    id: 'post_tax_rules',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules$/,
    permission: 'settings:configure',
    commandId: 'folio.create_tax_rule',
    handler: handlePostTaxRules,
  },
  {
    id: 'put_tax_rule_supersede',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules\/([^/]+)\/supersede$/,
    permission: 'settings:configure',
    commandId: 'folio.supersede_tax_rule',
    handler: handlePutTaxRuleSupersede,
  },
  {
    id: 'get_tax_rules',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/tax-rules$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetTaxRules,
  },
  {
    id: 'post_shifts',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts$/,
    permission: 'folio:post',
    commandId: 'folio.open_shift',
    handler: handlePostShifts,
  },
  {
    id: 'put_shift_close',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts\/([^/]+)\/close$/,
    permission: 'folio:post',
    commandId: 'folio.close_shift',
    handler: handlePutShiftClose,
  },
  {
    id: 'post_cash_payment',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/payments\/cash$/,
    permission: 'folio:post',
    commandId: 'folio.record_cash_payment',
    handler: handlePostCashPayment,
  },
  {
    id: 'get_shift',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/shifts\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetShift,
  },
  {
    id: 'get_audit_log',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/audit-log$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetAuditLog,
  },
  {
    id: 'get_front_desk_arrivals',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/arrivals$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskArrivals,
  },
  {
    id: 'get_front_desk_departures',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/departures$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskDepartures,
  },
  {
    id: 'get_front_desk_in_house',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/in-house$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskInHouse,
  },
  {
    id: 'post_guests_batch',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/batch$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handlePostGuestsBatch,
  },
  {
    id: 'get_org_entitlements',
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/entitlements$/,
    permission: 'org:read',
    handler: handleGetOrgEntitlements,
  },
  {
    id: 'get_front_desk_shift',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/shift$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskShift,
  },
  {
    id: 'get_front_desk_recent_shifts',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/shifts\/recent$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskRecentShifts,
  },
  {
    id: 'get_property_me',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/me$/,
    permission: 'property:read',
    // no entitlement — kill-switch must not brick /me
    handler: handleGetPropertyMe,
  },
  {
    id: 'list_org_members',
    scope: 'org',
    method: 'GET',
    pattern: /^\/v1\/orgs\/([^/]+)\/members$/,
    permission: 'org:manage',
    handler: handleListOrgMembers,
  },
  {
    id: 'create_org_member',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/members$/,
    permission: 'org:manage',
    handler: handleCreateOrgMember,
  },
  {
    id: 'update_org_member',
    scope: 'org',
    method: 'PATCH',
    pattern: /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/,
    permission: 'org:manage',
    handler: handleUpdateOrgMember,
  },
  {
    id: 'delete_org_member',
    scope: 'org',
    method: 'DELETE',
    pattern: /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/,
    permission: 'org:manage',
    handler: handleDeleteOrgMember,
  },
  {
    id: 'list_property_members',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/members$/,
    permission: 'staff:read',
    handler: handleListPropertyMembers,
  },
  {
    id: 'create_property_member',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/members$/,
    permission: 'staff:write',
    handler: handleCreatePropertyMember,
  },
  {
    id: 'update_property_member',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/,
    permission: 'staff:write',
    handler: handleUpdatePropertyMember,
  },
  {
    id: 'delete_property_member',
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/,
    permission: 'staff:write',
    handler: handleDeletePropertyMember,
  },
  {
    id: 'post_org_cancel',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/cancel$/,
    permission: 'org:cancel',
    handler: handlePostOrgCancel,
  },
  {
    id: 'post_org_purge',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/purge$/,
    permission: 'org:purge',
    handler: handlePostOrgPurge,
  },
  {
    id: 'get_roster',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/roster$/,
    permission: 'roster:read',
    entitlement: 'pms.core',
    handler: handleGetRoster,
  },
  {
    id: 'get_roster_one',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)$/,
    permission: 'roster:read',
    entitlement: 'pms.core',
    handler: handleGetRosterOne,
  },
  {
    id: 'post_roster',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster$/,
    permission: 'roster:write',
    commandId: 'roster.add',
    entitlement: 'pms.core',
    handler: handlePostRoster,
  },
  {
    id: 'patch_roster',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)$/,
    permission: 'roster:write',
    commandId: 'roster.update',
    entitlement: 'pms.core',
    handler: handlePatchRoster,
  },
  {
    id: 'post_roster_status',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)\/status$/,
    permission: 'roster:write',
    commandId: 'roster.status',
    entitlement: 'pms.core',
    handler: handlePostRosterStatus,
  },
  {
    id: 'post_roster_exit',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)\/exit$/,
    permission: 'roster:write',
    commandId: 'roster.exit',
    entitlement: 'pms.core',
    handler: handlePostRosterExit,
  },
  {
    id: 'get_night_audit',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit$/,
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    handler: handleGetNightAudit,
  },
  {
    id: 'get_night_audit_report',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/reports\/([^/]+)\/([^/]+)$/,
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    handler: handleGetNightAuditReport,
  },
  {
    id: 'post_night_audit_run',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/run$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.run',
    entitlement: 'pms.core',
    handler: handlePostNightAuditRun,
  },
  {
    id: 'post_night_audit_retry',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/retry$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.retry_step',
    entitlement: 'pms.core',
    handler: handlePostNightAuditRetry,
  },
  {
    id: 'post_night_audit_resolve_halt',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/resolve-halt$/,
    permission: 'night_audit:run',
    commandId: 'night_audit.resolve_halt',
    entitlement: 'pms.core',
    handler: handlePostNightAuditResolveHalt,
  },
  {
    id: 'post_provisional_exception_resolve',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/resolve$/,
    permission: 'night_audit:run',
    commandId: 'provisional.resolve_exception',
    entitlement: 'pms.core',
    handler: handlePostProvisionalExceptionResolve,
  },
  {
    id: 'post_reservation_confirm',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/confirm$/,
    permission: 'reservations:write',
    commandId: 'reservations.confirm',
    entitlement: 'pms.core',
    handler: handlePostReservationConfirm,
  },
  {
    id: 'post_reservation_hold',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/hold$/,
    permission: 'reservations:write',
    commandId: 'reservations.hold',
    entitlement: 'pms.core',
    handler: handlePostReservationHold,
  },
  {
    id: 'post_reservation_front_office',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/front-office$/,
    permission: 'reservations:write',
    commandId: 'reservations.update_status',
    handler: handlePostReservationFrontOffice,
  },
  {
    id: 'post_folio_window',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/windows$/,
    permission: 'folio:adjust',
    commandId: 'folio.open_window',
    entitlement: 'pms.core',
    handler: handlePostFolioWindow,
  },
  {
    id: 'post_folio_window_close',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/windows\/([^/]+)\/close$/,
    permission: 'folio:adjust',
    commandId: 'folio.close_window',
    entitlement: 'pms.core',
    handler: handlePostFolioWindowClose,
  },
  {
    id: 'post_folio_window_reopen',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/windows\/([^/]+)\/reopen$/,
    permission: 'folio:adjust',
    commandId: 'folio.reopen_window',
    entitlement: 'pms.core',
    handler: handlePostFolioWindowReopen,
  },
  {
    id: 'post_folio_transfer',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/transfer$/,
    permission: 'folio:adjust',
    commandId: 'folio.transfer_charge',
    entitlement: 'pms.core',
    handler: handlePostFolioTransfer,
  },
  {
    id: 'post_folio_void',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/void$/,
    permission: 'folio:post',
    commandId: 'folio.void',
    entitlement: 'pms.core',
    handler: handlePostFolioVoid,
  },
  {
    id: 'post_folio_refund',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/refund$/,
    permission: 'folio:adjust',
    commandId: 'folio.refund',
    entitlement: 'pms.core',
    handler: handlePostFolioRefund,
  },
  {
    id: 'post_folio_discount',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/lines\/([^/]+)\/discount$/,
    permission: 'folio:adjust',
    commandId: 'folio.post_discount',
    entitlement: 'pms.core',
    handler: handlePostFolioDiscount,
  },
  {
    id: 'post_folio_capture_due',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/capture-due$/,
    permission: 'folio:post',
    commandId: 'folio.capture_due',
    entitlement: 'pms.core',
    handler: handlePostFolioCaptureDue,
  },
  {
    id: 'post_room_ooo_range',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)\/ooo$/,
    permission: 'inventory:write',
    commandId: 'rooms.set_ooo_range',
    entitlement: 'pms.core',
    handler: handlePostRoomOooRange,
  },
  {
    id: 'get_reservation_search',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations-search$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetReservationSearch,
  },
  {
    id: 'post_fx_rates',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/fx-rates$/,
    permission: 'settings:configure',
    commandId: 'folio.create_fx_rate',
    entitlement: 'pms.core',
    handler: handlePostFxRates,
  },
  {
    id: 'post_fx_rate_supersede',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/fx-rates\/([^/]+)\/supersede$/,
    permission: 'settings:configure',
    commandId: 'folio.supersede_fx_rate',
    entitlement: 'pms.core',
    handler: handlePostFxRateSupersede,
  },
  {
    id: 'get_fx_rates',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/fx-rates$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFxRates,
  },
  {
    id: 'post_folio_chargeback',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/payments\/([^/]+)\/chargeback$/,
    permission: 'folio:adjust',
    commandId: 'folio.record_chargeback',
    entitlement: 'pms.core',
    handler: handlePostFolioChargeback,
  },
  {
    id: 'post_folio_fx_adjustment',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/fx-adjustment$/,
    permission: 'folio:adjust',
    commandId: 'folio.post_fx_adjustment',
    entitlement: 'pms.core',
    handler: handlePostFolioFxAdjustment,
  },
  {
    id: 'get_room_types',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/room-types$/,
    permission: 'inventory:read',
    entitlement: 'pms.core',
    handler: handleGetRoomTypes,
  },
  {
    id: 'get_rate_days',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-days$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRateDays,
  },
  {
    id: 'get_restriction_days',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/restriction-days$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRestrictionDays,
  },
  {
    id: 'get_domain_config',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/config\/domain$/,
    permission: 'settings:configure',
    entitlement: 'pms.core',
    handler: handleGetDomainConfig,
  },
  {
    id: 'get_front_desk_tape',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/tape$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskTape,
  },
  {
    id: 'get_front_desk_directory',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/directory$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskDirectory,
  },
  {
    id: 'get_front_desk_available_rooms',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/available-rooms$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskAvailableRooms,
  },
  {
    id: 'get_front_desk_summary',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/summary$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontDeskSummary,
  },
  {
    id: 'get_front_desk_stream',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/front-desk\/stream$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetFrontOfficeStream,
  },
  {
    id: 'get_provisional_exception',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)$/,
    permission: 'property:read',
    entitlement: 'pms.core',
    handler: handleGetProvisionalException,
  },
  {
    id: 'post_provisional_exception_retry',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/retry$/,
    permission: 'night_audit:run',
    commandId: 'provisional.retry_exception',
    entitlement: 'pms.core',
    handler: handlePostProvisionalExceptionRetry,
  },
  {
    id: 'post_provisional_exception_assign',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/assign$/,
    permission: 'night_audit:run',
    commandId: 'provisional.assign_exception',
    entitlement: 'pms.core',
    handler: handlePostProvisionalExceptionAssign,
  },
  {
    id: 'post_provisional_exception_note',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/notes$/,
    permission: 'night_audit:run',
    commandId: 'provisional.add_exception_note',
    entitlement: 'pms.core',
    handler: handlePostProvisionalExceptionNote,
  },
  {
    id: 'get_guests',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/guests$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handleGetGuests,
  },
  {
    id: 'post_guests_search',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/guests-search$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handlePostGuestsSearch,
  },
  {
    id: 'get_guest_stays',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/stays$/,
    permission: 'guests:read',
    entitlement: 'pms.core',
    handler: handleGetGuestStays,
  },
  {
    id: 'post_demo_seed',
    scope: 'dev',
    method: 'POST',
    pattern: /^\/v1\/admin\/demo-seed$/,
    handler: handlePostDemoSeed,
  },
  {
    id: 'post_folio_stay_discount',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/folio\/discount$/,
    permission: 'folio:adjust',
    commandId: 'folio.post_discount',
    entitlement: 'pms.core',
    handler: handlePostFolioStayDiscount,
  },
  {
    id: 'get_folio_routing_rules',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetFolioRoutingRules,
  },
  {
    id: 'put_folio_routing_rule',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'folio.upsert_routing_rule',
    entitlement: 'pms.core',
    handler: handlePutFolioRoutingRule,
  },
  {
    id: 'post_folio_routing_rule_archive',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/folio\/routing-rules\/([^/]+)\/archive$/,
    permission: 'settings:configure',
    commandId: 'folio.archive_routing_rule',
    entitlement: 'pms.core',
    handler: handlePostFolioRoutingRuleArchive,
  },
  {
    id: 'delete_room',
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rooms\/([^/]+)$/,
    permission: 'inventory:write',
    commandId: 'rooms.delete',
    entitlement: 'pms.core',
    handler: handleDeleteRoom,
  },
  {
    id: 'post_folio_reconcile_payment',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/payments\/([^/]+)\/reconcile$/,
    permission: 'folio:post',
    commandId: 'folio.reconcile_payment',
    entitlement: 'pms.core',
    handler: handlePostFolioReconcilePayment,
  },
  {
    id: 'get_rate_promos',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos$/,
    permission: 'rates:read',
    entitlement: 'pms.core',
    handler: handleGetRatePromos,
  },
  {
    id: 'post_rate_promos',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos$/,
    permission: 'rates:write',
    commandId: 'rates.create_promo',
    entitlement: 'pms.core',
    handler: handlePostRatePromos,
  },
  {
    id: 'patch_rate_promo',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.update_promo',
    entitlement: 'pms.core',
    handler: handlePatchRatePromo,
  },
  {
    id: 'delete_rate_promo',
    scope: 'property',
    method: 'DELETE',
    pattern: /^\/v1\/properties\/([^/]+)\/rate-promos\/([^/]+)$/,
    permission: 'rates:write',
    commandId: 'rates.archive_promo',
    entitlement: 'pms.core',
    handler: handleDeleteRatePromo,
  },
  {
    id: 'post_invoices',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices$/,
    permission: 'folio:post',
    commandId: 'invoice.generate',
    entitlement: 'pms.core',
    handler: handlePostInvoices,
  },
  {
    id: 'get_invoice',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetInvoice,
  },
  {
    id: 'post_invoice_void',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/invoices\/([^/]+)\/void$/,
    permission: 'folio:adjust',
    commandId: 'invoice.void',
    entitlement: 'pms.core',
    handler: handlePostInvoiceVoid,
  },
  {
    id: 'post_city_ledger_accounts',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts$/,
    permission: 'folio:adjust',
    commandId: 'city_ledger.create_account',
    entitlement: 'pms.core',
    handler: handlePostCityLedgerAccounts,
  },
  {
    id: 'get_city_ledger_accounts',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetCityLedgerAccounts,
  },
  {
    id: 'patch_city_ledger_account',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)$/,
    permission: 'folio:adjust',
    commandId: 'city_ledger.update_account',
    entitlement: 'pms.core',
    handler: handlePatchCityLedgerAccount,
  },
  {
    id: 'post_city_ledger_account_payment',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)\/payments$/,
    permission: 'folio:adjust',
    commandId: 'city_ledger.receive_payment',
    entitlement: 'pms.core',
    handler: handlePostCityLedgerAccountPayment,
  },
  {
    id: 'get_city_ledger_statement',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/city-ledger\/accounts\/([^/]+)\/statements\/([^/]+)$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetCityLedgerStatement,
  },
  {
    id: 'post_reservation_early_depart',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations\/([^/]+)\/early-depart$/,
    permission: 'reservations:write',
    commandId: 'reservations.early_depart',
    entitlement: 'pms.core',
    handler: handlePostReservationEarlyDepart,
  },
  {
    id: 'get_products',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/products$/,
    permission: 'folio:read',
    entitlement: 'pms.core',
    handler: handleGetProducts,
  },
  {
    id: 'post_product_categories',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/product-categories$/,
    permission: 'settings:configure',
    commandId: 'products.create_category',
    handler: handlePostProductCategories,
  },
  {
    id: 'patch_product_category',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/product-categories\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'products.update_category',
    handler: handlePatchProductCategory,
  },
  {
    id: 'post_products',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/products$/,
    permission: 'settings:configure',
    commandId: 'products.create_item',
    handler: handlePostProducts,
  },
  {
    id: 'patch_product',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/products\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'products.update_item',
    handler: handlePatchProduct,
  },
  {
    id: 'get_operational_config',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/operational-config$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handleGetOperationalConfig,
  },
  {
    id: 'put_operational_config',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/operational-config\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'config.put_operational',
    handler: handlePutOperationalConfig,
  },
  {
    id: 'put_housekeeping_priority',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/priority$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.set_priority',
    handler: handlePutHousekeepingPriority,
  },
  {
    id: 'get_housekeeping_priorities',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/priorities$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetHousekeepingPriorities,
  },
  {
    id: 'post_housekeeping_inventory_item',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/inventory\/items$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.inventory_create_item',
    handler: handlePostHousekeepingInventoryItem,
  },
  {
    id: 'patch_housekeeping_inventory_item',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/inventory\/items\/([^/]+)$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.inventory_update_item',
    handler: handlePatchHousekeepingInventoryItem,
  },
  {
    id: 'post_housekeeping_inventory_adjust',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/inventory\/items\/([^/]+)\/adjust$/,
    permission: 'housekeeping:write',
    commandId: 'housekeeping.inventory_adjust',
    handler: handlePostHousekeepingInventoryAdjust,
  },
  {
    id: 'get_housekeeping_inventory',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/inventory$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetHousekeepingInventory,
  },
  {
    id: 'get_housekeeping_inventory_movements',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/housekeeping\/inventory\/items\/([^/]+)\/movements$/,
    permission: 'housekeeping:read',
    entitlement: 'pms.core',
    handler: handleGetHousekeepingInventoryMovements,
  },
  {
    id: 'put_roster_ops',
    scope: 'property',
    method: 'PUT',
    pattern: /^\/v1\/properties\/([^/]+)\/roster\/([^/]+)\/ops$/,
    permission: 'roster:write',
    commandId: 'roster.set_ops',
    entitlement: 'pms.core',
    handler: handlePutRosterOps,
  },
  {
    id: 'post_maintenance_ticket',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/tickets$/,
    permission: 'maintenance:write',
    commandId: 'maintenance.create_ticket',
    entitlement: 'pms.core',
    handler: handlePostMaintenanceTicket,
  },
  {
    id: 'patch_maintenance_ticket',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/tickets\/([^/]+)$/,
    permission: 'maintenance:write',
    commandId: 'maintenance.update_ticket',
    entitlement: 'pms.core',
    handler: handlePatchMaintenanceTicket,
  },
  {
    id: 'get_maintenance_tickets',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/tickets$/,
    permission: 'maintenance:read',
    entitlement: 'pms.core',
    handler: handleGetMaintenanceTickets,
  },
  {
    id: 'post_maintenance_task_type',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/task-types$/,
    permission: 'settings:configure',
    commandId: 'maintenance.create_task_type',
    entitlement: 'pms.core',
    handler: handlePostMaintenanceTaskType,
  },
  {
    id: 'patch_maintenance_task_type',
    scope: 'property',
    method: 'PATCH',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/task-types\/([^/]+)$/,
    permission: 'settings:configure',
    commandId: 'maintenance.update_task_type',
    entitlement: 'pms.core',
    handler: handlePatchMaintenanceTaskType,
  },
  {
    id: 'get_maintenance_task_types',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/maintenance\/task-types$/,
    permission: 'maintenance:read',
    entitlement: 'pms.core',
    handler: handleGetMaintenanceTaskTypes,
  },
  {
    id: 'get_night_audit_check_log',
    scope: 'property',
    method: 'GET',
    pattern: /^\/v1\/properties\/([^/]+)\/night-audit\/check-log$/,
    permission: 'night_audit:run',
    entitlement: 'pms.core',
    handler: handleGetNightAuditCheckLog,
  },
  {
    id: 'post_reservation_search',
    scope: 'property',
    method: 'POST',
    pattern: /^\/v1\/properties\/([^/]+)\/reservations-search$/,
    permission: 'reservations:read',
    entitlement: 'pms.core',
    handler: handlePostReservationSearch,
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
  ctx.observability.propertyId = propertyId;
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

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

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
  try {
    const { ariVersion, rows } = await resolvedCtx.resolved.stub.readAvailabilityRange(
      fromDate,
      toDate,
      roomTypeId,
    );

    const items = rows.map((row) => ({
      roomTypeId: row.roomTypeId,
      stayDate: row.stayDate,
      physical: row.physical,
      blocked: row.blocked,
      held: row.held,
      sold: row.sold,
      oversell: row.oversell,
      free: row.free ?? freeAvailability(row),
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
    if (!isPropertyDoTransportFailure(e, ctx.env)) throw e;
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
  const feature = entitlementForRoute(route);
  const killSwitchPromise =
    feature != null ? checkKillSwitch(env, feature) : Promise.resolve(false);

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

  const lifecycleKillSwitch =
    (route.id === 'post_org_cancel' || route.id === 'post_org_purge') &&
    (await checkKillSwitch(env, 'pms.core'));

  if ((feature && (await killSwitchPromise)) || lifecycleKillSwitch) {
    return new Response(null, { status: 503 });
  }

  const tenant = await resolveTenant(env, route, match);
  if (tenant instanceof Response) return tenant;
  observability.orgId = tenant.orgId;
  if (tenant.propertyId) observability.propertyId = tenant.propertyId;

  const permissionPromise = requirePermission(
    env,
    tenant.orgId,
    tenant.propertyId,
    actor.userId,
    route.permission,
  );

  if (feature) {
    const [denied, gated] = await Promise.all([
      permissionPromise,
      gateEntitlement(env, tenant.orgId, feature),
    ]);
    if (denied) return denied;
    if (gated) return gated;
  } else {
    const denied = await permissionPromise;
    if (denied) return denied;
  }

  return route.handler({
    request,
    env,
    observability,
    actor,
    url: new URL(request.url),
    match,
    ...(tenant.propertyId ? { tenantProperty: tenant.property } : {}),
  });
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfUnauthorized(message: string): Response {
  return Response.json({ error: 'unauthenticated', message }, { status: 401 });
}

function requireMutatingV1Credential(request: Request, env: PmsEnv): Response | null {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const parties = authorizedParties(env);
  if (parties.length === 0 && env.HOSPAI_UNSAFE_LOCAL === '1') {
    return null;
  }
  if (parties.length === 0) {
    return csrfUnauthorized('Authorized parties not configured.');
  }

  const authorization = request.headers.get('Authorization');
  if (authorization && /^Bearer\s+\S+/i.test(authorization)) {
    return null;
  }

  const origin = request.headers.get('Origin')?.trim();
  if (origin && parties.includes(origin)) {
    return null;
  }

  return csrfUnauthorized(
    'Mutating requests require Bearer authorization or a permitted Origin.',
  );
}

export async function handleV1(
  request: Request,
  env: PmsEnv,
  observability: ObservabilityContext,
): Promise<Response> {
  const secured = (response: Response) => applySecurityHeaders(response, request);
  const url = new URL(request.url);
  const found = findRoute(request.method, url.pathname);
  if (!found) return secured(json({ error: 'not_found' }, 404));

  if (found.route.scope === 'dev') {
    if (!isDevActorAllowed(env) || request.method !== 'POST') {
      return secured(json({ error: 'not_found' }, 404));
    }
  }

  const csrfDenied = requireMutatingV1Credential(request, env);
  if (csrfDenied) return secured(csrfDenied);

  return secured(await dispatchV1(request, env, observability, found.route, found.match));
}
