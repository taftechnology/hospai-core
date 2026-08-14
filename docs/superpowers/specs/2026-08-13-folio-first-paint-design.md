# Folio first-paint is a bill

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P0-2 / 8-minute folio beat / P1 last-4 leftover; [folio front desk](./2026-08-08-folio-front-desk-design.md); [cashier shift SPA](./2026-08-09-cashier-shift-spa-design.md) (Q4 warn-and-allow; unattributed copy); [cashiering](./2026-08-07-cashiering-design.md); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [folio money operations](./2026-08-12-folio-money-operations-design.md); [multi-currency folio](./2026-08-13-multi-currency-folio-design.md); [charge-code registry](./2026-08-07-charge-code-registry-design.md); [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) leftover **P0-2 shift auto-open**; `apps/web-pms/src/screens/FolioScreen.tsx`; `apps/web-pms/src/shell/ShiftStrip.tsx`; `packages/client-core/src/api.ts` (`FolioPaymentRow`); `PropertyDO.listPaymentsForReservation`; web-interface guidelines

**Closes:** DEMO-READY P0-2 (folio first paint is a bill a GM would recognize). Demo-tenant-seed leftover “do not auto-open a cashier shift (P0-2 names that leftover).”

**Amends:** [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) §1.3 / §5.7 / leftover table row 1 (this chunk **closes** the shift leftover via SPA auto-open, not by seeding a shift). Bidirectional pointer: one sentence in that spec when this chunk lands. DEMO-READY P0-2 checkboxes tick in the **implementation** PR. Do **not** rewrite ARCHITECTURE §16 as “folio UI shipped.”

---

## 1. Context & Motivation

The 8-minute investor path already posts a minibar and takes a card on live APIs. `FolioScreen.tsx` still paints operator internals on first load: window ids, Open COMPANY, holds keyed by `paymentId`, transfer dest selects, queued command ids, chargeback / FX / split. The meeting fails if that surface looks like a lab.

