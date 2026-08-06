# Guests / PII Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route OrgDO guest CRUD + read over property-scoped HTTP, close dangling `piiKeyId` on book by looking up the key inside `tryCreateReservation`, and define erased-guest tombstone reads.

**Architecture:** Guest records stay on OrgDO; routes are `scope: 'property'` so `guests:*` permission checks get a `propertyId`. Create/update reclassify to `FAIL_CLOSED` (OrgDO is already on the pre-handler gate). Booking drops client `piiKeyId`; `gateGuestRef` → `assertGuestRef` returns the authoritative key before `runIdempotent`. OrgDO keeps `readIdempotentReplay` before vault prep.

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, existing `gatePermission` / `runIdempotent` / `V1_HTTP_ROUTE_AUDIT` / `requirePermission` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-06-guests-pii-vertical-design.md`](../specs/2026-08-06-guests-pii-vertical-design.md) (v2)

## Global Constraints

- **No `invokeOrgDo`.** Guest handlers call OrgDO directly; transport failure → `503` + `Retry-After` (`FAIL_CLOSED`). No `REPLAY_DISPATCH` entries.
- **Create/update catalog `notes` must be identical** — guarded by `register.test.ts` (`expect(create?.notes).toBe(update?.notes)`).
- **Route audit indices 39–42** in order `post_guests`, `patch_guest`, `post_guest_erase`, `get_guest`. `V1_ROUTES` appends in the **same order** same commit (`check:permissions` is element-wise by index).
- **`gateGuestRef` on create only** — never on modify/cancel/status. M2 locks this.
- **No guest-validation cache.** Residual TOCTOU accepted.
- **Branch tombstones on `erased_at`**, never on caught decrypt failure. M4 locks this.
- **Fingerprint drop of `piiKeyId` is an accepted deploy-day 409** for cross-deploy retries (spec §2.2b) — do not version fingerprints.
- **TDD:** write M3/M4/test 11–13 so the mutations in the table below fail.
- Fixture migration + CI shard check land in the **same PR**; bump to 4 shards only if measured.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Drop `gateGuestRef` | Tests 11 / 12 in `guests-routes.spec.ts` |
| Apply `gateGuestRef` to `tryModifyReservation` | M2 in `reservations.spec.ts` |
| Vault prep before `readIdempotentReplay` | M3 in `guests.spec.ts` (`COUNT(data_key)` stays 1 on replay) |
| Catch decrypt → tombstone | M4 (`testShredGuestKey` then GET → 5xx, not tombstone) |
| Silent overwrite of client `piiKeyId` | Test 13 (wrong key in body → stored value is looked-up) |
| Divergent create/update `notes` | `register.test.ts` equality |

### Shared catalog notes string (copy verbatim onto both entries)

```ts
const GUESTS_FAIL_CLOSED_NOTES =
  'FAIL_CLOSED because OrgDO is on the pre-handler permission gate path ' +
  '(requirePermission → assertPermission), not because guest writes are ' +
  'unimportant. Revisit when the §4.3 KV permission projection lets ' +
  'property-scoped requests survive an OrgDO blip — then an org ' +
  'provisional plane becomes meaningful. Also read-your-write: client ' +
  'needs a materialised guest before booking.';
```

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | `GUEST_EXISTS` |
| `packages/contracts/src/idempotency.test.ts` | String lock |
| `packages/contracts/src/commands/catalog.ts` | create/update → `FAIL_CLOSED` + identical `notes` |
| `packages/contracts/src/register.test.ts` | FAIL_CLOSED + notes equality |
| `packages/contracts/src/v1-http-routes.ts` | Audit rows 39–42 |
| `apps/pms-core/src/org-do.ts` | Signature pass, `readGuest`, `assertGuestRef`, `GUEST_EXISTS` collapse |
| `apps/pms-core/src/property-do.ts` | `gateGuestRef`, `tryCreateReservation(actor, …)` |
| `apps/pms-core/src/v1-dispatch.ts` | Four guest handlers; reservation body/fingerprint/actor; error map |
| `apps/pms-core/test/guest-helpers.ts` | `createGuest(org, propertyId, guestId, displayName, actor?)` |
| `apps/pms-core/test/guests.spec.ts` | DO deltas + M3 |
| `apps/pms-core/test/guests-routes.spec.ts` | HTTP matrix 1–18 + M4 via GET |
| `apps/pms-core/test/reservations.spec.ts` | Fixture migration + M2 |
| Other booking test files | Drop client `piiKeyId`; mint guest on real create paths |
| `.github/workflows/ci.yml` | Shard bump **only if** measured |
| Spec + plan | Include in final ship commit if preferred |

---

### Task 1: Contracts — `GUEST_EXISTS`, catalog `FAIL_CLOSED`, notes guard, route audit

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`

