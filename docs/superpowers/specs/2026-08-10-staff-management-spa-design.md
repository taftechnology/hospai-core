# Staff Management SPA

**Date:** 2026-08-10  
**Status:** Accepted — implemented on `main`. Plan: `docs/superpowers/plans/2026-08-10-staff-management-spa.md`. Rev 2 + DO `already_member` widens with `role`  
**Sources:** [membership management](./2026-08-10-membership-management-design.md) (leftover #3 SPA staff UI; leftover #6 invalidate-`me` across properties; leftover #9 forbidden-bodies); [property `/me`](./2026-08-09-property-me-permissions-design.md) (§2.4 hide/disable, §2.5 Authority, `ME_HEADERS`); `apps/web-pms` `filterNavEntries` / `Authority`; `packages/client-core` membership methods; `apps/pms-core` `clerk-lookup.ts` / OrgDO membership RPCs / list handlers

**Implementation order:** after membership management (live on `main`). **Server list-shape + Clerk reverse lookup + 409 body + list cache headers first**, then SPA — SPA builds against final response shapes.

---

## 1. Context & Motivation

Membership shipped eight HTTP routes and client-core methods with **zero SPA clients**. An owner cannot add staff without calling the API by hand — assignable-but-unreachable.

This slice is also the first product surface that makes `/me` Q4 **hide** end-to-end live with a real role: `staff:read` / `staff:write` are held by owner and admin only. Staff lacks both → Staff nav entry hidden. Admin has `staff:*` but lacks `org:manage` → Org section **disabled with reason** (not absent — screen geometry stays role-stable per `/me` §2.4). Owner gets both sections usable.

Housekeeping remains deferred: `housekeeping:read` is universal across today's three roles, so it does not create a distinct audience without a finer `ROLE_GRANTS` row (membership leftover / out of scope).

### Scope in

1. **Server (first):** reverse Clerk lookup (**result union, never throws**); enrich list GETs; property rows gain `hasOrgRole`; Clerk blip → **200 + `directory: 'unavailable'`**; dangling-grant row signal when lookup succeeds but id unresolved; **`Cache-Control: private, no-store`** on both list handlers; **`409 already_member` includes `userId` + `role`**; never persist email/name; injectable reverse-lookup seam.
2. **client-core:** extend list + create error types; pin query `staleTime` / no refetch-on-focus for member lists (or document in web-pms if queries live only there).
3. **web-pms:** Staff nav (`staff:read`); Staff screen; add-by-email; inline role + Remove; confirms (incl. self-remove); oracle / 422 / degraded / dangling-grant copy; self-mutation invalidates `['me', propertyId]`; graceful flip to no-access after self org-DELETE.

### Scope out

- Property switcher / multi-property `me` invalidate (membership leftover #6 — **coupled**; see §7).
- Closing the account-existence oracle in the SPA.
- Clerk Invitations + webhook.
- New `ROLE_GRANTS` roles / housekeeper.
- New audit / `V1_ROUTES` rows (additive shapes only — no index alignment).
- Widening `check:forbidden-bodies` (membership leftover #9).
- List pagination (accepted Phase-0 unbounded; leftover §7).

---

## 2. Design Decisions

### 2.1 Destination → one Staff nav entry; Org section disable (not hide)

| Role | Nav (`staff:read`) | Property section | Org section |
|---|---|---|---|
| staff | **hidden** | — | — |
| admin | visible | usable (holds `staff:write`) | **disabled** with reason (lacks `org:manage`) |
| owner | visible | usable | usable |

**Nav:** `{ id: 'staff', label: 'Staff', path: '/staff', permission: 'staff:read' }` via existing `filterNavEntries`.

**Org section when denied:** render section header + reason, **no body** (admin cannot `GET` org members):

> Org membership — Requires `org:manage`. Ask an owner.

Do **not** invent a third affordance category (vanish in-page sections).

**Section subtitles (pinned):**

| Section | Heading support line |
|---|---|
| Org | *People in your company* |
| Property | *People who work at this property* |

**Read-only property roster is unexercisable today.** `staff:read` and `staff:write` have **identical holders** (owner, admin; staff has neither) — same class of latent affordance as `/me` hide rows before this slice. Spec still gates mutations on `staff:write` and list on `staff:read`; unit-test any read-only chrome only with a **fabricated** `me`, labelled not E2E. Do not write an integration test that would pass vacuously.

### 2.2 Directory enrichment → B (per-request Clerk; never persist; never throws)

List handlers: OrgDO first, then directory enrichment. Resolve via Clerk Backend batch-by-id for the ids on the page.

**Never-throws contract (load-bearing):** `lookupDirectoryByUserIds(env, userIds)` returns a **result union** and **never throws**, matching `lookupUserIdByEmail` (catch internally; unconfigured secrets and SDK exceptions → unreachable / failed outcome). Placing the call inside the existing handler `try` that maps `isOrgDoTransportFailure` → `org_unreachable` must not turn a Clerk blip into a **500**. `check:do-transport-guards` does not cover this.

**Test seam:** `__setLookupDirectoryByUserIdsForTest` in `clerk-lookup.ts` — consulted **before** the configured check (same as email override), so matrix happy-path enrichment works without real Clerk secrets. Locally, unconfigured Clerk is the **default** → every list response carries `directory: 'unavailable'` unless the inject seam supplies data. Matrix #2 **must** use the inject seam.

**Two distinct null/unavailable facts:**

| Signal | Meaning |
|---|---|
| Page-level `directory: 'unavailable'` | Lookup **failed** (blip / unconfigured); **nothing** was resolved. UI: ids + “Names unavailable”. |
| Per-row `displayName` / `email` null while directory ok | Lookup **succeeded**; this id did not resolve (e.g. deleted Clerk user). **Dangling grant** — flag in UI: *Account no longer exists* + Remove. Do **not** render indistinguishable from a Clerk outage. |

**Display preference:** primary = name; secondary = email; fallback email alone; then `userId`. **Always show `userId`**. Dangling rows: emphasize Remove.

**Never persist** `email` / `displayName` on `member` / `property_member`. Matrix #9 asserts **schema** (columns absent / `check:ddl` would catch a persisted column), not merely “handler didn’t write.”

**Degraded — separate failure domain from OrgDO:**

| Failure | Behaviour |
|---|---|
| OrgDO transport | `org_unreachable` FAIL_CLOSED 503 (unchanged) |
| Clerk directory failure / unset secrets | **200** + rows + `directory: 'unavailable'` |

Do **not** FAIL_CLOSED the list when Clerk is down. Contrast with add-by-email POST (`clerk_unreachable` FAIL_CLOSED — must not grant on a guessed id).

**Unbounded lists (accepted Phase-0):** neither members GET paginates; Clerk batch-by-id has its own cap. Accept full-list enrichment with in-handler chunking as needed for typical org sizes; leftover for pagination / hard caps (§7). §2.2 fallback (list+create only if batch proves non-trivial) remains the escape hatch.

**Cache headers:** both list handlers set `Cache-Control: private, no-store` (reuse / share `ME_HEADERS` or equivalent). Enriched bodies are identity-shaped PII for **other people** — stricter need than `/me`. Additive; do this in server step 1, not a repo-wide leftover.

### 2.3 Property list → `hasOrgRole: boolean`

| `hasOrgRole` | Remove meaning |
|---|---|
| `false` | Property-only — revoke all access at this property |
| `true` | Drop override; effective role falls back to org role |

Projection in `listPropertyMembers`. **Do not expose `orgRole`**. Confirm copy uses generic “company role” when true.

### 2.4 Mutation chrome → inline + targeted confirms

- **Inline** role `<select>` + Remove.
- **Confirm required when:**
  1. **Org DELETE** (any target) — name cascade (company membership + all property roles).
  2. **Self-demote / self role change** — *You'll lose access to staff management. Only another owner can restore your role.*
  3. **Self org-DELETE** — **harsher distinct variant** (not the demote copy): total loss — cascade drops property overrides; `/me` → 404 → no-access shell. E.g. *You'll lose all access to this organization and every property. Only another owner can restore you.*
  4. **Self property-DELETE** — consequence-named (property-only vs keep company role via `hasOrgRole`).
- **No confirm** for routine other-user role changes.
- Property Remove (other user) branches on `hasOrgRole`.

Role options: org `owner | admin | staff`; property `admin | staff` only.

### 2.5 Oracle / error copy → A (actionable); 409 carries identity

| API | SPA treatment |
|---|---|
| `422 no_such_user` | Instruction: *No Hospai account for that email yet. Ask them to sign up, then add them here.* |
| `409 already_member` | Redirect using **body `userId` + `role`** (required — see §3.3 DO widen). Copy: *Already a member ({role}). Change their role instead* → focus row by `userId` (works when directory unavailable / dangling email null). |
| `422 email_ambiguous` | Generic + support path |
| `422 role_escalation` / `last_owner` | Rank / last-owner copy |
| `503 clerk_unreachable` | Distinct from org outage (add path) |
| `503 org_unreachable` | Existing org FAIL_CLOSED copy |

**Pin:** oracle not closable in the SPA.

### 2.6 Self-mutation → invalidate `me` + list; self-remove → no-access

On success, if `targetUserId === me.userId`, `invalidateQueries(['me', propertyId])`. After **self org-DELETE**, expect `/me` → 404 → existing **no-access** shell — matrix must assert graceful transition (not a thrown render / stuck error).

**Leftover #6 stays out** (single `tenant.propertyId` today); property switcher inherits it.

Also invalidate members list queries after any successful mutation.

### 2.7 Member-list query freshness (SPA)

Unlike most SPA queries, member lists hit **Clerk on the read path**. Pin for these two queries only:

- `staleTime` ≥ 60_000 (same order as `/me`)
- `refetchOnWindowFocus: false`

Reason: cost / Clerk rate-limit exposure; incidental refetches work against the membership plan to eventually control the oracle via API rate limits. Document the external dependency as the stated reason in code.

### 2.8 No new audit rows

Additive list/409 shapes only. **No** `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES` append.

---

## 3. HTTP response shapes (additive)

### 3.1 `GET /v1/orgs/:orgId/members`

Headers: `Cache-Control: private, no-store`.

```ts
{
  ok: true,
  members: Array<{
    userId: string;
    role: 'owner' | 'admin' | 'staff';
    createdAt: number;
    updatedAt: number | null;
    displayName: string | null;
    email: string | null;
  }>,
  directory?: 'unavailable', // present only when lookup failed; omit when ok
}
```

When `directory` omitted/ok and both name/email null → dangling grant (UI flag). When `directory: 'unavailable'`, null name/email means unresolved globally — do not flag as dangling.

### 3.2 `GET /v1/properties/:propertyId/members`

Same enrichment + headers + directory marker, plus `hasOrgRole: boolean`.

### 3.3 Writes — `409 already_member` body (+ DO widen)

```ts
{ error: 'already_member', userId: string, role: 'owner' | 'admin' | 'staff' }
```

**Lock — widen the DO result**, not HTTP-only additive:

```ts
// setOrgMember / setPropertyMember create mode
{ ok: false, error: 'already_member', role: OrgRole }
```

The handler has `userId` from Clerk lookup but **not** the existing role — that lives on the member row and today is discarded (`membership-org-do.spec.ts` exact `toEqual({ ok: false, error: 'already_member' })`). Widening is an **RPC contract change**: update that pin deliberately to include `role` (keep exact-match shape — do **not** loosen to `toMatchObject`). Same for property create.

Rejected alternative: omit `role` from 409 and read it off the client roster after focus-by-`userId` — works but couples copy to refetch timing.

No new oracle — caller could `GET` the roster. HTTP audit / `V1_ROUTES` still unchanged.

Other write statuses unchanged.

---

## 4. SPA structure

```
/staff
  Property — People who work at this property
    [add] when staff:write (unexercisable read-only today — §2.1)
    roster + mutations when staff:write
  Org — People in your company
    if !org:manage → disabled reason, no body
    else add + roster + confirms
```

Deep-link lacking `staff:read` (live): **redirect** to first visible nav entry (or board).

---

## 5. Test matrix (layer labels)

| # | Behaviour | Layer |
|---|---|---|
| 1 | Clerk fault / inject fail on **list** → 200, rows present, `directory: 'unavailable'` (org **and** property) | HTTP |
| 2 | Injected Clerk ok → `displayName` / `email` populated (must use inject; secrets unset locally) | HTTP |
| 3 | Directory ok + unresolved id → dangling UI path (nulls, no page marker) (org **and** property) | HTTP + SPA |
| 4 | Property list `hasOrgRole` true/false | DO / HTTP |
| 5 | List responses include `Cache-Control: private, no-store` | HTTP |
| 6 | `409 already_member` body includes `userId` + `role` | HTTP |
| 7 | Reverse lookup never throws into OrgDO catch (inject throw → still 200 + marker, not 500) | HTTP |
| 8 | Nav hides Staff for staff role / fabricated me | unit + E2E-capable |
| 9 | Admin: Org disabled with reason; property usable | SPA |
| 10 | Owner: org DELETE confirm cascade; self-demote confirm + invalidate `me` | SPA |
| 11 | Self org-DELETE → confirm (harsh copy) → no-access shell | SPA |
| 12 | `no_such_user` instructional; `already_member` focuses row by body `userId` | SPA |
| 13 | Schema: no email/name columns on member tables (`check:ddl` / migrate pin) | DDL |
| 14 | List OrgDO transport → `org_unreachable` (Clerk inject irrelevant) | HTTP |
| 15 | Member list queries: simulate window focus → **no** second list fetch (behavioural; do not assert `staleTime === 60_000` literal) | SPA |

---

## 6. Sequence

1. **Server:** DO `already_member` + `role` (exact-match DO pin update); never-throw reverse lookup + inject; list enrichment + directory marker + dangling distinction; `hasOrgRole`; list `Cache-Control`; HTTP `409` `userId`/`role`; tests #1–7, #13–14 + DO pin.
2. **client-core:** list + 409 types.
3. **SPA:** Staff nav/screen; confirms; copy; invalidate; query freshness; tests #8–12, #15.
4. Sweep: existing checks; no new audit pins.

---

## 7. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Directory batch non-trivial → list+create-only | Escape hatch §2.2 |
| 2 | Membership leftover #6 × property switcher | Coupled |
| 3 | API-side oracle controls | Not SPA copy |
| 4 | `check:forbidden-bodies` helper / non-literal | Membership leftover #9 |
| 5 | Clerk Invitations | Membership leftover #2 |
| 6 | Members list pagination / hard page cap | Phase-0 unbounded accepted |
| 7 | Repo-wide cache headers on other identity-shaped routes | Lists fixed this slice via `/me` precedent |
| 8 | Rooms fixture dates from inventory seed window | `dbca8f7` bumped literals to `2026-08-20` — dated fuse; derive from PropertyDO seed `fromDate` (today+1) instead |

---

## 8. Acceptance checklist

- [x] Reverse lookup result union, never throws; list Clerk fault → 200 + marker (not 500 / not `org_unreachable`)
- [x] `directory: 'unavailable'` vs per-row null (dangling) distinguished in API + UI
- [x] `hasOrgRole`; Remove / confirm copy branches
- [x] List `Cache-Control: private, no-store`; `409` includes `userId` + `role`
- [x] Schema: no persisted directory columns; `check:ddl` green
- [x] No new audit / `V1_ROUTES` rows (DO `already_member` **does** widen with `role` — RPC, not audit)
- [x] Staff nav hide for staff; Org disable for admin; owner full
- [x] Self-demote + self org-DELETE confirms; self org-DELETE → no-access
- [x] Oracle copy; `already_member` redirect by body `userId`
- [x] Member queries: staleTime + no refetch-on-focus
- [x] Read-only `staff:read` without write labelled unexercisable / fabricated-me only

---

## 9. Open questions

None. `already_member.role` via DO widen locked; plan at `docs/superpowers/plans/2026-08-10-staff-management-spa.md`.
