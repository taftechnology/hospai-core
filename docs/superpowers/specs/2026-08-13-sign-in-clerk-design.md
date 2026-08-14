# Sign-in that is not a lab flag (P0-4)

**Date:** 2026-08-13
**Status:** Draft — awaiting reviewer approval (spec only; no plan, no implementation, no commit)
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P0-4; [ARCHITECTURE.md](../../../ARCHITECTURE.md) §13; [Clerk authentication](./2026-07-28-clerk-auth-design.md); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) §2.4; [property `/me`](./2026-08-09-property-me-permissions-design.md); [membership management](./2026-08-10-membership-management-design.md); [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) leftover P0-4; [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md) leftover P0-4; [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) §8.2; [UI system convergence](./2026-08-13-ui-system-convergence-design.md) §2.0; Clerk skills (`clerk`, `clerk-setup`, `clerk-custom-ui`); Clerk React Vite quickstart (`@clerk/react`); `apps/web-pms/src/{App,client,config/tenant,providers/*}.tsx?`; `apps/pms-core/src/{auth,clerk-lookup,env,v1-dispatch}.ts`

**Closes:** DEMO-READY P0-4 (Clerk or hosted session on the demo tenant; `/sign-in` is a real surface; `X-Dev-Actor` never visible in the room). The Clerk-auth spec leftover "Frontend / SPA Clerk SDK setup (separate repo; this slice is Worker-only)".

**Amends:** [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) §2.4 "Production → Clerk session provider (same-origin cookies)" — **Bearer `getToken()`, not cookies**, for HTTP (§3). [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) §8.2 Clerk row — cookies remain valid if present; this chunk adds a WebSocket subprotocol so the Vite two-process demo does not depend on first-party Clerk cookies (§3.3). [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) leftover "Do not build `/sign-in`" is retired by this chunk (seed itself is unchanged).

**Does not close:** P0-5 (script + dry runs). This spec names the demo runbook steps P0-5 must execute; it does not write the script.

---

## 1. Context & Motivation

The 8-minute path opens on sign-in. Today that beat is a lab flag: the SPA injects `X-Dev-Actor: user_owner` from a Vite env var, and `/sign-in` is the literal paragraph "Sign in required". An investor who can read a URL bar, a Network panel, or a `.env` on the projector sees a prototype, not a product.

