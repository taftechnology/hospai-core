/** Runtime source of truth — union and shouldRetry coverage both derive from this. */
export const CLIENT_RESULT_CLASSES = [
  'live',
  'provisional',
  'fail_closed',
  'read_stale',
  'queue_unavailable',
  'entitlement_required',
  'unauthorized',
  'forbidden',
  'not_configured',
  'idempotency_key_reused',
  'shift_not_open',
  'shift_already_open',
  'client_error',
  'server_error',
] as const;

export type ClientResultClass = (typeof CLIENT_RESULT_CLASSES)[number];

export type ClassifiedResponse = {
  class: ClientResultClass;
  status: number;
  body: unknown;
  retryAfterMs: number | null;
};

function asRecord(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
}

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (raw === null || raw === '') return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round(seconds * 1000);
}

export function classifyResponse(res: {
  status: number;
  headers: Headers;
  body: unknown;
}): ClassifiedResponse {
  const { status, headers, body } = res;
  const record = asRecord(body);
  const retryAfterMs = parseRetryAfterMs(headers);

  if (status === 401) {
    return { class: 'unauthorized', status, body, retryAfterMs: null };
  }
  if (status === 402) {
    return { class: 'entitlement_required', status, body, retryAfterMs: null };
  }
  if (status === 403) {
    return { class: 'forbidden', status, body, retryAfterMs: null };
  }
  if (status === 202) {
    const provisional = record?.provisional === true || record?.ok === true;
    if (provisional || record?.commandId != null) {
      return { class: 'provisional', status, body, retryAfterMs: null };
    }
    return { class: 'live', status, body, retryAfterMs: null };
  }
  if (status >= 200 && status < 300) {
    return { class: 'live', status, body, retryAfterMs: null };
  }
  if (status === 503) {
    if (record?.error === 'queue_unavailable') {
      return { class: 'queue_unavailable', status, body, retryAfterMs: null };
    }
    if (record?.degraded === 'FAIL_CLOSED') {
      return { class: 'fail_closed', status, body, retryAfterMs: null };
    }
    if (record?.degraded === 'READ_STALE') {
      return { class: 'read_stale', status, body, retryAfterMs };
    }
    return { class: 'server_error', status, body, retryAfterMs: null };
  }
  if (status === 409 && record?.error === 'idempotency_key_reused') {
    return { class: 'idempotency_key_reused', status, body, retryAfterMs: null };
  }
  if (status === 501 && record?.error === 'psp_unavailable') {
    return { class: 'not_configured', status, body, retryAfterMs: null };
  }
  if (status === 422 && record?.error === 'shift_not_open') {
    return { class: 'shift_not_open', status, body, retryAfterMs: null };
  }
  if (status === 422 && record?.error === 'shift_already_open') {
    return { class: 'shift_already_open', status, body, retryAfterMs: null };
  }
  if (status >= 400 && status < 500) {
    return { class: 'client_error', status, body, retryAfterMs: null };
  }
  if (status >= 500) {
    return { class: 'server_error', status, body, retryAfterMs: null };
  }
  return { class: 'server_error', status, body, retryAfterMs: null };
}

export function shouldRetry(c: ClassifiedResponse): boolean {
  return c.class === 'read_stale';
}

export function retryDelay(c: ClassifiedResponse, _attempt: number): number {
  if (c.class === 'read_stale') {
    return c.retryAfterMs ?? 0;
  }
  return 0;
}
