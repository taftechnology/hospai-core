# Front-Desk Operational Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship PropertyDO front-desk list reads, OrgDO guest batch compose, org entitlement snapshot, current-shift singleton, and honest provisional-exception-count rename — without a reservation projection.

**Architecture:** Non-colliding `/front-desk/*` GET routes append at the end of the route audit (no insert before pinned indices). Lists return refs only; names come from `POST …/guests/batch` → one OrgDO `readGuests` RPC with per-ref outcomes. Entitlements are org-scoped via `loadSnapshot`. Pagination cursors are full sort tuples. v18 adds two additive indexes.

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, existing `gatePermission` / `V1_HTTP_ROUTE_AUDIT` / `property-ddl.mjs` / `assertUnsafeLocal` test-helper patterns.

**Spec:** [`docs/superpowers/specs/2026-08-07-front-desk-operational-reads-design.md`](../specs/2026-08-07-front-desk-operational-reads-design.md)

## Global Constraints

- **Append only** for new audit rows — never insert before `get_reservation` / other pins. Paths are `/front-desk/*` so they cannot collide with `…/reservations/:id` or `…/shifts/:id`.
- **In-place rename** `get_degraded_status` (index **19**) → `get_provisional_exception_count`; path `…/provisional-exception-count`. Do not append a duplicate.
- **New audit rows** start at index **62** (after `get_audit_log` at 61), identical order on `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`.
- **No `piiKeyId` on list items.** Batch keys on `guestRef`.
- **Cursor = full sort tuple** with row-comparison resume (arrivals = id only; departures = status+id; in-house = departureDate+id).
- **Batch is POST body**, max 50 refs after dedupe; `degradedRead: 'FAIL_CLOSED'` still applies (no queue).
- **Org entitlements:** `scope: 'org'`, `org:read`, **no** `degradedRead`; kill-switch not in body.
- **Current shift:** 200 `{ shift: null }` when none; never return expected cash / variance.
- **Test 9 harness:** OrgDO `resetGuestReadRpcCountForTest` / `getGuestReadRpcCountForTest` — increment on entry to `readGuest` and `readGuests`.
- **Migration head v18**; touch `scripts/property-ddl.mjs`.
- **TDD** where noted; commit after each task.
- **Pins 43/44** (`patch_property_details` / `put_domain_config`) and all later existing pins must remain at the same indices.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Insert list routes before `get_reservation` | `register.test.ts` pins 43/44 (and later) shift |
| Cursor = `reservation_id` only on in-house | Test 7 (duplicates on page 2) |
| Include `piiKeyId` on list item | Test 19 |
| Batch via `GET ?refs=` | Route audit / handler tests expect POST body |
| Fan-out `readGuest` × N instead of `readGuests` | Test 9 (`getGuestReadRpcCountForTest() === 1`) |
| Return expected cash on front-desk shift | Test 18 |
| Omit `FRONT_DESK_READS_V18_SQL` from `property-ddl.mjs` | `check:ddl` |
| Append audit without matching `V1_ROUTES` | `check:permissions` |
| Put `degradedRead` on org entitlements | Test 21 / typecheck |
| Join OrgDO inside list handler | Test 13 (OrgDO down, arrivals still 200) |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/v1-http-routes.ts` | Rename index 19; append 62–67 |
| `packages/contracts/src/register.test.ts` | Pins for rename + new rows; assert 43/44 unchanged |
| `packages/do-runtime/src/property-migrations.ts` | v18 index statements + SQL export |
| `packages/do-runtime/src/index.ts` | Re-export SQL if needed |
| `packages/do-runtime/src/migrate.test.ts` | Head 18 + SQL sync |
| `migrations/do-property/0018_front_desk_reads.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | Declare/destructure/target for v18 |
| `apps/pms-core/src/property-do.ts` | `listArrivals` / `listDepartures` / `listInHouse` / `readCurrentOpenShift` |
| `apps/pms-core/src/org-do.ts` | `readGuests` + RPC counter harness |
| `apps/pms-core/src/v1-dispatch.ts` | Handlers + `V1_ROUTES`; rename degraded path |
| `apps/pms-core/test/front-desk-reads.spec.ts` | **Create** — matrix §6 |
| `apps/pms-core/test/degraded-mode.spec.ts` | Path rename for exception count if referenced |
| `apps/pms-core/test/property-do.spec.ts` | Schema head 18 if asserted |

