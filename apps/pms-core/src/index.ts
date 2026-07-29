import type { DomainEventMessage } from '@hospai/contracts';
import { logError, logInfo, type ObservabilityContext } from '@hospai/observability';
import {
  assertEnvSafeForRequest,
  type PmsEnv,
} from './env.js';
import { OrgEntitlementDO } from './org-entitlement-do.js';
import { OrgDO } from './org-do.js';
import { PropertyDO } from './property-do.js';
import { NightAuditWorkflow } from './night-audit-workflow.js';
import { MigrationSweepWorkflow } from './migration-sweep-workflow.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import {
  DEDUPE_TTL_SEC,
  handleAvailabilityChanged,
  handleDomainEvent,
  logEventConsumed,
  logEventDedupeSkip,
} from './event-consumer.js';
import { handleV1 } from './v1-handler.js';

export type { PmsEnv } from './env.js';
export { PropertyDO } from './property-do.js';
export { OrgDO } from './org-do.js';
export { OrgEntitlementDO } from './org-entitlement-do.js';
export { NightAuditWorkflow } from './night-audit-workflow.js';
export { MigrationSweepWorkflow } from './migration-sweep-workflow.js';
export { provisionProperty, resolvePropertyFromRegistry } from './provision.js';

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function logHttpRequest(
  ctx: ObservabilityContext,
  request: Request,
  status: number,
  started: number,
  extra?: Record<string, unknown>,
): void {
  const url = new URL(request.url);
  logInfo(ctx, {
    msg: 'http.request',
    method: request.method,
    pathname: url.pathname,
    status,
    duration_ms: Date.now() - started,
    ...extra,
  });
}

export default {
  async fetch(request: Request, env: PmsEnv): Promise<Response> {
    const misconfigured = assertEnvSafeForRequest(env);
    if (misconfigured) return misconfigured;

    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'GET' && pathname === '/') {
      return new Response('hospai-pms-core', { status: 200 });
    }

    if (pathname.startsWith('/v1/')) {
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const ctx: ObservabilityContext = { moduleId: 'pms.core', requestId };

      try {
        const response = await handleV1(request, env, ctx);
        logHttpRequest(ctx, request, response.status, started);
        return response;
      } catch (e) {
        logError(ctx, {
          msg: 'http.request',
          method: request.method,
          pathname,
          status: 500,
          duration_ms: Date.now() - started,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    }

    return json({ error: 'not_found' }, 404);
  },

  async queue(batch: MessageBatch<DomainEventMessage>, env: PmsEnv): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body;
      if (await env.EVENT_DEDUPE_KV.get(`seen:${body.eventId}`)) {
        logEventDedupeSkip(body);
        msg.ack();
        continue;
      }
      if (body.eventType === 'availability.changed') {
        try {
          await handleAvailabilityChanged(env, body);
        } catch {
          msg.retry();
          continue;
        }
      }
      try {
        handleDomainEvent(body);
      } catch {
        msg.retry();
        continue;
      }
      logEventConsumed(body);
      await env.EVENT_DEDUPE_KV.put(`seen:${body.eventId}`, '1', { expirationTtl: DEDUPE_TTL_SEC });
      msg.ack();
    }
  },
};
