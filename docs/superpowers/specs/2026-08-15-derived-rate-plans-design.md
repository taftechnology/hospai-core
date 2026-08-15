# Derived rate plans — property-local percent-of-parent

**Tree verified 2026-08-15 (post auth-hold-lapse close `952830d`):** `COMMAND_CATALOG` length **81** (`register.test.ts` ~679), `AUDIT_WRITER_COMMAND_IDS.size === 56` (`register.test.ts` ~269 and ~678), `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'` (`register.test.ts` ~670–675; `v1-http-routes.ts` ~792+), `[132] delete_room` (~663–668), `[131] post_folio_routing_rule_archive` (~656–661), `[127] post_demo_seed` (~619–624), `PROPERTY_SCHEMA_HEAD === 29` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~626–627), `PROPERTY_MIGRATIONS` tail v29 `room_archive` ~1171–1174 (`property-migrations.ts`), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1067–1076), `PLATFORM_GAPS === []` (`register.test.ts` ~680), `rate_plan` DDL ~346–357 (`property-migrations.ts`), cancel-policy ALTERs v20 ~577–585, `DEFAULT_RATE_PLAN_ID = 'BAR'` ~6 (`property-migrations.ts`), `rates.create_plan` / `update_plan` / `delete_plan` catalog ~683–711 (`catalog.ts`), HTTP `post_rate_plans` / `patch_rate_plan` / `delete_rate_plan` / `get_rate_plans` ~193–216 (`v1-http-routes.ts`), `handlePostRatePlans` body ~3646–3683 (`v1-dispatch.ts`), `tryCreateRatePlan` ~10511–10621 / `tryUpdateRatePlan` ~10628–10778 / `tryDeleteRatePlan` ~10785–10864 / `listRatePlans` ~10869–10913 / `tryUpsertRateDay` ~12375–12465 / `tryBulkUpdateRates` ~12480+ / `rateDayAmountSync` ~6892–6903 (`property-do.ts`), `roundHalfAwayFromZero` ~123–128 (`packages/money/src/index.ts`), `ARCHIVE_BLOCKED` ~15 (`idempotency.ts`), `rematerializesRates` declared-but-unhonored on `pms.money.currency_code` ~163 (`register.ts`); zero PropertyDO consumer (`rule3-config-surface` §2.5), `RatesScreen` plan form ~211–228 / matrix ~460+ (`apps/web-pms/src/screens/RatesScreen.tsx`), `rate-plans-routes.spec.ts` existing matrix, `event-consumer.ts` `rate_plan.changed` noop case ~139.

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §7.2 (derivation graph honesty — **this chunk overrides OrgDO-hosted definitions for derived plans**); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) (property-local `rate_plan`; archive-not-delete; scope-out derived ~35 / §8 ~419); [property setup SPA](./2026-08-13-property-setup-spa-design.md) (§6 rates matrix + plans; leftover **2** ~539; leftover **14** ~551); [rule 3 + config surface](./2026-08-06-rule3-config-surface-design.md) (`rematerializesRates` dead flag §2.5); `packages/money`; `apps/pms-core/src/property-do.ts`; `packages/contracts/src/commands/catalog.ts`; `packages/contracts/src/v1-http-routes.ts`; `apps/pms-core/src/v1-dispatch.ts`; `packages/client-core/src/api.ts`; `apps/web-pms/src/screens/RatesScreen.tsx`; `apps/pms-core/test/rate-plans-routes.spec.ts`.

