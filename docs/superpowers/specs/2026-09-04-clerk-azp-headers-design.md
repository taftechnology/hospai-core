# Clerk azp, security headers, CSRF, smoke JWT (R0.2)

**Tree verified 2026-09-04:** `COMMAND_CATALOG` length **89** (`packages/contracts/src/register.test.ts:751`), `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`, `register.test.ts:748`), `PROPERTY_SCHEMA_HEAD === 34` (`packages/do-runtime/src/migrate.test.ts:637`), `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'` (`apps/pms-core/src/property-do.ts:1415–1424`, pinned in `apps/pms-core/test/rooms-ooo.spec.ts`). Pins match current `main` at HEAD `54dd5b0` — **no drift**.

**Date:** 2026-09-04  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 2](../../audit/2026-09-04-full-codebase-audit.md) (**N4**, **N5**, **G12**, **S5**, **N12**); [Clerk authentication](./2026-07-28-clerk-auth-design.md); [Sign-in / Clerk SPA](./2026-08-13-sign-in-clerk-design.md) (Bearer contract — do not rewrite); [Staging deploy + smoke](./2026-08-16-staging-deploy-smoke-design.md) (Lock 4 — **reopen** in implementation notes); [AGENTS.md §1 Authn](../../../AGENTS.md); `apps/pms-core/src/auth.ts`; `apps/pms-core/src/index.ts`; `apps/pms-core/src/v1-dispatch.ts`; `apps/pms-core/wrangler.jsonc`; `apps/pms-core/test/auth.spec.ts`; `apps/pms-core/test/spa-assets.spec.ts`; `packages/client-core/src/transport.ts`; `apps/web-pms/src/providers/clerk-credentials.ts`; `.github/workflows/staging-deploy.yml`; `scripts/smoke-staging.mjs`.

**Closes:** Audit **N4** (staging azp disabled), **N5** (no CSP/HSTS/XFO/nosniff), **G12** (no empty-`authorizedParties` test), **S5** (cookie-only POST CSRF hole), **N12** (smoke JWT unmasked). **Roadmap:** **R0.2**. **Requires:** R0.1 cross-tenant provision (done — do not touch). **Does not** advance R0.3 (city ledger), R0.5 (N6 HKDF), guest-list SQL (S2), or any catalog/schema/route count change.

---

## Executive summary

Staging ships with **no** `CLERK_AUTHORIZED_PARTIES` in `wrangler.jsonc`, and `auth.ts` **omits** `authorizedParties` from Clerk options when the parsed list is empty — which disables `azp` verification (N4). SPA HTML responses set only `cache-control`; `/v1` JSON responses carry **zero** security headers (N5). Mutating `/v1` accepts a Clerk **cookie session** with no `Authorization: Bearer` and no `Origin` check (S5). Smoke mints a JWT into `GITHUB_OUTPUT` without masking (N12). `auth.spec.ts:189` mocks Clerk success but never asserts parties or empty-list fail-closed (G12).

This spec locks: **fail-closed short-circuit before Clerk** when authorized parties are empty outside `HOSPAI_UNSAFE_LOCAL`; restore staging `CLERK_AUTHORIZED_PARTIES` to the live workers.dev origin; **one security-header helper** on every `/v1` and SPA HTML response (plus error/misconfig paths); **Bearer-or-Origin** on mutating `/v1`; smoke JWT masking; characterization tests **first**. No new route, command, event, or migration.

---

## Locked product call