**Interfaces:**
- Produces: `GUEST_EXISTS = 'guest_exists'`
- Produces: `guests.create` / `guests.update` with `degraded: 'FAIL_CLOSED'` and **identical** `notes` (`GUESTS_FAIL_CLOSED_NOTES`)
- Produces: audit rows at indices 39–42

- [ ] **Step 1: Add failing register + constant tests (RED)**

```ts
// idempotency.ts — next to GUEST_ALREADY_ERASED
export const GUEST_EXISTS = 'guest_exists' as const;

// idempotency.test.ts
expect(GUEST_EXISTS).toBe('guest_exists');
expect(GUEST_NOT_FOUND).toBe('guest_not_found');
expect(GUEST_ALREADY_ERASED).toBe('guest_already_erased');

// register.test.ts
it('guests.create and guests.update are FAIL_CLOSED with identical revisit notes', () => {
  const create = COMMAND_CATALOG.find((c) => c.id === 'guests.create');
  const update = COMMAND_CATALOG.find((c) => c.id === 'guests.update');
  expect(create?.degraded).toBe('FAIL_CLOSED');
  expect(update?.degraded).toBe('FAIL_CLOSED');
  expect(create?.entitlement).toBe('pms.core');
  expect(update?.entitlement).toBe('pms.core');
  expect(create?.notes).toBe(update?.notes);
  expect(create?.notes).toMatch(/KV permission projection/i);
  expect(create?.notes).toMatch(/pre-handler permission gate/i);
});

it('guests.erase remains FAIL_CLOSED with guests:erase', () => {
  const c = COMMAND_CATALOG.find((x) => x.id === 'guests.erase');
  expect(c?.degraded).toBe('FAIL_CLOSED');
  expect(c?.permission).toBe('guests:erase');
});
```

Run: `pnpm --filter @hospai/contracts test`
Expected: FAIL — `GUEST_EXISTS` missing; create/update still `QUEUE_PROVISIONAL`.

- [ ] **Step 2: Implement catalog + constant + audit rows (GREEN)**

In `catalog.ts`, set both create and update to `degraded: 'FAIL_CLOSED'` and assign **the same** `notes: GUESTS_FAIL_CLOSED_NOTES` (shared const in that file, or identical string literal — equality test must pass).

Append to `V1_HTTP_ROUTE_AUDIT` (after `post_rates_bulk`):

```ts
{ id: 'post_guests', scope: 'property', permission: 'guests:write', commandId: 'guests.create' },
{ id: 'patch_guest', scope: 'property', permission: 'guests:write', commandId: 'guests.update' },
{ id: 'post_guest_erase', scope: 'property', permission: 'guests:erase', commandId: 'guests.erase' },
{
  id: 'get_guest',
  scope: 'property',
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

Run: `pnpm --filter @hospai/contracts test` and `pnpm check:entitlements && pnpm check:degraded`
Expected: PASS (permissions check may fail until `V1_ROUTES` catches up in Task 5 — that is OK; do not append stub routes early).

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts packages/contracts/src/register.test.ts \
  packages/contracts/src/v1-http-routes.ts
git commit -m "$(cat <<'EOF'
feat(contracts): GUEST_EXISTS, guests create/update FAIL_CLOSED, guest route audit

EOF
)"
```

---

### Task 2: OrgDO — signature pass, `GUEST_EXISTS` collapse, `readGuest`, `assertGuestRef`