This chunk is **content IA** on the existing folio screen (and the shift strip that unblocks cash). It is not the P0-3 chrome + skin. Do not fold Advanced / first-paint into the sidebar / tokens slice. Do not rebuild the prototype billing app.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Folio SPA | `apps/web-pms/src/screens/FolioScreen.tsx` (~1370 lines). Route `/folio/:reservationId`. Header: `GuestNameLink` or raw `reservationId`; `arrivalDate → departureDate`; wire `status`; **`room ${reservationQ.data.roomId}`** (id, not code). |
| Balance | `data-testid="folio-balance"`: server `balanceMinor` via `formatMinor`; optional “held on card”; `no-post-chip`; `balance-at-risk`. |
| Lines | `data-testid="folio-lines"`. Each root: **`chargeCode`** (not registry `name`) + `formatMinor(ledgerAmountMinor)` or `data-testid="line-fx"` conversion; `source`; per-line transfer `<select>` + Transfer. Nested tax + `taxRuleId`. |
| Payments UI | Section **Holds**: `{paymentId} · amount · status · gatewayReference`. Capture input `aria-label={capture-amount-${paymentId}}`. Void `data-testid={void-payment-${paymentId}}`. Section **Captured**: `{paymentId} · amount · captured` + Refund. `gatewayReference` on simulate card is `sim_${paymentId}` (`psp-simulate.ts`). |
| Payments wire | `GET …/reservations/:id/folio/payments` (`get_folio_payments`). `listPaymentsForReservation` (~14780) SELECTs id/amount/currency/status/purpose/`gateway_reference`/captured/timestamps — **omits `tender_type`**. `mapPaymentRow` already maps `tenderType`. Client `FolioPaymentRow` has **no** `tenderType` / last-4 / brand. |
| Payment storage | `payment.tender_type CHECK IN ('CARD','CASH')` (v16 / v24). **No last-4 / brand column.** Cash `gatewayReference` is null (`cashiering.spec.ts`). Card simulate sets `sim_${paymentId}`. |
| Post / pay | Add charge (`add-charge`, aria `charge-code` / `charge-amount`). Cash (`record-cash`, `cash-currency`, `cash-no-shift-warn`). Authorize card (`authorize-card`, `authorize-currency`). Same mutations; this chunk does not change payloads. |
| No-shift copy | When `getOpenShift` succeeds and `shift == null`: `data-testid="cash-no-shift-warn"` — literal **“No open shift — this payment will be unattributed until close discloses the count.”** Post still allowed (cashier-shift SPA Q4). Test `FolioScreen.test.tsx` asserts that string’s testid and that `record-cash` still fires. |
| Shift strip | `ShiftStrip.tsx`: `GET` open shift; if null, **manual** “Open shift” + opening float default `100.00`. `api.openShift` → existing `folio.open_shift`. Badge paints raw **`shiftId`**. Auto-open: **none**. |
| Demo seed | `pnpm demo:seed` / `POST /v1/admin/demo-seed`. **Does not** `folio.open_shift`. Spec leftover named P0-2. Demo actor today is `X-Dev-Actor: user_owner` (`VITE_DEV_ACTOR`). Shifts are self-scoped `cashier_user_id = actor.userId`. |
| Windows / COMPANY | `folio-windows`, `window-chip-${folioWindowId}`, close/reopen, `open-company-window`, billed-party placeholder. |
| Split / discount / chargeback / FX | Split charge + split payment; discount; `chargeback-form`; `fx-adjustment-form`; `fx-rates-editor` (`<details>`). Staff without `folio:adjust` / `settings:configure`: those forms are **not rendered** (testid query null). |
| Queued dump | “Queued this reservation” + commandId / idempotencyKey prefix; “Other queued commands.” |
| Other first-load chrome | `FrontOfficeEditor` (`front-office-*`), `PrintRegCardControl` / `RegistrationCard` (`print-reg-card`, `reg-card`), capture-due, check-out, Book for guest, ← In house. |
| Room code compose | `GET /rooms` (`get_rooms`, **`housekeeping:read`**, `FAIL_CLOSED`) → `{ roomId, code, … }`. Reservations directory already maps id→code. Folio does **not**. Staff / admin / owner all have `housekeeping:read`. |
| Charge names | `GET /charge-codes` (`get_charge_codes`, **`folio:read`**, `FAIL_CLOSED`). Registry names: Room, Misc, Payment, Discount, Damage, Cancellation fee, No-show fee, FX gain/loss, Chargeback fee. Folio lines paint **code** (`MISC`), not name. |
| Guest header | `GuestNameLink` → `/guests/:guestRef`, `data-testid="guest-profile-link"`. Batch-of-one. |
| Policy | `folioActionPolicy` unchanged (policy C: refuse charge/pay/split when folio unread; checkout still allowed). |
| Catalog / routes / schema | `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT` last **`[127] = post_demo_seed`**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS = []`. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS` length **7**. |

