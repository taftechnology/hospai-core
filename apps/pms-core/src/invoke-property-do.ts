import { requireCatalogEntry, type ProvisionalCommand, type RouteId } from '@hospai/contracts';
import { businessDateForInstant } from '@hospai/pms-inventory';
import { logError, type ObservabilityContext } from '@hospai/observability';
import type { PmsEnv } from './env.js';
import { isPropertyDoTransportFailure } from './property-do-transport.js';
import { enqueueProvisionalCommand } from './provisional-queue.js';

const DEGRADED_RETRY_AFTER_SEC = 30;

function json(data: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

export async function invokePropertyDo<T extends { ok: boolean }>(opts: {
  env: PmsEnv;
  commandId: string;
  routeId: RouteId;
  orgId: string;
  propertyId: string;
  timeZone: string;
  actorUserId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  commandPayload: unknown;
  invoke: () => Promise<T>;
  observability?: ObservabilityContext;
}): Promise<{ kind: 'ok'; result: T } | { kind: 'response'; response: Response }> {
  try {
    const result = await opts.invoke();
    return { kind: 'ok', result };
  } catch (e) {
    if (!isPropertyDoTransportFailure(e)) {
      if (opts.observability) {
        logError(opts.observability, {
          msg: 'property_do.invoke_error',
          commandId: opts.commandId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return {
        kind: 'response',
        response: json({ error: 'internal_error' }, 500),
      };
    }

    const entry = requireCatalogEntry(opts.commandId);
    switch (entry.degraded) {
      case 'QUEUE_PROVISIONAL': {
        const issuedAt = new Date().toISOString();
        const businessDate = businessDateForInstant(opts.timeZone, new Date(issuedAt));
        const cmd: ProvisionalCommand = {
          idempotencyKey: opts.idempotencyKey,
          requestFingerprint: opts.requestFingerprint,
          propertyId: opts.propertyId,
          orgId: opts.orgId,
          issuedAt,
          businessDate,
          actor: { userId: opts.actorUserId },
          command: { type: opts.commandId, payload: opts.commandPayload },
          routeId: opts.routeId,
        };
        try {
          await enqueueProvisionalCommand(opts.env, cmd, opts.observability);
        } catch (sendErr) {
          if (opts.observability) {
            logError(opts.observability, {
              msg: 'degraded.enqueue_failed',
              commandId: opts.commandId,
              error: sendErr instanceof Error ? sendErr.message : String(sendErr),
            });
          }
          return {
            kind: 'response',
            response: json({ error: 'queue_unavailable' }, 503),
          };
        }
        return {
          kind: 'response',
          response: json(
            {
              ok: true,
              provisional: true,
              commandId: opts.commandId,
              idempotencyKey: opts.idempotencyKey,
              issuedAt,
              businessDate,
            },
            202,
          ),
        };
      }
      case 'FAIL_CLOSED': {
        const reason =
          entry.notes ??
          `Command ${opts.commandId} refuses service while the property is unreachable.`;
        return {
          kind: 'response',
          response: json(
            {
              error: 'property_unreachable',
              degraded: 'FAIL_CLOSED',
              commandId: opts.commandId,
              reason,
            },
            503,
            { 'Retry-After': String(DEGRADED_RETRY_AFTER_SEC) },
          ),
        };
      }
      default:
        return {
          kind: 'response',
          response: json({ error: 'catalog_misconfigured', commandId: opts.commandId }, 500),
        };
    }
  }
}

export function degradedReadStaleResponse(retryAfterSec = DEGRADED_RETRY_AFTER_SEC): Response {
  return json(
    { error: 'property_unreachable', degraded: 'READ_STALE' },
    503,
    { 'Retry-After': String(retryAfterSec) },
  );
}

export function degradedFailClosedReadResponse(retryAfterSec = DEGRADED_RETRY_AFTER_SEC): Response {
  return json(
    { error: 'property_unreachable', degraded: 'FAIL_CLOSED' },
    503,
    { 'Retry-After': String(retryAfterSec) },
  );
}

export function degradedFailClosedOrgReadResponse(retryAfterSec = DEGRADED_RETRY_AFTER_SEC): Response {
  return json(
    { error: 'org_unreachable', degraded: 'FAIL_CLOSED' },
    503,
    { 'Retry-After': String(retryAfterSec) },
  );
}
