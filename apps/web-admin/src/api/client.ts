/**
 * The one module that talks to the Worker's /api (no `fetch` in components). Errors are thrown as
 * `ApiError` and turned into operator copy by `opsErrorMessage`, never printed as raw JSON.
 */

export type ApiError = Error & { status: number; code: string; detail?: string };

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as ApiError).code === 'string' && typeof (e as ApiError).status === 'number';
}

function apiError(status: number, code: string, detail?: string): ApiError {
  return Object.assign(new Error(code), { status, code, detail });
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
let devOperator: string | null = null;

export function registerTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}
export function setDevOperator(email: string | null): void {
  devOperator = email;
}

async function credentialHeaders(): Promise<Record<string, string>> {
  if (devOperator) return { 'x-dev-operator': devOperator };
  const token = tokenGetter ? await tokenGetter() : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...(await credentialHeaders()) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw apiError(0, 'network_error');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Not JSON (a proxy error page): fall through to a generic failure.
  }
  if (!res.ok) {
    const b = (data ?? {}) as { error?: unknown; detail?: unknown };
    throw apiError(
      res.status,
      typeof b.error === 'string' ? b.error : 'request_failed',
      typeof b.detail === 'string' ? b.detail : undefined,
    );
  }
  return data as T;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path);
export const apiPost = <T>(path: string, body: unknown): Promise<T> => request<T>('POST', path, body);

const DETAIL_MESSAGES: Record<string, string> = {
  unknown_plan: 'That plan code does not exist.',
  unknown_addon: 'That add-on code does not exist.',
  invalid_tenant_id: 'Ids use letters, digits, underscores and hyphens only.',
  invalid_timezone: 'That is not a valid IANA time zone (for example Asia/Kolkata).',
  invalid_currency: 'Use a three-letter currency code (for example INR).',
  plan_unchanged: 'The customer is already on that plan.',
  addon_unchanged: 'The customer already has that quantity of that add-on.',
  role_unchanged: 'That operator already has that role.',
  status_unchanged: 'That operator already has that status.',
  email_ambiguous: 'More than one person has that email. Use a different address.',
  property_unreachable: 'The hotel could not be reached. Try again in a moment.',
  ticket_ref: 'The ticket reference is too long.',
  name: 'Enter a name.',
  email: 'Enter a valid email address.',
  display_name: 'Enter a display name.',
};

const CODE_MESSAGES: Record<string, string> = {
  unauthenticated: 'Your session has expired. Sign in again.',
  mfa_required: 'A second factor is required. Enrol an authenticator or passkey in your account, then sign in again.',
  not_an_operator: 'This account is not a HospAI operator.',
  forbidden: 'Your role cannot do this. Ask an ops admin.',
  origin_not_allowed: 'The request came from the wrong origin. Reload the Ops Console and try again.',
  reason_required: 'Enter a reason (1 to 500 characters).',
  org_exists: 'A customer with that id already exists. Choose a different id.',
  property_exists: 'A hotel with that id already exists. Choose a different id.',
  jurisdiction_conflict: 'That jurisdiction conflicts with the customer’s existing hotels.',
  limit_exceeded: 'The plan’s hotel limit is reached. Change the plan or add a +1 property add-on first.',
  tenant_not_active: 'The customer is not active. Reinstate it first.',
  user_not_found: 'No signed-up user has that email. Ask the person to sign up to the hotel app first.',
  plan_below_usage: 'That change would put the customer below the hotels it already has.',
  invalid_status_transition: 'The customer is not in a state that allows this change.',
  operator_exists: 'An operator with that email already exists.',
  last_ops_admin: 'That would leave no active ops admin. Make another operator an admin first.',
  ops_writes_disabled: 'Operator changes are switched off right now. Reads still work.',
  idempotency_key_reused: 'This request was already sent with different contents. Reload and try again.',
  not_found: 'Not found.',
  org_unreachable: 'The customer could not be reached. Try again in a moment.',
  clerk_unreachable: 'The sign-in service could not be reached. Try again in a moment.',
  identity_unavailable: 'Could not read your sign-in identity. Try again.',
  network_error: 'Could not reach the Ops Console. Check your connection and try again.',
  payload_too_large: 'The request is too large.',
};

/** Operator-facing copy for any failure. Never the raw body, never a bare status line. */
export function opsErrorMessage(err: unknown, fallback = 'That did not work. Try again.'): string {
  if (!isApiError(err)) return fallback;
  if (err.code === 'invalid_request' && err.detail) {
    return DETAIL_MESSAGES[err.detail] ?? 'Check the highlighted fields and try again.';
  }
  return CODE_MESSAGES[err.code] ?? fallback;
}
