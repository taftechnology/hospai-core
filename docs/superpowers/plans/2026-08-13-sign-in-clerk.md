# Sign-in that is not a lab flag (P0-4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Replace the `/sign-in` dead paragraph and the demo-machine `X-Dev-Actor` lab flag with a HospAI-branded email+password surface backed by Clerk (`@clerk/react` custom `useSignIn`), Bearer tokens on HTTP, and a WebSocket subprotocol the Vite two-process demo can actually send. Keep the engineer/test `user_owner` path. Password-gate is a presentation fallback, not a third identity system.

**Architecture:** Worker `resolveActor` already verifies `Authorization: Bearer <session_jwt>`. This chunk adds one Worker branch: `Sec-WebSocket-Protocol: hospai.clerk.<jwt>` is rewritten to that same Bearer path (no second verifier). The SPA mounts `ClerkProvider` only in `main.tsx` and only on the Clerk happy path; a module-singleton token getter (`ClerkTokenBridge` → `createClerkCredentials`) is the only bridge between React `useAuth().getToken` and the existing `client-core` transport. `/sign-in` stays a sibling of `AppShell`. A thin `ClerkSignedInGate` wraps `AppShell` so `/me` does not fire until Clerk reports `isLoaded && isSignedIn`. `SignInScreen` selects among four modes from spec §3.3.

**Tech Stack:** React 19 SPA (`apps/web-pms`, Vite 6.3), `@clerk/react` (current SDK; **not** `@clerk/clerk-react`), existing `@clerk/backend@3.13.2` on the Worker, `client-core` `CredentialProvider`, vitest + Testing Library. No Tailwind, no `@clerk/ui`.

**Spec:** `docs/superpowers/specs/2026-08-13-sign-in-clerk-design.md` (Approved). Spec commit: `a58c9c4`.

---

## Sequencing gate (read before starting)

This is **P0-4**. DEMO-READY: work P0 in order.

| After this plan | Do not start |
|---|---|
| Tick DEMO-READY P0-4 in Task 5 | **P0-5** (8-minute script, dry runs, dashboard checklist execution) |
| — | UI convergence batches 1–7 (they wait for P0-4 **and** P0-5) |

Do not execute the Clerk dashboard checklist, the members-by-email mapping curl, or a live Clerk sign-in in this chunk. Document them for P0-5 (Task 5).

---

## Open decisions (locked here; spec left these to the plan)

### D1 — Token bridge (`ClerkTokenBridge` + module singleton)

**Locked:** `apps/web-pms/src/providers/clerk-credentials.ts` owns a module-level getter:

```ts
export type ClerkTokenGetter = () => Promise<string | null>;

let tokenGetter: ClerkTokenGetter | null = null;

export function registerClerkTokenGetter(getter: ClerkTokenGetter | null): void {
  tokenGetter = getter;
}

export async function getClerkSessionToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  const token = await tokenGetter();
  return token || null; // never "null" / "undefined" string
}
```

`createClerkCredentials().getCredentialHeaders` is **async**. If `getClerkSessionToken()` is `null`, return `{}` (no `Authorization` key). If a token is present, return `{ authorization: 'Bearer ' + token }`. Transport already `await`s (`packages/client-core/src/transport.ts:19`).

`ClerkTokenBridge` (new, `providers/ClerkTokenBridge.tsx`) is the only React subscriber:

- Calls `useAuth().getToken` (default session JWT — **no** `template` option).
- **Registers the getter during render** (`registerClerkTokenGetter(() => getToken())`), not only in `useEffect`. Reason: if Clerk hydrates `isLoaded && isSignedIn` on the first paint, a `useEffect`-only register races `AppShell`'s first `/me`. Render-time register plus `useEffect` cleanup (`registerClerkTokenGetter(null)` on unmount) is the bridge. React 19 StrictMode remount re-registers on the second render after the first effect cleanup; the settled state is registered.
- Renders `null`.
- Mounts in `main.tsx` **inside** `ClerkProvider`, as a sibling of `App`, **only** when `spaAuthMode() === 'clerk'`.

`getClerkSessionToken` is also what Task 4's `FrontOfficeLive` calls. One getter, two consumers (HTTP headers and WS protocol). Do not add a second fetch interceptor, Query middleware, or `localStorage` token cache. Clerk owns session storage.

`client.ts` **does not change**. The module-load switch `VITE_USE_DEV_ACTOR === '1'` → `createDevActorCredentials` else `createClerkCredentials` stays.

### D2 — Clerk signed-out gate lives in a thin wrapper, not inside `App.tsx` and not inside `AppShell`

**Locked:** new `apps/web-pms/src/providers/ClerkSignedInGate.tsx`, used as:

```tsx
<Route element={<ClerkSignedInGate><AppShell /></ClerkSignedInGate>}>
```

**Reason:** spec §9 says `AppShell` stays `/me`-centric. Putting `useAuth` in `AppShell` would fire Clerk hooks on the engineer/test path (no `ClerkProvider` — crash) and would couple chrome to the SDK. Putting the hook directly in `App.tsx` as a single function would either (a) call `useAuth` unconditionally (tests import `App`, not `main`, and have no provider) or (b) call it behind an `if` (rules of hooks). Two components in one file:

1. `ClerkSignedInGate` — if `spaAuthMode() !== 'clerk'`, return `children` (pass-through). Else mount (2).
2. `ClerkSessionGate` — **always** calls `useAuth()`. If `!isLoaded`, return `null` (blank `--bg`, no shell flash). If `isLoaded && !isSignedIn`, `window.location.assign('/sign-in')` and return `null` (same assign as today's 401 path; no `?next=`). If `isLoaded && isSignedIn`, return `children`.

Ignore `useAuth().orgId` / `orgRole` if present (ARCHITECTURE §13).

`AppShell.tsx` is **not** edited. Its 401 `assign('/sign-in')` stays; `AppShell.me.test.tsx` stays unmodified.

### D3 — `SignInScreen` mode selection (spec §3.3)

**Locked:** pure function `spaAuthMode(env = import.meta.env)` in `apps/web-pms/src/providers/spa-auth-mode.ts`. This is the test seam — Vite inlines `import.meta.env.VITE_*`, so component tests **mock this module** rather than fighting `vi.stubEnv`.

| `VITE_USE_DEV_ACTOR` | `VITE_CLERK_PUBLISHABLE_KEY` | `VITE_DEMO_PASSWORD` | `spaAuthMode` | UI |
|---|---|---|---|---|
| `'1'` | ignored | unset / `''` | `'engineer'` | no form; `<Navigate to="/board" replace />` |
| `'1'` | ignored | non-empty | `'password-gate'` | same chrome; unlock vs `VITE_DEMO_EMAIL` (default `demo@hospai.local`) + password; `sessionStorage['hospai.demo-unlock'] === '1'` skips the form on refresh |
| not `'1'` | starts with `pk_` | ignored | `'clerk'` | mount `ClerkSignInForm` (the only child that calls `useSignIn`) |
| not `'1'` | missing / not `pk_` | * | `'misconfigured'` | chrome + "Sign-in is not configured."; **no** submit control |

`VITE_USE_DEV_ACTOR === '1'` wins even if a publishable key is also set (spec table: key is ignored). `ClerkProvider` mounts in `main.tsx` **iff** `spaAuthMode() === 'clerk'` (key present **and** flag not `'1'`). That satisfies invariant 10 (no provider in tests) and §3.3 (engineer path has no provider).

`ClerkSignInForm` is an unexported function in `SignInScreen.tsx`. It is rendered only when mode is `'clerk'`, so `useSignIn` is never called without `ClerkProvider`.

**Clerk hook API (confirmed 2026-08-13):** `user-clerk` MCP snippet `use-sign-in` still documents `{ isLoaded, signIn, setActive }` with `signIn.create({ identifier, password })` then `setActive({ session: result.createdSessionId })`. Import from **`@clerk/react`**, not `@clerk/clerk-react` (MCP snippets still show the Core 2 package name — do not copy that import). The clerk-custom-ui **core-3** skill documents a Future API (`signIn.password` / `signIn.finalize`). **Do not use the Future API.** After `pnpm add`, if the installed `useSignIn` types do not include `signIn.create` and `setActive`, **stop and ask** — do not silently switch.

On `result.status === 'complete'`: `await setActive(...)` then `navigate('/board')`. On `needs_second_factor`: existing `.error` copy **exactly** `This account needs a second step. Use the demo user.` On any other non-complete status: `Could not sign in.` On thrown Clerk errors: `err.errors?.[0]?.message` or `Could not sign in.` Do not build TOTP / OAuth / sign-up / reset.

Password-gate compare: email trimmed, case-insensitive; password exact. Wrong pair → `Email or password is wrong.` (do not specify which). Do not put the password in `sessionStorage`, placeholders, or copy. Do not mention `X-Dev-Actor`, `user_owner`, or "dev".

---

## Global Constraints

- **Heads frozen.** `COMMAND_CATALOG` length **77**. `AUDIT_WRITER_COMMAND_IDS.size` **52**. `PLATFORM_GAPS` `[]`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. `PROPERTY_SCHEMA_HEAD` **25**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS.length` **7**. `pnpm generate:ddl` is a no-op diff. No new Worker **route**, catalog id, command, or DO table. The only Worker source edit in this plan is `apps/pms-core/src/auth.ts` (`resolveActor` Clerk WS protocol) plus `apps/pms-core/test/auth.spec.ts`.
- **`CLASS_DENYLIST` unchanged.** No `export class`. Sign-in is functions.
- **44 existing web-pms test files pass unmodified.** Do not edit any of the 44 files under `apps/web-pms/src/**/*.test.{ts,tsx}` that exist at plan time. New test files are allowed.
- **All 109 existing `data-testid` values stay** on the same control with the same string. New testids on `/sign-in` only: `sign-in`, `sign-in-email`, `sign-in-password`, `sign-in-submit` (spec §10). Error uses `role="alert"`; no requirement to reuse `me-no-access`.
- **No new hex.** Sign-in CSS uses existing `var(--*)`. Tan `#C18C5D` is fill-only (not this chunk). `tokens.css` is not touched. `pnpm check:web-pms-colors` stays green.
- **No Tailwind, `@clerk/ui`, `@clerk/themes`, `@clerk/clerk-react`, lucide, motion, shadcn.** `@clerk/react` is the **only** new dependency. Worker stays `@clerk/backend@3.13.2`.
- **No `publishableKey` prop on `ClerkProvider`.** Vite quickstart: the SDK reads `VITE_CLERK_PUBLISHABLE_KEY`. Do not pass `appearance`, `afterSignOutUrl`, or prebuilt `<SignIn />` / `<SignInButton>` / `<UserButton>` / `<Show>`.
- **No sign-out / sign-up / MFA / OAuth UI.** `needs_second_factor` is an error string, not a TOTP form.
- **`ClerkProvider` only in `main.tsx`, only when `spaAuthMode() === 'clerk'`.** Tests import `App` / screens, not `main`, and must not require Clerk. SignInScreen tests mock the `useSignIn` module — no live Clerk, no publishable key in vitest.
- **`client.ts`, `dev-actor-credentials.ts`, `AppShell.tsx`, `auth/me.ts`, `config/tenant.ts`, `v1-dispatch.ts`, `clerk-lookup.ts`, demo-seed, `COMMAND_CATALOG`, schema, `NAV_ENTRIES`, `tokens.css` are not edited** by any task.
- **Password-gate is not production auth** (invariant 13). Network-tab `x-dev-actor` on that path is accepted and named.
- **After successful sign-in, land on `/board`.** No `?next=`. Deep links do not restore.
- **Unsharded `pnpm --filter @hospai/pms-core test` segfaults.** Use `pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- **Scope-out (do not implement):** P0-5 script/dry runs/dashboard execution, ui-kit batches 1–7, Clerk Organizations, custom JWT claims, hosted Account Portal, prebuilt Clerk chrome, new Worker routes, seed fixture changes, replacing `user_owner` in tests/seed/README curls.
- Living plan checkboxes: tick `- [x]` on merge only (Task 6). Do not backfill historical plans.

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/src/auth.ts` | `resolveActor`: `hospai.clerk.<jwt>` → synthetic Bearer → existing `authenticateClerkSession` | 1 |
| `apps/pms-core/test/auth.spec.ts` | Protocol success / bad JWT 401 / unconfigured 401 / prefix isolation; existing Bearer test stays | 1 |
| `apps/web-pms/package.json` + lockfile | `@clerk/react` only new dep | 2 |
| `apps/web-pms/vitest.config.ts` | jsdom glob for `src/providers/**/*.test.tsx` | 2 |
| `apps/web-pms/src/vite-env.d.ts` | `VITE_DEMO_PASSWORD?` / `VITE_DEMO_EMAIL?` | 2 |
| `apps/web-pms/src/providers/spa-auth-mode.ts` | **New.** §3.3 table as a pure function | 2 |
| `apps/web-pms/src/providers/clerk-credentials.ts` | Bearer from registered getter; export `getClerkSessionToken` | 2 |
| `apps/web-pms/src/providers/ClerkTokenBridge.tsx` | **New.** `useAuth().getToken` → register getter | 2 |
| `apps/web-pms/src/providers/ClerkSignedInGate.tsx` | **New.** Pass-through or wait-for-`isLoaded` / assign `/sign-in` | 2 |
| `apps/web-pms/src/main.tsx` | Conditional `ClerkProvider` + `ClerkTokenBridge`; no `publishableKey` | 2 |
| `apps/web-pms/src/App.tsx` | Gate wrap around `AppShell` (Task 2); `/sign-in` → `SignInScreen` (Task 3) | 2, 3 |
| `apps/web-pms/src/screens/SignInScreen.tsx` | **New.** Chrome + four modes | 3 |
| `apps/web-pms/src/styles.css` | `.sign-in` / `.sign-in-card` block; tokens only | 3 |
| `apps/web-pms/src/screens/SignInScreen.test.tsx` | **New.** Password-gate + misconfigured + engineer + mocked Clerk child | 3 |
| `apps/web-pms/src/shell/FrontOfficeLive.tsx` | Clerk subprotocol when not dev-actor; **sync** createSocket on the dev-actor path | 4 |
| `apps/web-pms/src/shell/FrontOfficeLive.protocol.test.ts` | **New.** Pure protocol helper | 4 |
| `apps/web-pms/.env.example` | Commented Clerk / demo-gate lines; keep `VITE_USE_DEV_ACTOR=1` | 5 |
| `apps/pms-core/.dev.vars.example` | Commented `CLERK_*` | 5 |
| `README.md` | Engineer path unchanged; demo path is Clerk; §6.2 mapping curl for P0-5 | 5 |
| `DEMO-READY.md` | Tick P0-4 | 5 |
| this plan file | Tick checkboxes | 6 |

**Not touched:** `tokens.css`, `auth/me.ts`, `config/tenant.ts`, `client.ts` (switch stays), `providers/dev-actor-credentials.ts`, `AppShell.tsx`, `v1-dispatch.ts`, `clerk-lookup.ts`, demo-seed, catalog, schema, `NAV_ENTRIES`, `wrangler.jsonc` `vars`.

## Test file split (spec §12 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 heads / ddl / denylist | `packages/contracts` register test + `migrate.test.ts` + `pnpm generate:ddl` + `pnpm check:class-denylist` | 6 |
| 3–4 44 unmodified web-pms files + existing auth.spec Bearer | diff + full web-pms run + `test/auth.spec.ts` | 1–4, 6 |
| 5 engineer path / no ClerkProvider required to render `App` | existing 44 files (default `.env` is `VITE_USE_DEV_ACTOR=1`) + `spa-auth-mode.test.ts` | 2, 3 |
| 6 Bearer once bridge has a token; no `x-dev-actor` | `clerk-credentials.test.ts` | 2 |
| 7 misconfigured copy; submit absent | `SignInScreen.test.tsx` | 3 |
| 8–12 `/sign-in` chrome, testids, copy bans, password-gate, mocked Clerk child, `.btn-primary` | `SignInScreen.test.tsx` | 3 |
| 13–15 AppShell 401 assign, `me-no-access`, 109 testids, `shell-role` | existing `AppShell.me.test.tsx` **unmodified** | (pin, all tasks) |
| 16–20 Worker WS protocol | `apps/pms-core/test/auth.spec.ts` new describe | 1 |
| 21–24 forbidden deps, no new hex, no new V1 id, colour gate | Task 5 grep + Task 6 CI | 5, 6 |

---

### Task 1: Worker WS Clerk subprotocol + `auth.spec` coverage

**Spec:** §4.3, §4.4, §8, §12.16–20.

**Files:**
- Modify: `apps/pms-core/src/auth.ts` (`resolveActor` only)
- Modify: `apps/pms-core/test/auth.spec.ts` (add a describe; do not rewrite the existing mocked Bearer test at lines 189–254)

**Forbidden this commit:** any SPA file, `v1-dispatch.ts`, `property-do.ts`, catalog, schema, `.dev.vars.example`, README, DEMO-READY.

**Produces:** `resolveActor` accepts `Sec-WebSocket-Protocol: hospai.clerk.<jwt>` when Clerk is configured, by building a synthetic `Request` with `Authorization: Bearer <jwt>` and calling the existing private `authenticateClerkSession`. HTTP Bearer path unchanged.

- [ ] **Step 1: Write the failing `auth.spec.ts` cases (TDD)**

Add a new `describe('Clerk WebSocket protocol (mocked)', …)` next to the existing `describe('Clerk path (mocked)', …)` (line 179). Reuse `__setAuthenticateRequestForTest` / `afterEach` reset. Call **`resolveActor` directly** (exported) — do not provision an org; these cases are protocol parsing, not membership.

Import `resolveActor` from `../src/auth.js`.

Shared `clerkEnv`:

```ts
const clerkEnv = {
  ...env,
  HOSPAI_ALLOW_DEV_ACTOR: undefined,
  CLERK_SECRET_KEY: 'sk_test',
  CLERK_PUBLISHABLE_KEY: 'pk_test',
  CLERK_JWT_KEY: 'pem',
};
```

Cases (spec §12.16–20):

1. **Dev-actor protocol unchanged** (flags on, no Clerk keys needed): `Sec-WebSocket-Protocol: hospai.dev-actor.user_x` → `{ userId: 'user_x', source: 'dev' }`. `authenticateRequest` is **not** called.
2. **Clerk protocol success:** flags off, Clerk configured, protocol `hospai.clerk.session_jwt`, mock `isAuthenticated: true` / `toAuth: () => ({ userId: 'user_clerk_ws' })`. `resolveActor` returns `{ userId: 'user_clerk_ws', source: 'clerk' }`. `authenticateRequest` was invoked with a `Request` whose `authorization` header is `Bearer session_jwt` (read `authenticateRequest.mock.calls[0][0].headers.get('authorization')`).
3. **Bad JWT → 401:** same protocol, mock `isAuthenticated: false` → `Response` status 401, body `{ error: 'unauthenticated', message: 'Invalid or missing session.' }` (same message as today's Bearer miss).
4. **Clerk unconfigured:** `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` unset, protocol `hospai.clerk.session_jwt` → 401 whose message starts with `Authentication unavailable.` Do **not** treat the remainder as a dev actor. `authenticateRequest` is not called.
5. **Prefix isolation:** flags **on** (`isDevActorAllowed`), protocol `hospai.clerk.session_jwt` (no `x-dev-actor` header), Clerk configured, mock authenticated `user_clerk_ws`. Result source is `'clerk'`, userId `user_clerk_ws` — the token must not be parsed as `x-dev-actor`. Comma-separated header: first token wins, matching today's `protocol.split(',')[0]?.trim()` (send `hospai.clerk.session_jwt, leftover` and still Bearer `session_jwt`).

Empty remainder (`hospai.clerk.` with nothing after) still goes through `authenticateClerkSession` (expect 401 from the mock / unauthenticated). Do not invent a special empty-jwt error.

- [ ] **Step 2: Run the new file and confirm the new cases fail**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts
```

Expected: existing tests pass; new protocol cases fail (no `hospai.clerk.` branch yet).

- [ ] **Step 3: Implement the branch in `resolveActor`**

Insert **after** the existing `isDevActorAllowed` block (header + `hospai.dev-actor.`) and **after** the `if (!clerkConfigured(env))` early return, **before** the current `authenticateClerkSession(request, env)` call. Shape:

```ts
  if (!clerkConfigured(env)) {
    return unauthorized(
      'Authentication unavailable. Configure Clerk secrets or enable local dev actor (HOSPAI_UNSAFE_LOCAL + HOSPAI_ALLOW_DEV_ACTOR).',
    );
  }

  const protocolHeader = request.headers.get('Sec-WebSocket-Protocol');
  const protocolToken = protocolHeader?.split(',')[0]?.trim() ?? '';
  const clerkPrefix = 'hospai.clerk.';
  const clerkRequest = protocolToken.startsWith(clerkPrefix)
    ? new Request(request.url, {
        method: request.method,
        headers: { authorization: `Bearer ${protocolToken.slice(clerkPrefix.length)}` },
      })
    : request;

  const state = await authenticateClerkSession(clerkRequest, env);
  // existing isAuthenticated / toAuth / userId handling unchanged
```

Do **not** export `authenticateClerkSession`. Do **not** copy `x-dev-actor` onto the synthetic request. Cookies on the **original** request remain valid when the Clerk protocol is absent (`clerkRequest === request`). Prefix is load-bearing: never send/parse a raw JWT as the protocol; never reuse `hospai.dev-actor.` for Clerk ids.

- [ ] **Step 4: Re-run `auth.spec.ts` and confirm the existing Bearer test still passes**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts
```

Expected: all cases green, including `verified Clerk session succeeds when member` (lines 189–254) which still sends `authorization: 'Bearer session_jwt'` as an HTTP header.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/auth.ts apps/pms-core/test/auth.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): accept Clerk session JWT on WebSocket subprotocol

Browser WebSocket cannot set Authorization, and the Vite demo is not
same-site with Clerk cookies. resolveActor now reads
Sec-WebSocket-Protocol hospai.clerk.<jwt>, builds a synthetic Bearer
request, and reuses authenticateClerkSession. Dev-actor protocol and
HTTP Bearer are unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: SPA credential/token bridge + `ClerkProvider` wiring + signed-out gate

**Spec:** §4.1, §4.2, §7.1, invariant 10–11, §9 (`main.tsx`, credentials, gate).

**Files:**
- Modify: `apps/web-pms/package.json` (and the repo lockfile)
- Modify: `apps/web-pms/vitest.config.ts` (jsdom glob)
- Modify: `apps/web-pms/src/vite-env.d.ts`
- Modify: `apps/web-pms/src/providers/clerk-credentials.ts`
- Modify: `apps/web-pms/src/main.tsx`
- Modify: `apps/web-pms/src/App.tsx` (gate wrap **only**; leave the `/sign-in` paragraph for Task 3)
- Add: `apps/web-pms/src/providers/spa-auth-mode.ts`
- Add: `apps/web-pms/src/providers/spa-auth-mode.test.ts`
- Add: `apps/web-pms/src/providers/clerk-credentials.test.ts`
- Add: `apps/web-pms/src/providers/ClerkTokenBridge.tsx`
- Add: `apps/web-pms/src/providers/ClerkSignedInGate.tsx`
- Add: `apps/web-pms/src/providers/ClerkSignedInGate.test.tsx`

**Forbidden this commit:** `SignInScreen`, `styles.css`, `FrontOfficeLive.tsx`, `auth.ts`, `client.ts`, `AppShell.tsx`, `.env.example`, `.dev.vars.example`, README, DEMO-READY, any of the 44 existing test files, `publishableKey` prop, `@clerk/ui` / `@clerk/clerk-react`.

**Consumes:** nothing from Task 1 (SPA-only).

**Produces:** `spaAuthMode`, `demoGateEmail`, `demoGatePassword`, `registerClerkTokenGetter`, `getClerkSessionToken`, `createClerkCredentials` (async Bearer), `ClerkTokenBridge`, `ClerkSignedInGate`.

- [ ] **Step 1: Install `@clerk/react` and confirm the classic `useSignIn` shape**

```bash
pnpm --filter @hospai/web-pms add @clerk/react
```

Do **not** add `@clerk/clerk-react`, `@clerk/ui`, `@clerk/themes`, `@clerk/nextjs`.

Open the installed types (or `node_modules/@clerk/react`) and confirm `useSignIn` returns `{ isLoaded, signIn, setActive }` with `signIn.create`. If the installed major only exposes `signIn.password` / `signIn.finalize` (Future API), **stop**. Record the installed version in the commit body.

- [ ] **Step 2: `spaAuthMode` — tests first, then the table**

`apps/web-pms/src/providers/spa-auth-mode.ts`:

```ts
export type SpaAuthMode = 'engineer' | 'password-gate' | 'clerk' | 'misconfigured';

export type SpaAuthEnv = {
  VITE_USE_DEV_ACTOR?: string;
  VITE_CLERK_PUBLISHABLE_KEY?: string;
  VITE_DEMO_PASSWORD?: string;
  VITE_DEMO_EMAIL?: string;
};

export function spaAuthMode(env: SpaAuthEnv = import.meta.env): SpaAuthMode {
  if (env.VITE_USE_DEV_ACTOR === '1') {
    return env.VITE_DEMO_PASSWORD ? 'password-gate' : 'engineer';
  }
  const pk = env.VITE_CLERK_PUBLISHABLE_KEY ?? '';
  if (pk.startsWith('pk_')) return 'clerk';
  return 'misconfigured';
}

export function demoGateEmail(env: SpaAuthEnv = import.meta.env): string {
  return env.VITE_DEMO_EMAIL?.trim() || 'demo@hospai.local';
}

export function demoGatePassword(env: SpaAuthEnv = import.meta.env): string {
  return env.VITE_DEMO_PASSWORD ?? '';
}
```

`spa-auth-mode.test.ts` asserts the four rows in D3 (including: flag `'1'` + `pk_test_x` + no password → `'engineer'`; flag unset + `pk_live_x` → `'clerk'`; flag unset + `not-a-key` → `'misconfigured'`; empty-string password → `'engineer'`). Also pin `demoGateEmail({}) === 'demo@hospai.local'` and `demoGatePassword({}) === ''`.

Add to `vite-env.d.ts`:

```ts
  readonly VITE_DEMO_PASSWORD?: string;
  readonly VITE_DEMO_EMAIL?: string;
```

(`VITE_CLERK_PUBLISHABLE_KEY` is already declared.)

- [ ] **Step 3: Bearer credentials — tests first, then the getter**

`clerk-credentials.test.ts` (node env is fine):

1. No getter registered → `getCredentialHeaders()` resolves to `{}`.
2. Getter returns `'session_jwt'` → `{ authorization: 'Bearer session_jwt' }`. **No** `x-dev-actor` key.
3. Getter returns `null` → `{}` (do not send `Bearer null`).
4. `registerClerkTokenGetter(null)` after a previous register → `{}` again.
5. `getClerkSessionToken()` with no getter → `null`.

Then replace the stub in `clerk-credentials.ts` (delete the cookies comment). Implement D1's getter + async `getCredentialHeaders`. `dev-actor-credentials.ts` and `client.ts` stay as they are.

- [ ] **Step 4: `ClerkTokenBridge`**

```tsx
import { useAuth } from '@clerk/react';
import { useEffect } from 'react';
import { registerClerkTokenGetter } from './clerk-credentials.js';

export function ClerkTokenBridge() {
  const { getToken } = useAuth();
  registerClerkTokenGetter(() => getToken());
  useEffect(() => () => registerClerkTokenGetter(null), []);
  return null;
}
```

`getToken()` is called with **no** arguments (default session JWT, no template).

- [ ] **Step 5: `ClerkSignedInGate` + tests**

Implement D2. Extend `vitest.config.ts` `environmentMatchGlobs` with `['src/providers/**/*.test.tsx', 'jsdom']`.

`ClerkSignedInGate.test.tsx`:

- Mock `@clerk/react` `useAuth`.
- Mock `spa-auth-mode.js` with a mutable `currentMode` (hoisted).
- `engineer` / `password-gate` / `misconfigured`: children render; `useAuth` **not** required to succeed (pass-through must not mount `ClerkSessionGate`).
- `clerk` + `{ isLoaded: false }`: children absent.
- `clerk` + `{ isLoaded: true, isSignedIn: false }`: `location.assign` called with `'/sign-in'`; children absent.
- `clerk` + `{ isLoaded: true, isSignedIn: true }`: children render; `assign` not called.

Stub `location.assign` the same way `AppShell.me.test.tsx` does (`vi.stubGlobal('location', { ...window.location, assign })`).

- [ ] **Step 6: Wire `main.tsx` and `App.tsx`**

`main.tsx` — no `publishableKey` prop, no `appearance`, no `afterSignOutUrl`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { App } from './App.js';
import { ClerkTokenBridge } from './providers/ClerkTokenBridge.js';
import { spaAuthMode } from './providers/spa-auth-mode.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root_missing');