The Worker already verifies Clerk sessions. OrgDO already answers `/me`. The shell already paints the role from `/me` and already redirects 401 to `/sign-in`. Nothing about authorization, membership, or chrome needs reinventing. This chunk wires a designed sign-in surface onto that existing gate, keeps the dev-actor path for local engineering and the 44 web-pms tests, and names a password-gate fallback if Clerk dashboard setup cannot land before the meeting.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| `/sign-in` route | `apps/web-pms/src/App.tsx:78` — sibling of `AppShell`, not inside it: `<Route path="sign-in" element={<p className="main">Sign in required</p>} />`. No form, no `data-testid`. |
| 401 → `/sign-in` | `AppShell.tsx:246–253` — `shell.kind === 'unauthorized'` → `window.location.assign('/sign-in')`, then `return null`. Same assign in `BoardScreen.tsx:268–269`, `TapeChartScreen.tsx:211–212`, `ReservationsDirectoryScreen.tsx:184–185`. **No return URL.** Test: `AppShell.me.test.tsx:103–116` asserts `assign` called with `'/sign-in'`. |
| Credential switch | `apps/web-pms/src/client.ts:16–21`: `VITE_USE_DEV_ACTOR === '1'` → `createDevActorCredentials(VITE_DEV_ACTOR \|\| 'user_owner')`; else `createClerkCredentials()`. Evaluated **once at module load**. |
| Dev-actor headers | `providers/dev-actor-credentials.ts` — `{ 'x-dev-actor': userId }`. Transport merges these in `packages/client-core/src/transport.ts:19–23` (`getCredentialHeaders` may be async). |
| Clerk credentials stub | `providers/clerk-credentials.ts:3–7` — comment "Same-origin Clerk session — cookies sent automatically; no extra headers"; `getCredentialHeaders: () => ({})`. **No `getToken()`, no `Authorization`.** |
| Tenant ids | `config/tenant.ts` — `VITE_ORG_ID` + `VITE_PROPERTY_ID` or throw `tenant_config_missing`. Unrelated to identity. |
| SPA env (example) | `apps/web-pms/.env.example`: `VITE_ORG_ID=org_demo` / `VITE_PROPERTY_ID=prop_demo` / `VITE_USE_DEV_ACTOR=1` / `VITE_DEV_ACTOR=user_owner` / commented `# VITE_CLERK_PUBLISHABLE_KEY=pk_test_…`. |
| SPA env (local, gitignored) | `apps/web-pms/.env` — same four live lines; **no** Clerk key line at all. This is the default engineer/test machine. |
| Vite types | `vite-env.d.ts` already declares `VITE_CLERK_PUBLISHABLE_KEY?` and `VITE_USE_DEV_ACTOR?`. |
| SPA Clerk SDK | **Absent.** `apps/web-pms/package.json` has no `@clerk/*`. React 19.1, Vite 6.3, react-router 7.5, TanStack Query 5.14. Entry is `main.tsx` (`StrictMode` + `App`); no `ClerkProvider`. |
| Test files | **44** under `apps/web-pms/src/**/*.test.{ts,tsx}`. Vitest config does **not** set Clerk env. Tests import `App` / screens, not `main.tsx`. `/me` is mocked (`AppShell.me.test.tsx`). |
| Live board WS | `FrontOfficeLive.tsx:111–114` — if `VITE_USE_DEV_ACTOR === '1'`, subprotocol `hospai.dev-actor.${VITE_DEV_ACTOR \|\| 'user_owner'}`; else `undefined` (cookie assumption). URL is same-origin `/v1/properties/:id/front-desk/stream` (`front-office-stream.ts:50–51`). Vite proxies `/v1` → `localhost:8787` (`vite.config.ts:10–12`). Browser `WebSocket` cannot set `Authorization`. |
| Worker `resolveActor` | `apps/pms-core/src/auth.ts:58–91`. Dev path first if `isDevActorAllowed`: `x-dev-actor` starting `user_`, **or** `Sec-WebSocket-Protocol` `hospai.dev-actor.user_…`. Else if Clerk keys missing → 401 `"Authentication unavailable…"`. Else `authenticateRequest` → `state.toAuth()?.userId` → `{ userId, source: 'clerk' }`. |
| Worker Clerk verify | `@clerk/backend@3.13.2`. `authenticateRequest(request, { jwtKey, authorizedParties? })`. Gated by `CLERK_SECRET_KEY` **and** `CLERK_PUBLISHABLE_KEY` (`auth.ts:16–18`). `CLERK_JWT_KEY` optional PEM (networkless); `CLERK_AUTHORIZED_PARTIES` optional comma-separated `azp` (empty → omitted from options, `auth.ts:50–51`). |
| Token the Worker already accepts | `Authorization: Bearer <session_jwt>`. Proven: `apps/pms-core/test/auth.spec.ts:208–218` (`authorization: 'Bearer session_jwt'` with mocked `authenticateRequest`). README:73: "Production auth uses **Clerk** (`Authorization: Bearer …`)." Clerk-auth spec §Auth resolution: "Token transport: `Authorization: Bearer <session_jwt>` (SPA). `__session` cookie support optional if same-origin; not required." |
| Dev-actor Worker gate | `env.ts:90–93`: `isDevActorAllowed` iff `HOSPAI_UNSAFE_LOCAL === '1'` **and** `HOSPAI_ALLOW_DEV_ACTOR === '1'`. `assertEnvSafeForRequest` 500s if `ALLOW_DEV_ACTOR=1` without the local marker (`env.ts:121–130`). `.dev.vars.example` sets both; **no** `CLERK_*` lines. |
| Precedence | Dev header/protocol wins when both flags **and** the header/protocol are present (`auth.ts:59–70`). Production omits the flags → Clerk only. |
| `/me` | `GET /v1/properties/:propertyId/me` (`v1-dispatch.ts:6688–6693`, `handleGetPropertyMe` at 2769). After `resolveActor` + `requirePermission(..., 'property:read')`, OrgDO `readPropertyMe(actor.userId)` → `{ ok, orgId, propertyId, userId: actor.userId, role, permissions, orgPermissions }`. Role is OrgDO `getEffectiveRole`. **Clerk is not consulted.** 401 unauthenticated; 404 not a member (`me-no-access`). |
| Role footer | `AppShell.tsx:296–299` — `data-testid="shell-role"` + `roleLabel(authority.me.role)` (`Owner` / `Admin` / `Staff`). P0-3 leftover: "Role footer reads whoever `/me` is." |
| Membership by email | `POST /v1/orgs/:orgId/members` `{ email, role }` → `lookupUserIdByEmail` (Clerk Backend `users.getUserList`) → `setOrgMember` with **Clerk's** `userId` (`v1-dispatch.ts:2561–2588`). Requires Worker `CLERK_*`. Demo seed still `ensureMember`s the **request actor** (`user_owner` today). |
| Clerk lookup | `clerk-lookup.ts` — email → `userId`; directory enrich. Fail-closed `clerk_unreachable` 503. Unused until a member is added by email. |
| Clerk Organizations | Unused. ARCHITECTURE §13 standing rule. Clerk-auth spec: do not enable; if enabled accidentally, ignore. |
| Seed | `POST /v1/admin/demo-seed` is `scope: 'dev'` — 404 unless `isDevActorAllowed`. Actor is `user_owner`. Does not open a shift (folio first-paint: ShiftStrip auto-opens for the **signed-in** user). |
| Chrome / tokens | P0-3 + batch 0a landed. `tokens.css`: sage `#4A5D4E`, tan `#C18C5D`, cream `#F1EFE9`, `--bg #F9F8F4`, `--ink #2D2926`, IBM Plex on `:root`, `color-scheme: light`. `styles.css` batch 0a: control baseline on `input`/`select`/`button` (font, `block-size: 2.25rem`, `--radius`), `.btn-primary`, `:focus-visible`. No Tailwind, no shadcn, no `components.json`. |
| Heads | `COMMAND_CATALOG` **77** (`register.test.ts:627`); `AUDIT_WRITER_COMMAND_IDS.size` **52**; `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`; `PLATFORM_GAPS` `[]`; `PROPERTY_SCHEMA_HEAD` **25**; `ORG_SCHEMA_HEAD` **7**. |

**Heads (this chunk does not move them):** catalog **77**, writer set **52**, route audit **[127] = post_demo_seed**, schema 25 / 7, `NIGHT_AUDIT_STEPS` **7**, `CLASS_DENYLIST` unchanged. No new Worker **route**, command, or table. The one permitted Worker edit is `resolveActor` plus tests (§3.3, §12).

### 1.2 What is broken today (verified — this is the motivation)

