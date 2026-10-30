import type { DomainEventMessage } from '@hospai/contracts';
import { freeAvailability } from '@hospai/contracts';
import { logInfo, type ObservabilityContext } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import { guestPurgeWorkflowId } from './purge-certificate.js';
import { ensurePurgeWorkflowInstance } from './purge-workflow-create.js';
import { resolvePropertyFromRegistry } from './provision.js';

/**
 * Must remain ≥ idempotency retention when a purge policy exists.
 * Today idempotency rows are never purged; this TTL is advisory dedupe only.
 */
export const DEDUPE_TTL_SEC = 30 * 24 * 60 * 60;

function eventContext(body: DomainEventMessage): ObservabilityContext {
  return {
    moduleId: 'pms.events',
    orgId: body.source.do === 'org' ? body.source.id : undefined,
    propertyId: body.source.do === 'property' ? body.source.id : undefined,
  };
}

function assertRecord(payload: unknown, label: string): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`${label}: payload must be an object`);
  }
  return payload as Record<string, unknown>;
}

function assertStringField(obj: Record<string, unknown>, key: string, eventType: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${eventType}: missing or invalid ${key}`);
  }
  return value;
}

function assertNoPlaintextGuestName(obj: Record<string, unknown>, eventType: string): void {
  for (const key of ['guestName', 'displayName', 'firstName', 'lastName']) {
    if (key in obj) {
      throw new Error(`${eventType}: plaintext guest field "${key}" must not appear in payload`);
    }
  }
}

async function enqueueGuestPurge(env: PmsEnv, payload: Record<string, unknown>): Promise<void> {
  const orgId = assertStringField(payload, 'orgId', 'guest.erased');
  const guestRef = assertStringField(payload, 'guestRef', 'guest.erased');
  const piiKeyId = assertStringField(payload, 'piiKeyId', 'guest.erased');
  const workflowId = guestPurgeWorkflowId(guestRef);
  // get-before-create: only "already exists" is a no-op; real create failures rethrow → queue retry.
  await ensurePurgeWorkflowInstance(env.PURGE_WORKFLOW, {
    id: workflowId,
    params: {
      kind: 'guest',
      workflowId,
      orgId,
      guestRef,
      piiKeyId,
      operatorUserId: null,
      started: Date.now(),
    },
  });
}

/** Phase 0 proof consumer — contract assertions; `guest.erased` enqueues PurgeWorkflow. */
export async function handleDomainEvent(
  message: DomainEventMessage,
  env: PmsEnv,
): Promise<void> {
  const payload = assertRecord(message.payload, message.eventType);

  switch (message.eventType) {
    case 'config.changed': {
      assertStringField(payload, 'key', message.eventType);
      if (typeof payload.version !== 'number') {
        throw new Error('config.changed: missing version');
      }
      break;
    }
    case 'guest.created':
    case 'guest.updated': {
      assertStringField(payload, 'orgId', message.eventType);
      assertStringField(payload, 'guestRef', message.eventType);
      assertStringField(payload, 'piiKeyId', message.eventType);
      assertNoPlaintextGuestName(payload, message.eventType);
      break;
    }
    case 'guest.erased': {
      assertStringField(payload, 'orgId', message.eventType);
      assertStringField(payload, 'guestRef', message.eventType);
      assertStringField(payload, 'piiKeyId', message.eventType);
      assertNoPlaintextGuestName(payload, message.eventType);
      await enqueueGuestPurge(env, payload);
      break;
    }
    case 'reservation.created': {
      assertStringField(payload, 'propertyId', message.eventType);
      assertStringField(payload, 'reservationId', message.eventType);
      assertStringField(payload, 'guestRef', message.eventType);
      assertStringField(payload, 'piiKeyId', message.eventType);
      assertNoPlaintextGuestName(payload, message.eventType);
      break;
    }
    case 'folio.line_posted': {
      assertStringField(payload, 'propertyId', message.eventType);
      assertStringField(payload, 'folioLineId', message.eventType);
      if (typeof payload.amountMinor !== 'number') {
        throw new Error('folio.line_posted: missing amountMinor');
      }
      assertStringField(payload, 'txnCurrency', message.eventType);
      if (typeof payload.ledgerAmountMinor !== 'number') {
        throw new Error('folio.line_posted: missing ledgerAmountMinor');
      }
      assertStringField(payload, 'fxRate', message.eventType);
      if (typeof payload.fxRateAt !== 'number') {
        throw new Error('folio.line_posted: missing fxRateAt');
      }
      break;
    }
    case 'folio.charge_transferred': {
      assertStringField(payload, 'propertyId', message.eventType);
      assertStringField(payload, 'reservationId', message.eventType);
      assertStringField(payload, 'sourceFolioLineId', message.eventType);
      break;
    }
    case 'reservation.front_office_updated':
    case 'folio.balance_due': {
      assertStringField(payload, 'propertyId', message.eventType);
      assertStringField(payload, 'reservationId', message.eventType);
      break;
    }
    case 'availability.changed':
    case 'inventory.room_type_changed':
    case 'reservation.status_changed':
    case 'reservation.modified':
    case 'reservation.room_assigned':
    case 'restriction.changed':
    case 'rate.changed':
    case 'rate_plan.changed':
    case 'rate_promo.changed':
    case 'invoice.generated':
    case 'invoice.voided':
    case 'city_ledger.account_created':
    case 'city_ledger.account_updated':
    case 'city_ledger.account_archived':
    case 'city_ledger.payment_received':
    case 'city_ledger.charge_posted':
    case 'city_ledger.statement_generated':
    case 'charge_code.changed':
    case 'products.changed':
    case 'config.operational_changed':
    case 'folio.routing_rule_changed':
    case 'tax_rule.changed':
    case 'shift.changed':
    case 'room.created':
    case 'room.updated':
    case 'room.archived':
    case 'room.status_changed':
    case 'room.ooo_changed':
    case 'housekeeping.assigned':
    case 'housekeeping.priority_changed':
    case 'night_audit.started':
    case 'night_audit.completed':
    case 'night_audit.step_retried':
    case 'night_audit.halt_resolved':
    case 'provisional.exception_resolved':
    case 'provisional.exception_retried':
    case 'provisional.exception_assigned':
    case 'provisional.exception_noted':
    case 'folio.payment_authorized':
    case 'folio.payment_captured':
    case 'folio.window_opened':
    case 'folio.window_closed':
    case 'folio.window_reopened':
    case 'folio.payment_voided':
    case 'folio.payment_refunded':
    case 'payment.authorized':
    case 'payment.captured':
    case 'payment.refunded':
    case 'payment.failed':
    case 'payment.chargeback_received':
    case 'fx_rate.changed':
    case 'folio.fx_adjusted':
    case 'channel.synced':
    case 'channel.mapping.created':
    case 'property.updated':
    case 'staff.changed':
    case 'roster.created':
    case 'roster.updated':
    case 'roster.exited':
      // Shape pinned in producer tests; presence + deliverability is sufficient for Phase 0.
      // Every COMMAND_CATALOG `events[]` entry must appear here — see events-queue catalog allowlist test.
      break;
    default:
      throw new Error(`unknown event type: ${message.eventType}`);
  }
}

export function logEventConsumed(body: DomainEventMessage): void {
  logInfo(eventContext(body), {
    msg: 'event.consumed',
    event_id: body.eventId,
    event_type: body.eventType,
    source_do: body.source.do,
    source_id: body.source.id,
  });
}

export function logEventDedupeSkip(body: DomainEventMessage): void {
  logInfo(eventContext(body), {
    msg: 'event.dedupe_skip',
    event_id: body.eventId,
    event_type: body.eventType,
    source_do: body.source.do,
    source_id: body.source.id,
  });
}

export const ARI_PROJECTION_TTL_SEC = 60;

export type AriProjectionEntry = {
  physical: number;
  blocked: number;
  held: number;
  sold: number;
  oversell: number;
  free: number;
  ariVersion: number;
  writtenAt: number;
};

/** Compute date string N days after fromDate (ISO YYYY-MM-DD). */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function putBounded(
  kv: KVNamespace,
  entries: Array<{ key: string; value: string }>,
  ttl: number,
  limit = 5,
): Promise<void> {
  for (let i = 0; i < entries.length; i += limit) {
    await Promise.all(
      entries.slice(i, i + limit).map(({ key, value }) =>
        kv.put(key, value, { expirationTtl: ttl }),
      ),
    );
  }
}

export async function handleAvailabilityChanged(
  env: PmsEnv,
  message: DomainEventMessage,
): Promise<void> {
  const payload = assertRecord(message.payload, message.eventType);
  const propertyId = assertStringField(payload, 'propertyId', message.eventType);
  const fromDate = assertStringField(payload, 'fromDate', message.eventType);
  const toDate = assertStringField(payload, 'toDate', message.eventType);
  if (typeof payload['version'] !== 'number') {
    throw new Error('availability.changed: missing version');
  }
  const roomTypeId =
    typeof payload['roomTypeId'] === 'string' ? payload['roomTypeId'] : undefined;

  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (!resolved) {
    throw new Error(`availability.changed: property ${propertyId} not found in registry`);
  }

  // Uniform 90-day booking horizon cap across all events
  const horizonCapDate = addDays(fromDate, 89);
  const effectiveToDate = toDate < horizonCapDate ? toDate : horizonCapDate;

  const { ariVersion: currentAriVersion, rows } =
    await resolved.stub.readAvailabilityRange(fromDate, effectiveToDate, roomTypeId);
  if (rows.length === 0) return;

  const now = Date.now();
  const entries: Array<{ key: string; value: string }> = rows.map((row) => ({
    key: `ari:${propertyId}:${row.roomTypeId}:${row.stayDate}`,
    value: JSON.stringify({
      physical: row.physical,
      blocked: row.blocked,
      held: row.held,
      sold: row.sold,
      oversell: row.oversell,
      free: freeAvailability(row),
      ariVersion: currentAriVersion,
      writtenAt: now,
    } satisfies AriProjectionEntry),
  }));

  await putBounded(env.ARI_KV, entries, ARI_PROJECTION_TTL_SEC, 5);
}
