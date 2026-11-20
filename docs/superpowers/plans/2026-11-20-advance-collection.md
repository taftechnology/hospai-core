# Advance collection (R4.25, advance half) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Ready for controller execution
>
> **Spec/plan writers do not commit.** This session forbids commits. Every step that would normally commit says **Do NOT commit — leave changes unstaged/uncommitted**. Work on `main`. No push. Do not stash/reset/checkout.

**Goal:** Ship the advance half of R4.25 — multi-row advance capture through existing folio payment commands, one SPA `AdvancePayments` on Book / stay / check-in / folio, night-audit `arrival_deposit_missing`, and characterization that pre-arrival payments already work — with numbered receipt explicitly out.

**Architecture:** Advances are ordinary GUEST-window payments via `folio.record_cash_payment`, `folio.record_upi_payment`, and the existing card authorize path. No new command, route, migration, or money model. SPA extracts the folio Cash/UPI *Take a payment* form into `AdvancePayments` (adds multi-row + Card + Retry), wires it at four surfaces, and reads the advance panel solely from `get_reservation_proforma` totals (quote-only before Book submit). Night audit gains one check id gated by `pms.booking.require_prepayment` using the same guarantee predicate as `hasStayGuaranteeSync`.

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts` night-audit checks, React SPA (`apps/web-pms` + `@hospai/ui-kit`), vitest (pms-core **8 shards** via `scripts/test-pms-core-shards.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-20-advance-collection-design.md` (Accepted). Roadmap R4.25 advance half only (READ ONLY — do not edit `docs/roadmap.md`).

---

## Global Constraints

- **Do NOT commit** — leave all changes unstaged/uncommitted. No push, stash, reset, or checkout.
- **Do NOT edit** `docs/roadmap.md`.
- **Receipt OUT:** no receipt route, series, or *Receipt* button in stay-card Documents.
- **No new command, HTTP route, or PropertyDO/OrgDO migration.** Catalog length stays **122**; `V1_HTTP_ROUTE_AUDIT` stays **199** (last `get_reservation_registration_card`); `AUDIT_WRITER_COMMAND_IDS` **88**; `PROPERTY_SCHEMA_HEAD` **49**; `ORG_SCHEMA_HEAD` **13**; `NIGHT_AUDIT_STEPS` length **8**, `[3]==='AUTO_TRANSFER'`. Only pin change: `NIGHT_AUDIT_CHECK_IDS` **6 → 7** with `arrival_deposit_missing`.
- **No `await` inside `transactionSync`.** Bind SQL; identifiers are constants or validated identifiers.
- **SPA:** ui-kit only (`Field`, `Input`, `NativeSelect`, `Button`, `Alert`, `DataTable` / row list, `Card`). Hex only in `tokens.css`. `classifiedUserMessage` for errors; settled Alert copy **"Advance of ₹X recorded."** (use the screen’s existing `money()` / `formatMoney` helper — INR example in the spec). Never raw error codes/enums in UI.
- **Query keys** always include tenant + params. After each successful advance row invalidate: `['folio', propertyId, reservationId]`, `['folio-payments', propertyId, reservationId]`, `['reservation-proforma', propertyId, reservationId]`, `['open-shift', propertyId]` (shift strip). Assert in tests.
- **pms-core tests:** single-file via `pnpm --filter @hospai/pms-core exec vitest run test/<file>.spec.ts`. Never unsharded full pms-core. Do **not** put `--` before `--shard`. Run `node scripts/test-pms-core-shards.mjs` **once** at the end of the last task.
- **D1–D8 locked** — do not reopen (see Locked behaviour). Booking stands on advance failure (R1.4 pattern).

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **D1** | Advance = existing `folio.record_cash_payment` / `folio.record_upi_payment` / card authorize (`purpose: 'STAY'`). No new command/route/migration/money model/`availability_day` write. |
| **D2** | One SPA `AdvancePayments` on Book (after Hold/Confirm), stay card, check-in, folio (extracted from Cash/UPI *Take a payment*). Only for `pending` \| `confirmed` \| `checked_in`. Folio keeps separate Card+DAMAGE authorize section as today. |
| **D3** | ≤8 rows; Cash/UPI/Card; no notes; op id `advance:{reservationId}:{rowKey}:{uuid}`; sequential posts; Retry failed rows only with same keys; rotate id after success; booking stands on failure. |
| **D4** | Panel from `get_reservation_proforma` totals only (`estimatedTotalMinor`, `advancePaidMinor`, `balanceMinor`). Before Book submit: quote total only. FAIL_CLOSED → Alert, no numbers. |
| **D5 first** | Characterization `apps/pms-core/test/advance-collection.spec.ts`; fix inside existing commands if blocked. |
| **D6** | `arrival_deposit_missing` in `NIGHT_AUDIT_CHECK_IDS` (default `warn`). Count via same guarantee predicate as `hasStayGuaranteeSync` only when `pms.booking.require_prepayment` is true; else count **0**. Settings Night audit labels. `register.test.ts` length 7. `AGENTS.md` pins table → length 7 includes `arrival_deposit_missing`. |
| **D7/D8** | No refund or shift/expected-cash formula changes. |
| **Op / payment ids** | Operation id = `advance:{reservationId}:{rowKey}:{uuid}`. Pass that string as the client `opId` into `recordCashPayment` / `recordUpiPayment` / `authorizePayment` (they derive idempotency via `stableKeyForOperation`). Derive `paymentId` as `pay_adv:{opId}` (stable for the row until success rotates the uuid). |
| **Card row** | Calls existing `api.authorizePayment(..., { purpose: 'STAY', amountMinor }, opId)` — same path as folio *Charge card* for STAY. |
| **UPI** | Reference required; validate with `UPI_REFERENCE_RE` from `@hospai/contracts` (same as `FolioScreen`). |
| **Commits** | **Do NOT commit — leave changes unstaged/uncommitted.** |

---

## Sequencing gate

```
Task 1  D5 characterization advance-collection.spec.ts (+ existing-command fixes if any)
Task 2  D6 arrival_deposit_missing + Settings labels + pin updates
Task 3  AdvancePayments component + folio wired
Task 4  Book + stay card + check-in + panel/proforma + cache invalidation tests
Task 5  Final verification (full ci.yml sequence + shards)
```

---

## File map

| File | Task | Change |
|---|---|---|
| `apps/pms-core/test/advance-collection.spec.ts` | 1, 2 | **Create** — D5 payment characterization; append D6 check cases |
| `apps/pms-core/src/property-do.ts` | 1?, 2 | Fix existing cash/UPI/check-in only if Task 1 fails; add `arrival_deposit_missing` branch in `countNightAuditCheckSync` |
| `packages/contracts/src/night-audit-checks.ts` | 2 | +`arrival_deposit_missing` in ids, schema, defaults |
| `packages/contracts/src/register.test.ts` | 2 | Length 7 + id list + default map |
| `AGENTS.md` | 2 | Pins table `NIGHT_AUDIT_CHECK_IDS` → length **7**, includes `arrival_deposit_missing` |
| `apps/web-pms/src/copy/night-audit-check-labels.ts` | 2 | Label + description for new check |
| `apps/web-pms/src/screens/settings-night-audit-checks.tsx` | 2 | No logic change expected (iterates `NIGHT_AUDIT_CHECK_IDS`); confirm labels render |
| `apps/pms-core/test/night-audit-checks.spec.ts` | 2 | Expect 7 check ids in ordered list assertion |
| `apps/web-pms/src/screens/AdvancePayments.tsx` | 3 | **Create** — multi-row capture + panel |
| `apps/web-pms/src/screens/AdvancePayments.test.tsx` | 3, 4 | Component + cache-key tests |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 3 | Replace Cash/UPI *Take a payment* block with `AdvancePayments`; keep Card+DAMAGE |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | 3 | Adapt cash/UPI tests to shared component / keep coverage |
| `apps/web-pms/src/screens/BookingScreen.tsx` | 4 | Draft rows + post after Hold/Confirm + Retry (R1.4) |
| `apps/web-pms/src/screens/BookingScreen.test.tsx` | 4 | Post-after-confirm + stand-on-failure |
| `apps/web-pms/src/screens/ReservationStayScreen.tsx` | 4 | *Advance* card |
| `apps/web-pms/src/screens/ReservationStayScreen.test.tsx` | 4 | Wire + status gating |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | 4 | Panel+rows by prepayment block; clear block after success |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | 4 | Block clears without reload |

**Not touched:** receipt routes/series; `COMMAND_CATALOG`; `V1_HTTP_ROUTE_AUDIT`; migrations; `docs/roadmap.md`; refund/shift formula; group deposits; gateway capture.

---

## Normative scope-out (matches spec §5)

- Numbered receipt and its series (advisor fork).
- Group deposit allocation (R4.1).
- Gateway capture (R4.7).
- Standalone advance page (client Q21).
- Notes on a payment.
- Bank transfer / CHECK / VOUCHER / GIFT.
- Changes to `folio.refund`, cancellation-penalty, or expected-cash formula (D7/D8).
- New Settings toggles beyond the night-audit check label row.

---

### Task 1: D5 characterization — `advance-collection.spec.ts`

**Files:**
- Create: `apps/pms-core/test/advance-collection.spec.ts`
- Modify only if a case fails today: `apps/pms-core/src/property-do.ts` (`tryRecordCashPayment` / `tryRecordUpiPayment` / `tryCheckIn` / `hasStayGuaranteeSync`) — fix inside the existing command; do **not** add a new command.

**Interfaces:**
- Consumes: existing HTTP cash/UPI/authorize/check-in/checkout/proforma routes; DO helpers used by `apps/pms-core/test/prepayment-check-in.spec.ts` and `apps/pms-core/test/documents.spec.ts` (provision, book pending/confirmed, `tryRecordCashPayment`, fingerprint).
- Produces: green characterization proving pre-arrival advances on GUEST window (inputs for Task 2 check predicate and Task 3–4 SPA).

**Reference paths (read before coding):**
- Cash exists-only gate: `apps/pms-core/src/property-do.ts` `tryRecordCashPayment` (~24653) — `SELECT reservation_id …` then `ensureGuestFolioWindowSync` (no status filter today).
- Guarantee predicate: `hasStayGuaranteeSync` (~11725) — `purpose = 'STAY'` + authorized or captured unrefunded.
- Prepayment HTTP patterns: `apps/pms-core/test/prepayment-check-in.spec.ts` (`postCash`, `requirePrepayment`, `postCheckIn`).
- Proforma advance totals: `apps/pms-core/test/documents.spec.ts` (~738–766).

- [ ] **Step 1: Write the failing characterization file**

Create `apps/pms-core/test/advance-collection.spec.ts` modeled on `prepayment-check-in.spec.ts` helpers (`provisionHotel`, `book` with `status: 'pending' | 'confirmed'`, `addCalendarDays` from `./date-helpers.ts`, `idemFor` / HTTP `x-dev-actor`).

Minimum cases (spec §3 items 1–3 and 5; item 4 waits for Task 2):

```ts
describe('advance collection (R4.25 D5)', () => {
  it('cash on pending then on confirmed → GUEST PAYMENT; survives check-in; checkout nets advance', async () => {
    // 1) Hold (pending): POST cash → 201; folio GUEST window has PAYMENT line with amountMinor
    // 2) Confirm stay; POST second cash on confirmed → 201; both lines on same GUEST window
    // 3) Check-in → 200; same window still holds both PAYMENT lines
    // 4) After room charges (or known charge), checkout balance = charges − advances
  });

  it('UPI on confirmed: same-key replay posts once; different key posts separately', async () => {
    // POST upi with key K1 / paymentId P1 → 201
    // Replay identical fingerprint+key → still one payment row
    // Second row different paymentId + key → two captured UPI payments
  });

  it('require_prepayment on: check-in 422 before cash advance, 200 after', async () => {
    // Mirror prepayment-check-in cash case but assert refusal then success after advance
  });

  it('proforma totals after two advances: advancePaidMinor = sum; balance nets', async () => {
    // Two cash advances; GET proforma → totals.advancePaidMinor === a+b;
    // balanceMinor === estimatedTotalMinor − advancePaidMinor
  });
});
```

Assert GUEST window via existing folio read helpers (same patterns as cashiering / documents specs — `kind === 'GUEST'`, line type `PAYMENT`). Do **not** encode a bug as `expect`.

- [ ] **Step 2: Run to verify failures or unexpected passes**

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/advance-collection.spec.ts
```

