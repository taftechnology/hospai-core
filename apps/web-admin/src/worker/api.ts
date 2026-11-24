/**
 * The thin /api layer. Every route is a pass-through to one `OpsEntrypoint` method: the entrypoint
 * decides authorization (viewer reads, admin writes) and validates the payload. This file parses
 * once, picks only known fields, and maps `{ ok: false, status }` to an HTTP status.
 */
import { OPS_PAGE_SIZE, OPS_ROLES, OPERATOR_STATUSES, type OpsFailure, type OpsRole, type OperatorStatus, type Jurisdiction } from '@hospai/contracts';
import { authenticateOperator } from './auth.js';
import type { AdminEnv, PmsOpsBinding, WriteBase } from './env.js';

const JSON_HEADERS = { 'cache-control': 'no-store' } as const;
/** Largest request body we parse. Every write body is a handful of short strings. */
export const MAX_BODY_BYTES = 16 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

function failure(f: OpsFailure): Response {
  return json(
    { error: f.error, ...(f.detail ? { detail: f.detail } : {}), ...(f.featureKey ? { featureKey: f.featureKey } : {}) },
    f.status,
  );
}

function respond<T extends { ok: boolean }>(result: T | OpsFailure): Response {
  return result.ok ? json(result) : failure(result as OpsFailure);
}

const isMutating = (method: string) => method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

/** A mutating request must come from this Worker's own origin (the first-party client is Bearer). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

type Body = Record<string, unknown>;

async function parseBody(request: Request): Promise<Body | Response> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return json({ error: 'invalid_json' }, 400);
  }
  return value as Body;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const optStr = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function writeBase(operatorId: string, b: Body): WriteBase {
  return {
    operatorId,
    clientKey: str(b.clientKey),
    reason: str(b.reason),
    ticketRef: optStr(b.ticketRef),
  };
}

function pageParam(url: URL): number | undefined | 'bad' {
  const raw = url.searchParams.get('page');
  if (raw === null || raw === '') return undefined;
  if (!/^\d{1,6}$/.test(raw)) return 'bad';
  return Number(raw);
}

function badRequest(detail: string): Response {
  return json({ error: 'invalid_request', detail }, 400);
}

const enc = (s: string) => decodeURIComponent(s);

type Ctx = { env: AdminEnv; pms: PmsOpsBinding; operatorId: string; request: Request; url: URL };

async function route(ctx: Ctx, operator: { displayName: string; role: OpsRole }): Promise<Response | null> {
  const { pms, operatorId, request, url } = ctx;
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');
  let m: RegExpExecArray | null;

  if (method === 'GET') {
    if (path === '/api/me') {
      // The operator's own display name and role. No email.
      return json({ ok: true, operator: { operatorId, displayName: operator.displayName, role: operator.role } });
    }
    if (path === '/api/customers') {
      const page = pageParam(url);
      if (page === 'bad') return badRequest('page');
      const query = url.searchParams.get('query');
      return respond(await pms.listCustomers({ operatorId, query: query && query.length <= 200 ? query : null, page }));
    }
    if ((m = /^\/api\/customers\/([^/]+)$/.exec(path))) {
      return respond(await pms.getCustomer({ operatorId, orgId: enc(m[1]!) }));
    }
    if ((m = /^\/api\/properties\/([^/]+)\/health$/.exec(path))) {
      return respond(await pms.getPropertyHealth({ operatorId, propertyId: enc(m[1]!) }));
    }
    if (path === '/api/operator-actions') {
      const page = pageParam(url);
      if (page === 'bad') return badRequest('page');
      return respond(
        await pms.listOperatorActions({
          operatorId,
          orgId: optStr(url.searchParams.get('orgId')),
          filterOperatorId: optStr(url.searchParams.get('operatorId')),
          page,
        }),
      );
    }
    if (path === '/api/operators') return respond(await pms.listOperators({ operatorId }));
    return null;
  }

  if (method === 'POST') {
    const parsed = await parseBody(request);
    if (parsed instanceof Response) return parsed;
    const b = parsed;
    const base = writeBase(operatorId, b);

    if (path === '/api/customers') {
      return respond(await pms.createOrg({ ...base, orgId: str(b.orgId), name: str(b.name), planCode: str(b.planCode) }));
    }
    if (path === '/api/operators') {
      return respond(
        await pms.addOperator({ ...base, email: str(b.email), displayName: str(b.displayName), role: str(b.role) as OpsRole }),
      );
    }
    if ((m = /^\/api\/operators\/([^/]+)\/(status|role)$/.exec(path))) {
      const targetOperatorId = enc(m[1]!);
      if (m[2] === 'status') {
        const status = str(b.status);
        if (!(OPERATOR_STATUSES as readonly string[]).includes(status)) return badRequest('status');
        return respond(await pms.setOperatorStatus({ ...base, targetOperatorId, status: status as OperatorStatus }));
      }
      const role = str(b.role);
      if (!(OPS_ROLES as readonly string[]).includes(role)) return badRequest('role');
      return respond(await pms.setOperatorRole({ ...base, targetOperatorId, role: role as OpsRole }));
    }
    if ((m = /^\/api\/customers\/([^/]+)\/(properties|owners|plan|addons|suspend|reinstate)$/.exec(path))) {
      const orgId = enc(m[1]!);
      switch (m[2]) {
        case 'properties': {
          const jurisdiction = optStr(b.jurisdiction);
          return respond(
            await pms.addProperty({
              ...base,
              orgId,
              propertyId: str(b.propertyId),
              name: str(b.name),
              jurisdiction: jurisdiction as Jurisdiction | null,
              timeZone: str(b.timeZone),
              currency: str(b.currency),
            }),
          );
        }
        case 'owners':
          return respond(await pms.addOrgOwner({ ...base, orgId, email: str(b.email) }));
        case 'plan':
          return respond(await pms.setPlan({ ...base, orgId, planCode: str(b.planCode) }));
        case 'addons': {
          const quantity = typeof b.quantity === 'number' ? b.quantity : Number.NaN;
          if (!Number.isInteger(quantity)) return badRequest('quantity');
          return respond(await pms.setAddon({ ...base, orgId, addonCode: str(b.addonCode), quantity }));
        }
        case 'suspend':
          return respond(await pms.suspendOrg({ ...base, orgId }));
        default:
          return respond(await pms.reinstateOrg({ ...base, orgId }));
      }
    }
    return null;
  }
  return null;
}

export async function handleApi(request: Request, env: AdminEnv): Promise<Response> {
  if (isMutating(request.method) && !sameOrigin(request)) {
    return json({ error: 'origin_not_allowed' }, 403);
  }
  const auth = await authenticateOperator(request, env);
  if ('response' in auth) return auth.response;
  const url = new URL(request.url);
  const res = await route(
    { env, pms: env.PMS_OPS, operatorId: auth.operator.operatorId, request, url },
    { displayName: auth.operator.displayName, role: auth.operator.role },
  );
  return res ?? json({ error: 'not_found' }, 404);
}

export const API_PAGE_SIZE = OPS_PAGE_SIZE;
