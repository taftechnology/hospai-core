import type { DomainEventMessage, FeatureKey, ModuleConsumerDecl } from '@hospai/contracts';
import { FEATURE_KEYS } from '@hospai/contracts';
import {
  EntitlementRequiredError,
  checkKillSwitch,
  loadSnapshot,
  require as requireEntitlement,
} from '@hospai/entitlement-client';
import { consumerIdempotencyKey } from '@hospai/do-runtime';
import { MODULE_REGISTRY } from '@hospai/kernel';
import { resolveOrgStub } from '@hospai/tenant-router';
import { isOrgDoTransportFailure } from './do-transport-failure.js';
import type { OrgDO } from './org-do.js';
import { logError, logInfo, logWarn, type ObservabilityContext } from '@hospai/observability';
import type { EventRetryMessage, PmsEnv } from './env.js';
import {
  DEDUPE_TTL_SEC,
  assertEventContract,
  handleAvailabilityChanged,
  logEventConsumed,
  logEventDedupeSkip,
  startGuestPurge,
} from './event-consumer.js';
import { archiveBySource, hasEventLogR2 } from './event-log.js';
import { resolvePropertyFromRegistry } from './provision.js';
import { assertTenantActive } from './registry.js';

/** A handler finishes within this or the router treats it as a retryable timeout. */
export const CONSUMER_HANDLER_TIMEOUT_MS = 15_000;

/** First try plus five retries. The exception row records this many tries. */
export const MAX_CONSUMER_ATTEMPTS = 6;

export const CORE_CONSUMERS: ModuleConsumerDecl[] = [
  {
    consumer: 'pms.ari_projection',
    label: 'ARI projection',
    events: ['availability.changed'],
    handler: 'handleAvailabilityChanged',
    entitlement: 'pms.core',
  },
  {
    consumer: 'pms.guest_purge',
    label: 'Guest erasure',
    events: ['guest.erased'],
    handler: 'handleGuestPurge',
    entitlement: null,
    gateExempt: 'legal_duty',
  },
  {
    consumer: 'pms.guest_document_flag',
    label: 'Guest ID on file',
    events: ['guest.document_recorded', 'guest.document_removed'],
    handler: 'handleGuestDocumentFlag',
    entitlement: 'pms.core',
  },
];

export type ConsumerCtx = {
  env: PmsEnv;
  consumerId: string;
  source: DomainEventMessage['source'];
  orgId: string;
  propertyId: string | null;
  /** Dedupe key for any DO write: `consumer:${consumerId}:${eventId}`. */
  idempotencyKey: string;
  observability: ObservabilityContext;
};

export type ConsumerHandler = (ctx: ConsumerCtx, event: DomainEventMessage) => Promise<void>;

/** Throw for a failure a retry cannot fix. It goes straight to the exception row. */
export class ConsumerPermanentError extends Error {
  readonly code: string;
  constructor(code: string, message = code) {
    super(message);
    this.name = 'ConsumerPermanentError';
    this.code = code;
  }
}

async function handleAvailabilityChangedConsumer(
  ctx: ConsumerCtx,
  event: DomainEventMessage,
): Promise<void> {
  await handleAvailabilityChanged(ctx.env, event);
}

async function handleGuestPurge(ctx: ConsumerCtx, event: DomainEventMessage): Promise<void> {
  await startGuestPurge(ctx.env, event);
}

async function handleGuestDocumentFlag(ctx: ConsumerCtx, event: DomainEventMessage): Promise<void> {
  const payload = event.payload;
  if (!payload || typeof payload !== 'object') throw new ConsumerPermanentError('bad_payload');
  const rec = payload as Record<string, unknown>;
  const propertyId = rec.propertyId;
  const guestRef = rec.guestRef;
  const orgId = rec.orgId;
  if (typeof propertyId !== 'string' || typeof guestRef !== 'string' || typeof orgId !== 'string') {
    throw new ConsumerPermanentError('bad_payload');
  }
  if (orgId !== ctx.orgId) throw new ConsumerPermanentError('tenant_mismatch');
  const resolved = await resolvePropertyFromRegistry(ctx.env, propertyId);
  if (!resolved) throw new Error('property_unresolved');
  if (resolved.property.orgId !== orgId) throw new ConsumerPermanentError('tenant_mismatch');
  let hasDocument = false;
  try {
    const org = resolveOrgStub(ctx.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    const gate = await org.checkInIdentityGate({ guestRef, propertyId });
    hasDocument = gate.hasDocument;
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) throw new Error('org_unreachable');
    throw e;
  }
  const result = await resolved.stub.trySetIdDocumentFlag({
    guestRef,
    hasDocument,
    consumerIdempotencyKey: ctx.idempotencyKey,
  });
  if (!result.ok) throw new Error(result.error);
}

