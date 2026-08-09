# Folio Front-Desk Vertical

**Date:** 2026-08-08  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §4.6 (degraded mode), §7.3 (folio / money), §9 (frontend); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md); [folio charges](./2026-08-05-folio-charges-vertical-design.md); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [cashiering](./2026-08-07-cashiering-design.md); [tax posting](./2026-08-07-tax-posting-design.md); command catalog `folio.*` / `reservations.check_out`

**Implementation order:** after front-desk SPA shell (board, check-in, client-core classify / queued log / compose). This slice is the first money surface and the first staff/admin permission divergence the SPA can exercise.

---

## 1. Context & Motivation

Folio HTTP is built: lines, balance, add item, splits, cash, authorize/capture, payments list. The SPA cannot render a bill-shaped folio or close the operator loop (review → pay → check out).

Four gaps shape this vertical:

1. **`readFolio` omits `taxOf` / `taxRuleId`** — columns exist since tax posting; tax lines are unattached on the wire.
2. **Mixed degraded surface** — `get_folio` is `FAIL_CLOSED`; `folio.add_item` and checkout are `QUEUE_PROVISIONAL`; payments are `FAIL_CLOSED`. Blind charge posting is worse than blind check-in.
3. **No session/permissions endpoint** — client cannot evaluate `folio:adjust` vs `folio:post`; hide/disable is not implementable.
4. **Auth holds invisible on folio read** — authorize writes a `payment` row only; `balanceMinor` correctly ignores holds. Leftover from the payments slice: the SPA must not treat the folio read as the whole money story.

### Scope in

1. Server: add `taxOf` / `taxRuleId` to `readFolio` SELECT and response lines.
2. `client-core`: `foldFolioLines`, `folioActionPolicy`, classify `forbidden` / `not_configured` / `idempotency_key_reused`, queued-log caller context, folio + reservation + payments + checkout API methods.
3. `apps/web-pms`: `/folio/:reservationId` screen — folded lines, balance + holds, add charge, cash, card authorize→capture, splits, checkout, session queued log filtered to reservation, guest header via batch-of-one.
4. Board: folio link from **all three** modes (arrivals, departures, in-house).

### Scope out

- Charge-code / tax-rule settings (`settings:configure`).
- Shift open/close cashiering chrome (next vertical; both halves together).
- Client-side permission filter / `<Gate>` (no permissions wire).
- Collapsed “was split into…” audit projection; printable flat folio.
- Combined folio+reservation RPC; putting command payloads on 202 provisional responses.

---

## 2. Design Decisions

### 2.1 Tax grouping + fold (Q1) — wire fields; one-level live tree

**Lock:** Add `taxOf` / `taxRuleId` to `readFolio`. No further server projection.

**Fold in `client-core`** (derivation, compose-shaped — not visual vocabulary in `web-pms/status`):

```ts
foldFolioLines(lines) → { roots, liveTotalMinor }
```

**Rules:**

1. A line is **superseded** if any line has `splitOf === its id` (tax reversals carry `splitOf` on the original tax id).
2. **Live** = not superseded **and** `source !== 'SPLIT_REVERSAL'`.
3. Default tree is **one level**: live non-tax lines as roots; live `TAX` lines nested under the live charge matching `taxOf`.
4. No `children` on the default result — a parent is superseded exactly when split children exist, so live children are always roots. Collapsed “was split into…” is a later projection over the same inputs.
5. **`orphanTax`:** tax whose `taxOf` is missing or not a live charge → root with defect flag. Unreachable under correct `splitFolioLineSync`; visible beats silently dropped money. Treat as upstream inconsistency, not pleasant empty-state copy.
6. **Root order** preserves wire order (`ORDER BY created_at ASC`).
7. Sum field is **`ledgerAmountMinor`** (Phase 1 equals `amountMinor`; must not silently switch when cross-currency lands).

**Recursion property:** supersession removes every intermediate parent at any depth. Split a child of a split → still one-level live tree; `liveTotalMinor` still matches `balanceMinor`. Canary required.

**Invariant (canary):** `fold.liveTotalMinor === balanceMinor`, where `liveTotalMinor` is produced by the fold (not re-summed in the test).

**Screen:** renders `roots`; balance chrome shows the server’s `balanceMinor`, never `liveTotalMinor` (dev-only assert allowed).

