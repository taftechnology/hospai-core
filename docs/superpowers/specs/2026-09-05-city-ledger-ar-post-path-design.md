# City ledger AR post path hardening (R0.3)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 3](../../audit/2026-09-04-full-codebase-audit.md) (**L1**, **L2**, **L3**, **L4**, **U8**, **G2**, **G10**); [City ledger / AR (shipped)](./2026-08-15-city-ledger-ar-design.md) (aggregate, `postCityLedgerChargeSync`, close hook — this slice **hardens** posting, does not rebuild CRUD/SPA); [Folio money operations](./2026-08-12-folio-money-operations-design.md) (`folio.transfer_charge`, append-only transfer); [AGENTS.md §2 money/inventory](../../../AGENTS.md) (COMPANY AR on transfer/checkout, folio transfer invariants, integer minor units); `apps/pms-core/src/property-do.ts` (`postCityLedgerChargeSync` ~19453, `tryCloseFolioWindow` ~14597, `transferFolioLineSync` ~15506, `tryTransferCharge` ~15675, `tryCheckOut` ~9662, `postedReceivableMinorSync` ~19441); `apps/pms-core/test/city-ledger.spec.ts` (`setupCompanyWindowAtZeroBalance` ~36); `apps/web-pms/src/screens/FolioScreen.tsx` (transfer toast ~844); `scripts/smoke-staging.mjs`.

**Closes:** Audit **L1** (AR never posts on desk path), **L2** (double transfer / same source on two COMPANY windows), **L3** (reopen leaves AR stuck), **L4** (transfer restamps tax), **U8** (transfer toast lies about city ledger), **G2** (tests encode zero-balance-only path), **G10** (smoke has no COMPANY/AR assertion). **Roadmap:** **R0.3**. **Requires:** city ledger vertical shipped ([2026-08-15 spec](./2026-08-15-city-ledger-ar-design.md)). **Does not** advance R0.1/R0.2, L5/L6, provision, guest-list SQL, or Playwright.

---

## Executive summary

City ledger CRUD, aging, statements, and the **close-at-zero hook** are shipped, but the **desk direct-bill path never posts AR**: `tryCloseFolioWindow` rejects any non-zero balance with `WINDOW_BALANCE_DUE` (~14614) **before** `postCityLedgerChargeSync` (~14617), and desk payments net the **GUEST** window — a COMPANY receivable cannot be zeroed from the desk. `postCityLedgerChargeSync` (~19469–19478) short-circuits forever when a charge row exists, so reopen + more charges leaves AR stuck at the first close amount (**L3**). Transfers use deterministic dest ids (~15537) with no “already transferred” guard (**L2**) and restamp tax via `stampTaxForChargeSync` (~15613) instead of copying amounts (**L4**). FolioScreen always toasts “Charge transferred.” (~844) even when no AR row exists (**U8**).

This spec locks a **sync-to-receivable** AR model: **primary trigger** — post/adjust city-ledger AR when a charge **transfers into a COMPANY window** for that window’s current `postedReceivableMinorSync`; **catch-up** — same sync at **checkout** (guest window still gates checkout — **B1** unchanged) and existing night-audit catch-up for already-**CLOSED** windows. **Do not** require `balance === 0` before the first AR post. Keep the stable **charge** row per window; later deltas use **`adjustment`** entries. **No new catalog command** — extend private sync helpers called from transfer, close, checkout, and night audit. **Prefer no PropertyDO migration** — posted AR tracked by querying `city_ledger_entry` (charge + adjustments per `folio_window_id`). Characterization tests land **first** and must fail on current `main`.

---

## Locked product call

