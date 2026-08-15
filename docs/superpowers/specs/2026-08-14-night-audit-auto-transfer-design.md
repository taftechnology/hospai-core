# Night-audit auto-transfer + folio routing rules

**Tree verified 2026-08-14:** `COMMAND_CATALOG` length **77** (`register.test.ts` ~642), `V1_HTTP_ROUTE_AUDIT[127].id === 'post_demo_seed'` (`register.test.ts` ~619; `v1-http-routes.ts` ~747–749), `[101] post_folio_refund` / `[102] post_folio_discount` (`register.test.ts` ~625–631; `v1-http-routes.ts` ~565–577), `[128] post_folio_stay_discount` (`register.test.ts` ~633–638; `v1-http-routes.ts` ~751–756), `AUDIT_WRITER_COMMAND_IDS.size === 52` (`register.test.ts` ~641), `PROPERTY_SCHEMA_HEAD === 27` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **7** (`property-do.ts` ~1055–1063), `PLATFORM_GAPS === []` (`register.test.ts` ~643), charge-code HTTP `[50] post_charge_codes` … `[53] get_charge_codes` (`register.test.ts` ~1059–1062; `v1-http-routes.ts` ~284–307).

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** ARCHITECTURE.md §7.3 (~1295–1305 auto-transfer constraint, append-only transfer); §8 (~1536–1591 night-audit machine, `folio_line_audit_uniq`); [folio money operations](./2026-08-12-folio-money-operations-design.md) §4.2–4.3 (transfer primitive; auto-transfer deferred leftover **1**); [charge-code registry](./2026-08-07-charge-code-registry-design.md) leftover “Window routing rules table” (~251); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (7-step pin ~430); `apps/pms-core/src/property-do.ts` (`NIGHT_AUDIT_STEPS` ~1055–1063, `runAuditStep` ~2568–2670, `tryTransferCharge` ~13027–13218, `guestFolioWindowId` ~11937–11939, `tryOpenFolioWindow` COMPANY id ~12061–12070, `insertFolioLineSync` ~12260–12282, `postRoomChargesSync` ~12475–12540); `apps/pms-core/src/night-audit-workflow.ts` (iterates `NIGHT_AUDIT_STEPS` ~36–48); `packages/contracts/src/commands/catalog.ts` (`folio.transfer_charge` ~433–441; charge-code commands ~321–348); `packages/contracts/src/v1-http-routes.ts`; `packages/contracts/src/commands/audit-writers.ts` (~18, ~29); `apps/pms-core/src/v1-dispatch.ts` (charge-code handlers ~3747–3906; `tryTransferCharge` dispatch ~4899); `packages/client-core/src/api.ts` (`listChargeCodes` ~1778+); `apps/web-pms/src/screens/SettingsScreen.tsx` (charge codes tab ~578–639); `apps/pms-core/test/night-audit-room-charges.spec.ts` (step-count pin ~308–309); `apps/pms-core/test/folio-fx-split-transfer.spec.ts` (transfer case **28** ~134–163); `apps/pms-core/test/folio-routes.spec.ts` (`provisionHotel` ~144).

**Closes:** [folio money operations](./2026-08-12-folio-money-operations-design.md) leftover **1** — night-audit auto-transfer. [charge-code registry](./2026-08-07-charge-code-registry-design.md) leftover “Window routing rules table”.

**Amends:** ARCHITECTURE.md §8 diagram and any “pinned 7-step” / “do not grow `NIGHT_AUDIT_STEPS`” prose → **8-step** machine with `AUTO_TRANSFER`. [folio money operations](./2026-08-12-folio-money-operations-design.md) §4.3 + §19 leftover **1** (closed). [charge-code registry](./2026-08-07-charge-code-registry-design.md) §6 routing row (closed). [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) timeline “Seven steps” (~430) → eight. Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Folio-money-ops shipped the desk **transfer primitive** (`tryTransferCharge` ~13027): reverse on source GUEST + dest posting with deterministic ids, tax restamp, `folio.charge_transferred`. It **deferred** night-audit auto-transfer (§4.3) because the 7-step machine was pinned and the routing-rules table did not exist. Charge-code registry named the table as a leftover (~251) with §7.3 **ranges** — this chunk uses **exact charge codes** only.

