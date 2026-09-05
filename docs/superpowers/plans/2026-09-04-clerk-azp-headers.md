# Clerk azp, security headers, CSRF, smoke JWT (R0.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-04)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **N4**, **N5**, **G12**, **S5**, **N12** — fail-closed Clerk `azp`, full security headers on `/v1` + SPA HTML, Bearer-or-Origin CSRF gate on mutating `/v1`, smoke JWT masking, staging `CLERK_AUTHORIZED_PARTIES` restore.

**Architecture:** Characterization tests land **first** (T1/T5/T8/T9 red on `main`). Production adds one `security-headers.ts` helper, fail-closed short-circuit in `auth.ts` before Clerk, CSRF gate in `handleV1` before `dispatchV1`, and a single `secured()` wrapper at every `handleV1` exit so `json()` does **not** need a Request parameter on ~100 call sites. Config/workflow/doc housekeeping in Task 2. Full CI + R0.2 tick in Task 3.

**Tech Stack:** Cloudflare Workers + vitest + `cloudflare:test`, `@clerk/backend`, `@hospai/contracts` (pins frozen).

**Spec:** `docs/superpowers/specs/2026-09-04-clerk-azp-headers-design.md` (Status: Approved — normative).

---

## Global Constraints

- Empty `CLERK_AUTHORIZED_PARTIES` + not `HOSPAI_UNSAFE_LOCAL` → short-circuit **before Clerk**, **401**. Never omit `authorizedParties` when list is non-empty.
- Staging var: `https://hospai-pms-core-staging.hospai.workers.dev` (from `.github/workflows/staging-deploy.yml` `BASE`). No `*`.
- One `security-headers.ts` helper; apply to `/v1` JSON, SPA HTML, misconfig, WS failure. Enforce CSP. `Permissions-Policy`: `camera=(), microphone=(), geolocation=()`.
- Mutating `/v1`: Bearer **or** Origin in parties. Cookie-only → **401**. Skip CSRF when parties empty + `HOSPAI_UNSAFE_LOCAL=1`.
- Smoke: `echo "::add-mask::$JWT"` before `GITHUB_OUTPUT`.
- Uncheck Lock 4 in `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` until verified (Task 2).
- Tick `docs/roadmap.md` **R0.2** in Task 3 only.
- Pins frozen: catalog **89**, routes **144** last `get_city_ledger_statement`, schema **34**, `NIGHT_AUDIT_STEPS` length **8** `[3] === 'AUTO_TRANSFER'`.
- Red-on-main tests: **T1, T5, T8, T9** only. **T2** is regression guard (already 401 on `main`).
- Never `--` before `--shard`.
- **Out of scope:** `provision.ts`, city-ledger, SPA source, `packages/client-core`, catalog/routes/schema changes.

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-04 per spec (HEAD `54dd5b0`). No catalog/route/schema pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Scenario | Behaviour | HTTP |
|---|---|---|
| Empty parties (staging/prod) | Short-circuit before `authenticateRequest` | **401** `{ error: 'unauthenticated', message: '…' }` |
| Empty parties + `HOSPAI_UNSAFE_LOCAL=1` | May omit `authorizedParties`; Clerk path allowed | per mock / dev-actor |
| Non-empty parties | Always `authorizedParties: parties` to Clerk | wrong `azp` → **401** |
| Mutating `/v1` CSRF fail | No Bearer, Origin absent or not in list | **401** before `resolveActor` |
| Mutating `/v1` pass | `Authorization: Bearer …` **or** `Origin` in parties | proceeds to auth |
| Security headers | All `/v1` + SPA HTML + misconfig + WS non-upgrade error | full header set |
| Staging var | `CLERK_AUTHORIZED_PARTIES` = workers.dev origin | — |
| Smoke JWT | `::add-mask::` before output | — |

**Out of scope:** provision graft (R0.1 done), city ledger (R0.3), HKDF (R0.5), guest-list SQL (S2), new routes/commands.

---

## Request threading for `applySecurityHeaders` (design lock)

