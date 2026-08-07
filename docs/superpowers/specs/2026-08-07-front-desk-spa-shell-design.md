# Front-Desk SPA Shell

**Date:** 2026-08-07  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (degraded mode), §6.3–§6.4 (entitlement snapshot), §9 (frontend architecture); [front-desk operational reads](./2026-08-07-front-desk-operational-reads-design.md); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md); [Clerk auth](./2026-07-28-clerk-auth-design.md); [reservations vertical](./2026-08-04-reservations-vertical-design.md)

**Implementation order:** after front-desk operational reads (server routes live). This slice stands up `apps/web-pms` + `@hospai/client-core`, served same-origin from `pms-core`.

---

## 1. Context & Motivation

The server slice shipped arrivals / in-house / departures, guest batch compose, org entitlements, and the current-shift singleton. Nothing consumes them yet. This vertical is that consumer: an operator SPA that can render the board, compose names, assign a room, check in, and behave correctly under the degraded contracts the API already emits.

### Verification commitment (acceptance, not aspiration)

The project's mutate-and-run loop transfers to SPA **logic**, not SPA **rendering**.

**Structural rule:** transport, degraded classification, queued-command log, compose, paging, idempotency-key generation, and entitlement-snapshot state live in modules with **injected transport and no DOM**. Screens stay thin over that layer.

`verify` means: for each canary row, plant one mutation and confirm **at least the named test fails** (no silent mutation). Extra failures are informative blast-radius, not an acceptance breach. Render assertions are smaller, separate, and labeled non-canary. If the logic ends up embedded in components, the guarantee every prior slice had quietly stops applying.

### Scope in

1. **`@hospai/client-core`** — DOM-free logic package (typed client, transport, degraded state machine, compose, paging, keys, snapshot, queued-command log).
2. **`apps/web-pms`** — React + Vite SPA: shell, three-mode board, check-in (+ assign-room), shift strip, queued-command log UI.
3. **Same-origin serve** from `pms-core` Workers assets (`run_worker_first`), turbo/CI build-order, vitest `ASSETS` stub.
4. **Enforcement** — deps/typecheck package boundary; lint `no-dom-in-client-core` + `no-fetch-in-components`; contracts browser-safe import path.
5. **Auth** — injected credential provider; both `x-dev-actor` and Clerk cookie providers ship.

### Scope out

- Module `ui` manifest / registry composition (§9 sketch).
- Nav `entitled && permitted` filter / speculative `<Gate>`.
- Stale-data watermark UI (no projection this board reads).
- Folio / payment / money screens.
- `GET /v1/me` / org-listing (tenant context is configuration this vertical).
- Open/close shift cashiering UI.
- Independent UI deploy + CORS (Approach B escape hatch).
- Hibernation WebSocket / `entitlement.changed` push.

---

## 2. Design Decisions

### 2.1 Origin and serving (Q1) — same-origin on `pms-core`

**Lock A.** SPA and API deploy as one Worker artifact.

**Why stronger than "no CORS":** the typed client is derived from `@hospai/contracts` / `V1_HTTP_ROUTE_AUDIT`, the same table `check:permissions` pins against `V1_ROUTES`. Same-origin means the client is always live against the routes it was built from. A separate SPA deploy can ship a client compiled against routes the Worker doesn't have — reintroducing route-table drift across a boundary no check can see.

**Reject B (separate origin + CORS):** credentialed CORS means per-environment origin allowlists; a permissive allowlist is a tenant-isolation hole. No product reason to take that surface now. Reversible later if independent UI cadence justifies it.

**Reject C (dev-proxy now, decide later):** papers over origin, cookies, and preflight for every screen, then surfaces all three at ship time — verify-at-the-end applied to architecture.

### 2.2 Serving approach — Worker-first, SPA owns `GET /`

**Lock Approach 1.**