1. **Close-at-zero cannot be the AR gate for a COMPANY receivable window.** Post city-ledger charge when the COMPANY window is **transferred into** and/or when the stay **checks out**, for the current posted receivable. Pick one primary trigger and use the other as catch-up; do not require `balance === 0` before the first AR post.
2. Keep a stable charge id for the **first** post of that window.
3. **L3:** reopen must not leave AR stuck at the first close amount. Add a **delta / adjustment** city-ledger entry on later close, not a second identical charge and not a silent `alreadyPosted` skip that drops new charges.
4. **L2:** reject transfer if the source line already has a `TRANSFER_REVERSAL` (already transferred). Destination id must not allow the same source onto two COMPANY windows.
5. **L4:** on transfer, **copy existing tax amounts** (same as split `allocate`). Do **not** reverse TAX and `stampTaxForChargeSync` at today’s rules.
6. **U8:** until AR actually posts, toast must not imply city ledger was updated. After the post path exists: “Charge transferred” is honest only if the post ran; otherwise “Moved to company folio”.
7. **Keep** `setupCompanyWindowAtZeroBalance` as a **hook unit** (close-when-zero). **Add** the desk path beside it: transfer ROOM to COMPANY, then close or checkout, then `readCityLedgerAccount` shows the charge.
8. **G10:** after the named post path exists, extend `smoke-staging.mjs` with **one** COMPANY transfer + close (or checkout) assertion. Keep the rest short. No Playwright. No night audit in smoke.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Primary AR trigger** | Sync city-ledger AR **on transfer into a COMPANY window** for that window’s current receivable (`postedReceivableMinorSync`, integer minor units). |
| **Catch-up** | Same sync at **checkout** (guest window still gates checkout — B1 stays) for COMPANY windows that never went through transfer; night-audit catch-up for already-**CLOSED** windows **may remain**. |
| **Close-at-zero** | **Do not** require `balance === 0` for the first AR post on COMPANY windows. GUEST / MASTER close rules unchanged. |
| **L3** | Track posted AR per window by **querying** charge + adjustment rows (or equivalent). Reopen + more charges + close/checkout posts a **delta** `adjustment`, not skip-forever on “charge already exists”, not a duplicate charge. Stable `entry_id` for the **first** charge. |
| **L2** | Named **422** if source already has `TRANSFER_REVERSAL` or destination would attach the same source to a second COMPANY window. Existing `commandErrorHttpStatus` table — **no fifth mapper**. |
| **L4** | Copy existing tax amounts on transfer (same pattern as `splitFolioLineSync` ~14915–14945). Remove dest `stampTaxForChargeSync` (~15613). |
| **U8** | FolioScreen transfer success copy via mutation response / Alert — honest after post path exists. |
| **G2** | Do **not** invert `setupCompanyWindowAtZeroBalance` into the only close path. Add desk-path characterization beside hook tests. |
| **Money** | Integer minor units; `allocate` when splitting tax across dest lines. Guest checkout uses guest window only. |

---

## 1. Problem / evidence

### 1.1 L1 — AR never posts on desk path (critical)

**Close gate blocks COMPANY receivable:**

```14604:14614:apps/pms-core/src/property-do.ts
          const balance = this.windowBalanceMinorSync(input.folioWindowId);
          if (window.kind === 'GUEST') {
            // … checked_out / cancelled / no_show gate …
          }
          if (balance !== 0) throw new FolioWindowError(WINDOW_BALANCE_DUE);

          if (window.kind === 'COMPANY') {
            const postResult = this.postCityLedgerChargeSync({
```

Desk flow: clerk transfers ROOM (+ tax) from GUEST → COMPANY. COMPANY window balance = receivable (> 0). Close → **422 `window_balance_due`** before AR runs. Payments post to GUEST; COMPANY receivable is intentional direct bill.

**Checkout does not sync AR:**

```9807:9814:apps/pms-core/src/property-do.ts
          if (this.readConfigValueSync('pms.folio.close_window_on_check_out') === true && balanceMinor === 0) {
            const guestWindow = this.readFolioWindowRowSync(guestWindowId);
            if (guestWindow?.status === 'OPEN') {
              this.closeFolioWindowSync(guestWindowId, now, propertyId, input.reservationId);
            }
          }
```

`tryCheckOut` (~9662) gates on **guest** `windowBalanceMinorSync` only (B1 — correct) but never calls `postCityLedgerChargeSync` for OPEN COMPANY windows with receivable. `reservations-check-out-direct-bill.spec.ts` asserts checkout succeeds with company receivable but **does not** assert a city-ledger row (**G2** gap).

**Night-audit catch-up** (`postPendingCityLedgerChargesForBusinessDateSync` ~19532) only selects `status = 'CLOSED'` windows — useless when desk never closes COMPANY.

### 1.2 L3 — one charge per window forever