const tree =
  spaAuthMode() === 'clerk' ? (
    <ClerkProvider>
      <ClerkTokenBridge />
      <App />
    </ClerkProvider>
  ) : (
    <App />
  );

createRoot(root).render(<StrictMode>{tree}</StrictMode>);
```

`App.tsx`: wrap **only** the `AppShell` route element. Leave `<Route path="sign-in" element={<p className="main">Sign in required</p>} />` untouched until Task 3.

```tsx
<Route element={<ClerkSignedInGate><AppShell /></ClerkSignedInGate>}>
```

- [ ] **Step 7: Verify**

```bash
pnpm --filter @hospai/web-pms test
pnpm --filter @hospai/web-pms typecheck
```

Confirm:

```bash
git diff --name-only -- 'apps/web-pms/src/**/*.test.ts' 'apps/web-pms/src/**/*.test.tsx' | grep -vE 'providers/(spa-auth-mode|clerk-credentials|ClerkSignedInGate)' && echo FAIL || echo ok
```

The 44 existing files must not appear. Default vitest env still has `VITE_USE_DEV_ACTOR=1` from `.env` / `.env.example`, so `spaAuthMode` is `'engineer'`, the gate is pass-through, and `App` still renders without `ClerkProvider`.

Grep the new files for `publishableKey=` — must be empty. Grep `apps/web-pms/package.json` for `@clerk/react` present and `@clerk/ui` / `@clerk/clerk-react` absent.

- [ ] **Step 8: Commit**

```bash
git add apps/web-pms/package.json apps/web-pms/vitest.config.ts apps/web-pms/src pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web-pms): Clerk token bridge and signed-in gate