Expected: file loads; any case that fails documents a real gap. If all pass on first run, keep them — D5 is “prove, not assume.”

- [ ] **Step 3: Fix only inside existing commands if blocked**

If cash/UPI on `pending` fails, or check-in drops the window, or `hasStayGuaranteeSync` ignores captured CASH/UPI: patch `tryRecordCashPayment` / `tryRecordUpiPayment` / `tryCheckIn` / `hasStayGuaranteeSync` in `property-do.ts` only. Do not add routes or catalog entries.

Re-run the same vitest command until green.

- [ ] **Step 4: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 2: D6 — `arrival_deposit_missing` + Settings labels + pins

**Files:**
- Modify: `packages/contracts/src/night-audit-checks.ts`
- Modify: `packages/contracts/src/register.test.ts` (length 7 + ordered list + default map)
- Modify: `AGENTS.md` pins table row for `NIGHT_AUDIT_CHECK_IDS` only
- Modify: `apps/pms-core/src/property-do.ts` — `countNightAuditCheckSync` switch (~3891)
- Modify: `apps/web-pms/src/copy/night-audit-check-labels.ts` — `CHECK_LABELS` + `CHECK_DESCRIPTIONS`
- Modify: `apps/pms-core/test/advance-collection.spec.ts` — append D6 cases
- Modify: `apps/pms-core/test/night-audit-checks.spec.ts` — ordered `checkId` list length 7
- Touch only if types break: `apps/web-pms/src/screens/settings-night-audit-checks.tsx` (already maps `NIGHT_AUDIT_CHECK_IDS`)