**Heads (do not insert before — this chunk does not move them):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[127] = post_demo_seed` | **127** (no new row) |
| `COMMAND_CATALOG` | length **77** | **77** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **25** | **25** |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Folio **first paint** is a bill: guest name, stay dates, **room code**, **balance**, line list (**description + amount**), post charge, take payment (**card + cash**) (§3).
2. Holds / captured paint as **tenders** (amount + method). Never raw `paymentId`. Never `gatewayReference` / `sim_*` (§4).
3. Chargeback, FX editor, split-to-window, Open COMPANY, queued-command dump live behind **Advanced**, collapsed by default (§5).
4. Happy path: no “simulate”, no “unattributed until close discloses the count” (§6).
5. Auto-open a cashier shift for the signed-in actor who can `folio:post` (§7).
6. Existing `data-testid`s stay on the same controls so `FolioScreen.test.tsx` does not rewrite the vertical (§8).
7. Optional existing-GET compose: include already-stored `tenderType` on `GET …/folio/payments` (§4.2). **No new route.**

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **P0-3 chrome + skin.** Sidebar, sage/tan tokens, icons, palette, IBM Plex / radius, “Room Plan” title, property-name rail, folio **skin** (headers / buttons / chips restyle). This chunk may retitle sections; it must not restyle the shell.
- **P0-4 sign-in / Clerk.** `VITE_USE_DEV_ACTOR` / `X-Dev-Actor` stay until P0-4. Auto-open uses whoever `/me` is.
- **P0-5 script + dry runs.** No speaker notes, kill list, or timed rehearsal in this chunk. (P0-5 kill list will name Folio Advanced — that is documentation later.)
- **Rebuilding the folio layout from the prototype.** No pixel-faithful billing app, no new folio CSS system, no `packages/ui-kit`, no Tailwind.
- **Changing Worker routes or commands.** No new `V1_HTTP_ROUTE_AUDIT` row. No new catalog id. SPA-only content IA, plus the one existing-GET field in §4.2.
- **New catalog commands, new DO tables, schema changes.** No last-4 / brand column. No `payment_method_display` table.
- **Real PSP / PCI.** Simulate gateway stays. The UI must not **say** simulate.
- **P1 card last-4 / brand on tenders.** DEMO-READY P1: keep simulate; UI must not say simulate; pair with P0-2. This chunk uses **method**. Do not invent a fake last-4 (demo theater).
- **Seeding folio charges / payments / minibar.** 8-minute walk-in posts live (P0-5). Seed stays as P0-1 shipped it.
- **Seeding a cashier shift in `demo-seed`.** Auto-open is SPA (§7), so P0-4 Clerk users get a shift too.
- **Gating cash on an open shift.** Server still allows unattributed cash (cashiering §2.2 / shift SPA Q4). This chunk removes the **lab copy** and makes the happy path have a shift.
- **City ledger / invoices / auto-transfer / recurring / partial refunds.**
- **Virtual room types, derived rates, `rooms.delete`.**
- **Client-side IndexedDB.**

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers on the wire.** UI still formats via `formatMinor`. This chunk does not post, reverse, or re-sum balances. Chrome still shows server `balanceMinor`, never `fold.liveTotalMinor`.
2. **The folio is append-only.** Unchanged. No `UPDATE` of `folio_line` amounts.
3. **Domain code has zero platform imports.** Unchanged. No new domain package.
4. **No new catalog commands.** `COMMAND_CATALOG` length stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
5. **No new HTTP routes.** `[127] = post_demo_seed` does not move. Existing folio / shift / rooms / charge-code GETs are reused.
6. **Schema freeze.** `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. No last-4 column. `pnpm generate:ddl` is a no-op diff.
7. **No new `export class`.** Do not add to `CLASS_DENYLIST`.
8. **`NIGHT_AUDIT_STEPS` stays seven.**
9. **Payments stay `FAIL_CLOSED`.** Authorize / cash / capture / void / refund unchanged.
10. **`data-testid`s on existing controls stay** (same string, same control). Tests may change **copy assertions** (the unattributed sentence) and may add Advanced / tender assertions. They must not be rewritten to new ids for add-charge, record-cash, authorize-card, folio-balance, folio-lines, split-charge, open-company-window, chargeback-form, etc. (§8).
11. **Happy-path copy never contains** `simulate`, `sim_`, `paymentId` as a visible label, `unattributed until close discloses the count`, or raw `roomId` (`rm_101`) as the primary room label.
12. **Guest names never live in PropertyDO.** Header still composes via `postGuestsBatch` + `GuestNameLink`.
13. **Visual identity is not this chunk.** Existing tokens, `statusClass`, `check:web-pms-colors`. Interaction (what is on first paint vs Advanced) is the specification; appearance is P0-3.
14. **Fixture-date discipline** unchanged. Folio tests stay mocked; no shared `org_demo` bind.

---

## 3. First paint (normative)

“First paint” = what is visible when `/folio/:reservationId` loads with Advanced **collapsed** (its default). A GM who never clicks Advanced must still complete the 8-minute folio beat: see the stay, post a charge, take card or cash, see balance update.

### 3.1 Visible — required

| # | Fact | Source | Paint |
|---|---|---|---|
| 1 | Guest name | existing `GuestNameLink` / batch | Primary header. Link to `/guests/:guestRef` stays (`guest-profile-link`). Do not lead with `reservationId`. |
| 2 | Stay dates | `reservation.arrivalDate` → `departureDate` | Same ISO dates as today (P0-3 may prettify). |
| 3 | Room **code** | `GET /rooms` map `roomId` → `code` | e.g. `101`, never `rm_101` as the primary label. Unassigned: omit the room clause (do not print `room null` / raw id). If rooms GET fails: omit code rather than falling back to `roomId` on the happy path. |
| 4 | **Balance** | server `balanceMinor` | `data-testid="folio-balance"` unchanged. Held remainder may stay as “{amount} held on card”. No-post / balance-at-risk **chips** may stay on this row. |
| 5 | Line list | `fold.roots` | `data-testid="folio-lines"`. Each live root: **description + amount**. Description = charge-code **name** from `GET /charge-codes` when loaded; fallback = `chargeCode` (never a UUID). Amount = `formatMinor(ledgerAmountMinor)` (ledger). Nested tax: label **Tax** + amount; do not print `taxRuleId` here. |
| 6 | Post charge | existing add-charge controls | Visible. `data-testid="add-charge"`; aria `charge-code` / `charge-amount`. Section title may read **Post charge** (button may stay “Add charge”). |
| 7 | Take payment — card | existing authorize mutation | Visible. `data-testid="authorize-card"`. Visible label **Charge card** (or **Take card**). Do not title the section “Authorize card”. |
| 8 | Take payment — cash | existing cash mutation | Visible. `data-testid="record-cash"`. Visible label **Take cash** (or keep “Record cash”). |
| 9 | Tenders | payments list | Holds + captured as **one** tender list (not “Holds” / “Captured” operator headings). See §4. |