createClerkCredentials now sends Authorization Bearer from a getter
registered by ClerkTokenBridge (useAuth().getToken). ClerkProvider
mounts only in main.tsx on the Clerk spaAuthMode path, with no
publishableKey prop. A thin ClerkSignedInGate wraps AppShell so /me
waits for isLoaded; AppShell itself is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `SignInScreen` — one chrome, four modes, tests

**Spec:** §3.1–3.3, §5, §10, §12.7–12.

**Files:**
- Add: `apps/web-pms/src/screens/SignInScreen.tsx`
- Add: `apps/web-pms/src/screens/SignInScreen.test.tsx`
- Modify: `apps/web-pms/src/App.tsx` (`/sign-in` route only)
- Modify: `apps/web-pms/src/styles.css` (append `.sign-in*` ; do not edit `tokens.css`)

**Forbidden this commit:** `main.tsx`, `clerk-credentials.ts`, `FrontOfficeLive.tsx`, Worker, env-example files, README, DEMO-READY, `AppShell.tsx`, any of the 44 existing tests, new hex, Tailwind, prebuilt Clerk components, sign-up / forgot-password / social buttons, `?next=`.

**Consumes:** `spaAuthMode`, `demoGateEmail`, `demoGatePassword` from Task 2. `ClerkSignInForm` may import `useSignIn` from `@clerk/react`.