**Interfaces:**
- Consumes: `hasStayGuaranteeSync` predicate semantics; `readConfigValueSync('pms.booking.require_prepayment')`; business date.
- Produces: `NightAuditCheckId` includes `arrival_deposit_missing`; default `'warn'`; count API for Settings + night-audit preview.

- [ ] **Step 1: Write failing contracts + characterization assertions**

In `packages/contracts/src/register.test.ts`, change the night-audit block to expect length **7** and include `'arrival_deposit_missing'` at the end of the array (append; do not reorder existing six).

In `advance-collection.spec.ts` add:

```ts
describe('arrival_deposit_missing (R4.25 D6)', () => {
  it('require_prepayment on: counts unpaid confirmed/pending arrival, not paid, not checked_in', async () => {
    // Put checks default/warn; set require_prepayment true
    // Unpaid arrival (arrival_date <= businessDate, status confirmed|pending) → count >= 1
    // Same stay after cash STAY advance → that stay no longer counted
    // checked_in stay without guarantee → not counted
  });

  it('require_prepayment off: count is 0', async () => {
    // Unpaid arrivals exist; require_prepayment false/unset → arrival_deposit_missing count === 0
  });
});
```

In `night-audit-checks.spec.ts`, extend the `checks.map((row) => row.checkId)` expectation to append `'arrival_deposit_missing'`.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/advance-collection.spec.ts test/night-audit-checks.spec.ts
```

Expected: FAIL on missing id / exhaustive switch / length.

- [ ] **Step 3: Implement contracts**

Update `packages/contracts/src/night-audit-checks.ts`:

```ts
export const NIGHT_AUDIT_CHECK_IDS = [
  'arrivals_not_checked_in',
  'departures_not_checked_out',
  'cashier_shift_open',
  'dirty_room_assigned',
  'departed_with_balance',
  'id_proof_missing',
  'arrival_deposit_missing',
] as const;

