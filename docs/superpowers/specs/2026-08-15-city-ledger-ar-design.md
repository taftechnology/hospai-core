# City ledger / AR

**Tree verified 2026-08-15 (post invoice generation close `811b2dd`):** `COMMAND_CATALOG` length **86** (`register.test.ts` ~726), `AUDIT_WRITER_COMMAND_IDS.size === 61` (`register.test.ts` ~269 and ~725), `V1_HTTP_ROUTE_AUDIT[140].id === 'post_invoice_void'` (`register.test.ts` ~717–723; `v1-http-routes.ts` ~835–840), `[138] post_invoices`, `[139] get_invoice`, `PROPERTY_SCHEMA_HEAD === 32` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~632), `PROPERTY_MIGRATIONS` tail v32 `invoice_generation` ~1253–1257 (`property-migrations.ts`), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1184–1193), `PLATFORM_GAPS === []` (`register.test.ts` ~727), catalog last entry `invoice.void` ~950–959 (`catalog.ts`), `folio_window.billed_party` TEXT ~34 (`0001_freeze_gate.sql`), `tryOpenFolioWindow` / `closeFolioWindowSync` ~13872–14038 (`property-do.ts`), `billedPartySlug` ~839 (`property-do.ts`), `tryGenerateInvoice` + R2 `invoices/{propertyId}/…` ~18116+ (`property-do.ts`), `EVENT_LOG_R2` binding, ARCHITECTURE §7.3 city ledger distinct from folio ~1270–1271.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** ARCHITECTURE.md §7.3 (~1257–1314, ~1270–1271); [folio money operations](./2026-08-12-folio-money-operations-design.md) (COMPANY windows, `billed_party`, window close); [invoice generation engine](./2026-08-15-invoice-generation-engine-design.md) (R2 snapshot index pattern); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (R2 put + sha256); [multi-currency folio](./2026-08-13-multi-currency-folio-design.md) (`ledger_amount_minor`); `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `packages/do-runtime/src/property-migrations.ts`.

**Closes:** Phase 1 leftover **11** ([progress campaign](../../.superpowers/sdd/progress-phase1-leftovers.md) ~40–50): city ledger / AR (property-local direct bill; not MASTER groups). ARCHITECTURE §7.3: “City ledger / AR: direct-bill corporate accounts, aging, statements — structurally distinct from guest folios.”

**Amends:** None. Bidirectional one-sentence pointers in folio-money / property-setup / guest-crm / exception-queue / tape-chart specs are the **final implementation task**, not this spec writer’s job.

---

## Executive summary

Ship a property-local **city ledger / accounts-receivable** vertical: a separate **`city_ledger_account`** aggregate (not a folio variant), an append-only **`city_ledger_entry`** AR ledger, and six commands — account CRUD, internal charge posting on COMPANY window close (with night-audit catch-up), payment receipt, and statement generation. **`billed_party`** on COMPANY folio windows becomes a **soft FK** to active ledger accounts for new writes; legacy free-text labels are grandfathered. Aging buckets (`current`, `30`, `60`, `90+`) are **derived at read time** from `business_date`, `terms_days`, and `__meta.business_date`. Statements freeze AR state into **R2 JSON** on `EVENT_LOG_R2` (same pattern as invoices; no PDF worker). Five HTTP routes expose account CRUD (archive via PATCH), payment receipt, and statement read; **no PATCH on entries**. Schema **v33**. Event consumer is **not MVP** — charge posting is synchronous inside the DO on window close and night audit.

---

## 1. Context & motivation

### 1.1 Problem statement

Corporate / direct-bill stays route charges to **COMPANY** folio windows. Today:

| Piece | Where (verified) |
|---|---|
| COMPANY windows + free-text `billed_party` | `folio_window.billed_party` TEXT; `tryOpenFolioWindow` ~13929–13949 |
| Window close (zero balance gate) | `tryCloseFolioWindow` / `closeFolioWindowSync` ~13872–14038 |
| Folio balances in ledger currency | `windowBalanceMinorSync` — `SUM(ledger_amount_minor)` ~13862–13869 |
| Invoice snapshots (guest fiscal docs) | [invoice generation engine](./2026-08-15-invoice-generation-engine-design.md) — **not** AR |
| ARCHITECTURE stance | City ledger is **distinct from guest folios**; do not model as a folio variant ~1270–1271 |

**Missing:** no corporate account registry, no AR ledger, no aging, no statements, no link between `billed_party` labels and authoritative accounts, no charge transfer from closed COMPANY windows into AR. Operators cannot track what Acme Corp owes across stays or record remittances.

### 1.2 What already exists (verified — do not re-spec)

| Piece | Where |
|---|---|
| GUEST / COMPANY / MASTER window kinds | `folio_window.kind`; GUEST window id `` `${reservationId}:GUEST` `` |
| COMPANY window id slug | `` `${reservationId}:COMPANY:${billedPartySlug(raw)}` `` ~13932–13934 |
| Routing rules → COMPANY / MASTER | [night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md) |
| R2 immutable bodies + SQLite index | Invoice pattern; `putReportObject` / `EVENT_LOG_R2` |
| Append-only folio | Corrections are reversing lines — AR follows same discipline for entries |

**Heads (frozen — this chunk moves catalog, writers, routes, property schema):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **86** | **92** — append six `city_ledger.*` after `invoice.void` |
| `AUDIT_WRITER_COMMAND_IDS.size` | **61** | **65** (+4 writers; `post_charge` exempt — see Lock 5) |
| `V1_HTTP_ROUTE_AUDIT` | `[140] = post_invoice_void` | **APPEND** `[141]`–`[145]` — **`[140]`–`[127]` unmoved** |
| `PROPERTY_SCHEMA_HEAD` | **32** | **33** — `city_ledger_account` + `city_ledger_entry` |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — catch-up hook inside existing `SNAPSHOT_REPORTS`; no 9th step |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.3 Scope in

1. **v33 migration** — `city_ledger_account` + `city_ledger_entry` (Lock 4).
2. **`billed_party` soft FK** — validate new COMPANY writes against active accounts; grandfather existing rows (Lock 6).
3. **Account CRUD commands** — `create_account`, `update_account`, `archive_account` (Lock 5).
4. **Append-only AR** — `post_charge` (internal), `receive_payment` (Lock 3, Lock 5).
5. **Window-close hook** — post charge when COMPANY window closes at zero balance (Lock 7).
6. **Night-audit catch-up** — post charges for closed COMPANY windows missing an AR charge row, inside `SNAPSHOT_REPORTS` (Lock 8).
7. **Derived aging** — read-time buckets from `business_date` + `terms_days` (Lock 2).
8. **`generate_statement`** — R2 JSON snapshot (Lock 9).
9. **Five HTTP routes** — account list/create/update/archive-via-PATCH, payment, statement read (Lock 10).
10. **SPA** — City Ledger screen: account list, detail (entries + aging), receive payment (Lock 11).
11. **Purge inventory** + `pnpm generate:ddl` (Lock 12).
12. Tests Lock 13; register + migrate pin updates.

### 1.4 Scope out (normative — name them so a later pass does not “fix” them here)

- MASTER group billing / allotments (Phase 2)
- Commission tracking (named leftover)
- Credit notes / invoice adjustments (already scoped out of invoice vertical)
- Recurring / `breakfast_rule` engine (ARCHITECTURE §16.5 DEFER)
- OrgDO-hosted chain-wide city ledger (property-local only)
- `billed_party` retroactive FK migration (grandfathered free-text)
- PDF statement worker (JSON only; client renders)
- PATCH / DELETE on `city_ledger_entry` (append-only; adjustments via new `adjustment` entries)
- Growing `NIGHT_AUDIT_STEPS`; moving `[140]`–`[127]`
- `CLASS_DENYLIST` edit; new exported error classes beyond existing non-export patterns
- Bidirectional leftover pointer sentences (final implementation task)
- Event consumer on `folio.window_closed` (belt-and-braces stretch — Lock 14)
- Invoice generation for COMPANY windows ([invoice spec](./2026-08-15-invoice-generation-engine-design.md) leftover **2**)

---

## 2. Locked decisions (verbatim — do not deviate)

1. **City ledger is a separate aggregate.** Not a folio variant. New `city_ledger_account` table (property-local) with `account_id`, `name`, `status` (`active`/`archived`), `credit_limit_minor`, `terms_days`, `created_at`, `updated_at`.
2. **COMPANY windows link to city ledger.** `billed_party` becomes a **soft FK** to `city_ledger_account.name` (or `account_id`). Existing free-text labels grandfathered; new writes must reference an active account.
3. **AR ledger is append-only.** New `city_ledger_entry` table: `entry_id`, `account_id`, `reservation_id`, `folio_window_id`, `kind` (`charge`, `payment`, `adjustment`), `amount_minor`, `currency`, `business_date`, `source`, `reference`, `created_at`. Charges post when a COMPANY window closes (or on night audit). Payments come from `city_ledger.receive_payment`.
4. **Aging is derived.** `current`, `30`, `60`, `90+` buckets computed from `business_date` vs `terms_days` at read time. No stored aging columns.
5. **Statements.** `city_ledger.generate_statement` produces a JSON snapshot in R2 (same pattern as invoices). Not a PDF worker.
6. **Commands.** `city_ledger.create_account`, `city_ledger.update_account`, `city_ledger.archive_account`, `city_ledger.post_charge` (internal — from window close), `city_ledger.receive_payment`, `city_ledger.generate_statement`.
7. **HTTP.** CRUD for accounts + receive payment + statement read. No PATCH on entries.
8. **Schema v33.** `city_ledger_account` + `city_ledger_entry` tables. `billed_party` stays TEXT but gains a CHECK or trigger to validate against active accounts for new writes.

---

## 3. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Separate aggregate, not a folio window kind

City ledger accounts live in **`city_ledger_account`**. They are **not** folio windows, not folio lines, and not invoice rows. COMPANY folio windows **reference** an account via `billed_party`; closing a COMPANY window **posts** a **`charge`** entry to AR. Guest folio mechanics (transfers, splits, tax) stay unchanged.

**Forbidden this chunk:**

- Modelling AR as a `folio_window` kind
- Writing AR payments as folio `PAYMENT` lines
- JOINing live folio lines on statement GET (snapshot only)

### Lock 2 — Derived aging (no stored buckets)

**Due date** for an entry: `dueDate = business_date + terms_days` (calendar days; `terms_days` from the account row **at read time**).

**Days overdue** at read: `daysOverdue = max(0, asOfDate - dueDate)` where `asOfDate` defaults to `__meta.business_date` (fallback UTC `YYYY-MM-DD` from DO clock if meta unset).

**Open balance** for an entry kind:

| `kind` | Sign in balance roll-up |
|---|---|
| `charge` | +`amount_minor` |
| `payment` | −`amount_minor` (payments stored as **positive** `amount_minor`; subtract in balance math) |
| `adjustment` | +/− per signed `amount_minor` |

**Bucket assignment** (each entry’s **remaining open amount** lands in exactly one bucket — allocate oldest-first when computing summary totals):

| Bucket | Condition (`daysOverdue`) |
|---|---|
| `current` | `0` (not yet due) |
| `30` | `1`–`30` |
| `60` | `31`–`60` |
| `90+` | `≥ 61` |

Account-level aging in list/detail responses:

```ts
type AgingBuckets = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  totalOpenMinor: number;
};
```

Computed in DO read RPCs; **never** persisted on account or entry rows.

### Lock 3 — Append-only AR entries

**No UPDATE or DELETE** on `city_ledger_entry`. Corrections post new `adjustment` entries with `source: 'desk'` and optional `reference` pointing at the original `entry_id`.

**Charge posting (one per COMPANY window):**

At COMPANY window close (folio balance must already be `0`), **`charge.amount_minor`** = **`postedReceivableMinor`**: sum of `folio_line.ledger_amount_minor` on that window where `charge_code != 'PAYMENT'` (direct-billed room/F&B/tax). Folio-side PAYMENT lines net the window to zero; AR **`receive_payment`** records corporate remittance separately.

**Idempotency:** partial unique index **one `charge` per `folio_window_id`** (see Lock 4). Replay → no-op / return existing entry.

**Implementation:** charge posting is **`postCityLedgerChargeSync`** — a **private sync method** on `PropertyDO`, **not** a dispatched command. Called directly from the parent command’s `transactionSync` (same class as `closeFolioWindowSync`). The `city_ledger.post_charge` catalog entry (Lock 5) is for audit/entitlement only; it does **not** get its own `runIdempotent` wrapper.

**Currency:** `currency` = property stored ledger currency (`readStoredLedgerCurrencySync()`).

### Lock 4 — Schema v33

Append to `PROPERTY_MIGRATIONS`; regenerate `migrations/do-property/0033_city_ledger_ar.sql`:

```sql
CREATE TABLE city_ledger_account (
  account_id          TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  credit_limit_minor  INTEGER NOT NULL CHECK (credit_limit_minor >= 0),
  terms_days          INTEGER NOT NULL CHECK (terms_days >= 0),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  UNIQUE (name)
);