**Locked audit append order (indices 62–67):**

```
62 get_front_desk_arrivals
63 get_front_desk_departures
64 get_front_desk_in_house
65 post_guests_batch
66 get_org_entitlements          // scope: 'org'
67 get_front_desk_shift
```

---

### Task 1: Contracts — rename + append route audit

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: audit ids above; index 19 renamed

- [ ] **Step 1: Failing register tests (RED)**

```ts
// register.test.ts
expect(V1_HTTP_ROUTE_AUDIT[19]?.id).toBe('get_provisional_exception_count');
expect(V1_HTTP_ROUTE_AUDIT[19]).toMatchObject({
  scope: 'property',
  permission: 'property:read',
});
expect('degradedRead' in (V1_HTTP_ROUTE_AUDIT[19] ?? {})).toBe(false);

// Pins must not move
expect(V1_HTTP_ROUTE_AUDIT[43]?.id).toBe('patch_property_details');
expect(V1_HTTP_ROUTE_AUDIT[44]?.id).toBe('put_domain_config');
expect(V1_HTTP_ROUTE_AUDIT[61]?.id).toBe('get_audit_log');

expect(V1_HTTP_ROUTE_AUDIT[62]?.id).toBe('get_front_desk_arrivals');
expect(V1_HTTP_ROUTE_AUDIT[62]).toMatchObject({
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[62] ?? {})).toBe(false);

expect(V1_HTTP_ROUTE_AUDIT[63]?.id).toBe('get_front_desk_departures');
expect(V1_HTTP_ROUTE_AUDIT[64]?.id).toBe('get_front_desk_in_house');
expect(V1_HTTP_ROUTE_AUDIT[65]?.id).toBe('post_guests_batch');
expect(V1_HTTP_ROUTE_AUDIT[65]).toMatchObject({
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect(V1_HTTP_ROUTE_AUDIT[66]?.id).toBe('get_org_entitlements');
expect(V1_HTTP_ROUTE_AUDIT[66]).toMatchObject({
  scope: 'org',
  permission: 'org:read',
});
expect('degradedRead' in (V1_HTTP_ROUTE_AUDIT[66] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[67]?.id).toBe('get_front_desk_shift');
expect(V1_HTTP_ROUTE_AUDIT[67]).toMatchObject({
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
```

Run: `pnpm --filter @hospai/contracts test -- register.test.ts`  
Expected: FAIL — ids/rows missing.

- [ ] **Step 2: Implement audit rows**

In `v1-http-routes.ts`:
1. Change `{ id: 'get_degraded_status', … }` → `{ id: 'get_provisional_exception_count', … }` (same fields).
2. Append after `get_audit_log`:

```ts
{
  id: 'get_front_desk_arrivals',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_front_desk_departures',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_front_desk_in_house',
  scope: 'property',
  permission: 'reservations:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'post_guests_batch',
  scope: 'property',
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{ id: 'get_org_entitlements', scope: 'org', permission: 'org:read' },
{
  id: 'get_front_desk_shift',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

- [ ] **Step 3: Run tests (GREEN)**

Run: `pnpm --filter @hospai/contracts test -- register.test.ts`  
Expected: PASS. Also run `pnpm check:permissions` / `pnpm check:degraded` once `V1_ROUTES` catch up in Task 4+ — until then permissions check may fail on length mismatch; that is expected until handlers land. Prefer completing Task 4 route stubs in the same commit wave if CI runs checks on every commit.

- [ ] **Step 4: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): front-desk read route audit + exception-count rename

EOF
)"
```

---