```19469:19478:apps/pms-core/src/property-do.ts
    const existing = this.ctx.storage.sql
      .exec(
        `SELECT entry_id FROM city_ledger_entry
         WHERE folio_window_id = ? AND kind = 'charge'
         LIMIT 1`,
        input.folioWindowId,
      )
      .toArray() as Array<{ entry_id: string }>;
    if (existing[0]) {
      return { ok: true, entryId: existing[0].entry_id, alreadyPosted: true };
    }
```

After first close posts $X, reopen + add charges + close again → `alreadyPosted: true`, AR stuck at $X.

### 1.3 L2 — same source → two COMPANY windows

`transferFolioLineSync` (~15537–15544) uses deterministic dest id `${sourceId}:xfer:${destWindowId}` and idempotently returns if **that** dest id exists — but does **not** reject when the source already has a `TRANSFER_REVERSAL` for a **different** destination. A line can land on two COMPANY windows; AR semantics break.

### 1.4 L4 — transfer restamps tax

After reversing source tax (~15577–15593), dest parent gets **new** tax via `stampTaxForChargeSync` (~15613–15628) at today’s rules. Split path **copies** tax with `allocate` (~14915–14945). Audit requires transfer = split tax behaviour.

### 1.5 U8 — dishonest toast

```843:845:apps/web-pms/src/screens/FolioScreen.tsx
    onSuccess: () => {
      setMessage('Charge transferred.');
```

No signal whether city ledger updated.

### 1.6 G2 — tests encode unreachable path

`setupCompanyWindowAtZeroBalance` (~36–85) inserts matching PAYMENT lines so close can reach `postCityLedgerChargeSync`. Hook tests (~504–724) are valid **unit** coverage but mask the desk path. Audit: keep helper; **add** transfer-then-close/checkout tests.

---

## 2. Locked behaviour

### 2.1 AR sync model (`syncCityLedgerArForWindowSync`)

Replace the “insert-or-skip” semantics of `postCityLedgerChargeSync` with a **private sync helper** (name locked for implementer) invoked from:

| Caller | When | `source` on new rows |
|---|---|---|
| `transferFolioLineSync` | After successful transfer **into** a `COMPANY` dest window | `'transfer'` on first charge; `'transfer'` on adjustment |
| `tryCloseFolioWindow` | Before `closeFolioWindowSync` when `window.kind === 'COMPANY'` | `'window_close'` |
| `tryCheckOut` | Inside same `transactionSync`, after reservation → `checked_out`, for each COMPANY window on stay with receivable | `'check_out'` |
| `postPendingCityLedgerChargesForBusinessDateSync` | Unchanged selection (CLOSED, no charge row) — may call sync for legacy rows | `'night_audit'` |

**Algorithm (sync, inside parent `transactionSync`):**

1. Resolve window; require `kind === 'COMPANY'`.
2. `targetMinor = postedReceivableMinorSync(folioWindowId)` (~19441) — sum of `ledger_amount_minor` where `charge_code != 'PAYMENT'`.
3. If `targetMinor <= 0`: return `{ ok: true, postedMinor: 0, arSynced: false }` (no negative AR from empty window).
4. Resolve active `city_ledger_account` from `billed_party` (existing `resolveCityLedgerAccountSync`).
5. `postedMinor = sum(amount_minor)` for rows where `folio_window_id = ?` and `kind IN ('charge', 'adjustment')`.
6. `deltaMinor = targetMinor - postedMinor`.
7. If `deltaMinor === 0`: return `{ ok: true, postedMinor, arSynced: false, alreadySynced: true }`.
8. Credit limit: `openBalanceMinor(accountId) + deltaMinor > credit_limit_minor` (when limit > 0) → throw `CityLedgerCreditLimitExceededError` (parent command fails; window stays OPEN).
9. If no `charge` row for window: **INSERT** `kind = 'charge'`, `amount_minor = targetMinor` (first post uses full receivable, not only delta — equivalent when `postedMinor === 0`). Stable `entry_id` from `crypto.randomUUID()`; partial unique index prevents duplicate charge.
10. Else if `deltaMinor !== 0`: **INSERT** `kind = 'adjustment'`, `amount_minor = deltaMinor` (signed integer — positive increases AR), `reference = charge.entry_id`, same `folio_window_id` / `reservation_id`.
11. Emit `city_ledger.charge_posted` on **first charge only** (preserve existing event contract); adjustments do not require a new event type this slice.

