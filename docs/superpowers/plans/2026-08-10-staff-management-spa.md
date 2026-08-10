# Staff Management SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff SPA (`/staff`) plus server list enrichment / `hasOrgRole` / never-throw Clerk directory lookup / widened `already_member` — first real clients for membership and first E2E-live `staff:read` nav hide.

**Architecture:** Server first (DO RPC widen + Clerk reverse lookup + additive list/409 shapes + cache headers), then client-core types, then web-pms Staff screen. OrgDO membership stays SoR; Clerk directory is per-request and never merged into OrgDO failure paths.

**Tech Stack:** OrgDO / `clerk-lookup.ts` / `v1-dispatch.ts`; `@hospai/client-core`; web-pms React Query + Authority helpers; Vitest (+ Workers pool for pms-core).

## Global Constraints

- Reverse lookup **result union, never throws** (same contract as `lookupUserIdByEmail`)
- List enrichment: handler wraps lookup in its own `try`/`catch` → any throw becomes `directory: 'unavailable'` (not 500)
- List Clerk failure → **200 + `directory: 'unavailable'`** (not 500, not `org_unreachable`)
- Never persist email/name on member tables
- No new `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES` rows
- DO `already_member` **widens** with `role` — update exact-match DO pins deliberately (do not loosen to `toMatchObject`)
- `409 already_member` via dedicated `alreadyMemberResponse(userId, role)` — **do not** widen `membershipErrorResponse`
- Org section **disable with reason**, not hide
- Deep-link without `staff:read` → **route wrapper** redirect (not inside StaffScreen — avoids Clerk-backed list fetch before bounce)
- Self org-DELETE → harsh confirm → no-access shell
- Member list queries: behavioural no-refetch-on-focus (not `staleTime === 60000` literal assert)
- **Rebuild `@hospai/client-core` before web-pms runs** (`dist` resolution — mid-slice type edits otherwise test stale build)
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use shards or targeted `vitest run`
- Spec: `docs/superpowers/specs/2026-08-10-staff-management-spa-design.md`

### Mutation canaries (plan expects tests to kill)

| Mutation | Expected kill |
|---|---|
| Enrichment throw escapes handler wrap → 500 | #7 |
| List Clerk fail returns `org_unreachable` / omits rows | #1 |
| Directory ok + nulls treated as outage (no dangling path) | #3 |
| Drop `hasOrgRole` | #4 / Remove copy |
| Drop list `Cache-Control` | #5 |
| `409` without `userId`/`role` | #6 |
| DO `already_member` without `role` | DO pin |
| Org section absent for admin | #9 |
| Self org-DELETE no confirm / no no-access | #11 |
| `already_member` redirect by email match only | #12 |

---

## File map

| File | Responsibility |
|---|---|
| `apps/pms-core/src/org-do.ts` | `already_member` + `role`; `hasOrgRole` on property list |
| `apps/pms-core/src/clerk-lookup.ts` | `lookupDirectoryByUserIds` + test inject |
| `apps/pms-core/src/v1-dispatch.ts` | Enrich lists (handler try/catch → marker); cache headers; `alreadyMemberResponse`; leave `membershipErrorResponse` unchanged |
| `apps/pms-core/test/membership-org-do.spec.ts` | Exact DO pins for `already_member` + `role`; `hasOrgRole` |
| `apps/pms-core/test/membership-http.spec.ts` | List directory / dangling / cache / 409 / throw inject |
| `packages/client-core/src/api.ts` | List + create error types |
| `apps/web-pms/src/shell/nav.ts` | Staff nav entry |
| `apps/web-pms/src/App.tsx` | `/staff` route |
| `apps/web-pms/src/screens/StaffScreen.tsx` (+ test) | UI |
| `apps/web-pms/src/auth/me.ts` / tests | Optional helpers if needed for org-section disable |

---

### Task 1: DO — `already_member` + `role`; `hasOrgRole`