Stay **status** may remain on the header as the wire value (`checked_in`, …) so existing `getByText(/checked_in/i)` stays green. Mapping to “In house” is **P0-3 copy**, not required here.

Check out stays on first paint (`data-testid="check-out"`). It is a bill closer the desk already uses; DEMO-READY did not send it to Advanced.

Back link “← In house” and “Book for guest” may stay (navigation, not operator dumps).

### 3.2 Visible — allowed but not the pitch

- `folio-message` after a mutation.
- Policy muted reasons when charge/pay is refused (`policy.reasons.*`).
- Folio unread error (`folio-unread`) — fail-closed honesty, not a happy path.
- Capture / void / refund **buttons on a tender row** (testids keyed by `paymentId` — the id is the test hook, not the visible label). Capture amount input may stay on an authorized tender.

### 3.3 Not on first paint (must not be the default view)

Everything in §5. Also: per-line Transfer select, `source` (`DESK` / `NIGHT_AUDIT`), `folioWindowId`, `gatewayReference`, `paymentId` as text, FX conversion span as the primary amount (the `line-fx` node may live inside Advanced; testid stays), multi-currency pay `<select>` when more than the ledger currency, queued command ids, Open COMPANY, split line-id fields, chargeback, FX editor, no-post **toggle**, front-office editor, registration card blob, capture-due.

---

## 4. Tenders (normative)

### 4.1 Display

Each authorized or captured payment is one tender row:

| Status | Visible | Hidden |
|---|---|---|
| `authorized` | **Card** (method) + remaining / authorized **amount** + optional Hold. Capture + Void as today. | `paymentId`, `gatewayReference`, `sim_*` |
| `captured` | **Card** or **Cash** (method) + **amount** + Paid. Refund when `folio:adjust`. | same |

Method is **last-4 or method**. This chunk is **method only** (no last-4 column; P1 owns last-4 / brand). Do not fabricate `•••• 4242`.

Declined / voided / refunded / chargeback / unknown rows are not required on first paint; they may appear in Advanced if already fetched.

Do not use headings “Holds” / “Captured” on first paint. “Tenders” or “Payments” is acceptable.

### 4.2 Method source (locked)

`tender_type` is already on `payment`. The list GET currently drops it.

**Locked:** widen the **existing** `listPaymentsForReservation` JSON (same route `get_folio_payments`, **no new audit row**) with `tenderType: 'CARD' | 'CASH'` from the stored column. Add the same field to client-core `FolioPaymentRow`. SPA labels from `tenderType`.

This is not a new command, not a new path, not a schema change. It is composing a column the single-payment mapper already returns.

Fallback if a fixture omits the field: `authorized` → Card; `captured` && `gatewayReference == null` → Cash; else Card. **Never** paint `gatewayReference`.

### 4.3 `paymentId` in testids vs paint

`data-testid={`void-payment-${p.paymentId}`}` and `refund-payment-${p.paymentId}` **stay**. The **text node** of the row must not include the id.

---

## 5. Advanced (normative)

One `<details>` wrapping the operator remainder:

- `data-testid="folio-advanced"`
- `<summary>Advanced</summary>`
- **Collapsed by default** (`open` attribute absent on first paint). Tests do **not** need to expand it: Testing Library `getByTestId` still finds descendants.
- Do not auto-open because queued commands, COMPANY windows, or FX rates exist.

### 5.1 Must live inside Advanced (DEMO-READY list)