| Setting | Value |
|---|---|
| Assets binding | `ASSETS`, directory `apps/web-pms/dist` |
| `run_worker_first` | `true` |
| SPA fallback | `not_found_handling: "single-page-application"` **or** Worker rewrite to `/index.html` if binding fetch does not apply it (confirm empirically; see §3.2) |
| Fetch order | `assertEnvSafeForRequest` → `/v1` and `/v1/*` API → `env.ASSETS.fetch(request)` |
| `GET /` | SPA index (retire `'hospai-pms-core'` banner; nothing depends on it) |
| Success logging | `/v1/*` only (`logHttpRequest` stays scoped) |
| Error logging | **Global** — broken assets / failed `ASSETS.fetch` must not be silent |
| Test env | Stub `ASSETS` binding in vitest (not "404 when absent") |
| Build order | Explicit turbo task edge `pms-core#build` → `@hospai/web-pms#build` (filesystem path in wrangler is invisible to `dependsOn: ["^build"]`). CI builds `web-pms` before `wrangler deploy`. |

**`/v1` without trailing slash** is part of the API branch (not assets fall-through).

**Named costs**

| Cost | Trade |
|---|---|
| Deploy coupling | CSS/SPA change redeploys API Worker. Mitigated by atomic versioned deploys / pin-rollback. Escape hatch: Approach B later. |
| Every asset is a Worker invocation | Direct price of `run_worker_first` / full gate coverage. Acceptable for internal PMS. |
| No shell if Worker fails to boot | Approach 2 (assets-first) would keep static assets up for an "API unavailable" shell. We forgo that so a misconfigured env refuses **everything**, matching today's gate design. |

**Posture:** misconfigured Worker → hard refuse for API **and** SPA. Intentional.

**Cache-Control:** hashed chunks → long-lived immutable; `index.html` → no-cache. Stated explicitly — do not leave as "whatever the binding did." Unstated no-cache on the shell is the same drift class arriving through the browser.

### 2.3 Testable boundary (Q3) — `@hospai/client-core`

**Lock A** as a workspace package named for everything it holds (not `api-client`, which invites fetch wrappers while the state machine drifts into the app).

**Reject B** (`apps/web-pms/src/lib`): an app that depends on React will always resolve React; no typecheck layer for the package boundary.

**Reject C** (split thin fetch vs state machine): the interesting part *is* the state machine; paying package setup while keeping canaries in the app is worst-of-both.

**Enforcement layering**

1. **Deps / typecheck** — `client-core` does not list React, DOM types, TanStack Query, or Clerk. Errant imports fail typecheck. **This layer enforces the package boundary.**
2. **Lint `no-dom-in-client-core`** — second net for bare globals (`document`, `window`, `localStorage`) that have no package to block. **Do not treat this rule as covering Query/Clerk.**
3. **Lint `no-fetch-in-components`** — screens use client-core + Query `queryFn`s only.

Plain vitest (no `@cloudflare/vitest-pool-workers`) for the canary loop — faster and deterministic under plant-one-mutation.

### 2.4 Stack (Q2) — React + Vite + React Router + TanStack Query

**Lock A.** ARCHITECTURE.md §9 already sketches React (`useNavRegistry`, `<Gate>`). Deviating spends a decision on nothing.

**Query retry:** Query's defaults contradict the degraded contract (three retries on `FAIL_CLOSED` hammer a struggling PropertyDO; backoff ignores `Retry-After` on `READ_STALE`). **Disable Query retry by default; delegate to `client-core` predicates** `shouldRetry(err)` / `retryDelay(err)`. Query executes; client-core decides. Predicates are canary-testable in plain vitest.

Query sits *above* the canary boundary — it does not weaken the loop. Guest-batch cache keyed by `guestRef` is the concrete win (shared across board modes).

**Auth:** credential source is an **injected provider on transport** — an interface, not a branch.

- Local / SPA tests → `x-dev-actor` provider (already gated `HOSPAI_UNSAFE_LOCAL` + `HOSPAI_ALLOW_DEV_ACTOR`; dead in production by construction).
- Production → Clerk session provider (same-origin cookies).

Neither is a stub; nothing is thrown away; the shell never learns which it has. Matches server `authenticateRequest` + parallel gated dev path.

### 2.5 Module `ui` manifest (Q4) — defer

**Lock A.** No second module; inventing a manifest for zero consumers is the stub pattern this session closed repeatedly. **Reject** `ui?: unknown`.

