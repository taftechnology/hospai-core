# Charge-Code Registry

**Date:** 2026-08-07  
**Status:** Approved  
**Sources:** ARCHITECTURE.md §7.3 (folio windows / charge-code routing; append-only ledger), §7.9 (launch-country tax fork — exclusive US-shaped decided; tax deferred), §14 (Phase 1 sequencing); [folio charges vertical](./2026-08-05-folio-charges-vertical-design.md); [payments ledger simulate](./2026-08-06-payments-ledger-simulate-design.md) (`payment_id` FK / reverse+children splits); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) (entity registry, archive, protection, wire codes — asymmetries called out below); [command catalog](../../../packages/contracts/src/commands/catalog.ts); [property-migrations.ts](../../../packages/do-runtime/src/property-migrations.ts)

---

## 1. Context & Motivation

`folio_line.charge_code` is `TEXT NOT NULL` with no registry, no CHECK, and no table behind it. `'ROOM'`, `'MISC'`, and `'PAYMENT'` are string literals scattered across the DO. `tryAddFolioLine` accepts any string — the only occurrence of `chargeCode` in the method is the type annotation.

Both next features key off this dimension:

- **Tax** maps rules to charge codes. A tax engine over free text cannot be verified — a typo'd `'ROOOM'` is silently untaxed.
- **Window routing** (§7.3) maps charge-code *ranges* to a destination window. Ranges imply codes are structured and enumerable. Ours are neither.

This is the fifth entity-less reference this session (after folio windows, rate plans, rooms, guest keys) and the first that blocks the next slice outright. Land the registry alone — identity + FK + validation + narrow CRUD — before tax or cashiering. Carrier columns (`taxable`, `tax_group`, routing destination) stay out: they encode undecided design, and adding columns later to a fresh `charge_code` table is a plain `ALTER TABLE … ADD COLUMN`.

**Launch-country prerequisite (decided, not this slice):** exclusive (US-shaped) tax. `rate_day.amount_minor` stays net; tax posts as separate lines later. Inclusive would redefine night-audit arithmetic. Tourist/city tax stays out — `reservation` has no occupancy (`adults`/`children`); a per-person rule has no input to evaluate. Tax rules table will declare `rule_type CHECK (… IN ('PERCENTAGE','PER_PERSON_PER_NIGHT','FLAT'))` and reject non-`PERCENTAGE` at the application layer when that slice lands.

### Scope in

1. **`charge_code` table** — identity only: `code` PK, `name`, `status` (`active` / `archived`), timestamps.
2. **Migration v14** — seed system codes → distinct-backfill from `folio_line` → rebuild `folio_line` with FK (indexes after rename).
3. **Validation at every folio writer**, split by write kind (§2.3).
4. **Narrow CRUD** — create / update name / set status (archive *and* restore); no hard-delete.
5. **Breaking change** on `folio.add_item`: unregistered or archived → `CHARGE_CODE_NOT_FOUND`.
6. **Real-SQLite unit test** proving distinct-backfill + FK safety (new harness class for this repo).

### Scope out

- `taxable` / `tax_group` / `default_window_kind` on `charge_code` (tax and routing slices).
- Tax posting, window routing rules, tourist/city tax evaluation.
- Reservation occupancy (`adults` / `children`) — separate named slice; blocks per-person tax and occupancy pricing.
- Hard-delete of charge codes.
- Cashiering / shifts / audit log.

---

## 2. Design Decisions

### 2.1 Schema — identity only; PK is the code