**Files:**
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `apps/pms-core/test/guest-helpers.ts`
- Modify: `apps/pms-core/test/guests.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  tryCreateGuest(actor, propertyId, input, idem)
  tryUpdateGuest(actor, propertyId, input, idem)
  tryEraseGuest(actor, propertyId, input, idem)
  readGuest(actor, propertyId, guestId)
  assertGuestRef(guestRef) → { ok: true; piiKeyId } | { ok: false; error: GUEST_NOT_FOUND | GUEST_ALREADY_ERASED }
  ```
- Produces: `createGuest(org, propertyId, guestId, displayName, actor?)` helper

- [ ] **Step 1: Update helper + failing DO tests (RED)**

```ts
// guest-helpers.ts
export async function createGuest(
  org: DurableObjectStub<OrgDO>,
  propertyId: string,
  guestId: string,
  displayName: string,
  actor: ActorContext = TEST_OWNER_ACTOR,
): Promise<GuestRefs> {
  const input = { guestId, profile: { displayName } };
  const result = await org.tryCreateGuest(
    actor,
    propertyId,
    input,
    await idemFor(`guest-create-${guestId}`, input),
  );
  if (!result.ok) throw new Error(`create guest failed: ${result.error}`);
  return { guestRef: guestId, piiKeyId: result.piiKeyId };
}
```

In `guests.spec.ts`, pass a property id (e.g. `prop_guest_test`) into every `createGuest` call. Add:

```ts
it('create after erase returns guest_exists (never un-erase)', async () => {
  const org = await provisionedOrg(`org-recreate-${crypto.randomUUID()}`);
  const propertyId = 'prop_recreate';
  const guestId = 'guest_recreate';
  await createGuest(org, propertyId, guestId, 'Once');
  await org.tryEraseGuest(TEST_OWNER_ACTOR, propertyId, { guestId }, await idemFor('e', { guestId }));
  const again = await org.tryCreateGuest(
    TEST_OWNER_ACTOR,
    propertyId,
    { guestId, profile: { displayName: 'Twice' } },
    await idemFor('c2', { guestId, profile: { displayName: 'Twice' } }),
  );
  expect(again).toEqual({ ok: false, error: GUEST_EXISTS });
});

it('M3: idempotent replay of create does not mint a second data_key', async () => {
  const org = await provisionedOrg(`org-m3-${crypto.randomUUID()}`);
  const propertyId = 'prop_m3';
  const guestId = 'guest_m3';
  const input = { guestId, profile: { displayName: 'Ada' } };
  const idem = await idemFor('m3-create', input);
  const first = await org.tryCreateGuest(TEST_OWNER_ACTOR, propertyId, input, idem);
  expect(first.ok).toBe(true);
  const second = await org.tryCreateGuest(TEST_OWNER_ACTOR, propertyId, input, idem);
  expect(second).toEqual(first);
  // Count via test hook or SQL helper — assert exactly one data_key for this piiKeyId / subject
  expect(await org.testDataKeyHasMaterial((first as { piiKeyId: string }).piiKeyId)).toBe(true);
  // If a COUNT helper is needed, add testCountDataKeysForSubject(guestId) → number; expect 1
});

it('readGuest returns tombstone when erased_at set', async () => {
  // create → erase → readGuest → { ok: true, erased: true, profile: null }
});

it('M4 DO: shredded key without erased_at is an incident, not a tombstone', async () => {
  const org = await provisionedOrg(`org-m4-${crypto.randomUUID()}`);
  const propertyId = 'prop_m4';
  const refs = await createGuest(org, propertyId, 'guest_m4', 'Live');
  expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);
  await expect(org.readGuest(TEST_OWNER_ACTOR, propertyId, 'guest_m4')).rejects.toThrow(/PII key shredded|shred/i);
});
```

Run focused guests tests — Expected: FAIL on new signatures / missing methods.

- [ ] **Step 2: Implement OrgDO changes (GREEN)**

1. Import `GUEST_EXISTS`, `FORBIDDEN`, `ActorContext`.
2. Add private `gatePermission(actor, propertyId, permission)` — system → null; else `assertPermission`; map errors.
3. Comment above `readIdempotentReplay`: points at `runIdempotent` in `@hospai/do-runtime`; pre-probe exists so vault `await`s do not re-mint keys on replay.
4. Restructure create/update/erase to:
   `gatePermission` → `gateCoreEntitlement` → (`readIdempotentReplay` for create/update) → vault → `transactionSync(runIdempotent)`.