- [ ] **Step 1: CSS first so `check:class-resolution` stays green when TSX lands**

Append to `apps/web-pms/src/styles.css` (tokens only; no hex literals):

```css
.sign-in {
  min-block-size: 100dvh;
  display: grid;
  place-items: center;
  background: var(--bg);
  padding: 1.5rem;
}

.sign-in-card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 1.5rem;
  inline-size: min(100%, 22rem);
}

.sign-in-card h1 {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
}

.sign-in-card form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-block-start: 1rem;
}
```

Reuse `.app-sidebar-mark`, `.app-sidebar-title`, `.error`, `.muted`, `.btn-primary`, `.app-sidebar-brand`. No `@media print` (spec §5.1). No `tokens.css` edit.

- [ ] **Step 2: Write `SignInScreen.test.tsx` (jsdom via `src/screens/**/*.test.tsx`) before the component**

Hoist a mutable `mode: SpaAuthMode`. Mock:

```ts
vi.mock('../providers/spa-auth-mode.js', () => ({
  spaAuthMode: () => mode,
  demoGateEmail: () => 'demo@hospai.local',
}));
```

Mock `@clerk/react` `useSignIn` with hoisted `create` / `setActive` / `isLoaded`. Wrap renders in `MemoryRouter` + a `/board` route so `<Navigate>` is observable.

**Engineer (`mode = 'engineer'`):** navigating to `/sign-in` lands on `/board`. No `sign-in` testid (no form). This is what `.env.example` already is — tests that never visit `/sign-in` stay green.

**Misconfigured:** `getByTestId('sign-in')` exists. Heading "Sign in". Wordmark includes "HospAI". Copy includes "Sign-in is not configured." `queryByTestId('sign-in-submit')` is null. Document text does not match `/x-dev-actor|user_owner|vite_|clerk/i`.