| # | Defect | Evidence | Symptom |
|---|---|---|---|
| 1 | **Sign-in is a dead paragraph.** | `App.tsx:78` | Investor lands on "Sign in required" or, more likely, never sees `/sign-in` because the header is injected. |
| 2 | **Demo identity is a Vite flag.** | `.env` / `.env.example` `VITE_USE_DEV_ACTOR=1`; `client.ts:17–18` | `X-Dev-Actor: user_owner` on every `/v1/*` call. Visible in DevTools; `.env` on a projector is a lab flag. DEMO-READY forbids both. |
| 3 | **Clerk SPA path is a stub.** | `clerk-credentials.ts` returns `{}`; no `@clerk/react`; no `ClerkProvider` | Even if Worker secrets were set, the SPA would send neither a Bearer token nor a Clerk cookie. `/me` 401 → `/sign-in` paragraph. |
| 4 | **Live board has no Clerk credential channel that works in the Vite demo.** | `FrontOfficeLive.tsx:111–114` + tape spec §8.2 cookie row + `WebSocket` cannot set headers | With defect 3 fixed via Bearer, the tape HTTP path works and the WebSocket upgrade still has no token unless a first-party `__session` cookie exists. Vite `:5173` → proxy `:8787` does not make Clerk's FAPI cookie first-party. |
| 5 | **Clerk `userId` ≠ seeded `user_owner`.** | Seed / provision `ensureMember(actor)` with `x-dev-actor: user_owner`; Clerk `sub` is `user_2…` | A verified Clerk session against an unmapped user is a **404** `/me` → `me-no-access`, not a signed-in owner. Mapping is operational (existing members POST), not a new Worker API. |

**Not defects (checked, do not "fix"):** Worker `resolveActor` / `authenticateRequest` / membership 404-vs-401; `/me` payload and `shell-role`; 401 assign to `/sign-in`; tenant ids in Vite env; `HOSPAI_*` unsafe-local gate; 44 tests that mock `/me` and never mount Clerk; batch 0a control CSS (sign-in **uses** it).

### 1.3 Scope in

1. **Clerk-backed sign-in as the demo happy path** (§3): `@clerk/react`, `ClerkProvider` in `main.tsx` when a publishable key is present, custom email+password on `/sign-in` via `useSignIn` (not hosted Account Portal, not prebuilt `<SignIn />`).
2. **Token flow** (§4): SPA `getToken()` → `Authorization: Bearer` on every `client-core` fetch. Worker HTTP verification **unchanged**.
3. **WebSocket credential for Clerk** (§3.3, §12): `Sec-WebSocket-Protocol: hospai.clerk.<session_jwt>` plus a narrow `resolveActor` read of that protocol. Justified: browser WS cannot set `Authorization`; Vite demo is not same-site with Clerk cookies.
4. **Designed `/sign-in` surface** (§5) using existing tokens + batch 0a controls. Signed-out deep links (§5.3).
5. **Identity → `/me` / footer mapping** (§6) via OrgDO, using the existing members-by-email route. No Clerk roles, no custom JWT claims.
6. **Dev-actor preserved** for local engineering and tests, **invisible on the demo happy path** (§7).
7. **Password-gate fallback** (§3.2) if Clerk dashboard keys cannot land. Same `/sign-in` chrome; no visible `X-Dev-Actor`.
8. Env-example comments + README pointer so P0-5 has a runbook surface. Tick DEMO-READY P0-4 in the **implementation** PR.

### 1.4 Scope out (normative — name them so a later pass does not "fix" them here)

- **P0-5** script, dry runs, kill list, spoken copy. This spec lists the operational steps P0-5 must include (§6.2, §14); it does not write them.
- **UI convergence batches 1–7.** Sequencing: they wait for P0-4 **and** P0-5 (convergence spec §2.0). Batch 0 may already be in tree; this chunk does not restyle the shell.
- **Clerk Organizations, org switcher, Clerk role metadata, custom session claims** (`org_id`, `entitlement_version`). ARCHITECTURE §13; clerk-auth spec deferred claims. `useAuth().orgId` is ignored if present.
- **Sign-up, OAuth, MFA UI, password reset, `<UserButton>`, sign-out chrome.** Demo is one pre-created user. If Clerk returns `needs_second_factor`, show the existing `.error` pattern with copy "This account needs a second step. Use the demo user." — do not build TOTP.
- **Hosted Clerk Account Portal** (navigates off `localhost` / our origin to `*.clerk.accounts.dev`).
- **Prebuilt `<SignIn />` / `<SignInButton>`.** Development-mode badge and Clerk chrome are lab flags. Custom `useSignIn` only.
- **New Worker routes, commands, schema, seed fixture, `demo-seed` body.** Mapping uses `POST /v1/orgs/:orgId/members` as it exists.
- **Replacing `user_owner` in tests, seed, or README curls.** Dev-actor stays `user_owner`.
- **Tailwind, `@clerk/ui` themes, shadcn, lucide, motion, dark theme, new hex.** Appearance is our CSS. Clerk skill's shadcn theme does not apply (`components.json` absent; Tailwind banned).
- **Making the password-gate a security boundary.** It is a presentation control in front of the existing unsafe-local dev-actor path (§3.2).
- **Returning the user to a deep link after sign-in.** DEMO-READY: land on `/board` with the seeded day.

---

## 2. Invariants (normative)

### 2.0 Sequencing (normative, non-technical)

DEMO-READY: work P0 in order. This is **P0-4**. **P0-5** (8-minute script + two dry runs) follows it and is the first time the Clerk dashboard checklist is executed end-to-end in front of a clock. UI convergence batches 1–7 wait for both unless the reviewer re-sequences.

### 2.1 Technical invariants

Implementation that violates these is out of spec.