/** Static map. Keyed by consumer id. No dynamic import. */
export const CONSUMER_HANDLERS: Record<string, ConsumerHandler> = {
  'pms.ari_projection': handleAvailabilityChangedConsumer,
  'pms.guest_purge': handleGuestPurge,
  'pms.guest_document_flag': handleGuestDocumentFlag,
};

export type ConsumerGateDeps = {
  loadSnapshot: typeof loadSnapshot;
  checkKillSwitch: typeof checkKillSwitch;
  assertTenantActive: typeof assertTenantActive;
  resolvePropertyFromRegistry: typeof resolvePropertyFromRegistry;
};

const defaultDeps: ConsumerGateDeps = {
  loadSnapshot,
  checkKillSwitch,
  assertTenantActive,
  resolvePropertyFromRegistry,
};

export type ConsumerRouterOptions = {
  consumers?: readonly ModuleConsumerDecl[];
  handlers?: Record<string, ConsumerHandler>;
  timeoutMs?: number;
  deps?: Partial<ConsumerGateDeps>;
};

type GateDecision =
  | { kind: 'run'; orgId: string; propertyId: string | null }
  | { kind: 'skip'; reason: 'not_entitled' | 'killed' | 'tenant_inactive' }
  | { kind: 'retry' };

function moduleConsumers(): ModuleConsumerDecl[] {
  const out: ModuleConsumerDecl[] = [];
  for (const manifest of MODULE_REGISTRY) {
    for (const raw of manifest.consumes ?? []) {
      const entitlement =
        raw.entitlement === undefined ? (manifest.entitlement as FeatureKey) : raw.entitlement;
      out.push({ ...raw, entitlement });
    }
  }
  return out;
}

/** Throws on a duplicate id, a missing handler, or a null entitlement without gateExempt. */
export function loadConsumerRegistry(
  decls: readonly ModuleConsumerDecl[],
  handlers: Record<string, ConsumerHandler>,
): ModuleConsumerDecl[] {
  const ids = new Set<string>();
  const resolved: ModuleConsumerDecl[] = [];
  for (const decl of decls) {
    if (ids.has(decl.consumer)) {
      throw new Error(`duplicate consumer id: ${decl.consumer}`);
    }
    ids.add(decl.consumer);
    if (!handlers[decl.consumer]) {
      throw new Error(`missing consumer handler: ${decl.consumer}`);
    }
    const entitlement = decl.entitlement === undefined ? null : decl.entitlement;
    if (entitlement === null && decl.gateExempt !== 'legal_duty') {
      throw new Error(`consumer ${decl.consumer} requires entitlement or gateExempt legal_duty`);
    }
    if (entitlement !== null && !FEATURE_KEYS.includes(entitlement)) {
      throw new Error(`consumer ${decl.consumer} unknown entitlement ${entitlement}`);
    }
    resolved.push({ ...decl, entitlement });
  }
  return resolved;
}

const loadedConsumers = loadConsumerRegistry(
  [...CORE_CONSUMERS, ...moduleConsumers()],
  CONSUMER_HANDLERS,
);

export function consumerRegistry(): ModuleConsumerDecl[] {
  return loadedConsumers;
}

/** 30s, 60s, 120s, 240s, 480s, then 900s. */
export function retryDelaySeconds(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(30 * 2 ** (n - 1), 900);
}

const STAGING_SUFFIX = '-staging';

/** Strip one trailing `-staging` so queue dispatch matches production names. */
export function canonicalQueueName(queue: string): string {
  return queue.endsWith(STAGING_SUFFIX) ? queue.slice(0, -STAGING_SUFFIX.length) : queue;
}

export function clipConsumerDetail(detail: string): string {
  return detail.length <= 500 ? detail : detail.slice(0, 500);
}

function seenEventKey(eventId: string): string {
  return `seen:${eventId}`;
}

function seenConsumerKey(consumerId: string, eventId: string): string {
  return `seen:${consumerId}:${eventId}`;
}