| Control | Existing testid / hook | Notes |
|---|---|---|
| Chargeback | `chargeback-form`, `record-chargeback`, aria `chargeback-*` | Still not rendered without `folio:adjust` |
| FX adjustment | `fx-adjustment-form`, `post-fx-adjustment` | |
| FX rates editor | `fx-rates-editor`, `create-fx-rate` | Already a nested `<details>`; move the whole block into Advanced |
| Split-to-window | `split-charge`, `split-payment`, split dest selects, aria `split-*` | Same-window split goes with it (one split UI) |
| Open COMPANY | `open-company-window`, billed-party input, `folio-windows`, `window-chip-*`, close/reopen | Window **kind** (GUEST / COMPANY) may label the chip; do not lead with `folioWindowId` text |
| Queued-command dump | the “Queued this reservation” / “Other queued commands” lists | Keep rendering; just not first paint |

### 5.2 Also inside Advanced (operator internals on today’s first paint; named so they are not “fixed” back onto the bill)

| Control | Existing testid | Why |
|---|---|---|
| Per-line transfer | `transfer-dest-*`, `transfer-line-*` | Window plumbing |
| Discount | `post-discount`, aria `discount-*` | Adjust, not the 8-minute beat |
| Capture due | `capture-due` | Retry after failed auto-capture |
| No-post toggle | `toggle-no-post` | Chips on the balance row may stay; the **button** moves |
| Front office editor | `front-office-editor`, `front-office-comment`, `vip-flag`, `dnd-flag`, `front-office-save` | Stay flags — not a bill |
| Registration card | `print-reg-card`, `reg-card` | Check-in beat; blob must not dominate folio |
| Multi-currency pay selects | `cash-currency`, `authorize-currency` | FX; hide from first paint when `payCurrencies.length === 1` by placing them here. When length > 1 they are still in Advanced. |
| Line FX conversion | `line-fx` | First-paint amount is ledger major; conversion detail here |
| Indicative FX muted copy | — | “Indicative — captured at the rate…” |

### 5.3 Permission gating unchanged

Staff without `folio:adjust` still must not see chargeback / FX adjustment / discount / split enabled / Open COMPANY. `queryByTestId('chargeback-form')` remains null for staff — Advanced does not invent those controls.

---

## 6. Happy-path copy (normative)

| Forbidden on the happy path (visible text) | Replacement |
|---|---|
| `simulate` / `sim_` / `Simulation` | Omit. Do not label Charge card “Simulate card.” Gateway stays simulate **server-side**. |
| `unattributed until close discloses the count` | Must not appear when a shift is open (the demo path). If no shift after auto-open failed / actor cannot `folio:post`: `data-testid="cash-no-shift-warn"` **stays**, copy **“No open cashier shift.”** Post still allowed. |
| Raw `paymentId` as a label | Method + amount (§4) |
| Raw `roomId` as the room label | Room **code** (§3.1) |
| `billed party` placeholder as first paint | Inside Advanced |

`FolioScreen.test.tsx` “cash with no open shift: warning visible; mutation still fires” **keeps** the testid and the mutation assertion; update the copy matcher to the new sentence.

---

## 7. Demo-actor shift auto-open (normative)

### 7.1 Decision — SPA auto-open on `ShiftStrip` (locked)

| Layer | What | Why |
|---|---|---|
| Where | `ShiftStrip` (shell), not FolioScreen, not `demo-seed` | Shift is self-scoped to the **signed-in** user. Seed-as-`user_owner` would not cover P0-4 Clerk. Folio-only open would leave the strip “No open shift” for the first five minutes of the tape. |
| Command | Existing `folio.open_shift` via `api.openShift` | No new catalog id. Same body as the manual form: `{ shiftId, openingFloat }`. |
| When | `getOpenShift` **succeeded** with `shift == null` **and** `canShowShellOpen(authority)` | Do not open while `/me` is pending. Do not open when shift GET is fail-closed. Fail-open `authority.kind === 'unknown'` still may open (today’s form is shown). |
| Float | Same default as the form: major `100.00` → `parseMajorToMinor` | One number; do not invent a second default. |
| `shiftId` | Mint once per mount (`shift_${crypto.randomUUID()}`), same as today | Remint only after **success**. |
| Attempts | **Once** per mount while still null | On `shift_already_open`: invalidate `['open-shift']`, do not loop. On other errors: stop; show the existing manual form + message. |
| Folio | Does not itself call `openShift` | Consumes the shared `['open-shift', propertyId]` query. After strip success, cash warning is gone. |

Rejected alternatives:

- **Seed `tryOpenShift` in `POST /v1/admin/demo-seed`.** Would bind the shift to `user_owner` only; night audit force-closes; P0-4 actor would still have no shift. P0-1 explicitly deferred this; this chunk closes it in the SPA instead.
- **New command `folio.ensure_demo_shift`.** Forbidden (§1.3).
- **Disable cash without a shift.** Contradicts cashiering / Q4.
- **Auto-open from FolioScreen only.** Leaves shell lying for the tape beat.

### 7.2 Folio interaction with in-flight open

Do **not** show `cash-no-shift-warn` while `openShiftQ` is pending. Show it only when the query has succeeded with `shift == null` (auto-open failed, ineligible actor, or tests that mock null and never mount `ShiftStrip`).

Folio unit tests mount `FolioScreen` without `ShiftStrip`. Mock `{ shift: null }` still shows the warning (new copy). Mock `{ shift: { shiftId: 's1' } }` (today’s default) still hides it.

### 7.3 What this does not change

- Night audit still force-closes leftover OPEN shifts.
- Close ceremony stays `/shift`.
- Strip badge may still print `shiftId` (P0-3 chrome leftover — not this chunk).
- `demo-seed` fixture tables stay as shipped (no shift row).

---

## 8. `data-testid` contract (normative)

Every id below **must remain** on the same control. Moving a node into Advanced is allowed. Renaming the id is not.

| `data-testid` | First paint or Advanced |
|---|---|
| `folio-unread` | first paint (error) |
| `folio-balance` | first paint |
| `no-post-chip` | first paint (chip) |
| `balance-at-risk` | first paint (chip) |
| `toggle-no-post` | Advanced |
| `folio-windows`, `window-chip-*`, `close-window-*`, `reopen-window-*`, `open-company-window` | Advanced |
| `void-payment-*`, `refund-payment-*` | first paint (tender row) |
| `capture-due` | Advanced |
| `folio-lines` | first paint |
| `line-fx` | Advanced |
| `transfer-dest-*`, `transfer-line-*` | Advanced |
| `add-charge` | first paint |
| `cash-no-shift-warn` | first paint **only if** no shift (new copy) |
| `cash-currency`, `record-cash` | currency: Advanced; record-cash: first paint |
| `authorize-currency`, `authorize-card` | currency: Advanced; authorize-card: first paint |
| `split-charge`, `split-payment` | Advanced |
| `post-discount` | Advanced |
| `chargeback-form`, `record-chargeback` | Advanced |
| `fx-adjustment-form`, `post-fx-adjustment` | Advanced |
| `fx-rates-editor`, `create-fx-rate` | Advanced |
| `checkout-outage-copy`, `check-out` | first paint |
| `folio-message` | first paint (after action) |
| `guest-profile-link` | first paint |
| `print-reg-card`, `reg-card` | Advanced |
| `front-office-editor`, `front-office-comment`, `vip-flag`, `dnd-flag`, `front-office-save` | Advanced |

**New** testid (only one required): `folio-advanced` on the collapsed `<details>`.

Aria-labels (`charge-code`, `charge-amount`, `cash-amount`, `auth-amount`, `capture-amount-*`, `split-*`, `discount-*`, `chargeback-*`, `fx-*`, `company-billed-party`, `opening-float`) stay.

---

## 9. Command / HTTP decision (normative)

Existing reads/writes suffice.

| Need | Existing | Decision |
|---|---|---|
| Folio bill | `get_folio`, `get_reservation`, `get_folio_payments`, `postGuestsBatch` | **Reuse.** |
| Room code | `get_rooms` | **Reuse.** FolioScreen lists rooms (directory already does). |
| Line description | `get_charge_codes` (`folio:read`) | **Reuse.** Map `code` → `name`. |
| Post / card / cash | `folio.add_item`, `folio.authorize`, `folio.record_cash_payment` | **Reuse unchanged fingerprints.** |
| Open shift | `folio.open_shift` / `get_front_desk_shift` | **Reuse.** Auto-call from ShiftStrip. |
| Tender method | stored `tender_type`; list GET omits it | **Widen existing GET body only** (§4.2). |

**Rejected as new commands / routes:** `folio.ensure_shift`, `GET …/folio/bill`, `payments.get_tender_display`, last-4 tokenize.

---