**Closes:** [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) leftover **Derived / linked plans** (~35 scope-out; §8 table ~419). [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover **2** Derived / OrgDO rate plans (~539) — **property-local derived half only**; OrgDO-hosted chain-wide stays out. **Does not close** leftover **14** `rematerializesRates` consumer (~551): derived rematerialization is synchronous on parent `rate_day` writes, not the config-key currency rematerialize path (see §1.3).

**Amends:** [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md) §1 scope-out derived row + §8 deferred table row (closed for property-local one-level percent-of-parent). [property setup SPA](./2026-08-13-property-setup-spa-design.md) §1.3 scope-out derived (~69) + §19 leftover **2** (~539) (closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Rate plans shipped as property-local entities with a BAR seed, archive lifecycle, and materialized `rate_day` rows. **Derived plans** (“BAR −15%”) were explicitly deferred: ARCHITECTURE §7.2 describes a chain-wide derivation graph in OrgDO, while Phase 1 landed independent plans only.

This chunk closes the **property-local derived half**: one-level, percent-of-parent plans stored as ordinary `rate_plan` rows (like BAR), with child amounts **materialized into `rate_day`** whenever a parent night is written. Quotes, booking snapshots, and night-audit `POST_ROOM_CHARGES` already read `rate_day` by `reservation.rate_plan_id` via `rateDayAmountSync` (~6892) — derived nights become real ledger rows; no reservation scan.

**Explicit campaign override:** ARCHITECTURE §7.2’s “plan *definitions* live in OrgDO” does **not** apply here. No OrgDO table, no org `rate_plan.changed` Workflow, no cross-property projection.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| `rate_plan` table + BAR seed | v12 ~346–357; cancel-policy columns v20 ~577–585 |
| Plan CRUD | `tryCreateRatePlan` ~10511, `tryUpdateRatePlan` ~10628, `tryDeleteRatePlan` ~10785; events `rate_plan.changed`; BAR protected |
| Plan validation on writes | `assertActiveRatePlanSync` ~10462–10469 |
| Parent rate writes | `tryUpsertRateDay` ~12375 (also `rates.update_room_type_rate` audit id); `tryBulkUpdateRates` ~12480; `rates.upsert_day` HTTP alias |
| Rate lookup | `rateDayAmountSync` ~6892 — `SELECT amount_minor FROM rate_day WHERE room_type_id, rate_plan_id, stay_date` |
| Night audit ROOM | `POST_ROOM_CHARGES` uses `reservation.rate_plan_id` + `rateDayAmountSync` (~3149, ~6892) |
| Quote / snapshot | `snapshotRateNightsSync` ~6915 copies `rate_day` into `reservation_rate_night` |
| Money rounding | `roundHalfAwayFromZero` ~123 (`packages/money`) |
| Archive blocked precedent | `ARCHIVE_BLOCKED` wire code; room-type / room archive → **409** in dispatch |
| HTTP plan bodies | POST ~3646–3655, PATCH ~3691–3709 — cancel-policy fields only today |
| SPA plans + matrix | `RatesScreen` ~211–228 create; matrix edits selected plan via `PUT /rate-days` |
| Catalog / HTTP heads | Five `rates.*` plan/rate commands unchanged count; last route `[133]` |
| Config rematerialize flag | `rematerializesRates: true` on currency keys ~163, ~179 — **no DO handler** |

**Heads (frozen — this chunk moves only property schema):**

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **81** | **81** — extend `rates.create_plan` / `rates.update_plan` input shapes only |
| `AUDIT_WRITER_COMMAND_IDS.size` | **56** | **56** — no new writer |
| `V1_HTTP_ROUTE_AUDIT` | `[133] = post_folio_reconcile_payment` | **unchanged** — extend existing POST/PATCH bodies; `[132]`/`[131]`/`[127]` unmoved |
| `PROPERTY_SCHEMA_HEAD` | **29** | **30** — `parent_rate_plan_id`, `derive_bps` on `rate_plan` |
| `ORG_SCHEMA_HEAD` | **7** | **7** — **no OrgDO rate_plan** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — no 9th step |
| `PLATFORM_GAPS` | `[]` | stays `[]` |

### 1.2 Scope in

1. **v30 migration** — nullable `parent_rate_plan_id`, `derive_bps` on `rate_plan` (Lock 2).
2. **Validation + wire codes** on create/update/archive (Lock 2, Lock 4).
3. **Rematerialization helpers** on parent `rate_day` writes and on derived plan create/update (Lock 3).
4. **Reject manual derived `rate_day` writes** via upsert/bulk/PUT matrix (Lock 3).
5. **Extend** `listRatePlans`, HTTP POST/PATCH, `client-core` types, dispatcher fingerprint allowlists.
6. **SPA** derived plan fields + read-only derived matrix cells (Lock 5).
7. Tests Lock 6; `pnpm generate:ddl`; register + migrate pin updates.

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- OrgDO-hosted / chain-wide plan definitions; org Workflow projection; `rate_plan.changed` bulk rematerialize job
- Promo codes; seasonal / LOS modifiers on the derivation graph (unless already in tree — they are not)
- Virtual-type rate sharing across constituents
- Plan-scoped restrictions (`restriction_day.rate_plan_id ≠ '*'`)
- Manual override of a derived `rate_day` (forbidden this chunk; named leftover if ever needed)
- **`rematerializesRates` config consumer** (property-setup leftover **14** ~551; rule-3 §2.5) — derived rematerialization is **not** that consumer; do not build a general currency/timezone rematerialize Workflow here
- City ledger / AR; invoices; night-audit step growth; `reservations.update_extras`; inclusions
- New catalog command id; new V1 HTTP route; new audit writer; `CLASS_DENYLIST` edit; new `export class`
- Bidirectional leftover pointer sentences (final implementation task)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Property-local only; OrgDO chain-wide OUT

Derived plans are **PropertyDO `rate_plan` rows**, same plane as BAR and CORP-style independent plans.

**Forbidden:** OrgDO `rate_plan` table or migration; org-scoped `rate_plan.changed` Workflow that projects to properties; cross-property parent lookup; reading parent amounts from another property’s PropertyDO.

`rate_plan.changed` outbox events stay property-scoped (existing shape). The queue consumer’s noop handling (~139) is sufficient — rematerialization is **synchronous inside PropertyDO** on write paths, not an async projection job.

### Lock 2 — One-level graph; percent-of-parent columns

**v30** — append to `PROPERTY_MIGRATIONS`; regenerate `migrations/do-property/0030_derived_rate_plans.sql`:

```sql
ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT;
ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000));
```

Naming matches tree snake_case. **No FK** from `parent_rate_plan_id` → `rate_plan` (same deploy-day orphan honesty as `rate_day` → `rate_plan`).

**Semantics:**

| Column | Meaning |
|---|---|
| `parent_rate_plan_id` | Active independent parent plan id, or `NULL` |
| `derive_bps` | Basis points applied to **parent** `rate_day.amount_minor`. **Negative** = discount (`BAR − 15%` → `-1500`). `NULL`/`NULL` = independent plan |

**Pairing invariant (create + update):** `(parent_rate_plan_id IS NULL) ↔ (derive_bps IS NULL)`. Both set or both cleared. Mismatch → **`derived_rate_plan_invalid`**.

**Parent eligibility:** Parent must exist, `status = 'active'`, and **`parent_rate_plan_id IS NULL`** (independent only). Parent is derived → reject. Parent missing/archived → reject. Self-parent → reject. **No derived-of-derived.**

**BAR:** May be a parent. BAR itself stays independent (`parent_rate_plan_id` remains `NULL`; existing `DEFAULT_RATE_PLAN_PROTECTED` on BAR code change unchanged).

**Archive parent:** `tryDeleteRatePlan` must reject when any **active** child exists (`parent_rate_plan_id = ? AND status = 'active'`) → reuse wire code **`archive_blocked`** (`ARCHIVE_BLOCKED`), HTTP **409** (same pattern as room-type archive). Archiving a derived plan with no children remains allowed.

**Independent → derived transition on update:** Allowed when parent eligibility passes. **Derived → independent** (clear both columns): allowed; existing child `rate_day` rows **remain** (historical materialization; new parent writes no longer update them). Named honesty — no scrub this chunk.

**New wire codes** (add to `packages/contracts/src/idempotency.ts` + dispatch status map):

| Code | When |
|---|---|
| `derived_rate_plan_invalid` | Pairing / parent eligibility / bps range / self-parent |
| `derived_rate_plan_write_forbidden` | Manual write targeting a derived plan’s `rate_day` |

Do **not** add a distinct code for derived-of-derived vs bad parent — one `derived_rate_plan_invalid` is enough.

### Lock 3 — Materialize into `rate_day`; do not scan reservations

**Formula** (integer minor units, parent amount `P`, basis points `b`):

```ts
childMinor = Number(
  roundHalfAwayFromZero(BigInt(P) * BigInt(10_000 + b), 10_000n),
);
```

Import `roundHalfAwayFromZero` from `@hospai/money`. Reject non-safe-integer results (`InvalidMoneyError` path → existing money error mapping).

**When to rematerialize (sync, same transaction as the triggering write):**

1. **After parent `rate_day` upsert** — when `rates.update_room_type_rate`, `rates.bulk_update`, or `rates.upsert_day` writes `(roomTypeId, parentRatePlanId, stayDate)`, call `rematerializeDerivedChildrenSync(parentRatePlanId, roomTypeId, stayDate)`:
   - `SELECT rate_plan_id, derive_bps FROM rate_plan WHERE status = 'active' AND parent_rate_plan_id = ?`
   - Load parent `amount_minor, currency` for that cell; **if no parent row, skip** (do not invent child nights)
   - Upsert each child `(roomTypeId, childPlanId, stayDate)` with computed amount + parent currency; emit `rate.changed` + audit per child upsert (same shape as parent upsert) OR batch with one audit per child cell — **must** leave an audit trail per child night written

2. **After derived plan create** — `backfillDerivedPlanSync(childRatePlanId)`:
   - For each `(room_type_id, stay_date)` where parent has a `rate_day`, materialize child row (all active room types)

3. **After derived plan update** when `parentRatePlanId` and/or `deriveBps` changes — full rematerialize for that child across all parent `rate_day` rows (same as backfill)

**Manual derived writes forbidden:** At start of `tryUpsertRateDay` / per cell in `tryBulkUpdateRates`, if target plan has `parent_rate_plan_id IS NOT NULL` → **`derived_rate_plan_write_forbidden`** (422). Matrix `PUT /rate-days`, bulk fill, and `put_room_type_rate` inherit this via shared DO path.

**Currency:** Child rows copy parent cell currency. Derived plans do not introduce multi-currency logic beyond existing parent nights.

**Deletes / archive:** Archiving a derived plan does not delete its `rate_day` rows (same archive-not-delete rule as independent plans). Archiving a parent blocked while active children exist (Lock 2).

### Lock 4 — Create/update API (extend existing commands)

**No new catalog id.** Extend fingerprints + HTTP bodies on existing routes only.

**`rates.create_plan` / POST `/rate-plans`** — optional body fields:

```ts
parentRatePlanId?: string | null;
deriveBps?: number | null;
```

Fingerprint allowlist adds both keys (omit vs null normalization: treat omitted and explicit `null` as independent). After successful insert, run `backfillDerivedPlanSync` when derived.

**`rates.update_plan` / PATCH `/rate-plans/:id`** — same optional fields; at least one field required rule extends to include them. Changing parent or bps triggers full child rematerialize. Cannot PATCH a derived plan to point at a derived parent.

**`GET /rate-plans` / `listRatePlans`** — additive JSON (existing clients ignore):

```ts
parentRatePlanId: string | null;
deriveBps: number | null;
```

**`client-core`:** extend `createRatePlan` / `updateRatePlan` input types (~1639–1671).

**Dispatch:** extend `handlePostRatePlans` / `handlePatchRatePlan` body parsing + `invalid_body` guard (~3701–3710 pattern).

**Events:** keep `rate_plan.changed` on create/update/archive; no new event type. Child rematerialization emits existing **`rate.changed`** per cell (same as parent writes).

### Lock 5 — SPA (property setup / Rates)

Extend existing **`RatesScreen`** plans tab (~270+) — do not add a new screen.

**Create plan form:** When operator chooses “Derived from…” (short copy):

- Parent select: active plans where `parentRatePlanId == null`, excluding the plan being created
- Derive % input: map UI “−15%” → `deriveBps: -1500` (integer bps, no float amounts)
- Submit via existing `api.createRatePlan` with new fields

**Plans table:** Optional short badge when `parentRatePlanId` set (e.g. “−15% of BAR”) — keep copy minimal.

**Matrix tab:** Plan selector unchanged. When selected plan is derived (`parentRatePlanId != null`):

- Cells **read-only** (show materialized amounts from `GET /rate-days`)
- No blur/commit to `PUT /rate-days`; bulk fill disabled for derived plan
- Helper copy: “Edit the parent plan’s rates.” (one line)

Independent plans (BAR, CORP) keep today’s editable matrix behaviour.

### Lock 6 — Tests

File-filter vitest. **No `vi.spyOn` into DO isolate.**

Add cases to `rate-plans-routes.spec.ts` (or sibling `derived-rate-plans.spec.ts` if cleaner):

1. Create derived from BAR with `deriveBps: -1500`; list returns parent + bps
2. Write BAR night `10000` minor → child `rate_day` `8500` for same `(roomTypeId, stayDate)` (roundHalfAwayFromZero)
3. Parent night missing → no child row invented
4. Archive BAR while active derived child → **409** `archive_blocked`
5. Create derived with derived parent → **422** `derived_rate_plan_invalid`
6. `PUT /rate-days` targeting derived plan → **422** `derived_rate_plan_write_forbidden`
7. Booking quote / `reservation_rate_night` snapshot on derived plan uses child `rate_day` amount
8. PATCH parent/bps → rematerializes existing nights

**Register pins after land:**

- `COMMAND_CATALOG.length === 81`
- `AUDIT_WRITER_COMMAND_IDS.size === 56`
- `V1_HTTP_ROUTE_AUDIT[133].id === 'post_folio_reconcile_payment'`
- `PROPERTY_SCHEMA_HEAD === 30`
- `ORG_SCHEMA_HEAD === 7`
- `NIGHT_AUDIT_STEPS.length === 8`
- `pnpm generate:ddl` → `0030_derived_rate_plans.sql`; migrate test pin updated

---

## 3. Implementation pointers (non-normative)

Suggested sync helpers in `property-do.ts` adjacent to rate plan RPCs:

```ts
private isDerivedRatePlanSync(ratePlanId: string): boolean { /* parent_rate_plan_id IS NOT NULL */ }
private computeDerivedAmountMinorSync(parentMinor: number, deriveBps: number): number { /* Lock 3 formula */ }
private rematerializeDerivedChildrenSync(parentRatePlanId: string, roomTypeId: string, stayDate: string): void
private backfillDerivedPlanSync(childRatePlanId: string): void
```

Hook (1) at end of `tryUpsertRateDay` txn body (~12426+) and equivalent bulk loop (~12546+). Hook (2)(3) at end of `tryCreateRatePlan` / `tryUpdateRatePlan` success paths.

**Index (optional but recommended):** `CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = 'active'` for archive guard + rematerialize queries.

---

## 4. Acceptance checklist

- [ ] v30 migration + `PROPERTY_SCHEMA_HEAD` **30**
- [ ] Derived create/update/archive validation + wire codes
- [ ] Parent write rematerialize + derived create backfill + update rematerialize
- [ ] Derived manual rate write rejected on all write paths
- [ ] HTTP POST/PATCH + GET list + client-core extended; fingerprints updated
- [ ] SPA derived form + read-only matrix
- [ ] Tests Lock 6; register pins (**81** / **56** / `[133]` / steps **8**)
- [ ] Bidirectional closes pointers in rate-plans + property-setup specs (final implementation task)

---

## 5. Tree conflicts with reviewer locks

**None on heads.** Verified post-`952830d`: catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, schema **29** (this chunk → **30**), `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1067), five plan commands present (~683–711), `rate_day` keyed by `(room_type_id, rate_plan_id, stay_date)`, `rematerializesRates` still dead.

**Notes for implementer (not lock violations):**

1. **`cancel_penalty_bps` vs `derive_bps`** — both are basis points on different domains; do not conflate in UI labels (cancel % vs rate derivation %).
2. **Bulk update** with mixed parent/derived cells: derived-target cells fail fast with `derived_rate_plan_write_forbidden`; parent cells still write + rematerialize children.
3. **Backfill on create** can be O(types × parent nights) — acceptable for Phase 1 property sizes; no Workflow chunking required (contrast ARCHITECTURE §7.2 org projection — explicitly out).
4. **Leftover 14** stays open: currency-change rematerialize is unrelated; do not wire `tryPutDomainConfig` → rematerialize in this chunk unless a stub already exists (it does not).
5. **Demo seed** — optional BAR−10% derived plan; not required for acceptance if tests cover behaviour.

**Concerns:**

| Concern | Mitigation locked |
|---|---|
| Large backfill on create in busy hotels | Phase 1 acceptable; full backfill only on create / parent-bps change |
| Stale child nights after parent→independent demotion | Documented: rows remain until overwritten; no silent scrub |
| Operator confusion (cancel % vs derive %) | SPA copy kept short; separate form fields |
