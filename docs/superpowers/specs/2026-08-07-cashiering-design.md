# Cashiering (Shifts + Cash Tender)

**Date:** 2026-08-07  
**Status:** Draft — design questions locked; awaiting review  
**Sources:** ARCHITECTURE.md §7.7 (multi-workstation front desk), §7.3 / §14 (night audit steps, audit log named separately); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [tax posting](./2026-08-07-tax-posting-design.md) (independent — tax's "don't tax PAYMENT" holds with or without cash); [charge-code registry](./2026-08-07-charge-code-registry-design.md); PropertyDO payment authorize/capture PSP gates

**Implementation order:** after tax. **Audit log is not this slice** — see [audit log](./2026-08-07-audit-log-design.md). Design settled with tax in one pass; land separately so split-path canaries stay attributable.

---

## 1. Context & Motivation

Night audit lists `CLOSE_CASHIER_SHIFTS` as step 4; the body is still a stub in the empty `else`. Payments are card-shaped: `pending → authorized → captured` behind a PSP adapter. Cash has no authorization, no gateway, and settles instantly — forcing it through that machine invents fiction in an append-only ledger.

Cashiering is **drawer attribution**, not a posting gate. Gating folio writers on an open shift would put a `FAIL_CLOSED` prerequisite in front of `QUEUE_PROVISIONAL` paths — the same collision class as checkout-and-balance.

### Scope in

1. **`shift` table** — per-cashier open/close, `business_date`, float/count/variance, force-close status.
2. **`payment.shift_id`**, **`payment.tender_type`** — `ADD COLUMN`s (cheap at v15 or v16).
3. **Cash tender** — `folio.record_cash_payment`: single `transactionSync`, no PSP gate, posts `captured` + negative folio line.
4. **Reject `folio.capture` on CASH** → `PAYMENT_NOT_CAPTURABLE`.
5. **`CLOSE_CASHIER_SHIFTS`** — force-close open shifts for the audit's `business_date` (not invent a zero count).
6. **Attribution overlay** — stamp acting user's open shift; never block post.

### Scope out

- Audit log / `audit.append` implementation ([own slice](./2026-08-07-audit-log-design.md)).
- Tax posting (prior slice).
- `PRE_CHECK` / `PROCESS_NO_SHOWS` / `SNAPSHOT_REPORTS` night-audit stubs.
- City ledger / AR; departed-with-balance; auth-hold visibility.
- Provisional cash during outage (leftover — see §2.3).

---

## 2. Design Decisions

### 2.1 Cash tender — honest path (Q5)

**Reject** fake `authorized` + synthetic gateway reference.  
**Reject** a separate `cash_payment` table (doubles every folio reader).

**Lock:**

| Item | Detail |
|---|---|
| `tender_type` | `'CARD' \| 'CASH'` on `payment` |
| Command | **`folio.record_cash_payment`** — own catalog entry; `folio:adjust`; entitlement `pms.core`; events `folio.payment_captured` + `folio.line_posted` |
| Write shape | One `transactionSync`: insert `payment` at **`captured`**, insert negative `PAYMENT` folio line; `gateway_reference` NULL; `capture_fingerprint` NULL; `request_fingerprint` for idempotency |
| PSP gate | **Must not consult** `pspSimulateEnabled()` / adapter availability. Inheriting authorize/capture's `PSP_UNAVAILABLE` → **501 in production** (`HOSPAI_UNSAFE_LOCAL` is off). Highest-risk footgun — looks green under simulate-on tests |
| Capture on cash | Explicit reject `tender_type = 'CASH'` → **`PAYMENT_NOT_CAPTURABLE`** (not misleading `IDEM_KEY_REUSED` from NULL fingerprint compare) |
| Degraded | **`FAIL_CLOSED` this slice** — reason: *shift attribution cannot survive provisional replay* (queue at 11pm, replay at 2am → wrong/closed shift), **not** "payments are fail-closed as a class." Door open if queue payload later stamps shift-at-queue-time |
| `readPayment` | `gatewayReference` legitimately NULL for an entire tender type — clients must not treat NULL as "not yet authorized" |

**Leftover:** cash taken during an outage has no record until recovery (reconciliation / shrinkage window).

### 2.2 Shifts — overlay + force-close (Q6)

**Night audit open shifts:**

| Reject | Why |
|---|---|
| Fail the audit | Wedges business date on forgotten close — nightly reality |
| Force-close with `closing_count = 0` | Fabricates a shortage equal to the whole drawer |
| Close *all* open shifts | Hits overnight cashier's next-day shift |

**Lock force-close:**

- Target: `WHERE business_date = ? AND status = 'OPEN'` for the audit's date.
- Write: `closing_count NULL`, `status = 'FORCE_CLOSED'`, variance **uncomputable**.
- Reporting: `FORCE_CLOSED` = missing control; `CLOSED` + variance = discrepancy. Different management problems.

**`shift.business_date` required.** An 11pm–7am shift opened on day D closes at D's audit; a new shift opens on D+1. Note: a shift opened between `CLOSE_CASHIER_SHIFTS` (step 4) and `ROLL_BUSINESS_DATE` (step 6) carries the pre-roll date — harmless, documented.

**Attribution:**

- Stamp **`cashier_user_id = actor.userId AND status = 'OPEN'`** — not "any open shift." Multi-workstation desk (§7.7) means many opens concurrently; wrong pick is the failure cashiering exists to prevent.
- No open shift for that actor → `shift_id NULL`, **still posts**.
- System / night-audit / `REPLAY_ACTOR` → always NULL.

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
  opening_float     INTEGER,           -- minor units
  closing_count     INTEGER,           -- NULL if uncounted / force-closed
  variance          INTEGER,           -- NULL if uncomputable
  status            TEXT NOT NULL
    CHECK (status IN ('OPEN', 'CLOSED', 'FORCE_CLOSED')),
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX shift_open_per_cashier
  ON shift (cashier_user_id) WHERE status = 'OPEN';

ALTER TABLE payment ADD COLUMN tender_type TEXT;  -- 'CARD' | 'CASH'; CHECK or app
ALTER TABLE payment ADD COLUMN shift_id TEXT REFERENCES shift(shift_id);
```

Backfill existing payments: `tender_type = 'CARD'`, `shift_id NULL`.

### 2.4 Commands (sketch)

| Command | Role |
|---|---|
| `folio.open_shift` / `folio.close_shift` | Cashier open (float) / close (count → variance) |
| `folio.record_cash_payment` | Cash tender path |
| Night audit `CLOSE_CASHIER_SHIFTS` | Force-close OPEN for `business_date` |

Permissions: shift open/close likely `folio:adjust` or a dedicated cashier permission — plan picks against existing RBAC keys.

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
| 11 | Card path unchanged | Existing payments suite green |

Canary: cash method that still checks `pspSimulateEnabled` must fail test 2 under simulate-off.

---

## 4. Acceptance

1. Cash posts without adapter and without PSP availability gate.
2. Card path and reject-edge table for capture unchanged for CARD.
3. Shifts attribute by acting user; never gate posts; open-per-cashier is unique.
4. Night audit force-closes the audit date's open shifts without fabricating a zero count.
5. No audit-log table in this slice; `audit.append` remains catalog-only until the audit-log slice.

---

## 5. Leftovers

| Item | Note |
|---|---|
| Cash during outage | No record until recovery; provisional + stamped shift is a future option |
| `FAIL_CLOSED` → provisional for cash | Only if queue payload carries shift-at-enqueue |
| Per-cashier audit trail | Belongs to [audit log](./2026-08-07-audit-log-design.md), not born here |
| Other night-audit stubs | PRE_CHECK / PROCESS_NO_SHOWS / SNAPSHOT_REPORTS |
| SPA `gatewayReference` NULL | Clients must not mean "unauthorized" |

---

## 6. Open questions

None. Settled: cash command + no PSP gate; force-close with NULL count; per-actor stamp; overlay not gate; audit log separate.