`json()` in `v1-dispatch.ts` (~100 call sites) stays `json(data, status, headers?)` — **do not** add Request to every call site.

Instead:

1. **`handleV1`** defines `const secured = (response: Response) => applySecurityHeaders(response, request)` and wraps **every** return (404, dev-scope 404, CSRF 401, `dispatchV1` result).
2. **`dispatchV1`** internal returns (`resolveActor` 401, `requirePermission` 403/404, `json(...)`, `new Response(null, { status: 503 })`, WS `expected_websocket` 400) all bubble up to `handleV1` and get headers once.
3. **`index.ts`** calls `applySecurityHeaders(..., request)` on SPA HTML, asset-missing 404, and passes `request` into `assertEnvSafeForRequest(env, request)`.
4. **`auth.ts` `unauthorized()`** stays as `Response.json` — headers applied when returned through `handleV1` → `secured()`.

This satisfies AGENTS.md “one header helper on every response” without a fifth error mapper.

---

## Sequencing gate

```
Task 1 (red tests) → Task 2 (production + config, green) → Task 3 (full CI + R0.2 tick)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1, T5, T8, T9). Task 2 makes them green. Task 3 runs full CI `checks` job + `pnpm test:local`.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Modify: `apps/pms-core/test/auth.spec.ts`
- Create: `apps/pms-core/test/csrf.spec.ts`
- Modify: `apps/pms-core/test/spa-assets.spec.ts`

**Interfaces:** none (tests only)

### Step 1 — Shared test helpers in `spa-assets.spec.ts`

Add at top of file (reuse in T8/T9):

```ts
function expectSecurityHeaders(res: Response, opts?: { https?: boolean }) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  const csp = res.headers.get('Content-Security-Policy') ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers.get('Permissions-Policy')).toMatch(/camera=\(\)/);
  expect(res.headers.get('Permissions-Policy')).toMatch(/microphone=\(\)/);
  expect(res.headers.get('Permissions-Policy')).toMatch(/geolocation=\(\)/);
  if (opts?.https) {
    expect(res.headers.get('Strict-Transport-Security')).toMatch(/max-age=31536000/);
  } else {
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  }
}
```

- [ ] Helper added; not exported (same-file use only)

### Step 2 — Auth azp tests T1–T4 in `auth.spec.ts`

Add a new `describe('Clerk azp enforcement (mocked)', () => { ... })` block **after** the existing `describe('Clerk path (mocked)')` block. Reuse the same `beforeEach` / `afterEach` pattern (`resetPlatformSchemaGate`, `ensurePlatformSchema`, `__setAuthenticateRequestForTest(null)`).

**T1 — staging-shaped empty parties refuses Clerk (G12) — must be RED on `main`**

```ts
  it('staging-shaped empty CLERK_AUTHORIZED_PARTIES refuses Clerk auth (G12)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_owner' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      HOSPAI_UNSAFE_LOCAL: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: '',
    };

    const orgId = `org_empty_azp_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Empty Parties Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });
```

**T2 — wrong azp regression guard (not required red on `main`)**

```ts
  it('wrong azp → 401 (regression guard)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: false,
      toAuth: () => null,
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: 'https://allowed.example',
    };

    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId: `org_wrong_azp_${crypto.randomUUID()}`, name: 'Wrong Azp' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(authenticateRequest.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ authorizedParties: ['https://allowed.example'] }),
    );
  });
```

**T3 — matching azp → 201 + authorizedParties passed**

```ts
  it('matching azp → 201 and passes authorizedParties to Clerk', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_clerk_match' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: 'http://localhost',
    };

    const orgId = `org_match_azp_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Match Azp Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalledTimes(1);
    expect(authenticateRequest.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ authorizedParties: ['http://localhost'] }),
    );
  });