### 2.2 Outage policy (Q2) — client stricter on charges only (policy C)

**Lock C:** When folio read is `fail_closed`, **refuse** charge / pay / split; **allow** checkout (when otherwise applicable).

**Why divergence is legitimate:** catalog `QUEUE_PROVISIONAL` answers replay safety. Whether posting is safe when the operator cannot see the folio is a client question — only the client knows the read failed.

**Why checkout stays allowed:** duplicate checkout is loud (`INVALID_STATUS_TRANSITION` → exception queue), not silent money. Duplicate charges are silent and monetary.

**Manual fallback:** refused charges go to paper slips (better duplicate visibility than an uninspectable queue).

**Named catalog leftover:** if no client will queue `folio.add_item` blind, should it remain `QUEUE_PROVISIONAL` or become `FAIL_CLOSED`? Record for catalog review — undocumented disagreement is the failure mode.

**Policy as pure function (not JSX):**

```ts
folioActionPolicy({
  folioReadClass,
  reservationReadClass,
  reservationStatus,
}) → { canPostCharge, canPay, canSplit, canCheckout, reasons }
```

Canaried in plain vitest. Screen consults it for enablement; SPA test asserts charge submit issues **no request** when folio is fail_closed (warning alone is insufficient).

### 2.3 Authority vs precondition (Q3)

**Principle:** **hide when a precondition is unknown; attempt when authority is unknown.**

| Case | Behaviour |
|---|---|
| Reservation status unreadable | Hide checkout (precondition) |
| Staff lacks `folio:adjust` | Still render split controls; server 403 decides (authority) |

No `/me` or permissions endpoint exists. Client-side hide/disable is not implementable and would drift mid-shift. Server 403 is the security control; UI is presentation.

**403 classification:** `forbidden`, never retried. Read `permission` from body when present; **fall back to `V1_HTTP_ROUTE_AUDIT` for the route just called** (some handlers return bare `{ error: 'forbidden' }`). Leftover: normalize 403 bodies server-side.

### 2.4 Scope (Q4) — money surface without shift chrome

**In:** folio view, add charge, card + cash, admin splits (to exercise 403), checkout, queued log, policy C.

**Card requires classify 501:** `folio.authorize` / `folio.capture` return `PSP_UNAVAILABLE` → 501 when `HOSPAI_UNSAFE_LOCAL !== '1'`. Class: `not_configured`, never retried; copy that card is not configured — not `server_error`.

**Accepted consequence:** every cash payment this slice is **unattributed** (`payment.shift_id` NULL). Nothing opens a shift in product UI; shift strip stays fixture-populated. Cashiering chrome (open **and** close) is the next vertical — opening without closing is worse (force-close every night).

### 2.5 Checkout on the folio (Q5)

Check-out exists nowhere else in the client. Folio hosts it: continuous counter flow (review → pay → depart).

- Fetch `get_reservation` beside `get_folio` (and payments); never trust router state for status.
- Checkout allowed with nonzero balance; confirmation copy for depart-with-balance, not a hard block.
- Outage + policy C: checkout still queues; required copy: **"Folio unavailable; checking out will not settle any balance."** This path generates departed-with-balance by construction.

**Provisional ≠ completed:** 202 checkout leaves server status `checked_in` until replay. Chrome must distinguish:

- **Checked out** — status transitioned.
- **Checkout queued — applies when the connection restores** — status unchanged; entry in queued log.

Refreshing after provisional must not read as success-as-done.

### 2.6 Auth holds — third read (retires a leftover)

**Lock:** `GET …/reservations/:rid/folio/payments` (`get_folio_payments`) as a third parallel read.

Authorize writes payment status `authorized` and **no folio line**. Without payments, the screen is byte-identical after a successful auth.

Balance chrome: *"balance X · Y held on card"* from authorized/uncaptured payments. `balanceMinor` still ignores holds (correct by design).

**Leftover retired (UI half):** “auth holds invisible on `readFolio`” / “SPA must not assume folio read is the whole money story” — discharged for this screen. Do not leave that leftover unmarked on the payments list.

### 2.7 Idempotency reuse — classify by body

`IDEM_KEY_REUSED` and other errors (e.g. `GUEST_EXISTS`) both map to **409**. Class `idempotency_key_reused` keys on body `error === 'idempotency_key_reused'`, same pattern as `queue_unavailable` among 503s.