### Task 2: Migration v18 — departure + in-house indexes

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts` (re-export if peers export `*_SQL`)
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `migrations/do-property/0018_front_desk_reads.sql` (via generator)

**Interfaces:**
- Produces: `FRONT_DESK_READS_V18_STATEMENTS`, `FRONT_DESK_READS_V18_SQL`, `PROPERTY_MIGRATIONS` version 18

- [ ] **Step 1: Failing migrate test (RED)**

```ts
expect(PROPERTY_MIGRATIONS.at(-1)?.version).toBe(18);
expect(PROPERTY_MIGRATIONS.at(-1)?.name).toBe('front_desk_reads');
// sync test against migrations/do-property/0018_front_desk_reads.sql body
```

- [ ] **Step 2: Implement statements**

```ts
export const FRONT_DESK_READS_V18_STATEMENTS: string[] = [
  `CREATE INDEX reservation_departure_idx ON reservation (departure_date)`,
  `CREATE INDEX reservation_in_house_idx
  ON reservation (departure_date) WHERE status = 'checked_in'`,
];

export const FRONT_DESK_READS_V18_SQL =
  FRONT_DESK_READS_V18_STATEMENTS.join(';\n\n') + ';\n';

// PROPERTY_MIGRATIONS push:
{
  version: 18,
  name: 'front_desk_reads',
  statements: FRONT_DESK_READS_V18_STATEMENTS,
},
```

Wire `property-ddl.mjs` like v17: `let FRONT_DESK_READS_V18_SQL`, destructure from import, add target `0018_front_desk_reads.sql` with header noting additive indexes only.

- [ ] **Step 3: Generate + sync**

Run: `pnpm generate:ddl` (or `node scripts/property-ddl.mjs --write`) then `pnpm check:ddl`  
Expected: file written; check green.

- [ ] **Step 4: migrate.test GREEN + commit**

```bash
pnpm --filter @hospai/do-runtime test -- migrate.test.ts
git add packages/do-runtime migrations/do-property/0018_front_desk_reads.sql scripts/property-ddl.mjs
git commit -m "$(cat <<'EOF'
feat(do-runtime): v18 front-desk reservation list indexes

EOF
)"
```

---

### Task 3: PropertyDO — list methods + current shift

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Test: `apps/pms-core/test/front-desk-reads.spec.ts` (create; DO-level cases first)

**Interfaces:**
- Produces:
  - `listArrivals(date, opts): { ok: true; items; nextCursor }`
  - `listDepartures(date, opts)` / `listInHouse(opts)` same shape
  - `readCurrentOpenShift(actor): { ok: true; shift: ShiftCurrent | null }`
- Cursor types:

```ts
type ArrivalsCursor = { reservationId: string };
type DeparturesCursor = { status: string; reservationId: string };
type InHouseCursor = { departureDate: string; reservationId: string };

type FrontDeskListItem = {
  reservationId: string;
  roomTypeId: string;
  guestRef: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  roomId: string | null;
};
```

- [ ] **Step 1: Failing DO tests (RED)** — overstay, status filters, tuple cursor no-dupes, shift null / open without expected cash

Use existing guest+reservation fixtures from `guest-helpers.ts` / reservations specs. For cursor test 7: seed ≥3 in-house rows with mixed `departure_date` (including overstays), `limit=2`, assert page2 ids ∩ page1 ids = ∅.

- [ ] **Step 2: Implement SQL**

Shared map from row → `FrontDeskListItem` (**omit `pii_key_id`**).

Arrivals:

```sql
SELECT reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id
FROM reservation
WHERE arrival_date = ? AND status = 'confirmed'
  AND (? IS NULL OR reservation_id > ?)
ORDER BY reservation_id ASC
LIMIT ?
```

Departures resume:

```sql
WHERE departure_date = ?
  AND (
    ? IS NULL
    OR status > ?
    OR (status = ? AND reservation_id > ?)
  )
ORDER BY status ASC, reservation_id ASC
LIMIT ?
```

In-house resume:

```sql
WHERE status = 'checked_in'
  AND (
    ? IS NULL
    OR departure_date > ?
    OR (departure_date = ? AND reservation_id > ?)
  )
ORDER BY departure_date ASC, reservation_id ASC
LIMIT ?
```

Clamp `limit` to `[1, 50]` (default 50). Encode `nextCursor` as base64url(JSON) when `items.length === limit`; else `null`.

`readCurrentOpenShift`:

```sql
SELECT … FROM shift WHERE cashier_user_id = ? AND status = 'OPEN'
```

`attributedCashCount`:

```sql
SELECT COUNT(*) AS n FROM payment
WHERE shift_id = ? AND tender_type = 'CASH' AND status = 'captured'
```

Do **not** call `computeShiftExpectedCashSync`. Return `{ ok: true, shift: null }` when no row.

- [ ] **Step 3: GREEN + commit**

```bash
pnpm --filter pms-core test -- front-desk-reads.spec.ts
git add apps/pms-core/src/property-do.ts apps/pms-core/test/front-desk-reads.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): PropertyDO front-desk list queries and current shift