CREATE INDEX city_ledger_account_status_idx
  ON city_ledger_account (status);

CREATE TABLE city_ledger_entry (
  entry_id          TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL,
  reservation_id    TEXT,
  folio_window_id   TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'adjustment')),
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  business_date     TEXT NOT NULL,
  source            TEXT NOT NULL,
  reference         TEXT,
  created_at        INTEGER NOT NULL,
  CHECK (length(business_date) = 10),
  CHECK (kind != 'payment' OR amount_minor > 0),
  CHECK (kind != 'charge' OR amount_minor > 0)
);

CREATE UNIQUE INDEX city_ledger_charge_window
  ON city_ledger_entry (folio_window_id)
  WHERE kind = 'charge' AND folio_window_id IS NOT NULL;

CREATE INDEX city_ledger_entry_account_idx
  ON city_ledger_entry (account_id, created_at);

CREATE INDEX city_ledger_entry_business_date_idx
  ON city_ledger_entry (account_id, business_date);
```

**Statement bodies:** R2-only (no third SQLite table — locked decision 8 allows only `city_ledger_account` + `city_ledger_entry`). `statementId` is a UUID embedded in the R2 key; idempotency cache holds `{ statementId, r2Key, sha256 }` for `(accountId, asOfDate)` replays.

**`billed_party` validation trigger** (belt-and-suspenders with DO preconditions):

```sql
CREATE TRIGGER folio_window_billed_party_city_ledger_insert
BEFORE INSERT ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  )
  -- grandfather: allow if an existing CLOSED/OPEN window already used this billed_party label
  AND NOT EXISTS (
    SELECT 1 FROM folio_window fw
    WHERE fw.kind = 'COMPANY' AND fw.billed_party = NEW.billed_party
  );