function obsFor(
  event: DomainEventMessage,
  orgId?: string,
  propertyId?: string | null,
): ObservabilityContext {
  return {
    moduleId: 'pms.events',
    ...(orgId ? { orgId } : event.source.do === 'org' ? { orgId: event.source.id } : {}),
    ...(propertyId
      ? { propertyId }
      : event.source.do === 'property'
        ? { propertyId: event.source.id }
        : {}),
  };
}

function failureOf(err: unknown): { retryable: boolean; code: string; detail: string } {
  if (err instanceof ConsumerPermanentError) {
    return { retryable: false, code: err.code || 'permanent', detail: clipConsumerDetail(err.message) };
  }
  if (err instanceof Error && (err as { code?: string }).code === 'timeout') {
    return { retryable: true, code: 'timeout', detail: 'timeout' };
  }
  const detail = err instanceof Error ? err.message : String(err);
  return { retryable: true, code: 'handler_error', detail: clipConsumerDetail(detail) };
}

async function runWithTimeout(
  handler: ConsumerHandler,
  ctx: ConsumerCtx,
  event: DomainEventMessage,
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('timeout');
      (err as { code?: string }).code = 'timeout';
      reject(err);
    }, timeoutMs);
  });
  try {
    await Promise.race([handler(ctx, event), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function locateSource(
  env: PmsEnv,
  event: DomainEventMessage,
  deps: ConsumerGateDeps,
): Promise<GateDecision> {
  if (event.source.do === 'org') {
    return { kind: 'run', orgId: event.source.id, propertyId: null };
  }
  try {
    const resolved = await deps.resolvePropertyFromRegistry(env, event.source.id);
    if (!resolved) return { kind: 'retry' };
    return { kind: 'run', orgId: resolved.property.orgId, propertyId: event.source.id };
  } catch {
    return { kind: 'retry' };
  }
}

async function decideGate(
  env: PmsEnv,
  decl: ModuleConsumerDecl,
  event: DomainEventMessage,
  deps: ConsumerGateDeps,
  cache: Map<string, GateDecision>,
): Promise<GateDecision> {
  const located = await locateSource(env, event, deps);
  if (located.kind !== 'run') return located;
  if (decl.gateExempt === 'legal_duty' || decl.entitlement == null) return located;

  const cacheKey = `${decl.entitlement}:${located.orgId}:${located.propertyId ?? ''}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const decision = await computeGate(env, decl.entitlement, located, deps);
  cache.set(cacheKey, decision);
  return decision;
}

async function computeGate(
  env: PmsEnv,
  feature: FeatureKey,
  located: { orgId: string; propertyId: string | null },
  deps: ConsumerGateDeps,
): Promise<GateDecision> {
  try {
    const tenant = await deps.assertTenantActive(
      env,
      located.propertyId ? { propertyId: located.propertyId } : { orgId: located.orgId },
    );
    if (!tenant.ok) return { kind: 'skip', reason: 'tenant_inactive' };
    try {
      const snap = await deps.loadSnapshot(env, located.orgId);
      requireEntitlement(snap, feature);
    } catch (e) {
      if (e instanceof EntitlementRequiredError) return { kind: 'skip', reason: 'not_entitled' };
      return { kind: 'retry' };
    }
    try {
      const killed = await deps.checkKillSwitch(env, feature);
      if (killed) return { kind: 'skip', reason: 'killed' };
    } catch {
      return { kind: 'retry' };
    }
    return { kind: 'run', orgId: located.orgId, propertyId: located.propertyId };
  } catch {
    return { kind: 'retry' };
  }
}

async function putSeen(env: PmsEnv, key: string): Promise<void> {
  await env.EVENT_DEDUPE_KV.put(key, '1', { expirationTtl: DEDUPE_TTL_SEC });
}

async function recordOnProperty(
  env: PmsEnv,
  propertyId: string,
  input: {
    consumerId: string;
    event: DomainEventMessage;
    errorCode: string;
    errorDetail: string;
    attempts: number;
    firstFailedAt: number;
  },
  deps: ConsumerGateDeps,
): Promise<'ok' | 'retry'> {
  try {
    const resolved = await deps.resolvePropertyFromRegistry(env, propertyId);
    if (!resolved) return 'retry';
    await resolved.stub.recordConsumerException({
      consumerId: input.consumerId,
      event: input.event,
      errorCode: input.errorCode,
      errorDetail: clipConsumerDetail(input.errorDetail),
      attempts: input.attempts,
      firstFailedAt: input.firstFailedAt,
    });
    return 'ok';
  } catch {
    return 'retry';
  }
}

function handlersFor(opts?: ConsumerRouterOptions): Record<string, ConsumerHandler> {
  return opts?.handlers ? { ...CONSUMER_HANDLERS, ...opts.handlers } : CONSUMER_HANDLERS;
}

function consumersFor(opts?: ConsumerRouterOptions): readonly ModuleConsumerDecl[] {
  return opts?.consumers ?? consumerRegistry();
}

function depsFor(opts?: ConsumerRouterOptions): ConsumerGateDeps {
  return { ...defaultDeps, ...opts?.deps };
}

async function runConsumer(
  env: PmsEnv,
  decl: ModuleConsumerDecl,
  event: DomainEventMessage,
  handlers: Record<string, ConsumerHandler>,
  deps: ConsumerGateDeps,
  cache: Map<string, GateDecision>,
  timeoutMs: number,
  ignoreSeen: boolean,
): Promise<
  | { kind: 'ok' }
  | { kind: 'retry_queue'; failure: { code: string; detail: string } }
  | { kind: 'handoff_failed' }
> {
  const seenKey = seenConsumerKey(decl.consumer, event.eventId);
  if (!ignoreSeen && (await env.EVENT_DEDUPE_KV.get(seenKey))) return { kind: 'ok' };

  const gate = await decideGate(env, decl, event, deps, cache);
  const ctxObs = obsFor(
    event,
    gate.kind === 'run' ? gate.orgId : undefined,
    gate.kind === 'run' ? gate.propertyId : undefined,
  );
  if (gate.kind === 'skip') {
    await putSeen(env, seenKey);
    logInfo(ctxObs, {
      msg: 'consumer.skipped',
      reason: gate.reason,
      consumer_id: decl.consumer,
      event_id: event.eventId,
      event_type: event.eventType,
    });
    return { kind: 'ok' };
  }
  if (gate.kind === 'retry') {
    logWarn(ctxObs, {
      msg: 'consumer.failed',
      reason: 'gate_unresolved',
      consumer_id: decl.consumer,
      event_id: event.eventId,
      event_type: event.eventType,
    });
    return { kind: 'retry_queue', failure: { code: 'gate_unresolved', detail: 'gate_unresolved' } };
  }

  const handler = handlers[decl.consumer];
  if (!handler) {
    logInfo(ctxObs, {
      msg: 'consumer.retired',
      consumer_id: decl.consumer,
      event_id: event.eventId,
    });
    return { kind: 'ok' };
  }
  const ctx: ConsumerCtx = {
    env,
    consumerId: decl.consumer,
    source: event.source,
    orgId: gate.orgId,
    propertyId: gate.propertyId,
    idempotencyKey: consumerIdempotencyKey(decl.consumer, event.eventId),
    observability: ctxObs,
  };
  try {
    await runWithTimeout(handler, ctx, event, timeoutMs);
    await putSeen(env, seenKey);
    logInfo(ctxObs, {
      msg: 'consumer.ok',
      consumer_id: decl.consumer,
      event_id: event.eventId,
      event_type: event.eventType,
    });
    return { kind: 'ok' };
  } catch (err) {
    const failure = failureOf(err);
    if (!failure.retryable) {
      const recorded = await deadLetter(env, decl.consumer, event, failure, 1, Date.now(), deps);
      if (recorded === 'retry') return { kind: 'handoff_failed' };
      return { kind: 'ok' };
    }
    logWarn(ctxObs, {
      msg: 'consumer.failed',
      consumer_id: decl.consumer,
      event_id: event.eventId,
      event_type: event.eventType,
      error_code: failure.code,
    });
    return { kind: 'retry_queue', failure };
  }
}

async function deadLetter(
  env: PmsEnv,
  consumerId: string,
  event: DomainEventMessage,
  failure: { code: string; detail: string },
  attempts: number,
  firstFailedAt: number,
  deps: ConsumerGateDeps,
): Promise<'ok' | 'retry'> {
  const ctx = obsFor(event);
  if (event.source.do !== 'property') {
    logError(ctx, {
      msg: 'consumer.dead_letter',
      consumer_id: consumerId,
      event_id: event.eventId,
      event_type: event.eventType,
      org_id: event.source.id,
      error_code: failure.code,
    });
    return 'ok';
  }
  const recorded = await recordOnProperty(
    env,
    event.source.id,
    { consumerId, event, errorCode: failure.code, errorDetail: failure.detail, attempts, firstFailedAt },
    deps,
  );
  if (recorded === 'retry') return 'retry';
  logError(ctx, {
    msg: 'consumer.dead_letter',
    consumer_id: consumerId,
    event_id: event.eventId,
    event_type: event.eventType,
    property_id: event.source.id,
    error_code: failure.code,
  });
  return 'ok';
}

async function enqueueRetry(
  env: PmsEnv,
  consumerId: string,
  event: DomainEventMessage,
  attempt: number,
  firstFailedAt: number,
  lastErrorCode: string,
  lastErrorDetail: string,
): Promise<'ok' | 'failed'> {
  try {
    await env.EVENT_RETRY_QUEUE.send(
      {
        consumerId,
        event,
        attempt,
        firstFailedAt,
        lastErrorCode,
        lastErrorDetail: clipConsumerDetail(lastErrorDetail),
      },
      { delaySeconds: retryDelaySeconds(attempt) },
    );
    return 'ok';
  } catch {
    return 'failed';
  }
}

async function deliverRetryRequested(
  env: PmsEnv,
  outer: DomainEventMessage,
  opts: ConsumerRouterOptions | undefined,
  cache: Map<string, GateDecision>,
): Promise<'ok' | 'retry_message'> {
  const payload = outer.payload as {
    propertyId?: string;
    consumerId?: string;
    event?: DomainEventMessage;
  };
  const consumerId = payload.consumerId;
  const inner = payload.event;
  if (!consumerId || !inner || typeof inner.eventId !== 'string') return 'retry_message';
  const consumers = consumersFor(opts);
  const handlers = handlersFor(opts);
  const deps = depsFor(opts);
  const timeoutMs = opts?.timeoutMs ?? CONSUMER_HANDLER_TIMEOUT_MS;
  const decl = consumers.find((c) => c.consumer === consumerId);
  if (!decl || !handlers[consumerId]) {
    logInfo(obsFor(outer), {
      msg: 'consumer.retired',
      consumer_id: consumerId,
      event_id: inner.eventId,
    });
    return 'ok';
  }
  const outcome = await runConsumer(env, decl, inner, handlers, deps, cache, timeoutMs, true);
  if (outcome.kind === 'ok') return 'ok';
  if (outcome.kind === 'handoff_failed') return 'retry_message';
  const sent = await enqueueRetry(
    env,
    consumerId,
    inner,
    1,
    Date.now(),
    outcome.failure.code,
    outcome.failure.detail,
  );
  return sent === 'ok' ? 'ok' : 'retry_message';
}

async function fanOut(
  env: PmsEnv,
  event: DomainEventMessage,
  opts: ConsumerRouterOptions | undefined,
  cache: Map<string, GateDecision>,
): Promise<'ok' | 'retry_message'> {
  const consumers = consumersFor(opts).filter((c) => c.events.includes(event.eventType));
  const handlers = handlersFor(opts);
  const deps = depsFor(opts);
  const timeoutMs = opts?.timeoutMs ?? CONSUMER_HANDLER_TIMEOUT_MS;
  const firstFailedAt = Date.now();
  for (const decl of consumers) {
    const outcome = await runConsumer(env, decl, event, handlers, deps, cache, timeoutMs, false);
    if (outcome.kind === 'ok') continue;
    if (outcome.kind === 'handoff_failed') return 'retry_message';
    const sent = await enqueueRetry(
      env,
      decl.consumer,
      event,
      1,
      firstFailedAt,
      outcome.failure.code,
      outcome.failure.detail,
    );
    if (sent === 'failed') return 'retry_message';
  }
  return 'ok';
}

export async function handleEventsBatch(
  batch: MessageBatch<DomainEventMessage>,
  env: PmsEnv,
  opts?: ConsumerRouterOptions,
): Promise<void> {
  const ready: (typeof batch.messages)[number][] = [];
  for (const msg of batch.messages) {
    try {
      await assertEventContract(msg.body);
    } catch {
      msg.retry();
      continue;
    }
    if (await env.EVENT_DEDUPE_KV.get(seenEventKey(msg.body.eventId))) {
      logEventDedupeSkip(msg.body);
      msg.ack();
      continue;
    }
    ready.push(msg);
  }
  if (ready.length === 0) return;

  if (!hasEventLogR2(env) || !env.EVENT_LOG_R2) {
    logWarn({ moduleId: 'pms.events' }, {
      msg: 'event_log.r2_unbound',
      survivorCount: ready.length,
    });
    for (const msg of ready) msg.ack();
    return;
  }

  const { ok } = await archiveBySource(
    env.EVENT_LOG_R2,
    ready.map((m) => m.body),
  );
  const okIds = new Set(ok.map((m) => m.eventId));
  const cache = new Map<string, GateDecision>();
  for (const msg of ready) {
    if (!okIds.has(msg.body.eventId)) {
      msg.retry();
      continue;
    }
    const body = msg.body;
    const outcome =
      body.eventType === 'event_consumer.retry_requested'
        ? await deliverRetryRequested(env, body, opts, cache)
        : await fanOut(env, body, opts, cache);
    if (outcome === 'retry_message') {
      msg.retry();
      continue;
    }
    logEventConsumed(body);
    await putSeen(env, seenEventKey(body.eventId));
    msg.ack();
  }
}

export async function handleEventRetryBatch(
  batch: MessageBatch<EventRetryMessage>,
  env: PmsEnv,
  opts?: ConsumerRouterOptions,
): Promise<void> {
  const consumers = consumersFor(opts);
  const handlers = handlersFor(opts);
  const deps = depsFor(opts);
  const timeoutMs = opts?.timeoutMs ?? CONSUMER_HANDLER_TIMEOUT_MS;
  const cache = new Map<string, GateDecision>();
  for (const msg of batch.messages) {
    const body = msg.body;
    const event = body.event;
    const decl = consumers.find((c) => c.consumer === body.consumerId);
    if (!decl || !handlers[body.consumerId]) {
      logInfo(obsFor(event), {
        msg: 'consumer.retired',
        consumer_id: body.consumerId,
        event_id: event?.eventId,
      });
      msg.ack();
      continue;
    }
    if (await env.EVENT_DEDUPE_KV.get(seenConsumerKey(decl.consumer, event.eventId))) {
      msg.ack();
      continue;
    }
    const outcome = await runConsumer(env, decl, event, handlers, deps, cache, timeoutMs, false);
    if (outcome.kind === 'ok') {
      msg.ack();
      continue;
    }
    if (outcome.kind === 'handoff_failed') {
      msg.retry();
      continue;
    }
    const attempt = body.attempt > 0 ? body.attempt : 1;
    const thisTry = attempt + 1;
    const firstFailedAt = body.firstFailedAt > 0 ? body.firstFailedAt : Date.now();
    if (thisTry >= MAX_CONSUMER_ATTEMPTS) {
      const recorded = await deadLetter(
        env,
        decl.consumer,
        event,
        outcome.failure,
        thisTry,
        firstFailedAt,
        deps,
      );
      if (recorded === 'retry') {
        msg.retry();
        continue;
      }
      msg.ack();
      continue;
    }
    const sent = await enqueueRetry(
      env,
      decl.consumer,
      event,
      thisTry,
      firstFailedAt,
      outcome.failure.code,
      outcome.failure.detail,
    );
    if (sent === 'failed') {
      msg.retry();
      continue;
    }
    msg.ack();
  }
}

export async function handleEventRetryDlqBatch(
  batch: MessageBatch<EventRetryMessage>,
  env: PmsEnv,
  opts?: ConsumerRouterOptions,
): Promise<void> {
  const deps = depsFor(opts);
  for (const msg of batch.messages) {
    const body = msg.body;
    const event = body.event;
    if (!event || event.source?.do === 'org') {
      logError(obsFor(event ?? { source: { do: 'org', id: '' } } as DomainEventMessage), {
        msg: 'consumer.dead_letter',
        consumer_id: body.consumerId,
        event_id: event?.eventId,
        org_id: event?.source?.id,
      });
      msg.ack();
      continue;
    }
    const recorded = await recordOnProperty(
      env,
      event.source.id,
      {
        consumerId: body.consumerId,
        event,
        errorCode: body.lastErrorCode || 'handler_error',
        errorDetail: body.lastErrorDetail || 'dead_letter',
        // `attempt` is tries already made. A missing value counts as one try.
        attempts: body.attempt > 0 ? body.attempt : 1,
        firstFailedAt: body.firstFailedAt || Date.now(),
      },
      deps,
    );
    if (recorded === 'retry') {
      msg.retry();
      continue;
    }
    logError(obsFor(event), {
      msg: 'consumer.dead_letter',
      consumer_id: body.consumerId,
      event_id: event.eventId,
      property_id: event.source.id,
    });
    msg.ack();
  }
}