EOF
)"
```

---

### Task 4: HTTP — front-desk lists, shift, exception-count rename

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/test/front-desk-reads.spec.ts`
- Modify: any test referencing `degraded-status` (grep)

**Interfaces:**
- Consumes: PropertyDO methods from Task 3
- Produces: handlers wired in `V1_ROUTES` indices matching audit 62–64, 67; rename route for index 19

- [ ] **Step 1: Rename degraded-status route**

```ts
// pattern
/^\/v1\/properties\/([^/]+)\/provisional-exception-count$/
// audit alignment: id get_provisional_exception_count
```

Update handler name if desired; body stays `{ propertyId, exceptionCount }`.

- [ ] **Step 2: Add list + shift handlers**

Patterns:

```ts
/^\/v1\/properties\/([^/]+)\/front-desk\/arrivals$/
/^\/v1\/properties\/([^/]+)\/front-desk\/departures$/
/^\/v1\/properties\/([^/]+)\/front-desk\/in-house$/
/^\/v1\/properties\/([^/]+)\/front-desk\/shift$/
```

Parse `date` (required for arrivals/departures), `limit`, `cursor`. On transport failure → `degradedFailClosedReadResponse()`. Decode cursor; invalid → 400 `invalid_cursor`.

Append `V1_ROUTES` entries in the **same order as audit 62–67** (batch + entitlements stubs may 501 temporarily only if you split commits — prefer Task 5/6 same day so `check:permissions` stays green). Minimal stub for 65/66 until next tasks:

Prefer landing Task 5+6 handlers before pushing checks. If splitting: add all six `V1_ROUTES` with real handlers for lists/shift and temporary handlers that return 501 for batch/entitlements **only if** audit length matches — better to implement Tasks 4–6 before relying on CI.

- [ ] **Step 3: HTTP tests 1–8, 17–20**

Including: old `…/degraded-status` → 404; new path 200; list items have no `piiKeyId`; PropertyDO blocked → 503 `FAIL_CLOSED`.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test
git commit -m "$(cat <<'EOF'
feat(pms-core): front-desk list/shift HTTP routes and exception-count path

EOF
)"
```

---

### Task 5: OrgDO — `readGuests` + RPC counter harness

**Files:**
- Modify: `apps/pms-core/src/org-do.ts`

**Interfaces:**
- Produces:

```ts
async readGuests(
  actor: ActorContext,
  propertyId: string,
  guestIds: string[],
): Promise<
  | { ok: true; guests: Record<string, GuestBatchEntry> }
  | { ok: false; error: typeof FORBIDDEN | 'not_member' | 'scope_mismatch' | typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE | string }
>

async resetGuestReadRpcCountForTest(): Promise<void>
async getGuestReadRpcCountForTest(): Promise<number>
```

- [ ] **Step 1: Counter field + helpers**

```ts
private guestReadRpcCountForTest = 0;

async resetGuestReadRpcCountForTest(): Promise<void> {
  this.assertUnsafeLocal('resetGuestReadRpcCountForTest');
  this.guestReadRpcCountForTest = 0;
}
async getGuestReadRpcCountForTest(): Promise<number> {
  this.assertUnsafeLocal('getGuestReadRpcCountForTest');
  return this.guestReadRpcCountForTest;
}
```

At the top of `readGuest` and `readGuests`: `this.guestReadRpcCountForTest += 1`.

- [ ] **Step 2: Implement `readGuests`**

Mirror `readGuest` gates once (`gatePermission` `guests:read`, `gateCoreEntitlement`). Dedupe ids. For each id: same SQL/erased/decrypt path as `readGuest`, but catch decrypt failures per-ref → `{ ok: false, guestId, error: 'decrypt_unresolved' }` (do not throw). Missing → `guest_not_found`. Build `Record` keyed by guestId.

Do **not** call `readGuest` in a loop (that would inflate the counter and defeat Test 9 — share a private `readGuestEntrySync`/`async` helper both methods use, and increment the counter only on the public RPC entrypoints).

- [ ] **Step 3: Unit-level OrgDO test (optional in front-desk-reads.spec) + commit**

```bash
git add apps/pms-core/src/org-do.ts apps/pms-core/test/front-desk-reads.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): OrgDO readGuests batch with per-ref outcomes

