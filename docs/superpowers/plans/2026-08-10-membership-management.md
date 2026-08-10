# Membership Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two HTTP membership families (org `member` + property `property_member`) with rank-below + symmetric owner peer ops, last-owner invariant, add-by-email, `getEffectiveRole` (b), org-DELETE cascade (1+N `staff.changed`), and catalog reconciliation without HTTP `commandId`.

**Architecture:** OrgDO is the sole write target. HTTP routes omit `commandId` / `degradedRead` / entitlement. Catalog `staff.update` becomes `FAIL_CLOSED` with opt-out in the **same** task. Property-only members become real via `getEffectiveRole` (b); org DELETE cascades overrides. Clerk email lookup is handler-side FAIL_CLOSED.

**Tech Stack:** Workers / OrgDO / Vitest / `@clerk/backend` / contracts catalog + opt-out / `pnpm generate:ddl`

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-10-membership-management-design.md` (rev 3)
- Append **eight** audit + `V1_ROUTES` rows at indices **70–77** (after `get_property_me` at 69); pins 19/43/44/61/62/65–69 unchanged
- **Never** set `entitlement` / `commandId` / `degradedRead` on membership HTTP rows
- `staff.update` → `FAIL_CLOSED` **and** `ENTITLEMENT_FAIL_CLOSED_OPT_OUT` in the **same commit/task** (`check:entitlements` red if either lands alone)
- Restate opt-out reason for `staff.add` / `staff.update` / `staff.delete` together
- `getEffectiveRole`: org scope (`propertyId === null`) **never** reads overrides; property scope uses override when org role null
- Org DELETE cascades all `property_member` for that user; demote does **not** cascade
- Org DELETE outbox: **1+N** `staff.changed` (one org-scope + one per cascaded override)
- Rank-below + symmetric org owner peer ops; property writes **`admin`|`staff` only** (even for owners)
- `role_escalation` → **422** everywhere (not 403)
- Email only in POST body; `422 no_such_user`; `503 clerk_unreachable`
- Delete `requireOrgMember` / `requirePropertyOrgMember` **and** orphaned `getOrg`/`getProperty` import from `auth.ts`
- Migration `0005` then **separate** `pnpm generate:ddl` step (do not assume DDL was regenerated)
- Never queue membership; OrgDO transport → `org_unreachable` (no `commandId`)
- Final sweep **sharded** pms-core; explicitly run `check:entitlements` and `check:ddl`

## Mutation canaries (tests must kill)

| Mutation | Must fail |
|---|---|
| Revert `getEffectiveRole` early-return when org role null | property-only member grants / matrix #4 |
| Org-scope (`propertyId === null`) consults overrides | org-route 404 canary for property-only member |
| Drop cascade on org DELETE | matrix #5 |
| Break peer-owner grant **or** demote/remove symmetry | matrix #3 (each direction) |
| `role_escalation` → 403 | matrix #11 |
| Allow `owner` on property_member write | matrix #2a **and** #2b |

## File map

| Path | Responsibility |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | `staff.update.degraded = FAIL_CLOSED` |
| `packages/contracts/src/entitlements.ts` | Opt-out for `staff.update`; restate all three `staff.*` reasons |
| `packages/contracts/src/register.test.ts` | Catalog + opt-out pins; route pins 70–77 |
| `packages/contracts/src/v1-http-routes.ts` | Eight audit rows |
| `packages/do-runtime/src/org-migrations.ts` | `0005_member_audit_columns` |
| Generated org DDL (via `pnpm generate:ddl`) | Snapshot for `check:ddl` |
| `apps/pms-core/src/org-do.ts` | `getEffectiveRole` (b); membership RPCs; cascade; outbox |
| `apps/pms-core/src/auth.ts` | Delete dead helpers + `./registry.js` import |
| `apps/pms-core/src/v1-dispatch.ts` | Eight handlers + `V1_ROUTES` |
| `apps/pms-core/src/clerk-users.ts` (or similar) | Email → userId lookup helper |
| `apps/pms-core/test/effective-role.spec.ts` | **First** — `getEffectiveRole` (b) alone |
| `apps/pms-core/test/membership-org.spec.ts` | DO + HTTP org family |
| `apps/pms-core/test/membership-property.spec.ts` | DO + HTTP property family |
| `packages/client-core/src/api.ts` | Typed membership clients |
| Spec status | Approved → plan path |

---

### Task 1: Catalog — `staff.update` FAIL_CLOSED + opt-out (same task)

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/entitlements.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `staff.update.degraded === 'FAIL_CLOSED'`; opt-out ids `{ staff.add, staff.update, staff.delete }` with shared reason string

- [ ] **Step 1: Failing pin**

```ts
expect(COMMAND_CATALOG.find((c) => c.id === 'staff.update')?.degraded).toBe('FAIL_CLOSED');
const STAFF_OPT_REASON =
  'Tenancy membership on OrgDO — HTTP routes omit commandId; not a feature-gated PMS command. Kill-switch must not brick staff/org membership.';