**Files:**
- Modify: `apps/pms-core/src/org-do.ts` — `setOrgMember` / `setPropertyMember` create conflict; `listPropertyMembers` rows
- Modify: `apps/pms-core/test/membership-org-do.spec.ts`

**Interfaces:**

```ts
{ ok: false, error: 'already_member', role: OrgRole }

// listPropertyMembers member row gains:
hasOrgRole: boolean
```

- [ ] **Step 1: Failing DO tests** — change exact pin:

```ts
expect(dup).toEqual({ ok: false, error: 'already_member', role: 'staff' });
```

Add property create duplicate with role; add `hasOrgRole` true (org member + override) / false (property-only).

- [ ] **Step 2: Run** — red (missing `role` / `hasOrgRole`).

- [ ] **Step 3: Implement** — on create conflict return existing role; in `listPropertyMembers` set `hasOrgRole` via EXISTS/getMemberRole (do **not** expose `orgRole`).

- [ ] **Step 4: Run** DO specs green. Keep **exact** `toEqual` (not `toMatchObject`).

- [ ] **Step 5: Commit** `feat(pms-core): already_member includes role; property hasOrgRole`

---

### Task 2: Clerk directory lookup (never throws) + list HTTP

**Files:**
- Modify: `apps/pms-core/src/clerk-lookup.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — list handlers only for enrichment; create handlers call `alreadyMemberResponse`; **do not** change `membershipErrorResponse`
- Modify: `apps/pms-core/test/membership-http.spec.ts`
- Reuse: `ME_HEADERS` / shared `private, no-store` constant for lists

**Interfaces:**

```ts
type DirectoryLookupResult =
  | { ok: true; byUserId: Map<string, { displayName: string | null; email: string | null }> }
  | { ok: false; error: 'clerk_unreachable' };

lookupDirectoryByUserIds(env, userIds: string[]): Promise<DirectoryLookupResult>
// production: never throws (result union); inject via __setLookupDirectoryByUserIdsForTest (before configured check)

function alreadyMemberResponse(userId: string, role: OrgRole): Response
// → 409 { error: 'already_member', userId, role }
// Called only from create_org_member / create_property_member
```

List JSON per spec §3.1–3.2. Handler order (locked #7):

```ts
const result = await org.list…(…);
if (!result.ok) return membershipErrorResponse(…); // unchanged helper — no identity args
let directory: 'unavailable' | undefined;
let byUserId = new Map(…);
try {
  const dir = await lookupDirectoryByUserIds(env, ids);
  if (!dir.ok) directory = 'unavailable';
  else byUserId = dir.byUserId;
} catch {
  directory = 'unavailable'; // violated never-throw contract → degrade, not 500
}
return json({ ok: true, members: merged, ...(directory ? { directory } : {}) }, 200, LIST_HEADERS);
```

Create handlers on DO `already_member`:

```ts
if (!result.ok) {
  if (result.error === 'already_member') {
    return alreadyMemberResponse(looked.userId, result.role);
  }
  return membershipErrorResponse(result.error, 'org:manage' | 'staff:write');
}
```

- [ ] **Step 1: Failing HTTP tests** — matrix #1, #2 (inject ok), #3 dangling, #5 Cache-Control, #6 409 via `alreadyMemberResponse`, **#7: inject seam plants a throw; assert 200 + `directory: 'unavailable'`, not 500** (handler wrap — production lookup still never throws).

- [ ] **Step 2: Implement** lookup + list handler wrap + `alreadyMemberResponse` + headers. Leave `membershipErrorResponse` signature/body untouched.

- [ ] **Step 3: Verify**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/membership-http.spec.ts test/membership-org-do.spec.ts
pnpm check:do-transport-guards
pnpm check:ddl
```

- [ ] **Step 4: Commit** `feat(pms-core): enrich member lists with Clerk directory`

---

### Task 3: client-core types

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Modify: `packages/client-core/test/api.test.ts` (optional path assert)