```

**T4 — unsafe local escape hatch**

```ts
  it('HOSPAI_UNSAFE_LOCAL=1 empty parties may authenticate (local only)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_unsafe_local' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const clerkEnv = {
      ...env,
      HOSPAI_UNSAFE_LOCAL: '1',
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: 'sk_test',
      CLERK_PUBLISHABLE_KEY: 'pk_test',
      CLERK_JWT_KEY: 'pem',
      CLERK_AUTHORIZED_PARTIES: '',
    };

    const orgId = `org_unsafe_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Unsafe Local Org' }),
      }),
      clerkEnv,
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });
```

- [ ] All four tests added under new `describe` block
- [ ] Existing `Clerk path (mocked)` and WS tests untouched

### Step 3 — New `csrf.spec.ts` (T5–T7)

Create `apps/pms-core/test/csrf.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setAuthenticateRequestForTest } from '../src/auth.js';
import worker from '../src/index.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

const STAGING_ORIGIN = 'https://hospai-pms-core-staging.hospai.workers.dev';

function stagingClerkEnv(overrides: Record<string, unknown> = {}) {
  return {
    ...env,
    HOSPAI_ALLOW_DEV_ACTOR: undefined,
    HOSPAI_UNSAFE_LOCAL: undefined,
    CLERK_SECRET_KEY: 'sk_test',
    CLERK_PUBLISHABLE_KEY: 'pk_test',
    CLERK_JWT_KEY: 'pem',
    CLERK_AUTHORIZED_PARTIES: STAGING_ORIGIN,
    ...overrides,
  };
}

describe('mutating /v1 CSRF gate (mocked Clerk)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  afterEach(() => {
    __setAuthenticateRequestForTest(null);
  });

  it('POST /v1/orgs with Cookie session only, no Bearer, no Origin → 401 (CSRF)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_cookie_attack' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: '__session=attacker_session',
        },
        body: JSON.stringify({ orgId: `org_csrf_${crypto.randomUUID()}`, name: 'CSRF Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(401);
    expect(authenticateRequest).not.toHaveBeenCalled();
  });

  it('POST /v1/orgs with Bearer passes CSRF gate (mock Clerk)', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_bearer_ok' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const orgId = `org_bearer_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer session_jwt',
        },
        body: JSON.stringify({ orgId, name: 'Bearer Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });

  it('POST /v1/orgs with permitted Origin, no Bearer, passes CSRF gate', async () => {
    const authenticateRequest = vi.fn().mockResolvedValue({
      isAuthenticated: true,
      toAuth: () => ({ userId: 'user_origin_ok' }),
    });
    __setAuthenticateRequestForTest(authenticateRequest);

    const orgId = `org_origin_${crypto.randomUUID()}`;
    const res = await worker.fetch(
      new Request('http://localhost/v1/orgs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: STAGING_ORIGIN,
        },
        body: JSON.stringify({ orgId, name: 'Origin Org' }),
      }),
      stagingClerkEnv(),
    );
    expect(res.status).toBe(201);
    expect(authenticateRequest).toHaveBeenCalled();
  });
});
```

- [ ] File created with T5–T7

### Step 4 — Security header tests T8–T9 in `spa-assets.spec.ts`

Add imports at top:

```ts
import { __setAuthenticateRequestForTest } from '../src/auth.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';
```

Add describe block:

```ts
describe('security headers (N5)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('GET / HTML carries full security header set (T8)', async () => {
    const res = await worker.fetch(new Request('http://localhost/'), env);
    expect(res.status).toBe(200);
    expectSecurityHeaders(res, { https: false });
  });

  it('GET /v1/properties/:id/me carries headers on 200 and 401 (T9)', async () => {
    const orgId = `org_hdr_${crypto.randomUUID()}`;
    const propertyId = `prop_hdr_${crypto.randomUUID()}`;

    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_hdr' },
            body: JSON.stringify({ orgId, name: 'Header Org' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${orgId}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': 'user_hdr' },
            body: JSON.stringify({
              propertyId,
              name: 'Header Hotel',
              timeZone: 'UTC',
              currency: 'USD',
            }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const authed = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/me`, {
        headers: { 'x-dev-actor': 'user_hdr' },
      }),
      env,
    );
    expect(authed.status).toBe(200);
    expectSecurityHeaders(authed, { https: false });

    const denied = await worker.fetch(
      new Request(`http://localhost/v1/properties/${propertyId}/me`),
      env,
    );
    expect(denied.status).toBe(401);
    expectSecurityHeaders(denied, { https: false });
  });
});
```

- [ ] T8/T9 added

### Step 5 — Run focused vitest (confirm red/green split)

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts test/csrf.spec.ts test/spa-assets.spec.ts
```