END;

CREATE TRIGGER folio_window_billed_party_city_ledger_update
BEFORE UPDATE OF billed_party ON folio_window
WHEN NEW.kind = 'COMPANY' AND NEW.billed_party IS NOT NULL
  AND (OLD.billed_party IS NULL OR OLD.billed_party != NEW.billed_party)
BEGIN
  SELECT RAISE(ABORT, 'city_ledger_billed_party_invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM city_ledger_account
    WHERE status = 'active'
      AND (name = NEW.billed_party OR account_id = NEW.billed_party)
  );
END;
```

**Note:** SQLite trigger `RAISE(ABORT, …)` maps to wire code `city_ledger_billed_party_invalid` in DO error translation. Grandfather path: if **any** prior COMPANY window row exists with the same `billed_party` text, INSERT is allowed even without a matching account (legacy labels).

**Semantics:**

| Column | Meaning |
|---|---|
| `city_ledger_account.name` | Human label; unique; matched by `billed_party` on new COMPANY windows |
| `credit_limit_minor` | Soft cap; `0` = no credit extended (still post charges — warn/block per Lock 5) |
| `terms_days` | Net terms from `business_date` for aging |
| `city_ledger_entry.source` | `'window_close'`, `'night_audit'`, `'desk'`, `'statement'` |
| `folio_window_id` on charge | Links AR charge to originating COMPANY window |

No FK from entries to `reservation` / `folio_window` (deploy-safety, invoice-class).

### Lock 5 — Commands

Append after `invoice.void` in `catalog.ts`:

#### `city_ledger.create_account`

| Field | Value |
|---|---|
| `id` | `city_ledger.create_account` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `events` | `['city_ledger.account_created']` |

**Input:**

```ts
{
  name: string;              // trim 1–128
  creditLimitMinor?: number; // default 0
  termsDays?: number;        // default 30
}
```

**Fingerprint:** `{ name: normalizedName }`

**Preconditions:**

| Check | Wire code | HTTP |
|---|---|---|
| Duplicate `name` (case-sensitive) | `city_ledger_account_exists` | **409** |
| Invalid name length | `validation_error` | **422** |

**Success:** insert row `status = 'active'`; audit; emit event.

→ `AUDIT_WRITER_COMMAND_IDS`

#### `city_ledger.update_account`

| Field | Value |
|---|---|
| `id` | `city_ledger.update_account` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `events` | `['city_ledger.account_updated']` |

**Input:**

```ts
{
  accountId: string;
  name?: string;
  creditLimitMinor?: number;
  termsDays?: number;
}
```

**Fingerprint:** `{ accountId, patch: stableSortedPatch }`

**Preconditions:**

| Check | Wire code | HTTP |
|---|---|---|
| Missing account | `city_ledger_account_not_found` | **404** |
| Archived account | `city_ledger_account_archived` | **409** |
| Name collision | `city_ledger_account_exists` | **409** |

→ `AUDIT_WRITER_COMMAND_IDS`

#### `city_ledger.archive_account`

| Field | Value |
|---|---|
| `id` | `city_ledger.archive_account` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `events` | `['city_ledger.account_archived']` |

**Input:** `{ accountId: string }`  
**Fingerprint:** `{ accountId }`

**Preconditions:** account exists; not already archived (idempotent replay OK).

**Mutation:** `status = 'archived'`, `updated_at = now`. Does **not** delete entries or alter `billed_party` on historical windows.

→ **`AUDIT_WRITER_EXEMPTIONS`** with reason: `Terminal status flip; appendAuditLogSync in txn (same pattern as config.put_domain exemption class)` — **does not** increment writer set; audit row still required.

#### `city_ledger.post_charge` (catalog entry only — not dispatched)

| Field | Value |
|---|---|
| `id` | `city_ledger.post_charge` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | *(omit — inherits parent command idempotency)* |
| `entitlement` | `pms.core` |
| `permission` | `folio:post` |
| `events` | *(none on this entry — see below)* |

**Catalog entry for audit/entitlement purposes only.** The actual implementation is the **private sync method** `postCityLedgerChargeSync`, called directly from the parent command’s `transactionSync` (same class as `closeFolioWindowSync`). **Not dispatched via `runIdempotent`** — it inherits the parent command’s idempotency (`folio.close_window` or `night_audit.run`). The partial unique index on `folio_window_id` provides idempotency at the DB level.

**Not HTTP-exposed.** Invoked from `tryCloseFolioWindow` (Lock 7) and night-audit catch-up inside Txn B (Lock 8).

**Events:** `city_ledger.charge_posted` is emitted by the **parent command** (`folio.close_window` or `night_audit.run`), not by `post_charge` itself.

**Input:**

```ts
{
  folioWindowId: string;
  source: 'window_close' | 'night_audit';
  actor: ActorContext;
}
```

**Fingerprint:** `{ folioWindowId }`

**Preconditions:**

| Check | Wire code |
|---|---|
| Window missing or not COMPANY | `not_found` |
| No resolvable account for `billed_party` | `city_ledger_account_not_found` |
| Account archived | `city_ledger_account_archived` |
| Charge already posted for window | return existing (idempotent) |
| `postedReceivableMinor > 0` and open AR + new charge exceeds `credit_limit_minor` | `city_ledger_credit_limit_exceeded` |

**Credit limit check:** `openBalanceMinor(accountId) + postedReceivableMinor > credit_limit_minor` → reject **before** close completes (window stays OPEN).

→ **`AUDIT_WRITER_EXEMPTIONS`** with reason: `Internal-only; invoked from folio.close_window / night audit; audit correlation via parent command audit row + entry source`

#### `city_ledger.receive_payment`

| Field | Value |
|---|---|
| `id` | `city_ledger.receive_payment` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:adjust` |
| `events` | `['city_ledger.payment_received']` |

