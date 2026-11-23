/**
 * R7.2 §4 — the paging sink. One interface, two wire formats. Everything the sink needs is a
 * secret; with none set the sweep records and logs alerts and sends nothing.
 *
 * Never logs the URL, the routing key or the token.
 */
import { logWarn } from '@hospai/observability';
import type { PmsEnv } from './env.js';

export type AlertSeverity = 'warning' | 'error' | 'critical';

export type AlertEvent = {
  alertKey: string;
  action: 'trigger' | 'resolve';
  severity: AlertSeverity;
  signal: string;
  orgId: string | null;
  propertyId: string | null;
  hotelName: string | null;
  /** Names the hotel: "Night audit halted — Hotel Name (prop_…)". Counts and ages only otherwise. */
  summary: string;
  detail: Record<string, unknown>;
  /** Epoch ms of the sweep. */
  at: number;
};

export interface AlertSink {
  /** True when the sink accepted the event. Never throws. */
  send(event: AlertEvent): Promise<boolean>;
}

export const SINK_TIMEOUT_MS = 5_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Body for PagerDuty Events API v2. `dedup_key` is the alert key, so a re-send is harmless. */
export function pagerDutyBody(event: AlertEvent, routingKey: string): Record<string, unknown> {
  if (event.action === 'resolve') {
    return { routing_key: routingKey, event_action: 'resolve', dedup_key: event.alertKey };
  }
  return {
    routing_key: routingKey,
    event_action: 'trigger',
    dedup_key: event.alertKey,
    payload: {
      summary: event.summary,
      source: event.propertyId ?? 'hospai-pms-core',
      severity: event.severity,
      custom_details: event.detail,
    },
  };
}

export function webhookBody(event: AlertEvent): Record<string, unknown> {
  return {
    alertKey: event.alertKey,
    action: event.action,
    severity: event.severity,
    signal: event.signal,
    orgId: event.orgId,
    propertyId: event.propertyId,
    hotelName: event.hotelName,
    summary: event.summary,
    detail: event.detail,
    at: new Date(event.at).toISOString(),
  };
}

/** `null` means log-only: no URL, a non-https URL, or the secret for the chosen format is missing. */
export function createAlertSink(env: PmsEnv, fetchImpl?: FetchLike): AlertSink | null {
  const url = env.ALERT_SINK_URL;
  if (!url) return null;
  const format = env.ALERT_SINK_FORMAT === 'webhook_json' ? 'webhook_json' : 'pagerduty_v2';
  const routingKey = env.ALERT_ROUTING_KEY;
  const token = env.ALERT_SINK_TOKEN;
  if (format === 'pagerduty_v2' && !routingKey) return null;
  if (format === 'webhook_json' && !token) return null;
  const doFetch: FetchLike = fetchImpl ?? ((u, init) => fetch(u, init));

  return {
    async send(event: AlertEvent): Promise<boolean> {
      if (!isHttps(url)) {
        logWarn({ moduleId: 'pms.core' }, { msg: 'ops.alert_sink_rejected', reason: 'not_https' });
        return false;
      }
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      let body: Record<string, unknown>;
      if (format === 'webhook_json') {
        headers.authorization = `Bearer ${token}`;
        body = webhookBody(event);
      } else {
        body = pagerDutyBody(event, routingKey!);
      }
      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SINK_TIMEOUT_MS),
        });
        if (!res.ok) {
          logWarn(
            { moduleId: 'pms.core', orgId: event.orgId ?? undefined, propertyId: event.propertyId ?? undefined },
            { msg: 'ops.alert_sink_failed', alert_key: event.alertKey, status: res.status },
          );
          return false;
        }
        return true;
      } catch (e) {
        logWarn(
          { moduleId: 'pms.core', orgId: event.orgId ?? undefined, propertyId: event.propertyId ?? undefined },
          {
            msg: 'ops.alert_sink_failed',
            alert_key: event.alertKey,
            error_name: e instanceof Error ? e.name : 'unknown',
          },
        );
        return false;
      }
    },
  };
}

/** GET the external heartbeat monitor. Unset or non-https means skipped. Never throws. */
export async function pingHeartbeat(env: PmsEnv, fetchImpl?: FetchLike): Promise<boolean> {
  const url = env.OPS_HEARTBEAT_URL;
  if (!url || !isHttps(url)) return false;
  const doFetch: FetchLike = fetchImpl ?? ((u, init) => fetch(u, init));
  try {
    const res = await doFetch(url, { method: 'GET', signal: AbortSignal.timeout(SINK_TIMEOUT_MS) });
    return res.ok;
  } catch (e) {
    logWarn(
      { moduleId: 'pms.core' },
      { msg: 'ops.heartbeat_failed', error_name: e instanceof Error ? e.name : 'unknown' },
    );
    return false;
  }
}