Expected on **`main` before Task 2**:

| Test | Expected |
|---|---|
| T1 `empty CLERK_AUTHORIZED_PARTIES refuses` | **FAIL** (201 today — Clerk called with no parties gate) |
| T2 `wrong azp` | PASS (regression guard) |
| T3 `matching azp` | may PASS or FAIL on options assertion — not a red gate |
| T4 `UNSAFE_LOCAL empty parties` | PASS on `main` (documents escape hatch) |
| T5 cookie-only CSRF | **FAIL** (201 or Clerk called — no CSRF gate) |
| T6 Bearer CSRF pass | may FAIL if T1-style azp blocks — fix in Task 2 |
| T7 Origin CSRF pass | may FAIL for same reason — fix in Task 2 |
| T8 HTML headers | **FAIL** (headers absent) |
| T9 `/v1` headers | **FAIL** (headers absent) |
| Existing auth + WS + SPA shell tests | PASS |

- [ ] T1, T5, T8, T9 confirmed **FAIL**
- [ ] T2 passes (or note if unexpectedly red — do not weaken assertion)

### Step 6 — Commit (tests only)

```bash
git add apps/pms-core/test/auth.spec.ts apps/pms-core/test/csrf.spec.ts apps/pms-core/test/spa-assets.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): add azp, CSRF, and security-header characterization

T1/T5/T8/T9 fail on main before fail-closed auth, CSRF gate, and headers.
EOF
)"
```

---

## Task 2 — Production, config, workflow, Lock 4 (green focused tests)

**Files:**
- Create: `apps/pms-core/src/security-headers.ts`
- Modify: `apps/pms-core/src/auth.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handleV1`, CSRF helper)
- Modify: `apps/pms-core/src/index.ts`
- Modify: `apps/pms-core/src/env.ts`
- Modify: `apps/pms-core/wrangler.jsonc`
- Modify: `.github/workflows/staging-deploy.yml`
- Modify: `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` (Lock 4 only)

**Interfaces:**

- **Produces:** `applySecurityHeaders(response: Response, request: Request): Response` from `security-headers.ts`
- **Produces:** `authorizedParties(env: PmsEnv): string[]` exported from `auth.ts` (for CSRF gate in `v1-dispatch.ts`)
- **Produces:** `requireMutatingV1Credential(request: Request, env: PmsEnv): Response | null` in `v1-dispatch.ts` (returns 401 Response or null)
- **Modifies:** `assertEnvSafeForRequest(env: PmsEnv, request: Request): Response | null` — applies headers on 500 misconfig

### Step 1 — Create `security-headers.ts`

```ts
/** Clerk Frontend API + Turnstile for staging publishable key in wrangler.jsonc. */
const CLERK_SCRIPT_ORIGINS = [
  'https://caring-drake-8317.clerk.accounts.dev',
  'https://challenges.cloudflare.com',
];

function buildContentSecurityPolicy(): string {
  const clerk = CLERK_SCRIPT_ORIGINS.join(' ');
  return [
    "default-src 'self'",
    "frame-ancestors 'none'",
    `connect-src 'self' ${clerk}`,
    `script-src 'self' ${clerk}`,
  ].join('; ');
}

export function applySecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', buildContentSecurityPolicy());
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (request.url.startsWith('https:')) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
```

- [ ] File created; no KV reads; CSP **enforce** (not report-only)

### Step 2 — Fail-closed azp in `auth.ts`

Add and export:

```ts
export function authorizedParties(env: PmsEnv): string[] {
  const raw = env.CLERK_AUTHORIZED_PARTIES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function azpEnforcementEnabled(env: PmsEnv): boolean {
  return env.HOSPAI_UNSAFE_LOCAL !== '1';
}
```