Copy: earlier submission of this form already posted; refresh the folio. Money forms make this likely under `stableKeyForOperation`.

### 2.8 Queued-command association

202 bodies carry no payload / no `reservationId`. Caller supplies context:

```ts
recordFromProvisionalBody(body, context?: { reservationId?: string })
```

Folio/checkout call sites pass `{ reservationId }`. Untagged entries (legacy or other screens) appear in an **“other queued commands”** group — never hidden during outage.

### 2.9 Architecture — Approach 1

One `/folio/:reservationId` screen; pure logic in `client-core`; thin React. Reject drawers (outage/queued-log context would duplicate) and fold-in-`web-pms` (fold is compose-shaped derivation).

---

## 3. Data & Wire

### 3.1 Server

`readFolio` SELECT and mapped lines gain:

- `taxOf: string | null`
- `taxRuleId: string | null`

### 3.2 Client reads (parallel, independent failure)

| Read | Permission | Degraded | Role |
|---|---|---|---|
| `GET …/folio` | `folio:read` | `FAIL_CLOSED` | lines, `balanceMinor`, window |
| `GET …/reservations/:rid` | `reservations:read` | `FAIL_CLOSED` | `status`, dates, `guestRef`, room |
| `GET …/reservations/:rid/folio/payments` | `folio:read` | `FAIL_CLOSED` | holds / payment statuses |
| `POST …/guests/batch` `{ refs: [guestRef] }` | `guests:read` | existing | header name + erased / not_found / decrypt-unresolved |

### 3.3 Classify extensions

| Condition | Class | Retry |
|---|---|---|
| 403 (+ body `error: 'forbidden'`) | `forbidden` | never |
| 501 + body `error: 'psp_unavailable'` | `not_configured` | never |
| 409 + body `error: 'idempotency_key_reused'` | `idempotency_key_reused` | never |
| (unchanged) 503 `read_stale` | `read_stale` | yes |

`shouldRetry` remains **only** `read_stale` for all new classes.

Permission for `forbidden` copy: body.permission ?? route audit entry for the called route.

### 3.4 Mutations (API on `createClient`)

`addFolioLine`, `recordCashPayment`, `authorizePayment`, `capturePayment`, `splitFolioLine`, `splitFolioPayment`, `checkOut` — plus getters above. Idempotent posts use `stableKeyForOperation`; provisional recorders pass `{ reservationId }`.

### 3.5 Invalidation matrix

| Action | Writes | Invalidate |
|---|---|---|
| Add charge | folio line | folio |
| Cash | payment + folio line | folio + payments |
| Card authorize | payment only | **payments only** |
| Card capture | payment + folio line | folio + payments |
| Split / split payment | folio lines | folio |
| Checkout | reservation status | reservation |

---

## 4. Screen

### 4.1 Route & entry

- `/folio/:reservationId`
- Folio control on guest rows in **arrivals, departures, and in-house** (window exists at booking; deposits/prepay possible before check-in).

### 4.2 Regions (top → bottom)

1. Header — guest from batch-of-one, dates, status, room.
2. Balance chrome — server `balanceMinor` plus a holds summary derived from payments (optional rollup string).
3. **Holds list** — actionable rows from `get_folio_payments` (at least `paymentId`, `amountMinor`, `status`, `gatewayReference` when present). For each `authorized` (uncaptured) hold: **capture control** with an `amountMinor` field (default full remaining / authorized amount; partial capture allowed — server posts the adapter’s `capturedAmountMinor`). Authorize is a separate “new card payment” form in the actions region; capture is never a second mode of that form.
4. Folded line list.
5. Session queued log (this reservation + “other”).
6. Actions from `folioActionPolicy`: add charge, cash, **authorize** (new payment), split, checkout — plus per-row capture on holds (region 3).

### 4.3 Failure chrome

- Folio fail_closed: unreadable list; refuse charge/pay/split; checkout with required outage copy when policy allows.
- Reservation fail_closed, folio live: lines ok; checkout hidden.
- Action-local: `forbidden`, `not_configured`, `idempotency_key_reused` — inline, not full-page wipe.
- Provisional checkout: queued chrome, not “checked out.”

### 4.4 Presentation rules

- Admin splits always rendered (attempt → explain).
- Checkout with open balance: confirm, don’t hard-block.
- No shift open/close on this screen.

---

## 5. Verification