**First-post stable id:** the `charge` row’s `entry_id` never changes. Adjustments reference it via `reference`.

**Posted AR tracking:** `postedMinor` is always derived from SQL — **no new column**. If implementer needs a denormalized cache, that requires **v35 migration** and **must** bump `PROPERTY_SCHEMA_HEAD` in the same vertical; **prefer query-only (head stays 34).**

### 2.2 COMPANY window close (relax balance gate)

| Window kind | Close balance rule | AR |
|---|---|---|
| `GUEST` | Unchanged: terminal reservation status gate + **`balance === 0`** | No AR |
| `MASTER` | Unchanged: **`balance === 0`** | No AR |
| `COMPANY` | **Remove** `WINDOW_BALANCE_DUE` for non-zero receivable. Call `syncCityLedgerArForWindowSync` **before** `closeFolioWindowSync`. Close proceeds even when folio balance ≠ 0 (direct-bill receivable remains on folio by design). | Sync required for close to succeed when `targetMinor > 0` and account resolvable |

Credit-limit failure on sync → close fails with existing **422** `city_ledger_credit_limit_exceeded` (not `window_balance_due`).

Hook path (`setupCompanyWindowAtZeroBalance` nets to zero) **continues to work** — sync sees `targetMinor > 0`, posts charge, close succeeds.

### 2.3 Primary trigger — transfer into COMPANY

Inside `transferFolioLineSync`, after dest lines inserted, if dest window `kind === 'COMPANY'`:

```ts
const sync = this.syncCityLedgerArForWindowSync({
  folioWindowId: input.destinationFolioWindowId,
  source: 'transfer',
  actor: input.deskActor ?? { kind: 'system', reason: 'night_audit.auto_transfer' },
});
```

Return `arSynced: sync.arSynced && sync.postedMinor > 0` (or equivalent) to `tryTransferCharge` success payload for U8.

Night-audit auto-transfer reuses `transferFolioLineSync` — same AR sync on COMPANY dest.

### 2.4 Catch-up — checkout

Inside `tryCheckOut` `transactionSync`, **after** status → `checked_out`, **before** return:

```ts
for (const companyWindow of this.listCompanyWindowsForReservationSync(input.reservationId)) {
  this.syncCityLedgerArForWindowSync({
    folioWindowId: companyWindow.folioWindowId,
    source: 'check_out',
    actor,
  });
}
```

- Guest balance gate (~96716–96724) **unchanged** (B1).
- Does **not** auto-close COMPANY windows unless existing config says so (none today — out of scope).
- Checkout with company receivable **must** leave city-ledger posted ≥ receivable (characterization test).

### 2.5 L2 — transfer guards

Add preconditions in `tryTransferCharge` (before `transferFolioLineSync`):

| Check | Wire code | HTTP |
|---|---|---|
| Source line already has a child `TRANSFER_REVERSAL` with `split_of = sourceFolioLineId` | `line_already_transferred` (**new**) | **422** |
| Any existing dest `TRANSFER` line with `split_of = sourceFolioLineId` and `folio_window_id !== destinationFolioWindowId` | `line_already_transferred` | **422** |
| Idempotent replay: same source + same dest, dest line exists | Success, return existing ids (unchanged) | **200/201** |

Add to `packages/contracts/src/idempotency.ts`:

```ts
export const LINE_ALREADY_TRANSFERRED = 'line_already_transferred' as const;
```

Map in existing folio error branches in `v1-dispatch.ts` (~467 / ~652 / ~858 pattern) — **422**, not a new global mapper.

### 2.6 L4 — copy tax on transfer

In `transferFolioLineSync`, **replace** dest `stampTaxForChargeSync` block (~15613–15628) with split-class tax copy:

1. After dest parent line insert (~15596–15611), for each source `TAX` line (`tax_of = source.folio_line_id`):
2. Insert dest tax with **copied** `amount_minor` / `ledger_amount_minor` / `fx_rate` / `tax_rule_id` (mirror ~15577–15593 reverse + ~14927–14944 copy pattern).
3. Dest tax line id: `${tax.folio_line_id}:xfer:${destinationFolioWindowId}` (deterministic, idempotent with parent).