**Input:**

```ts
{
  accountId: string;
  amountMinor: number;   // positive integer
  businessDate?: string; // default __meta.business_date
  reference?: string;    // check / wire ref, 1–128
}
```

**Fingerprint:** `{ accountId, amountMinor, businessDate, reference: ref ?? null }`

**Preconditions:**

| Check | Wire code | HTTP |
|---|---|---|
| Account missing | `city_ledger_account_not_found` | **404** |
| Account archived | `city_ledger_account_archived` | **409** |
| `amountMinor <= 0` | `validation_error` | **422** |
| Payment exceeds open balance | `city_ledger_payment_exceeds_balance` | **422** |

→ `AUDIT_WRITER_COMMAND_IDS`

#### `city_ledger.generate_statement`

| Field | Value |
|---|---|
| `id` | `city_ledger.generate_statement` |
| `lane` | INTERACTIVE |
| `degraded` | FAIL_CLOSED |
| `idempotent` | true |
| `entitlement` | `pms.core` |
| `permission` | `folio:read` |
| `events` | `['city_ledger.statement_generated']` |

**Input:**

```ts
{
  accountId: string;
  asOfDate?: string; // default __meta.business_date
}
```

**Fingerprint:** `{ accountId, asOfDate }`

**Preconditions:** account exists (archived OK); R2 bound.

