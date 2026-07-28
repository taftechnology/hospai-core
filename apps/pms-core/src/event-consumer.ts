import type { DomainEventMessage } from '@hospai/contracts';
import { logInfo, type ObservabilityContext } from '@hospai/observability';

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

/** Phase 0 proof consumer — contract assertions only; no DO writes. */
export function handleDomainEvent(message: DomainEventMessage): void {
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
    case 'guest.updated':
    case 'guest.erased': {
      assertStringField(payload, 'orgId', message.eventType);
      assertStringField(payload, 'guestRef', message.eventType);
      assertStringField(payload, 'piiKeyId', message.eventType);
      assertNoPlaintextGuestName(payload, message.eventType);
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
    case 'availability.changed':
    case 'inventory.room_type_changed':
    case 'reservation.status_changed':
    case 'reservation.modified':
    case 'restriction.changed':
    case 'rate.changed':
    case 'night_audit.started':
    case 'night_audit.completed':
      // Shape pinned in producer tests; presence + deliverability is sufficient for Phase 0.
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