**Forbidden:** calling `stampTaxForChargeSync` on transfer dest parent.

**Test:** change tax rule rate after initial ROOM post; transfer → dest tax amount equals **source** tax amount, not restamped rate.

### 2.7 L3 — reopen delta

Flow:

1. Close COMPANY at receivable $X → charge row $X.
2. `tryReopenFolioWindow` → OPEN.
3. Add folio lines (+$Y).
4. Close again → sync computes `deltaMinor = Y` → **adjustment** +$Y, `reference` = charge `entry_id`.
5. `readCityLedgerAccount` open balance = $X + $Y.

**Forbidden:** returning `alreadyPosted: true` without adjustment when `targetMinor > postedMinor`.

### 2.8 U8 — FolioScreen copy

Extend `tryTransferCharge` / HTTP `post_folio_transfer` success body:

```ts
{ ok: true, reverseFolioLineId, destFolioLineId, cityLedgerSynced?: boolean }
```

`cityLedgerSynced === true` when dest window is `COMPANY` **and** sync inserted or confirmed charge/adjustment this txn (`arSynced` from §2.3).

FolioScreen `transferLine.onSuccess`:

| Condition | Message |
|---|---|
| `cityLedgerSynced === true` | `Charge transferred.` |
| Dest is COMPANY, sync did not run / zero receivable / account missing (should not happen on success path) | `Moved to company folio.` |
| Dest not COMPANY | `Charge transferred.` (folio-only move) |

Use existing `setMessage` / Alert pattern; no raw JSON errors.

### 2.9 G10 — smoke extension

After existing book → check-in flow, **before** guest check-out:

1. POST city-ledger account create.
2. POST folio window open (`kind: COMPANY`, `billedParty`).
3. POST folio transfer (ROOM line GUEST → COMPANY).
4. POST folio window close **or** rely on checkout catch-up (pick one in smoke — **close** is tighter).

Assert: GET city-ledger accounts (or detail) shows `openBalanceMinor > 0` matching transferred receivable.

Keep script short; **no** night audit, tape, Playwright.

---

## 3. Error + HTTP contract

| Wire code | HTTP | When |
|---|---|---|
| `line_already_transferred` | **422** | Second transfer of same source line (L2) |
| `city_ledger_credit_limit_exceeded` | **422** | AR sync would exceed limit (unchanged) |
| `city_ledger_account_not_found` | **404** | COMPANY window `billed_party` unresolved at sync |
| `city_ledger_account_archived` | **409** | Account archived at sync |
| `window_balance_due` | **422** | GUEST/MASTER close only — **not** COMPANY receivable |
| `transfer_cross_reservation` | **422** | Unchanged |
| `line_not_transferable` | **422** | Unchanged |

**No new HTTP route.** `post_folio_transfer` response shape extended with optional `cityLedgerSynced`.

---

## 4. Implementation steps

**Order: failing characterization tests on `main`, then production.**

### 4.1 Tests first (red on `main`)

**`apps/pms-core/test/city-ledger.spec.ts`**

- **Keep** all `setupCompanyWindowAtZeroBalance` hook tests unchanged (G2).
- **Add** `desk path: transfer ROOM to COMPANY then close posts AR without payment netting`:
  - Seed reservation + city ledger account + open COMPANY window.
  - Post ROOM on GUEST; transfer to COMPANY (non-zero COMPANY balance).
  - `tryCloseFolioWindow` → **ok** (not `window_balance_due`).
  - `readCityLedgerAccount` → `openBalanceMinor === receivable`.
- **Add** `reopen adds adjustment not stuck charge`:
  - Close at $X, reopen, add $Y, close → one `charge` + one `adjustment`; open balance $X+$Y.
- **Add** `checkout catch-up posts AR for open COMPANY window` (extends direct-bill spec expectations).

**`apps/pms-core/test/folio-transfer-split.spec.ts`**

- **Add** L2: second transfer of same source to different COMPANY window → `line_already_transferred`.
- **Add** L4: tax rule change after post → transferred tax matches source amounts.
- **Add** AR assertion on test 15: after GUEST→COMPANY transfer, `readCityLedgerAccount` shows posted receivable (includes tax).

**`apps/pms-core/test/folio-windows.spec.ts`**

- **Add** COMPANY close with non-zero balance succeeds when account exists (not `WINDOW_BALANCE_DUE`).