// NightAuditChecksSchema: add arrival_deposit_missing?: severity
// NIGHT_AUDIT_CHECKS_DEFAULT: arrival_deposit_missing: 'warn'
```

- [ ] **Step 4: Implement DO counter**

In `countNightAuditCheckSync`, add:

```ts
case 'arrival_deposit_missing': {
  const require =
    this.readConfigValueSync('pms.booking.require_prepayment') === true;
  if (!require) return 0;
  // Count reservations where:
  //   status IN ('confirmed','pending')
  //   arrival_date <= businessDate
  //   AND NOT hasStayGuaranteeSync(reservation_id)
  // Prefer calling hasStayGuaranteeSync per candidate row in a sync loop
  // (same predicate as check-in) — do not invent a divergent SQL fragment.
  // Bind businessDate; no string-built identifiers from input.
}
```

Keep `evaluateNightAuditChecksSync` unchanged aside from picking up the new id via `NIGHT_AUDIT_CHECK_IDS.map`.

- [ ] **Step 5: Settings labels**

In `apps/web-pms/src/copy/night-audit-check-labels.ts`:

```ts
arrival_deposit_missing: 'Arrivals missing a required deposit',
// description:
arrival_deposit_missing:
  'Confirmed or pending arrivals on or before the closing date with no stay guarantee, only when require prepayment is on.',