Human authorized growing the pinned night-audit machine by one step. This chunk adds `AUTO_TRANSFER` after room/no-show posting and before cashier close, plus property-scoped routing-rule CRUD and Settings UI.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Step sequence (7) | `NIGHT_AUDIT_STEPS` — `property-do.ts` ~1055–1063: `PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → CLOSE_CASHIER_SHIFTS → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE` |
| Step runner | `runAuditStep` ~2568–2670: idempotent `COMPLETED` skip; Txn B body; `POST_ROOM_CHARGES` → `postRoomChargesSync`; no `AUTO_TRANSFER` branch yet |
| Workflow walk | `night-audit-workflow.ts` ~36–48: `for (const auditStep of NIGHT_AUDIT_STEPS)` — growing the const is sufficient |
| Transfer primitive | `tryTransferCharge` ~13027–13218: `INTERACTIVE`, `folio:adjust`, `touchInteractive()`; blocked sources/codes; deterministic `` `${source}:xfer-rev:${dest}` `` / `` `${source}:xfer:${dest}` ``; tax reverse + `stampTaxForChargeSync` on dest; existing dest id → idempotent success |
| GUEST window id | `guestFolioWindowId` = `` `${reservationId}:GUEST` `` ~11937–11939 |
| MASTER window id | `tryOpenFolioWindow` ~12069: `` `${reservationId}:MASTER` `` |
| COMPANY window id (desk) | `tryOpenFolioWindow` ~12061–12066: `` `${reservationId}:COMPANY:${slug}` `` from `billedParty` — **not** `` `${reservationId}:COMPANY` `` |
| Room charge posting | `postRoomChargesSync` ~12475–12540: `business_date` on NIGHT_AUDIT ROOM lines before later steps |
| Double-post guard | ARCHITECTURE §8 ~1583–1586: `folio_line_audit_uniq` on `(reservation_id, business_date, charge_code) WHERE source = 'NIGHT_AUDIT'` |
| Charge-code CRUD pattern | `tryCreateChargeCode` ~10593+; HTTP `[50]–[53]`; `settings:configure` writes; `get_charge_codes` read uses `folio:read` ~302–307 |
| Catalog / audit / gaps | `COMMAND_CATALOG` **77** (~642); `AUDIT_WRITER_COMMAND_IDS.size` **52** (~641); `PLATFORM_GAPS` `[]` (~643) |
| Schema heads | `PROPERTY_SCHEMA_HEAD` **27** (~618); `ORG_SCHEMA_HEAD` **7** (~619) |
| HTTP head | `[128] post_folio_stay_discount` (~633–638; ~751–756) — **append after this** |
| Step-count pin | `night-audit-room-charges.spec.ts` ~308–309: `NIGHT_AUDIT_STEPS.toHaveLength(7)` |
| Transfer tests | `folio-fx-split-transfer.spec.ts` **28** (ROOM→COMPANY + tax restamp) — desk path must stay green |