5. **Create collision:** both erased and live existing → `GUEST_EXISTS` (replace erased→`GUEST_ALREADY_ERASED` on create). Map `GuestErasedError` inside create's catch to `GUEST_EXISTS`. Update path keeps `GUEST_ALREADY_ERASED`.
6. `assertGuestRef(guestRef)` — SELECT `pii_key_id, erased_at`; missing → `GUEST_NOT_FOUND`; erased → `GUEST_ALREADY_ERASED`; else `{ ok: true, piiKeyId }`.
7. `readGuest` — SELECT includes `erased_at`; branch before decrypt; `gatePermission(..., 'guests:read')` + entitlement.

Run: `cd apps/pms-core && pnpm test -- test/guests.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/org-do.ts apps/pms-core/test/guest-helpers.ts apps/pms-core/test/guests.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): OrgDO guest actor pass, readGuest tombstone, assertGuestRef

EOF
)"
```

---

### Task 3: PropertyDO — `gateGuestRef` + `tryCreateReservation` actor / looked-up key

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`tryCreateReservation` ~2705+)
- Modify: `apps/pms-core/test/reservations.spec.ts` (M2 + enough call sites to compile)

**Interfaces:**
- Consumes: `OrgDO.assertGuestRef(guestRef)`
- Produces:
  ```ts
  tryCreateReservation(actor, { reservationId, roomTypeId, guestRef, arrivalDate, departureDate }, idem)
  // stores pii_key_id from gateGuestRef; no input.piiKeyId
  ```

- [ ] **Step 1: Write M2 + a create-gate failing test (RED)**

```ts
// reservations.spec.ts — M2
it('M2: modify of legacy guest_ref reservation does not require OrgDO guest', async () => {
  const name = `legacy-mod-${crypto.randomUUID()}`;
  const stub = await provisionedPropertyStub(name, 'UTC', 'USD');
  const added = await addRoomType(stub, 'rt_king', 3);
  await stub.insertReservationForTest({
    reservationId: 'res_legacy',
    roomTypeId: 'rt_king',
    guestRef: 'legacy',
    piiKeyId: 'legacy',
    arrivalDate: added.fromDate,
    departureDate: addDays(added.fromDate, 2),
    status: 'confirmed',
  });
  const modInput = {
    reservationId: 'res_legacy',
    roomTypeId: 'rt_king',
    arrivalDate: added.fromDate,
    departureDate: addDays(added.fromDate, 3),
  };
  // tryModifyReservation still ungated for actor in this slice — call as today
  expect(await stub.tryModifyReservation(modInput, await idemFor('mod-legacy', modInput))).toMatchObject({
    ok: true,
  });
});

it('create reservation rejects unknown guestRef', async () => {
  // provision org+property, mint nothing, tryCreateReservation with ghost guestRef → GUEST_NOT_FOUND
});
```

- [ ] **Step 2: Implement PropertyDO (GREEN)**

```ts
private async gateGuestRef(
  orgId: string,
  guestRef: string,
): Promise<
  | { ok: true; piiKeyId: string }
  | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
> {
  const org = resolveOrgStub(this.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  return org.assertGuestRef(guestRef);
}
```

`tryCreateReservation` new order after `assertRpcAvailable` / lanes / orgId:

1. `gatePermission(actor, 'reservations:write')`
2. `gateCoreEntitlement(orgId)` (existing)
3. Existing date/stay/timezone checks (**drop** the old `if (!input.guestRef || !input.piiKeyId)` piiKeyId half — keep guestRef required)
4. `const guestGate = await this.gateGuestRef(orgId, input.guestRef); if (!guestGate.ok) return guestGate;`
5. Inside `runIdempotent` insert/outbox: use `guestGate.piiKeyId` (close over the const — still sync inside execute)

Import `resolveOrgStub`, `GUEST_NOT_FOUND`, `GUEST_ALREADY_ERASED`. Do **not** touch `tryModifyReservation`.