**Success:** build snapshot (Lock 9); R2 put; return `{ statementId, r2Key, sha256 }` (no SQLite index row).

→ `AUDIT_WRITER_COMMAND_IDS`

**Catalog totals:** `COMMAND_CATALOG.length === 92`.  
**Writers (+4):** `create_account`, `update_account`, `receive_payment`, `generate_statement` → size **65**.  
**Exemptions (+0 net new ids in set):** add `post_charge` and `archive_account` entries to `AUDIT_WRITER_EXEMPTIONS` array.

### Lock 6 — `billed_party` soft FK (COMPANY windows)

**New writes** (`tryOpenFolioWindow` when `kind === 'COMPANY'`):

1. Accept `billedParty` as **`account_id`** OR **`name`** string.
2. Resolve to active `city_ledger_account` row.
3. Persist `billed_party = account.name` (canonical label) on `folio_window` even if input was `account_id`.
4. Window id slug uses `billedPartySlug(account.name)` — **existing** slug algorithm unchanged.

**Grandfathered labels:** existing COMPANY rows keep their `billed_party` text. **New** opens and **close/post** require a resolvable **active** account (create an account whose `name` matches the legacy label before closing).

Update `tryOpenFolioWindow` validation; triggers from Lock 4 as belt.

### Lock 7 — Charge posting on COMPANY window close

Inside `tryCloseFolioWindow` `runIdempotent` callback, **after** balance gate passes and **before** `closeFolioWindowSync`:

```ts
if (window.kind === 'COMPANY') {
  const postResult = this.postCityLedgerChargeSync({
    folioWindowId: input.folioWindowId,
    source: 'window_close',
    actor,
  });
  if (!postResult.ok) throw new CityLedgerError(postResult.error);
}
this.closeFolioWindowSync(...);
```

`postCityLedgerChargeSync` implements Lock 3 + Lock 5 `post_charge` semantics (idempotent on `folio_window_id`).

**GUEST / MASTER:** unchanged (no AR post).

### Lock 8 — Night-audit catch-up (no new step)

Inside **Txn B** (the sync transaction) of the existing **`SNAPSHOT_REPORTS`** step handler — **not** in the async pre-phase (`snapshotReportsAsync` runs before Txn B). Catch-up runs alongside `indexReportPutsSync` so it is atomic with the step completion marker:

```ts
} else if (step === 'SNAPSHOT_REPORTS') {
  this.indexReportPutsSync(businessDate);
  this.postPendingCityLedgerChargesForBusinessDateSync(businessDate);
}
```

**Selection:** COMPANY windows with `status = 'CLOSED'`, `closed_at` on `businessDate`, and **no** existing `city_ledger_entry` charge for `folio_window_id`.

**Source:** `'night_audit'`. Same idempotency index as window-close path.

**Does not** grow `NIGHT_AUDIT_STEPS`.

### Lock 9 — Statement R2 snapshot

**Key:** `city-ledger-statements/{propertyId}/{accountId}/{statementId}.json`

**Binding:** `EVENT_LOG_R2` via `assertEventLogR2Bound()` / invoice-class helper; unbound → `city_ledger_r2_unbound`.

**Snapshot schema** (`schemaVersion: 1`):

| Field | Source |
|---|---|
| `statementId`, `accountId`, `propertyId` | Generated |
| `asOfDate` | Input / meta business date |
| `generatedAt` | epoch ms |
| `account` | `{ name, termsDays, creditLimitMinor, status }` at generation |
| `ledgerCurrency` | stored ledger currency |
| `aging` | Lock 2 buckets + `totalOpenMinor` |
| `entries[]` | Open entries as of date: `{ entryId, kind, amountMinor, businessDate, dueDate, daysOverdue, reservationId, folioWindowId, source, reference, createdAt }` |
| `totals` | `{ chargesMinor, paymentsMinor, adjustmentsMinor, openMinor }` |

**Generate flow:** mirror `tryGenerateInvoice` — prepare snapshot in `transactionSync`, `await bucket.put` outside txn, then persist idempotency response (no SQLite statement table).

### Lock 10 — HTTP routes

Append after `[140]` in `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` — **exactly five entries**:

| Audit id | Method | Path | Permission | commandId |
|---|---|---|---|---|
| `[141] post_city_ledger_accounts` | POST | `/v1/properties/:propertyId/city-ledger/accounts` | `folio:adjust` | `city_ledger.create_account` |
| `[142] get_city_ledger_accounts` | GET | `/v1/properties/:propertyId/city-ledger/accounts` | `folio:read` | — (`degradedRead: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`) |
| `[143] patch_city_ledger_account` | PATCH | `/v1/properties/:propertyId/city-ledger/accounts/:accountId` | `folio:adjust` | `city_ledger.update_account` or `city_ledger.archive_account` when `body.status === 'archived'` |
| `[144] post_city_ledger_account_payment` | POST | `/v1/properties/:propertyId/city-ledger/accounts/:accountId/payments` | `folio:adjust` | `city_ledger.receive_payment` |
| `[145] get_city_ledger_statement` | GET | `/v1/properties/:propertyId/city-ledger/accounts/:accountId/statements/:statementId` | `folio:read` | — (`degradedRead: 'FAIL_CLOSED'`) |

**List vs detail (single GET route `[142]`):** when query **`accountId`** is absent, return account summaries + aging. When **`?accountId={uuid}`** is present, return the detail shape (entries, aging, recent `statementIds[]` from idempotency/log — last 20 generate responses for that account). No sixth audit row for `GET …/accounts/:accountId`.

