# Guests / PII Vertical — Routes, Validation, Erasure Reads

**Date:** 2026-08-06  
**Status:** Revised (v2 — fingerprint deploy-day accepted; create/update notes equality guard; route indices 39–42; `GUEST_EXISTS` in `idempotency.ts`; M2 homes in `reservations.spec.ts`)  
**Sources:** ARCHITECTURE.md §4.3 (permission projection), §4.6 (degraded mode), §4.8 (crypto-shredding), §15 Rule 3 (edge is an optimization, never the only check); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [guests + crypto-shredding Phase 0](./2026-07-28-guests-crypto-shredding-design.md); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md); [folio charges vertical](./2026-08-05-folio-charges-vertical-design.md) (`FAIL_CLOSED` reclassification + `degradedRead` honesty); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) (deploy-day write-path-only gate; `RATE_PLAN_ID_EXISTS` / never-un-archive shape this repeats for `GUEST_EXISTS`)

---

## 1. Context & Motivation

`guests.create` mints the `data_key` row and returns `{ guestId, piiKeyId }` — fully implemented on OrgDO with `tryUpdateGuest`, `tryEraseGuest`, `readGuestProfile`, crypto-shredding, and a passing `guests.spec.ts`. It has **no HTTP route**.

Meanwhile `POST /reservations` **requires** `guestRef` and `piiKeyId`, takes them as opaque client strings, and validates neither. Over HTTP today you cannot create a guest, and you *can* book a reservation against a `piiKeyId` that no `data_key` row backs. Consequences compound: `readGuestProfile` returns null (or throws) for a guest the reservation claims, and `guests.erase` — correctly `FAIL_CLOSED` (*"§4.8 crypto-shred — must not queue during outage"*) — cannot shred a key that was never minted.

That is `rate_day.rate_plan_id` accepting `'CORP'` again, except the dangling reference is the PII encryption key.

**Why this over staff or payments.** Staff (7 commands) still carries the unresolved fork — housekeeper as Clerk user vs property-local record. Payments wants a cashier/shift model that wants staff. Guests **completes the primary flow**: booking a real guest is currently impossible end-to-end.

**Permissions already in place:** `guests:read` / `guests:write` for all three roles; `guests:erase` for owner/admin; all three commands carry `entitlement: 'pms.core'`. No opt-out pairing this slice.

### Scope in

1. Property-scoped HTTP routes for `guests.create` / `guests.update` / `guests.erase` plus a guest read route.
2. OrgDO actor + `gatePermission` signature pass on the three `try*` methods (hybrid idempotency preserved).
3. `guests.create` / `guests.update` → `FAIL_CLOSED` with catalog revisit notes.
4. Validate guest on `tryCreateReservation` (create only); drop client-supplied `piiKeyId` — PropertyDO stores the looked-up key.
5. Fold `actor` + `gatePermission(actor, 'reservations:write')` into the same `tryCreateReservation` edit.
6. Explicit erased-guest read tombstone; `GUEST_EXISTS` contracts constant; fixture migration + shard capacity check in the same PR.

### Scope out

- `invokeOrgDo` / org provisional replay (revisit when §4.3 KV permission projection lands).
- Actor pass on the other five ungated `try*` methods (logged adjacent cleanup — §6.3).
- Extracting `readIdempotentReplay` into `@hospai/do-runtime`.
- Guest list / CRM beyond `GuestProfile` (`displayName`, optional `email` / `phone`).
- Staff PII, payments, cashier shifts.
- Per-file test-suite capacity cleanup (deferred; shard bump is the stopgap).

---

## 2. Design Decisions

### 2.1 Create/update → `FAIL_CLOSED` (not `invokeOrgDo`)

`guests.create` and `guests.update` are catalogued `QUEUE_PROVISIONAL`. Every provisional helper (`invokePropertyDo`, `REPLAY_DISPATCH`, `ProvisionalContext`, `assertProvisionalBusinessDateOpen`) assumes PropertyDO + a property business date. Building an org provisional plane is the large fork.

Three structural arguments reject that fork for Phase 1:

