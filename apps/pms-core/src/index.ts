import type { DomainEventMessage, PendingCommandMessage } from '@hospai/contracts';
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
import { handlePendingCommandsBatch } from './pending-commands-consumer.js';
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

    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
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

    try {
      if (!env.ASSETS) {
        logError(
          { moduleId: 'pms.core', requestId: crypto.randomUUID() },
          { msg: 'assets.missing', pathname },
        );
        return json({ error: 'not_found' }, 404);
      }

      let assetRes = await env.ASSETS.fetch(request);
      // SPA fallback when binding does not rewrite client routes (hard refresh on /arrivals).
      if (
        assetRes.status === 404 &&
        request.method === 'GET' &&
        !pathname.includes('.')
      ) {
        assetRes = await env.ASSETS.fetch(
          new Request(new URL('/index.html', request.url), request),
        );
      }

      const contentType = assetRes.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        const headers = new Headers(assetRes.headers);
        headers.set('cache-control', 'no-cache');
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers,
        });
      }
      if (pathname.includes('/assets/') || /\.[a-f0-9]{8,}\./i.test(pathname)) {
        const headers = new Headers(assetRes.headers);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers,
        });
      }
      return assetRes;
    } catch (e) {
      logError(
        { moduleId: 'pms.core', requestId: crypto.randomUUID() },
        {
          msg: 'assets.fetch_failed',
          pathname,
          error: e instanceof Error ? e.message : String(e),
        },
      );
      throw e;
    }
  },

  async queue(batch: MessageBatch<unknown>, env: PmsEnv): Promise<void> {
    if (batch.queue === 'hospai-pending-commands') {
      await handlePendingCommandsBatch(batch as MessageBatch<PendingCommandMessage>, env);
      return;
    }

    const eventBatch = batch as MessageBatch<DomainEventMessage>;
    for (const msg of eventBatch.messages) {
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