**`apps/pms-core/test/reservations-check-out-direct-bill.spec.ts`**

- **Extend** existing test (~67): after checkout, assert city-ledger charge row + `openBalanceMinor === receivableMinor` (today only asserts checkout ok).

**`apps/web-pms/src/screens/FolioScreen.test.tsx`** (if transfer mutation mocked)

- U8: when API returns `cityLedgerSynced: true` → “Charge transferred.”; when `false` + COMPANY dest → “Moved to company folio.”

### 4.2 PropertyDO (`property-do.ts`)

1. Add `postedArMinorForWindowSync(folioWindowId)` — sum charge + adjustments.
2. Refactor `postCityLedgerChargeSync` → `syncCityLedgerArForWindowSync` per §2.1; keep thin wrapper if night-audit call sites need it.
3. `tryCloseFolioWindow`: skip `WINDOW_BALANCE_DUE` for `COMPANY`; call sync before close.
4. `tryCheckOut`: COMPANY window catch-up loop §2.4.
5. `transferFolioLineSync`: L4 tax copy; call sync on COMPANY dest; return sync flag.
6. `tryTransferCharge`: L2 guards; propagate `cityLedgerSynced` in success.
7. Extend `city_ledger_entry.source` CHECK or allowlist in SQL/comments: `'transfer'`, `'check_out'` (TEXT column — no migration if unconstrained).

### 4.3 Contracts + dispatch

- `packages/contracts/src/idempotency.ts`: `LINE_ALREADY_TRANSFERRED`.
- `packages/contracts/src/command-error.ts`: include in folio error union if typed.
- `apps/pms-core/src/v1-dispatch.ts`: map `line_already_transferred` → 422 in folio handler block; forward `cityLedgerSynced` on transfer success JSON.

### 4.4 SPA

- `apps/web-pms/src/screens/FolioScreen.tsx`: U8 message branching (~843).
- `packages/client-core/src/api.ts`: type success body with optional `cityLedgerSynced` (no wire rename).

### 4.5 Smoke

- `scripts/smoke-staging.mjs`: G10 steps §2.9.

### 4.6 Test helpers (local only)

- Optional: `readCityLedgerPostedMinorForWindowForTest` — sum charge + adjustments for assertions (alongside `readCityLedgerChargeForWindowForTest` ~20446).

---

## 5. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `city-ledger.spec.ts` | ROOM on GUEST, COMPANY open | Transfer → close | AR charge; not `window_balance_due` |
| T2 | `city-ledger.spec.ts` | Hook helper close at $X | Reopen, +$Y, close | charge $X + adjustment $Y |
| T3 | `city-ledger.spec.ts` | COMPANY receivable, no close | Checkout | AR synced via `check_out` source |
| T4 | `folio-transfer-split.spec.ts` | Transfer once | Same source → 2nd COMPANY dest | **422** `line_already_transferred` |
| T5 | `folio-transfer-split.spec.ts` | ROOM+TAX, change tax rule | Transfer | Dest tax = source tax amounts |
| T6 | `folio-transfer-split.spec.ts` | Test 15 flow | Transfer | `readCityLedgerAccount.openBalanceMinor > 0` |
| T7 | `folio-windows.spec.ts` | COMPANY non-zero | Close | **ok**, window CLOSED |
| T8 | `reservations-check-out-direct-bill.spec.ts` | Direct bill receivable | Checkout | CL row + balance |
| T9 | `city-ledger.spec.ts` | Hook tests | — | Still green (G2) |
| T10 | `FolioScreen.test.tsx` | Mock transfer response | Success | Correct toast copy (U8) |
| T11 | regression | B1 guest balance tests | Checkout | Unchanged |

Tests **T1–T8, T10** must **fail on current `main`**.

---

## 6. Verify commands

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/city-ledger.spec.ts \
  test/folio-transfer-split.spec.ts \
  test/folio-windows.spec.ts \
  test/reservations-check-out-direct-bill.spec.ts
```

Optional SPA:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx
```

Full gate after implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** never put `--` before `--shard`.

Smoke (staging credentials required):

```bash
BASE=… CLERK_SESSION_JWT=… pnpm smoke:staging
```

---