**Statement generate (no HTTP audit row):** SPA invokes **`city_ledger.generate_statement`** via PropertyDO RPC (`tryGenerateCityLedgerStatement`). Response includes **`snapshot`** inline plus `{ statementId, r2Key, sha256 }` for **`[145]`** re-fetch.

#### Request / response shapes

**POST create `[141]`:**

```json
{
  "idempotencyKey": "uuid",
  "name": "Acme Corp",
  "creditLimitMinor": 500000,
  "termsDays": 30
}
```

**201:** `{ "ok": true, "accountId": "uuid", "name": "Acme Corp", "status": "active", "creditLimitMinor": 500000, "termsDays": 30 }`

**GET list or detail `[142]`:**

Query params: `status=active|all` (default `active`); **`accountId`** (optional) — when set, return detail shape.

**200 list:**

```json
{
  "accounts": [
    {
      "accountId": "uuid",
      "name": "Acme Corp",
      "status": "active",
      "creditLimitMinor": 500000,
      "termsDays": 30,
      "aging": {
        "currentMinor": 0,
        "days30Minor": 15000,
        "days60Minor": 0,
        "days90PlusMinor": 0,
        "totalOpenMinor": 15000
      }
    }
  ]
}
```

**200 detail** (`?accountId=uuid`):

```json
{
  "accountId": "uuid",
  "name": "Acme Corp",
  "status": "active",
  "creditLimitMinor": 500000,
  "termsDays": 30,
  "aging": { },
  "entries": [
    {
      "entryId": "uuid",
      "kind": "charge",
      "amountMinor": 15000,
      "currency": "USD",
      "businessDate": "2026-08-01",
      "reservationId": "res_1",
      "folioWindowId": "res_1:COMPANY:acme-corp",
      "source": "window_close",
      "reference": null,
      "createdAt": 1234567890
    }
  ],
  "statements": [
    { "statementId": "uuid", "asOfDate": "2026-08-15", "generatedAt": 1234567890, "r2Key": "city-ledger-statements/…" }
  ]
}
```

**PATCH `[143]`:**

```json
{
  "idempotencyKey": "uuid",
  "name": "Acme Corporation",
  "creditLimitMinor": 750000,
  "termsDays": 45,
  "status": "archived"
}
```

When `status === 'archived'`, dispatch **`city_ledger.archive_account`** (ignore other patch fields).

**POST payment `[144]`:**

```json
{
  "idempotencyKey": "uuid",
  "amountMinor": 15000,
  "businessDate": "2026-08-15",
  "reference": "CHK-8842"
}
```

**201:** `{ "ok": true, "entryId": "uuid", "openBalanceMinor": 0 }`

**Wire constants** (`packages/contracts/src/idempotency.ts`):

```ts
export const CITY_LEDGER_ACCOUNT_NOT_FOUND = 'city_ledger_account_not_found' as const;
export const CITY_LEDGER_ACCOUNT_EXISTS = 'city_ledger_account_exists' as const;
export const CITY_LEDGER_ACCOUNT_ARCHIVED = 'city_ledger_account_archived' as const;
export const CITY_LEDGER_CREDIT_LIMIT_EXCEEDED = 'city_ledger_credit_limit_exceeded' as const;
export const CITY_LEDGER_BILLED_PARTY_INVALID = 'city_ledger_billed_party_invalid' as const;
export const CITY_LEDGER_PAYMENT_EXCEEDS_BALANCE = 'city_ledger_payment_exceeds_balance' as const;
export const CITY_LEDGER_STATEMENT_NOT_FOUND = 'city_ledger_statement_not_found' as const;
export const CITY_LEDGER_R2_UNBOUND = 'city_ledger_r2_unbound' as const;
export const CITY_LEDGER_CHARGE_ALREADY_POSTED = 'city_ledger_charge_already_posted' as const;
```

**HTTP map:** `*_NOT_FOUND` → **404**; `*_EXISTS` / `*_ARCHIVED` / `*_ALREADY_POSTED` → **409**; `*_EXCEEDED` / `*_EXCEEDS_BALANCE` / `*_INVALID` → **422**; `*_R2_UNBOUND` → **503**.

**GET statement `[145]`:**

**200:**

```json
{
  "statementId": "uuid",
  "accountId": "uuid",
  "asOfDate": "2026-08-15",
  "r2Key": "city-ledger-statements/{propertyId}/{accountId}/{statementId}.json",
  "sha256": "hex",
  "generatedAt": 1234567890,
  "snapshot": { }
}
```

Handler loads R2 object by key; missing object → **404** `city_ledger_statement_not_found`.

### Lock 11 — SPA (`CityLedgerScreen`)

New screen: `apps/web-pms/src/screens/CityLedgerScreen.tsx`

1. **Account list** — table from `GET …/accounts` with aging columns (`data-testid="city-ledger-list"`).
2. **Create account** — modal form → POST create (`data-testid="city-ledger-create"`).
3. **Account detail** — route `/city-ledger/:accountId`; entries table + aging summary (`data-testid="city-ledger-detail"`).
4. **Receive payment** — modal on detail → POST payment (`data-testid="city-ledger-payment"`).
5. **Generate statement** — button calls DO RPC generate; render snapshot JSON client-side (`data-testid="city-ledger-statement"`). Optional: fetch body via GET `[145]` by `statementId`.
6. **Archive** — PATCH `status: 'archived'` with confirm.

**Navigation:** add **City ledger** entry to front-desk shell nav (same class as Shift / Night audit).