```

- [ ] **Step 6: Update AGENTS.md pins table only**

Change the `NIGHT_AUDIT_CHECK_IDS` row to: length **7**, includes **`arrival_deposit_missing`**. Do not touch other pin rows. Do not edit `docs/roadmap.md`.

- [ ] **Step 7: Re-run tests**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/advance-collection.spec.ts test/night-audit-checks.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 3: `AdvancePayments` extracted + folio wired

**Files:**
- Create: `apps/web-pms/src/screens/AdvancePayments.tsx`
- Create: `apps/web-pms/src/screens/AdvancePayments.test.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx` (~2233–2356 *Take a payment* Cash/UPI; keep Card+DAMAGE block ~2318+)
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx` (cash/UPI + invalidate assertions)

**Interfaces:**
- Consumes:
  - `api.recordCashPayment` / `api.recordUpiPayment` / `api.authorizePayment` from `packages/client-core/src/api.ts`
  - `api.getReservationProforma` for panel (query key `['reservation-proforma', propertyId, reservationId]` — same as `document-print-views.tsx`)
  - `UPI_REFERENCE_RE`, `parseAmountToMinor` (`apps/web-pms/src/money.ts`), `classifiedUserMessage`, kit components
  - Folio patterns: invalidate `folio`, `folio-payments`, `open-shift` (~1153–1157 in `FolioScreen.tsx`)
- Produces:

```ts
export type AdvancePaymentsContext = 'book' | 'stay' | 'check-in' | 'folio';

export type AdvanceDraftRow = {
  rowKey: string;           // stable across retries
  method: 'CASH' | 'UPI' | 'CARD';
  amountInput: string;      // major units string for Input
  upiReference: string;     // '' unless UPI
  opId: string;             // advance:{reservationId}:{rowKey}:{uuid}
  status: 'draft' | 'pending' | 'ok' | 'error';
  errorMessage?: string;
};

export function AdvancePayments(props: {
  propertyId: string;
  reservationId: string | null; // null on Book before Hold/Confirm → panel quote-only / rows draft
  context: AdvancePaymentsContext;
  status?: 'pending' | 'confirmed' | 'checked_in' | string; // hide if not eligible
  quoteTotalMinor?: number | null; // Book pre-submit only
  canPay?: boolean;
  payBlockedReason?: string;
  onAdvanceSuccess?: (sumMinor: number) => void; // check-in clears block
  /** Book: controlled draft rows before submit; omit for stay/check-in/folio owned state */
  draftRows?: AdvanceDraftRow[];
  onDraftRowsChange?: (rows: AdvanceDraftRow[]) => void;
  /** When true (Book confirmation), show outcomes + Retry only for failed */
  postCommitMode?: boolean;
}): JSX.Element | null;
```

**Extraction source:** `FolioScreen.tsx` Cash/UPI fields (`payment-tender`, `cash-amount`, `upi-reference`, `record-cash` / `record-upi`) and mutations (~1104–1158). Card authorize for DAMAGE stays on folio; Card **as an advance row method** lives inside `AdvancePayments` and calls `authorizePayment` with `purpose: 'STAY'`.

- [ ] **Step 1: Write failing component tests**

In `AdvancePayments.test.tsx` (rtl + mocked `api` like `FolioScreen.test.tsx`):

1. Adds/removes rows up to 8; 9th add disabled.
2. UPI without valid reference disables submit / shows invalid Alert via `classifiedUserMessage`.
3. Two rows post sequentially with distinct `opId`s matching `/^advance:[^:]+:[^:]+:/`.
4. First row fails, second ok → Retry re-posts **only** failed row with **same** `opId`; success rotates that row’s uuid afterward.
5. Panel: mocked proforma success shows estimated / advance / balance; proforma error → Alert, no numbers.
6. After success, `invalidateQueries` called with full keys:
   - `{ queryKey: ['folio', 'prop_demo', 'res_1'] }`
   - `{ queryKey: ['folio-payments', 'prop_demo', 'res_1'] }`
   - `{ queryKey: ['reservation-proforma', 'prop_demo', 'res_1'] }`
   - `{ queryKey: ['open-shift', 'prop_demo'] }`