## 10. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `apps/web-pms/src/screens/FolioScreen.tsx` | first-paint vs Advanced; tenders; room code; charge names; copy; hide paymentId / gatewayReference |
| `apps/web-pms/src/shell/ShiftStrip.tsx` | auto-open §7 |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | copy matcher; Advanced collapsed; tenders hide `pay_auth`; room code; no unattributed sentence on shift-open path |
| `apps/web-pms/src/shell/ShiftStrip.test.tsx` | auto-open once when shift null + `folio:post` |
| `packages/client-core/src/api.ts` | `FolioPaymentRow.tenderType` |
| `apps/pms-core/src/property-do.ts` | `listPaymentsForReservation` SELECT + JSON `tenderType` |
| `apps/pms-core/test/folio-payments.spec.ts` (or existing payments GET test) | list includes `tenderType` |
| Pointer | one sentence in [demo tenant seed](./2026-08-13-demo-tenant-seed-design.md) when this chunk lands |
| DEMO-READY.md | tick P0-2 in the **implementation** PR, not this spec turn |

No `v1-http-routes.ts` append. No catalog. No migration. No `demo-seed.ts` shift. No `ARCHITECTURE.md` rewrite. No `packages/ui-kit`.

---

## 11. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | First paint = guest, dates, room code, balance, lines, post charge, card + cash | DEMO-READY P0-2 |
| 2 | Tenders = amount + method, not `paymentId` | P0-2 |
| 3 | Advanced collapsed: chargeback, FX, split-to-window, Open COMPANY, queued dump | P0-2 |
| 4 | No “simulate” / unattributed lab copy on the happy path | P0-2 |
| 5 | Auto-open shift for the demo / signed-in `folio:post` actor | P0-2; P0-1 leftover |
| 6 | Keep existing `data-testid`s | P0-2 |
| 7 | Move adjacent operator chrome (transfer, discount, no-post **toggle**, FO editor, reg card, capture-due, FX line span, extra currency selects) into the same Advanced | Implied by “first paint is a bill”; named so they are not left on the default view |

---

## 12. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **P0-3** chrome + skin (sidebar, tokens, icons, palette, folio header/button/chip skin) | **Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md). |
| 2 | **P0-4** Clerk / real `/sign-in` / hide `X-Dev-Actor` | Auto-open uses `/me` whoever it is |
| 3 | **P0-5** 8-minute script, dry runs, kill list | Kill list will say “do not open Folio Advanced unless asked” |
| 4 | Pixel-faithful prototype folio / billing app | DEMO-READY out of scope |
| 5 | New Worker routes or catalog commands | Forbidden |
| 6 | New DO tables / schema / last-4 column | Forbidden |
| 7 | Real PSP / PCI | Simulate stays; UI silent about it |
| 8 | **P1** card last-4 / brand on tenders | Pair later; method is enough for P0-2 |
| 9 | Seed folio lines / minibar / payments | Live 8-minute beat |
| 10 | Seed `folio.open_shift` | SPA auto-open instead |
| 11 | Gate cash on open shift | Q4 unchanged |
| 12 | Shift-strip hide raw `shiftId` | **Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md). |
| 13 | Status copy “In house” vs `checked_in` | **Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md). |
| 14 | City ledger / invoices / auto-transfer / recurring / partial refunds | Phase 1 |
| 15 | `ui-kit` / Tailwind / prototype palette | **Closed 2026-08-13** by [prototype chrome + skin](./2026-08-13-prototype-chrome-skin-design.md). |
| 16 | Virtual room types / derived rates / `rooms.delete` | Unrelated leftovers |

---

## 13. Tests (acceptance-shaped)

**Pins (must stay green; this chunk does not move heads)**

1. `COMMAND_CATALOG` length **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'`. No new audit row.
2. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `pnpm generate:ddl` no-op. `CLASS_DENYLIST` unchanged.

**Payments GET (existing route)**

3. `GET …/folio/payments` for a cash capture includes `tenderType: 'CASH'`. Card authorize includes `tenderType: 'CARD'`. No new path.

**web-pms — FolioScreen**