In `resolveActor`, **after** dev-actor block and `clerkConfigured` check, **before** building `clerkRequest`:

```ts
  const parties = authorizedParties(env);
  if (azpEnforcementEnabled(env) && parties.length === 0) {
    return unauthorized('Authorized parties not configured.');
  }
```

In `authenticateClerkSession`, replace conditional spread:

```ts
async function authenticateClerkSession(
  request: Request,
  env: PmsEnv,
): Promise<Awaited<ReturnType<AuthenticateRequestFn>>> {
  const parties = authorizedParties(env);
  const options: Parameters<AuthenticateRequestFn>[1] = {
    jwtKey: env.CLERK_JWT_KEY,
  };
  if (parties.length > 0) {
    options.authorizedParties = parties;
  }
  if (authenticateRequestOverride) {
    return authenticateRequestOverride(request, options);
  }
  return clerkClient(env).authenticateRequest(request, options);
}
```

- [ ] Remove `...(parties.length > 0 ? { authorizedParties: parties } : {})` pattern
- [ ] `grep -n "parties.length > 0" apps/pms-core/src/auth.ts` returns nothing

### Step 3 — CSRF gate + `handleV1` secured wrapper in `v1-dispatch.ts`

Add imports:

```ts
import { applySecurityHeaders } from './security-headers.js';
import { authorizedParties } from './auth.js';
```

Add helper (same file, near `handleV1`):

```ts
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfUnauthorized(message: string): Response {
  return Response.json({ error: 'unauthenticated', message }, { status: 401 });
}

function requireMutatingV1Credential(request: Request, env: PmsEnv): Response | null {
  if (!MUTATING_METHODS.has(request.method)) return null;

  const parties = authorizedParties(env);
  if (parties.length === 0 && env.HOSPAI_UNSAFE_LOCAL === '1') {
    return null;
  }
  if (parties.length === 0) {
    return csrfUnauthorized('Authorized parties not configured.');
  }

  const authorization = request.headers.get('Authorization');
  if (authorization && /^Bearer\s+\S+/i.test(authorization)) {
    return null;
  }

  const origin = request.headers.get('Origin')?.trim();
  if (origin && parties.includes(origin)) {
    return null;
  }

  return csrfUnauthorized(
    'Mutating requests require Bearer authorization or a permitted Origin.',
  );
}
```

Replace `handleV1` (~8947–8962):

```ts
export async function handleV1(
  request: Request,
  env: PmsEnv,
  observability: ObservabilityContext,
): Promise<Response> {
  const secured = (response: Response) => applySecurityHeaders(response, request);
  const url = new URL(request.url);
  const found = findRoute(request.method, url.pathname);
  if (!found) return secured(json({ error: 'not_found' }, 404));

  if (found.route.scope === 'dev') {
    if (!isDevActorAllowed(env) || request.method !== 'POST') {
      return secured(json({ error: 'not_found' }, 404));
    }
  }

  const csrfDenied = requireMutatingV1Credential(request, env);
  if (csrfDenied) return secured(csrfDenied);

  return secured(await dispatchV1(request, env, observability, found.route, found.match));
}
```

- [ ] CSRF runs **before** `dispatchV1` / `resolveActor`
- [ ] WebSocket stream route uses GET — CSRF skipped; azp still enforced in `resolveActor`
- [ ] WS non-upgrade 400 (`expected_websocket`) gets headers via `secured()`

### Step 4 — `index.ts` SPA HTML + asset errors

```ts
import { applySecurityHeaders } from './security-headers.js';
```

Change misconfig check:

```ts
    const misconfigured = assertEnvSafeForRequest(env, request);
    if (misconfigured) return misconfigured;
```

HTML branch (~107–115):

```ts
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
```

Asset missing 404:

```ts
        return applySecurityHeaders(json({ error: 'not_found' }, 404), request);
```

- [ ] `cache-control: no-cache` preserved on HTML
- [ ] Hashed `/assets/*` responses unchanged (no security headers required on immutable static chunks per spec scope — HTML + `/v1` only)