7. Settled Alert text matches `/Advance of .+ recorded\./` (sum of succeeded row minors via `money()`).

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/AdvancePayments.test.tsx
```

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `AdvancePayments`**

Behaviour checklist:

- Hide entirely unless `status` is `pending` | `confirmed` | `checked_in` (when `status` provided).
- Row list: method `NativeSelect` (Cash/UPI/Card), amount `Input`, UPI reference when UPI, remove row, Add row (cap 8).
- No notes field.
- Submit / Record: sequential `await` per draft/error row; set `status: 'pending'` then `'ok'|'error'`.
- Op id: on row create set `opId = \`advance:${reservationId}:${rowKey}:${crypto.randomUUID()}\``; on success replace uuid; on failure keep.
- `paymentId = \`pay_adv:${opId}\``.
- Methods:
  - CASH → `api.recordCashPayment(propertyId, reservationId, { paymentId, amountMinor }, opId)`
  - UPI → `api.recordUpiPayment(..., { paymentId, amountMinor, reference }, opId)`
  - CARD → `api.authorizePayment(..., { paymentId, amountMinor, purpose: 'STAY' }, opId)`
- Panel (when `reservationId` set): `useQuery({ queryKey: ['reservation-proforma', propertyId, reservationId], … })`. Success → three numbers. Error / FAIL_CLOSED / degraded → kit `Alert`, no numeric fields.
- Book pre-submit (`reservationId == null`): show quote total only from `quoteTotalMinor`; no proforma fetch.
- Success: kit `Alert intent="settled"` — `Advance of ${money(sum)} recorded.`; call `onAdvanceSuccess(sum)`.
- Errors: `classifiedUserMessage(asClassified(err), { fallback: '…' })` per row.

- [ ] **Step 4: Wire folio**

In `FolioScreen.tsx` *Take a payment* card:

- Render `<AdvancePayments propertyId={…} reservationId={…} context="folio" status={reservation status} canPay={policy.canPay} />` for Cash/UPI/multi-row.
- Keep the existing Card authorize + purpose DAMAGE/STAY UI below (or adjacent) so damage deposits stay folio-only.
- Remove duplicated Cash/UPI local state/mutation now owned by `AdvancePayments` (`payTender`, `cashAmount`, `upiReference`, `cashPay` for CASH/UPI). Keep `authorize` mutation for the damage/card section.

- [ ] **Step 5: Adapt FolioScreen tests**

Update `FolioScreen.test.tsx` cash/UPI cases to still pass (either through `AdvancePayments` testids reused — prefer `data-testid="advance-payments"` root and keep `record-cash` / `upi-reference` where practical — or assert via the new component). Keep open-shift invalidation coverage.

Run:

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/AdvancePayments.test.tsx src/screens/FolioScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 4: Book + stay card + check-in + panel + cache tests

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` (R1.4 add-on / R4.26 room-assign Retry pattern ~621–1038, confirmation Alerts ~1888+)
- Modify: `apps/web-pms/src/screens/BookingScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/ReservationStayScreen.tsx` (near Documents / Actions ~942; add *Advance* card for eligible statuses)
- Modify: `apps/web-pms/src/screens/ReservationStayScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/CheckInScreen.tsx` (prepayment block ~527–534; `folio-payments` query ~231; `isStayGuarantee` ~411)
- Modify: `apps/web-pms/src/screens/CheckInScreen.test.tsx`
- Extend: `apps/web-pms/src/screens/AdvancePayments.test.tsx` if Book-controlled draft / postCommitMode needs more coverage

**Interfaces:**
- Consumes: `AdvancePayments` from Task 3; Book post-create flow like `postBookAddons` / `postBookRoomAssign`.
- Produces: advances post after Hold/Confirm; stay/check-in surfaces; check-in block clears when payments refetch shows guarantee.

**Patterns to copy:**
- Book Retry: `BookingScreen.tsx` room assign (`roomAssignOpIdRef`, failure Alert + Retry) and add-ons (`book-addon:…` op ids, `setFailedAddons`).
- Check-in guarantee: `CheckInScreen.tsx` `PREPAYMENT_BLOCK_REASON`, `payments.some(isStayGuarantee)`, Folio link.
- Stay Documents group: `ReservationStayScreen.tsx` — place *Advance* as its own `Card` with `CardTitle` Advance (not a Receipt button).

- [ ] **Step 1: Write failing screen tests**

**BookingScreen.test.tsx**
- Draft advance rows before Confirm; after Confirm, posts each with distinct `advance:…` op ids.
- Payment API rejects one row → booking still created (reservation id shown); Retry reuses failed op id only.
- Assert invalidate keys include folio, folio-payments, reservation-proforma, open-shift for the new reservation id.

**ReservationStayScreen.test.tsx**
- Eligible status shows Advance card; `checked_out` / cancelled does not.

**CheckInScreen.test.tsx**
- With `require_prepayment` and no guarantee: block reason visible; `AdvancePayments` mounted.
- Mock successful advance → `onAdvanceSuccess` / payments refetch → `isStayGuarantee` true → Check in enabled without full page reload (invalidate `folio-payments` key).

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/BookingScreen.test.tsx \
  src/screens/ReservationStayScreen.test.tsx \
  src/screens/CheckInScreen.test.tsx \
  src/screens/AdvancePayments.test.tsx
```

