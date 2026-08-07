# Tax Posting (Exclusive / US-shaped)

**Date:** 2026-08-07  
**Status:** Approved  
**Sources:** ARCHITECTURE.md §5.1 rule 5 (closed lines immutable under rule change), §7.3 (folio / charge codes / allocate), §7.9 (exclusive launch tax), §11 (`packages/money` tax primitives — currently absent), §14 (Phase 1); [charge-code registry](./2026-08-07-charge-code-registry-design.md); [folio charges](./2026-08-05-folio-charges-vertical-design.md); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md); [property-migrations.ts](../../../packages/do-runtime/src/property-migrations.ts) (v14 `charge_code` + `folio_line` FK); [packages/money](../../../packages/money/src/index.ts); domain config `pms.money.tax_registry` / `affectsTaxMoney` (retired this slice)

**Implementation order:** this slice → [cashiering](./2026-08-07-cashiering-design.md) → [audit log](./2026-08-07-audit-log-design.md). Design settled in one pass; land separately so split-path canaries stay single-mutation.

---

## 1. Context & Motivation

Charge codes are now a registry with FK. Tax still has nowhere to live: `packages/money` exports currency/rounding/`allocate`/`postToLedger` but **no tax primitives** despite ARCHITECTURE §11 naming them. Domain config keeps a hollow `pms.money.tax_registry` array and an unread `affectsTaxMoney` consumer flag — both retired when `tax_rule` lands. Folio writers stamp net amounts only.

Exclusive (US-shaped) launch tax was decided with the registry slice: rates stay net; tax posts as **separate folio lines**. Tourist/`PER_PERSON_PER_NIGHT` stays out until reservation occupancy exists — the domain CHECK still lists those rule types; the app rejects them.

The load-bearing interaction is **split × tax**. `splitFolioLineSync` reverses a parent and posts children; it never touches dependents. A 100.00 taxable charge with an 8.00 tax line, split 60/40, leaves an orphaned 8.00 tax pointing at a reversed parent. That is the direct consequence of today's reverse+children shape — not a future edge.

### Scope in

1. **`tax_rule` table** — effective-dated, immutable versions, `rule_key` identity, `tax_group` scope, `rate TEXT`, `output_charge_code` FK.
2. **`charge_code.tax_group`** — `ADD COLUMN` nullable; `NULL` = exempt.
3. **`folio_line.tax_of`** (self-FK), **`folio_line.tax_rule_id`** — nullable `ADD COLUMN`s; tax lines use `source = 'TAX'`.
4. **`folio_line_tax_uniq`** — structural double-post guard for tax (app also requires both columns non-NULL on TAX rows — §2.2).
5. **Stamp tax at post** on every new taxable charge (add_item, night-audit room, …); skip PAYMENT / SPLIT_REVERSAL / TAX.
6. **Rule selection by posting business date** — never wall-clock (§2.5).
7. **Split path: allocate stamped tax** across children — no rate recompute, no `tax_rule` lookup.
8. **`packages/money` tax helper** — BigInt decimal-string path, mirrors FX.
9. **Remove `pms.money.tax_registry` and `affectsTaxMoney`** — one home for rules; no invented consumer (§2.8).
10. **Reject direct split of `source = 'TAX'`** → `LINE_NOT_SPLITTABLE`.

### Scope out

- Tourist / city tax evaluation; reservation occupancy.
- Inclusive tax; redefining `rate_day` as gross.
- Cashiering / shifts / cash tender ([cashiering spec](./2026-08-07-cashiering-design.md)).
- Audit log table ([audit log spec](./2026-08-07-audit-log-design.md)).
- Window routing; city ledger / AR; `folio.transfer_charge` (must inherit the same dependent-clear invariant when it lands).
- `folio_window.status` closure.

---

## 2. Design Decisions

### 2.1 Split × tax — allocate, don't recompute (Q1)

**Reject** distinct tax-reversal events (no consumer; tax lines already emit `folio.line_posted`).  
**Reject** recompute-on-child: drifts under rounding, and re-taxes at today's rate when an old charge is split — violates §5.1 rule 5.

**Lock:** reverse the parent's tax lines alongside the parent, then **`allocate` each reversed tax total across children by child amount**. Split never consults `tax_rule`.

Implications:

| Rule | Detail |
|---|---|
| Per tax line | State + city are two lines; each allocates independently and each foots |
| Order in one `transactionSync` | reverse parent → reverse parent's tax → post children → post allocated child tax |
| Reversed tax `source` | `'SPLIT_REVERSAL'` (non-splittable; outside tax uniq) |
| Recursion | Splitting a child re-allocates from that child's stamped tax; still no rule lookup |
| Payment split | Do **not** call `allocate` on negative payment weights — payments aren't taxed; guard looks like a bug if hit |
| Invariant | Every reversal path through this helper clears dependents before children land (generalises to transfer later) |

### 2.2 Tax line identity vs night-audit uniq (Q2)

`folio_line_audit_uniq (reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` guards double room posts. Tax is a dependent stamp, not a second room posting.

**Lock:** tax lines use **`source = 'TAX'`** — never `NULL`, never `'NIGHT_AUDIT'`.

- **NULL is wrong:** partial indexes with `source <> '…'` drop NULL rows; NULL is already the discriminator for ordinary split children.
- **Own guard:**
  ```sql
  CREATE UNIQUE INDEX folio_line_tax_uniq
    ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX';
  ```
  One tax line per (parent, rule) when both columns are non-NULL. Inherited protection via sharing a txn with room is not enough once tax can post outside that step.
- **Limit (named):** SQLite treats NULLs as distinct in unique indexes. A `source = 'TAX'` row with NULL `tax_of` or NULL `tax_rule_id` **escapes the index entirely**. Without a `folio_line` rebuild we cannot add a CHECK. The guard is therefore **index + application invariant**: every writer that inserts `source = 'TAX'` must set both `tax_of` and `tax_rule_id` non-NULL. Matrix test: every TAX line carries both. Do not call the index alone "enough."
- **`'TAX'` on the split reject list** with `PAYMENT` / `SPLIT_REVERSAL` → `LINE_NOT_SPLITTABLE`. Tax is only split by allocation from its parent. Own matrix test (same class as payment-child leak).

Output charge codes (`TAX`, jurisdiction codes, …) are normal registry rows with **`tax_group IS NULL`**.

### 2.3 Rounding — per line, then sum (Q3)

**Lock:** compute and stamp tax **per taxable folio line** at post; folio tax = sum of those rows. Folio-total or close-time true-up rejected (move closed lines / cashiering entanglement).

**Owned drift:** folio-displayed tax may differ by pennies from `balance × rate`. Document; do not "fix" into folio-total later.

**Money helper** (new; ARCHITECTURE §11 finally true):

```ts
computeTax(baseMinor: number, rate: string): number
// parseTaxRate(rate) → { num, den }  — reject negatives; do NOT reuse validateFxRate
// Number(roundHalfAwayFromZero(BigInt(baseMinor) * num, den))
// Number.isSafeInteger guard
```

- `tax_rule.rate` is **`TEXT`**, matching `folio_line.fx_rate`.
- Factor decimal-string→bigint parse with FX, or colocate — **one** rounding implementation.
- **Allocated child tax does not satisfy `base × rate`.** Only post-time computation does. Spec that explicitly.
- **`allocate` remainder policy:** document `'LAST'` (or chosen policy) with deliberately arbitrary child order — systematic bias is accepted, not emergent.

### 2.4 `tax_rule` + `tax_group` (Q4)

**Reject** property-wide rules + `charge_code.taxable`: cannot express occupancy tax on room vs sales tax on goods.  
**Reject** shipping both `taxable` and per-rule scope — two places to say exempt.

**Lock:** the deferred registry carrier is **`tax_group`**, not `taxable`:

```sql
-- on charge_code (ADD COLUMN)
tax_group  TEXT NULL   -- NULL = exempt

-- new table
CREATE TABLE tax_rule (
  tax_rule_id         TEXT PRIMARY KEY,
  rule_key            TEXT NOT NULL,          -- stable across versions
  name                TEXT NOT NULL,
  rule_type           TEXT NOT NULL
    CHECK (rule_type IN ('PERCENTAGE', 'PER_PERSON_PER_NIGHT', 'FLAT')),
  rate                TEXT NOT NULL,          -- decimal string, BigInt path
  tax_group           TEXT NOT NULL,          -- applies to codes in this group
  output_charge_code  TEXT NOT NULL
    REFERENCES charge_code(code),
  valid_from          TEXT NOT NULL,          -- ISO date
  valid_to            TEXT,                   -- NULL = open-ended
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
```