1. **Clerk authenticates; OrgDO authorizes.** Property roles never live in Clerk — not as metadata, not temporarily (ARCHITECTURE §13). `/me`.role is OrgDO `getEffectiveRole`. The footer does not read Clerk.
2. **No Clerk Organizations.** Do not enable in the dashboard. If enabled, ignore `orgId` / `orgRole` from the SDK.
3. **Heads frozen** per §1.1. `pnpm generate:ddl` is a no-op diff. No new `V1_HTTP_ROUTE_AUDIT` row, catalog id, or DO table.
4. **All 109 existing `data-testid` values stay** on the same control with the same string. New testids on `/sign-in` are allowed (§10).
5. **Dev-actor path remains callable** when `VITE_USE_DEV_ACTOR=1` (SPA) and `isDevActorAllowed` (Worker). All 44 web-pms test files pass **unmodified**. Worker test suite keeps using `x-dev-actor`.
6. **`VITE_USE_DEV_ACTOR=1` is not the demo happy path.** Demo machine `.env` (gitignored, not on the projector) unsets it and sets `VITE_CLERK_PUBLISHABLE_KEY`. `.env.example` may keep `=1` as the engineer default so `pnpm --filter @hospai/web-pms test` and `dev` work without a Clerk app.
7. **`X-Dev-Actor` is never a visible UI string**, never in the URL, never a header flag, never leftover copy on `/sign-in`. Network-tab visibility on the password-gate fallback is accepted and named (§3.2) — it is not the happy path.
8. **No new hex.** Sign-in CSS uses existing `var(--*)`. Tan `#C18C5D` is fill-only (convergence invariant 5).
9. **No Tailwind / shadcn / lucide / motion / dark theme.** `color-scheme: light` stays. No `@clerk/ui` (that package's themes pull a styling system we declined).
10. **`ClerkProvider` mounts only in `main.tsx` and only when `VITE_CLERK_PUBLISHABLE_KEY` is non-empty.** Tests import `App`, not `main`, and must not require Clerk. Do not pass `publishableKey` as a prop — `@clerk/react` reads `VITE_CLERK_PUBLISHABLE_KEY` (Vite quickstart).
11. **Package is `@clerk/react` (current SDK), not `@clerk/clerk-react` (Core 2).** Worker stays `@clerk/backend@3.13.2`.
12. **No `export class`.** Sign-in is functions. `CLASS_DENYLIST` unchanged.
13. **Password-gate is not production auth.** It requires the same Worker flags as today's lab path. It exists so a meeting can proceed if dashboard setup fails; it is not a third identity system.
14. **After a successful sign-in, land on `/board`.** Do not restore the previous path. Tape "today" remains `propertyLocalToday` (seeded day is a clock + TZ fact, not a sign-in param).

---

## 3. Decision 1 — Clerk custom UI, hosted rejected; password-gate is the fallback (normative)

DEMO-READY: "Demo runbook uses Clerk (or a hosted session) on the demo tenant." Dashboard setup time is the named risk. "If Clerk dashboard setup cannot land in time: a **single demo user** behind a password gate is acceptable. A visible `X-Dev-Actor` is not."

### 3.1 Happy path — Clerk, embedded custom `useSignIn` (locked)

| Option | Verdict | Why |
|---|---|---|
| **Hosted Account Portal** (`RedirectToSignIn` / `*.clerk.accounts.dev`) | **Rejected** | Leaves our origin. Clerk chrome + development-mode badge on a `pk_test_` instance. Extra navigation in an 8-minute demo. "Hosted session" in DEMO-READY is satisfied by Clerk **sessions**, not by Clerk's hosted **pages**. |
| **Embedded prebuilt `<SignIn />`** | **Rejected** | Stays on `/sign-in` but renders Clerk's layout, CAPTCHA slot, and development-mode badge. Appearance `variables` can map sage, but IBM Plex + our card still fight their structure. `@clerk/ui` themes are out (invariant 9). |
| **Embedded custom `useSignIn`** (email + password) | **Locked** | Our chrome, our tokens, batch 0a controls, no Clerk badge (custom flows do not mount Clerk component chrome). Matches clerk-custom-ui "custom authentication flows". Investor sees HospAI PMS, not Clerk. Dashboard still required for keys + the one user — that is the remaining risk, handled by §3.2. |

SDK: `@clerk/react`. `ClerkProvider` in `main.tsx` wrapping `App` **iff** the publishable key is set. `/sign-in` renders a HospAI-branded card; submit calls `signIn.create({ identifier, password })` then `setActive({ session: result.createdSessionId })` then navigate to `/board`. Status other than `complete` → error, no extra steps built.

**Dashboard (operational, P0-5 executes; this chunk documents):**

1. Create a Clerk **development** application (production instance is not required; we never mount prebuilt chrome, so the development badge is not on screen).
2. **Do not enable Organizations.**
3. Enable **email + password** only. Disable sign-ups if the dashboard offers it (we will not link sign-up regardless).
4. Create **one** user (email + password). That pair is the demo credential. It lives in the operator's notes, not in the UI.
5. Copy publishable key → `apps/web-pms/.env` as `VITE_CLERK_PUBLISHABLE_KEY` (and **unset / delete** `VITE_USE_DEV_ACTOR`).
6. Worker `.dev.vars`: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, optional `CLERK_JWT_KEY` (PEM; SDK can fetch JWKS if omitted), `CLERK_AUTHORIZED_PARTIES=http://localhost:5173` (and the Assets origin if they serve the built SPA).
7. Map that user onto OrgDO as owner (§6.2).

Trigger that this path is active: `VITE_CLERK_PUBLISHABLE_KEY` is non-empty **and** `VITE_USE_DEV_ACTOR` is not `'1'`.

### 3.2 Fallback — password gate in front of the existing dev-actor path (locked)

**Trigger (exact):** Clerk dashboard keys cannot be obtained (or Worker `CLERK_*` cannot be set) before the meeting. Operator keeps `VITE_USE_DEV_ACTOR=1`, sets `VITE_DEMO_PASSWORD` (and optional `VITE_DEMO_EMAIL`, default `demo@hospai.local`), and does **not** set a publishable key.

This is **not** a new Worker identity. After the gate unlocks, the SPA behaves as today's engineer path: `createDevActorCredentials('user_owner')`, Worker `x-dev-actor`. The header is still on the wire. DEMO-READY's bar is "never **visible in the room** (no header flag, no `.env` on the projector)" — not "absent from DevTools." Honest limitation, stated so nobody files the Network tab as a bug during the fallback meeting.

The gate **is** the `/sign-in` surface (same chrome as Clerk). Email + password fields. Unlock when email matches `VITE_DEMO_EMAIL` and password matches `VITE_DEMO_PASSWORD`. Store an in-memory / `sessionStorage` unlock flag so a refresh during the meeting does not re-prompt. **Do not** show the password as a placeholder. **Do not** mention `X-Dev-Actor`, `user_owner`, or "dev" in copy.

The password is a Vite `VITE_*` value and will be in the bundle. That is acceptable: the gate is presentation. Worker trust remains `isDevActorAllowed`.

### 3.3 Local engineering / tests — no gate (locked)

| `VITE_USE_DEV_ACTOR` | `VITE_CLERK_PUBLISHABLE_KEY` | `VITE_DEMO_PASSWORD` | Behaviour |
|---|---|---|---|
| `'1'` | (ignored) | unset | **Engineer / tests.** Today's path. `/sign-in` immediately navigates to `/board` (already authenticated). No ClerkProvider. |
| `'1'` | (ignored) | set | **Fallback demo** (§3.2). Password gate, then header. |
| not `'1'` | set | (ignored) | **Happy path** (§3.1). Clerk. |
| not `'1'` | unset | * | **Misconfigured.** `/sign-in` shows the designed card with copy "Sign-in is not configured." No header, no fake success. `/me` would 401 anyway. |

`VITE_USE_DEV_ACTOR=1` without a password is what `.env.example` and the current `.env` already are. **Tests do not change.**

---

## 4. Decision 2 — token flow (normative)

### 4.1 HTTP — Bearer via the existing credential provider (locked)

The shell spec's cookie sentence is **wrong for this app**: Vite origin `:5173`, API origin via proxy, Clerk FAPI on a third host. Cookies are third-party. The Worker spec and README already locked Bearer. The empty `createClerkCredentials()` stub is the bug, not the design.

**Locked:**

1. Keep `CredentialProvider` on transport (`client.ts`). Do not add a second fetch interceptor, axios, or a Query middleware.
2. `createClerkCredentials()` returns headers `{ authorization: 'Bearer ' + token }` from an async `getCredentialHeaders`. Token from Clerk `getToken()` (default session JWT — **no** template; Worker verifies the session JWT, not a Clerk JWT template).
3. `getToken` is a React hook. Transport is a module singleton. Bridge: a tiny component under `ClerkProvider` (e.g. `ClerkTokenBridge`) calls `useAuth().getToken` and registers a getter the credential provider calls. Transport already awaits `getCredentialHeaders` (`transport.ts:19`).
4. If `getToken()` returns `null`, send **no** `Authorization` (do not send `Bearer null`). `/me` 401 → `/sign-in` as today.
5. **Worker HTTP: zero change.** `authenticateRequest` already reads the Bearer header (`auth.spec.ts` Clerk path).

Do not put tokens in `localStorage` by hand. Clerk owns session storage.

### 4.2 Wait for Clerk before booting the shell (locked)

On the Clerk path, `AppShell` must not fire `/me` until Clerk reports `isLoaded`. If `isLoaded && !isSignedIn`, assign `/sign-in` **without** waiting for a 401 (faster, no flash of empty shell). If `isLoaded && isSignedIn`, mount the shell; the bridge has a session; `/me` carries Bearer.

On the dev-actor path, do not wait for Clerk (provider is not mounted).

`/sign-in` remains **outside** `AppShell` (`App.tsx` sibling route). Sign-in does not call `/me`.

### 4.3 WebSocket — Clerk subprotocol; one Worker edit (locked)

Tape spec §8.2: Clerk uses a session cookie on the upgrade; dev-actor uses `hospai.dev-actor.<userId>`. Cookies will not be on `:5173`. Bearer cannot be set on `new WebSocket`. Query-string tokens are forbidden (tape spec: never `?actor=`; same for `?token=` — access logs).

**Locked:** when not on the dev-actor path, `FrontOfficeLive` passes `Sec-WebSocket-Protocol: hospai.clerk.<session_jwt>` (JWT from the same `getToken()`). Dev-actor protocol row **unchanged**.

**Worker:** `resolveActor` grows a third branch, **after** the existing dev-actor protocol branch and **only when** `clerkConfigured(env)`:

- If `Sec-WebSocket-Protocol` starts with `hospai.clerk.`, take the remainder as a session JWT.
- Build a synthetic `Request` with `Authorization: Bearer <jwt>` (same URL is fine).
- Call the existing `authenticateClerkSession` — **do not** invent a second verifier.
- On failure, same 401 as today.

This is not a new route, command, or schema. It is the WebSocket equivalent of the already-tested Bearer path. Rejected alternative: Clerk Proxy / satellite domain to force first-party cookies — more dashboard surface, more Worker routes, worse on time-risk.

Cookies on the upgrade remain valid if they ever exist (Workers Assets same-origin later). `authenticateRequest` still sees them on the real request; the protocol is additional, not exclusive.

**Prefix is load-bearing.** Do not send the raw JWT as the protocol (it could collide with `hospai.dev-actor.` parsing). Do not reuse `hospai.dev-actor.` for Clerk ids.

### 4.4 What the Worker must not change

- `requirePermission`, `/me`, membership HTTP, `clerk-lookup`, demo-seed, catalog, schema.
- Dev-actor precedence and `assertEnvSafeForRequest`.
- 401 body shape `{ error: 'unauthenticated', message }` — SPA already classifies 401 as `unauthorized`.

---

## 5. Decision 3 — `/sign-in` surface and signed-out behaviour (normative)

### 5.1 Layout

Replaces `App.tsx:78`. Still **outside** `AppShell` (no sidebar, no ops rail, no `/me`). Full-viewport `--bg`, a single `--panel` card, `--radius`, `--line` border.

Card contents, top to bottom:

1. The P0-3 mark: 2rem sage square, `✦`, "HospAI **PMS**" (reuse `.app-sidebar-mark` / `.app-sidebar-title` or equivalent classes — do not invent a second wordmark).
2. Heading: **Sign in** (`h1`).
3. One sentence muted: **Front desk**. No "demo", "dev", "Clerk", "actor".
4. Form: email, password, submit **Sign in** (`.btn-primary`). Native `<form>` / `<label>` / `<input type="email|password">` — batch 0a already sizes them. `autocomplete` on.
5. Error slot: existing `.error` / `role="alert"`.

No social buttons, no "Sign up", no "Forgot password", no Clerk footer.

**Print:** `/sign-in` is not a print path; no `@media print` work.

### 5.2 Three implementations, one chrome

`SignInScreen` selects §3.3. Clerk hooks live in a child that **only mounts** when the publishable key is set, so `useSignIn` is never called without `ClerkProvider`.

Copy differences:

| Mode | Submit success | Error |
|---|---|---|
| Clerk | `setActive` then `/board` | Clerk `errors[0].message` or "Could not sign in." |
| Password gate | set unlock flag then `/board` | "Email or password is wrong." (do not specify which) |
| Misconfigured | no submit | "Sign-in is not configured." |
| Engineer (`USE_DEV_ACTOR` without password) | no form; `Navigate` to `/board` | — |

### 5.3 Deep links and 401

Keep `window.location.assign('/sign-in')` — **do not** add `?next=`. Full-page assign drops React state; that is today's behaviour and the test (`AppShell.me.test.tsx:116`). After sign-in, **`/board`**, not the folio/check-in URL they came from (DEMO-READY beat 0:00).

Signed-out user opening `/folio/:id` (or any `AppShell` child): `/me` 401 (or Clerk `!isSignedIn` gate) → `/sign-in` → success → `/board` with `propertyLocalToday` tape. The folio is one click away; the script starts on Room Plan.

`me-no-access` (404) is **not** sign-in. It stays the P0-3 no-access chrome (`data-testid="me-no-access"`). That is the Clerk-user-not-mapped failure mode; §6.2 is how the operator avoids it.

### 5.4 CSS

A short `.sign-in` / `.sign-in-card` block in `apps/web-pms/src/styles.css`. Tokens only. No `tokens.css` edit. Colour gate stays green.

---

## 6. Decision 4 — Clerk identity maps to `/me` through OrgDO (normative)

### 6.1 Runtime (already built)

```
Clerk session JWT  →  resolveActor.userId = Clerk sub (`user_…`)
                   →  GET /v1/properties/:id/me
                   →  OrgDO.getEffectiveRole(userId)
                   →  { userId, role, permissions, orgPermissions }
                   →  AppShell footer `shell-role` = roleLabel(role)
```

No SPA mapping table. No Worker change to `/me`. If OrgDO has no row for that `userId`, HTTP 404 → `me-no-access`. That is correct, not a bug to paper over with a client fallback to `user_owner`.

Shifts stay self-scoped to `actor.userId` (folio first-paint). The Clerk user gets their own open shift via ShiftStrip, which is what we want — seed-as-`user_owner` would not cover them.

### 6.2 Demo mapping (operational — existing HTTP, P0-5 runbook)

Seed continues to provision as `user_owner` via `X-Dev-Actor` (`demo:seed` is `scope: 'dev'`). That membership stays. The Clerk user is a **second** owner:

After the Clerk user exists **and** Worker `CLERK_*` are set:

```
POST /v1/orgs/org_demo/members
  { "email": "<the Clerk user's email>", "role": "owner" }
  Header: x-dev-actor: user_owner
```

`lookupUserIdByEmail` resolves Clerk's `user_2…` and `setOrgMember` writes it. Staff UI can do the same; the curl is faster for a cold laptop.

**Order is load-bearing:** seed first (creates `org_demo` / `prop_demo` / `user_owner` owner), then members POST (needs that owner + Clerk lookup). Sign-in before mapping → `me-no-access`.

**Rejected:** Worker maps `external_id` / email at `resolveActor` time (new auth behaviour, easy to get wrong, not needed). **Rejected:** change seed actor to the Clerk id (would require seeding with a Bearer token and changing the `scope: 'dev'` gate). **Rejected:** custom JWT claim `org_id` (deferred since the Clerk-auth spec).

Password-gate fallback needs **no** mapping: actor remains `user_owner`, already the seeded owner.

### 6.3 What `/me` must not grow

No Clerk email, no display name, no `source: 'clerk' | 'dev'` on the payload. Footer stays a role word. Directory enrichment of **other** members already uses `clerk-lookup`; out of scope here.

---

## 7. Decision 5 — exact env-var gating (normative)

### 7.1 SPA (Vite, public)

| Variable | Role |
|---|---|
| `VITE_ORG_ID` / `VITE_PROPERTY_ID` | Unchanged. Tenant, not identity. |
| `VITE_USE_DEV_ACTOR` | `'1'` → `createDevActorCredentials`. Any other value / unset → Clerk credentials (which no-op without a token). |
| `VITE_DEV_ACTOR` | Header value when the flag is on. Default `user_owner`. Unchanged. |
| `VITE_CLERK_PUBLISHABLE_KEY` | Presence mounts `ClerkProvider` and selects the Clerk sign-in child. Must start with `pk_`. Never a secret. |
| `VITE_DEMO_PASSWORD` | Presence + `VITE_USE_DEV_ACTOR=1` → password gate. Engineer machines leave this **unset**. |
| `VITE_DEMO_EMAIL` | Optional; default `demo@hospai.local`. Only used by the password gate. |

`.env.example` keeps `VITE_USE_DEV_ACTOR=1` and the commented Clerk key, and **adds commented** `VITE_DEMO_PASSWORD` / `VITE_DEMO_EMAIL` with one-line comments pointing at this spec. It does not enable the gate by default.

Demo machine `.env` (not committed, not on the projector): no `VITE_USE_DEV_ACTOR`, live `VITE_CLERK_PUBLISHABLE_KEY`.

### 7.2 Worker (`.dev.vars`, not wrangler `vars`)

Unchanged flags for local: `HOSPAI_UNSAFE_LOCAL=1`, `HOSPAI_ALLOW_DEV_ACTOR=1`. Clerk keys added when using the happy path. `.dev.vars.example` gains **commented** `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` / `CLERK_JWT_KEY` / `CLERK_AUTHORIZED_PARTIES` so P0-5 does not hunt `env.ts`.

A local Worker may have **both** Clerk keys and `ALLOW_DEV_ACTOR`. That is today's precedence: header present → dev; else Clerk. The Clerk SPA sends Bearer, not `x-dev-actor`, so it takes the Clerk path even with the flags on. Seed curls still use the header.

---

## 8. Command / HTTP decision (normative)

**No new route, catalog id, permission, DO table, or seed change.**

The only Worker source edit in scope is `apps/pms-core/src/auth.ts` (`resolveActor` WebSocket Clerk protocol) plus `apps/pms-core/test/auth.spec.ts` coverage. `V1_HTTP_ROUTE_AUDIT[127]` does not move.

**Rejected:** `POST /v1/demo/login`, a password route, a session cookie minted by us, `external_id` rewrite, seed body `clerkUserId`.

---

## 9. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `apps/web-pms/package.json` | `@clerk/react` |
| `apps/web-pms/src/main.tsx` | Conditional `ClerkProvider` + token bridge (no `publishableKey` prop) |
| `apps/web-pms/src/App.tsx` | `/sign-in` → `SignInScreen`; Clerk signed-out gate around `AppShell` **or** equivalent in a thin wrapper — `AppShell` itself stays `/me`-centric |
| `apps/web-pms/src/screens/SignInScreen.tsx` | **New.** Chrome + three modes |
| `apps/web-pms/src/providers/clerk-credentials.ts` | Bearer from registered getter |
| `apps/web-pms/src/providers/dev-actor-credentials.ts` | Unchanged |
| `apps/web-pms/src/client.ts` | Unchanged switch; still module-load |
| `apps/web-pms/src/shell/FrontOfficeLive.tsx` | Clerk subprotocol when not dev-actor |
| `apps/web-pms/src/styles.css` | `.sign-in*` block |
| `apps/web-pms/src/vite-env.d.ts` | `VITE_DEMO_PASSWORD?` / `VITE_DEMO_EMAIL?` |
| `apps/web-pms/.env.example` | Comments only for Clerk / demo gate |
| `apps/web-pms/src/screens/SignInScreen.test.tsx` | **New.** Password-gate + misconfigured + engineer redirect. Clerk child tested with a mocked `useSignIn` module — **no** live Clerk, **no** publishable key in vitest |
| `apps/pms-core/src/auth.ts` | Clerk WS protocol → existing `authenticateClerkSession` |
| `apps/pms-core/test/auth.spec.ts` | Protocol success / bad JWT 401 / does not fire when Clerk unconfigured |
| `apps/pms-core/.dev.vars.example` | Commented `CLERK_*` |
| `README.md` | One paragraph: engineer path unchanged; demo path is Clerk (pointer to this spec / P0-5) |
| `DEMO-READY.md` | Tick P0-4 in the **implementation** PR |

**Not touched:** `tokens.css`, `auth/me.ts`, `config/tenant.ts`, `v1-dispatch.ts` (except transitively via `resolveActor`), `clerk-lookup.ts`, `demo-seed`, `COMMAND_CATALOG`, schema, `NAV_ENTRIES`.

---

## 10. DOM and `data-testid` contract (normative)

1. All **109** existing values stay.
2. New, allowed on `/sign-in` only: `sign-in`, `sign-in-email`, `sign-in-password`, `sign-in-submit`. Error uses `role="alert"` (may reuse class `error`; no requirement to reuse `me-no-access`).
3. `shell-role` and `me-no-access` unchanged.
4. Engineer auto-redirect from `/sign-in` must not break `AppShell.me.test.tsx`'s `assign('/sign-in')` — that test never renders the sign-in route.

---

## 11. Leftovers

### 11.1 Folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | SPA Clerk SDK + real `/sign-in` | DEMO-READY P0-4; clerk-auth spec scope-out "Frontend / SPA" |
| 2 | Hide `X-Dev-Actor` on the demo happy path | DEMO-READY P0-4; chrome spec leftover #1 |
| 3 | Bearer token on API calls | README; clerk-auth spec token transport; amends shell spec cookies |
| 4 | WS Clerk credential that works under Vite | Found by this spec against tape §8.2 |
| 5 | Map Clerk user → OrgDO owner via existing members POST | Found by this spec against seed `user_owner` vs Clerk `user_2…` |

### 11.2 Deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **P0-5** script, dry runs, kill list | Next chunk. Includes executing §3.1 dashboard + §6.2 curl |
| 2 | UI convergence batches 1–7 | After P0-4 and P0-5 |
| 3 | Custom JWT claims / org switcher | Clerk-auth spec; ARCHITECTURE §13 |
| 4 | Sign-out / `<UserButton>` / MFA / OAuth / sign-up | |
| 5 | Clerk production instance / custom domain | Dev instance is enough for this meeting |
| 6 | Password-gate as production auth | Invariant 13 |
| 7 | Deep-link return URL | DEMO-READY lands on `/board` |
| 8 | Replacing `user_owner` in seed / tests | |
| 9 | Tailwind / `@clerk/ui` / dark theme / palette | |

---

## 12. Tests (acceptance-shaped)

**Pins**

1. `COMMAND_CATALOG` **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`.
2. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `pnpm generate:ddl` no-op. `CLASS_DENYLIST` unchanged.
3. All **44** existing web-pms test files pass **unmodified**.
4. Worker suite green, including existing `auth.spec.ts` Clerk mocked Bearer path.

**Gating**

5. `VITE_USE_DEV_ACTOR === '1'` and no `VITE_DEMO_PASSWORD` → `createDevActorCredentials` still injects `x-dev-actor`; `/sign-in` redirects to `/board`; `ClerkProvider` not required to render `App`.
6. Publishable key set and flag not `'1'` → `getCredentialHeaders` eventually includes `authorization` matching `/^Bearer .+/` once the bridge has a token; **no** `x-dev-actor` header.
7. Publishable key unset and flag not `'1'` → `/sign-in` shows "Sign-in is not configured"; submit absent or inert.

**`/sign-in`**

8. Route is no longer the paragraph "Sign in required".
9. `getByTestId('sign-in')` / `sign-in-email` / `sign-in-password` / `sign-in-submit` resolve. Heading "Sign in". Wordmark "HospAI" visible. No matching text `X-Dev-Actor`, `user_owner`, `VITE_`, `Clerk` (case-insensitive) in the sign-in document.
10. Password-gate: wrong password → `role="alert"`; correct email+password → navigation to `/board`.
11. Clerk child: mocked `signIn.create` → `complete` + `setActive` → `/board`; non-complete status → alert, stay on `/sign-in`.
12. Submit control is a `<button>` (or native submit) inheriting batch 0a metrics — no screenshot test required; tag + class `.btn-primary`.

**Shell**

13. `AppShell.me.test.tsx` unauthorized → `assign('/sign-in')` still holds.
14. `me-no-access` still 404-only; a mapped Clerk `/me` owner still paints `shell-role` `Owner`. No new role-swap control.
15. All 109 prior testids still resolve (assert as the existing list / screens' tests).

**Worker WS**

16. `isDevActorAllowed` + `hospai.dev-actor.user_x` unchanged.
17. Clerk configured, no dev header, protocol `hospai.clerk.<jwt>` → `authenticateRequest` invoked with a request whose `Authorization` is `Bearer <jwt>`; authenticated `userId` returned.
18. Same protocol, `isAuthenticated: false` → 401.
19. Clerk **unconfigured**, that protocol → 401 "Authentication unavailable…" (do not treat the JWT as a dev actor).
20. Protocol must not be parsed as `x-dev-actor`.

**Forbidden**

21. No `tailwindcss`, `@clerk/ui`, `@clerk/themes`, `@clerk/clerk-react`, `lucide-react`, `motion`, `shadcn` in `apps/web-pms/package.json`.
22. No new hex in CSS touched by this chunk.
23. No new `V1` route id, no `demo.seed` catalog command, no `CLERK_*` in `wrangler.jsonc` `vars`.
24. `pnpm check:web-pms-colors` green.

---

## 13. Open questions (locked unless noted)

1. **Clerk vs password gate?** **Locked: Clerk custom `useSignIn` default; password-gate fallback when dashboard keys cannot land** (§3). Hosted portal and prebuilt `<SignIn />` rejected with reasons.
2. **What happens to dev-actor?** **Locked: preserved for engineers and tests; gated exactly by §7; invisible on the Clerk happy path** (invariant 5–7).
3. **HTTP token?** **Locked: `getToken()` → `Authorization: Bearer` on the existing `CredentialProvider`.** Worker HTTP unchanged. Shell-spec cookies amended.
4. **WebSocket token?** **Locked: `hospai.clerk.<jwt>` subprotocol + narrow `resolveActor` branch** (§4.3). Cookies still accepted if present. Reviewer: this is the only Worker code change — push back here if you want tape live-updates to degrade instead.
5. **`/sign-in` after success?** **Locked: `/board`.** No `next` param.
6. **Clerk `userId` vs `user_owner`?** **Locked: OrgDO membership via existing `POST …/members` email lookup** (§6.2). Not a Worker rewrite. P0-5 executes the curl.
7. **Clerk Organizations?** **Locked: no.**
8. **Sign-out / MFA / OAuth / sign-up?** **Locked: out.**
9. **`.env.example` default?** **Locked: keep `VITE_USE_DEV_ACTOR=1`** so tests and `pnpm dev` without a Clerk app stay green. Demo machine overrides in gitignored `.env`.
10. **Clerk development vs production instance?** **Locked: development is enough** — we do not mount the chrome that shows the badge.
11. **`@clerk/react` vs Core 2 `@clerk/clerk-react`?** **Locked: `@clerk/react` (current).** Confirm `useSignIn` / `useAuth` / `ClerkProvider` against the installed version at plan time; do not take MCP snippets that still import `@clerk/clerk-react` literally.
12. **Does this chunk write the P0-5 script?** **Locked: no.**
13. **Worker / schema / seed heads?** **Locked: unchanged** except `auth.ts` protocol (§8).
14. **Password-gate security?** **Locked: presentation only** (invariant 13). Honest about Network-tab `x-dev-actor` on that path.

---

## 14. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] `@clerk/react` in web-pms; `ClerkProvider` only in `main.tsx` and only if `VITE_CLERK_PUBLISHABLE_KEY` is set; no `publishableKey` prop.
- [ ] `createClerkCredentials` sends Bearer from a registered `getToken()`; transport stays the interceptor.
- [ ] `/sign-in` is the designed card; three modes from §3.3; new testids only those in §10.
- [ ] `AppShell` / screen 401 assign to `/sign-in` unchanged; post-login `/board`.
- [ ] `FrontOfficeLive` Clerk subprotocol; `resolveActor` verifies it through existing `authenticateClerkSession`; auth.spec cases §12.16–20.
- [ ] 44 web-pms tests unmodified and green; SignIn tests do not boot a real Clerk app.
- [ ] `.env.example` comments; `.dev.vars.example` commented `CLERK_*`; README pointer. Do not commit real keys.
- [ ] No catalog / route-audit / schema movement. Colour gate green. No Tailwind / `@clerk/ui`.
- [ ] Document §6.2 mapping curl for P0-5; do not implement a new seed field.
- [ ] Tick DEMO-READY P0-4 in the implementation PR, not in this spec turn.
- [ ] Stop. Do not start P0-5. Do not start ui-kit batches 1–7. Do not commit in the spec-authoring turn.

---

## 15. Reviewer checklist

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