**Heads (do not insert before existing rows):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[128] = post_folio_stay_discount` | **APPEND `[129]–[131]`** — `[128]`/`[127]`/`[102]` unmoved |
| `COMMAND_CATALOG` | length **77** | **79** (+2 routing-rule commands) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **54** (+2) |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **27** | **28** (`folio_routing_rule`) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **7** | **8** (+`AUTO_TRANSFER`) |

### 1.2 Scope in

1. **v28** `folio_routing_rule` table (exact `charge_code` → `dest_window_kind`; no ranges).
2. Catalog commands `folio.upsert_routing_rule`, `folio.archive_routing_rule` + HTTP `[129]–[131]`.
3. Insert **`AUTO_TRANSFER`** into `NIGHT_AUDIT_STEPS` after `PROCESS_NO_SHOWS`, before `CLOSE_CASHIER_SHIFTS`.
4. Extract internal sync transfer helper from `tryTransferCharge`; night-audit step calls it (no `folio:adjust`).
5. `runAutoTransferSync(businessDate)` inside `runAuditStep` Txn B.
6. Settings SPA: list / upsert / archive routing rules near charge codes.
7. Tests §9; pin updates; `pnpm generate:ddl` for v28.
8. Amend ARCHITECTURE.md §8 diagram + 7-step prose → 8-step.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- City ledger / AR, invoices, MASTER group billing engine
- Charge-code **ranges** (exact code only; ranges remain named leftover in charge-code spec prose)
- Auto-create COMPANY/MASTER windows (`tryOpenFolioWindow` / `ensureGuestFolioWindowSync` on dest)
- Promo, recurring/`breakfast_rule`, derived rates, `rooms.delete`, auto-assign, auto_extend
- Folding `AUTO_TRANSFER` into `POST_ROOM_CHARGES`, `PROCESS_NO_SHOWS`, or `ARCHIVE`
- New `export class` / `CLASS_DENYLIST` edit
- Changing `tryTransferCharge` HTTP contract or desk permission model
- Partial refunds leftover 4 pointer hygiene (stale cross-ref in folio-money — not this chunk unless a one-sentence amend is natural)
- `default_window_kind` column on `charge_code`
- Demo seed routing rules (step no-ops on fresh demo)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — New step, do not fold

Insert **`AUTO_TRANSFER`** after **`PROCESS_NO_SHOWS`** and before **`CLOSE_CASHIER_SHIFTS`**:

```
PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → AUTO_TRANSFER → CLOSE_CASHIER_SHIFTS → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE
```

Reasons ([folio-money §4.3](./2026-08-12-folio-money-operations-design.md)): folding into `POST_ROOM_CHARGES` would post then reverse under `folio_line_audit_uniq`; folding into `ARCHIVE` is after the roll. ARCHITECTURE §8 rule 1: `ROLL_BUSINESS_DATE` stays last-but-one.

Update `NIGHT_AUDIT_STEPS` ~1055–1063. `night-audit-workflow.ts` already iterates the const — no workflow rewrite beyond the new step name appearing in the loop.

**Amend ARCHITECTURE.md §8** (~1552–1557 diagram): insert `AUTO_TRANSFER` between `PROCESS_NO_SHOWS` and `CLOSE_CASHIER_SHIFTS`. Replace any “pinned 7-step” / “do not grow `NIGHT_AUDIT_STEPS`” prose (e.g. folio-money §8 scope-out ~57, ~75) with **8-step** pin. Implementation performs the doc edit; this spec names it.

Pin test `night-audit-room-charges.spec.ts` ~308–309: `toHaveLength(7)` → **`8`**; assert order includes `AUTO_TRANSFER` at index **3** (0-based).

### Lock 2 — Routing rules table, not a charge_code column

**v28** migration — new table:

```sql
CREATE TABLE folio_routing_rule (
  rule_id           TEXT PRIMARY KEY,
  charge_code       TEXT NOT NULL REFERENCES charge_code(code),
  dest_window_kind  TEXT NOT NULL CHECK (dest_window_kind IN ('COMPANY', 'MASTER')),
  status            TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at        INTEGER NOT NULL
);

CREATE UNIQUE INDEX folio_routing_rule_active_code_uniq
  ON folio_routing_rule (charge_code)
  WHERE status = 'active';