1. **The queue path is unreachable in the outage it covers.** `requirePermission` resolves an OrgDO stub and calls `assertPermission` before any handler. If OrgDO is unreachable, the request dies at the permission gate — the guest handler never runs, so there is nothing to queue. An org provisional plane is dead code until the KV permission projection (§4.3) lets property-scoped requests survive an OrgDO blip.
2. **`guests.create` is read-your-write.** It returns `{ guestId, piiKeyId }`, and booking needs a real guest (and, after §2.2b, a key that exists). A `202` with no materialised guest breaks the flow. `QUEUE_PROVISIONAL` fits commands whose response the caller does not consume.
3. **Minting a key is as sensitive as shredding one.** Erase already must not queue. Provisional create would mint `data_key` at **replay** — so a reservation could reference a key that does not exist yet. That reintroduces the dangling-reference bug through the degraded door (same class as `folio.split_charge`'s commutativity failure).

**Resolution:** reclassify both to `FAIL_CLOSED`.

```diff
   {
     id: 'guests.create',
     …
-    degraded: 'QUEUE_PROVISIONAL',
+    degraded: 'FAIL_CLOSED',
     …
+    notes:
+      'FAIL_CLOSED because OrgDO is on the pre-handler permission gate path ' +
+      '(requirePermission → assertPermission), not because guest creates are ' +
+      'unimportant. Revisit when the §4.3 KV permission projection lets ' +
+      'property-scoped requests survive an OrgDO blip — then an org ' +
+      'provisional plane becomes meaningful. Also read-your-write: client ' +
+      'needs a materialised guest before booking.',
   },
   {
     id: 'guests.update',
     …
-    degraded: 'QUEUE_PROVISIONAL',
+    degraded: 'FAIL_CLOSED',
     …
+    notes: /* identical revisit-condition string as guests.create */,
   },
```
Copy the same `notes` string onto both entries — do not paraphrase one of them. Guard in `packages/contracts/src/register.test.ts` (same class as the room-status `events` assertion in `17bb052`):

```ts
expect(
  COMMAND_CATALOG.find((c) => c.id === 'guests.create')?.notes,
).toBe(COMMAND_CATALOG.find((c) => c.id === 'guests.update')?.notes);
```

No entitlement pairing — both already carry `pms.core`. Neither appears in `REPLAY_DISPATCH`, so `check:degraded` stays green. `guests.erase` is already `FAIL_CLOSED`.

### 2.2 Validate guest refs in `tryCreateReservation` — create only; look up `piiKeyId`

PropertyDO already RPCs OrgDO from `gatePermission` *before* `runIdempotent` on nineteen `try*` methods. The real constraint is "no await inside the sync closure," already solved by return-style gates before `transactionSync`.

**Resolution: `gateGuestRef` inside `tryCreateReservation`, before `runIdempotent`.** Private helper awaits OrgDO `assertGuestRef`. Dispatcher does **not** duplicate the check — an uncached edge fail-fast costs a second OrgDO round trip per booking and returns the same wire codes the DO already returns. Rule 3 requires the DO check to exist; the edge is optional and Phase 1 drops it.

**Do not cache guest validation.** `PermissionDoCache` is the wrong template: a 60-second stale "exists" after `guests.erase` (FAIL_CLOSED crypto-shred) would let bookings land against a destroyed key — enforcement that looks like enforcement but isn't. Residual TOCTOU (erase between await and write) matches `gatePermission`; accepted and narrow.

**Scope to create only.** `tryModifyReservation` (and cancel / status commands) never write `guest_ref` / `pii_key_id` — they only re-emit them in outbox payloads. Applying `gateGuestRef` to modify would make every Phase 0 `'legacy'` backfill row unmodifiable on deploy. Write-path only for establishing the reference; reads of existing reservations stay ungated. `'legacy'` appears only in the v7 migration backfill — no production writer emits it, so create has no escape hatch.

#### 2.2b Client does not supply `piiKeyId` on book *(locked)*

PropertyDO never decrypts with `pii_key_id` — it only stores and re-emits it in outbox payloads. The client-supplied copy is pure redundancy; `assertGuestRef` already loads the authoritative key.

| Design | Behaviour |
|---|---|
| (a) Client supplies; server validates match | Mismatch needs a distinct wire code; redundant field |
| **(b) Client omits; server stores looked-up key** | Mismatch impossible by construction |

**Resolution: (b).** `POST /reservations` and `tryCreateReservation` drop `piiKeyId` from the client contract. Fingerprint drops it too (keeps `guestRef`). `assertGuestRef(guestRef)` returns `{ ok: true; piiKeyId }`; PropertyDO inserts that value. **No silent overwrite** — never accept a client key and replace it.

Cheap now: no working HTTP create-guest → book consumers exist yet.

**Deploy-day — fingerprint shape change (accepted).** Dropping `piiKeyId` from the fingerprint means a client retrying a booking **across the deploy boundary** with the same idempotency key computes a different fingerprint than the row stored under the old shape and gets `IdempotencyKeyReused` (409) instead of the cached success — an error for a booking that actually succeeded. Unlike the guest routes, this path is reachable today: `POST /reservations` already accepts arbitrary `guestRef`/`piiKeyId` strings and succeeds, so real `idempotency` rows with the old fingerprint can exist. The window is narrow (retries spanning the deploy, within the client's retry window). **Accepted rather than versioning the fingerprint** — same honesty class as rate-plans' orphan-adoption and create-only guest validation leaving `'legacy'` rows readable. Do not discover this via a support ticket; operators / clients that retry across deploy with a reused key may see 409 once.

Also in this edit: `actor` + `gatePermission(actor, 'reservations:write')` on `tryCreateReservation`. The other five ungated `try*` methods are §6.3, not this slice.

### 2.3 Guest routes are property-scoped; records stay org-wide

`guests:*` permissions are **property-scoped** (`ORG_SCOPED_PERMISSIONS` is only `org:read` / `org:manage` / `property:provision`). `assertPermission` with `propertyId: null` returns `scope_mismatch` for every guest write.

**Resolution:** routes live under `/v1/properties/:propertyId/guests…`. OrgDO methods take `propertyId` so the DO-side check is `assertPermission({ userId, propertyId, permission: 'guests:write' | … })`. Authorization = "you may write guests at this property"; the guest row remains org-scoped and reusable across properties. Edge `requirePermission` already supplies `propertyId` for `scope: 'property'` routes.

### 2.4 OrgDO keeps the hybrid idempotency contract

Create/update already use a hybrid PropertyDO does not need:

```
gateCoreEntitlement → readIdempotentReplay → await vault prep → transactionSync(runIdempotent(…))
```

The pre-probe exists so crypto `await`s never run on a replay (and so a replayed create does not mint a second `data_key`). Erase has no async prep and skips the pre-probe. Unifying onto PropertyDO's single-`runIdempotent` shape would force vault prep *before* the idempotency lookup — a regression.

**Resolution:** keep the hybrid. Signature-pass order:

```
lanes → orgId precondition
→ gatePermission(actor, propertyId, permission)   // system actor short-circuits
→ gateCoreEntitlement(orgId)
→ readIdempotentReplay                            // create/update only
→ await vault prep
→ transactionSync(runIdempotent(…))
```

OrgDO `gatePermission` is **in-process** (`assertPermission`) — no `PermissionDoCache` / RPC. System-actor short-circuit for PropertyDO symmetry even though `FAIL_CLOSED` means no replay actor reaches guest commands today.

`readIdempotentReplay` stays file-local at `org-do.ts`; add a comment pointing at `runIdempotent` in `@hospai/do-runtime` and why the pre-probe exists. Extraction to the package is correctly out of scope.

### 2.5 Erase with live reservations — allow; define the read

Erase shreds `data_key` but reservations hold `pii_key_id` as an opaque string with no cascade. After erase, an in-house stay references a key that no longer decrypts — the dangling-reference class from the other direction.

| Option | Verdict |
|---|---|
| Refuse erase while non-terminal reservations exist | Clean operationally; wrong under GDPR (erasure is not conditional on booking state) |
| **Allow; define the read** | Reservation stays a valid stay record; PII becomes unavailable |

**Resolution: erase always allowed** (already idempotent success if already erased). No PropertyDO reservation scan from OrgDO.

| Path | Behaviour |
|---|---|
| `guests.erase` | Shreds key; sets `erased_at`. Does not touch reservations. |
| `gateGuestRef` / new bookings | Reject erased guests with **`GUEST_ALREADY_ERASED`** (distinct from `GUEST_NOT_FOUND` — different operator actions; caller already holds `reservations:write`, so not-found-for-privacy does not apply). |
| Guest read | **Tombstone, not throw.** See §4.3. |
| Reservation reads | Unchanged — opaque `guestRef` / `piiKeyId`; no guest join this slice. |

Validation on create stops bad refs being *established*; the tombstone defines what happens when a good ref becomes unreadable later. Both halves are required.

**Normative — branch on `erased_at`, never on a caught decrypt failure.** Today's `readGuestProfile` selects `pii_key_id, profile_cipher, profile_iv` (not `erased_at`); an erased guest falls through to decrypt and throws `PII key shredded`. The tombstone requires changing the SELECT. Wrapping decrypt in `try/catch` and treating any failure as erased is wrong: a decrypt failure can mean a corrupted `data_key`, vault misconfiguration, or format change — each would silently render as `{ erased: true }` with no alert. Read `erased_at`, branch on it, and let decrypt failure on a *non-erased* guest stay a thrown incident.

### 2.6 `GUEST_EXISTS` — promote constant; never un-erase

`tryCreateGuest` already branches on an existing row (`erased_at != null` → `GUEST_ALREADY_ERASED`, plain existing → bare `'guest_exists'`), with an in-transaction re-check. What is missing is the contracts constant and collapsing erased→create into the same code as live collision.

Add:

```ts
export const GUEST_EXISTS = 'guest_exists' as const;
```

| Existing row | `tryCreateGuest` |
|---|---|
| None | Insert |
| Exists, not erased | `{ ok: false, error: GUEST_EXISTS }` |
| Exists, erased | `{ ok: false, error: GUEST_EXISTS }` — **never un-erase** |

Silently reviving an erased subject by re-creating their id would defeat the shred. Same shape as `RATE_PLAN_ID_EXISTS` refusing to un-archive.

---

## 3. Routes / API surface

All four routes are `scope: 'property'`. Handlers resolve property → `orgId`, then call OrgDO directly (no `invokePropertyDo`). On OrgDO transport failure: degraded `503` with `Retry-After`. No queue path.

### 3.1 Route audit

| Audit id | Method / path | Permission | Command / read | Notes |
|---|---|---|---|---|
| `post_guests` | `POST /v1/properties/:propertyId/guests` | `guests:write` | `guests.create` | `FAIL_CLOSED` (§2.1) |
| `patch_guest` | `PATCH /v1/properties/:propertyId/guests/:guestId` | `guests:write` | `guests.update` | `FAIL_CLOSED` |
| `post_guest_erase` | `POST /v1/properties/:propertyId/guests/:guestId/erase` | `guests:erase` | `guests.erase` | already `FAIL_CLOSED` |
| `get_guest` | `GET /v1/properties/:propertyId/guests/:guestId` | `guests:read` | — | `entitlement: 'pms.core'`, `degradedRead: 'FAIL_CLOSED'` |

`get_guest` follows `get_folio` / `get_rooms` / `get_rate_plans`: no profile projection, so `READ_STALE` would claim a capability the route lacks. No `commandId` (satisfies `check:degraded` exclusivity). No list route this slice.

**Route indices 39–42.** `V1_HTTP_ROUTE_AUDIT` has 39 rows today (0–38; last is `post_rates_bulk`). Append the four guest rows at indices **39–42** in this order: `post_guests`, `patch_guest`, `post_guest_erase`, `get_guest`. `V1_ROUTES` in `v1-dispatch.ts` must append in the **identical order** in the same commit — `check:permissions` compares audit vs dispatcher **element-wise by index**.

### 3.2 Request / response bodies

**`POST …/guests`**
```ts
// body
{ guestId: string; displayName: string; email?: string; phone?: string; idempotencyKey: string }
// 200
{ ok: true; guestId: string; piiKeyId: string }
```
Client-supplied `guestId` (same pattern as `roomId` / `reservationId`). Fingerprint = `{ guestId, displayName, email?, phone? }` with omitted-optional normalization consistent with rate-plans.

**`PATCH …/guests/:guestId`**
```ts
{ displayName: string; email?: string; phone?: string; idempotencyKey: string }
// 200
{ ok: true; guestId: string; piiKeyId: string }
```

**`POST …/guests/:guestId/erase`**
```ts
{ idempotencyKey: string }
// 200 — including already-erased (idempotent success)
{ ok: true; guestId: string; piiKeyId: string }
```

**`GET …/guests/:guestId`**
```ts
// 200 — live
{ ok: true; guestId: string; erased: false; profile: { displayName: string; email?: string; phone?: string } }
// 200 — tombstone (§2.5)
{ ok: true; guestId: string; erased: true; profile: null }
// 404
{ ok: false; error: 'guest_not_found' }
```

### 3.3 Wire errors

| Code | HTTP | Where |
|---|---|---|
| `guest_not_found` | 404 | GET missing; update/erase missing; `gateGuestRef` unknown guest |
| `guest_already_erased` | 409 | update after erase; `gateGuestRef` erased guest; **not** erase (erase is idempotent success) |
| `guest_exists` | 409 | create when `guestId` already present (live **or** erased) |
| `idempotency_key_reused` | 409 | fingerprint mismatch |
| `forbidden` / `scope_mismatch` | 403 | permission gate |
| `not_member` | **404** | RBAC privacy — established mapping at auth.ts and DO handlers; **not** 403 |
| `entitlement_required` / `entitlement_unavailable` | existing | unchanged |

### 3.4 `POST /reservations` delta

| Field | Change |
|---|---|
| Body | Drop `piiKeyId`. Required: `reservationId`, `roomTypeId`, `guestRef`, `arrivalDate`, `departureDate`, `idempotencyKey` |
| Fingerprint | Drop `piiKeyId`; keep `guestRef` |
| Actor | Pass `{ kind: 'user', userId }` into `tryCreateReservation` |
| Edge guest check | **None** — `gateGuestRef` is the single check (§2.2) |

Dispatcher pattern remains `as { … }` with required-field checks; unknown keys (including a stale client `piiKeyId`) are structurally ignored — 21 handlers, none reject unknown keys. Test 13 locks that the looked-up key wins (§5).

Map `guest_not_found` → 404, `guest_already_erased` → 409 on this route.

---

## 4. DO signatures

### 4.1 OrgDO — three `try*` + `gatePermission`

```ts
tryCreateGuest(actor: ActorContext, propertyId: string, input: { guestId: string; profile: GuestProfile }, idem: IdempotencyKey)
tryUpdateGuest(actor: ActorContext, propertyId: string, input: { guestId: string; profile: GuestProfile }, idem: IdempotencyKey)
tryEraseGuest(actor: ActorContext, propertyId: string, input: { guestId: string }, idem: IdempotencyKey)
```

Private `gatePermission(actor, propertyId, permission)` — system short-circuit; else in-process `assertPermission`. Precise error unions (include `GUEST_EXISTS`; drop open `string` where sibling slices did).

### 4.2 `readGuest` (replaces throw-on-shredded HTTP path)

```ts
async readGuest(
  actor: ActorContext,
  propertyId: string,
  guestId: string,
): Promise<
  | { ok: true; guestId: string; erased: false; profile: GuestProfile }
  | { ok: true; guestId: string; erased: true; profile: null }
  | { ok: false; error: typeof GUEST_NOT_FOUND | typeof FORBIDDEN | 'not_member' | 'scope_mismatch' | … }
>
```

`SELECT` includes `erased_at`. No row → `GUEST_NOT_FOUND`. `erased_at IS NOT NULL` → tombstone **without decrypt**. Else decrypt; decrypt failure propagates as incident (5xx), never a tombstone. Gate with `guests:read` + `gateCoreEntitlement`.

Demote `readGuestProfile` to a test-only helper (or delete it and migrate `guests.spec.ts` to `readGuest`). The HTTP path and `gateGuestRef` must not call it.

### 4.3 `assertGuestRef` (OrgDO) + `gateGuestRef` (PropertyDO)

```ts
// OrgDO — actor-less referential-integrity RPC (caller already gated)
async assertGuestRef(guestRef: string): Promise<
  | { ok: true; piiKeyId: string }
  | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
>

// PropertyDO — private; used only by tryCreateReservation
private async gateGuestRef(
  orgId: string,
  guestRef: string,
): Promise<
  | { ok: true; piiKeyId: string }
  | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED }
>
```

No cache. Missing → `GUEST_NOT_FOUND`. Erased → `GUEST_ALREADY_ERASED`. Live → authoritative `piiKeyId`.

### 4.4 `tryCreateReservation` signature pass

```ts
tryCreateReservation(
  actor: ActorContext,
  input: {
    reservationId: string;
    roomTypeId: string;
    guestRef: string;
    arrivalDate: string;
    departureDate: string;
  },
  idem: IdempotencyKey,
): Promise<
  | { ok: true; reservationId: string; ariVersion: number; fromDate: string; toDate: string }
  | { ok: false; error: typeof GUEST_NOT_FOUND | typeof GUEST_ALREADY_ERASED | … }
>
```

Order: `assertRpcAvailable` → lanes → orgId → **`gatePermission(actor, 'reservations:write')`** → `gateCoreEntitlement` → existing date/stay checks → **`gateGuestRef(orgId, guestRef)`** → insert uses returned `piiKeyId` inside `runIdempotent`. No `provisional` param (create stays `FAIL_CLOSED`).

---

## 5. Test matrix

### 5.1 Fixture migration

Update `createGuest` in `guest-helpers.ts` to:

```ts
createGuest(org, propertyId, guestId, displayName, actor = TEST_OWNER_ACTOR): Promise<GuestRefs>
```

calling `tryCreateGuest(actor, propertyId, input, idem)`. Keep returning `{ guestRef, piiKeyId }` for shred/outbox asserts. Booking helpers mint a real guest, then book with `guestRef` only.

| Path | Sites | Action |
|---|---|---|
| Real create (`postReservation` / `bookConfirmed` / `tryCreateReservation`) | ~88 across ~10 files | Drop client `piiKeyId`; mint guest first |
| Direct SQL (`insertReservationForTest`) | ~12 | **Unaffected** — bypasses `gateGuestRef` |
| `LEGACY_GUEST` on create paths | route/DO specs | Remove; keep only for reading SQL-seeded rows |

### 5.2 Capacity

CI shards pms-core `1/3`–`3/3` (`.github/workflows/ci.yml`). Real `tryCreateGuest` on ~88 sites adds OrgDO crypto under `singleWorker` + `isolatedStorage: false`. **Same PR:** run the suite; if wall time / flake risk warrants it, bump the matrix to **4 shards** (`shard: [1,2,3,4]`, `--shard=N/4`). Do not land fixture migration without checking shard load.

### 5.3 `guests-routes.spec.ts`

| # | Test | Assertion |
|---|---|---|
| 1 | `POST …/guests` valid | `200`, `{ guestId, piiKeyId }`; outbox `guest.created` has refs, not display name |
| 2 | Create duplicate live id | `409 guest_exists` |
| 3 | Create after erase, same id | `409 guest_exists` — never un-erase |
| 4 | `PATCH` profile | `200`; `guest.updated`; GET returns new displayName |
| 5 | `PATCH` after erase | `409 guest_already_erased` |
| 6 | `POST …/erase` | `200`; GET → `{ erased: true, profile: null }`; key material gone |
| 7 | Erase already erased | `200` (idempotent) |
| 8 | Erase missing | `404 guest_not_found` |
| 9 | GET missing | `404 guest_not_found` |
| 10 | Create → book with `guestRef` only | `200`; reservation + outbox `piiKeyId` equal create’s key |
| 11 | Book unknown `guestRef` | `404 guest_not_found` |
| 12 | Book erased guest | `409 guest_already_erased` |
| 13 | Book with body including a **wrong** `piiKeyId` (e.g. another guest’s key) | `200`; stored `pii_key_id` + outbox `piiKeyId` are the **looked-up** value, not the supplied one — (b) / no-silent-overwrite canary |
| 14 | `staff` create/update | `200` (`guests:write` granted) |
| 15 | `staff` erase | `403` (`guests:erase` owner/admin only) |
| 16 | Non-member any guest route | `404` (RBAC privacy) |
| 17 | Kill-switch | `503` empty body |
| 18 | Unentitled org | `402 entitlement_required` |

### 5.4 Mutation canaries

| # | Mutation | Expected catch |
|---|---|---|
| M1 | Drop `gateGuestRef` from `tryCreateReservation` | Tests 11 / 12 fail — ghost / erased book succeeds |
| M2 | Apply `gateGuestRef` to `tryModifyReservation` | New case in **`reservations.spec.ts`**: SQL-insert `'legacy'` reservation → `tryModifyReservation` dates → must stay `ok: true`. Catches deploy-day brick |
| M3 | Move vault prep before `readIdempotentReplay` | Create guest → replay same idem key → `COUNT(data_key)` for that subject stays 1. Deliberate new case in `guests.spec.ts` — invariant has no coverage today |
| M4 | Catch decrypt failure and treat as erased | Create guest → `testShredGuestKey(piiKeyId)` (key gone, `erased_at` still NULL) → `GET …/guests/:id` → **5xx incident**, not `{ erased: true }`. Discriminates §2.5’s normative line; test 6 alone does not |

### 5.5 Existing suite deltas

| Area | Change |
|---|---|
| `guests.spec.ts` | New `createGuest` args; create-after-erase → `GUEST_EXISTS`; read-after-erase via `readGuest` tombstone; add M3 |
| Reservations / degraded / folio / rooms / night-audit | Actor on `tryCreateReservation`; drop client `piiKeyId`; mint guest on real create paths |
| `tryModifyReservation` | **No** `gateGuestRef`; M2 locks that |
| Checks | `check:entitlements` / `check:degraded` / `check:permissions` green |

---

## 6. Implementation sketch & leftovers

### 6.1 Files

| Area | Touch |
|---|---|
| `packages/contracts/src/idempotency.ts` | `GUEST_EXISTS` next to `GUEST_NOT_FOUND` / `GUEST_ALREADY_ERASED` (lines 48–49) |
| `packages/contracts/src/commands/catalog.ts` | create/update → `FAIL_CLOSED` + identical revisit `notes` |
| `packages/contracts/src/register.test.ts` | `guests.create.notes === guests.update.notes`; both `FAIL_CLOSED` |
| `packages/contracts/src/v1-http-routes.ts` | Four route-audit rows |
| `apps/pms-core/src/org-do.ts` | Signature pass; `GUEST_EXISTS` collapse; `readGuest`; `assertGuestRef`; `readIdempotentReplay` comment |
| `apps/pms-core/src/property-do.ts` | `gateGuestRef`; `tryCreateReservation(actor, …)` drops input `piiKeyId` |
| `apps/pms-core/src/v1-dispatch.ts` | Four guest handlers; reservation body/fingerprint/`actor` |
| `.github/workflows/ci.yml` | Shard bump **only if** measured |
| Tests | `guests-routes.spec.ts`; fixture churn; M1–M4; `guests.spec.ts` deltas |

No `pending-commands-consumer` / `REPLAY_DISPATCH` changes.

### 6.2 Acceptance

1. HTTP create guest → `{ guestId, piiKeyId }`; book with `guestRef` only → reservation + outbox carry the looked-up key.
2. Ghost / erased `guestRef` on create → `404` / `409`; modify of SQL `'legacy'` row still works (M2).
3. Wrong client `piiKeyId` on book → stored key is OrgDO’s (test 13).
4. Erase → GET tombstone via `erased_at`; shred-without-`erased_at` → 5xx (M4).
5. Replay create → one `data_key` row (M3).
6. Catalog create/update `FAIL_CLOSED` + revisit notes; checks green; shard bump only if suite demands it.

### 6.3 Adjacent cleanup (logged, not this slice)

```
UNGATED  tryModifyReservation   tryCancelReservation   tryNoShow
         tryUpsertRestrictionDay  tryPutDomainConfig
```

The reservations vertical never got the actor pass — only the three *status* commands did (`2069387`). This slice closes create; the other five remain a separate cleanup.

### 6.4 Open questions

None. Settled in design: FAIL_CLOSED vs `invokeOrgDo`; validation locus; deploy-day / `'legacy'`; OrgDO hybrid idempotency; erase-with-live-reservations; (a)/(b) for `piiKeyId`; edge fail-fast dropped; distinct wire codes.

---

## 7. Implementation checklist

- [ ] `GUEST_EXISTS` in `idempotency.ts`; create collision → both live and erased map to it (never un-erase).
- [ ] Catalog: `guests.create` / `guests.update` → `FAIL_CLOSED` + identical revisit `notes`; `register.test.ts` equality guard.
- [ ] OrgDO: `actor` + `propertyId` + `gatePermission`; hybrid order preserved; `readGuest`; `assertGuestRef`; comment on `readIdempotentReplay`.
- [ ] PropertyDO: `gateGuestRef`; `tryCreateReservation(actor, …)` looks up `piiKeyId`; no guest cache; no gate on modify.
- [ ] Four route-audit rows + four handlers; `get_guest` → `degradedRead: 'FAIL_CLOSED'`.
- [ ] `POST /reservations` drops `piiKeyId` from body/fingerprint; passes actor.
- [ ] `guest-helpers` + ~88 real-path fixture sites; M1–M4; `guests-routes.spec.ts`.
- [ ] Run suite; bump CI shards to 4 in the same PR only if warranted.
- [ ] `check:entitlements` / `check:degraded` / `check:permissions` green.