| Decision | Lock |
|---|---|
| Exempt | `charge_code.tax_group IS NULL` (PAYMENT, tax outputs, forgotten codes → under-tax, visible) |
| Stacking | Multiple rules may share a `tax_group` with overlapping windows (state + city) |
| Supersession | Same `rule_key` must not overlap `[valid_from, valid_to)` — **app check + test**, not SQLite |
| Immutability | No in-place rate edit; edit = close old (`valid_to = D`) + insert new (`valid_from = D`, same `rule_key`) |
| Audit | `tax_rule_id` on the tax line reconstructs rate; **do not** stamp rate on the line |
| Output FK | App requires output code's `tax_group IS NULL` or engine taxes its own output |
| Launch | App rejects `rule_type <> 'PERCENTAGE'` → `TAX_RULE_TYPE_UNSUPPORTED` |

**Migration:** v15. Additive: `charge_code.tax_group`, `folio_line.tax_of` / `tax_rule_id`, `tax_rule`, indexes. **No `folio_line` rebuild** — that was the point of the v14 FK.

**Self-FK on `tax_of` — take it:**

```sql
ALTER TABLE folio_line ADD COLUMN tax_of TEXT
  REFERENCES folio_line(folio_line_id);
```

Same shape as `payment_id` in v13: NULL default, every existing row NULL, nothing to orphan. `split_of` being unconstrained is a **precedent for the gap**, not a justification for leaving a sixth entity-less reference when the constraint is an `ADD COLUMN` away.

### 2.5 Rule selection date + what is not taxable

**Rule selection date (lock):**

> Rule selection uses the **business date of the posting** — `provisional.businessDate` on replay (`ProvisionalContext` / `assertProvisionalBusinessDateOpen` already carry it), the property's current business date otherwise. **Never wall-clock, never "now."**

Ad-hoc `folio.add_item` lines have no `business_date` column requirement (CHECK only for `NIGHT_AUDIT`). Selection must still use a business date, not the wall clock — otherwise a charge queued Aug 6 (`QUEUE_PROVISIONAL`) and replayed Aug 7 after a rate change is taxed at Aug 7's rate: the same retroactivity §5.1 rule 5 forbids and §2.1 rejects recompute-on-split to avoid.

**Engine skips** tax evaluation when any of:

1. Parent `source = 'PAYMENT'`
2. Parent `source = 'SPLIT_REVERSAL'`
3. Parent `source = 'TAX'` (no tax on tax)
4. Parent charge code's `tax_group IS NULL`
5. No `tax_rule` rows matching `(tax_group, postingBusinessDate ∈ [valid_from, valid_to))`

None of these (nor provisional replay under a superseded rate) are caught by a foots-correctly balance test — each needs an explicit case.

### 2.6 Night audit

`POST_ROOM_CHARGES` posts `ROOM` with `source = 'NIGHT_AUDIT'`. Room tax posts **in the same step / same `transactionSync`**, as `source = 'TAX'` lines with `tax_of` → the room line. Tax does not use `NIGHT_AUDIT` source (Q2).

**Retry safety:** the room line id is deterministic for a given reservation/date, so a Workflow retry that re-inserts tax hits **`folio_line_tax_uniq` on `(tax_of, tax_rule_id)`** and aborts the txn. That is the real guard — not inherited reliance on `folio_line_audit_uniq` for the room row alone. Sharing a transaction with the room post is still correct (atomic stamp), but §2.2's point stands: tax must not depend on the room index for its own double-post protection.

### 2.7 Schema sketch — folio_line additions

```sql
ALTER TABLE folio_line ADD COLUMN tax_of TEXT
  REFERENCES folio_line(folio_line_id);
ALTER TABLE folio_line ADD COLUMN tax_rule_id TEXT;  -- NULL for non-tax / pre-slice rows
-- App invariant: source = 'TAX' ⇒ both columns non-NULL (§2.2)

CREATE UNIQUE INDEX folio_line_tax_uniq
  ON folio_line (tax_of, tax_rule_id) WHERE source = 'TAX';

CREATE INDEX folio_line_tax_of_idx ON folio_line (tax_of) WHERE tax_of IS NOT NULL;
```

Seed at least one active output code (e.g. `TAX`) with `tax_group NULL` if product wants a default; operators may add jurisdiction codes.

### 2.8 Retire hollow tax config

**Lock: delete both** in this slice:

| Artifact | Action |
|---|---|
| `pms.money.tax_registry` (`DOMAIN`, `z.array(json)`, default `[]`) | **Remove** from the config register and tests. After `tax_rule`, leaving it gives tax two homes — the same objection §2.4 raises against shipping `taxable` beside per-rule scope. |
| `affectsTaxMoney` consumer flag | **Remove** from `ConfigConsumers` and every entry that sets it. Tax is stamped at post; rules are immutable versions. No config change can invalidate a closed line, so wiring the flag means inventing a consumer to justify it. |