EOF
)"
```

---

### Task 6: HTTP — `POST …/guests/batch` + org entitlements

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `apps/pms-core/test/front-desk-reads.spec.ts`

- [ ] **Step 1: `handlePostGuestsBatch`**

```ts
pattern: /^\/v1\/properties\/([^/]+)\/guests\/batch$/
method: 'POST'
permission: 'guests:read'
entitlement: 'pms.core'
```

Body `{ refs: string[] }`. Validate array; empty → 400 `refs_required`; after dedupe length > 50 → 400 `refs_limit_exceeded`. Resolve property → OrgDO: `ensureMetaOrgId` once, `readGuests` once. On OrgDO transport failure → `degradedFailClosedReadResponse()` (use `isOrgDoTransportFailure` if that is what guest GET uses after correction — match `handleGetGuest`'s real failure path; prefer OrgDO transport helper). Decrypt incidents already per-ref inside DO — HTTP always 200 on `ok: true`.

- [ ] **Step 2: `handleGetOrgEntitlements`**

```ts
pattern: /^\/v1\/orgs\/([^/]+)\/entitlements$/
scope: 'org'
permission: 'org:read'
// no entitlement field on audit — snapshot is how clients learn features
```

```ts
async function handleGetOrgEntitlements(ctx: V1DispatchContext): Promise<Response> {
  const orgId = decodeURIComponent(ctx.match[1]!);
  ctx.observability.orgId = orgId;
  try {
    const snap = await loadSnapshot(ctx.env, orgId);
    return json(snap, 200);
  } catch (e) {
    if (e instanceof EntitlementResolutionError) {
      return json({ error: 'entitlement_unavailable' }, 503);
    }
    throw e;
  }
}
```

Membership already enforced by `requirePermission(…, 'org:read')` in `dispatchV1`.

- [ ] **Step 3: Tests 9–16**

Test 9 (load-bearing):

```ts
await org.resetGuestReadRpcCountForTest();
const res = await POST_batch(thirtyLiveRefs);
expect(res.status).toBe(200);
expect(await org.getGuestReadRpcCountForTest()).toBe(1);
```

Test 13: `org.setTransportBlockedForTest(true)` → batch 503; arrivals GET still 200.

Test 15: set kill KV → entitlements GET still 200; a `pms.core`-gated write 503.

- [ ] **Step 4: `check:permissions` + `check:degraded` GREEN**

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/front-desk-reads.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): guests batch and org entitlement snapshot routes

EOF
)"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full relevant suite**

```bash
pnpm --filter @hospai/contracts test -- register.test.ts
pnpm --filter @hospai/do-runtime test -- migrate.test.ts
pnpm --filter pms-core test -- front-desk-reads.spec.ts
pnpm check:permissions
pnpm check:degraded
pnpm check:ddl
```

Expected: all green. Confirm `V1_HTTP_ROUTE_AUDIT[43/44/61]` still pinned; length 68.

- [ ] **Step 2: Commit only if fixes landed; otherwise done**

If verification-only, no commit.

---

## Self-review (plan vs spec)

| Spec § | Task |
|---|---|
| §2.1 / §3.3 batch + harness | 5, 6 |
| §2.2 no projection / FAIL_CLOSED | 1, 4 |
| §2.3 / §4 indexes + filters | 2, 3 |
| §2.4 / §3.4 entitlements | 1, 6 |
| §2.5 / §3.5 shift | 3, 4 |
| §2.6 / §2.7 paths + rename | 1, 4 |
| §2.8 POST body | 6 |
| §2.9 no list piiKeyId | 3, 4 (test 19) |
| §3.2 tuple cursors | 3 (test 7) |
| §6 matrix | 3–6 |
| §9 client contracts | documented in spec only — out of code scope |