### Step 5 — `env.ts` misconfig headers

Update signature and apply helper on each 500 return:

```ts
import { applySecurityHeaders } from './security-headers.js';

export function assertEnvSafeForRequest(env: PmsEnv, request: Request): Response | null {
  const unsafe = env.HOSPAI_UNSAFE_LOCAL === '1';
  // each return:
  return applySecurityHeaders(
    Response.json({ error: 'misconfigured', message: '…' }, { status: 500 }),
    request,
  );
}
```

- [ ] All three misconfig branches wrapped
- [ ] `index.ts` passes `request`

### Step 6 — Staging var in `wrangler.jsonc`

In `env.staging.vars`, add after `CLERK_JWT_KEY`:

```jsonc
        "CLERK_AUTHORIZED_PARTIES": "https://hospai-pms-core-staging.hospai.workers.dev"
```

- [ ] No `*`
- [ ] Comma-separated list format preserved if adding more origins later

### Step 7 — Smoke JWT mask in `staging-deploy.yml`

In the mint step (~line 66), **before** `GITHUB_OUTPUT`:

```yaml
          JWT=$(printf '%s' "$TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).jwt))")
          echo "::add-mask::$JWT"
          echo "CLERK_SESSION_JWT=$JWT" >> "$GITHUB_OUTPUT"
```

- [ ] Mask line present
- [ ] Secrets remain in step `env:` (already true)

### Step 8 — Uncheck Lock 4 in staging-deploy spec

In `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` §10 checklist, change:

```markdown
- [x] Lock 4: Deploy sequence followed; `CLERK_AUTHORIZED_PARTIES` matches live origin
```

to:

```markdown
- [ ] Lock 4: Deploy sequence followed; `CLERK_AUTHORIZED_PARTIES` matches live origin — Reopened by R0.2 spec 2026-09-04; recheck after staging deploy verifies var.
```

- [ ] Lock 4 unchecked with footnote

### Step 9 — Focused test run (must go green)

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts test/csrf.spec.ts test/spa-assets.spec.ts
```

- [ ] T1–T9 green
- [ ] Existing `Clerk WebSocket protocol (mocked)` tests still green (T10 regression)

### Step 10 — Grep sanity

```bash
grep -n "parties.length > 0" apps/pms-core/src/auth.ts
grep -rn "Permissions-Policy\|Content-Security-Policy" apps/pms-core/src/
grep "CLERK_AUTHORIZED_PARTIES" apps/pms-core/wrangler.jsonc
```

- [ ] First grep empty
- [ ] Second hits `security-headers.ts`
- [ ] Third shows staging origin

### Step 11 — Typecheck

```bash
pnpm typecheck
```

- [ ] No TS errors from `assertEnvSafeForRequest` signature change (only `index.ts` caller)

### Step 12 — Commit

```bash
git add apps/pms-core/src/security-headers.ts apps/pms-core/src/auth.ts apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/index.ts apps/pms-core/src/env.ts apps/pms-core/wrangler.jsonc .github/workflows/staging-deploy.yml docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md
git commit -m "$(cat <<'EOF'
fix(pms-core): fail-closed Clerk azp, CSRF gate, and security headers

Short-circuit empty authorized parties before Clerk; Bearer-or-Origin on
mutating /v1; shared CSP/HSTS headers on /v1 and SPA HTML; restore staging
CLERK_AUTHORIZED_PARTIES; mask smoke JWT (audit N4/N5/G12/S5/N12).
EOF
)"
```

---

## Task 3 — Full CI + tick R0.2

**Files:** `docs/roadmap.md` (R0.2 checkbox only)

### Step 1 — Named vitest files (R0.2 slice)

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts test/csrf.spec.ts test/spa-assets.spec.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
pnpm test:local
```

- [ ] All green
- [ ] **Never put `--` before `--shard`**

### Step 3 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 4 — Tick roadmap R0.2

In `docs/roadmap.md`, change:

```markdown
- [ ] **R0.2** Audit V2 — N4, N5, G12, S5, N12. azp, headers, Bearer-or-Origin, smoke JWT mask.
```

to:

```markdown
- [x] **R0.2** Audit V2 — N4, N5, G12, S5, N12. azp, headers, Bearer-or-Origin, smoke JWT mask.
```

- [ ] Tick in **this** commit only

### Step 5 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.2 after Clerk azp, headers, and CSRF hardening

Full CI checks and pms-core shards green; audit N4/N5/G12/S5/N12 closed.
EOF
)"
```

---

## Test matrix (spec §7 — mapped to tasks)

| # | Layer | Task | Red on `main`? | Expect |
|---|---|---|---|---|
| T1 | HTTP/auth | Task 1 | **Yes** | **401**; `authenticateRequest` **not** called |
| T2 | HTTP/auth | Task 1 | No | **401**; `authorizedParties` passed when non-empty |
| T3 | HTTP/auth | Task 1 | No | **201**; mock options include `authorizedParties` |
| T4 | HTTP/auth | Task 1 | No | **201** with `HOSPAI_UNSAFE_LOCAL=1` + empty parties |
| T5 | HTTP/CSRF | Task 1 | **Yes** | Cookie-only POST → **401** before Clerk |
| T6 | HTTP/CSRF | Task 1 | — | Bearer POST → **201** |
| T7 | HTTP/CSRF | Task 1 | — | Origin in list, no Bearer → **201** |
| T8 | HTTP/headers | Task 1 | **Yes** | `GET /` full header set |
| T9 | HTTP/headers | Task 1 | **Yes** | `GET /v1/.../me` headers on 200 and 401 |
| T10 | regression | Task 2 verify | — | WS protocol tests green |
| T11 | regression | Task 3 | — | `pnpm test:local` green; pins unchanged |

---

## Success criteria (spec §12)

1. Staging `wrangler.jsonc` includes `CLERK_AUTHORIZED_PARTIES` matching live workers.dev origin (no `*`).
2. Staging/production-shaped env with empty parties → **401** without calling Clerk; `HOSPAI_UNSAFE_LOCAL=1` retains escape hatch.
3. Wrong `azp` → **401**; matching origin/token → success in tests.
4. Mutating `/v1` rejects cookie-only POST without permitted Origin → **401**.
5. `/v1` JSON and SPA HTML carry full security header set including `Permissions-Policy` and enforced CSP.
6. Smoke workflow masks JWT before `GITHUB_OUTPUT`.
7. Lock 4 **unchecked** until post-deploy verification.
8. T1/T5/T8/T9 would have failed on pre-fix `main`; `pnpm test:local` green; pins unchanged.

---

## Spec / code mismatches (for reviewer)

| Item | Spec says | Code today | Plan resolution |
|---|---|---|---|
| `handleV1` location | `v1-dispatch.ts` + `v1-handler.ts` re-export | `apps/pms-core/src/v1-handler.ts` re-exports from `v1-dispatch.ts` | Edit `v1-dispatch.ts` only |
| `json()` Request threading | “Refactor local `json()` to pipe through helper” | ~100 `json()` calls; no Request in scope | **`secured()` wrapper in `handleV1`** applies headers once on exit; `index.ts` / `env.ts` call helper directly |
| T3 parties for vitest | “parties include vitest origin” | Tests use `http://localhost` | `CLERK_AUTHORIZED_PARTIES: 'http://localhost'` |
| Lock 4 timing | “reopen during implementation” | Still `[x]` in smoke spec | Uncheck in **Task 2** with footnote; recheck manually after staging deploy |
| Immutable static assets | Spec lists SPA HTML + `/v1` | `index.ts` also sets cache on hashed `/assets/*` | Security headers on HTML + `/v1` only; do not alter immutable asset cache policy |
| CSRF + empty parties (unsafe) | Skip CSRF when parties empty + UNSAFE_LOCAL | Same as azp escape | Both gates skip when `HOSPAI_UNSAFE_LOCAL=1` && parties empty |
