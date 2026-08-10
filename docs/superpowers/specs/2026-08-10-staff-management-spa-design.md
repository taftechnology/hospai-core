# Staff Management SPA

**Date:** 2026-08-10  
**Status:** Ready for review  
**Sources:** [membership management](./2026-08-10-membership-management-design.md) (leftover #3 SPA staff UI; leftover #6 invalidate-`me` across properties; leftover #9 forbidden-bodies); [property `/me`](./2026-08-09-property-me-permissions-design.md) (§2.4 hide/disable, §2.5 Authority); `apps/web-pms` `filterNavEntries` / `Authority`; `packages/client-core` membership methods; `apps/pms-core` `clerk-lookup.ts` / OrgDO membership RPCs

**Implementation order:** after membership management (live on `main`). **Server list-shape + Clerk reverse lookup first**, then SPA — SPA builds against final response shapes.

---

## 1. Context & Motivation

Membership shipped eight HTTP routes and client-core methods with **zero SPA clients**. An owner cannot add staff without calling the API by hand — assignable-but-unreachable.

This slice is also the first product surface that makes `/me` Q4 **hide** end-to-end live with a real role: `staff:read` / `staff:write` are held by owner and admin only. Staff lacks both → Staff nav entry hidden. Admin has `staff:*` but lacks `org:manage` → Org section **disabled with reason** (not absent — screen geometry stays role-stable per `/me` §2.4). Owner gets both sections usable.

Housekeeping remains deferred: `housekeeping:read` is universal across today's three roles, so it does not create a distinct audience without a finer `ROLE_GRANTS` row (membership leftover / out of scope).

### Scope in

1. **Server (first):** enrich `GET` org/property members with per-request Clerk directory fields; property rows gain `hasOrgRole`; Clerk blip → **200 + `directory: 'unavailable'`** (not FAIL_CLOSED); never persist email/name on member tables; injectable reverse-lookup seam (mirror `__setLookupUserIdByEmailForTest`).
2. **client-core:** extend list response types for enrichment + markers.
3. **web-pms:** Staff nav entry (`staff:read`); Staff screen with Property + Org sections; add-by-email; inline role + Remove; confirms; oracle / 422 / degraded copy; self-mutation invalidates `['me', propertyId]`.

### Scope out

- Property switcher / multi-property `me` invalidate (membership leftover #6 — **coupled**: whoever builds the tenant picker inherits #6 in the same slice; see §7).
- Closing the account-existence oracle in the SPA (not closable by copy; API rate-limit / audit if ever closed — membership leftover).
- Clerk Invitations + webhook.
- New `ROLE_GRANTS` roles / housekeeper.
- New audit / `V1_ROUTES` rows (list shapes are **additive** — no index alignment).
- Widening `check:forbidden-bodies` (membership leftover #9).

---

## 2. Design Decisions

### 2.1 Destination → one Staff nav entry; Org section disable (not hide)

| Role | Nav (`staff:read`) | Property section | Org section |
|---|---|---|---|
| staff | **hidden** | — | — |
| admin | visible | usable (`staff:write` for mutations) | **disabled** with reason (lacks `org:manage`) |
| owner | visible | usable | usable |

**Nav:** `{ id: 'staff', label: 'Staff', path: '/staff', permission: 'staff:read' }` via existing `filterNavEntries`.

**Org section when denied:** render section header + reason, **no body** (admin cannot `GET` org members). Copy shape matches folio permission messaging:

> Org membership — Requires `org:manage`. Ask an owner.

Do **not** invent a third affordance category (vanish in-page sections). Absent Org would be a new `/me` §2.4 row; avoid.

**Section subtitles (pinned):**

| Section | Heading support line |
|---|---|
| Org | *People in your company* |
| Property | *People who work at this property* |

### 2.2 Directory enrichment → B (per-request Clerk; never persist)

List handlers already return membership from OrgDO. After DO success, resolve directory via Clerk Backend `users.getUserList({ userId: [...] })` (or equivalent batch-by-id API) for the ids on the page.

**Display preference:** primary = name; secondary = email; fallback email alone; then `userId`. **Always show `userId`** on the row (PATCH/DELETE address, outbox, support).

**Never persist** `email` / `displayName` on `member` / `property_member`. Resolve per request only — avoids stale SoT and staff PII in OrgDO erasure scope.

**Degraded — separate failure domain from OrgDO:**

| Failure | Behaviour |
|---|---|
| OrgDO transport | existing `org_unreachable` FAIL_CLOSED 503 |
| Clerk directory blip / unset secrets | **200** with membership rows intact + `directory: 'unavailable'`; UI shows ids + “Names unavailable” note |

Do **not** FAIL_CLOSED the list when Clerk is down — that would make a Clerk blip look like a membership outage. Contrast with add-by-email POST, which stays FAIL_CLOSED on `clerk_unreachable` (must not grant on a guessed id).

**Test seam:** `__setLookupDirectoryByUserIdsForTest` in `clerk-lookup.ts` (same inject pattern as email lookup) — Vitest faults Clerk on **list** routes and asserts rows present + marker set (not merely that the field exists on the type).

**Fallback if batch lookup proves non-trivial in implementation:** list + create only; PATCH/DELETE deferred with directory-display leftover. Prefer not to take this path; pin it so the slice stays shippable.

### 2.3 Property list → `hasOrgRole: boolean`

Every property roster row is a `property_member` override. Remove consequences differ:

| `hasOrgRole` | Remove meaning |
|---|---|
| `false` | Property-only — revoke all access at this property |
| `true` | Drop override; effective role falls back to org role (access may remain, possibly higher) |

Projection in `listPropertyMembers` (DO already consults both tables in `getEffectiveRole` / can cheaply `EXISTS` org `member`). **Do not expose `orgRole`** to property readers — that would leak org-table detail past `org:manage`. Boolean only; confirm copy stays generic (“company role”) when true.

### 2.4 Mutation chrome → inline + targeted confirms

- **Inline** role `<select>` + Remove on each mutable row.
- **Confirm required when:**
  1. **Org DELETE** — name cascade: removes company membership **and** all property roles for that user.
  2. **Any self-affecting mutation** (role change or remove where `targetUserId === me.userId`) — name consequence, e.g. self-demote: *You'll lose access to staff management. Only another owner can restore your role.*
- **No confirm** for routine other-user role changes (avoid confirm fatigue).
- Property Remove confirm copy branches on `hasOrgRole` (§2.3).

Role options: org select `owner | admin | staff`; property select `admin | staff` only (never `owner`).

### 2.5 Oracle / error copy → A (actionable, match API)

| API | SPA treatment |
|---|---|
| `422 no_such_user` | **Instruction, not failure:** *No Hospai account for that email yet. Ask them to sign up, then add them here.* |
| `409 already_member` | **Redirect:** *{Name or email} is already a member ({role}). Change their role instead* → focus/scroll to that row |
| `422 email_ambiguous` | Generic + support path (defensive; no user remedy) |
| `422 role_escalation` | Permission/rank copy (existing permission-copy patterns) |
| `422 last_owner` | *This is the last owner. Add another owner before removing or demoting this one.* |
| `503 clerk_unreachable` | Distinct from org outage — retry / try later (add path only) |
| `503 org_unreachable` | Existing org FAIL_CLOSED copy |

**Pin:** the account-existence oracle is **not closable in the SPA**. Closing it (rate limits, audit) is an API leftover on the membership spec, not half-attempted in copy.

### 2.6 Self-mutation → invalidate `['me', propertyId]`

On success, if the mutation’s `targetUserId === me.userId`, `invalidateQueries(['me', propertyId])` for the active tenant property (same spirit as folio 403→invalidate).

**Leftover #6 stays out:** SPA has a single `tenant.propertyId` today — one cache key. Cross-property stale `me` only arises with a property switcher; that slice **inherits membership leftover #6** (cross-link both leftovers).

Also invalidate the relevant members list query(s) after any successful mutation.

### 2.7 No new audit rows

List response fields and Clerk enrichment are additive on existing `list_*_members` handlers. **No** `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES` append, no register index pins, no `check:permissions` element-wise churn.

---

## 3. HTTP response shapes (additive)

### 3.1 `GET /v1/orgs/:orgId/members`

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
  directory?: 'unavailable', // omit or absent when ok
}
```

### 3.2 `GET /v1/properties/:propertyId/members`

Same enrichment fields, plus:

```ts
hasOrgRole: boolean
```

and the same optional `directory: 'unavailable'`.

### 3.3 Writes unchanged

POST/PATCH/DELETE status vocabulary from membership spec unchanged. SPA consumes existing client-core methods.

---

## 4. SPA structure

```
/staff
  Property — People who work at this property
    [add email + role] when staff:write
    roster (enriched) + inline role / Remove when staff:write
  Org — People in your company
    if !org:manage → disabled reason, no body
    else add + roster + confirms as above
```

Route registered in the SPA router; deep-link `/staff` with withhold/fail-open via existing Authority helpers (nav already filtered).

Direct URL while lacking `staff:read` (live authority): treat as no-access or redirect home — pin: **redirect to first visible nav entry** (or board) when live authority lacks `staff:read`; do not render an empty Staff shell.

---

## 5. Test matrix (layer labels)

| # | Behaviour | Layer |
|---|---|---|
| 1 | Clerk fault on **list** → 200, rows present, `directory: 'unavailable'` | HTTP |
| 2 | Clerk ok on list → `displayName` / `email` populated when Clerk returns them | HTTP |
| 3 | Property list `hasOrgRole` true/false for org member vs property-only | DO / HTTP |
| 4 | Nav hides Staff for fabricated / real staff lacking `staff:read` | unit + E2E-capable |
| 5 | Admin: Staff visible; Org section disabled with reason; property mutations work | SPA |
| 6 | Owner: both sections usable; org DELETE confirm mentions cascade | SPA |
| 7 | Self-demote confirm + success invalidates `me` | SPA |
| 8 | `no_such_user` instructional copy; `already_member` routes to row | SPA |
| 9 | Enrichment never written to SQL member tables | DO / HTTP |
| 10 | List OrgDO transport still `org_unreachable` (Clerk mock irrelevant) | HTTP |

---

## 6. Sequence

1. Clerk reverse-lookup helper + test inject + list handler enrichment + `hasOrgRole` + directory marker tests (incl. faulted Clerk).
2. client-core list types.
3. Staff nav + screen + confirms + copy + invalidate.
4. Sweep: existing check scripts; no new audit pins expected.

---

## 7. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Directory display if batch lookup blocked → list+create-only fallback | Escape hatch from §2.2 |
| 2 | Membership leftover #6 × property switcher | **Coupled:** switcher slice must invalidate `me` for affected properties on org-role change; single-property SPA makes #6 inert today |
| 3 | API-side oracle controls (rate limit / audit) | Not SPA copy |
| 4 | `check:forbidden-bodies` helper / non-literal escapes | Membership leftover #9 |
| 5 | Clerk Invitations | Membership leftover #2 |

---

## 8. Acceptance checklist

- [ ] Server list enrichment + `directory: 'unavailable'` on Clerk fault (rows still present)
- [ ] `hasOrgRole` on property list; Remove copy branches
- [ ] Never persist directory fields on member tables
- [ ] No new audit / `V1_ROUTES` rows
- [ ] Staff nav gated on `staff:read` (hidden for staff role)
- [ ] Org section disable-with-reason for admin; usable for owner
- [ ] Actionable oracle copy; org DELETE + self-mutation confirms
- [ ] Self-mutation invalidates `['me', propertyId]`
- [ ] client-core types updated; web-pms tests cover hide + disable + confirms

---

## 9. Open questions

None for drafting. Plan owns task order (server before SPA) and Clerk batch API details within §2.2.