**Folio integration (minimal):** when opening COMPANY window on Folio, **`billedParty`** autocomplete from active accounts (`GET …/accounts`); free-text disabled for new windows.

**Client (`packages/client-core/src/api.ts`):**

- `listCityLedgerAccounts(propertyId)`
- `getCityLedgerAccount(propertyId, accountId)`
- `createCityLedgerAccount(propertyId, body)`
- `updateCityLedgerAccount(propertyId, accountId, body)`
- `receiveCityLedgerPayment(propertyId, accountId, body)`
- `generateCityLedgerStatement(propertyId, accountId, body)` — RPC
- `getCityLedgerStatement(propertyId, accountId, statementId)`

### Lock 12 — Purge + DDL

Add to `PROPERTY_PURGE_INVENTORY_TABLES` alphabetically:

- `'city_ledger_account'`
- `'city_ledger_entry'`

R2 prefix: `city-ledger-statements/{propertyId}/` in `purge-workflow.ts` (mirror `invoicesPrefixForProperty`).

Run `pnpm generate:ddl` → `0033_city_ledger_ar.sql`; migrate test pin `PROPERTY_SCHEMA_HEAD === 33`.

### Lock 13 — Tests (normative — TDD: failing tests first)

File-filter vitest. **No `vi.spyOn` into DO isolate.**

**`apps/pms-core/test/city-ledger-ar.spec.ts`** (new):

1. Create account — happy path; duplicate name → **409** `city_ledger_account_exists`
2. Update account — patch name/limit/terms; archived → **409**
3. Archive account — idempotent; OPEN COMPANY window referencing account still closes
4. Open COMPANY window with active account name — succeeds; `billed_party` canonicalized to account name
5. Open COMPANY window with unknown label — **422** `city_ledger_billed_party_invalid`
6. Grandfather — pre-existing `billed_party` text without account allows **legacy row** read; **new** open with same text without account → **422**
7. Post charge on COMPANY close — creates `charge` entry; folio window CLOSED
8. Duplicate close/post — idempotent single charge row
9. Credit limit exceeded — close blocked → **422** `city_ledger_credit_limit_exceeded`; window stays OPEN
10. Receive payment — reduces open balance; overpayment → **422** `city_ledger_payment_exceeds_balance`
11. Aging buckets — seed entries across dates; assert derived buckets on GET detail
12. Generate statement — R2 object + idempotent replay; no SQLite statement table
13. GET statement `[145]` — returns snapshot from R2; unknown → **404**
14. Night-audit catch-up — closed COMPANY window without charge gets posted under `night_audit` source
15. Unbound R2 on generate → **503** `city_ledger_r2_unbound`

**`apps/web-pms/src/screens/CityLedgerScreen.test.tsx`** (new):

1. List renders aging totals from mock API
2. Create account flow
3. Payment modal posts and refreshes open balance

**Register pins after land:**

- `COMMAND_CATALOG.length === 92`
- `AUDIT_WRITER_COMMAND_IDS.size === 65`
- `V1_HTTP_ROUTE_AUDIT[140].id === 'post_invoice_void'` (unchanged)
- `V1_HTTP_ROUTE_AUDIT[141].id === 'post_city_ledger_accounts'` … `[145].id === 'get_city_ledger_statement'`
- `PROPERTY_SCHEMA_HEAD === 33`
- `ORG_SCHEMA_HEAD === 7`
- `NIGHT_AUDIT_STEPS.length === 8`

### Lock 14 — Event consumer (stretch — not MVP)

**Not MVP.** Charge posting is **synchronous** in `tryCloseFolioWindow` (Lock 7) and night audit (Lock 8). Optional stretch: `folio.window_closed` consumer calls `post_charge` with dedupe on `folioWindowId` — same idempotency index prevents double post. Failures → DLQ; never silent skip.

---

## 4. Error taxonomy

| Wire code | HTTP | When |
|---|---|---|
| `city_ledger_account_not_found` | 404 | Missing account on resolve/post/pay/generate |
| `city_ledger_account_exists` | 409 | Duplicate `name` on create/rename |
| `city_ledger_account_archived` | 409 | Mutate archived account or post new charge |
| `city_ledger_credit_limit_exceeded` | 422 | Charge would exceed `credit_limit_minor` |
| `city_ledger_billed_party_invalid` | 422 | COMPANY open/update with unregistered label |
| `city_ledger_payment_exceeds_balance` | 422 | Payment > open AR balance |
| `city_ledger_charge_already_posted` | 409 | Explicit duplicate post (non-idempotent callers) |
| `city_ledger_statement_not_found` | 404 | GET statement missing R2 object |
| `city_ledger_r2_unbound` | 503 | `EVENT_LOG_R2` unbound on generate |

Internal classes (non-export): `CityLedgerError`, `CityLedgerCreditLimitExceededError`, `CityLedgerBilledPartyInvalidError` — map to wire codes in dispatch.

---

## 5. Rollback / migration notes