Deleting them together is the coherent pair. Update ARCHITECTURE / domain-config docs that still list `tax_registry` as the tax home.

---

## 3. Commands, events, errors (sketch)

| Concern | Direction |
|---|---|
| CRUD `tax_rule` | Create / supersede (close+insert) / list effective; no in-place rate PATCH |
| Charge code | Extend update to set `tax_group` (or dedicated command) |
| Errors | `TAX_RULE_TYPE_UNSUPPORTED`, overlap / key conflicts, output-code-taxable, `LINE_NOT_SPLITTABLE` for TAX |
| Events | Tax lines → existing `folio.line_posted`; optional `tax_rule.changed` for consumers |
| Permissions | settings-like for rules; folio writers unchanged |

Exact catalog/HTTP indices land in the implementation plan against current route audit head.

---

## 4. Test matrix (minimum)

| # | Case | Expect |
|---|---|---|
| 1 | Post taxable code with active % rule | Charge + tax line; `tax_of` / `tax_rule_id` both non-NULL; `source = 'TAX'` |
| 2 | `tax_group NULL` code | No tax line |
| 3 | Stacked two rules same group | Two tax lines; uniq holds |
| 4 | Split taxed charge 60/40 | Parent tax reversed; child taxes allocate and foot parent tax exactly |
| 5 | Split after rate change | Child tax from allocate, **not** new rate |
| 6 | Direct split of tax line | `LINE_NOT_SPLITTABLE` |
| 7 | Night audit room + tax | Both in one step; retry hits `folio_line_tax_uniq` (no duplicate tax) |
| 8 | PAYMENT / SPLIT_REVERSAL / TAX parents | Never taxed |
| 9 | Supersede rule (close + insert same `rule_key`) | Old closed lines unchanged; new posts use new rule id |
| 10 | Overlapping same `rule_key` insert | Rejected |
| 11 | Non-`PERCENTAGE` rule create | `TAX_RULE_TYPE_UNSUPPORTED` |
| 12 | Output code with non-NULL `tax_group` | Rejected |
| 13 | `computeTax` / rate TEXT / negative rate | Money package unit tests |
| 14 | Seed / DDL sync | `check:ddl` + migrate sync |
| 15 | Every `source = 'TAX'` line | `tax_of` and `tax_rule_id` both non-NULL (app invariant for the uniq index) |
| 16 | Provisional: queue under rule v1, supersede rate, replay | Tax matches **v1** (posting business date, not replay wall-clock) |
| 17 | Config register | `pms.money.tax_registry` gone; `affectsTaxMoney` gone |

Canaries that must fail under single mutation: drop allocate → use recompute (test 4/5); omit `'TAX'` from split reject (test 6); select rules by wall-clock on provisional replay (test 16); insert TAX with NULL `tax_rule_id` (test 15).

---

## 5. Acceptance

1. Unregistered path unchanged; taxable posts stamp tax rows; exempt / payment / reversal / tax parents never tax.
2. Split of a taxed charge foots parent tax via allocate; never reconsults rules; never orphans tax.
3. Tax lines are not directly splittable; writers set both `tax_of` and `tax_rule_id`; `folio_line_tax_uniq` blocks double tax when both are set; self-FK on `tax_of`.
4. Rules are effective-dated and immutable per version; `rule_key` supersession enforced in app; selection uses posting business date (including provisional replay).
5. `packages/money` exports a real tax primitive on the BigInt path; `tax_rule.rate` is TEXT.
6. `pms.money.tax_registry` and `affectsTaxMoney` removed — `tax_rule` is the only home.
7. No `folio_line` rebuild; checks green; single-mutation canaries documented in the plan.

---

## 6. Leftovers (after this slice)

| Item | Note |
|---|---|
| Tourist / `PER_PERSON_*` | Needs reservation occupancy |
| Inclusive tax | Launch fork already exclusive |
| `folio.transfer_charge` dependent clear | Same invariant as split |
| Cashiering / cash / shifts | Next slice |
| Audit log | Third slice |
| Window routing | Separate |
| Cash outage / provisional | Cashiering leftovers |

---

## 7. Open questions

None. Settled: allocate-not-recompute; `source = 'TAX'` + uniq with named NULL limit + app invariant; self-FK on `tax_of`; per-line rounding; `tax_group` + `rule_key` immutability; posting business date for rule selection; delete `tax_registry` + `affectsTaxMoney`.
