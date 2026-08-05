import type { FeatureKey, Jurisdiction, ProvisionPropertyInput } from '@hospai/contracts';
import {
  ARCHIVE_BLOCKED,
  ALREADY_CANCELLED,
  BUSINESS_DATE_UNSET,
  FORBIDDEN,
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
  UNBOOKABLE,
  fingerprintPayload,
  requireCatalogEntry,
  validateTenantId,
  type Permission,
  type IdempotencyKey,
} from '@hospai/contracts';
import { TYPE_WIDE_RATE_PLAN } from '@hospai/do-runtime';
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
import { isDevActorAllowed, type PmsEnv } from './env.js';
import { OrgDO } from './org-do.js';
import type { PropertyDO } from './property-do.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import { createOrg, getOrg, getProperty } from './registry.js';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
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
    error === NO_SHOW_BEFORE_ARRIVAL
  ) {
    return 422;
  }
  if (error === BUSINESS_DATE_UNSET) return 500;
  return mapAddRoomTypeErrorStatus(error);
}

function requireIdempotencyHeader(request: Request): string | Response {
  const key = request.headers.get('x-idempotency-key');
  if (!key) return json({ error: 'invalid_body' }, 400);
  return key;
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
  | { commandId: string; entitlement?: never }
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
  if ('commandId' in route && route.commandId) {
    return requireCatalogEntry(route.commandId).entitlement;
  }
  if ('entitlement' in route && route.entitlement) {
    return route.entitlement;
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
  return json({ orgId, properties: await org.listPropertyRefs() });
}

async function handleGetProperty(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = resolved.property.orgId;
  const recorded = await resolved.stub.getRecordedJurisdiction();
  return json({
    property: resolved.property,
    locationHint: resolved.locationHint,
    recordedJurisdiction: recorded ?? null,
    schemaVersion: await resolved.stub.getSchemaVersion(),
  });
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

  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;

  const fingerprint = await fingerprintPayload({
    roomTypeId: body.roomTypeId,
    code: body.code,
    name: body.name,
    roomCount: body.roomCount,
    maxOccupancy: body.maxOccupancy,
    maxAdults: body.maxAdults,
  });

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);

  const result = await resolved.stub.tryAddRoomType(
    { kind: 'user', userId: ctx.actor.userId },
    {
      roomTypeId: body.roomTypeId,
      code: body.code,
      name: body.name,
      roomCount: body.roomCount,
      maxOccupancy: body.maxOccupancy,
      maxAdults: body.maxAdults,
    },
    { key: body.idempotencyKey, fingerprint },
  );

  if (!result.ok) {
    if (result.error === 'forbidden') return json({ error: 'forbidden' }, 403);
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

  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;

  const payload: Record<string, unknown> = { roomTypeId };
  if (body.code !== undefined) payload.code = body.code;
  if (body.name !== undefined) payload.name = body.name;
  if (body.roomCount !== undefined) payload.roomCount = body.roomCount;
  if (body.maxOccupancy !== undefined) payload.maxOccupancy = body.maxOccupancy;
  if (body.maxAdults !== undefined) payload.maxAdults = body.maxAdults;

  const fingerprint = await fingerprintPayload(payload);

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);

  const result = await resolved.stub.tryUpdateRoomType(
    { kind: 'user', userId: ctx.actor.userId },
    {
      roomTypeId,
      code: body.code,
      name: body.name,
      roomCount: body.roomCount,
      maxOccupancy: body.maxOccupancy,
      maxAdults: body.maxAdults,
    },
    { key: body.idempotencyKey, fingerprint },
  );

  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) return json({ error: 'forbidden' }, 403);
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

  const property = await getProperty(ctx.env, propertyId);
  if (!property) return json({ error: 'not_found' }, 404);
  ctx.observability.orgId = property.orgId;

  const fingerprint = await fingerprintPayload({ roomTypeId });

  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) return json({ error: 'not_found' }, 404);

  const result = await resolved.stub.tryDeleteRoomType(
    { kind: 'user', userId: ctx.actor.userId },
    { roomTypeId },
    { key: idempotencyKey, fingerprint },
  );

  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    if (result.error === FORBIDDEN) return json({ error: 'forbidden' }, 403);
    if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
    if (result.error === ARCHIVE_BLOCKED) {
      return json({ ok: false, error: result.error }, 409);
    }
    return json({ ok: false, error: result.error }, 422);
  }
  return json(result, 200);
}