**Make deferral cheap:** shell nav is an **array of entries**, routes a **table**, both plain data mapped over. A later registry concatenates module contributions instead of a literal — extraction is a move, not a redesign.

**Defer the filter too:** every front-desk route is `pms.core`; staff already carries every permission this vertical touches. An `entitled && permitted` filter and `<Gate>` built now would be carriers with no observable behaviour.

**Entitlements snapshot consumption:** not nav gating. Transport-level **refetch-on-402** holds and uses the snapshot in client-core. Nav ignores it until a surface diverges by role (folio/settings).

### 2.6 Screens (Q5) — three-mode board + check-in (+ assign-room)

**Lock A.** Arrivals / in-house / departures over **one board component** + guest-batch compose + assign-room + check-in.

**Accurate reason for three modes:** not "three different client cursor codecs." The server already returns **opaque** cursor strings; the client passes them back untouched. All three lists share one client paging path. What differs on the client is **param shape** (date required vs open set) and the shared compose path. Server-side composite cursors were canaried in the reads slice; client canary #7 exercises opaque pass-through / exhaustion / accumulation, not tuple decode.

**Assign-room is in scope deliberately** — it is the third degraded write behaviour:

| Path | Behaviour |
|---|---|
| Fail-closed read | Board can't render; 503 `degraded: 'FAIL_CLOSED'` — list must **not** pretend to be empty |
| Fail-closed write | `reservations.assign_room` refuses; hard refusal UI; no queued-command log entry |
| Provisional write | `reservations.check_in` → 202; queued-command log grows |
| Queue down | 503 `queue_unavailable` — distinct class; no log entry |

**Check-in does not require an assigned room.** `tryCheckIn` rejects when `status !== 'confirmed'` and has **no** `room_id` precondition. **During a PropertyDO outage, room assignment refuses and check-in still queues.** Assignment happens on recovery. That is the coherent degraded story and keeps the provisional canary reachable for unassigned arrivals.

**Stale watermark:** unexercised — no reservation projection; board does not read `ari:`. Do not build a watermark component with nothing to render.

**Shift strip:** read-only `GET …/front-desk/shift`. Open-shift UI stays out (cashiering / money). Populated (non-null) state is exercised by **fixtures only** this vertical — stated limitation, not assumed product path.

**Tenant bootstrap:** no `GET /v1/me` / org-listing exists. Shell org + property are **configuration** this vertical (not hardcoded literals buried in components). Named leftover for a real bootstrap route.

---

## 3. Architecture

### 3.1 Ownership table

| Unit | Owns | Must not own |
|---|---|---|
| `@hospai/client-core` | Typed client from contracts route audit; injected transport + credential provider; degraded classification (incl. `queue_unavailable`, 401, 402); `shouldRetry` / `retryDelay`; session queued-command log from 202s; entitlement snapshot + refetch-on-402 (**no replay**); guest-batch compose (wholesale + per-ref); opaque-cursor paging helpers; idempotency key generation (stable across retries of one logical op) | React, DOM, TanStack Query, Clerk SDK, CSS, cursor encode/decode |
| `apps/web-pms` | Thin screens; shell layout; nav/route **data tables**; QueryClient wiring that calls client-core predicates; credential provider **adapters**; board / check-in / shift-strip / queued-log **rendering**; 401 → redirect to sign-in | Retry policy, degraded state machine, compose mapping, key generation, snapshot refetch |
| `apps/pms-core` | Same-origin serve per §2.2 | SPA business logic |

**Queued-command log ownership:** accumulation in client-core (canaryable); rendering in the shell. Derived from 202 bodies (`commandId`, `idempotencyKey`, `issuedAt`, `businessDate` per reads-slice contract). Session-scoped; lost on reload — not a projection substitute.

**Boundary → canary map** (every client-core row in the ownership table must stay here; if a concern has no canary, it will drift into the shell):

| client-core concern | Canary # |
|---|---|
| Credential provider on transport | 12 |
| Degraded / auth classification + retry predicates | 2, 3, 4, 5, 11 |
| Queued-command log accumulation | 1 |
| Entitlement snapshot + refetch-on-402 (no replay) | 6 |
| Opaque-cursor paging | 7 |
| Guest-batch compose (wholesale + per-ref) | 8, 10 |
| Idempotency key stability across retries | 9 |
| Typed client / route audit | Build-time via contracts subpath + `check:permissions` (not a runtime canary) |