## 7. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/property-do.ts` | `syncCityLedgerArForWindowSync`, close/checkout/transfer hooks, L2/L4 transfer |
| `apps/pms-core/src/v1-dispatch.ts` | `line_already_transferred` → 422; transfer response field |
| `packages/contracts/src/idempotency.ts` | `LINE_ALREADY_TRANSFERRED` |
| `packages/contracts/src/command-error.ts` | Union entry if needed |
| `apps/pms-core/test/city-ledger.spec.ts` | Desk path + reopen delta; keep hook helper |
| `apps/pms-core/test/folio-transfer-split.spec.ts` | L2, L4, AR on transfer |
| `apps/pms-core/test/folio-windows.spec.ts` | COMPANY non-zero close |
| `apps/pms-core/test/reservations-check-out-direct-bill.spec.ts` | CL assertion on checkout |
| `apps/web-pms/src/screens/FolioScreen.tsx` | U8 copy |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | U8 toast tests |
| `packages/client-core/src/api.ts` | Optional response typing |
| `scripts/smoke-staging.mjs` | G10 COMPANY transfer + AR assert |

**Not in scope:** new catalog entries, new HTTP routes, city ledger SPA rebuild, `COMMAND_CATALOG` / route audit length changes, night-audit step count, PropertyDO extraction, Playwright.

---

## 8. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** (unless implementer adds denormalized posted-AR column — **discouraged**; if added, bump head + migration + pin tests in **same** commit) |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

No new dispatched command. `folio.transfer_charge` and `folio.close_window` / `reservations.check_out` inherit idempotency; AR sync runs inside parent `transactionSync`.

---

## 9. Out of scope

- Rebuilding city ledger CRUD, statements, aging UI ([2026-08-15 spec](./2026-08-15-city-ledger-ar-design.md) — shipped)
- **L5** night-audit `RateMissingError` halt policy
- **L6** named early-departure / silent `sold` release on checkout
- R0.1 cross-tenant provision, R0.2 azp, guest-list SQL (S2)
- Extracting PropertyDO
- Playwright / Cypress e2e
- Requiring COMPANY window `balance === 0` for close (explicitly rejected)
- Cross-reservation folio transfer (still `transfer_cross_reservation`)

---

## 10. Success criteria

1. Desk path: transfer ROOM (+ tax) to COMPANY → close **or** checkout → `readCityLedgerAccount` shows posted receivable (**L1** closed).
2. Reopen + additional charges → adjustment delta; AR not stuck (**L3**).
3. Second transfer of same source line → **422** `line_already_transferred` (**L2**).
4. Transfer tax copied, not restamped (**L4**).
5. FolioScreen toast honest about city ledger update (**U8**).
6. `setupCompanyWindowAtZeroBalance` hook tests remain green beside desk tests (**G2**).
7. `smoke-staging.mjs` asserts COMPANY AR once (**G10**).
8. B1 tests green — guest window still gates checkout.
9. Catalog/route/schema pins unchanged (head **34** if query-only AR tracking).
10. `pnpm test:local` green.

---

## 11. Relationship to prior specs

[2026-08-15-city-ledger-ar-design.md](./2026-08-15-city-ledger-ar-design.md) shipped the aggregate, `postCityLedgerChargeSync`, close-at-zero hook, and night-audit catch-up. This slice **amends posting triggers and transfer/close semantics** only — it does not reopen account CRUD, HTTP `[141]–[145]`, or schema v33 tables.

[2026-08-12-folio-money-operations-design.md](./2026-08-12-folio-money-operations-design.md) §4 specified transfer tax **restamp**; **this spec supersedes §4.2 item 8 for L4** — copy tax like split. One-sentence pointer update is the **final implementation task**, not this spec writer’s job.

---

## 12. Schema head decision

**Default (locked):** **No migration.** Posted AR per window = `SUM(amount_minor)` over `city_ledger_entry` where `folio_window_id = ?` and `kind IN ('charge', 'adjustment')`. First charge protected by existing partial unique index `city_ledger_charge_window`. **`PROPERTY_SCHEMA_HEAD` stays 34.**

**If implementer adds** e.g. `folio_window.posted_ar_minor` or a side table: requires **v35** migration, `pnpm generate:ddl`, `migrate.test.ts` pin bump, purge inventory update — call out explicitly in PR; not required by this spec.