async function handlePostReservations(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.propertyId = propertyId;

  const body = (await ctx.request.json()) as {
    reservationId: string;
    roomTypeId: string;
    guestRef: string;
    piiKeyId: string;
    arrivalDate: string;
    departureDate: string;
    idempotencyKey: string;
    quoteAriVersion?: number;
  };
  if (
    !body.reservationId ||
    !body.roomTypeId ||
    !body.guestRef ||
    !body.piiKeyId ||
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
    piiKeyId: body.piiKeyId,
  });

  const result = await resolvedCtx.resolved.stub.tryCreateReservation(
    {
      reservationId: body.reservationId,
      roomTypeId: body.roomTypeId,
      guestRef: body.guestRef,
      piiKeyId: body.piiKeyId,
      arrivalDate: body.arrivalDate,
      departureDate: body.departureDate,
    },
    { key: body.idempotencyKey, fingerprint },
  );

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
    if (err === UNBOOKABLE) {
      const fail = result as { ok: false; error: typeof UNBOOKABLE; date: string };
      return json({ ok: false, error: fail.error, date: fail.date }, 422);
    }
    if (err === NOT_FOUND) return json({ error: 'not_found' }, 404);
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

  const result = await resolvedCtx.resolved.stub.readReservation(reservationId);
  if (!result.ok) {
    if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
    return json({ ok: false, error: result.error }, 422);
  }
  return json(result.reservation, 200);
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
  });

  const result = await resolvedCtx.resolved.stub.tryModifyReservation(
    {
      reservationId,
      roomTypeId: body.roomTypeId,
      arrivalDate: body.arrivalDate,
      departureDate: body.departureDate,
    },
    { key: body.idempotencyKey, fingerprint },
  );

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
  const result = await resolvedCtx.resolved.stub.tryCancelReservation(
    { reservationId },
    { key: body.idempotencyKey, fingerprint },
  );

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

async function handlePostReservationStatusAction(
  ctx: V1DispatchContext,
  reservationId: string,
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
  const result = await action(resolvedCtx.resolved.stub, actor, {
    key: idempotencyKey,
    fingerprint,
  });

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
  return handlePostReservationStatusAction(ctx, reservationId, (stub, actor, idem) =>
    stub.tryCheckIn(actor, { reservationId }, idem),
  );
}

async function handlePostReservationCheckOut(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  return handlePostReservationStatusAction(ctx, reservationId, (stub, actor, idem) =>
    stub.tryCheckOut(actor, { reservationId }, idem),
  );
}

async function handlePostReservationNoShow(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  return handlePostReservationStatusAction(ctx, reservationId, (stub, _actor, idem) =>
    stub.tryNoShow({ reservationId }, idem),
  );
}

async function handlePostReservationCancelCheckIn(ctx: V1DispatchContext): Promise<Response> {
  const reservationId = decodeURIComponent(ctx.match[2]!);
  return handlePostReservationStatusAction(ctx, reservationId, (stub, actor, idem) =>
    stub.tryCancelCheckIn(actor, { reservationId }, idem),
  );
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

  const ratePlanId = body.ratePlanId ?? 'BAR';
  const fingerprint = await fingerprintPayload({
    roomTypeId: body.roomTypeId,
    ratePlanId,
    stayDate: body.stayDate,
    amountMinor: body.amountMinor,
    currency: body.currency,
  });

  const result = await resolvedCtx.resolved.stub.tryUpsertRateDay(
    {
      roomTypeId: body.roomTypeId,
      ratePlanId,
      stayDate: body.stayDate,
      amountMinor: body.amountMinor,
      currency: body.currency,
    },
    { key: body.idempotencyKey, fingerprint },
  );

  if (!result.ok) {
    return json({ ok: false, error: result.error }, mapReservationCommandErrorStatus(result.error));
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

  const result = await resolvedCtx.resolved.stub.tryUpsertRestrictionDay(
    {
      roomTypeId: body.roomTypeId,
      ratePlanId,
      stayDate: body.stayDate,
      minLos: body.minLos ?? null,
      maxLos: body.maxLos ?? null,
      cta: body.cta ?? false,
      ctd: body.ctd ?? false,
      stopSell: body.stopSell ?? false,
    },
    { key: body.idempotencyKey, fingerprint },
  );

  if (!result.ok) {
    return json({ ok: false, error: result.error }, mapReservationCommandErrorStatus(result.error));
  }
  return json(result, 200);
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