for (const id of ['staff.add', 'staff.update', 'staff.delete'] as const) {
  const row = ENTITLEMENT_FAIL_CLOSED_OPT_OUT.find((e) => e.id === id);
  expect(row?.reason).toBe(STAFF_OPT_REASON);
}
```

Run: `pnpm --filter @hospai/contracts test -- register` — FAIL on degraded and/or missing opt-out.

- [ ] **Step 2: Implement both halves in one edit**

In `catalog.ts`: `staff.update.degraded: 'FAIL_CLOSED'`.

In `entitlements.ts`: replace the two Phase-1 `staff.*` rows with three rows sharing `STAFF_OPT_REASON` (exact string above).

- [ ] **Step 3: Verify**

```bash
pnpm check:entitlements
pnpm check:degraded
pnpm --filter @hospai/contracts test -- register
```

Expected: all green. (Landing degraded without opt-out → `check:entitlements` red.)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(contracts): staff.update FAIL_CLOSED with entitlement opt-out

EOF
)"
```

---

### Task 2: `getEffectiveRole` (b) — own tests before dependents

**Files:**
- Modify: `apps/pms-core/src/org-do.ts` (`getEffectiveRole` only)
- Create: `apps/pms-core/test/effective-role.spec.ts`

**Interfaces:**
- Produces: property-only members get effective role; org scope unchanged

- [ ] **Step 1: Failing DO tests** (provision org+property; use existing `upsertPropertyMember` / `ensureMember` test helpers — not HTTP yet)

```ts
it('property-only member: override grants effective role when no org member row', async () => {
  // no ensureMember for target
  await org.upsertPropertyMember(targetId, propertyId, 'staff');
  expect(await org.getEffectiveRole(targetId, propertyId)).toBe('staff');
  expect(await org.getMemberRole(targetId)).toBeNull();
});

it('org scope (propertyId null) ignores property_member override', async () => {
  await org.upsertPropertyMember(targetId, propertyId, 'admin');
  // no org member
  expect(await org.getEffectiveRole(targetId, null)).toBeNull();
});

it('org member + override: override wins; without override org role', async () => {
  await org.ensureMember(targetId, 'staff');
  expect(await org.getEffectiveRole(targetId, propertyId)).toBe('staff');
  await org.upsertPropertyMember(targetId, propertyId, 'admin');
  expect(await org.getEffectiveRole(targetId, propertyId)).toBe('admin');
});
```

Run: `pnpm --filter @hospai/pms-core exec vitest run test/effective-role.spec.ts` — FAIL on property-only case.

- [ ] **Step 2: Implement**

```ts
async getEffectiveRole(userId: string, propertyId: string | null): Promise<OrgRole | null> {
  const orgRole = await this.getMemberRole(userId);
  if (!propertyId) return orgRole; // org scope — never consult overrides
  const row = this.ctx.storage.sql
    .exec(`SELECT role FROM property_member WHERE user_id = ? AND property_id = ?`, userId, propertyId)
    .toArray()[0] as { role: string } | undefined;
  if (orgRole) return (row?.role as OrgRole | undefined) ?? orgRole;
  return (row?.role as OrgRole | undefined) ?? null;
}
```

- [ ] **Step 3: Verify** effective-role tests green + quick smoke that existing auth/membership tests still pass on a shard if cheap.

- [ ] **Step 4: Commit** `fix(pms-core): property_member as independent effective-role grant`

---

### Task 3: Delete dead `requireOrgMember` / `requirePropertyOrgMember`

**Files:**
- Modify: `apps/pms-core/src/auth.ts` — delete both functions; remove `import { getOrg, getProperty } from './registry.js'` (orphaned — lint will flag)
- Grep: confirm zero callers / test imports

- [ ] **Step 1: Grep** `requireOrgMember|requirePropertyOrgMember` across repo — only `auth.ts` (+ historical docs OK).

- [ ] **Step 2: Delete** helpers + registry import in one edit.

- [ ] **Step 3: Run** `pnpm --filter @hospai/pms-core exec vitest run test/auth.spec.ts` + `pnpm lint` (or package typecheck) — green.

- [ ] **Step 4: Commit** `refactor(pms-core): remove obsolete org-row membership helpers`

---

### Task 4: Migration `0005` + regenerate DDL (separate steps)

**Files:**
- Modify: `packages/do-runtime/src/org-migrations.ts`
- Generated DDL paths updated **only** via `pnpm generate:ddl`