**Password-gate:** do not read `import.meta.env` inside `SignInScreen` — Vite inlines `VITE_*` and `vi.stubEnv` is unreliable here. Call Task 2's `demoGateEmail` / `demoGatePassword` and mock those in this file (`demoGatePassword` → `'secret'`, `demoGateEmail` → `'demo@hospai.local'`).

- Wrong password → `role="alert"` with `Email or password is wrong.`; still on `/sign-in`.
- Correct email (case-insensitive, trim) + password → `sessionStorage['hospai.demo-unlock'] === '1'` and navigation to `/board`.
- Pre-set `sessionStorage` unlock → immediate `/board`, no form.
- Testids `sign-in`, `sign-in-email`, `sign-in-password`, `sign-in-submit` resolve. Submit is a `<button>` (or native submit) with class `btn-primary`. Inputs are `type="email"` / `type="password"` with `autocomplete` set (`username` / `current-password`). No placeholder equal to the password. Copy bans as above.

**Clerk child (`mode = 'clerk'`):**

- `create` resolves `{ status: 'complete', createdSessionId: 'sess_1' }` → `setActive` called with `{ session: 'sess_1' }` → `/board`.
- `create` resolves `{ status: 'needs_second_factor' }` → alert `This account needs a second step. Use the demo user.`; stay on `/sign-in`; `setActive` not called.
- `create` resolves `{ status: 'needs_first_factor' }` → alert `Could not sign in.`
- `create` rejects `{ errors: [{ message: 'Password is incorrect.' }] }` → that message in the alert.
- `isLoaded: false` → submit disabled (form still visible; no spinner copy).

Do **not** boot a real Clerk app. Do **not** set `VITE_CLERK_PUBLISHABLE_KEY` in vitest config.

- [ ] **Step 3: Implement `SignInScreen`**

Layout, top to bottom, inside `<div className="sign-in" data-testid="sign-in">` → `<div className="sign-in-card">`:

1. Wordmark: `<div className="app-sidebar-brand">` with `<span className="app-sidebar-mark">✦</span>` and `<p className="app-sidebar-title">HospAI <span>PMS</span></p>` (reuse classes; do not invent a second mark). Not an `h1` on the title — the heading below is the `h1`.
2. `<h1>Sign in</h1>`
3. `<p className="muted">Front desk</p>` — no "demo", "dev", "Clerk", "actor".
4. Mode body (D3).
5. Error slot: `<div className="error" role="alert">` only when there is a message.

`ClerkSignInForm` is a **separate function component in this file**, rendered only in the `'clerk'` branch. Native `<form>` / `<label>` / `<input>`. `data-testid` on the card wrapper (`sign-in`), email, password, submit.

Password-gate success: `sessionStorage.setItem('hospai.demo-unlock', '1')` then `<Navigate to="/board" replace />` (or `navigate`). Engineer: `<Navigate to="/board" replace />` immediately. Password-gate with unlock flag already set: same Navigate, skip the form.

Replace `App.tsx:78` with `<Route path="sign-in" element={<SignInScreen />} />`.

- [ ] **Step 4: Verify**

```bash
pnpm --filter @hospai/web-pms test
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:web-pms-me-gating
```

`git diff --name-only -- 'apps/web-pms/src/**/*.test.*'` must list **only** `SignInScreen.test.tsx`. The 44 stay unmodified. `AppShell.me.test.tsx` still asserts `assign('/sign-in')` — that test never renders the sign-in route.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/SignInScreen.tsx apps/web-pms/src/screens/SignInScreen.test.tsx apps/web-pms/src/App.tsx apps/web-pms/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web-pms): HospAI sign-in surface with Clerk, gate, and engineer modes

/sign-in is a branded card outside AppShell. spaAuthMode selects
engineer auto-redirect, password-gate fallback, Clerk useSignIn, or
misconfigured copy. New testids are sign-in / email / password / submit
only. SignIn tests mock useSignIn — no live Clerk.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `FrontOfficeLive` Clerk subprotocol

**Spec:** §4.3, tape leftover (Vite cannot send Bearer on `WebSocket`).

**Files:**
- Modify: `apps/web-pms/src/shell/FrontOfficeLive.tsx`
- Add: `apps/web-pms/src/shell/FrontOfficeLive.protocol.test.ts`

**Forbidden this commit:** `auth.ts` (already done), `SignInScreen`, `main.tsx`, env examples, README, DEMO-READY, **`FrontOfficeLive.test.tsx`** (one of the 44 — do not edit it), making `createSocket` async on the dev-actor path.

**Consumes:** `getClerkSessionToken()` from Task 2.

**Load-bearing for the 44:** `FrontOfficeLive.test.tsx` calls `renderLive` then **synchronously** `socket.onopen?.()` on a pre-built fake. `createSocket` must remain **synchronous** when `VITE_USE_DEV_ACTOR === '1'`. Only the Clerk branch may `await getClerkSessionToken()`. If you wrap the engineer path in `void (async () => …)`, those tests flake or pass vacuously.

- [ ] **Step 1: Export a pure helper and test it (node env — `.test.ts` is not on the jsdom glob)**

In `FrontOfficeLive.tsx`:

```ts
export function frontOfficeAuthProtocol(opts: {
  useDevActor: boolean;
  devActor: string;
  clerkToken: string | null;
}): string[] | undefined {
  if (opts.useDevActor) return [`hospai.dev-actor.${opts.devActor}`];
  if (opts.clerkToken) return [`hospai.clerk.${opts.clerkToken}`];
  return undefined;
}
```

`FrontOfficeLive.protocol.test.ts`:

- `useDevActor: true` → `['hospai.dev-actor.user_owner']` even if `clerkToken` is set.
- `useDevActor: false`, token `'jwt.abc'` → `['hospai.clerk.jwt.abc']`.
- `useDevActor: false`, token `null` → `undefined` (cookie fallback / 401; do not send `hospai.clerk.null`).

- [ ] **Step 2: Wire `connect` without breaking the sync engineer path**

Replace the current `protocols` const (lines 111–114) with a split `open(protocols)` used by both branches. Sketch:

```ts
    const open = (protocols: string | string[] | undefined) => {
      if (cancelled) return;
      const socket = createSocket(frontOfficeStreamUrl(tenant.propertyId), protocols);
      // existing onopen / onmessage / onclose / onerror unchanged
    };

    const connect = () => {
      if (cancelled) return;
      if (import.meta.env.VITE_USE_DEV_ACTOR === '1') {
        open(
          frontOfficeAuthProtocol({
            useDevActor: true,
            devActor: import.meta.env.VITE_DEV_ACTOR || 'user_owner',
            clerkToken: null,
          }),
        );
        return;
      }
      void (async () => {
        const clerkToken = await getClerkSessionToken();
        if (cancelled) return;
        open(
          frontOfficeAuthProtocol({
            useDevActor: false,
            devActor: 'user_owner',
            clerkToken,
          }),
        );
      })();
    };
```

