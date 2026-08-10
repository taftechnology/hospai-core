# Property `/me` Permissions (SPA Affordance Gate)

**Date:** 2026-08-09  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-09-property-me-permissions.md`. Locks Q1=B, Q2=B (+ `orgId` + display-only `role`), Q3=no entitlements (and do not add later), Q4=C, Q5=A fail-open **only when authority unknown** (404 → no-access; 401 → sign-in), withhold until settle, 403→invalidate `me`, `Cache-Control: private, no-store`, `check:web-pms-me-gating`  


**Sources:** [folio front desk](./2026-08-08-folio-front-desk-design.md) §2.3 (authority vs precondition) leftover #2; [cashier shift SPA](./2026-08-09-cashier-shift-spa-design.md) §2.10 (shell Open under authority-unknown); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) leftover `GET /v1/me`; [get_property partial / forbidden bodies](./2026-08-09-get-property-partial-forbidden-bodies-design.md) (`check:do-transport-guards`); `packages/contracts/src/permissions.ts` (`ROLE_GRANTS`, scope helpers); `OrgDO.getEffectiveRole` / `assertPermission`; `apps/web-pms/src/client.ts` entitlement store (402-reactive only)

**Implementation order:** after cashier shift SPA (live on `main`). This slice makes authority *known* so folio §2.3 hide/attempt and cashier §2.10 Open chrome can stop guessing.

---

## 1. Context & Motivation

Today every SPA affordance that needs a permission either always shows and eats a 403, or cannot hide without inventing a client copy of `ROLE_GRANTS`. Folio leftover #2 named this explicitly: without `/me`, hide vs disable is not implementable.

Grounded facts that shape the slice:

- `getEffectiveRole(userId, propertyId)` is **per-property** (`property_member` falling back to org `member`).
- `assertPermission` rejects cross-scope with `scope_mismatch` — org permissions are not assertable with a property id.
- Entitlements are **not** entirely unwired: `client.ts` builds an entitlement store and `createClient` refreshes it **reactively on 402**. `api.getOrgEntitlements` is a second, unused path into the same store. Nothing gates UI on the snapshot proactively. That is a real gap and a **separate** slice — `/me` must not fold entitlements in.
- The security boundary remains the server. Client checks are advisory.
- **Reachability of Q4 hide (verified against `ROLE_GRANTS`):** every current role holds `reservations:read` and `folio:post`. Only staff lacks `folio:adjust` (and `org:manage`). So with today's three roles, **nav hide and strip-Open hide never fire for any real actor**; only the in-page disable path is end-to-end reachable. The hide machinery still ships — it becomes live when a role lacking those grants exists (e.g. housekeeper / housekeeping slice).

### Scope in

1. **`GET /v1/properties/:propertyId/me`** — actor's effective role + server-resolved permission arrays for that property.
2. **OrgDO read** that resolves grants from `ROLE_GRANTS` (single source of truth) into scope-split arrays.
3. **client-core** typed `getMe` / query key; SPA boot loads it; **403 → invalidate `me`** (entitlement-store precedent).
4. **Affordance policy** — hide nav/shell destinations when permission absent; disable in-page actions with existing permission copy; **fail open only when authority unknown** (`fail_closed` / pending); **404 → no-access**; **401 → sign-in**; **withhold** filterable chrome until settle.
5. Pure nav/shell filter helpers unit-tested with fabricated `me` (hide path; no real role can exercise it E2E today).
6. Boot mock + canaries: shell mounts on `/me` `fail_closed`; no-access on `/me` 404; unauthorized on `/me` redirects to sign-in.
7. **`check:web-pms-me-gating`** — machine-check never-gate-on-role / no `ROLE_GRANTS` client oracle (import path already open).
8. **`Cache-Control: private, no-store`** on this handler; payload includes `orgId`.

### Scope out

- Proactive entitlement gating / folding entitlements into `/me` (leftover).
- Org-scope `GET /v1/orgs/:orgId/me` (not needed while SPA has one `tenant.propertyId`).
- Role-derived client grants (`ROLE_GRANTS` on the wire as the client oracle).
- Replacing server `requirePermission` with client checks.
- Tenant/org picker bootstrap (shell leftover — separate from permission arrays).
- Expanding nav beyond today's three board entries (permission keys on `NavEntry` are in-scope; new destinations are not).
- Inventing a fourth role this slice just to exercise hide E2E (housekeeping owns that).

---

## 2. Design Decisions

### 2.1 Q1 — Route scope → **B (property)**

```
GET /v1/properties/:propertyId/me
```

| Lock | Detail |
|---|---|
| Audit id | `get_property_me` |
| Index | Append at **69** (after `get_front_desk_recent_shifts` at 68) |
| `permission` | `property:read` — all three roles hold it; denial = not a member → existing `not_member` → 404 |
| `entitlement` | **omit — permanently for this row** (see landmine note below) |
| `degradedRead` | `FAIL_CLOSED` |
| `commandId` | omit (`check:degraded` mutual exclusion) |
| Pattern | `/^\/v1\/properties\/([^/]+)\/me$/` — brace-free (permissions-check parser) |
| Response headers | `Cache-Control: private, no-store` on success **and** degraded bodies for this handler |

**Entitlement omission is load-bearing, not style.** `gateEntitlement` runs only when the route declares an entitlement (`v1-dispatch.ts` `entitlementForRoute` → gate). Omitting the field exempts `/me` from feature entitlement **and from kill-switch** — kill keys live in `ENTITLEMENT_KV` and surface through that same path (402 / kill check before the handler). That is what you want for shell boot: a kill of `pms.core` must not brick `/me`. **Do not add `entitlement: 'pms.core'` later "for consistency"** — that silently makes the shell kill-switchable and unbootable under the kill. Precedent for the shape: `get_provisional_exception_count` (same `property:read`, `FAIL_CLOSED`, no entitlement).

Handler: after `resolvePropertyContext`, call OrgDO (not PropertyDO). Own `try`/`catch` with `isOrgDoTransportFailure` → `degradedFailClosedOrgReadResponse()` (`org_unreachable` at `invoke-property-do.ts`). Pin **org** body, not `property_unreachable` — the DO that failed is OrgDO. (`handlePostGuestsBatch` returns the *property* FAIL_CLOSED helper on `isOrgDoTransportFailure` — real inconsistency; do not copy it.) Set `Cache-Control: private, no-store` on every response from this handler (200 and FAIL_CLOSED). Repo-wide cache headers on other per-tenant GETs are a leftover — `/me` is the worst identity-shaped response to leave heuristic-cacheable.

### 2.2 Q2 — Payload → **B (resolved arrays) + display-only `role`**

```ts
{
  ok: true;
  orgId: string;                             // from resolvePropertyContext / property registry — not inferred client-side
  propertyId: string;
  userId: string;
  role: 'owner' | 'admin' | 'staff';  // display / support only — NEVER gate on this
  permissions: PropertyScopedPermission[];   // assertable with this propertyId
  orgPermissions: OrgScopedPermission[];     // held by role; assertable only at org scope (for this orgId)
}
```

`orgId` is free (`resolvePropertyContext` already has `property.orgId`) and prevents silent coupling to `tenant.orgId` when the deferred tenant picker lands.

**Why not client-side `ROLE_GRANTS`:** a grant change would need a client redeploy to stay truthful; a stale bundle would show affordances the server rejects — the drift class this repo keeps finding.

**Why two arrays:** `assertPermission` returns `scope_mismatch` when an org permission is asserted with `propertyId != null` (`org-do.ts`). A flat list would let the client believe `org:manage` is assertable at a property.

**Resolution (server):**

1. `role = await getEffectiveRole(userId, propertyId)`; if null → `{ ok: false, error: 'not_member' }`.
2. `grants = ROLE_GRANTS[role]`.
3. `permissions = grants.filter(isPropertyScopedPermission)`.
4. `orgPermissions = grants.filter(isOrgScopedPermission)`.
5. Never include `shell:internal` / platform-only (already absent from `ROLE_GRANTS`).

**HTTP vs DO for `not_member`:** the dispatcher runs `requirePermission(…, 'property:read')` → `assertPermission` → `not_member` → **404 before the handler**. By the time `readPropertyMe` runs over HTTP, the actor provably has a role — step 1's null branch is **unreachable via the route**. Keep the typed `not_member` return for **direct DO / unit callers** (same structural fact as server 403 bodies after the gate stamps `permission`). Do not claim the HTTP 404 test covers the DO branch.

**Spec rule — never gate on `role`.** Client helper API is permission-set membership only (`hasPropertyPermission` / `hasOrgPermission`). Enforced by `check:web-pms-me-gating` (§2.8) — not review judgment.

### 2.3 Q3 — Fold entitlements into `/me`? → **No**

| Plane | Failure |
|---|---|
| `/me` | OrgDO transport → FAIL_CLOSED `org_unreachable` |
| Entitlements | `EntitlementResolutionError` → 503 `entitlement_unavailable` from `loadSnapshot` |

Folding merges two degraded stories into one route and couples shell boot to entitlement resolution. Keep 402-reactive entitlement store as-is. **Leftover:** proactive entitlement-aware chrome (hide/disable when feature off before first 402).

### 2.4 Q4 — Hide or disable? → **C**

| Surface | Behaviour when permission absent **and** `/me` is live | Reachable today? |
|---|---|---|
| Nav destinations | **Hide** — a link that only ever 403s is a dead end | **No** — all roles have `reservations:read` |
| Shell chrome that is effectively a destination (e.g. strip **Open shift** without `folio:post`) | **Hide** — same rationale as nav; retires cashier §2.10 "attempt because authority unknown" for the known-absent case | **No** — all roles have `folio:post` |
| In-page actions (folio split, etc.) | **Disable** with reason — *"Requires permission `folio:adjust`. Ask a manager."* — reuse `permissionForForbidden` / `use-folio-action-mutation` copy shape | **Yes** — staff lacks `folio:adjust` |

**Hide path ships unexercised by real roles.** Implement nav/shell filtering as **pure functions over `Authority`** (`live` | `unknown` | `pending`) so fail-open and withhold are inside the helper (not JSX bypassing it), and unit-test §2.5 rows including a **fabricated** live `me` missing the grant. Matrix rows for hide are unit-level, not E2E integration that would pass vacuously. The hide path becomes live when a role lacking `reservations:read` / `folio:post` exists — housekeeping / housekeeper is the natural ordering confirmation, not this slice's job.

When `/me` is unavailable, Q5 overrides: do not hide/disable from a missing snapshot.

### 2.5 Q5 — `/me` unavailable → **A (fail open) + withhold until settle**

The client check is **advisory**. `requirePermission` still gates every route on the server. Failing closed turns one OrgDO blip into a dead shell for every user — strictly worse than today.

**Write this next to the rule in implementation notes** so "permissions fail open" is not read as a defect:

> Fail open **only when authority is genuinely unknown** — `/me` `fail_closed` / transport failure after settle, and the withheld pending state. Keep the 403 explain path; it is the safety net that makes fail-open defensible. **Do not delete 403 copy this slice.** Definitive answers (401, 404) are **not** fail-open.

**404 is not fail-open.** A 404 is a definitive denial. Non-member (`requirePermission` → `not_member`) and property-not-found (`resolvePropertyContext`) both return bare `{ error: 'not_found' }` 404s — **deliberately indistinguishable** (must not leak property existence to non-members). Copy must cover both without disclosing which: e.g. "You don't have access to this property."

Today 404 classifies as generic `client_error` (`status >= 400 && < 500`), which would wrongly land in fail-open if the SPA only branched on class. **Lock:** SPA treats `/me` with `classified.status === 404` as a dedicated **no-access** shell state — not fail-open, not withhold-then-expand. No new `ClientResultClass` required this slice (status is already on `ClassifiedResponse`); do not bucket 404 with `fail_closed`.

**401 is not fail-open.** Classify already gives 401 its own class — `'unauthorized'` — so the SPA branches cleanly (no status sniffing, unlike 404). **Lock:** `/me` → `unauthorized` → **sign-in redirect**. Precedent shape: `BoardScreen.tsx` on board 401 (`window.location.assign('/sign-in')`). Prefer the same full navigation for `/me` 401 so the in-memory `QueryClient` clears. Note: that board redirect is **screen-local today** — there is no transport-level `on401` counterpart to `on402` in client-core; Folio/Shift/strip 401s do not redirect. This slice does not invent a global 401 hook; it only requires `/me`'s unauthorized path to redirect.

**First paint (lock):** fail-open-while-pending would paint full nav/strip then shrink when `/me` settles — an affordance pop. **Withhold filterable chrome** (nav, strip Open) until `/me` settles:

| `/me` state | Filterable chrome (nav, strip Open) | In-page actions |
|---|---|---|
| pending | Withhold (minimal / no filtered list yet — not "full then shrink") | Unchanged enablement (or existing policy C) |
| live | Apply hide filter | Apply disable when permission absent |
| fail_closed / transport unknown | Expand to **full** (fail open) | Fail open (enabled; 403 explains) |
| **404** | **No-access state** (not full chrome) | Blocked — no in-page money chrome pretending capability |
| **401 / `unauthorized`** | **Sign-in redirect** (full navigation) | N/A — leave the shell |

Today the pop is invisible (nothing filters for any real role) — still pin withhold so housekeeping does not ship a flicker regression.

Boot canaries: `AppShell.boot.test.tsx` **explicitly** mocks `getMe` to `fail_closed` (full chrome). Separate: `/me` 404 → no-access; `/me` `unauthorized` → sign-in navigation (not full affordances).

### 2.6 Staleness / refetch → **403 invalidates `me` (entitlement precedent)**

§4's query key alone does not define freshness. Without a policy: a newly granted permission stays hidden until reload; a revoked one stays visible until 403.

**Lock (mirror `onEntitlementRequired` → entitlement store refresh at `api.ts:79`):**

| Event | Action |
|---|---|
| Classified mutation/query result `forbidden` (403) | `invalidateQueries({ queryKey: ['me', propertyId] })` |
| `staleTime` | pin **60_000** ms (one minute) — enough to avoid refetch storms; 403 path covers mid-session revoke |

403 explain copy stays. Invalidation makes the safety net do double duty and closes the loop Q5 leaves open for revoke. Grant-after-login still needs either 403 (user retries) or the minute stale window / manual navigation — acceptable; leftover if live grant-push is required.

### 2.7 Relation to folio §2.3

| Authority state | Behaviour |
|---|---|
| `/me` live, permission absent | Hide (nav/shell) or disable (in-page) — authority **known** |
| `/me` live, permission present | Show / enable |
| `/me` fail_closed / transport unknown | Fail open — authority **unknown** → attempt (folio §2.3) |
| `/me` pending | Withhold filterable chrome; do not assume absent |
| `/me` **404** | **No-access** — definitive denial (membership/property); do not fail open |
| `/me` **401 / `unauthorized`** | **Sign-in redirect** — definitive unauthenticated; do not fail open |

**Rule (Q5 restated):** fail open **only when authority is genuinely unknown**. Definitive answers — 401 (unauthenticated) and 404 (no access to this property) — get dedicated states. This is the completion of folio §2.3, not a reversal: unknown → attempt; known-absent permission → hide/disable; known-denied membership/property → no-access; known-unauthenticated → sign-in; pending → withhold.

### 2.8 Never-gate-on-role → **`check:web-pms-me-gating`**

**Warranted, not optional.** `@hospai/contracts` is a direct web-pms dependency and already imported in multiple files; `packages/contracts/src/index.ts` re-exports `./permissions.js`, so `import { ROLE_GRANTS } from '@hospai/contracts'` compiles today with no packaging change. Ninth CI check (with the existing eight):

- Fail if `web-pms` imports `ROLE_GRANTS` from contracts (client oracle).
- Fail if `web-pms` matches affordance gating on `role ===` / `me.role ===` (allowlist display-only uses if any — default: none).

Cheap, consistent with `check:web-pms-colors` / `check:forbidden-bodies`. Merge-blocking for this slice.

### 2.9 Query key and actor identity

Key: `['me', propertyId]` (not `userId`).

**Reason (durable):** **no actor-switch flow exists today.** Dev actor is env-config; there is no in-app "become another user" path. That alone makes omitting `userId` from the key safe for this slice.

**Do not record board 401 redirect as a system-wide invariant.** `grep` shows exactly one `unauthorized` handler in web-pms — `BoardScreen.tsx` — and client-core has no transport-level `on401` (unlike `on402`). A 401 on Folio / Shift / strip / `/me` itself does **not** remount. `/sign-in` sits outside `AppShell` but under the same `QueryClientProvider`; a client-side route to `/sign-in` would leave the cache intact. This slice's `/me` → unauthorized path uses **full** navigation (`location.assign` or equivalent) so *that* path clears the cache — without claiming every screen already does.

**Leftover triggers (any one):** (a) Clerk (or equivalent) can change `userId` without remount; (b) a transport-level 401 handler replaces screen-level redirects with a client-side route to `/sign-in`. Then key on `userId` and/or `queryClient.clear()` on auth change.

---

## 3. Server work

| Piece | Detail |
|---|---|
| OrgDO method | e.g. `readPropertyMe(actor, propertyId)` → `{ ok: true, role, permissions, orgPermissions } \| { ok: false, error: 'not_member' }` (handler adds `orgId` / `propertyId` / `userId` from context) |
| `assertRpcAvailable()` | **Required** on the new method. Trap from `effaacd`: do not add it to an existing method a test probes *while transport-blocked* without updating that test |
| Handler | `handleGetPropertyMe` — registry resolve → Org stub → method; OrgDO transport → `degradedFailClosedOrgReadResponse()`; always `Cache-Control: private, no-store` |
| Handler `not_member` | Defensive only if the DO returns it (should not happen after gate); map to 404. Prefer DO unit test for the typed error |
| Routes | Append audit + `V1_ROUTES` at end (index 69), element-wise identical order |
| Pins | `register.test` pin for index 69; existing pins **19 / 43 / 44 / 61 / 62 / 65 / 66 / 67 / 68** unchanged (tail append shifts nothing) |
| Entitlement field | **Never add** — kill-switch rides the same gate (§2.1) |

Non-user actors: HTTP gate already requires a user actor for permissioned routes; OrgDO method may return `not_member` / refuse system actors for **direct** callers.

---

## 4. Client / SPA work

| Piece | Detail |
|---|---|
| `api.getMe(propertyId)` | Typed GET; returns body above (includes `orgId`) |
| Query key | `['me', propertyId]` — see §2.9 |
| `staleTime` | `60_000` |
| 403 → invalidate | On classified `forbidden`, invalidate `['me', propertyId]` (mutation `onError` / shared helper — entitlement-store shape) |
| Helpers | `hasPropertyPermission(me, PropertyScopedPermission)` / `hasOrgPermission` — **no** `role ===` helpers; type-only contracts import (not `ROLE_GRANTS`) |
| `/me` 404 | Dedicated no-access shell (status === 404); copy covers non-member **and** missing property without disclosing which |
| `/me` 401 | `unauthorized` → full navigation to sign-in (not fail-open; not client-side-only route) |
| Nav filter | Pure `filterNavEntries(entries, Authority)`; unit-test pending/unknown/live rows; `NavEntry.permission: PropertyScopedPermission` (`reservations:read` on board entries) |
| Folio split / adjust | Disable + reason when authority live and `folio:adjust` absent; fail open when authority `unknown` (not on 404) |
| Shift strip Open | Pure `canShowShellOpen(Authority)`; unit-test pending/unknown/live; E2E not required for hide today |
| 403 path | Keep `permissionForForbidden` explain on mutations |
| Boot mock | Must stub `getMe` |
| Rebuild | `pnpm --filter @hospai/client-core build` before web-pms runs (dist resolution) |
| Check | `pnpm check:web-pms-me-gating` (+ wire into CI next to other checks) |

---

## 5. Test matrix

| # | Case | Assert | Layer |
|---|---|---|---|
| 1 | Staff → `permissions` includes `folio:post`, excludes `folio:adjust`; `orgPermissions` includes `org:read`, excludes `org:manage` | OrgDO / HTTP | both |
| 2 | Owner → grantable property + org sets (no `shell:internal`) | OrgDO | DO |
| 3 | Property override role differs from org role → arrays follow **effective** role | OrgDO | DO |
| 4 | Non-member → 404 | HTTP | **dispatcher gate** (`requirePermission`), not DO `not_member` |
| 4a | Direct `readPropertyMe` for unknown user → `{ ok: false, error: 'not_member' }` | OrgDO unit | DO only |
| 5 | OrgDO blocked → FAIL_CLOSED 503 `org_unreachable`, no `commandId` | HTTP + `check:do-transport-guards` | HTTP |
| 6 | Audit append at 69; pins 19/43/44/61/62/65/66/67/68 unchanged | `register.test` / `check:permissions` | contracts |
| 7 | Nav filter pure fn hides entry for fabricated me lacking `reservations:read` | unit | **not E2E** — no real role lacks it |
| 8 | In-page action disabled with permission copy when me live and staff (no `folio:adjust`) | web-pms | E2E reachable |
| 9 | `/me` fail_closed: shell mounts; filterable chrome full (fail open) | boot test | SPA |
| 9a | `/me` 404: no-access chrome; **not** full affordances | boot / shell test | SPA |
| 9b | `/me` `unauthorized`: sign-in redirect (full nav); **not** fail-open | shell test | SPA |
| 10 | Strip-Open helper hides for fabricated me lacking `folio:post` | unit | **not E2E** — no real role lacks it |
| 11 | 403 → `me` invalidated (and explain copy still shown) | web-pms | SPA |
| 12 | No `ROLE_GRANTS` import / no `role ===` gating in web-pms | **`check:web-pms-me-gating`** | CI |
| 13 | Success + FAIL_CLOSED responses carry `Cache-Control: private, no-store` | HTTP | HTTP |
| 14 | 200 body includes `orgId` matching the property's org | HTTP | HTTP |

---

## 6. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Proactive entitlement chrome | Snapshot exists (402-reactive); gate UI before first 402 |
| 2 | Org-scope `/me` | Only if multi-property org chrome needs org-id-scoped grants without a property |
| 3 | Housekeeper / role lacking `reservations:read` | Makes Q4 hide E2E-live; confirm ordering with housekeeping slice |
| 4 | Folio leftover #2 | **Retired** — marked on folio spec |
| 5 | Shell leftover `GET /v1/me` / org listing | Partially discharged (property `/me`); org listing / tenant picker still open |
| 6 | client-core `tsconfig` `"include": ["test"]` | Standing risk from cashier review; not this slice |
| 7 | Guests-batch OrgDO failure returning `property_unreachable` | Pre-existing inconsistency; optional cleanup |
| 8 | Live grant-push without 403 | `staleTime` + invalidate-on-403; push/SSE if product needs instant grant |
| 9 | Repo-wide `Cache-Control` on per-tenant GETs | `/me` pins `private, no-store` now; sweep others later |
| 10 | Key `me` on `userId` / clear cache on auth change | When actor can switch without remount, **or** a transport-level 401 uses client-side routing instead of full navigation |
| 11 | OrgDO gate failures bypass the FAIL_CLOSED read design | `assertPermission` has no `assertRpcAvailable`; `requirePermission` has no try/catch. Method-selective `setTransportBlockedForTest` proves the handler catch only; a genuine OrgDO outage fails the gate first and never reaches the handler's `org_unreachable` path. Same for `get_org_properties` / guests-batch. Not this slice. |
| 12 | `never` exhaustiveness on Authority mappers | `filterNavEntries` / `canShowShellOpen` rely on return-type coverage today (every branch returns). Weaker than `shiftSeverity`'s `const _exhaustive: never` — a new `Authority` member fails at whatever call site TS notices, not at the mapper. Align when either file is next touched. |
| 13 | `check:web-pms-me-gating` walks only `apps/web-pms/src` | Gating logic that migrated into `client-core` would be invisible. Contained today by the DOM-free rule on that package; boundary assumption to remember if advisory permission helpers ever move. |

---

## 7. Acceptance checklist

- [ ] `GET …/properties/:propertyId/me` at audit index 69; `property:read`; **no entitlement (do not add)**; `FAIL_CLOSED`; no `commandId`
- [ ] Payload: `orgId` + `role` display-only + `permissions` + `orgPermissions`; never gate on `role`
- [ ] Handler sets `Cache-Control: private, no-store`; OrgDO `assertRpcAvailable`; transport → `org_unreachable`
- [ ] DO `not_member` covered by direct unit test; HTTP 404 attributed to dispatcher gate
- [ ] Pure nav/shell filter helpers unit-tested with fabricated me; matrix states hide is not E2E-reachable today
- [ ] SPA: disable in-page when me live & permission absent (staff / `folio:adjust`)
- [ ] SPA: withhold until settle; fail open **only** on unknown (`fail_closed`); **404 → no-access**; **401 → sign-in**
- [ ] 403 explain + invalidate `me`; `staleTime` 60s; boot mocks `getMe`
- [ ] `check:permissions` / `check:degraded` / `check:do-transport-guards` / `check:web-pms-me-gating` green
- [ ] Folio leftover #2 marked retired after land
- [ ] Final sweep: typecheck, lint, client-core build + tests, web-pms tests, sharded pms-core

---

## 8. Open questions

None. A–E, 401-as-definitive, and the corrected query-key rationale locked above. Implementer follows §2–§5; leftovers #1 / #3 / #9 / #10 / #11 / #12 / #13 are explicitly out of this slice (or deferred-touch).