Shell-only behaviours (401 redirect, hard-refusal UI chrome, board empty-vs-unreachable copy) are non-canary render assertions — they must not re-implement classification.

### 3.2 Worker fetch (normative)

```
assertEnvSafeForRequest(env)
if pathname is /v1 or starts with /v1/ → handleV1 (+ success log)
else → ASSETS.fetch(request)  // SPA; errors logged
```

SPA fallback for client routes (e.g. hard refresh on `/arrivals`) is a **pms-core test** against the stub `ASSETS` binding: unmatched non-`/v1` path results in index fall-through (stub called with rewrite to `index.html`, or binding SPA response — not a JSON 404). Not a checklist item.

### 3.3 `@hospai/client-core` surface

**Degraded / auth classification** (distinct classes):

| Wire | Class | Retry? |
|---|---|---|
| 2xx live | live | n/a |
| 202 `provisional: true` | provisional → append queued-command log | n/a (success) |
| 503 `degraded: 'FAIL_CLOSED'` | fail_closed | **never** |
| 503 `degraded: 'READ_STALE'` + `Retry-After` | read_stale | per `retryDelay` from header |
| 503 `error: 'queue_unavailable'` | queue_unavailable | **never**; **no** log entry |
| 402 entitlement | entitlement_required | **never**; refetch snapshot **once**; **do not** replay the original request |
| 401 | unauthorized | **never** |

`READ_STALE` is unit-tested in client-core because the library must classify all wire shapes. **No route in this vertical produces it** (lists are `FAIL_CLOSED`; board does not read availability) — which is why no watermark UI is built. Not a contradiction of the watermark leftover.

**402 vs replay:** `get_org_entitlements` has no entitlement gate, so the refetch itself cannot 402. Still: refetch once, surface failure, never loop the original call.

**Compose:** map per-ref outcomes — resolved profile, `erased: true`, `guest_not_found`, `decrypt_unresolved` — plus wholesale batch 503 ("names lag", list still usable).

**Paging:** pass opaque `cursor` string back; know when exhausted (`nextCursor` null); accumulate pages. **No** client encode/decode of cursor payloads.

**Idempotency:** generate key once per logical operation; stable across every retry of that operation.

**Contracts import (acceptance):** do not import `@hospai/contracts` root if that pulls `config/register` + zod into the browser bundle. Add a **browser-safe subpath export** (e.g. `@hospai/contracts/v1-http-routes` and whatever else the typed client needs) and depend on that. Resolve in this slice — not a leftover.

### 3.4 Shell / board / check-in

**Shell**

- Credential provider injected at transport construction.
- Org + property from **configuration** (env / config module), not a discovery API.
- Nav array + route table → React Router.
- QueryClient: `retry: false` default; per-query delegates to client-core.
- Renders queued-command log from client-core state.
- On classified `unauthorized` → redirect to sign-in (shell behaviour; non-canary render assertion).
- No watermark. No speculative always-true `<Gate>`.

**Board** — one component, three modes:

| Mode | Example route | API | Params |
|---|---|---|---|
| Arrivals | `/arrivals` | `GET …/front-desk/arrivals` | `date` required |
| Departures | `/departures` | `GET …/front-desk/departures` | `date` required |
| In-house | `/in-house` | `GET …/front-desk/in-house` | none |

Two-call compose; guest Query cache by `guestRef`. Distinguishable row states for the four per-ref outcomes + name-pending.

**Check-in flow** (order is UX, not a dependency):

1. Select arrival → check-in surface.
2. Assign room — `FAIL_CLOSED`; may be skipped or refused during outage.
3. Check in — `QUEUE_PROVISIONAL`; **allowed without assigned room**; queues during PropertyDO outage.

**Shift strip:** read-only; null and fixture-seeded non-null both renderable.

---

## 4. Testing

### 4.1 Canary matrix (`@hospai/client-core`, plain vitest)

