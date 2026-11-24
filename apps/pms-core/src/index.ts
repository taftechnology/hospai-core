import type { PendingCommandMessage } from '@hospai/contracts';
import { logError, logInfo, type ObservabilityContext } from '@hospai/observability';
import {
  assertEnvSafeForRequest,
  type EventRetryMessage,
  type PmsEnv,
} from './env.js';
import { OrgEntitlementDO } from './org-entitlement-do.js';
import { OrgDO } from './org-do.js';
import { PropertyDO } from './property-do.js';
import { NightAuditWorkflow } from './night-audit-workflow.js';
import { MigrationSweepWorkflow } from './migration-sweep-workflow.js';
import { PurgeWorkflow } from './purge-workflow.js';
import { provisionProperty, resolvePropertyFromRegistry } from './provision.js';
import {
  canonicalQueueName,
  handleEventRetryBatch,
  handleEventRetryDlqBatch,
  handleEventsBatch,
} from './event-consumers.js';
import { handlePendingCommandsBatch } from './pending-commands-consumer.js';
import { handleV1 } from './v1-handler.js';
import { applySecurityHeaders } from './security-headers.js';
import { runOpsHealthSweep } from './ops-health-sweep.js';

export type { PmsEnv } from './env.js';
export { PropertyDO } from './property-do.js';
export { OrgDO } from './org-do.js';
export { OrgEntitlementDO } from './org-entitlement-do.js';
export { NightAuditWorkflow } from './night-audit-workflow.js';
export { MigrationSweepWorkflow } from './migration-sweep-workflow.js';
export { PurgeWorkflow } from './purge-workflow.js';
export { runOpsHealthSweep } from './ops-health-sweep.js';
// R7.1: the Ops Console's service-binding entrypoint. Not reachable from fetch().
export { OpsEntrypoint } from './ops-entrypoint.js';
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
  // 5xx at error level so Workers Issues sees a returned 503 as well as a thrown one (R7.2 §5.1).
  // `pathname` only: the query string can carry a guest name (`?q=`).
  const emit = status >= 500 ? logError : logInfo;
  emit(ctx, {
    msg: 'http.request',
    method: request.method,
    pathname: url.pathname,
    status,
    duration_ms: Date.now() - started,
    ...extra,
  });
}

async function handleHealth(request: Request, env: PmsEnv): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return applySecurityHeaders(json({ error: 'method_not_allowed' }, 405), request);
  }
  let ok = true;
  try {
    await env.PLATFORM_DB.prepare('SELECT 1').first();
  } catch {
    ok = false;
  }
  const res = Response.json({ ok }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
  return applySecurityHeaders(res, request);
}

export default {
  async fetch(request: Request, env: PmsEnv): Promise<Response> {
    const misconfigured = assertEnvSafeForRequest(env, request);
    if (misconfigured) return misconfigured;

    const url = new URL(request.url);
    const { pathname } = url;

    // Uptime check (R7.2 §6): public, no tenant data, platform D1 reachability only.
    if (pathname === '/health') {
      return handleHealth(request, env);
    }

    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const ctx: ObservabilityContext = { moduleId: 'pms.core', requestId };

      try {
        const response = await handleV1(request, env, ctx);
        logHttpRequest(ctx, request, response.status, started);
        return response;
      } catch (e) {
        if (e instanceof SyntaxError) {
          const response = applySecurityHeaders(json({ error: 'invalid_json' }, 400), request);
          logHttpRequest(ctx, request, 400, started);
          return response;
        }
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
        return applySecurityHeaders(json({ error: 'not_found' }, 404), request);
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
        return applySecurityHeaders(
          new Response(assetRes.body, {
            status: assetRes.status,
            statusText: assetRes.statusText,
            headers,
          }),
          request,
        );
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

  // Cron trigger every 5 minutes (staging and production only): the R7.2 health sweep.
  async scheduled(_controller: ScheduledController, env: PmsEnv): Promise<void> {
    await runOpsHealthSweep(env, Date.now());
  },

  async queue(batch: MessageBatch<unknown>, env: PmsEnv): Promise<void> {
    const queueName = canonicalQueueName(batch.queue);
    if (queueName === 'hospai-pending-commands') {
      await handlePendingCommandsBatch(batch as MessageBatch<PendingCommandMessage>, env);
      return;
    }
    if (queueName === 'hospai-event-retries') {
      await handleEventRetryBatch(batch as MessageBatch<EventRetryMessage>, env);
      return;
    }
    if (queueName === 'hospai-event-retries-dlq') {
      await handleEventRetryDlqBatch(batch as MessageBatch<EventRetryMessage>, env);
      return;
    }
    await handleEventsBatch(batch as MessageBatch<import('@hospai/contracts').DomainEventMessage>, env);
  },
};
