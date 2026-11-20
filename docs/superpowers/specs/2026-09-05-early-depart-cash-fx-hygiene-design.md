# Early departure, cash/FX hygiene, architecture write-down (R0.14)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`. CI runs **17** `check:*` scripts (includes `check:resolve-property-prefetch` from R0.12 / G8).

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 14](../../audit/2026-09-04-full-codebase-audit.md) (**L6**, **L9**, **L10**, **L11**, **L13**, **B3**, **Q12**, **Q16**, **Q21**, **Q22**, **N13**, **N14**); [Cashiering](./2026-08-07-cashiering-design.md) (shift expected cash, unattributed overlay — **L9/L10 harden**, do not rebuild); [Cashier shift SPA](./2026-08-09-cashier-shift-spa-design.md); [Multi-currency folio](./2026-08-13-multi-currency-folio-design.md) (`allocate` LAST, ledger columns); [Partial refunds](./2026-08-14-partial-refunds-design.md); [Folio money operations](./2026-08-12-folio-money-operations-design.md); [Reservations book / lifecycle](./2026-08-04-reservations-vertical-design.md), [lifecycle completion](./2026-08-12-reservations-lifecycle-completion-design.md); [Room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) (`rooms.set_ooo_range`, horizon — **L13 hardens**); [Operator SPA UX/UI](./2026-09-05-operator-spa-ux-ui-design.md) (**U17** warning — keep; **Early depart** action adds L6 clerk path); [AGENTS.md §2 money/inventory](../../../AGENTS.md); [ARCHITECTURE.md §7.1](../../../ARCHITECTURE.md); `apps/pms-core/src/property-do.ts` (`tryCheckOut` ~9668, `releaseSoldNightsSync` ~8015, `computeShiftExpectedCashSync` ~16436, `countUnattributedCashForBusinessDateSync` ~16422, partial refund ~16206, `trySetOooRange` ~6805, `applyBlockedDeltaSync` ~6671); `apps/pms-core/src/v1-dispatch.ts` (`handlePostReservationCheckOut` ~2294, `handlePatchReservation` ~1859, `handleGetAvailability` ~8160); `apps/pms-core/src/event-consumer.ts` (~287); `apps/web-pms/src/screens/FolioScreen.tsx` (U17 ~1272, checkout ~729).

**Closes:** Audit **L6** (named early-departure command), **L9** (shift expected cash in ledger currency), **L10** (unattributed cash by property business date), **L11** (partial FX refund via `allocate` LAST), **L13** (far-future OOO beyond horizon), **B3** (`noPost` on reservation PATCH HTTP), **Q12** (single `freeAvailability` import), **Q16** (idempotency key placement table), **Q21** (lying comments), **Q22** (dead-export / SPA class hygiene where cheap), **N13** (DLQ depth assertion), **N14** (tenant-active decision + supply-chain gap doc). **Roadmap:** **R0.14**, **R3.4** (tick together in plan last task). **Requires:** R0.11 (U17 warning shipped). **Does not** advance N11 outbox sweep (depends on ARCHITECTURE §10.1), X4 invite enum collapse, Playwright, Redis, PropertyDO extraction, token restyle, `@hospai/temporal-utils` deletion, or schema migration beyond pin bumps for L6 command/route.

---

## Executive summary

Checked-in guests with a **future departure** still hold `sold` inventory through checkout — `tryCheckOut` correctly does not release remaining nights (ARCHITECTURE §7.1; U17 warns clerks). This vertical adds **`reservations.early_depart`**: shorten `departure_date` to the open **business date**, release `[businessDate, oldDeparture)` from `sold`, stay **`checked_in`** until a separate checkout. **Lengthening** an in-house stay (later departure, room type, rate plan, party) is **R4.24** — see [in-house stay changes](./2026-11-19-in-house-stay-changes-design.md); early-depart remains shortening only. Cashiering fixes align shift math with the ledger: **expected cash sums `folio_line.ledger_amount_minor`**, not txn `payment.amount_minor`; **unattributed cash counts by folio posting business date**, not UTC `created_at`. Partial FX refunds replace `Math.round(ratio)` with **`allocate(..., { policy: 'LAST' })`**. Far-future OOO **rejects** when any night lacks an `availability_day` row (`ooo_beyond_horizon`) — no silent skip, no horizon auto-extend. Hygiene: import `freeAvailability` in two inline sites; wire `noPost` through reservation PATCH; extract `FRONT_DESK_LIST_SELECT`; architecture/docs corrections; optional DLQ-depth test guard; document `pnpm audit` gap (tree currently **red** — do not block L6 on audit CI).

