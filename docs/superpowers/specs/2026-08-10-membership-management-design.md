# Membership Management (Org + Property)

**Date:** 2026-08-10  
**Status:** Approved — plan at `docs/superpowers/plans/2026-08-10-membership-management.md`. Locks Q1=B, Q2=A (symmetric peer-owner ops), Q3=last-owner, Q4=C, Q5=no HTTP `commandId`/`degradedRead` + `staff.update`→`FAIL_CLOSED` **and** `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` (see §2.5), Q6=`staff.changed`; **`getEffectiveRole` (b)** + cascade; **delete** dead `requireOrgMember` / `requirePropertyOrgMember`

**Sources:** `packages/contracts/src/permissions.ts`; `OrgDO.getEffectiveRole` / `ensureMember` / `upsertPropertyMember`; `COMMAND_CATALOG` `staff.add|update|delete` (unrouted; `staff.update` today `QUEUE_PROVISIONAL`); `event-consumer.ts` allowlist (`staff.changed`); `packages/do-runtime/src/org-migrations.ts` + `check:ddl` / `pnpm generate:ddl`; PropertyDO `audit_log`; [property `/me`](./2026-08-09-property-me-permissions-design.md); person-identifier hygiene (email never in query string)

**Implementation order:** after property `/me` (live on `main`).

---

## 1. Context & Motivation

Today membership is bootstrap-only: `ensureMember` on org create, test helpers, and `upsertPropertyMember` without an HTTP surface or escalation controls. There is no way for an owner to add people by a human-usable identifier, no way for an admin to onboard property staff, and nothing that prevents escalation if a naïve write path were opened.

Grounded facts:

- `staff:read` / `staff:write` are **property-scoped** — cannot gate org-scope routes (`scope_mismatch` at `propertyId === null`).
- Only **owner** holds `org:manage`.
- `ensureMember` is `ON CONFLICT DO NOTHING` — cannot change roles.
- `getEffectiveRole` returns `null` when there is no org `member` row **before** reading `property_member` — so orphan overrides are inert today (and a naïve property POST would 201 with no grant).
- `COMMAND_CATALOG` already has unrouted `staff.add` / `staff.update` / `staff.delete` emitting `staff.changed`; `staff.update` is wrongly `QUEUE_PROVISIONAL`.
- `event-consumer` **throws** on unknown `eventType`; `staff.changed` is already allowlisted.
- `audit_log` is PropertyDO-only; `check:degraded` requires neither `commandId` nor `degradedRead`.
- `check:ddl` covers org migrations — `0005` requires `pnpm generate:ddl`.

### Scope in

1. Two HTTP families (org `member` / property `property_member`).
2. **`getEffectiveRole` change (b)** — property override is an independent grant when org role is null; org-scope (`propertyId === null`) unchanged.
3. **Cascade:** org member DELETE removes all that user's `property_member` rows in the same transaction.
4. OrgDO writes: rank-below + symmetric owner peer ops + last-owner; never use `ensureMember` for HTTP updates.
5. Add-by-email (POST body only); Clerk lookup; `no_such_user` / `clerk_unreachable`.
6. Migration `0005` + **regenerate DDL snapshot**.
7. Reconcile `staff.*` catalog (`staff.update` → `FAIL_CLOSED` + opt-out; restate reasons for all three); HTTP routes still omit `commandId` / `degradedRead`.
8. Outbox emits **`staff.changed`** only (org DELETE → **1+N** events); no new event types.
9. Delete `requireOrgMember` / `requirePropertyOrgMember`.
10. Eight audit + `V1_ROUTES` rows; pins; never queue membership.
11. client-core typed clients; invalidate `me` when the actor's own grants change.

### Scope out

- Clerk Invitations + webhook.
- PropertyDO `get_audit_log` for membership.
- SPA staff UI.
- Routing HTTP through `invokePropertyDo` / attaching `commandId` to membership routes.
- Inventing `staff:grant_owner`.
- Org-scope `GET /v1/orgs/:orgId/me`.

---

## 2. Design Decisions

### 2.1 Q1 — Route family → **B (two families)**

| Family | Table | Methods | Gate |
|---|---|---|---|
| `/v1/orgs/:orgId/members` | `member` | GET, POST, PATCH, DELETE | `org:manage` (owner only) |
| `/v1/properties/:propertyId/members` | `property_member` | GET, POST, PATCH, DELETE | `staff:read` (GET) / `staff:write` (writes) |