Do not put the JWT in the URL (`?token=` is forbidden). Dev-actor protocol row unchanged. Reconnect must call `getClerkSessionToken()` again (fresh JWT), which this does because `connect` re-enters the async branch.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @hospai/web-pms test
```

`FrontOfficeLive.test.tsx` unmodified and green. New protocol file green.

- [ ] **Step 4: Commit**

```bash
git add apps/web-pms/src/shell/FrontOfficeLive.tsx apps/web-pms/src/shell/FrontOfficeLive.protocol.test.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): send Clerk session JWT as live-board WS subprotocol

When VITE_USE_DEV_ACTOR is not 1, FrontOfficeLive passes
hospai.clerk.<jwt> from the same getClerkSessionToken bridge HTTP uses.
The engineer createSocket path stays synchronous so existing live-board
tests keep attaching onopen in the same tick.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Env examples, README pointer, DEMO-READY tick

**Spec:** §6.2, §7, §9 README/DEMO-READY, §14 last docs bullets.

**Files:**
- Modify: `apps/web-pms/.env.example`
- Modify: `apps/pms-core/.dev.vars.example`
- Modify: `README.md` (the auth paragraph around lines 62–73 plus a short demo subsection)
- Modify: `DEMO-READY.md` P0-4 checkboxes

**Forbidden this commit:** SPA/Worker source, real keys, `wrangler.jsonc` `vars`, ticking P0-5, starting ui-kit batches, committing `.env` or `.dev.vars`.

- [ ] **Step 1: `apps/web-pms/.env.example`**

Keep `VITE_USE_DEV_ACTOR=1` and `VITE_DEV_ACTOR=user_owner` as the engineer default. Keep the commented Clerk key. Add commented demo-gate lines. Exact shape:

```
VITE_ORG_ID=org_demo
VITE_PROPERTY_ID=prop_demo
VITE_USE_DEV_ACTOR=1
VITE_DEV_ACTOR=user_owner
# Demo happy path (P0-4): delete VITE_USE_DEV_ACTOR and set the publishable key.
# VITE_CLERK_PUBLISHABLE_KEY=pk_test_…
# Password-gate fallback (presentation only; still sends x-dev-actor). Leave unset for engineers.
# VITE_DEMO_PASSWORD=
# VITE_DEMO_EMAIL=demo@hospai.local
```

Do not enable the gate by default. Do not put a real password or `pk_` value.

- [ ] **Step 2: `apps/pms-core/.dev.vars.example`**

Append **commented** Clerk keys so P0-5 does not hunt `env.ts`. Do not uncomment them; do not add them to `wrangler.jsonc` `vars`.

```
# Clerk (demo happy path). Optional CLERK_JWT_KEY is a PEM; SDK fetches JWKS if omitted.
# CLERK_SECRET_KEY=sk_test_…
# CLERK_PUBLISHABLE_KEY=pk_test_…
# CLERK_JWT_KEY=
# CLERK_AUTHORIZED_PARTIES=http://localhost:5173
```

Leave `HOSPAI_UNSAFE_LOCAL=1` / `HOSPAI_ALLOW_DEV_ACTOR=1` as they are (engineer + seed curls). A Worker may have both Clerk keys and `ALLOW_DEV_ACTOR`; precedence is unchanged (header/protocol `hospai.dev-actor.` wins; Clerk SPA sends Bearer / `hospai.clerk.` and takes the Clerk path).

- [ ] **Step 3: README — one paragraph + the mapping curl P0-5 must run**

Keep every existing `x-dev-actor: user_owner` curl. After the current "Production auth uses **Clerk** (`Authorization: Bearer …`)." paragraph (README ~73), add that:

- Local engineer path is unchanged (`VITE_USE_DEV_ACTOR=1`, `/sign-in` redirects to `/board`).
- Demo path: unset `VITE_USE_DEV_ACTOR`, set `VITE_CLERK_PUBLISHABLE_KEY`, set Worker `CLERK_*`, custom `/sign-in` (not Clerk's hosted pages). Pointer: `docs/superpowers/specs/2026-08-13-sign-in-clerk-design.md`.
- Identity mapping is OrgDO, not Clerk roles. After seed (still `user_owner`) **and** after the Clerk user exists, P0-5 runs:

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/orgs/org_demo/members \
  -H 'content-type: application/json' \
  -H 'x-dev-actor: user_owner' \
  -d '{"email":"<the Clerk user email>","role":"owner"}'
```

Order is load-bearing: seed first, then this POST, then sign-in. Signing in before mapping is `me-no-access` (correct, not a SPA bug). Password-gate fallback needs no mapping.

- [ ] **Step 4: Tick DEMO-READY P0-4**

In `DEMO-READY.md` under `### P0-4. Sign-in that is not a lab flag`, tick the three boxes (`- [x]`). Do **not** tick P0-5. Do not rewrite the 8-minute table.

- [ ] **Step 5: Forbidden-dep and colour grep, then commit**

```bash
grep -E 'tailwindcss|@clerk/ui|@clerk/themes|@clerk/clerk-react|lucide-react|"motion"|shadcn' apps/web-pms/package.json && echo FAIL || echo ok
grep -E 'CLERK_' apps/pms-core/wrangler.jsonc && echo FAIL || echo ok
pnpm check:web-pms-colors
```

`@clerk/react` must remain in `apps/web-pms/package.json`. No real `sk_` / `pk_` in tracked files:

```bash
git grep -E 'sk_live_|sk_test_[A-Za-z0-9]{10,}|pk_live_|pk_test_[A-Za-z0-9]{10,}' -- ':!.env.example' ':!.dev.vars.example' && echo FAIL || echo ok
```

Placeholder `pk_test_…` / `sk_test_…` in example comments is fine.

```bash
git add apps/web-pms/.env.example apps/pms-core/.dev.vars.example README.md DEMO-READY.md
git commit -m "$(cat <<'EOF'
docs: Clerk demo env comments, mapping curl, tick P0-4

Engineer .env.example still defaults to VITE_USE_DEV_ACTOR=1. Demo path
and the OrgDO members-by-email curl are documented for P0-5. No keys
committed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: CI sequence + tick this plan

**Spec:** §12.1–4, §12.21–24, §14 stop line.

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-sign-in-clerk.md` (checkboxes only)

**Forbidden this commit:** any product code, starting P0-5, starting ui-kit batches 1–7.

- [ ] **Step 1: Heads + ddl no-op**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations packages/do-runtime
pnpm --filter @hospai/contracts test
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/night-audit-room-charges.spec.ts
```

Pins: `COMMAND_CATALOG` length 77, `AUDIT_WRITER_COMMAND_IDS.size === 52`, `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`, `PROPERTY_SCHEMA_HEAD === 25`, `ORG_SCHEMA_HEAD === 7`, `NIGHT_AUDIT_STEPS` length 7 (the night-audit spec file already asserts this).

- [ ] **Step 2: Full `checks` job from `.github/workflows/ci.yml` (copy order)**

```bash
pnpm install
pnpm build
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
```

Also run (in `package.json` but not yet in `ci.yml` — still required because Task 3 added classes):

```bash
pnpm check:class-resolution
```

- [ ] **Step 3: pms-core shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Do **not** run unsharded `pnpm --filter @hospai/pms-core test`.

- [ ] **Step 4: Tick every `- [ ]` on Tasks 1–6 in this file.** Do not backfill historical plans. Do not mix code fixes.

```bash
git add docs/superpowers/plans/2026-08-13-sign-in-clerk.md
git commit -m "$(cat <<'EOF'
docs: tick P0-4 sign-in plan checkboxes after merge

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

**Stop.** Do not start P0-5. Do not start ui-kit batches 1–7.

---

## Spec §15 reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state §1.1 matches the tree: `App.tsx:78` literal "Sign in required"; `client.ts` `VITE_USE_DEV_ACTOR === '1'` switch; `clerk-credentials.ts` empty headers; `.env.example` commented Clerk key; local `.env` has **no** Clerk line and `VITE_USE_DEV_ACTOR=1`; Worker `resolveActor` Bearer + `x-dev-actor` + `hospai.dev-actor.` protocol; `/me` is OrgDO; footer is `shell-role`; 44 tests; no `@clerk/react` yet; catalog **77**, route **127**, heads **25** / **7**.
- [ ] Defect table §1.2 is reproducible — especially defect 4 (WS cannot send Bearer under Vite) and defect 5 (Clerk `user_2…` ≠ seeded `user_owner`).
- [ ] **Decision Clerk vs fallback** is explicit: custom `useSignIn`, not hosted, not prebuilt; fallback trigger is dashboard keys missing, not a vague "if Clerk is hard."
- [ ] **Dev-actor gating table §3.3 / §7** keeps `.env.example = 1` for tests; demo happy path unsets it; password-gate is named as presentation in front of the same header.
- [ ] **Token flow:** HTTP Bearer, zero Worker HTTP change; WS protocol is the sole Worker edit and is justified (or the reviewer strikes it and accepts a stale tape).
- [ ] `/sign-in` is outside `AppShell`, on-brand, no lab copy; deep links do not restore; land `/board`.
- [ ] `/me` / footer mapping is OrgDO-only; members-by-email is the mapping mechanism; no Clerk roles; no new route.
- [ ] Scope-out names P0-5, ui-kit batches 1–7, Organizations, sign-up/MFA/OAuth, Tailwind/`@clerk/ui`, seed/catalog/schema.
- [ ] Invariants include frozen heads, 109 testids, 44 unmodified tests, no new hex.
- [ ] Acceptance tests §12 and this checklist present; leftover folded vs deferred present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn. Status is Draft, not Approved.

*(The last bullet is the spec-authoring checklist item. This plan file is the implementation plan that follows spec commit `a58c9c4`. Do not treat that last bullet as a reason to skip implementation after this plan is approved.)*

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §3.3 / §7.1 env gating table; invariant 5–7, 10 | 2 (`spaAuthMode`), 3 (UI), 5 (`.env.example` default stays `=1`) |
| §4.1 HTTP Bearer via existing `CredentialProvider`; no second interceptor | 2 |
| §4.1.3 `ClerkTokenBridge` + module singleton `getToken` | 2 (D1) |
| §4.2 wait for `isLoaded`; signed-out assign `/sign-in` without 401; engineer does not wait | 2 (D2 `ClerkSignedInGate`) |
| §4.3 / §8 / §12.16–20 WS `hospai.clerk.<jwt>` + `authenticateClerkSession`; HTTP Worker unchanged | 1, 4 |
| §4.4 no `/me` / membership / catalog / 401-shape change | all (forbidden) |
| §3.1 custom `useSignIn` + `setActive`; no hosted portal; no prebuilt `<SignIn />` | 3 |
| §3.2 password-gate; `sessionStorage` unlock; no lab copy | 3 |
| §5.1–5.2 chrome; four modes; Clerk hooks only in a child | 3 (D3) |
| §5.3 no `?next=`; land `/board`; 401 assign unchanged; `me-no-access` stays 404 | 2 (gate), 3 (navigate), pin `AppShell.me.test.tsx` |
| §5.4 `.sign-in*` tokens only; colour gate | 3 |
| §6 OrgDO mapping; members POST documented not implemented as a new API | 5 (README curl); runtime already exists |
| §6.3 `/me` payload must not grow | all (forbidden) |
| §9 file map | 1–5 |
| §10 testids; 109 unchanged | 3 (new only); 44 files unmodified |
| §12.1–4 heads / 44 files / existing Bearer test | 1, 6 |
| §12.5–6 engineer credentials + Bearer once bridged | 2, 3 |
| §12.7–12 SignIn surface | 3 |
| §12.13–15 shell pins | unmodified existing tests |
| §12.21–24 forbidden deps / hex / no new V1 id / colours | 2 (install), 5 (grep), 6 (CI) |
| §14 `@clerk/react` / no `publishableKey` | 2 |
| §14 tick DEMO-READY P0-4 in the implementation PR | 5 |
| §14 stop; no P0-5; no ui-kit batches | 6 + sequencing gate |
| Invariant 1–2 Clerk authenticates, OrgDO authorizes; no Organizations | all (forbidden to consult Clerk for role) |
| Invariant 8–9, 12 no hex / no Tailwind / no `export class` | 3, 6 |
| Invariant 13 password-gate is presentation | 3, 5 (honest README) |
| Leftover folded §11.1 (SPA SDK, hide header on happy path, Bearer, WS, mapping curl) | 2–5 |
| Leftover deferred §11.2 | all (forbidden) |

---

## Clerk API notes (plan-time confirmation)

| Piece | Source | Locked usage |
|---|---|---|
| Package | clerk-setup + Vite quickstart | `@clerk/react` (current). Not `@clerk/clerk-react`. |
| `ClerkProvider` | Vite quickstart §2.2.4 | In `main.tsx` only. **Do not** pass `publishableKey`. Env var `VITE_CLERK_PUBLISHABLE_KEY`. No `appearance` (no `@clerk/ui`). |
| `useAuth` | MCP `use-auth` | `{ isLoaded, isSignedIn, getToken }`. `getToken()` with no template. Ignore `orgId`. |
| `useSignIn` | MCP `use-sign-in` (not clerk-custom-ui core-3 Future API) | `{ isLoaded, signIn, setActive }`. `signIn.create({ identifier, password })`. `setActive({ session: result.createdSessionId })` iff `status === 'complete'`. |
| Tests | spec §12 | Mock `@clerk/react`. No live Clerk. No publishable key in vitest. |