- [ ] **Step 1: Add migration** (version 5)

```ts
{
  version: 5,
  name: '0005_member_audit_columns',
  statements: [
    `ALTER TABLE member ADD COLUMN updated_at INTEGER`,
    `ALTER TABLE member ADD COLUMN updated_by TEXT`,
    `ALTER TABLE property_member ADD COLUMN updated_at INTEGER`,
    `ALTER TABLE property_member ADD COLUMN updated_by TEXT`,
    // backfill in a statement if SQLite allows, or document DO-side backfill on read
  ],
},
```

Prefer explicit backfill SQL if supported in this migration runner; otherwise writers treat null `updated_at` as `created_at` until first mutate. Keep `CHECK (role IN (...))` on `property_member` as-is (API forbids writing `owner`; do not ALTER CHECK this slice).

- [ ] **Step 2: Commit migration source only** (optional intermediate) **or** proceed to Step 3 before commit — either way Step 3 must not be skipped.

- [ ] **Step 3: Regenerate DDL (own step)**

```bash
pnpm generate:ddl
pnpm check:ddl
```

Expected: green. If `check:ddl` red, you forgot this step.

- [ ] **Step 4: Commit** migration + generated DDL together

```bash
git commit -m "$(cat <<'EOF'
feat(do-runtime): member updated_at/updated_by migration 0005

EOF
)"
```

---

### Task 5: OrgDO membership RPCs (rank, last-owner, cascade, outbox)

**Files:**
- Modify: `apps/pms-core/src/org-do.ts`
- Create: `apps/pms-core/test/membership-org-do.spec.ts` (and/or property DO section)

**Interfaces:**

```ts
type MembershipError =
  | 'not_member'
  | 'forbidden'
  | 'already_member'
  | 'role_escalation'
  | 'last_owner'
  | 'invalid_role';

// assertRpcAvailable first; actor.kind === 'user'
listOrgMembers(actor): { ok: true, members: ... } | { ok: false, error }
setOrgMember(actor, { targetUserId, role, mode: 'create'|'update' }): Result
removeOrgMember(actor, targetUserId): Result  // cascades property_member; 1+N staff.changed

listPropertyMembers(actor, propertyId): ...
setPropertyMember(actor, propertyId, { targetUserId, role, mode }): Result // role admin|staff only
removePropertyMember(actor, propertyId, targetUserId): Result
```

Defensive DO permission checks return typed errors for direct callers; HTTP gate is authoritative (do not claim HTTP covers DO `not_member`).

- [ ] **Step 1: Failing DO tests** (layer = **DO** — call OrgDO directly)