```

- **GUEST** is the implicit default (no rule → line stays on GUEST).
- Do **not** add `default_window_kind` on `charge_code`.
- Exact `charge_code` match only — no range table, no pattern syntax.
- Register `folio_routing_rule` in `PROPERTY_PURGE_INVENTORY_TABLES` + `countPropertyInventoryRows` (property purge must delete rules).

**Empty table** → `AUTO_TRANSFER` is a no-op: step row still written **`COMPLETED`** (real step, zero transfers).

Upsert validates `charge_code` exists and `status = 'active'` on `charge_code` table → else **`CHARGE_CODE_NOT_FOUND`** (reuse).

### Lock 3 — Reuse transfer primitive, do not HTTP-call it

`tryTransferCharge` (~13027) is INTERACTIVE + `folio:adjust` + `touchInteractive()`. Night-audit must **not** RPC/HTTP-call it.

Extract (or factor) an internal **sync** helper — e.g. `transferFolioLineSync({ sourceFolioLineId, destinationFolioWindowId, auditContext? })` — containing the reverse+dest posting already in ~13099–13190:

| Invariant | Value |
|---|---|
| Reverse id | `` `${sourceFolioLineId}:xfer-rev:${destinationFolioWindowId}` `` |
| Dest id | `` `${sourceFolioLineId}:xfer:${destinationFolioWindowId}` `` |
| Sources | `TRANSFER_REVERSAL` on source; `TRANSFER` on dest |
| Tax | Reverse TAX children on source; `stampTaxForChargeSync` on dest |
| Idempotency | Existing dest row → return existing ids, no duplicate inserts |

`tryTransferCharge` becomes a thin wrapper: gates + `runIdempotent` + `transferFolioLineSync`. **Do not** invent a second transfer algorithm.

Night-audit step calls `transferFolioLineSync` directly inside `runAuditStep` Txn B — **no** `folio:adjust`, **no** `touchInteractive()`, **no** `runIdempotent` per line (step-level `COMPLETED` row + deterministic dest ids are the idempotence layer).

Per-transfer side effects (match desk path): `folio.charge_transferred` outbox; audit row with `commandId: 'folio.transfer_charge'` and `afterJson` including `{ automated: true, ruleId, businessDate }`.

Architecture idempotency key `(reservation_id, business_date, rule_id)` is satisfied: re-running the step attempts the same lines → existing dest id → skip insert.

### Lock 4 — Dest window must already exist

**Do not** call `tryOpenFolioWindow` / auto-create COMPANY or MASTER.

| `dest_window_kind` | Resolution |
|---|---|
| `MASTER` | Resolve `` `${reservationId}:MASTER` `` (matches `tryOpenFolioWindow` ~12069). Lookup `folio_window` by that id. Missing or `status = 'CLOSED'` → **skip** that stay’s matching lines; increment `skippedCount`. `status = 'OPEN'` → transfer to that `folio_window_id`. |
| `COMPANY` | **Do not** invent `` `${reservationId}:COMPANY` ``. Query `folio_window` where `reservation_id = ? AND kind = 'COMPANY' AND status = 'OPEN'`: **0** OPEN COMPANY windows → skip that stay’s matching lines (`skippedCount++`); **exactly 1** OPEN COMPANY window → transfer to that `folio_window_id` (slugged desk id, e.g. `` `${reservationId}:COMPANY:${slug}` `` from `tryOpenFolioWindow` ~12061–12066); **2+** OPEN COMPANY windows → skip (`skippedCount++`) — ambiguous billed-party; do not pick. Named leftover: route-to-specific-slug. |

**Do not** `FAIL`/`HALT` the property because one stay lacks a dest window or has ambiguous COMPANY windows. Step always **`COMPLETED`** when the body finishes (only structural/SQL throws fail the step).

Skip **CLOSED GUEST** source windows (cannot transfer out — same as `assertFolioWindowOpenSync` / `WindowClosedError` on desk).

### Lock 5 — Which lines

For the **business date being audited** (`businessDate` passed to `runAuditStep`):

Every `folio_line` where **all** hold:

1. `folio_line.business_date = businessDate`
2. Parent `folio_window.kind = 'GUEST'` and `folio_window.status = 'OPEN'`
3. `charge_code` matches an **active** `folio_routing_rule` (`status = 'active'`)
4. Transferable under the **same** reject rules as `tryTransferCharge` ~13078–13087:
   - Reject `source` ∈ `{ TAX, SPLIT_REVERSAL, TRANSFER_REVERSAL, CHARGEBACK }`
   - Reject `charge_code` ∈ `{ FX_GAIN, FX_LOSS, CHARGEBACK_FEE }`
5. **PAYMENT** lines **may** transfer (not in reject list — existing desk rule)

Do **not** filter by reservation status beyond “has matching transferable GUEST line”. NIGHT_AUDIT `ROOM` / NO_SHOW lines posted this date on GUEST are included (they exist before this step runs).

Do **not** re-transfer lines whose dest id already exists (helper idempotency).

### Lock 6 — Commands / HTTP / heads

Two **new** catalog commands (not `PLATFORM_GAPS`):

| id | permission | degraded | idempotent | events | entitlement |
|---|---|---|---|---|---|
| `folio.upsert_routing_rule` | `settings:configure` | `FAIL_CLOSED` | true | `folio.routing_rule_changed` | `pms.core` |
| `folio.archive_routing_rule` | `settings:configure` | `FAIL_CLOSED` | true | `folio.routing_rule_changed` | `pms.core` |

Both `INTERACTIVE`. Add both to `AUDIT_WRITER_COMMAND_IDS` → size **54**. `COMMAND_CATALOG` length **79**.

Allowlist `folio.routing_rule_changed` in `event-consumer.ts` (mirror `charge_code.changed` ~140).

**APPEND** HTTP after `[128]` (do **not** move `[128]` / `[127]` / `[102]`):

| idx | id | method / path | permission | degradedRead | commandId |
|---|---|---|---|---|---|
| `[129]` | `get_folio_routing_rules` | `GET /v1/properties/:pid/folio/routing-rules` | `folio:read` | `FAIL_CLOSED` | — |
| `[130]` | `put_folio_routing_rule` | `PUT /v1/properties/:pid/folio/routing-rules/:ruleId` | `settings:configure` | — | `folio.upsert_routing_rule` |
| `[131]` | `post_folio_routing_rule_archive` | `POST /v1/properties/:pid/folio/routing-rules/:ruleId/archive` | `settings:configure` | — | `folio.archive_routing_rule` |

`get_folio_routing_rules`: query `?status=active|archived|all` (default `active`); mirror `listChargeCodes` shape. GET permission matches `get_charge_codes` (~302–307): **`folio:read`** + **`degradedRead: 'FAIL_CLOSED'`**. Writers remain **`settings:configure`**.

Upsert body: `{ chargeCode, destWindowKind, idempotencyKey }`. Fingerprint: `{ ruleId, chargeCode, destWindowKind }` (`ruleId` from path).

Archive body: `{ idempotencyKey }`. Fingerprint: `{ ruleId }`.

`PLATFORM_GAPS` stays `[]`. `ORG_SCHEMA_HEAD` stays **7**. Demo seed: **no** seeded routing rules.

### Lock 7 — SPA

**Settings → Charges tab** (`SettingsScreen.tsx` ~578+): add a **Routing rules** section below charge codes.

| UI | Behaviour |
|---|---|
| List | Active rules: charge code, destination (`COMPANY` \| `MASTER`) |
| Add | Select charge code (from active codes) + dest kind → `putFolioRoutingRule` with client-minted `ruleId` (e.g. `` `rr_${crypto.randomUUID()}` ``) |
| Archive | Per-row archive → `postFolioRoutingRuleArchive` |
| Copy | “Auto-transfer runs at night audit. Destination window must already be open on the stay.” |

Tokens / `ui-kit` only if touched files fail `check:web-pms-colors`. Rebuild `@hospai/client-core` after `api.ts`.

RTL: list renders rules; add calls PUT; archive calls POST archive.

### Lock 8 — Not city ledger

Destination is a folio **COMPANY/MASTER window**, not an AR account. `billed_party` stays a label on the window row. No invoices, no aging, no MASTER group billing engine.

### Lock 9 — Step semantics

`runAutoTransferSync(businessDate)`:

1. Load active rules; if none → return `{ transferredCount: 0, skippedCount: 0 }`.
2. Query candidate lines (Lock 5).
3. For each line: resolve dest (Lock 4); on skip increment `skippedCount`; else `transferFolioLineSync` and increment `transferredCount`.
4. **Do not** append a summary audit row with `commandId: 'night_audit.auto_transfer'` — that id is **not** in `COMMAND_CATALOG` and would fail writer/allowlist checks. Per-line audit stays **`folio.transfer_charge`** with `afterJson` including `{ automated: true, ruleId, businessDate }` (Lock 3). Step outcome lives on the **`night_audit_run`** step row: **`COMPLETED`** when the body finishes; `transferredCount` / `skippedCount` may use that step’s existing error/status channel **only if** one already exists — **prefer not** adding a column. Counts are testable by querying `folio_line` (TRANSFER dest rows, lines left on GUEST).

Step failure policy: uncaught throw → `FAILED` + halt (same as other steps). Per-reservation skip is **not** a failure.

---

## 3. Night-audit integration

### 3.1 `runAuditStep` branch

In Txn B (~2621–2636), add:

```typescript
} else if (step === 'AUTO_TRANSFER') {
  this.runAutoTransferSync(businessDate);
}
```

Place **after** `PROCESS_NO_SHOWS`, **before** `CLOSE_CASHIER_SHIFTS` in both the const and the if-chain.

### 3.2 Ordering rationale

| Step | Why before/after |
|---|---|
| `POST_ROOM_CHARGES` / `PROCESS_NO_SHOWS` | Produce GUEST lines with `business_date = businessDate` that rules may match |
| `AUTO_TRANSFER` | Move matched lines before cashier close and reporting snapshot |
| `CLOSE_CASHIER_SHIFTS` | Unchanged — follows transfer |
| `ROLL_BUSINESS_DATE` | Still last-but-one (ARCHITECTURE §8 rule 1) |

---

## 4. Schema (v28)

`PROPERTY_SCHEMA_HEAD` **27 → 28**. `pnpm generate:ddl` required. After generate, `git diff --exit-code -- migrations packages/do-runtime` must match committed SQL.

Migration name suggestion: `folio_routing_rule`.

**No** changes to `charge_code`, `folio_line`, or `folio_window` columns.

---

## 5. Commands / HTTP detail

### 5.1 `folio.upsert_routing_rule`

| Field | Value |
|---|---|
| Lane | `INTERACTIVE` |
| Permission | `settings:configure` |
| Fingerprint | `{ ruleId, chargeCode, destWindowKind }` |
| Success | `{ ok: true, ruleId }` |

Insert or update row by `rule_id`. Enforce partial unique index on active `charge_code`. Archiving the prior rule for the same code is **not** automatic — upserting a new active code while another active rule exists → **`ROUTING_RULE_CONFLICT`** (new wire code) or reuse an existing code if one fits.

**Wire code (new):** `ROUTING_RULE_CONFLICT` — active rule already exists for `chargeCode` on a different `ruleId`.

### 5.2 `folio.archive_routing_rule`

| Field | Value |
|---|---|
| Fingerprint | `{ ruleId }` |
| Success | `{ ok: true, ruleId }` |
| Missing rule | `NOT_FOUND` |

Sets `status = 'archived'` (idempotent if already archived).

### 5.3 Event payload `folio.routing_rule_changed`

```typescript
{ propertyId, ruleId, chargeCode, destWindowKind, op: 'upsert' | 'archive', at: number }
```

---

## 6. Errors

| Code | When |
|---|---|
| `CHARGE_CODE_NOT_FOUND` | Upsert references missing/inactive charge code |
| `ROUTING_RULE_CONFLICT` | Second active rule for same `chargeCode` |
| `NOT_FOUND` | Archive unknown `ruleId` |
| `FORBIDDEN` / `not_member` | Missing `settings:configure` on PUT/POST; missing `folio:read` on GET |
| `ENTITLEMENT_REQUIRED` / `ENTITLEMENT_UNAVAILABLE` | Core entitlement |
| `IDEM_KEY_REUSED` | Fingerprint mismatch |

Desk transfer errors unchanged (`WINDOW_CLOSED`, `LINE_NOT_TRANSFERABLE`, etc.) — case **28** / desk path must stay green.

---

## 7. SPA / client-core

New `api.ts` methods (mirror charge-code naming):

| Method | HTTP |
|---|---|
| `listFolioRoutingRules(propertyId, { status? })` | `[129]` GET |
| `putFolioRoutingRule(propertyId, ruleId, { chargeCode, destWindowKind })` | `[130]` PUT |
| `archiveFolioRoutingRule(propertyId, ruleId)` | `[131]` POST archive |

---

## 8. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v28 `folio_routing_rule` |
| `migrations/do-property/0028_*.sql` | Generated |
| `packages/do-runtime/src/migrate.test.ts` | Pin `PROPERTY_SCHEMA_HEAD === 28` |
| `apps/pms-core/src/property-do.ts` | `NIGHT_AUDIT_STEPS` +8; `runAutoTransferSync`; `transferFolioLineSync` extract; `tryUpsertRoutingRule` / `tryArchiveRoutingRule` / `listFolioRoutingRules`; `runAuditStep` branch |
| `packages/contracts/src/commands/catalog.ts` | +2 commands |
| `packages/contracts/src/commands/audit-writers.ts` | +2 ids |
| `packages/contracts/src/v1-http-routes.ts` | Append `[129]–[131]` |
| `apps/pms-core/src/v1-dispatch.ts` | 3 handlers + routes |
| `apps/pms-core/src/event-consumer.ts` | Allowlist `folio.routing_rule_changed` |
| `packages/client-core/src/api.ts` | 3 methods |
| `apps/web-pms/src/screens/SettingsScreen.tsx` (+ test) | Routing rules UI |
| `apps/pms-core/test/night-audit-auto-transfer.spec.ts` (new) | DO cases §9 |
| `apps/pms-core/test/night-audit-room-charges.spec.ts` | Step count **8** |
| `apps/pms-core/test/folio-routes.spec.ts` (or sibling) | HTTP routing-rule CRUD |
| `packages/contracts/src/register.test.ts` | Pins: catalog **79**, writers **54**, `[129]–[131]`, `[128]`/`[127]`/`[102]` |
| `ARCHITECTURE.md` | §8 diagram + 8-step prose |

**Not touched:** `tryTransferCharge` HTTP contract; `ORG_SCHEMA_HEAD`; demo seed rules; `CLASS_DENYLIST`.

---

## 9. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Do **not** `vi.spyOn` into the DO isolate. HTTP via **`provisionHotel` + `worker.fetch` + `x-dev-actor`** — **do not invent `provisionedPropertyWorker`**.

File-filter vitest only (`pnpm --filter @hospai/pms-core exec vitest run …`) — unsharded package test may segfault.

### DO — night audit (`night-audit-auto-transfer.spec.ts` or extend `night-audit-room-charges.spec.ts`)

| # | Case | Assert |
|---|---|---|
| 1 | Empty routing rules | Run `AUTO_TRANSFER` → `COMPLETED`; zero `TRANSFER` lines |
| 2 | Rule `ROOM→COMPANY`; open GUEST with ROOM line `business_date = businessDate`; open COMPANY via `tryOpenFolioWindow` with `billedParty` (slugged id, mirror `folio-fx-split-transfer.spec.ts` **28** ~153–159) | Reverse on GUEST + dest on **that slugged** COMPANY window (not `` `:COMPANY` ``); tax restamp on dest |
| 3 | Rule `ROOM→COMPANY`; **no** OPEN COMPANY window | Lines stay on GUEST; step `COMPLETED` |
| 4 | Rule `ROOM→COMPANY`; **two** OPEN COMPANY windows on same stay | Skip; lines stay on GUEST; step `COMPLETED` |
| 5 | Rerun `AUTO_TRANSFER` same date | No duplicate dest lines (idempotent) |
| 6 | `NIGHT_AUDIT_STEPS.length === 8`; index 3 === `AUTO_TRANSFER` | Pin order |
| 7 | Full walk through `AUTO_TRANSFER` in workflow stub | Step row `COMPLETED` |

### DO — desk regression

| # | Case | Assert |
|---|---|---|
| 8 | `tryTransferCharge` case **28** | Still green (`folio-fx-split-transfer.spec.ts`) |

### HTTP

| # | Case | Assert |
|---|---|---|
| 9 | PUT upsert rule → GET list | 200; rule visible |
| 10 | POST archive → GET `status=active` | Rule gone from active list |
| 11 | Missing `settings:configure` on PUT/POST | 403 |
| 12 | Missing `folio:read` on GET | 403 |

### SPA RTL

| # | Case | Assert |
|---|---|---|
| 13 | Settings routing section | Add + archive mutate list |

---

## 10. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Charge-code ranges** | ARCHITECTURE §7.3 “transactionRange → destination”; this chunk is exact code only |
| 2 | **Route-to-specific-slug** | Lock 4 picks the sole OPEN COMPANY window when exactly one exists; no per-rule `billedParty` / slug selector — when **2+** OPEN COMPANY windows, skip (ambiguous) |
| 3 | **City ledger / AR** | Dest is folio window only (Lock 8) |
| 4 | **No new `night_audit.*` catalog command** | Step outcome on `night_audit_run`; per-line audit reuses `folio.transfer_charge` + `automated: true` — do not add `night_audit.auto_transfer` to catalog |

---

## 11. Implementation checklist

- [ ] v28 `folio_routing_rule` + `generate:ddl` + `migrate.test.ts` pin **28**; purge inventory registration.
- [ ] Catalog +2 (`folio.upsert_routing_rule`, `folio.archive_routing_rule`); writers **54**; event allowlist.
- [ ] **Append** `[129] get_folio_routing_rules` (`folio:read`, `degradedRead: FAIL_CLOSED`), `[130] put_folio_routing_rule`, `[131] post_folio_routing_rule_archive`; `[128]`/`[127]`/`[102]` unmoved.
- [ ] DO: `listFolioRoutingRules`, `tryUpsertRoutingRule`, `tryArchiveRoutingRule`.
- [ ] Extract `transferFolioLineSync`; refactor `tryTransferCharge` to wrap it (desk path unchanged).
- [ ] Lock 4 COMPANY dest: query OPEN COMPANY windows (0 or 2+ → skip; exactly 1 → transfer); MASTER via `` `:MASTER` `` id.
- [ ] `NIGHT_AUDIT_STEPS` length **8** with `AUTO_TRANSFER` at index 3; `runAuditStep` branch; `runAutoTransferSync` (no `night_audit.auto_transfer` audit command; per-line `folio.transfer_charge` only).
- [ ] ARCHITECTURE.md §8 diagram + 8-step prose amended.
- [ ] `client-core` + Settings SPA routing rules UI + RTL.
- [ ] Tests §9 (incl. slugged COMPANY dest, no COMPANY window, two OPEN COMPANY windows); `night-audit-room-charges.spec.ts` pin **8**; case **28** green.
- [ ] `register.test.ts`: catalog **79**, writers **54**, route `[129]–[131]`.
- [ ] Bidirectional pointers: folio-money §4.3 + §19 leftover **1**; charge-code §6 routing row; night-audit-e2e ~430 “Seven steps” → eight (final implementation task).

---

## 12. Tree conflicts with reviewer locks

1. **COMPANY window id — reconciled.** Lock 4 does **not** invent `` `${reservationId}:COMPANY` ``. It queries OPEN COMPANY windows per stay (0 or 2+ → skip; exactly 1 → transfer to that slugged desk id). Aligns with `tryOpenFolioWindow` `` `${reservationId}:COMPANY:${slug}` `` (~12061–12066). **GET `[129]` permission — reconciled:** `folio:read` + `degradedRead: 'FAIL_CLOSED'`, same as `get_charge_codes` (~302–307).

**Otherwise none.** Verified: `[128] post_folio_stay_discount` shipped; heads match §1.1; `tryTransferCharge` reject set ~13078–13087; workflow iterates `NIGHT_AUDIT_STEPS` ~36–48.