**Eight** audit / `V1_ROUTES` rows (one per method — same shape as `patch_rate_plan` / `delete_rate_plan`), not four. Patterns brace-free; indices locked at plan time after `get_property_me` (69). Leave pins 19/43/44/61/62/65–69 untouched.

**Entitlement:** omit on all eight — kill-switch must not brick membership. **Do not add `pms.core` later.**

### 2.1a Effective role — **(b) property_member as independent grant** (+ cascade)

Today:

```ts
const orgRole = await this.getMemberRole(userId);
if (!orgRole) return null; // never reads property_member
```

That makes `POST …/properties/:id/members` a silent no-op for non-org-members and guts Q1=B (admins with `staff:write` cannot onboard anyone).

**Lock — change `getEffectiveRole`:**

| `propertyId` | Behaviour |
|---|---|
| `null` (org scope) | **Unchanged** — return org `member` role only; overrides are never consulted. Org-scope routes stay unreachable via override alone. |
| non-null | If org role exists → `property_member.role ?? orgRole` (today's override semantics). If org role is **null** → return `property_member.role` for that property, or `null` if no override. |

**Accepted consequence:** a user may hold property access **without** an org `member` row. They must get **404 on every org-scope route** (gate uses `propertyId === null` → no org role → `not_member`). Mandatory canary in the test matrix.

**Coupled — cascade on org remove:** `DELETE` org member (**cascade only on org DELETE**, not on demote) deletes **all** `property_member` rows for that `user_id` in the **same transaction**. Without cascade, under (b) org removal would leave live property access; even under old (a), re-adding the user later would silently restore stale overrides (including a prior `admin` override when re-hired as `staff`).

This is one decision with (b), not a follow-up.

**Delete dead org-row membership helpers:** `requireOrgMember` and `requirePropertyOrgMember` in `apps/pms-core/src/auth.ts` resolve membership via `org.getMemberRole` only (never effective role). They have **zero callers** today, but after (b) they encode a false invariant — wiring `requirePropertyOrgMember` into any property route would 404 the property-only members this slice creates while `/me` reports their permissions. **Lock: delete both helpers in this slice** (and any stale imports/docs that reference them as the edge membership gate). Dispatch membership stays `requirePermission` → `assertPermission` → `getEffectiveRole` only. They are not a valid proxy for "may this user act at this property."

### 2.2 Q2 — Grant authority → **A (rank-below) + symmetric owner peer ops**

Rank: `owner` > `admin` > `staff`.

**Rule (DO, same transaction):** caller may grant / set / remove only when the **target's role involved in the op** is **strictly below** the caller's relevant role — except the peer-owner pin.

| Write family | Caller's role for comparison |
|---|---|
| Org `member` | Org role (`getMemberRole`) |
| Property `property_member` | Effective role at that property (`getEffectiveRole` **after** §2.1a) |

**Symmetric org owner peer exception:** when the caller's **org** role is `owner`, they may **grant, demote, and remove** another user who is (or will be) an org `owner`, subject to last-owner (§2.3). Self-raise remains forbidden.  

**Accepted consequence:** any org owner can unilaterally remove any other org owner (last-owner still blocks removing the final one). Standard trade-off; no dedicated `transfer_ownership` command this slice.

**Property-scope roles:** writes may set **`admin` | `staff` only** — **never `owner`**, for **every** caller including org owners. Org ownership lives only on `member`.

Self-demotion / self-removal: legal under rank-below when the new state is below current (or remove), subject to last-owner on org table.

**`role_escalation` → HTTP `422` everywhere** (POST / PATCH / DELETE). The caller is authorized for the route (`staff:write` / `org:manage`) but requested an invalid transition. Not `403` — that would misrepresent what failed (gate already passed). Protected by membership HTTP tests, not by `check:forbidden-bodies` (see leftover #9).

**Coupling note (accepted):** rank checks use the target's **current** role / requested role, not a simulated post-image of the *caller's* effective role. Deleting your own property override can raise your effective role at that property; today anyone whose override left them at `staff` lacks `staff:write` and is gated out first. That safety rests on `ROLE_GRANTS` — record it; do not build a post-image rank check this slice.

### 2.3 Q3 — Last-owner → **DO invariant (org `member` only)**

Same transaction as org demote/remove of an owner: refuse if post-image owner count would be zero (`422 last_owner`). Self-demotion OK when another owner remains. `property_member` cannot strand the org.

### 2.4 Q4 — Add-by-email → **C**

POST body: `{ email, role }`. **Never** email in query string.

1. Auth + `requirePermission`.
2. Clerk Backend email → user lookup.
3. Zero users → **`422` `{ error: 'no_such_user' }`**.
4. Multiple → **`422` `{ error: 'email_ambiguous' }`** (defensive).
5. OrgDO write with rank + last-owner (+ cascade on delete paths).

Clerk lookup failure / timeout / 5xx → **`503` `{ error: 'clerk_unreachable', degraded: 'FAIL_CLOSED' }`** + `Retry-After`. Do not write. Distinct from `org_unreachable`.

PATCH/DELETE use `userId` in the path only.

**Accepted consequence:** POST distinguishes `no_such_user` / `already_member` / success — an **account-existence oracle** for anyone holding `staff:write` or `org:manage`. Blast radius limited to already-trusted actors; name it rather than discover it.

**Create vs update:**

| Method | Semantics |
|---|---|
| POST | Create only → `409 already_member` if row exists |
| PATCH | Role change only → not-found if absent |
| DELETE | Remove → not-found if absent; org DELETE cascades property overrides |

No idempotency keys this slice.

### 2.5 Q5 — HTTP omits `commandId` / `degradedRead`; reconcile catalog

**HTTP lock (unchanged outcome):** membership audit rows carry **no `commandId` and no `degradedRead`**. Routes target OrgDO and never call `invokePropertyDo`. Runtime behaviour: **FAIL_CLOSED / never queued**. OrgDO transport → `org_unreachable` (no `commandId`).

**Catalog disagreement (must not ship silent):** `COMMAND_CATALOG` already has unrouted:

| id | degraded today | events |
|---|---|---|
| `staff.add` | `FAIL_CLOSED` | `staff.changed` |
| `staff.update` | **`QUEUE_PROVISIONAL`** ← contradicts never-queue | `staff.changed` |
| `staff.delete` | `FAIL_CLOSED` | `staff.changed` |

**Lock this slice:**

1. Change `staff.update.degraded` to **`FAIL_CLOSED`** (pin in `register.test.ts`).
2. **Add `staff.update` to `ENTITLEMENT_FAIL_CLOSED_OPT_OUT`** — required by `check:entitlements` (every `FAIL_CLOSED` command needs an entitlement **or** an opt-out). Do **not** add `entitlement: 'pms.core'`; that would brick membership under the kill-switch and contradict §2.1. Verified: flipping degraded alone fails CI with `FAIL_CLOSED command missing entitlement … staff.update`; opt-out is the entire extra delta (`check:degraded` / `check:permissions` / contracts stay green).
3. **Restate the opt-out reason for all three** (`staff.add`, `staff.update`, `staff.delete`) together — the current *"Phase 1 — not yet gated at a DO boundary."* becomes false once this slice lands (mutations happen at OrgDO; they simply are not routed via those command ids). Use one shared reason, e.g. *"Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership."*
4. Keep the three catalog entries as domain vocabulary / `staff.changed` declaration — they remain **unrouted**. Do not delete them without a separate retirement slice.

### 2.6 Q6 — Audit leftover; outbox = `staff.changed`

PropertyDO `audit_log` leftover (cross-DO).

**Outbox:** every membership mutation (org and property) appends **`staff.changed`** — already in `event-consumer` allowlist and already declared on `staff.*` catalog events. **Do not** invent `org.member_*` / `property.member_*` types (they would throw in the consumer default branch).

Payload: `orgId`, `actorUserId`, `targetUserId`, `action: 'added'|'updated'|'removed'`, `role`, `previousRole?`, `propertyId: string | null` (`null` = org-scope), timestamps.

**Cascade event count (org DELETE):** emit **1 + N** `staff.changed` rows in the same transaction — one org-scope event (`action: 'removed'`, `propertyId: null`, `role` = former org role) **plus one property-scope event per cascaded override** (`action: 'removed'`, that `propertyId`, `role` = former override role). A single org-only event would hide which property access was revoked; N-only would hide the org-row removal. Non-cascade mutations (POST/PATCH, property DELETE, org demote without cascade) emit **exactly one** event.

---

## 3. HTTP & DO shapes

### 3.1 Org family

```
GET  /v1/orgs/:orgId/members
→ 200 { ok: true, members: [{ userId, role, createdAt, updatedAt }] }

POST /v1/orgs/:orgId/members
Body: { email: string, role: 'owner' | 'admin' | 'staff' }
→ 201 { ok: true, userId, role }
→ 422 no_such_user | email_ambiguous | invalid_body | role_escalation
→ 409 already_member
→ 503 clerk_unreachable | org_unreachable

PATCH /v1/orgs/:orgId/members/:userId
Body: { role: 'owner' | 'admin' | 'staff' }
→ 200 { ok: true, userId, role, previousRole }
→ 404 not_member (indistinguishable not_found shape as elsewhere if required)
→ 422 last_owner | role_escalation
→ 503 org_unreachable

DELETE /v1/orgs/:orgId/members/:userId
→ 200 { ok: true, userId }   // cascades property_member rows
→ 422 last_owner | role_escalation
→ 404 not_member
→ 503 org_unreachable
```

### 3.2 Property family

Roles on write: **`admin` | `staff` only** (universal — including owner callers).

```
GET    /v1/properties/:propertyId/members     # staff:read
POST   /v1/properties/:propertyId/members     # staff:write, { email, role: 'admin'|'staff' }
PATCH  /v1/properties/:propertyId/members/:userId
DELETE /v1/properties/:propertyId/members/:userId
```

Same status vocabulary; `role_escalation` is **422**; `owner` in body → `422` (invalid role / escalation). List returns override rows only. Effective role = §2.1a.

Property POST may create a **property-only** member (no org row) — that is the onboard path for admins.

### 3.3 OrgDO methods

```ts
// All: assertRpcAvailable(); actor kind user.

listOrgMembers(actor): …
  // HTTP gate is authoritative. DO returns typed not_member|forbidden for direct callers
  // (same structural fact as readPropertyMe). Do not claim HTTP tests cover the DO branch.

setOrgMember(actor, { targetUserId, role, mode: 'create'|'update' }): Result
removeOrgMember(actor, targetUserId): Result  // cascades property_member

listPropertyMembers(actor, propertyId): …
setPropertyMember(actor, propertyId, { targetUserId, role, mode }): Result  // admin|staff
removePropertyMember(actor, propertyId, targetUserId): Result
```

Internals: rank assert (incl. symmetric peer-owner), self-escalation reject, last-owner, cascade delete, append `staff.changed`.

`ensureMember` — bootstrap / tests only.

### 3.4 Migration `0005_member_audit_columns`

```sql
ALTER TABLE member ADD COLUMN updated_at INTEGER;
ALTER TABLE member ADD COLUMN updated_by TEXT;
ALTER TABLE property_member ADD COLUMN updated_at INTEGER;
ALTER TABLE property_member ADD COLUMN updated_by TEXT;
```

Backfill `updated_at = created_at`, `updated_by = NULL`. Writers set both on mutate.

**Required:** after editing `org-migrations.ts`, run **`pnpm generate:ddl`** (builds `do-runtime` then regenerates checked org DDL). `check:ddl` fails if skipped.

---

## 4. SPA / client-core

API-first. Typed client-core methods for both families.

On success, if mutation affects the current actor's grants: `invalidateQueries(['me', propertyId])` for the active property.

No staff UI this slice.

---

## 5. Audit index & pins

**Eight** new `V1_HTTP_ROUTE_AUDIT` ids (illustrative names — finalize in plan):

| # | id | scope | permission |
|---|---|---|---|
| 70 | `list_org_members` | org | `org:manage` |
| 71 | `create_org_member` | org | `org:manage` |
| 72 | `update_org_member` | org | `org:manage` |
| 73 | `delete_org_member` | org | `org:manage` |
| 74 | `list_property_members` | property | `staff:read` |
| 75 | `create_property_member` | property | `staff:write` |
| 76 | `update_property_member` | property | `staff:write` |
| 77 | `delete_property_member` | property | `staff:write` |

Each: **no** `entitlement`, **no** `commandId`, **no** `degradedRead`. Register pins + element-wise `V1_ROUTES` alignment (largest single append to date — plan with care).

Also pin: `COMMAND_CATALOG` `staff.update.degraded === 'FAIL_CLOSED'`; `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` contains `staff.add` / `staff.update` / `staff.delete` with the restated shared reason.

---

## 6. Test matrix (minimum)

| # | Case | Layer |
|---|---|---|
| 1 | Admin cannot call org member routes | HTTP |
| 2a | Admin can POST property `staff`; cannot POST `admin` or `owner` | HTTP + DO |
| 2b | **Owner** also cannot set `owner` on `property_member` | HTTP + DO |
| 3 | Owner can grant org peer `owner`; can demote/remove peer owner; cannot self-raise; last-owner blocks final remove | DO |
| 4 | Property-only member (no org row) has property access; **404 on every org-scope route** | HTTP |
| 5 | Org DELETE cascades `property_member` rows; re-add does not restore old overrides; outbox is **1+N** `staff.changed` | DO |
| 5b | `requireOrgMember` / `requirePropertyOrgMember` removed (no exports / no callers) | compile / grep |
| 6 | POST unknown email → `422 no_such_user`; Clerk down → `503 clerk_unreachable` | HTTP |
| 7 | Request with `?email=` **and** body email: query ignored, **body** value used (assert resolved user / DO args) | HTTP |
| 8 | OrgDO blocked → `org_unreachable`, no queue, no `commandId` | HTTP |
| 9 | Outbox emits `staff.changed` (not unknown types); consumer does not throw | DO / consumer |
| 10 | `staff.update` catalog pin `FAIL_CLOSED`; eight route rows lack entitlement/commandId/degradedRead | contracts |
| 11 | `role_escalation` responses are **422** (not 403) | HTTP |
| 12 | `ensureMember` still DO-nothing on conflict | DO |
| 13 | Self property demote invalidates `me` | client/web-pms |
| 14 | DDL: `check:ddl` green after `generate:ddl` | CI |

Direct-DO `not_member` on list/set helpers covered separately from HTTP gate (do not conflate).

---

## 7. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | PropertyDO / `get_audit_log` for membership | Cross-DO; `staff.changed` interim |
| 2 | Clerk Invitations + webhook | Invite-before-account |
| 3 | SPA staff management UI | |
| 4 | Idempotency keys on membership writes | |
| 5 | Org directory list for admins (`org:read`) | List stays `org:manage` |
| 6 | Sync invalidate `me` across all properties on org-role change | |
| 7 | Post-image rank check for caller after deleting own override | Coupled to `ROLE_GRANTS`; see §2.2 note |
| 8 | Fully retire unrouted `staff.*` catalog rows | Only if product wants zero unrouted staff commands; this slice restates degraded instead |
| 9 | `check:forbidden-bodies` two escape routes | (1) **Non-literal error** — skips bodies that do not literally contain `error: 'forbidden'` (`json({ error }, 403)` / computed vars). Mutation: `role_escalation`→403 left the check green. (2) **Helper-emitted 403s** — check walks only registered `handler:` function bodies; shared helpers (e.g. former bare `membershipErrorResponse` forbidden branch) are invisible even with a correct literal body. Live instance was the membership helper; body now carries `permission`, but the check still cannot see it. Third grep-family scope limit after `check:web-pms-me-gating` (`apps/web-pms/src` only) — consider a shared AST-based walker. |

---

## 8. Acceptance checklist

- [x] Eight routes; permissions §2.1; no entitlement / commandId / degradedRead
- [x] `getEffectiveRole` (b) + org-scope unchanged; property-only member org-route 404 canary
- [x] Org DELETE cascades `property_member`
- [x] Rank-below + symmetric owner peer ops + last-owner in DO transaction
- [x] Property writes never set `owner` (admin **and** owner callers)
- [x] Add-by-email; `422 no_such_user`; `503 clerk_unreachable`; email body-only (query ignored)
- [x] `role_escalation` is 422 everywhere
- [x] `staff.update` → `FAIL_CLOSED` + opt-out; shared restated reason for all three `staff.*` opt-outs; `check:entitlements` green
- [x] Outbox `staff.changed` only; org DELETE emits **1+N**
- [x] `requireOrgMember` / `requirePropertyOrgMember` deleted
- [x] Migration 0005 + `pnpm generate:ddl`; `check:ddl` green
- [x] Never queue; OrgDO transport → `org_unreachable`
- [x] `check:permissions` / `check:degraded` / `check:do-transport-guards` / `check:entitlements` / sharded pms-core

---

## 9. Open questions

None. Plan owns execution order (catalog+opt-out same task; `generate:ddl` own step; `getEffectiveRole` tests before dependents).