- [ ] **Step 3: Update `bookConfirmed` / direct `tryCreateReservation` call sites in `reservations.spec.ts` only** so this file compiles and passes (mint guest via `createGuest` + org id from provision). Leave other files to Task 4 if the TypeScript project fails globally — prefer fixing all compile errors in Task 4 immediately after.

Run: `cd apps/pms-core && pnpm test -- test/reservations.spec.ts test/guests.spec.ts`
Expected: PASS for updated cases.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/reservations.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): gateGuestRef on create reservation; look up piiKeyId

EOF
)"
```

---

### Task 4: Fixture migration — all real-path booking call sites

**Files:**
- Modify (drop client `piiKeyId`, mint guest):  
  `reservations-routes.spec.ts`, `degraded-mode.spec.ts`, `folio-routes.spec.ts`, `rooms-routes.spec.ts`, `rooms.spec.ts`, `night-audit-room-charges.spec.ts` (only if it calls `tryCreateReservation`), `ari-projection.spec.ts`, `entitlements.spec.ts`, `events-queue.spec.ts`, `reservations-ledger.property.spec.ts`, `property-do.spec.ts` (only real create paths), `observability.spec.ts` if applicable
- **Do not change** `insertReservationForTest` call sites — they bypass the gate

**Recipe for each real create:**

```ts
const orgId = /* known from provision */;
const propertyId = /* property name / id */;
const org = orgStub(orgId); // or provisionedOrg
await org.ensureMember('user_owner', 'owner'); // if not already
const guest = await createGuest(org, propertyId, `guest_${reservationId}`, 'Test Guest');
const input = {
  reservationId,
  roomTypeId,
  guestRef: guest.guestRef,
  // no piiKeyId
  arrivalDate,
  departureDate,
};
await stub.tryCreateReservation(TEST_OWNER_ACTOR, input, await idemFor(..., input));
```

HTTP `POST /reservations` bodies: remove `piiKeyId`; ensure a prior `POST /guests` or DO `createGuest` in the test setup.

- [ ] **Step 1: Migrate helpers shared across files first** (`bookConfirmed`, route helpers that post reservations).

- [ ] **Step 2: Fix compile errors file by file; run each affected spec**

```bash
cd apps/pms-core && pnpm test -- test/reservations-routes.spec.ts
# …repeat per file
```

- [ ] **Step 3: Full pms-core suite once (watch wall time for Task 6)**

```bash
cd apps/pms-core && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/test
git commit -m "$(cat <<'EOF'
test(pms-core): mint real guests on reservation create paths