- [ ] **Step 1–2:** Extend `listOrgMembers` / `listPropertyMembers` return types (`displayName`, `email`, `directory?`, `hasOrgRole`). Document 409 body shape in create methods’ thrown/`ClassifiedError` consumers if typed.

- [ ] **Step 3:** `pnpm --filter @hospai/client-core build && test`

- [ ] **Step 4: Commit** `feat(client-core): member list directory fields`

---

### Task 4: Staff nav + route shell

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/App.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts` (Staff entry hide with fabricated me / staff role)
- Create: `apps/web-pms/src/screens/StaffRoute.tsx` (or equivalent) — permission gate **before** StaffScreen
- Create stub: `apps/web-pms/src/screens/StaffScreen.tsx` (minimal placeholder ok)

- [ ] **Step 1:** Add `{ id: 'staff', label: 'Staff', path: '/staff', permission: 'staff:read' }`; route under `AppShell`.

- [ ] **Step 2:** Unit-test filter hides Staff when fabricated live me lacks `staff:read`; real staff role lacks it.

- [ ] **Step 3:** Deep-link without `staff:read` → redirect in a **route wrapper** that does **not** mount `StaffScreen` (no member-list queries / no Clerk read). Reason: same external-dependency argument as spec §2.7. Do **not** redirect from inside `StaffScreen`.

- [ ] **Step 4: Commit** `feat(web-pms): Staff nav gated on staff:read`

---

### Task 5: StaffScreen — lists, sections, mutations, copy

**Files:**
- Create/Modify: `apps/web-pms/src/screens/StaffScreen.tsx`
- Create: `apps/web-pms/src/screens/StaffScreen.test.tsx`

**Behaviour (spec §§2.1–2.7, 4):**

- Property section + Org section subtitles
- Org disabled reason when `!hasOrgPermission(me, 'org:manage')`
- Queries: `staleTime: 60_000`, `refetchOnWindowFocus: false`; test #15 = focus → no second fetch
- Directory unavailable banner; dangling row flag + Remove
- Add-by-email copy matrix; `already_member` focus by body `userId`
- Confirms: org DELETE cascade; self-demote; **self org-DELETE** harsh → assert no-access
- Self-mutation success → `invalidateQueries(['me', propertyId])` + members lists
- Role selects: org three roles; property admin|staff only

- [ ] **Step 1: Failing SPA tests** for #8–12, #15 (and #11 self-remove).

- [ ] **Step 2: Implement** screen.

- [ ] **Step 3:** `pnpm --filter @hospai/client-core build` (if Task 3 dist may be stale) && `pnpm --filter web-pms test`

- [ ] **Step 4: Commit** `feat(web-pms): Staff management screen`

---

### Task 6: Spec checklist + sweep

**Files:**
- Modify: design spec §8 checkboxes → `[x]`

```bash
pnpm typecheck
pnpm lint
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
pnpm check:ddl
pnpm check:do-transport-guards
pnpm check:forbidden-bodies
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/client-core test
pnpm --filter web-pms test
for s in 1 2 3 4; do pnpm --filter @hospai/pms-core exec vitest run --shard=$s/4; done
```

- [ ] **Step 1–2:** Sweep green; commit `docs: staff SPA accepted`

---

## Spec coverage

| Spec item | Task |
|---|---|
| DO `already_member` + `role` (exact pin) | 1 |
| `hasOrgRole` | 1 |
| Never-throw directory + inject + list enrich | 2 |
| `directory` vs dangling | 2 |
| List cache headers; 409 body | 2 |
| client-core | 3 |
| Nav hide `staff:read` | 4 |
| Staff screen / confirms / oracle / invalidate / no-access | 5 |
| Query freshness behavioural | 5 |
| Approved checklist + sweep | 6 |

**Type consistency:** DO `{ already_member, role }` ↔ HTTP 409 `{ error, userId, role }`; list enrichment fields shared client-core ↔ SPA.