| Scenario | Action |
|---|---|
| Deploy v33 forward | Online migration adds two tables + triggers; no rebuilds of folio tables |
| Roll back code before v33 | Old code ignores new tables |
| Roll back code after v33 | Extra tables inert; triggers inactive if code path avoids INSERT |
| Grandfathered `billed_party` | Never auto-migrated; manual account creation + new windows only |
| AR entries | **Irreversible** — no DELETE; reversing entries only via `adjustment` |
| R2 statements | Never deleted on code rollback; purge workflow handles property wipe |

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v33 statements + tail |
| `migrations/do-property/0033_city_ledger_ar.sql` | generated |
| `packages/contracts/src/idempotency.ts` | nine wire codes |
| `packages/contracts/src/commands/catalog.ts` | +6 commands after `invoice.void` |
| `packages/contracts/src/commands/audit-writers.ts` | +4 writers; +2 exemptions |
| `packages/contracts/src/v1-http-routes.ts` | +5 routes after `[140]` |
| `packages/contracts/src/register.test.ts` | pin updates |
| `packages/do-runtime/src/migrate.test.ts` | schema head **33** |
| `apps/pms-core/src/property-do.ts` | account CRUD, entries, aging reads, close hook, night-audit catch-up, statement R2 |
| `apps/pms-core/src/v1-dispatch.ts` | five handlers + error map |
| `apps/pms-core/src/purge-workflow.ts` | city-ledger R2 prefix |
| `packages/client-core/src/api.ts` | city ledger client methods |
| `apps/web-pms/src/screens/CityLedgerScreen.tsx` | new screen |
| `apps/web-pms/src/screens/FolioScreen.tsx` | COMPANY `billedParty` account picker |
| `apps/pms-core/test/city-ledger-ar.spec.ts` | Lock 13 |
| `apps/web-pms/src/screens/CityLedgerScreen.test.tsx` | Lock 13 SPA |

**Not touched:** `ORG_SCHEMA_HEAD`, `NIGHT_AUDIT_STEPS` array, `PLATFORM_GAPS`, `CLASS_DENYLIST`, `ARCHITECTURE.md`.

---

## 7. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Commission tracking** | ARCHITECTURE §7.3 mention; scope-out |
| 2 | **MASTER group billing** | Phase 2 |
| 3 | **HTTP POST generate statement** | MVP uses DO RPC; add audited route if external API needed |
| 4 | **Adjustment entry desk UI** | MVP adjustments admin-only via future command |
| 5 | **Event consumer on `folio.window_closed`** | Lock 14 stretch |
| 6 | **COMPANY window invoice generation** | Invoice spec leftover **2** |

### Leftover pointer closes (final implementation task — one sentence each)

| Spec | Section | Current text | Close when |
|---|---|---|---|
| [property-setup SPA](./2026-08-13-property-setup-spa-design.md) | §19 #6 | “City ledger / AR \| §7.3” | Replace with closed pointer to this spec |
| [guest-crm directory](./2026-08-13-guest-crm-directory-design.md) | §12 #7 | “City ledger / AR \| §7.3” | Same |
| [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md) | §10 #8 | “City ledger / AR \| §7.3” | Same |
| [tape-chart live board](./2026-08-13-tape-chart-live-board-design.md) | §13 #5 | “City ledger / AR \| §7.3” | Same |

Invoice pointers (**#7** / **#6** / **#9** / **#6** respectively) already closed to [invoice generation engine](./2026-08-15-invoice-generation-engine-design.md) — **do not revert**.

---

## 8. Implementation checklist

- [ ] v33 migration + `PROPERTY_SCHEMA_HEAD` **33** + purge tables + R2 prefix + triggers
- [ ] Wire codes + HTTP status map (`CITY_LEDGER_*`)
- [ ] Catalog **92** + audit writers **65** + exemptions for `post_charge` / `archive_account` + five HTTP routes **`[141]–[145]`**
- [ ] DO account CRUD + entry posting + aging reads + statement R2
- [ ] COMPANY close hook + night-audit catch-up in `SNAPSHOT_REPORTS` (Txn B)
- [ ] `billed_party` validation in `tryOpenFolioWindow` + triggers
- [ ] HTTP handlers + client API + City Ledger SPA + Folio account picker
- [ ] Tests Lock 13 (TDD order); `pnpm generate:ddl`
- [ ] Register pins: catalog **92**, writers **65**, `[140]` unchanged, `[141]–[145]`, schema **33**, steps **8**
- [ ] Leftover pointer closes in property-setup §19, guest-crm §12, exception-queue §10, tape-chart §13
- [ ] CI: file-filter vitest; shard syntax; Workerd retry; last-task checkbox only

---

## 9. Tree conflicts with reviewer locks

**None on heads.** Verified post-`811b2dd`: catalog **86**, writers **61**, `[140] post_invoice_void` last, `PROPERTY_SCHEMA_HEAD` **32** (this chunk → **33**), `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'`, `PLATFORM_GAPS === []`, invoice R2 pattern ready, `folio_window.billed_party` TEXT with no FK, COMPANY close path ready for hook.

**Notes for implementer (not lock violations):**

1. **Five HTTP routes** — `[141]` POST create, `[142]` GET list/detail (`?accountId=`), `[143]` PATCH, `[144]` POST payment, `[145]` GET statement; generate via DO RPC only.
2. **Grandfathered labels** — trigger + DO must agree; trigger allows INSERT when prior row with same `billed_party` exists.
3. **Charge amount semantics** — non-PAYMENT line sum (Lock 3); document in audit `afterJson`.
4. **Credit limit `0`** — still enforce; properties that want “unlimited” set a high limit in UI.
5. **Degraded** — all `city_ledger.*` commands `FAIL_CLOSED` (ARCHITECTURE §4.6).

**Concerns:**

| Concern | Mitigation locked |
|---|---|
| Double AR post on close retry | Partial unique index on charge + idempotency |
| Free-text legacy stragglers | Block close until account exists; night audit surfaces unposted windows |
| Statement drift | Immutable R2 snapshot; regenerate = new `statementId` |
| Folio ↔ AR confusion | Separate tables; no folio line on AR payment |