```sql
CREATE TABLE charge_code (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

**No unique index on `name`.** Operators may want display variants; the code is the identity. Contrast with `rate_plan`, which has a surrogate `rate_plan_id` PK *and* `rate_plan_code_active` on `code` — that index exists because the code there isn't the key. Here the PK already does the work.

**`SYSTEM_CHARGE_CODES`** — defined by principle, not a closed product list: *codes the DO writes without an operator naming them*. Currently `ROOM` (night audit) and `PAYMENT` (capture). Nothing writes `MISC` as a system author; `MISC` stays archivable. A future system writer gets protection by joining this set, not by remembering a literal elsewhere.

### 2.2 Migration v14 — order is load-bearing

`tryAddFolioLine` has never validated codes. Any deployed property may hold arbitrary strings. The orphan set is **unbounded** — the same situation that made v12 decline the FK on `rate_day.rate_plan_id` ("No FK from rate_day"). The FK is still right here, but the migration must make it safe:

**Ordered steps (abort-safe; mirror v11 rename-then-index):**

1. `CREATE TABLE charge_code (…)`
2. **Seed system codes** (`INSERT OR IGNORE`) with display names `'Room'`, `'Misc'`, `'Payment'` and timestamps `0, 0` (v12 `BAR` house style).
3. **Distinct-backfill:**  
   `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) SELECT DISTINCT charge_code, charge_code, 'active', 0, 0 FROM folio_line;`  
   Unrecognised codes surface as `active` registry rows an operator can archive — visible rather than rejected.
4. `CREATE TABLE folio_line_v14 (… FOREIGN KEY (charge_code) REFERENCES charge_code(code), …)` — preserve all existing columns including `payment_id`.
5. `INSERT INTO folio_line_v14 SELECT … FROM folio_line`
6. `DROP TABLE folio_line` — takes old indexes with it. Safe: nothing in the schema has an FK *to* `folio_line` (`split_of` is unconstrained TEXT; `folio_line` is a child of `folio_window` / `payment` only).
7. `ALTER TABLE folio_line_v14 RENAME TO folio_line`
8. **Then** recreate `folio_line_audit_uniq`, `folio_line_window_idx`, `folio_line_payment_uidx`

**Step 2 before step 3 is load-bearing.** It gives `ROOM` the name `'Room'` rather than `'ROOM'` — step 3's `INSERT OR IGNORE` then skips it. Reverse them and system codes get codes as display names.

**Index names are schema-global.** Creating them on `folio_line_v14` while the old table still holds them aborts mid-migration. Spec states ordered steps, not "rebuild + recreate."

Files: `packages/do-runtime/src/property-migrations.ts` statements + `migrations/do-property/0014_charge_code.sql` + `migrate.test.ts` sync assertion (`check:ddl`).

### 2.3 Validation split by write kind

Archiving must not freeze corrections. The folio is append-only; a reversing entry is the only correction mechanism. `splitFolioLineSync` inherits `chargeCode: source.charge_code`. If archive required `active` on every writer, archiving `PARKING` would trap every posted parking line permanently.

| Writer | Rule | Why |
|---|---|---|
| `tryAddFolioLine` (`folio.add_item`) | exists **and** `active` | New obligation; archive means stop offering |
| `postRoomChargesSync` (`ROOM`) | exists **and** `active` | System new charge |
| Capture path (`PAYMENT`) | exists **and** `active` | System new charge |
| `splitFolioLineSync` (reversal + children) | exists only | Derived from an already-posted line |

```ts
private assertChargeCodeSync(code: string, opts: { requireActive: boolean }): void {
  if (SYSTEM_CHARGE_CODES.includes(code)) this.ensureSystemChargeCodesSync(); // Date.now() stamps
  // SELECT status; missing → ChargeCodeNotFoundError
  // requireActive && archived → ChargeCodeNotFoundError (same wire code; no archive leak)
}
```

Fold `ensureSystemChargeCodesSync` into the assert (rate-plan precedent: `assertActiveRatePlanSync` calls `ensureDefaultRatePlanSync` for `BAR`). Runtime belt-and-braces uses `Date.now()`, not migration `0, 0`.

Call sites invoke the helper **before** `insertFolioLineSync`. The FK is the structural backstop; the helper is the typed reject.

**Derived-path existence check is unreachable by construction** while the FK holds and there is no hard-delete: every existing line's code is guaranteed present, so `assertChargeCodeSync(code, { requireActive: false })` on the split path can never throw. Keep it — defense if the FK is ever weakened — but do **not** write a test that expects it to fail under normal schema. Same class as a dead branch kept as armor, not as a live path.

### 2.4 CRUD — create / update name / set status; no delete

| Command | HTTP | Behaviour |
|---|---|---|
| `folio.create_charge_code` | `POST …/charge-codes` | Insert `active`; duplicate PK → `CHARGE_CODE_EXISTS` |
| `folio.update_charge_code` | `PATCH …/charge-codes/:code` | Update `name` only; missing → `CHARGE_CODE_NOT_FOUND` |
| `folio.set_charge_code_status` | `PUT …/charge-codes/:code/status` | `{ status: 'active' \| 'archived' }` — archive **and** restore |

**No hard-delete** on catalog or HTTP. Archive keeps the row so the FK and historical lines stay valid.

**Restore is in scope**, not a leftover. Because `code` is the PK, re-create after archive hits `CHARGE_CODE_EXISTS` — the rate-plan escape hatch (new surrogate id, same code via partial unique index) is structurally unavailable. Deferring restore would ship a trap: archive-by-mistake means "pick a different code forever." One DO method, one branch:

```ts
trySetChargeCodeStatus(actor, { code, status: 'active' | 'archived' }, idem)
// archive of SYSTEM_CHARGE_CODES → SYSTEM_CHARGE_CODE_PROTECTED
// restore / already-active → ok (idempotent)
// missing → CHARGE_CODE_NOT_FOUND
```

**Fingerprint** `folio.set_charge_code_status` on `{ code, status }`, not `{ code }` alone. Omit status and an archive followed by a restore under the same idempotency key replays the cached archive result.

**Permission:** mutations → `settings:configure` (admin structural config — not `folio:post`). Entitlement `pms.core` on all three — `check:entitlements` two-sided rule satisfied; no opt-out rows. Degraded: `FAIL_CLOSED`.

**Events:** `charge_code.changed` on create / update / set-status — catalog `events[]` **and** queue consumer allowlist case in the **same commit** (rate-plans DLQ lesson).

**Read:** `GET …/charge-codes` — permission **`folio:read` only** (`V1HttpRouteAudit` carries a single permission; "`folio:read` or `settings:configure`" is inexpressible and fails `check:permissions`). Desk staff need the list to post; only admins create (`settings:configure` on mutations). Query: `?status=active` (default) | `archived` | `all`. `degradedRead: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`, no `commandId` (mutual exclusion with `commandId`).

### 2.5 Breaking change on `folio.add_item` — including degrade

Unregistered or archived → `{ ok: false, error: CHARGE_CODE_NOT_FOUND }` → HTTP **404** (same privacy shape as `RATE_PLAN_NOT_FOUND`). Previously any string succeeded.

**Degraded-mode consequence (named):** `folio.add_item` is `QUEUE_PROVISIONAL`; CRUD is `FAIL_CLOSED`. During outage the HTTP layer queues the add **without** touching the DO, so `assertChargeCodeSync` does not run until replay. The operator also cannot create the missing code during the outage. Net: degrade + typo/unregistered code → a batch of replay exceptions that could not be fixed until recovery. Before this slice those charges would have succeeded silently under a junk code. That is the correct trade — silent junk is the bug — but operators must register codes **before** degrade, not during.

### 2.6 Wire error mapping — follow rate-plan precedent

| Constant | Wire string | HTTP |
|---|---|---|
| `CHARGE_CODE_NOT_FOUND` | `charge_code_not_found` | **404** |
| `CHARGE_CODE_EXISTS` | `charge_code_exists` | **422** |
| `SYSTEM_CHARGE_CODE_PROTECTED` | `system_charge_code_protected` | **422** |

Map protection and duplicate-exists to **422**, matching `DEFAULT_RATE_PLAN_PROTECTED` / `RATE_PLAN_CODE_EXISTS` / `RATE_PLAN_ID_EXISTS` in [v1-dispatch.ts](../../../apps/pms-core/src/v1-dispatch.ts) — not 409. Consistency across sibling registries beats REST purity here.

### 2.7 Why not carrier columns now

- **`default_window_kind`** presumes routing is a per-code property. §7.3 specifies plural rules mapping charge-code *ranges*, property-scoped, auto-transfer at night audit keyed by `(reservation_id, business_date, rule_id)`. A single column is a different model.
- **`tax_group`** presumes rules reference a grouping rather than codes directly — undecided until the tax rules table is designed.
- **`taxable`** is probably right but would be seeded, editable via CRUD, with no consumer for two slices and no failing test — the declared-but-unread shape closed repeatedly this session (`affectsTaxMoney`, `rematerializesRates`, …).

`taxable` ships with the tax slice and its consumer. Routing ships with a rules table, not a column on `charge_code`.

The expensive-now item is the FK on an existing populated column. Tax-as-separate-lines needs nullable `tax_of` on `folio_line` — an `ADD COLUMN` with NULL default, like `payment_id`. Routing already has `folio_window_id`. Neither future feature forces a second `folio_line` rebuild.

---

## 3. Catalog, HTTP & touch list

### 3.1 Catalog

| id | degraded | permission | entitlement | events | notes |
|---|---|---|---|---|---|
| `folio.create_charge_code` | `FAIL_CLOSED` | `settings:configure` | `pms.core` | `['charge_code.changed']` | `prototypeAction: null` |
| `folio.update_charge_code` | `FAIL_CLOSED` | `settings:configure` | `pms.core` | `['charge_code.changed']` | name only |
| `folio.set_charge_code_status` | `FAIL_CLOSED` | `settings:configure` | `pms.core` | `['charge_code.changed']` | archive and restore; fingerprint `{ code, status }` |

### 3.2 Routes — dual list, indices 50–53

Append in **identical order** to `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` (current last index 49 = `get_folio_payments`):

| idx | audit `id` | method / path | permission | commandId / read |
|---|---|---|---|---|
| 50 | `post_charge_codes` | `POST /v1/properties/:pid/charge-codes` | `settings:configure` | `folio.create_charge_code` |
| 51 | `patch_charge_code` | `PATCH /v1/properties/:pid/charge-codes/:code` | `settings:configure` | `folio.update_charge_code` |
| 52 | `put_charge_code_status` | `PUT /v1/properties/:pid/charge-codes/:code/status` | `settings:configure` | `folio.set_charge_code_status` |
| 53 | `get_charge_codes` | `GET /v1/properties/:pid/charge-codes` | `folio:read` | `degradedRead: 'FAIL_CLOSED'`, `entitlement: 'pms.core'`, no `commandId` |

### 3.3 Touch list

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v14 statements (ordered §2.2); export `SYSTEM_CHARGE_CODES` / helpers as needed |
| `migrations/do-property/0014_charge_code.sql` | Canonical SQL; `migrate.test.ts` sync assertion |
| `scripts/property-ddl.mjs` | Hardcodes each SQL export by name (`PAYMENT_V13_SQL` and siblings); add `CHARGE_CODE_V14_SQL` declare + destructure + file entry or `check:ddl` will not cover `0014_charge_code.sql` |
| `packages/do-runtime` **new real-SQLite test** | Distinct-backfill + FK probe (§4 test 2) — `node:sqlite` / Node 22; **new testing approach for this repo** |
| `packages/contracts/src/idempotency.ts` | Three error constants + tests |
| `packages/contracts/src/commands/catalog.ts` | Three commands |
| `packages/contracts/src/v1-http-routes.ts` | Audit rows 50–53 |
| `packages/contracts/src/register.test.ts` | Pins / events / entitlements as needed |
| `apps/pms-core/src/property-do.ts` | `assertChargeCodeSync`, ensure, CRUD methods, writer gates |
| `apps/pms-core/src/v1-dispatch.ts` | Four handlers at `V1_ROUTES` 50–53; error map 404/422 |
| `apps/pms-core/src/event-consumer.ts` (or equivalent allowlist) | `charge_code.changed` |
| Tests | `charge-codes.spec.ts`; folio / payments / night-audit pins; checks green |

---

## 4. Test matrix

`apps/pms-core/test/charge-codes.spec.ts` (new) + targeted folio/payments/night-audit cases + **do-runtime real-SQLite migration probe**.

| # | Case | Expect |
|---|---|---|
| 1 | Fresh property after v14 | `ROOM`/`MISC`/`PAYMENT` rows; names `Room`/`Misc`/`Payment` (seed-before-backfill) |
| 2 | **Real SQLite:** build v13 schema, insert `folio_line` with `charge_code='ZZZ'`, apply v14 statements | `ZZZ` row `active`, name `'ZZZ'`; rebuild completes; FK enforced (inserting a line with unknown code fails). *Not* `migrate.test.ts` (string-matching fake) and *not* a DO test (migrations run at construction — no pre-v14 window). **Harness:** after opening the DB, `PRAGMA foreign_keys = ON` — SQLite defaults FK off per connection; without the pragma the FK assertion is a false-negative green. Mirror PropertyDO, which sets the pragma ON in its constructor before migrations run; keep FK ON for the whole test (migration + post-asserts). Every row's `folio_window_id` / `payment_id` / (post-step-3) `charge_code` resolves, so rebuild with FK ON matches the shipped path. |
| 3 | `folio.add_item` with `MISC` | 200 |
| 4 | `folio.add_item` with unregistered code | `charge_code_not_found` / 404 |
| 5 | Create `PARKING` → add_item | ok |
| 6 | Archive `PARKING` → add_item | `charge_code_not_found` |
| 7 | Archive `PARKING` → split existing PARKING line | reverse+children ok |
| 8 | Restore `PARKING` → add_item | ok again |
| 9 | Archive `ROOM` or `PAYMENT` | `system_charge_code_protected` / 422 |
| 10 | Archive `MISC` | ok; add_item fails; restore recovers |
| 11 | Create duplicate code | `charge_code_exists` / 422 |
| 12 | Create after archive same code | `charge_code_exists`; restore is the path |
| 13 | Night audit still posts `ROOM` | unchanged amounts |
| 14 | Capture still posts `PAYMENT` | unchanged |
| 15 | GET as staff (`folio:read`) | lists codes; POST create → 403 |
| 16 | `charge_code.changed` on create/update/status | consumer allowlist accepts |
| 17 | `check:ddl` / migrate sync | `0014_charge_code.sql` ↔ statements |
| 18 | Kill-switch / unentitled on three mutates | 503 / 402 |
| 19a | Archive key K, restore **same** key K | `idempotency_key_reused` — proves `status` is in the fingerprint. (Under `{ code }` alone this would return a cached archive success; with `{ code, status }` fingerprints diverge → reuse error. Same key never yields a successful second op — only replay or error.) |
| 19b | Archive key K, restore key K2 | ok; status `active` |

**Do not test:** derived-path `requireActive: false` throwing under a healthy FK — unreachable by construction (§2.3).

---

## 5. Acceptance

1. Unregistered `folio.add_item` fails; seeded/system codes and operator-created active codes succeed.
2. Archive stops **new** posts; does not block split/reversal of existing lines; restore re-opens posts.
3. System codes cannot be archived; migration distinct-backfill + seed order preserves display names; real-SQLite test 2 proves FK safety on junk pre-migration data.
4. Dual route lists stay paired at 50–53; wire codes 404/422 match rate-plan siblings; `check:permissions` / `check:entitlements` / `check:degraded` / `check:ddl` green.

---

## 6. Leftovers

| Item | Note |
|---|---|
| `taxable` on `charge_code` | Ships with tax slice + consumer + test |
| Tax rules table (effective-dated; not `pms.money.tax_registry`) | Exclusive launch model; `rule_type` domain includes `PER_PERSON_PER_NIGHT` / `FLAT`, app rejects non-`PERCENTAGE` |
| Tourist/city tax evaluation | Blocked on reservation occupancy |
| Reservation occupancy (`adults`/`children`) | Rebuild on `reservation` (v11+); also needed for occupancy pricing and `maxOccupancy` enforcement |
| Window routing rules table | ~~§7.3 ranges → destination; not a column on `charge_code`. Auto-transfer still deferred…~~ **Closed** (exact-code rules + night-audit step) in [2026-08-14 night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md). Charge-code **ranges** remain a leftover. |
| `affectsTaxMoney` wiring | Declared on six config entries; read by nothing — wire or stop pretending |
| `rematerializesRates` | Still declared-but-unhonored (rule3 leftovers) |
| Cash tender vs `pending→authorized→captured` | Shape payment for cash before cashiering |
| Shifts as attribution overlay, not posting gate | Same collision class as checkout-and-balance |
| `CLOSE_CASHIER_SHIFTS` force-close vs fail audit | Open shift is nightly operational reality |
| `audit.append` / money-mutation audit log | Catalog entry with nothing behind it |
| `folio_window.status` CHECK | When first write of `closed_at` / second status lands |

---

## 7. Implementation sketch

1. Land v14 DDL + SQL file + string sync test + **real-SQLite backfill/FK test**.
2. Constants, catalog, route audit 50–53, consumer allowlist.
3. `assertChargeCodeSync` + ensure; gate `tryAddFolioLine`, night audit, capture; existence-only call on split path.
4. CRUD DO methods + four HTTP handlers; fingerprint set-status on `{ code, status }`.
5. `charge-codes.spec.ts` matrix; green checks.

---

## 8. Open questions

None. Settled in design: identity-only A (not carrier B); distinct-backfill before FK rebuild; active vs exists validation split; restore via `set_charge_code_status`; `folio:read` on GET; 422 for exists/protected; real-SQLite for test 2; exclusive tax / tourist deferred / occupancy leftover recorded for the tax slice.