### 5.1 `client-core` canaries (plain vitest)

| Area | Mutation target |
|---|---|
| Fold | Drop reversal from “not live”; break live rule; lose `created_at` order; omit split-of-child case |
| Fold invariant | `liveTotalMinor` vs fixture `balanceMinor` (8-line taxed split; simple charge+tax; payment; orphan fixture) |
| `folioActionPolicy` | Flip refuse-charge or allow-checkout under folio fail_closed |
| Classify | 403 / 501 `psp_unavailable` / 409 `idempotency_key_reused`; other 409 ≠ that class; `shouldRetry` false for all three |
| Queued log | Context reservationId; filter + other group |
| Permission fallback | 403 bare body → audit permission used for copy input |

### 5.2 SPA wiring (non-optional)

| Check | Assert |
|---|---|
| Policy C wiring | Folio query fail_closed → charge submit **does not issue a request** (not merely warning visible) |
| Balance source | Chrome renders server `balanceMinor`, not `liveTotalMinor` |
| Authorize invalidation | After successful authorize, **payments** query refetches; folio query does **not** (authorize writes no folio line — `invalidate(folio)` alone reproduces the original invisible-hold bug) |
| Provisional checkout | Distinct from checked-out; status may remain `checked_in` |
| Board links | All three modes link to `/folio/:reservationId` |
| Shell mount | Screen usable under PropertyDO failure for checkout/queued-log paths |

### 5.3 Server

Wire test: taxed line on `readFolio` includes `taxOf` / `taxRuleId`.

---

## 6. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Catalog: `folio.add_item` class | Still `QUEUE_PROVISIONAL` if no client queues blind? |
| 2 | Session / permissions (or `/me`) | Enables hide vs disable; pairs with org-bootstrap |
| 3 | Normalize 403 bodies | **Retired** in [2026-08-09](./2026-08-09-get-property-partial-forbidden-bodies-design.md) — `check:forbidden-bodies` + room-type literals; client audit fallback removed |
| 4 | Unattributed cash | **Retired** in [2026-08-09 cashier shift SPA](./2026-08-09-cashier-shift-spa-design.md) — open/close chrome + folio warn-allow; posts may still be unattributed when cashier chooses no open shift |
| 5 | Collapsed split audit projection | Same fold inputs, different projection |
| 6 | Printable flat folio | Nesting off |
| 7 | Departed-with-balance workflow | Now producible via outage checkout |
| 8 | Charge-code / tax-rule settings UI | Different audience |
| 9 | client-core DOM lib + lint net | `tsconfig` needs `DOM` for `fetch`/`Headers`/…; `no-dom-in-client-core` is the only net, not a second net behind types. Non-shorthand `const { window: w } = g` aliases past the rule (shorthand still flags). Pre-existing since shell slice. |
| 10 | Folio action↔route key swap | **Retired** in [2026-08-09](./2026-08-09-get-property-partial-forbidden-bodies-design.md) — `routeKey` / `FOLIO_MUTATION_ROUTES` deleted; body.permission only |

**Retired this slice (mark done on payments leftover list):** UI half of auth-holds-invisible — screen shows holds beside balance via `get_folio_payments`. `balanceMinor` ignoring holds remains intentional.

---

## 7. Acceptance checklist

- [ ] `readFolio` returns `taxOf` / `taxRuleId`.
- [ ] Fold canaries green; recursion + order + orphan defect covered.
- [ ] `folioActionPolicy` canaries green; SPA charge submit issues no request when folio fail_closed.
- [ ] Balance chrome uses server `balanceMinor`; holds render as actionable rows with capture + amount; authorize invalidates payments only (not folio).
- [ ] `forbidden` / `not_configured` / `idempotency_key_reused` classified; `shouldRetry` unchanged except still only `read_stale`.
- [ ] Splits attempt → 403 explain (audit fallback when body omits permission).
- [ ] Checkout on folio; provisional vs completed chrome; nonzero balance confirm; outage copy required.
- [ ] Queued log filtered + “other”; guest header via batch-of-one on direct entry.
- [ ] Folio links from arrivals, departures, in-house.
- [ ] Leftovers §6 recorded; auth-holds UI leftover marked retired.

---

## 8. Open questions for later slices (not blocking)

None for implementation start. Catalog review (#1) and cashiering chrome (#4) are sequenced follow-ons, not unresolved design inside this vertical.