---

## Locked product call

1. **L6 — `reservations.early_depart`:** New catalog command + HTTP route in the **same commit**. `tryCheckOut` unchanged (no `sold` release). SPA **Early depart** on Folio when remaining nights; keep U17; **no** auto-checkout chain.
2. **L9 — Shift expected cash:** `computeShiftExpectedCashSync` sums **ledger** minor units for attributed CASH captures (join payment → PAYMENT folio line).
3. **L10 — Unattributed cash date:** `countUnattributedCashForBusinessDateSync` filters by **folio_line.business_date** (property posting date), not `date(created_at/1000,'unixepoch')`.
4. **L11 — Partial FX refund:** `ledgerRefundMinor = allocate(...)` LAST on mixed-currency partial refund; characterization test for sum invariant.
5. **L13 — OOO horizon:** Before `applyBlockedDeltaSync`, reject any night in `[start, return)` with no `availability_day` row → `ooo_beyond_horizon` (422). **Do not** auto-extend horizon this slice.
6. **Q12 — `freeAvailability`:** Import from `@hospai/contracts` in `event-consumer.ts` and `v1-dispatch.ts` `handleGetAvailability` fallback; delete inlines.
7. **B3 — `noPost` HTTP:** Optional `noPost?: boolean` on `patch_reservation` body; include in fingerprint **and** DO payload (DO already supports). **Not** on guest profile PATCH.
8. **Architecture write-down:** Amend ARCHITECTURE §11 (no `apps/edge/` fiction; domain may import `@hospai/contracts`; PropertyDO stays until named extract trigger). Q16 idempotency table + AGENTS pointer. Q21 comment fixes. N14 tenant-active decisions with code comments.
9. **FRONT_DESK_LIST_SELECT:** Extract shared column list; wire `listArrivals`, `listDepartures`, `listInHouse`, `selectFrontDeskReservationSync`, and reservation search exact-match read (mechanical).
10. **N13:** Add DLQ-depth assertion to an existing event/outbox suite that should drain cleanly.
11. **N14 supply-chain:** Tree has **9 high** `pnpm audit` findings (2026-09-05) — **document gap**; **do not** add blocking CI step until green.
12. **Out:** N11 sweep; X4 invites; delete `@hospai/temporal-utils`; CodeQL; Playwright; PropertyDO split; restyle.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **L6 command** | `reservations.early_depart` — **not** a silent `tryCheckOut` change. Catalog: `lane: INTERACTIVE`, `degraded: FAIL_CLOSED`, `idempotent: true`, `entitlement: pms.core`, events: `reservation.modified`, `availability.changed`. Status stays `checked_in` (no `reservation.status_changed` unless you emit modify-only — **lock: no status event**). |
| **L6 HTTP** | `post_reservation_early_depart`, `POST /v1/properties/:propertyId/reservations/:reservationId/early-depart`, `permission: reservations:write`, `entitlement: pms.core`. Append after `post_reservation_check_out` in `V1_ROUTES` / audit. |
| **L6 inventory** | Stay nights `[arrival, departure)`. New `departure_date = readBusinessDateSync()`. Release `sold` for `[businessDate, oldDeparture)` via existing `releaseSoldNightsSync`. Guest remains `checked_in`. |
| **L6 gates** | Only when `status === 'checked_in'` **and** `departureDate > businessDate`. Else `not_early_departable` → **422** via `commandErrorHttpStatus`. |
| **L6 idempotency** | Same as check-out: **`x-idempotency-key`** via `requireIdempotencyHeader`. Empty/absent JSON body is OK (`readOptionalJsonBody` if needed — **do not** wrap empty as `invalid_body`). Payload hashed **and** sent to the DO is `{ reservationId }` only. DO resolves `businessDate` inside `transactionSync`. User-scoped key at DO (existing). |
| **L6 HTTP handler** | `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. Same invoke/finish pattern as `handlePostReservationCheckOut`. |
| **L6 SPA** | Folio: **Early depart** when `departureDate > businessDate` and `checked_in`. `ConfirmDialog` (`.app-modal`). Success: invalidate **`['folio', propertyId, reservationId]`**, **`['board']` prefix**, and tape keys via `frontDeskTapeQueryKey(propertyId, from, to)` when mounted context known — match checkout invalidation in `FolioScreen.tsx` (~778–782). **Do not** chain checkout. Keep U17 Alert for checkout path. |
| **L6 tests** | Characterization **first**: in-house + future departure → checkout alone **does not** drop `sold` on remaining nights; `early_depart` does; then checkout succeeds. |
| **L9** | `opening_float + COALESCE(SUM(fl.ledger_amount_minor), 0)` for `payment.shift_id = ? AND tender_type = 'CASH' AND status = 'captured'`, join `folio_line fl ON fl.payment_id = payment.payment_id AND fl.charge_code = 'PAYMENT'`. Sign: capture lines are negative — sum **abs** or negate consistently with today's opening-float math (verify against `cashiering.spec.ts`). |
| **L10** | Count unattributed CASH captured where `shift_id IS NULL` and linked PAYMENT line's `business_date = ?` (use `resolvePostingBusinessDateSync` semantics already on cash post). |
| **L11** | Replace `Math.round(refundTxn * ledgerRatio)` in `applyPaymentEventSync` partial refund path (~16210). Split **remaining ledger** with `allocate(remainingLedger, [refundTxn, leftoverTxn], { policy: 'LAST' })` when leftover txn > 0; if leftover txn is 0, the slice takes **all remaining ledger**. Do **not** `allocate(refundTxn, [ledger])` (single weight returns the txn amount). |
| **L13** | New wire code `ooo_beyond_horizon`. Pre-check all nights in `[startDate, endDate)` (release: skip). **Reject** if any night has no row. Remove silent `continue` for `d > horizonEnd` in add path — rejection happens **before** `applyBlockedDeltaSync`. |
| **Q12** | Two sites only: `event-consumer.ts` projection `free`, `v1-dispatch.ts` DO fallback `free`. KV hit path uses stored `free` from projection (already computed at write — fix writer). |
| **B3** | `handlePatchReservation`: optional `noPost?: boolean` in body + fingerprint + `commandPayload`. **Not** `handlePatchGuest`. SPA continues front-office path only. |
| **N14 routes** | `get_property_availability` → **`resolvePropertyContext` + `assertTenantActive`** (via helper). `get_property` / `get_registry_property` may skip tenant-active **only** as bootstrap/registry reads — **comment why** in handler. |
| **N13** | Extend `events-queue.spec.ts` (or `event-log-replay.spec.ts` if it drains) with post-run DLQ depth === 0 (or bounded) assertion. |
| **N14 audit CI** | `pnpm audit --audit-level high` is **red** today (9 high, e.g. `nanoid` via vitest/vite) — document in spec + ARCHITECTURE/AGENTS footnote; **no** new blocking job in this vertical. |
| **X4** | **Do not touch** invite files. |
| **N11** | Outbox/idempotency TTL sweep — **out of scope** (ARCHITECTURE §10.1). |
| **temporal-utils** | Package unused — **do not delete** this slice. Spec note: next date-heavy work must import it or a dedicated slice deletes it. |
| **Q22** | `preparePiiRecord` dead params **removed in R0.13**. Remaining dead exports: delete only if grep shows **zero production importers**. SPA: prefer **`.ui-stack`** one-file rename if mechanical; else document `.stack` as remaining. `@hospai/observability` `"test": "echo ok"` **stays**. |
| **Pins in** | `COMMAND_CATALOG` **90**, `V1_HTTP_ROUTE_AUDIT` **145** last id `post_reservation_early_depart`, `AUDIT_WRITER_COMMAND_IDS` includes `reservations.early_depart` (same class as `reservations.modify`). `PROPERTY_SCHEMA_HEAD` **34**, `ORG_SCHEMA_HEAD` **9**, `NIGHT_AUDIT_STEPS` **8**, `check:*` **17** unchanged. |
| **Roadmap** | Plan **last task** ticks **R0.14** and **R3.4** together (not in individual implementer commits unless plan says so). |
| **Verify** | `pnpm test:local` (8 shards, **never** `--` before `--shard`). |

---

## 1. Problem / evidence

### 1.1 L6 — No early-departure command (high product gap)

ARCHITECTURE §7.1 and AGENTS.md: **`sold` covers remaining nights through checkout**; releasing inventory inside `tryCheckOut` is forbidden. U17 (R0.11) warns clerks but cannot fix inventory.

```9668:9750:apps/pms-core/src/property-do.ts
  async tryCheckOut(
    ...
          this.ctx.storage.sql.exec(
            `UPDATE reservation SET status = 'checked_out', updated_at = ? WHERE reservation_id = ?`,
            now,
            input.reservationId,
          );
          // No releaseSoldNightsSync — correct
```

`tryModifyReservation` can shorten a stay before check-in (releases sold on date change) but is **not** the in-house early-departure desk procedure and does not match the locked “business date = new departure, stay checked_in” contract.

### 1.2 L9 — Shift expected cash ignores FX ledger leg

```16436:16444:apps/pms-core/src/property-do.ts
  private computeShiftExpectedCashSync(shiftId: string, openingFloat: number): number {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment
         WHERE shift_id = ? AND tender_type = 'CASH' AND status = 'captured'`,
```

Cashiering spec §2.2 locks expected = opening + captured CASH on shift. Multi-currency spec: balances and shift reconciliation must use **ledger** amounts when txn currency ≠ ledger ([cashiering §2.2](./2026-08-07-cashiering-design.md), [multi-currency §3](./2026-08-13-multi-currency-folio-design.md)).

### 1.3 L10 — Unattributed cash counted in UTC wall date

```16422:16433:apps/pms-core/src/property-do.ts
  private countUnattributedCashForBusinessDateSync(businessDate: string): number {
    ...
           AND date(created_at / 1000, 'unixepoch') = ?`,
```

Violates AGENTS.md: cashier dates use **property business date**, not UTC `date(created_at)`.

### 1.4 L11 — Partial FX refund uses `Math.round`

```16206:16210:apps/pms-core/src/property-do.ts
      const ledgerRatio =
        Math.abs(capture.amount_minor) > 0
          ? Math.abs(capture.ledger_amount_minor) / Math.abs(capture.amount_minor)
          : 1;
      const ledgerRefundMinor = Math.round(refundTxn * ledgerRatio);
```

Partial-refunds spec and multi-currency: use **`allocate` LAST** for split legs; no float drift across partials.

### 1.5 L13 — OOO silently skips nights beyond horizon

```6681:6683:apps/pms-core/src/property-do.ts
    for (const d of nightsToAdd) {
      if (d < openDate) throw new OooInvalidRangeError();
      if (d > horizonEnd) continue;
```

Nights beyond `horizonEnd` are **skipped** — no `blocked` increment, no error. Availability reads show “no row” → can look bookable. AGENTS.md: OOO past horizon must **reject or extend** — this slice **rejects** (`ooo_beyond_horizon`).

### 1.6 Q12 — Inlined `freeAvailability`

```287:287:apps/pms-core/src/event-consumer.ts
      free: row.physical - row.blocked - row.held - row.sold + row.oversell,
```

```8272:8274:apps/pms-core/src/v1-dispatch.ts
      free:
        row.free ??
        row.physical - row.blocked - row.held - row.sold + row.oversell,
```

Canonical helper: `packages/contracts/src/availability.ts`.

### 1.7 B3 — HTTP PATCH omits `noPost`

DO `tryModifyReservation` fingerprint comment already includes `noPost?` (~8815); `applyNoPostIfPresentSync` exists. HTTP handler (~1864–1901) omits `noPost` from body, fingerprint, and payload.

### 1.8 N14 — Routes skip tenant-active

- `handleGetProperty` (~759): `resolvePropertyFromRegistry` only — no `assertTenantActive`.
- `handleGetRegistryProperty` (~788): global registry read — bootstrap.
- `handleGetAvailability` (~8160): no `resolvePropertyContext` — uses `resolvePropertyFromRegistry` on DO fallback branch.

**Lock:** availability GET must go through `resolvePropertyContext` / `assertTenantActive`. Property GET / registry GET may skip with **comment** (bootstrap / degraded partial read).

---

## 2. L6 — `reservations.early_depart`

### 2.1 Command contract

| Field | Value |
|---|---|
| `id` | `reservations.early_depart` |
| `lane` | `INTERACTIVE` |
| `degraded` | `FAIL_CLOSED` (inventory) |
| `idempotent` | `true` |
| `entitlement` | `pms.core` |
| `permission` | `reservations:write` |
| `events` | `reservation.modified`, `availability.changed` |

**DO method:** `tryEarlyDepart(actor, { reservationId }, idem)` (name aligned with `tryCheckOut` / `tryCheckIn`).

**Transaction (single `transactionSync`):**

1. Load reservation: `status`, `room_type_id`, `arrival_date`, `departure_date`.
2. `businessDate = readBusinessDateSync()`; fail `business_date_unset` if missing.
3. If `status !== 'checked_in'` OR `departure_date <= businessDate` → `{ ok: false, error: NOT_EARLY_DEPARTABLE }`.
4. `nightsToRelease = enumerateDaysHalfOpen(businessDate, oldDeparture)` — same helper family as modify/cancel (nights `[businessDate, oldDeparture)`).
5. `releaseSoldNightsSync(room_type_id, nightsToRelease)` (existing — throws `ledger_inconsistent` if row missing/sold&lt;1).
6. `UPDATE reservation SET departure_date = ?, updated_at = ?` with `businessDate`.
7. Outbox: `reservation.modified` (include before/after departure), `availability.changed` for affected room type + date span (match modify pattern).
8. **Do not** change `status`, `room_id`, folio, or auto-checkout.

**Idempotency:** Same `{ reservationId }` fingerprint + client key replay returns the cached success without double-release (`runIdempotent`). A **new** key after apply → `not_early_departable`.

**Wire code:** Add `NOT_EARLY_DEPARTABLE = 'not_early_departable'` to `@hospai/contracts` idempotency exports; map to **422** in `commandErrorHttpStatus`.

### 2.2 HTTP

| Item | Value |
|---|---|
| Route id | `post_reservation_early_depart` |
| Method / path | `POST /v1/properties/:propertyId/reservations/:reservationId/early-depart` |
| Body | None required. Optional empty JSON OK. **No** extra fields. |
| Handler | Mirror `handlePostReservationCheckOut`: `requireIdempotencyHeader` + `resolvePropertyContext` |

**Fingerprint (same object sent to the DO):**

```typescript
const commandPayload = { reservationId };
await commandFingerprint('reservations.early_depart', commandPayload);
```

**Implementation lock:** HTTP does **not** pre-read business date. DO `tryEarlyDepart(actor, { reservationId }, idem)` resolves `businessDate` inside `transactionSync`. Client sends **`x-idempotency-key`** only (same as `api.checkOut`).

**Q16:** `post_reservation_early_depart` uses header **`x-idempotency-key`**, matching check-in / check-out / no-show / cancel-check-in. Do **not** invent JSON `idempotencyKey` for this sibling.

### 2.3 Catalog / audit pins

Same commit must update:

- `packages/contracts/src/commands/catalog.ts` — append entry.
- `packages/contracts/src/v1-http-routes.ts` — append after `post_reservation_check_out`.
- `packages/contracts/src/commands/audit-writers.ts` — add `reservations.early_depart` (`reservations.modify` already in set; `reservations.check_out` is not).
- `packages/contracts/src/register.test.ts` — length **90**, route **[144] = post_reservation_early_depart**, audit writer set size **+1**.
- `scripts/permissions-check.mjs` — picks up `V1_ROUTES` automatically.

### 2.4 SPA (Folio)

**When shown:** `status === 'checked_in'` AND `departureDate > businessDate` (same predicate as U17 warning).

**UX:**

- Primary-adjacent action **Early depart** (secondary `Button`, not destructive).
- `ConfirmDialog`: explain shortening stay to tonight / business date; inventory on remaining nights will be released; guest stays in-house until checkout.
- On success: toast via `classifiedUserMessage`; invalidate folio + board + tape keys (see lock table).
- **Keep** U17 informational Alert on checkout — clerk may still checkout same day after early depart (departure === businessDate → warning hidden).

**Client:** Add `api.earlyDepart(propertyId, reservationId, opId)` in `@hospai/client-core` — POST with **`x-idempotency-key`** (copy `api.checkOut` header pattern).

### 2.5 Tests (characterization first)

**File:** `apps/pms-core/test/reservations-early-depart.spec.ts` (new).

| # | Scenario |
|---|---|
| 1 | Book 3-night stay, check in, assert `sold` on all nights. |
| 2 | `tryCheckOut` without early depart → `sold` unchanged on nights ≥ businessDate+1 (or future nights). |
| 3 | `tryEarlyDepart` → `departure_date === businessDate`, `status === 'checked_in'`, `sold` released on `[businessDate, oldDeparture)`. |
| 4 | `tryCheckOut` after early depart → success, status `checked_out`. |
| 5 | Idempotency replay → no double release. |
| 6 | `not_early_departable`: not checked_in; departure already ≤ businessDate. |
| 7 | HTTP route: tenant context, `x-idempotency-key` required, 422 on `not_early_departable`. |

Extend `FolioScreen.test.tsx`: Early depart button visible when predicate true; confirm calls API; invalidates keys (mock spy).

---

## 3. L9 — Shift expected cash (ledger currency)

**Replace** `SUM(amount_minor)` with ledger sum:

```sql
SELECT COALESCE(SUM(ABS(fl.ledger_amount_minor)), 0) AS total
FROM payment p
JOIN folio_line fl ON fl.payment_id = p.payment_id AND fl.charge_code = 'PAYMENT'
WHERE p.shift_id = ?
  AND p.tender_type = 'CASH'
  AND p.status = 'captured'
```

Verify sign convention against existing `cashiering.spec.ts` (payment lines negative). Expected cash = `opening_float + total` (adjust negation if tests show opposite).

**Test:** Extend `apps/pms-core/test/cashiering.spec.ts` — foreign-currency cash capture (or mixed FX cash if fixture exists): expected cash uses **ledger** amount, not txn face.

---

## 4. L10 — Unattributed cash business date

**Replace** UTC filter with folio posting date:

```sql
SELECT COUNT(*) AS n
FROM payment p
JOIN folio_line fl ON fl.payment_id = p.payment_id AND fl.charge_code = 'PAYMENT'
WHERE p.tender_type = 'CASH'
  AND p.status = 'captured'
  AND p.shift_id IS NULL
  AND fl.business_date = ?
```

**Test:** Cash post near UTC midnight but property business date D vs D+1 — count attributes to **business date** on line, not UTC day.

---

## 5. L11 — Partial FX refund allocation

In partial refund branch of `applyPaymentEventSync`:

```typescript
import { allocate } from '@hospai/money'; // existing pattern in split paths

const leftoverTxn = remainingTxn - refundTxn;
const ledgerRefundMinor =
  leftoverTxn === 0
    ? remainingLedger
    : allocate(remainingLedger, [refundTxn, leftoverTxn], { policy: 'LAST' })[0]!;
```

`remainingTxn = capturedBase - refundedBase`. `remainingLedger` = abs(capture ledger) minus abs(sum of prior PAYMENT_REFUND ledger lines for this capture). Last slice (`leftoverTxn === 0`) takes **all remaining ledger** so partials sum exactly.

**Test:** `apps/pms-core/test/folio-fx-payments.spec.ts` or new case — partial refund of mixed FX capture; sum of refund ledger lines + remainder = capture ledger remaining; no off-by-one vs `Math.round`.

---

## 6. L13 — OOO beyond horizon

**Before** `applyBlockedDeltaSync` in `trySetOooRange`:

```typescript
for (const d of newNights) {
  const row = /* SELECT 1 FROM availability_day WHERE room_type_id = ? AND stay_date = ? */;
  if (!row) throw new OooBeyondHorizonError(d); // wire: ooo_beyond_horizon, 422
}
```

Remove/add-path `if (d > horizonEnd) continue` — rejection replaces silent skip.

**Test:** Extend `apps/pms-core/test/rooms-ooo.spec.ts` — OOO range extending past horizon → `{ ok: false, error: 'ooo_beyond_horizon' }`; no blocked delta on far nights.

---

## 7. Q12 — `freeAvailability` import

| File | Change |
|---|---|
| `apps/pms-core/src/event-consumer.ts` | `import { freeAvailability } from '@hospai/contracts'`; `free: freeAvailability(row)` |
| `apps/pms-core/src/v1-dispatch.ts` | Same import; fallback `free: row.free ?? freeAvailability(row)` |

Optional unit assertion in existing `availability.test.ts` or event-consumer test: inline === helper.

---

## 8. B3 — Reservation PATCH `noPost`

Extend `handlePatchReservation`:

- Body type: `noPost?: boolean`
- Fingerprint + `commandPayload`: spread `...(body.noPost !== undefined ? { noPost: body.noPost } : {})`
- DO already handles in `tryModifyReservation`

**Test:** HTTP or DO — PATCH with `noPost: true` sets `reservation.no_post`; fingerprint includes flag.

**Out:** `handlePatchGuest` — no change.

---

## 9. FRONT_DESK_LIST_SELECT

Extract module-level constant in `property-do.ts` (or `modules/pms/reservations` if already split — **prefer property-do** to minimize churn):

```typescript
const FRONT_DESK_LIST_SELECT = `reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
  adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id`;
```

Replace duplicated SELECT strings in:

- `listArrivals` (~10421)
- `listDepartures` (~10486 area)
- `listInHouse` (~10557 area)
- `selectFrontDeskReservationSync` (~11193)
- Reservation search exact match (~10611 local `frontDeskSelect`)

Mechanical substitution — no column changes.

---

## 10. Architecture & documentation write-down

### 10.1 ARCHITECTURE §11 amendments

- Remove or strike **`apps/edge/`** from layout diagram (~1740) — routing lives in `apps/pms-core` worker; note wrangler entry.
- State explicitly: **`modules/pms/*/domain` may import `@hospai/contracts`** (types, wire codes, `freeAvailability`); index-only prohibition was inaccurate.
- **PropertyDO extraction:** PropertyDO remains the reservations/folio/rates module in the Worker until a **named** trigger in ARCHITECTURE — do not extract in R0.14.

### 10.2 Q16 — Idempotency key placement

Add table to this spec; one-line pointer in AGENTS.md §1 idempotency bullet.

| Routes (representative) | Key location |
|---|---|
| `patch_reservation`, `post_folio_*`, roster writes, domain config | JSON `idempotencyKey` |
| `post_reservation_check_in`, `post_reservation_check_out`, `post_reservation_no_show`, `post_reservation_cancel_check_in` | Header **`x-idempotency-key`**; optional JSON extras |
| **`post_reservation_early_depart`** | Header **`x-idempotency-key`** (same family as check-out) |
| Some org routes | Header or query per handler — grep `requireIdempotencyHeader` vs `body.idempotencyKey` when implementing |

First-party `@hospai/client-core` must match each route (add `earlyDepart` with **header** key like `checkOut`).

### 10.3 Q21 — Comment fixes

| Location | Fix |
|---|---|
| `packages/contracts/src/idempotency.ts` ~197 | Comment says “never call from a DO” on `canonicalJson` / `fingerprintPayload`; `property-do.ts` calls `fingerprintPayload` for capture fingerprints (~17967). Revise to: **prefer `commandFingerprint` at HTTP edge; DO may call `fingerprintPayload` only for nested event payloads where catalog fingerprint is N/A** — or extract shared helper name that does not claim “never DO”. |
| `packages/do-runtime/src/property-migrations.ts` ~1 | Header “Phase 0 freeze-gate DDL” at v34 — amend to **“Historical Phase 0 freeze-gate statements; PROPERTY_SCHEMA_HEAD = 34”**. |

### 10.4 Q22 — Remaining hygiene

- Grep production imports for `mapCommandEntitlement`, `mergeContext`, `killKvKey`, `generatePiiKeyId` — delete exports only if zero production importers.
- SPA `.stack` in `styles.css` (~576): if only legacy uses remain, migrate callers to `.ui-stack` in one file or document as deferred.
- `@hospai/temporal-utils`: zero imports — note in ARCHITECTURE §11 “unused package; next date slice imports or deletes”.
- `@hospai/observability` test echo — **no change**.

### 10.5 N14 — Tenant-active (code comments)

| Handler | Action |
|---|---|
| `handleGetAvailability` | Use `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` before DO/KV; fail closed on inactive tenant. |
| `handleGetProperty` | Keep registry path; add comment: **bootstrap/degraded partial — tenant-active intentionally skipped; orgId from registry row**. |
| `handleGetRegistryProperty` | Comment: **global registry lookup for routing/bootstrap — no property DO sync**. |

---

## 11. N13 — DLQ depth assertion

Extend `apps/pms-core/test/events-queue.spec.ts` (preferred — already documents DLQ behavior ~295):

After a test flow that drains the outbox/queue successfully, assert DLQ depth **0** (or `env.EVENT_LOG_DLQ` list length 0) — cheap guard against “684 moves ignored as green”.

If harness lacks DLQ binding, assert consumer ack count / no terminal DLQ write in mock — match existing test patterns.

---

## 12. N14 — Supply chain

**2026-09-05 tree:** `pnpm audit --audit-level high` reports **9 high** (e.g. `nanoid` ← vitest/vite, `js-yaml` ← eslint). **Do not** add blocking CI step in R0.14.

**Document** in AGENTS.md §5 or ARCHITECTURE footnote: supply-chain gate deferred until audit clean; track as follow-up.

---

## 13. Out of scope (explicit)

| Item | Reason |
|---|---|
| N11 outbox/idempotency sweep | ARCHITECTURE §10.1 not landed |
| X4 invite enum collapse | Do not touch invite files |
| Delete `@hospai/temporal-utils` | Locked defer |
| Auto-extend availability horizon for OOO | Rejected — L13 reject only |
| Auto-chain checkout after early depart | Rejected — L6 lock |
| `tryCheckOut` sold release | Forbidden §7.1 |
| Guest PATCH `noPost` | SPA uses front-office |
| Playwright / Redis / PropertyDO split / token restyle | AGENTS.md |
| Schema migration | PROPERTY 34 / ORG 9 unchanged |
| R1.16 cashier SPA rebuild | R0.14 honesty only (L9/L10 may suffice) |

---

## 14. Implementation task order (for plan writer)

1. **Characterization tests** — L6 early depart + checkout sold invariant (fail first).
2. **L6** — DO command, catalog, HTTP, audit writer, client API, Folio SPA.
3. **L9 + L10** — cashier sync SQL + tests (`cashiering.spec.ts`).
4. **L11** — refund allocate + FX test.
5. **L13** — OOO horizon reject + test.
6. **Q12** — freeAvailability imports.
7. **B3** — PATCH `noPost`.
8. **FRONT_DESK_LIST_SELECT** — extract constant.
9. **N13** — DLQ assertion.
10. **Docs** — ARCHITECTURE §11, AGENTS Q16 pointer, Q21 comments.
11. **N14** — tenant-active on availability GET + handler comments.
12. **Q22** — dead export grep / `.ui-stack` if mechanical.
13. **Verify** — `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`.
14. **Roadmap** — plan last task ticks **R0.14** + **R3.4**.

---

## 15. Verification checklist (reviewer)

- [ ] `COMMAND_CATALOG.length === 90`; new id `reservations.early_depart`.
- [ ] `V1_HTTP_ROUTE_AUDIT[144].id === 'post_reservation_early_depart'`; length **145**.
- [ ] `AUDIT_WRITER_COMMAND_IDS` contains `reservations.early_depart`.
- [ ] `PROPERTY_SCHEMA_HEAD === 34`; no new migration.
- [ ] `tryCheckOut` diff has **no** `releaseSoldNightsSync`.
- [ ] Early depart: `x-idempotency-key`; fingerprint payload `{ reservationId }` only (same object sent to DO).
- [ ] L9/L10 SQL uses `ledger_amount_minor` / `folio_line.business_date`.
- [ ] L11 uses `allocate` LAST — no `Math.round` on ratio.
- [ ] L13 `ooo_beyond_horizon` — no silent horizon skip.
- [ ] `freeAvailability` imported in both Q12 sites.
- [ ] `patch_reservation` passes `noPost` when present.
- [ ] Folio Early depart + U17 coexist; no auto checkout.
- [ ] `get_property_availability` uses `resolvePropertyContext`.
- [ ] DLQ depth test added.
- [ ] `pnpm audit --audit-level high` documented as gap — **not** blocking CI.
- [ ] 17 `check:*` scripts unchanged count.
- [ ] `pnpm test:local` green (8 shards, no `--` before `--shard`).

---

## 16. Related specs (do not rewrite)

| Spec | Relationship |
|---|---|
| [Cashiering](./2026-08-07-cashiering-design.md) | L9/L10 harden §2.2 expected cash + unattributed overlay |
| [Multi-currency folio](./2026-08-13-multi-currency-folio-design.md) | L11 allocate; L9 ledger columns |
| [Partial refunds](./2026-08-14-partial-refunds-design.md) | L11 partial ledger leg |
| [Room operations HK](./2026-08-12-room-operations-hk-completion-design.md) | L13 extends OOO; do not rebuild `set_ooo_range` |
| [Operator SPA U17](./2026-09-05-operator-spa-ux-ui-design.md) | Warning stays; Early depart is additive |
| [Reservations lifecycle](./2026-08-12-reservations-lifecycle-completion-design.md) | Checkout/in-house rules; early depart is new command |

---

*Spec writer: do not commit. Plan writer: derive tasks from §14. Implementer: follow AGENTS.md pins and characterization-first for L6/L11.*