EOF
)"
```

---

### Task 5: HTTP routes — four guest handlers + reservation delta + matrix

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Create: `apps/pms-core/test/guests-routes.spec.ts`

**Interfaces:**
- Consumes: OrgDO methods from Task 2; `tryCreateReservation(actor, …)` from Task 3
- Produces: handlers wired at `V1_ROUTES` indices matching audit 39–42

- [ ] **Step 1: Extend error map**

In `mapReservationCommandErrorStatus` (or a small `mapGuestCommandErrorStatus` used by guest handlers + reservation):

| Code | Status |
|---|---|
| `GUEST_NOT_FOUND` | 404 |
| `GUEST_ALREADY_ERASED` | 409 |
| `GUEST_EXISTS` | 409 |
| `not_member` | 404 (handlers map to `{ error: 'not_found' }`) |
| `FORBIDDEN` / `scope_mismatch` | 403 |

- [ ] **Step 2: Implement four handlers**

Pattern for writes:

```ts
async function handlePostGuests(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  // parse body: guestId, displayName, email?, phone?, idempotencyKey
  const resolvedCtx = await resolvePropertyContext(ctx, propertyId);
  if (resolvedCtx instanceof Response) return resolvedCtx;
  const org = resolveOrgStub(ctx.env.ORG_DO, { orgId: resolvedCtx.property.orgId }) as DurableObjectStub<OrgDO>;
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const profile = { displayName: body.displayName, email: body.email, phone: body.phone };
  const fingerprint = await fingerprintPayload({ guestId: body.guestId, ...profile });
  try {
    const result = await org.tryCreateGuest(
      actor,
      propertyId,
      { guestId: body.guestId, profile },
      { key: body.idempotencyKey, fingerprint },
    );
    // map errors → status
    return json(result, result.ok ? 200 : map…);
  } catch (e) {
    if (e instanceof Error) {
      return json(
        { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'guests.create' },
        503,
        { 'Retry-After': '30' },
      );
    }
    throw e;
  }
}
```

`handleGetGuest`: call `readGuest`; on transport failure use `degradedFailClosedReadResponse()` or `{ error: 'org_unreachable', degraded: 'FAIL_CLOSED' }` with Retry-After. Decrypt incidents (non-transport throws from readGuest) → 500.

- [ ] **Step 3: Patch `handlePostReservations`**

- Remove `piiKeyId` from body type, required-field check, fingerprint, and `commandPayload`.
- Pass `actor` into `tryCreateReservation`.
- Map `GUEST_NOT_FOUND` / `GUEST_ALREADY_ERASED` on the result.

- [ ] **Step 4: Append `V1_ROUTES` in exact audit order**

```ts
{ scope: 'property', method: 'POST', pattern: /^\/v1\/properties\/([^/]+)\/guests$/, permission: 'guests:write', commandId: 'guests.create', handler: handlePostGuests },
{ scope: 'property', method: 'PATCH', pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/, permission: 'guests:write', commandId: 'guests.update', handler: handlePatchGuest },
{ scope: 'property', method: 'POST', pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/erase$/, permission: 'guests:erase', commandId: 'guests.erase', handler: handlePostGuestErase },
{ scope: 'property', method: 'GET', pattern: /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/, permission: 'guests:read', entitlement: 'pms.core', handler: handleGetGuest },
```

- [ ] **Step 5: Write `guests-routes.spec.ts` matrix (cases 1–18)**

Include especially:

- **11** ghost book → 404  
- **12** erased book → 409  
- **13** book with wrong `piiKeyId` in JSON body → 200; stored + outbox key = looked-up  
- **M4 via HTTP:** create → DO `testShredGuestKey` → GET → 5xx not tombstone  
- **6** erase → GET tombstone  

Harness: mirror `rate-plans-routes.spec.ts` / `folio-routes.spec.ts` (dev actor header, provision property, seed subscription).

- [ ] **Step 6: Run checks + tests**

```bash
pnpm check:permissions && pnpm check:degraded && pnpm check:entitlements
cd apps/pms-core && pnpm test -- test/guests-routes.spec.ts test/reservations-routes.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/guests-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): guest HTTP routes and reservation guestRef lookup

EOF
)"
```

---

### Task 6: Full suite + CI shard capacity

**Files:**
- Possibly modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Run full pms-core suite; note wall time / flakes**

```bash
cd apps/pms-core && pnpm test
```

- [ ] **Step 2: If warranted, bump shards to 4**

```yaml
# .github/workflows/ci.yml
matrix:
  shard: [1, 2, 3, 4]
# …
- run: pnpm --filter @hospai/pms-core run test --shard=${{ matrix.shard }}/4
```

Do **not** bump if 3 remains healthy — spec says measure first.

- [ ] **Step 3: Final gates**

```bash
pnpm check:entitlements && pnpm check:permissions && pnpm check:degraded
pnpm typecheck
```

- [ ] **Step 4: Commit** (shard bump and/or chore only if something changed)

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
chore(ci): bump pms-core vitest shards after guest fixture load

EOF
)"
```

---

## Self-review (plan vs spec)

| Spec item | Task |
|---|---|
| §2.1 FAIL_CLOSED + notes + register equality | 1 |
| §2.2 / §2.2b gateGuestRef create-only; look up key; fingerprint deploy-day accepted (docs only) | 3, 5 |
| §2.3 property-scoped routes | 5 |
| §2.4 hybrid idempotency + comment | 2 |
| §2.5 / §4.3 tombstone + M4 | 2, 5 |
| §2.6 `GUEST_EXISTS` never un-erase | 1, 2 |
| §3 routes 39–42 | 1, 5 |
| §3.4 no edge fail-fast; drop body `piiKeyId` | 5 |
| §4.1–4.4 DO signatures | 2, 3 |
| §5 fixtures + shards | 4, 6 |
| §5.4 M1–M4 | 2, 3, 5 |
| §6.3 five ungated try* logged only | — (no task) |
