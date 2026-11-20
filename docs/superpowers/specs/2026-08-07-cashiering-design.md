# Cashiering (Shifts + Cash Tender)

**Date:** 2026-08-07  
**Status:** Approved — implementation-ready  
**Sources:** ARCHITECTURE.md §7.7 (multi-workstation front desk), §7.3 / §14 (night audit steps, audit log named separately); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [tax posting](./2026-08-07-tax-posting-design.md) (independent — tax's "don't tax PAYMENT" holds with or without cash); [charge-code registry](./2026-08-07-charge-code-registry-design.md); PropertyDO payment authorize/capture PSP gates; [permissions.ts](../../../packages/contracts/src/permissions.ts) (`staff` = `folio:read` / `folio:post` only)

**Implementation order:** after tax. **Audit log is not this slice** — see [audit log](./2026-08-07-audit-log-design.md). Design settled with tax in one pass; land separately so split-path canaries stay attributable. Migration head after tax is **v16**.

---

## 1. Context & Motivation

Night audit lists `CLOSE_CASHIER_SHIFTS` as step 4; the body is still a stub in the empty `else`. Payments are card-shaped: `pending → authorized → captured` behind a PSP adapter. Cash has no authorization, no gateway, and settles instantly — forcing it through that machine invents fiction in an append-only ledger.

Cashiering is **drawer attribution**, not a posting gate. Gating folio writers on an open shift would put a `FAIL_CLOSED` prerequisite in front of `QUEUE_PROVISIONAL` paths — the same collision class as checkout-and-balance.

### Scope in

1. **`shift` table** — per-cashier open/close, `business_date`, float/count/variance, force-close status.
2. **`payment.shift_id`**, **`payment.tender_type`** — `ADD COLUMN`s at **v16**.
3. **Cash tender** — `folio.record_cash_payment`: single `transactionSync`, no PSP gate, posts `captured` + negative folio line.
4. **Reject `folio.capture` on CASH** → `PAYMENT_NOT_CAPTURABLE`.
5. **`CLOSE_CASHIER_SHIFTS`** — force-close open shifts for the audit's `business_date` (not invent a zero count).
6. **Attribution overlay** — stamp acting user's open shift; never block post.
7. **Permission alignment** — cash + shifts + card authorize/capture on **`folio:post`** (see §2.4).

### Scope out

- Audit log / `audit.append` implementation ([own slice](./2026-08-07-audit-log-design.md)).
- Tax posting (prior slice).
- `PRE_CHECK` / `PROCESS_NO_SHOWS` / `SNAPSHOT_REPORTS` night-audit stubs.
- City ledger / AR; departed-with-balance; auth-hold visibility.
- Provisional cash during outage (leftover — see §2.1 / §5).
- Gate posts on open shift (rejected — overlay only).

---

## 2. Design Decisions

### 2.1 Cash tender — honest path (Q5)

**Reject** fake `authorized` + synthetic gateway reference.  
**Reject** a separate `cash_payment` table (doubles every folio reader).

**Lock:**

| Item | Detail |
|---|---|
| `tender_type` | `'CARD' \| 'CASH'` on `payment` at v16. **Amended 2026-11-19 (R4.18):** `'CARD' \| 'CASH' \| 'UPI'`. v48 rebuilds the CHECK and adds `payment.external_reference`. UPI is recorded (`folio.record_upi_payment`), not collected. See the amendment below. |
| Command | **`folio.record_cash_payment`** — own catalog entry; **`folio:post`** (not `folio:adjust` — see §2.4); entitlement `pms.core`; events `folio.payment_captured` + `folio.line_posted` |
| Write shape | One `transactionSync`: insert `payment` at **`captured`**, insert negative `PAYMENT` folio line; `gateway_reference` NULL; `capture_fingerprint` NULL; `request_fingerprint` for idempotency |
| PSP gate | **Must not consult** `pspSimulateEnabled()` / adapter availability. Inheriting authorize/capture's `PSP_UNAVAILABLE` → **501 in production** (`HOSPAI_UNSAFE_LOCAL` is off). Highest-risk footgun — looks green under simulate-on tests |
| Capture on cash | Explicit reject of a non-PSP tender (`isPspTender` is `tender === 'CARD'`) → **`PAYMENT_NOT_CAPTURABLE`** (not misleading `IDEM_KEY_REUSED` from NULL fingerprint compare). CASH and UPI both take this path. |
| Degraded | **`FAIL_CLOSED` this slice** — reason: *shift attribution cannot survive provisional replay* (queue at 11pm, replay at 2am → wrong/closed shift), **not** "payments are fail-closed as a class." Door open if queue payload later stamps shift-at-queue-time |
| `readPayment` | `gatewayReference` legitimately NULL for an entire tender type — clients must not treat NULL as "not yet authorized" |

**Leftover:** cash taken during an outage has no record until recovery (reconciliation / shrinkage window).

**Amendment (2026-11-19, R4.18).** v16's CHECK stays the historical shape. PropertyDO v48 rebuilds `payment` (and the child tables that reference it) so `tender_type` is `CARD | CASH | UPI` and adds nullable `external_reference`. `folio.record_upi_payment` mirrors cash: one `transactionSync`, status `captured`, negative `PAYMENT` line, `gateway_reference` NULL, no PSP call, `FAIL_CLOSED` for the same shift-attribution reason. The reference is required, trimmed, `/^[A-Za-z0-9]{6,35}$/`, and unique among captured UPI payments (`duplicate_upi_reference`). Expected cash stays `opening_float + Σ captured CASH`. Shift summary adds informational per-tender totals (Cash, Card, UPI) and does not change the variance formula or the unattributed-cash check. Refunds of UPI use `folio.refund` on the local path; an optional reference is stored on the refund folio line. When R4.12 accounting export is built, UPI needs its own ledger mapping. No bank transfer, cheque, voucher, or gift.

### 2.2 Shifts — overlay + force-close (Q6)

**Night audit open shifts:**

| Reject | Why |
|---|---|
| Fail the audit | Wedges business date on forgotten close — nightly reality |
| Force-close with `closing_count = 0` | Fabricates a shortage equal to the whole drawer |
| Close *all* open shifts | Hits overnight cashier's next-day shift |

**Lock force-close:**

- Target: `WHERE business_date = ? AND status = 'OPEN'` for the audit's date.
- Write: `closing_count NULL`, `status = 'FORCE_CLOSED'`, variance **uncomputable** (`NULL`).
- Reporting: `FORCE_CLOSED` = missing control; `CLOSED` + variance = discrepancy. Different management problems.

**`shift.business_date` required.** An 11pm–7am shift opened on day D closes at D's audit; a new shift opens on D+1. Note: a shift opened between `CLOSE_CASHIER_SHIFTS` (step 4) and `ROLL_BUSINESS_DATE` (step 6) carries the pre-roll date — harmless, documented.

**Attribution:**

- Stamp **`cashier_user_id = actor.userId AND status = 'OPEN'`** — not "any open shift." Multi-workstation desk (§7.7) means many opens concurrently; wrong pick is the failure cashiering exists to prevent.
- No open shift for that actor → `shift_id NULL`, **still posts**.
- System / night-audit / `REPLAY_ACTOR` → always NULL.

**Cost of overlay (named):** cash with `shift_id NULL` is physically in a drawer but belongs to **no** shift's expected total — it reconciles to nothing, forever. That is the honest price of choosing overlay over gate (still correct for degraded-mode reasons). Not a bug in variance math. Leftovers §5; mitigation: close / `readShift` surfaces unattributed cash count for that `business_date` so the gap is visible where someone is already looking.

**Structural singleton:**

```sql
CREATE UNIQUE INDEX shift_open_per_cashier
  ON shift (cashier_user_id) WHERE status = 'OPEN';
```

**Boundary:** `shift_id` on **`payment` only**, not `folio_line`. Charges aren't drawer events; overlay stays off split/reversal paths — what makes overlay cheap.

**Not a posting gate.** No shift command in front of folio writers / provisional queue.

### 2.3 Schema sketch

```sql
CREATE TABLE shift (
  shift_id          TEXT PRIMARY KEY,
  cashier_user_id   TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  opened_at         INTEGER NOT NULL,
  closed_at         INTEGER,
  opening_float     INTEGER NOT NULL,  -- minor units; required at open
  closing_count     INTEGER,           -- NULL if uncounted / force-closed
  variance          INTEGER,           -- NULL if uncomputable (force-close)
  status            TEXT NOT NULL
    CHECK (status IN ('OPEN', 'CLOSED', 'FORCE_CLOSED')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX shift_open_per_cashier
  ON shift (cashier_user_id) WHERE status = 'OPEN';

-- DEFAULT is the backfill; CHECK matches payment.status creation style.
-- Verifiable on the real-SQLite harness before commit (charge-code slice precedent).
ALTER TABLE payment ADD COLUMN tender_type TEXT NOT NULL DEFAULT 'CARD'
  CHECK (tender_type IN ('CARD', 'CASH'));

ALTER TABLE payment ADD COLUMN shift_id TEXT REFERENCES shift(shift_id);
```

`shift_id` is nullable with NULL default — nothing to orphan on existing rows (same shape as `tax_of` / `payment_id` ADD COLUMNs).

No separate nullable-discriminator phase: capture's reject-edge is binary (`CASH` → not capturable; `CARD` → existing machine).

### 2.4 Commands, permissions, variance

**Permission principle (control decision):**

> **`folio:post`** = bring money in (charge, cash, authorize, capture).  
> **`folio:adjust`** = move or modify money already posted (split, split payment, transfer).

Under that rule the whole surface falls out consistently. Staff carry `folio:read` / `folio:post` only ([permissions.ts](../../../packages/contracts/src/permissions.ts)); they do **not** have `folio:adjust`. Putting cash or shifts on `folio:adjust` would lock the front desk out of the drawer cashiering exists for. `folio.split_charge_payment` staying on `folio:adjust` is a **consequence** of the principle, not an exception.

**Widening (named):** moving `folio.authorize` / `folio.capture` from `folio:adjust` → `folio:post` means every `staff` user can charge a card on file. Correct for a hotel front desk; also a **privilege expansion on existing routes** inside a slice named "cashiering." State it as a deliberate control decision under the principle above — not a silent convention observation — so a later access review does not read it as scope creep.

| Command | Permission | Notes |
|---|---|---|
| `folio.open_shift` | `folio:post` | Cashier opens with `opening_float` |
| `folio.close_shift` | `folio:post` | Count → variance (formula below) |
| `folio.record_cash_payment` | `folio:post` | Cash tender path |
| `folio.authorize` / `folio.capture` | `folio:post` | **Widen** from today's `folio:adjust` |
| `folio.split_charge` / `folio.split_charge_payment` | `folio:adjust` | Unchanged — modify posted money |
| Night audit `CLOSE_CASHIER_SHIFTS` | system / night_audit lane | Force-close OPEN for `business_date` |

**Touch list per widened command** (three places; `check:permissions` compares audit ↔ routes element-wise — partial edit fails the build):

1. Catalog `permission` field (`folio.authorize` / `folio.capture` are `folio:adjust` today).
2. Matching `V1_HTTP_ROUTE_AUDIT` row.
3. Matching `V1_ROUTES` entry (+ handler `FORBIDDEN` permission string if hardcoded).

**Variance formula (normal close only):**

```
expected = opening_float
         + Σ(payment.amount_minor
             WHERE shift_id = this.shift_id
               AND tender_type = 'CASH'
               AND status = 'captured')
variance = expected − closing_count
```

| Case | Result |
|---|---|
| Correct count | `variance = 0`, `status = 'CLOSED'` |
| Short by 500 (count 500 below expected) | `variance = 500` |
| Force-close | `closing_count NULL`, `variance NULL`, `status = 'FORCE_CLOSED'` — formula not applied |

Only **captured CASH** attributed to **this** `shift_id` enters `expected`. Card payments, other cashiers' shifts, and unattributed (`shift_id NULL`) cash do not. `opening_float` is NOT NULL at open — no coalesce needed.

---

## 3. Test matrix (minimum)

| # | Case | Expect |
|---|---|---|
| 1 | Record cash | Payment `captured`, folio PAYMENT line, no PSP call |
| 2 | Cash with simulate-off / prod-like env | Succeeds (not 501) |
| 3 | Capture on CASH payment | `PAYMENT_NOT_CAPTURABLE` |
| 4 | Actor with open shift | `payment.shift_id` stamped |
| 5 | Actor without open shift | Posts; `shift_id NULL` |
| 6 | Two OPEN shifts same cashier | Storage reject (uniq) |
| 7 | Two cashiers open | Both OK; cash stamps correct actor |
| 8 | Force-close at audit | `FORCE_CLOSED`, `closing_count NULL`, variance NULL |
| 9 | Force-close scopes by `business_date` | Other date's OPEN untouched |
| 10 | Kill-switch / unentitled on cash + shift mutates | 503 / 402 |
| 11 | Card path unchanged (except permission) | Existing payments suite green; authorize/capture require `folio:post` |
| 12 | Staff actor records cash + opens/closes shift (+ authorize/capture) | Succeeds (`folio:post`) |
| 12a | Staff actor `post_folio_split` | **403** — pins `folio:adjust` boundary (charge-codes test 15 shape: permitted + denied in one pair) |
| 13 | Close with correct count | `CLOSED`, `variance = 0` |
| 14 | Close short by 500 | `CLOSED`, `variance = 500` |
| 15 | Cash on cashier A's shift; cashier B closes | B's `expected` excludes A's payments |
| 16 | Close / readShift reports unattributed cash count for business date | Visible when `shift_id NULL` cash exists that day |

Canary: cash method that still checks `pspSimulateEnabled` must fail test 2 under simulate-off.  
Canary: even-weight or wrong-sum variance → tests 13/14 fail.  
Canary: `folio:adjust` on cash/shift → test 12 fails for staff.  
Canary: widen everything to `folio:post` → test 12a fails.

**Plan note:** verify `tender_type` `NOT NULL DEFAULT 'CARD' CHECK (...)` on the real-SQLite harness before commit (charge-code v14 precedent).

---

## 4. Acceptance

1. Cash posts without adapter and without PSP availability gate.
2. Card path and reject-edge table for capture unchanged for CARD; authorize/capture gated on **`folio:post`**.
3. Shifts attribute by acting user; never gate posts; open-per-cashier is unique.
4. Normal close computes variance per §2.4; force-close leaves count/variance NULL.
5. Night audit force-closes the audit date's open shifts without fabricating a zero count.
6. Staff can open/close shifts and record cash (`folio:post`).
7. No audit-log table in this slice; `audit.append` remains catalog-only until the audit-log slice.

---

## 5. Leftovers

| Item | Note |
|---|---|
| Cash during outage | No record until recovery; provisional + stamped shift is a future option |
| **Unattributed cash** | Possible by design (overlay): `shift_id NULL` never enters any shift's expected. Diagnose reconciliation gaps here before variance math. Mitigated partially by test 16 / close response count |
| `FAIL_CLOSED` → provisional for cash | Only if queue payload carries shift-at-enqueue |
| Per-cashier audit trail | Belongs to [audit log](./2026-08-07-audit-log-design.md), not born here |
| Other night-audit stubs | PRE_CHECK / PROCESS_NO_SHOWS / SNAPSHOT_REPORTS |
| SPA `gatewayReference` NULL | Clients must not mean "unauthorized" |
| UPI ledger mapping | R4.12 accounting export is not built. When it is, UPI needs its own ledger mapping. Not a bank transfer. |
| Per-tender shift totals | Informational Cash / Card / UPI sums on the open shift and the receipt. Expected cash and unattributed cash stay CASH-only. |

---

## 6. Open questions

None. Settled: cash command + no PSP gate; force-close with NULL count; per-actor stamp; overlay not gate (with named unattributed-cash cost); **`folio:post` = bring money in / `folio:adjust` = modify posted** (cash, UPI, shifts, authorize, capture → post; split / split-payment stay adjust); variance = `opening_float + Σ(captured CASH on this shift) − closing_count` (UPI is not in that sum); `tender_type` is `CARD | CASH | UPI` after the 2026-11-19 amendment; audit log separate. No bank transfer, cheque, voucher, or gift.