4. First paint (Advanced not `open`): guest name (or name-pending link), dates, **room code** when `listRooms` returns `{ roomId, code }` matching the reservation, `folio-balance`, `folio-lines` showing a **name** (e.g. Misc) not only `MISC` when charge-codes loaded, `add-charge`, `authorize-card`, `record-cash`.
5. `data-testid="folio-advanced"` exists; the `<details>` is **not** open. `open-company-window`, `split-charge`, `chargeback-form` (owner), queued heading’s command dump, `fx-rates-editor` are **descendants** of it.
6. Authorized payment `paymentId: 'pay_auth'` with `gatewayReference: 'sim_pay_auth'`: visible text matches amount and **Card** (or Hold); does **not** match `pay_auth` or `sim_`. `void-payment-pay_auth` still present.
7. Captured cash (`tenderType: 'CASH'`): visible **Cash** + amount; not the id.
8. Default mock open shift: `queryByText(/unattributed until close discloses the count/i)` null. `queryByText(/simulate/i)` null on the happy path.
9. `{ shift: null }`: `cash-no-shift-warn` visible; text is **No open cashier shift**; `record-cash` still fires. Old sentence gone.
10. Existing policy C / checkout / staff void / discount-reason / transfer-dest / window-chip / line-fx / authorize-currency / print-reg-card / front-office-save tests still `getByTestId` the **same** ids (they may sit under collapsed Advanced).
11. `check:web-pms-colors` green. No new `--status-*` without the check.

**web-pms — ShiftStrip**

12. Live authority with `folio:post`, `getOpenShift` → `{ shift: null }`: `openShift` called **once** with integer `openingFloat`. After success, invalidate `open-shift`.
13. Already-open shift: `openShift` **not** called.
14. Fail-closed open-shift GET: no auto-open; existing unreachable copy.
15. Manual form still present if auto-open errors (not `shift_already_open`).

---

## 14. Open questions (locked)

1. **Seed vs SPA auto-open.** **Locked: SPA `ShiftStrip` auto-open** (§7). Not demo-seed. Not a new command.
2. **Last-4.** **Locked: out (P1).** Method only. No fake PAN.
3. **Tender method field.** **Locked: widen existing payments GET with stored `tenderType`.** No new route.
4. **Advanced grouping.** **Locked: one collapsed `<details data-testid="folio-advanced">`.** Not three disclosure groups. Not a route `/folio/:id/advanced`.
5. **Checkout / add-charge / take payment.** **Locked: first paint.**
6. **Windows / COMPANY / split / chargeback / FX / queued.** **Locked: Advanced.**
7. **Transfer, discount, FO editor, reg card, capture-due, no-post toggle, extra currency selects.** **Locked: Advanced** (§5.2).
8. **Worker routes / schema / catalog.** **Locked: unchanged heads.**
9. **Prototype folio rebuild / P0-3 skin.** **Locked: out.**
10. **Cash still posts without a shift.** **Locked: yes** (Q4). Copy and auto-open change; the gate does not.

---

## 15. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Folio first paint matches §3; Advanced matches §5; default collapsed.
- [ ] Tenders §4; `tenderType` on existing payments GET; no `paymentId` / `sim_` text.
- [ ] ShiftStrip auto-open §7; folio warning copy §6; testid preserved.
- [ ] Room code via `get_rooms`; line description via `get_charge_codes`.
- [ ] All §8 testids remain. Tests §13. Heads §1.1 unchanged.
- [ ] Pointer sentence in demo-tenant-seed spec + DEMO-READY P0-2 ticks in the **implementation** PR.
- [ ] Stop. Do not start P0-3 / P0-4 / P0-5. Do not add last-4. Do not seed a shift. Do not commit in the spec-authoring turn.

---

## 16. Reviewer checklist

- [ ] Verified-current-state table matches the tree (FolioScreen paints `roomId` / `paymentId` / unattributed sentence / Open COMPANY / queued dump on first load; payments GET omits `tenderType`; seed does not open a shift; catalog **77**, route **127**, property head **25**, org head **7**).
- [ ] Normative invariants include integer money, append-only folio, schema freeze, no new routes/commands/`export class`, testid stability, no simulate/unattributed/`paymentId` on the happy path.
- [ ] **Exactly** what is on first paint (§3) vs Advanced (§5, including §5.2).
- [ ] Tenders: amount + method; last-4 deferred to P1; no fake PAN; `tenderType` on existing GET.
- [ ] Demo-actor shift: SPA auto-open on `ShiftStrip` via existing `folio.open_shift`; not seed; not a new command; once per mount; Folio warning copy replaced.
- [ ] Scope-out names **P0-3**, **P0-4**, **P0-5**, prototype rebuild, Worker routes/commands, new tables/schema, real PSP/PCI, last-4, seed charges.
- [ ] Folded leftovers §11 and deferred leftovers §12 both present.
- [ ] Acceptance tests §13 and this reviewer checklist present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn.