Matrix coverage:
- **#3 DO:** owner grants peer owner; demotes peer owner; removes peer owner; self-raise → `role_escalation`; last owner cannot remove self; second owner then self-remove OK
- **#5 DO:** org DELETE removes property_member rows; re-add does not restore overrides; outbox count **1+N** `staff.changed` with correct `propertyId` null vs set
- Peer-owner **grant-only** without demote/remove must leave a failing test if implementer forgets symmetry (assert demote + remove separately)
- Property DO: admin can create `staff` property-only member; admin cannot create `admin`/`owner`; **owner** cannot set property `owner` (**#2b**)
- `ensureMember` still DO-nothing on conflict (**#12**)

- [ ] **Step 2: Implement** rank helpers, writers setting `updated_at`/`updated_by`, outbox via existing append helper with `eventType: 'staff.changed'`, cascade delete SQL in `removeOrgMember` only.

- [ ] **Step 3: Run** targeted DO specs — green.

- [ ] **Step 4: Commit** `feat(pms-core): OrgDO membership writes with rank and cascade`

---

### Task 6: Eight HTTP routes + Clerk email lookup

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append rows 70–77
- Modify: `packages/contracts/src/register.test.ts` — eight pins + negative entitlement/commandId/degradedRead
- Modify: `apps/pms-core/src/v1-dispatch.ts` — eight handlers + `V1_ROUTES` (element-wise order matching audit)
- Create: `apps/pms-core/src/clerk-lookup.ts` — `lookupUserIdByEmail(env, email) → userId | 'no_such_user' | 'email_ambiguous' | 'clerk_unreachable'`
- Create: `apps/pms-core/test/membership-http.spec.ts`

**Audit rows (exact order):**

| Index | id | scope | permission |
|---|---|---|---|
| 70 | `list_org_members` | org | `org:manage` |
| 71 | `create_org_member` | org | `org:manage` |
| 72 | `update_org_member` | org | `org:manage` |
| 73 | `delete_org_member` | org | `org:manage` |
| 74 | `list_property_members` | property | `staff:read` |
| 75 | `create_property_member` | property | `staff:write` |
| 76 | `update_property_member` | property | `staff:write` |
| 77 | `delete_property_member` | property | `staff:write` |

Each: **no** `entitlement`, **no** `commandId`, **no** `degradedRead`.

Patterns:

```
GET    /^\/v1\/orgs\/([^/]+)\/members$/
POST   /^\/v1\/orgs\/([^/]+)\/members$/
PATCH  /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/
DELETE /^\/v1\/orgs\/([^/]+)\/members\/([^/]+)$/
GET    /^\/v1\/properties\/([^/]+)\/members$/
POST   /^\/v1\/properties\/([^/]+)\/members$/
PATCH  /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/
DELETE /^\/v1\/properties\/([^/]+)\/members\/([^/]+)$/
```

Map DO errors → HTTP: `role_escalation`/`last_owner`/`invalid_role` → **422**; `already_member` → **409**; `not_member` → **404**; OrgDO transport → **503** `org_unreachable` (reuse degraded helper; no `commandId`).

Clerk: inject/mock in tests; production uses `createClerkClient` from existing auth patterns.

- [ ] **Step 1: Failing pins + HTTP tests**

Layer labels:
- **#1 HTTP:** admin → org routes 404/403 per existing gate shape
- **#2a HTTP+DO:** admin property POST staff OK; admin/owner body rejected **422**
- **#2b HTTP:** owner property POST `owner` → **422**
- **#4 HTTP:** property-only member → property read OK (e.g. `property:read` route or `/me`); **404 on org-scope** (e.g. list org members or get org properties)
- **#6 HTTP:** unknown email → `422 no_such_user`; clerk failure → `503 clerk_unreachable`
- **#7 HTTP:** `?email=other@x` + body email → body wins (assert DO/Clerk called with body email)
- **#8 HTTP:** OrgDO blocked → `org_unreachable`, no `commandId`
- **#11 HTTP:** escalation responses status === 422
- Direct-DO `not_member` stays in Task 5 — **do not** claim HTTP covers it

- [ ] **Step 2: Implement** handlers + lookup + append routes **in audit order**.

- [ ] **Step 3: Verify**

```bash
pnpm check:permissions
pnpm check:degraded
pnpm check:do-transport-guards
pnpm --filter @hospai/contracts test -- register
pnpm --filter @hospai/pms-core exec vitest run test/membership-http.spec.ts test/membership-org-do.spec.ts test/effective-role.spec.ts
```

- [ ] **Step 4: Commit** `feat(pms-core): org and property membership HTTP families`

---

### Task 7: client-core typed clients + `me` invalidate hook

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Test: optional api path assert; web-pms only if a shared invalidate helper is added

**Interfaces:**

```ts
listOrgMembers(orgId)
createOrgMember(orgId, { email, role })
updateOrgMember(orgId, userId, { role })
deleteOrgMember(orgId, userId)
listPropertyMembers(propertyId)
createPropertyMember(propertyId, { email, role })
updatePropertyMember(propertyId, userId, { role })
deletePropertyMember(propertyId, userId)
```

Document: callers that mutate **self** should `invalidateQueries(['me', propertyId])` (SPA leftover UI; no staff screens this slice). If a tiny helper lands in web-pms, unit-test invalidate; otherwise note leftover #6 / acceptance via client-core only.

- [ ] **Step 1–3:** implement, `pnpm --filter @hospai/client-core build && test`, commit `feat(client-core): membership API methods`

---

### Task 8: Spec status + full acceptance sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-08-10-membership-management-design.md` — Status → Approved + plan path

- [ ] **Step 1: Mark spec Approved**

- [ ] **Step 2: Full sweep** (explicit checks — do not assume)

```bash
pnpm typecheck
pnpm lint
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
pnpm check:ddl
pnpm check:do-transport-guards
pnpm check:forbidden-bodies
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
for s in 1 2 3 4; do pnpm --filter @hospai/pms-core exec vitest run --shard=$s/4; done
```

- [ ] **Step 3: Commit** docs + any sweep fixes

---

## Spec coverage

| Spec item | Task |
|---|---|
| `staff.update` FAIL_CLOSED + opt-out same change | 1 |
| `getEffectiveRole` (b) + org-scope guard | 2 |
| Delete requireOrgMember/Property + registry import | 3 |
| Migration 0005 + `generate:ddl` | 4 |
| Rank / peer symmetry / last-owner / cascade / 1+N events | 5 |
| Eight routes, Clerk, HTTP matrix | 6 |
| client-core | 7 |
| Approved + entitlements/ddl in sweep | 8 |

**Type consistency:** DO error union ↔ HTTP 422/409/404/503; `staff.changed` payload shape shared; audit indices 70–77 match `V1_ROUTES` order.