- Restore `CLERK_AUTHORIZED_PARTIES` in `apps/pms-core/wrangler.jsonc` `env.staging.vars` to the live staging origin. Do **not** allowlist `*`.
- Give smoke a token that carries `azp`, or run smoke against an origin that is on the list. Reopen **Lock 4** in the staging-deploy-smoke design doc if it is still checked while the var is absent.
- When `CLERK_AUTHORIZED_PARTIES` is empty, **do not omit** `authorizedParties` from Clerk options in a way that disables azp. Fail closed in staging/production (refuse to authenticate) rather than skip the check. Tests/local may keep an explicit unsafe path behind `HOSPAI_UNSAFE_LOCAL` only.
- One header helper on `/v1` **and** the SPA HTML: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`, `Strict-Transport-Security`, CSP `default-src 'self'` with Clerk origins in `connect-src`/`script-src`. Include `Permissions-Policy` (at least `camera=()`, `microphone=()`, `geolocation=()`) — Sept 3 grepped it and found zero hits. Report-only CSP first is acceptable if Clerk origins are uncertain; ship enforce in the same vertical once the set is known.
- Mutating `/v1`: require `Authorization: Bearer` **or** validate `Origin` against the authorized parties. SPA already sends Bearer (`packages/client-core` transport). Cookie-only POST is the CSRF hole (S5).
- Smoke JWT: `echo "::add-mask::$JWT"` before `GITHUB_OUTPUT`. Move secret expansions to `env:` (N12).

---

## 1. Problem / evidence

### 1.1 N4 — azp disabled when parties empty (critical)

`apps/pms-core/src/auth.ts`:

```28:55:apps/pms-core/src/auth.ts
function authorizedParties(env: PmsEnv): string[] {
  const raw = env.CLERK_AUTHORIZED_PARTIES?.trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

async function authenticateClerkSession(
  request: Request,
  env: PmsEnv,
): Promise<Awaited<ReturnType<AuthenticateRequestFn>>> {
  const parties = authorizedParties(env);
  const options = {
    jwtKey: env.CLERK_JWT_KEY,
    ...(parties.length > 0 ? { authorizedParties: parties } : {}),
  };
  // ...
  return clerkClient(env).authenticateRequest(request, options);
}
```

When `CLERK_AUTHORIZED_PARTIES` is absent or empty, `authorizedParties` is **omitted** from Clerk options — Clerk skips `azp` validation. Staging `wrangler.jsonc` `env.staging.vars` has `CLERK_PUBLISHABLE_KEY` and `CLERK_JWT_KEY` but **no** `CLERK_AUTHORIZED_PARTIES` (lines 233–236).

Meanwhile `.github/workflows/staging-deploy.yml:71` hardcodes smoke `BASE` as `https://hospai-pms-core-staging.hospai.workers.dev` — the origin that **must** appear in the allowlist.

[2026-08-16-staging-deploy-smoke-design.md](./2026-08-16-staging-deploy-smoke-design.md) Lock 4 is checked (`- [x] Lock 4: … CLERK_AUTHORIZED_PARTIES matches live origin`) while the var is absent — **reopen Lock 4** during implementation (uncheck; leave unchecked until var matches live deploy URL).

### 1.2 N5 — no security headers (high)

`apps/pms-core/src/index.ts:107–115` — SPA HTML path sets only `cache-control: no-cache`. No `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, CSP, HSTS, or `Permissions-Policy`.

`apps/pms-core/src/v1-dispatch.ts:304–306` — local `json()` wraps `Response.json` with no header injection. `handleV1` returns dispatch responses unchanged (`index.ts:70–72`).

Repo grep (Sept 3 audit): zero `Permissions-Policy` / CSP / HSTS hits in production response paths.

### 1.3 S5 — cookie-only mutating POST (medium)

`resolveActor` (`auth.ts:43–100`) calls `authenticateClerkSession(clerkRequest, env)` on the raw request. Clerk's `authenticateRequest` accepts **`__session` cookie** when present. There is **no** gate requiring `Authorization: Bearer` or validated `Origin` before authentication on mutating methods.

First-party SPA contract is Bearer-only (`apps/web-pms/src/providers/clerk-credentials.ts:17–23` → `{ authorization: 'Bearer ${token}' }`; merged by `packages/client-core/src/transport.ts:19–23`). Cookie-only POST from a malicious site is the CSRF hole.

### 1.4 G12 — test gap (medium)

`apps/pms-core/test/auth.spec.ts:189` — `verified Clerk session succeeds when member` mocks `authenticateRequest` but:
- never sets `CLERK_AUTHORIZED_PARTIES`;
- never asserts `authorizedParties` was passed to Clerk;
- never tests empty-parties fail-closed or wrong-`azp` rejection.

### 1.5 N12 — smoke JWT leak (low)

`.github/workflows/staging-deploy.yml:49–67` — JWT minted and written to `GITHUB_OUTPUT` without `::add-mask::`. Secret expansions already use `env:` for the mint step (good); the mask line is still missing before output.

---

## 2. Locked behaviour

| Scenario | Condition | Behaviour | HTTP |
|---|---|---|---|
| **Empty parties (staging/prod shape)** | `authorizedParties(env).length === 0` **and** `HOSPAI_UNSAFE_LOCAL !== '1'` | **Short-circuit before Clerk** — do not call `authenticateRequest` | **401** `{ error: 'unauthenticated', message: '…' }` |
| **Empty parties (local unsafe)** | parties empty **and** `HOSPAI_UNSAFE_LOCAL === '1'` | May omit `authorizedParties` (dev-actor path unchanged); Clerk path allowed for local characterization | as today for dev-actor; Clerk per mock |
| **Non-empty parties** | parsed list length ≥ 1 | Always pass `authorizedParties: parties` to Clerk (never conditional spread) | wrong `azp` → Clerk `isAuthenticated: false` → **401** |
| **Valid token + member** | parties include token `azp`; OrgDO member | Route proceeds | **200/201/…** per handler |
| **CSRF — mutating /v1** | `POST`/`PUT`/`PATCH`/`DELETE` on `/v1/*` | Require `Authorization` header matching `/^Bearer\s+\S+/i` **or** `Origin` (or `Referer` origin extraction) in `authorizedParties(env)` when parties non-empty; if parties empty in unsafe-local only, CSRF gate skipped with Clerk (local tests) | cookie-only, no Bearer, bad/missing Origin → **401** `{ error: 'unauthenticated', message: '…' }` |
| **CSRF — GET/HEAD/OPTIONS** | read methods | No CSRF gate (auth still via `resolveActor` where required) | unchanged |
| **WebSocket upgrade** | `/v1/.../stream` | Auth via `Sec-WebSocket-Protocol` (`hospai.clerk.*`) — **not** subject to CSRF Origin gate; azp still enforced via parties when non-empty | bad auth → **401** with security headers on error response |
| **Security headers** | any `/v1` response; SPA `text/html`; `assertEnvSafeForRequest` 500; WS upgrade failure before 101 | Apply shared helper | header set present (see §3) |
| **Staging var** | `env.staging.vars` | `CLERK_AUTHORIZED_PARTIES` = live origin, no `*` | — |
| **Smoke JWT** | workflow mint step | `echo "::add-mask::$JWT"` before `GITHUB_OUTPUT`; no token in logs | — |

**Locked decision (reviewer):** pick **fail-closed short-circuit before Clerk** when parsed list is empty AND `HOSPAI_UNSAFE_LOCAL` is not set. Do **not** pass `authorizedParties: []` into Clerk as a substitute — refuse authentication earlier with a clear 401.

**No `*`** in authorized parties. Staging origin (from deploy workflow): `https://hospai-pms-core-staging.hospai.workers.dev` (no trailing slash). If first deploy prints a different subdomain, update var to exact wrangler output and redeploy once — do not invent a fake subdomain as “done”.

---

## 3. Security headers contract

One module (e.g. `apps/pms-core/src/security-headers.ts`) exports `applySecurityHeaders(response: Response, request: Request): Response` (or equivalent that merges into existing headers).

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'self'; frame-ancestors 'none'; connect-src 'self' <clerk-origins>; script-src 'self' <clerk-origins>` — **enforce** in this vertical |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` on HTTPS requests only (`request.url` starts with `https:`) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

**Clerk origins (staging):** derive from committed `CLERK_PUBLISHABLE_KEY` in `wrangler.jsonc` — `pk_test_Y2FyaW5nLWRyYWtlLTgzMTcuY2xlcmsuYWNjb3VudHMuZGV2JA` decodes to Frontend API host `https://caring-drake-8317.clerk.accounts.dev`. Include at minimum:

- `https://caring-drake-8317.clerk.accounts.dev` in `connect-src` and `script-src`
- `https://challenges.cloudflare.com` in `script-src` if Clerk Turnstile/captcha is used on sign-in (verify against sign-in screen; include if `@clerk/react` loads it)

Implementation may centralize origin list in a small constant keyed off publishable-key suffix or an env var — **do not** read CSP allowlist from KV. Prefer **enforce** CSP in this vertical; report-only is acceptable only if sign-in breaks in staging smoke — then fix origins and flip to enforce **before** closing the vertical (not a follow-up slice).

**Application points (all must use helper):**

1. `apps/pms-core/src/index.ts` — SPA HTML branch (~107–115) and any error JSON from assets missing (~92).
2. `apps/pms-core/src/v1-dispatch.ts` — wrap `json()` / all `/v1` exits (including `handleV1` 404, `dispatchV1` early returns, command errors).
3. `apps/pms-core/src/env.ts` — `assertEnvSafeForRequest` misconfig responses.
4. WebSocket upgrade **failure** responses in `v1-dispatch.ts` (~5778+) before successful 101 (audit: “WS upgrade failures”).

Do **not** strip asset cache headers; merge security headers atop existing `cache-control` on HTML.

---

## 4. CSRF gate contract

Add `requireMutatingV1Credential(request, env): Response | null` (name flexible) called from `handleV1` **before** `dispatchV1` for mutating methods.

**Pass (return null):**

- `Authorization` header matches `/^Bearer\s+\S+/i` (case-insensitive `Bearer`), **or**
- `Origin` header exactly matches an entry in `authorizedParties(env)` (after trim; no trailing slash normalization beyond what parties list uses), **or**
- `Sec-Fetch-Site: same-origin` **and** request URL origin matches a party (defence-in-depth for same-origin navigations — optional if Bearer/Origin sufficient; include if cheap)

**Fail:** no Bearer and (`Origin` absent or not in list) → **401** `{ error: 'unauthenticated', message: 'Mutating requests require Bearer authorization or a permitted Origin.' }` — apply security headers.

**When parties empty + `HOSPAI_UNSAFE_LOCAL=1`:** skip CSRF gate (local vitest uses dev-actor / mocked Clerk without Origin).

**Out of scope:** inventing a third auth header; changing SPA to send cookies instead of Bearer.

---

## 5. Error + HTTP contract

| Case | HTTP | Body |
|---|---|---|
| Empty parties (non-local) | **401** | `{ error: 'unauthenticated', message: '…' }` |
| CSRF fail (mutating) | **401** | `{ error: 'unauthenticated', message: '…' }` |
| Clerk invalid / wrong azp | **401** | `{ error: 'unauthenticated', message: 'Invalid or missing session.' }` (existing copy) |
| Misconfigured unsafe flags | **500** | existing `{ error: 'misconfigured', message: '…' }` + security headers |

Use existing `{ error: 'unauthenticated', message }` shape from `auth.ts:12–14` — no parallel `code` key.

---

## 6. Implementation steps

**Order: tests first (**T1, T5, T8, T9** red on `main`), then production.**

### 6.1 Tests — auth / azp (`apps/pms-core/test/auth.spec.ts`)

1. **`staging-shaped empty CLERK_AUTHORIZED_PARTIES refuses Clerk auth (G12)`** — `clerkEnv` with keys set, `CLERK_AUTHORIZED_PARTIES: ''` or omitted, `HOSPAI_UNSAFE_LOCAL` unset; mock `authenticateRequest` to return authenticated; `POST /v1/orgs` with Bearer → **401**; **`authenticateRequest` must not be called**. **Red on `main`.**
2. **`wrong azp → 401` (regression guard)** — set `CLERK_AUTHORIZED_PARTIES: 'https://allowed.example'`, mock `isAuthenticated: false`; Bearer request → **401**. **Not red on `main`** — `resolveActor` already 401s when Clerk returns unauthenticated; this test locks that behaviour and that `authorizedParties` is passed when the list is non-empty.
3. **`matching azp → 201`** — parties include `http://localhost` (vitest origin) or test sets Origin; mock authenticated; org create → **201**; assert mock received `{ authorizedParties: ['http://localhost'] }` (exact list). Required; need not be red before production.
4. **`HOSPAI_UNSAFE_LOCAL=1` empty parties may authenticate (local only)`** — unsafe local + empty parties; mock authenticated → **201**; documents explicit escape hatch.

### 6.2 Tests — CSRF (new `apps/pms-core/test/csrf.spec.ts` or extend `auth.spec.ts`)

5. **`POST /v1/orgs` with Cookie session header only, no Bearer, no Origin`** — staging-shaped env with parties set → **401** before handler.
6. **`POST /v1/orgs` with Bearer`** — passes CSRF gate (mock Clerk) → not 401 from CSRF.
7. **`POST /v1/orgs` with Origin matching parties, no Bearer`** — passes CSRF gate (mock Clerk) → not 401 from CSRF.

### 6.3 Tests — security headers (extend `spa-assets.spec.ts` + new cases)

8. **`GET /` HTML carries full header set** — assert `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy`, `Permissions-Policy`; HSTS when request URL is `https://…`.
9. **`GET /v1/properties/:id/me` (or any authenticated GET) carries same headers** — use dev-actor or mock; assert headers on 200 and on 401.

### 6.4 Production — auth (`apps/pms-core/src/auth.ts`)

10. Add `azpEnforcementEnabled(env): boolean` → false only when `HOSPAI_UNSAFE_LOCAL === '1'`.
11. In `resolveActor`, before `authenticateClerkSession`: if Clerk configured, parties empty, and `azpEnforcementEnabled` → return `unauthorized('Authorized parties not configured.')` (or equivalent).
12. In `authenticateClerkSession`: when parties non-empty, **always** `authorizedParties: parties` — remove conditional spread at lines 47–50.

### 6.5 Production — CSRF (`apps/pms-core/src/v1-dispatch.ts`)

13. Implement `requireMutatingV1Credential`; call from `handleV1` after route match, before `dispatchV1`, for `POST`/`PUT`/`PATCH`/`DELETE`.

### 6.6 Production — headers (`security-headers.ts`, `index.ts`, `v1-dispatch.ts`, `env.ts`)

14. Add helper; apply at all application points in §3.
15. Refactor local `json()` to pipe through helper (preserve extra headers like `Retry-After`).

### 6.7 Config — staging (`apps/pms-core/wrangler.jsonc`)

16. Add to `env.staging.vars`:
    ```jsonc
    "CLERK_AUTHORIZED_PARTIES": "https://hospai-pms-core-staging.hospai.workers.dev"
    ```
    Re-read deploy output on first apply; if subdomain differs, update to exact origin and redeploy.

### 6.8 Smoke workflow (`.github/workflows/staging-deploy.yml`)

17. Before `echo "CLERK_SESSION_JWT=$JWT" >> "$GITHUB_OUTPUT"`, add `echo "::add-mask::$JWT"`.
18. Confirm mint step secrets stay in `env:` (already true for `CLERK_SECRET_KEY`, `SMOKE_USER_ID`).

### 6.9 Staging-deploy spec housekeeping

19. In [2026-08-16-staging-deploy-smoke-design.md](./2026-08-16-staging-deploy-smoke-design.md) §10 checklist: **uncheck** Lock 4 (`CLERK_AUTHORIZED_PARTIES matches live origin`) until var is restored and verified post-deploy. Add footnote: “Reopened by R0.2 spec 2026-09-04.”

---

## 7. Test matrix

| # | Layer | Setup | Action | Expect |
|---|---|---|---|---|
| T1 | HTTP/auth | Staging-shaped Clerk keys; parties **empty**; mock would authenticate | `POST /v1/orgs` + Bearer | **401**; `authenticateRequest` **not** called |
| T2 | HTTP/auth (regression) | `CLERK_AUTHORIZED_PARTIES=https://allowed.example`; mock `isAuthenticated: false` | Bearer POST | **401**; **not red on `main`** — guards Clerk unauthenticated path + `authorizedParties` passed |
| T3 | HTTP/auth | Parties include vitest origin; mock authenticated + member | Bearer POST | **201**; mock options include `authorizedParties` |
| T4 | HTTP/auth | `HOSPAI_UNSAFE_LOCAL=1`; parties empty; mock authenticated | Bearer POST | **201** (local escape) |
| T5 | HTTP/CSRF | Parties set; mock authenticated | POST with `Cookie: __session=x` only | **401** (CSRF) |
| T6 | HTTP/CSRF | Parties set | POST with Bearer | passes CSRF (not 401 from gate) |
| T7 | HTTP/CSRF | Parties set; mock authenticated | POST with `Origin: https://allowed.example` (in list), no Bearer | passes CSRF |
| T8 | HTTP/headers | — | `GET /` | HTML + full security header set |
| T9 | HTTP/headers | dev-actor or mock | `GET /v1/...` | JSON + full security header set on 200 and 401 |
| T10 | regression | — | Existing `auth.spec.ts` Clerk WS protocol tests | Still green |
| T11 | regression | — | `pnpm test:local` | green; pins unchanged |

Tests **T1, T5, T8, T9** must **fail on current `main`** before production changes merge (empty parties still authenticate today; CSRF cookie-only passes; headers absent). **T2** and **T3** must exist before merge; **T2** is a regression guard and need not be red on `main`.

---

## 8. Verify commands

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts test/csrf.spec.ts test/spa-assets.spec.ts
```

After implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** never put `--` before `--shard` (pnpm treats `--shard` as a file filter).

**Grep sanity (post-fix):**

```bash
grep -n "parties.length > 0" apps/pms-core/src/auth.ts
# must be gone — replaced by fail-closed short-circuit

grep -rn "Permissions-Policy\|Content-Security-Policy" apps/pms-core/src/
# must hit security-headers helper

grep "CLERK_AUTHORIZED_PARTIES" apps/pms-core/wrangler.jsonc
# must show staging origin
```

**Manual staging (after deploy):**

```bash
# HTML headers
curl -sI "https://hospai-pms-core-staging.hospai.workers.dev/" | grep -iE 'content-security|x-frame|strict-transport|permissions-policy|nosniff'

# API headers + smoke
# workflow_dispatch staging-deploy with smoke_user_id
```

---

## 9. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/auth.ts` | Fail-closed short-circuit; always pass parties when non-empty |
| `apps/pms-core/src/security-headers.ts` | **New** — shared header helper + Clerk CSP origins |
| `apps/pms-core/src/v1-dispatch.ts` | CSRF gate; apply headers on all `/v1` responses |
| `apps/pms-core/src/index.ts` | Apply headers on SPA HTML + asset errors |
| `apps/pms-core/src/env.ts` | Security headers on misconfig responses |
| `apps/pms-core/wrangler.jsonc` | Restore `CLERK_AUTHORIZED_PARTIES` in `env.staging.vars` |
| `apps/pms-core/test/auth.spec.ts` | G12 azp / empty-parties / wrong-azp cases |
| `apps/pms-core/test/csrf.spec.ts` | **New** — S5 characterization |
| `apps/pms-core/test/spa-assets.spec.ts` | N5 HTML header assertions |
| `.github/workflows/staging-deploy.yml` | N12 JWT mask |
| `docs/superpowers/specs/2026-08-16-staging-deploy-smoke-design.md` | Uncheck Lock 4 until verified (implementation note only) |

**Not in scope:** `packages/client-core` (already Bearer), `apps/web-pms` source, `provision.ts`, city-ledger paths, catalog, `v1-http-routes.ts`, PropertyDO/OrgDO migrations, HKDF (N6), guest-list SQL (S2).

---

## 10. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new HTTP route, catalog command, event type, or schema migration.

---

## 11. Out of scope

- R0.1 provision graft (done — do not touch)
- R0.3 direct-bill city ledger / AR (L1–L4)
- R0.5 per-org HKDF / master-key rotation (N6)
- Guest list SQL / property-scoped OrgDO PII (S2)
- Clerk Organizations, custom JWT claims, invitation UI
- Playwright e2e; expanding smoke beyond existing 10-step script (except header/azp sanity)
- Changing SPA auth from Bearer to cookies
- `*` in authorized parties
- New Settings controls

---

## 12. Success criteria

1. Staging `wrangler.jsonc` includes `CLERK_AUTHORIZED_PARTIES` matching live workers.dev origin (no `*`).
2. Staging/production-shaped env with **empty** parties returns **401** without calling Clerk; `HOSPAI_UNSAFE_LOCAL=1` retains explicit local escape.
3. Wrong `azp` → **401**; matching origin/token → success path works in tests.
4. Mutating `/v1` rejects cookie-only POST without permitted Origin → **401**.
5. `/v1` JSON and SPA HTML both carry the full security header set including `Permissions-Policy` and enforced CSP.
6. Smoke workflow masks JWT before `GITHUB_OUTPUT`; secrets remain in `env:`.
7. Lock 4 in staging-deploy spec **unchecked** until post-deploy verification.
8. Characterization tests **T1, T5, T8, T9** would have failed on pre-fix `main`; T2/T3 present as regression guards; `pnpm test:local` green; all pins unchanged.

---

## 13. Relationship to prior Clerk specs

[2026-07-28-clerk-auth-design.md](./2026-07-28-clerk-auth-design.md) established Worker-side Clerk verify and Bearer transport — **unchanged**. [2026-08-13-sign-in-clerk-design.md](./2026-08-13-sign-in-clerk-design.md) landed Bearer via `clerk-credentials.ts` — **unchanged**; this slice hardens the Worker edge to match that contract and closes the cookie CSRF hole. [2026-08-16-staging-deploy-smoke-design.md](./2026-08-16-staging-deploy-smoke-design.md) Lock 4 assumed `CLERK_AUTHORIZED_PARTIES` — **reopen** until this vertical lands.