Property: **no silent mutation** — each row's mutation must fail **at least** its named test. Additional failures are blast-radius evidence, not an acceptance breach.

| # | Mutation target | Named assert |
|---|---|---|
| 1 | 202 / provisional handling | queued-command log gains entry |
| 2 | FAIL_CLOSED read | classified; `shouldRetry` false |
| 3 | FAIL_CLOSED write (assign-room) | hard refusal path; no log entry |
| 4 | `queue_unavailable` | distinct class; no log entry |
| 5 | READ_STALE + Retry-After | `retryDelay` honours header (unit-only; see §3.3) |
| 6 | 402 | snapshot refetched once; original **not** replayed |
| 7 | Paging | opaque cursor passed through; exhausted on null; no client-side duplicate accumulation |
| 8 | Batch wholesale 503 | list side still returned; names lag |
| 9 | Idempotency key regenerated per attempt | two attempts of one logical op share one key |
| 10 | Per-ref erased + decrypt_unresolved | full list composes; two distinguishable states |
| 11 | 401 | distinct class; `shouldRetry` false |
| 12 | Credential provider bypassed / ignored | transport attaches exactly what the injected provider supplies — proven with **two** stub providers (dev-actor header shape and cookie shape) |

### 4.2 Non-canary (honestly labeled)

- Layout / visual correctness / real browser behaviour.
- Shell redirect to sign-in on 401 (pairs with canary #11).
- Shift strip non-null branch (fixture-seeded only).
- Clerk app instance / deploy keys.

### 4.3 Integration / Worker tests

- SPA fallback via stub `ASSETS` (§3.2).
- Existing pms-core suite remains green with stub binding.
- `pnpm typecheck` / lint / turbo graph include `client-core` and `web-pms`.

---

## 5. Leftovers

| Leftover | Why deferred |
|---|---|
| Module `ui` manifest + shell registry | No second module; nav/routes stay data tables for later concatenation |
| Nav `entitled && permitted` / `<Gate>` | No role or entitlement divergence on this board; becomes real at first divergent surface (folio/settings) |
| Stale-data watermark | No projection this board reads; becomes real when a surface reads availability |
| Folio / payment / money UI | Second vertical; first genuine admin/staff permission split |
| `GET /v1/me` / org listing | Shell tenant = configuration this vertical |
| Open/close shift UI | Cashiering; strip stays read-only |
| Independent UI deploy (Approach B / CORS) | Escape hatch if UI cadence demands it |
| Hibernation WebSocket / entitlement push | Refetch-on-402 substitutes for this vertical |

---

## 6. Acceptance checklist

- [ ] `@hospai/client-core` owns every canaryable concern in §3.1; no React/DOM/Query/Clerk deps; lint nets as specified.
- [ ] Canary matrix §4.1 green; plant-one-mutation shows **no silent mutation** for each row.
- [ ] Contracts **browser-safe subpath** used; bundle does not ship config register / zod schemas for workstation SPA.
- [ ] Same-origin Approach 1 wiring (§2.2); turbo task edge + CI deploy order; stub `ASSETS`; SPA fallback **test**; cache-control stated; success logs API-only; error logs global.
- [ ] Board: three modes, compose with per-ref states, FAIL_CLOSED ≠ empty board.
- [ ] Assign-room FAIL_CLOSED + check-in QUEUE_PROVISIONAL; check-in without room; outage: assign refuses, check-in queues.
- [ ] Query retry delegated to client-core; credential providers both ship; shell does not branch on provider.
- [ ] Shift strip read-only; watermark / nav filter / `ui` manifest **absent** (not stubbed).
- [ ] Tenant org/property from configuration; leftover recorded for bootstrap API.
- [ ] `web-pms` and `client-core` satisfy turbo `build` / `test` / `lint` / `typecheck`.

---

## 7. Why POST for guest batch (cross-spec note)

The reads slice chose `POST …/guests/batch` over a GET with query-string refs so fifty person-identifiers are not written into URLs, proxies, and access logs. That is an intentional REST-shape trade for PII hygiene, not an accident. The SPA always makes **two calls per board page** (list + batch) — owned cost documented in the reads design; do not "optimise" into a server join that re-couples failure domains.