Expected: FAIL on missing wiring.

- [ ] **Step 3: Wire Book**

- State: `advanceDraftRows: AdvanceDraftRow[]` before submit; show `<AdvancePayments context="book" reservationId={null} quoteTotalMinor={…} draftRows … />` on the form.
- After Hold/Confirm succeeds (same place as add-ons / room assign / package), sequentially post draft rows using existing op ids; collect failures; set confirmation view with `postCommitMode` + Retry (same keys).
- Booking success message always stands if advances fail (mirror add-on copy pattern: “Booking created — some advances could not be recorded.”).
- Do not block create on advance validation beyond client-side amount/UPI checks before submit.

- [ ] **Step 4: Wire stay card**

- For `pending` | `confirmed` | `checked_in`, render Card *Advance* with `<AdvancePayments context="stay" … />` including panel.
- No Receipt control.

- [ ] **Step 5: Wire check-in**

- Near prepayment block / guarantee line: render `<AdvancePayments context="check-in" … onAdvanceSuccess={() => { void queryClient.invalidateQueries({ queryKey: ['folio-payments', propertyId, reservationId] }); /* also folio + proforma + open-shift */ }} />`.
- After invalidate, existing `guaranteed` derivation clears `PREPAYMENT_BLOCK_REASON` without navigation.

- [ ] **Step 6: Re-run screen tests**

Same vitest command as Step 2. Expected: PASS.

- [ ] **Step 7: Do NOT commit — leave changes unstaged/uncommitted**

---

### Task 5: Final verification suite

**Files:** none intentional (fix only if a check fails with a one-line pin/type nit).

- [ ] **Step 1: Build + wrangler dry-run + every `check:*` + self-tests + typecheck + package tests + lint (ci.yml `checks` job order)**

Run in order:

```bash
pnpm install
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
pnpm check:error-mapper-singleton
pnpm check:resolve-property-prefetch
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] **Step 2: pms-core shards once at end (never unsharded; no `--` before `--shard`)**

```bash
node scripts/test-pms-core-shards.mjs
```

Also ensure focused specs still green:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/advance-collection.spec.ts
```

- [ ] **Step 3: Confirm pins**

- `COMMAND_CATALOG` 122, routes 199 / last `get_reservation_registration_card`, audit writers 88, schema heads 49/13, night-audit steps unchanged.
- `NIGHT_AUDIT_CHECK_IDS` length **7** includes `arrival_deposit_missing` in `register.test.ts` and `AGENTS.md`.

- [ ] **Step 4: Do NOT commit — leave changes unstaged/uncommitted**

---

## Self-review (plan author)

1. **Spec coverage:** D1–D8, SPA surfaces, cache keys, characterization list, pins, scope-out — each has a task. Receipt explicitly excluded.
2. **Placeholders:** none intentional; op/payment id formats and invalidate keys are concrete.
3. **Type consistency:** `AdvancePayments` props / `AdvanceDraftRow` / op id format reused across Tasks 3–4.
4. **Final CI:** Task 5 mirrors `.github/workflows/ci.yml` `checks` + local shard runner.
