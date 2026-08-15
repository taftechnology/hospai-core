# Night-audit auto-extend (in-house due-out stays)

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **79** (`register.test.ts` ~664), `AUDIT_WRITER_COMMAND_IDS.size === 54` (`register.test.ts` ~663), `V1_HTTP_ROUTE_AUDIT[131].id === 'post_folio_routing_rule_archive'` (`register.test.ts` ~655–661; `v1-http-routes.ts` ~772), `[128] post_folio_stay_discount` (`register.test.ts` ~633–638; `v1-http-routes.ts` ~751–756), `[127] post_demo_seed` (`register.test.ts` ~619–624; `v1-http-routes.ts` ~747), `PROPERTY_SCHEMA_HEAD === 28` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1063–1072), `PLATFORM_GAPS === []` (`register.test.ts` ~665).

**Date:** 2026-08-15  
**Status:** Approved (reviewer, 2026-08-15)  
**Sources:** ARCHITECTURE.md §8 (8-step night-audit machine; `POST_ROOM_CHARGES` before roll; do not grow steps without authorization); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) (leftover **4** — `auto_extend` unread); [property setup SPA](./2026-08-13-property-setup-spa-design.md) §8.1 (`pms.night_audit.auto_extend` DOMAIN, default `true`, editable; leftover **16** half-open); [auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md) (consumer pattern; names `auto_extend` as unrelated leftover **5**); [night-audit auto-transfer](./2026-08-14-night-audit-auto-transfer-design.md) (`runAuditStep` Txn B per-reservation skip vs step failure); [virtual room types](./2026-08-14-virtual-room-types-design.md) (`allocated_room_type_id` for physical ledger); `packages/contracts/src/config/register.ts` (`pms.night_audit.auto_extend` ~118–124); `packages/contracts/src/commands/catalog.ts` (`reservations.modify` ~157–166); `packages/contracts/src/commands/audit-writers.ts` (`reservations.modify` in set); `packages/contracts/src/permissions.ts` (`SystemActor.reason` includes `'night_audit'` ~13); `apps/pms-core/src/property-do.ts` (`NIGHT_AUDIT_STEPS` ~1063–1072, `runAuditStep` ~2579–2649, `postRoomChargesSync` ~12881–12946, `tryModifyReservation` date-extend path ~7847–8068, `commitSoldNightsSync` ~6848–6889, `syncReservationRateNightsOnModifySync` ~6684–6715, `assertRoomAssignableSync` ~6173–6219, `readConfigValueSync` ~1852–1860); `apps/web-pms/src/screens/SettingsScreen.tsx` (`DomainBool` auto extend ~478–483, no hint today); `apps/web-pms/src/screens/SettingsScreen.test.tsx` (toggle case ~128–141); `apps/pms-core/test/night-audit-room-charges.spec.ts` (POST harness, step-count pin ~308–310, `no_post` case **37** ~274–306); `apps/pms-core/test/night-audit-auto-transfer.spec.ts` (step-count pin ~198–201); `apps/pms-core/test/night-audit-no-shows.spec.ts` (`tryPutDomainConfig` pattern ~64–70); `apps/pms-core/test/reservations.spec.ts` (`readAvailabilityDay` sold asserts); `apps/pms-core/test/reservations-auto-assign.spec.ts` (`tryCheckIn` + room seed helpers).

**Closes:** [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) leftover **4** — `pms.night_audit.auto_extend` unread. Remaining half of [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover **16** (`auto_extend` consumer; `auto_assign_rooms` half already closed in [auto-assign rooms](./2026-08-14-auto-assign-rooms-design.md)).

**Amends:** [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) §12 leftover **4** (closed — machine reads config inside `POST_ROOM_CHARGES`). [property setup SPA](./2026-08-13-property-setup-spa-design.md) §8.1 “Still no night-audit reader” + leftover **16** (closed for `auto_extend`). [auto-assign rooms at check-in](./2026-08-14-auto-assign-rooms-design.md) §8 leftover **5** (closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Property-setup SPA landed `pms.night_audit.auto_extend` as **DOMAIN**, default **`true`**, editable on Settings — but explicitly deferred the consumer (night-audit E2E leftover **4**; property-setup §8.1). Human already authorized growing the night-audit machine once (`AUTO_TRANSFER` at index **3**). Auto-extend is a **config consumer inside the existing `POST_ROOM_CHARGES` body**, not a ninth fiscal step.

On night audit of business date **D**, in-house guests due out tomorrow morning (`departure_date = D+1`) may be extended one calendar night when inventory and room assignability allow. Extension runs **before** tonight’s ROOM posting so `postRoomChargesSync(businessDate)` still posts night **D** exactly once (including for guests extended during this same step).

No new catalog command, HTTP route, or schema migration. `NIGHT_AUDIT_STEPS` length stays **8**.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Step sequence (8) | `NIGHT_AUDIT_STEPS` — `property-do.ts` ~1063–1072: `PRE_CHECK → POST_ROOM_CHARGES → PROCESS_NO_SHOWS → AUTO_TRANSFER → CLOSE_CASHIER_SHIFTS → SNAPSHOT_REPORTS → ROLL_BUSINESS_DATE → ARCHIVE` |
| Step runner | `runAuditStep` ~2579–2649: Txn B body; `POST_ROOM_CHARGES` branch calls **`postRoomChargesSync(businessDate)` only** ~2637–2638 — no auto-extend hook yet |
| Room charge posting | `postRoomChargesSync` ~12881–12946: `status IN ('confirmed', 'checked_in')`, `COALESCE(no_post, 0) = 0`, `arrival_date <= D AND departure_date > D`; idempotent via `folio_line_audit_uniq` |
| Modify inventory path | `tryModifyReservation` same-SKU date extend ~7847–8068: sold release/acquire, `restrictionFailureSync`, `syncReservationRateNightsOnModifySync`, `reservation.modified` + `availability.changed`, audit `reservations.modify` |
| Inventory helpers | `commitSoldNightsSync` ~6848–6889; `assertRoomAssignableSync` ~6173–6219 (overlap, OOO range, type match) |
| Config key | `pms.night_audit.auto_extend` — `register.ts` ~118–124: `DOMAIN`, `bool`, **`default: true`**, `consumers: night` |
| Config read in DO | `readConfigValueSync` ~1852–1860 (same pattern as `auto_no_show` / `auto_assign_rooms`) |
| System audit actor | `permissions.ts` ~10–18: `{ kind: 'system', reason: 'night_audit' }` already on `SystemActor` union; used e.g. `tryAddFolioLine` ~12978 |
| Audit writer | `reservations.modify` in `AUDIT_WRITER_COMMAND_IDS` (`audit-writers.ts`; `register.test.ts` ~795+) |
| SPA settings | `SettingsScreen.tsx` ~478–483: `DomainBool` “Auto extend”, no `hint` prop; toggle test ~128–141 |
| POST test harness | `night-audit-room-charges.spec.ts`: `provisionedPropertyStub`, `runAuditStep(…, 'POST_ROOM_CHARGES')`, step-count pin ~308–310 |
| Auto-transfer skip pattern | `runAutoTransferSync` ~3067–3112: per-candidate skip, step always `COMPLETED` |
| Catalog / audit / gaps | `COMMAND_CATALOG` **79** (~664); `AUDIT_WRITER_COMMAND_IDS.size` **54** (~663); `PLATFORM_GAPS` `[]` (~665) |
| Schema heads | `PROPERTY_SCHEMA_HEAD` **28** (~618); `ORG_SCHEMA_HEAD` **7** (~619) |
| HTTP head | `[131] post_folio_routing_rule_archive` (~655–661) — **unchanged**; `[128]` / `[127]` unmoved |

**Heads (frozen — this chunk does not move them):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[131] = post_folio_routing_rule_archive` | **unchanged** — `[128]`/`[127]`/`[102]` unmoved |
| `COMMAND_CATALOG` | length **79** | **79** |
| `AUDIT_WRITER_COMMAND_IDS.size` | **54** | **54** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **28** | **28** (no migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — **no** `AUTO_EXTEND` token |

### 1.2 Scope in

1. **`runAutoExtendSync(businessDate)`** private helper — config-gated candidate query, per-reservation extend or skip (Lock 2–3).
2. **`POST_ROOM_CHARGES` branch** — when config true, call helper **then** existing `postRoomChargesSync` (Lock 1).
3. **Audit / outbox** — reuse `reservations.modify` writer id; `afterJson.automated: true`; system actor (Lock 3).
4. **SPA** — Settings hint on existing Auto extend toggle (Lock 4).
5. **Tests** §7; register pin verification (heads unchanged).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- Growing `NIGHT_AUDIT_STEPS` to **9** / new `AUTO_EXTEND` step
- New catalog command / HTTP route / schema migration / `night_audit.auto_extend` catalog id
- Extending **confirmed** (not checked-in) stays — no-show path unchanged
- Multi-night extend, walk-in auto-extend at desk, CRS-driven extend
- Recurring / `breakfast_rule` posting inside `POST_ROOM_CHARGES`
- `rooms.delete`, derived rates, promo, invoices, city ledger
- Consuming `pms.ops.auto_assign_rule` / `pms.ops.auto_assign_rooming`
- Promoting check-in or modify degraded class
- Demo seed rewrite
- New `export class` / `CLASS_DENYLIST` edit
- `listDomainConfig` elsewhere on desk surfaces
- Bidirectional pointer sentences in amended specs (final implementation task)
- Night-audit HTTP / replay class changes (`FAIL_CLOSED` stays)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Consumer inside `POST_ROOM_CHARGES`, not a 9th step

Wire the consumer in `runAuditStep` Txn B **`POST_ROOM_CHARGES` branch** (`property-do.ts` ~2637–2638):

```ts
} else if (step === 'POST_ROOM_CHARGES') {
  if (this.readConfigValueSync('pms.night_audit.auto_extend') === true) {
    this.runAutoExtendSync(businessDate);
  }
  this.postRoomChargesSync(businessDate);
}
```

**Do not** insert `AUTO_EXTEND` into `NIGHT_AUDIT_STEPS`. **Do not** add a `night_audit.auto_extend` catalog id. Length stays **8**. `ROLL_BUSINESS_DATE` stays last-but-one (index **6**).

Config **`false`** (stored `property_config` only) → skip helper; POST behaves exactly as today. Unset key uses register default **`true`** → helper **runs**.

Uncaught throw inside helper or `postRoomChargesSync` → Txn B rolls back → step **`FAILED`** + halt (same as other steps). Per-reservation skip (Lock 3) is **not** step failure.

### Lock 2 — Who gets extended

On night audit of business date **D**, query candidates:

| Filter | Value |
|---|---|
| `status` | `'checked_in'` only |
| `departure_date` | **`D+1`** (calendar add one day — use same date math as tests: `addCalendarDays(D, 1)` from `date-helpers.ts` or inline equivalent) |

**Not** `confirmed` — those remain eligible for `PROCESS_NO_SHOWS`, not extend. **Not** `checked_out`. **`no_post` does not skip extend** — guest still occupies the room; `postRoomChargesSync` already excludes `no_post = 1` from ROOM lines (~12889–12890).

**Idempotent:** `departure_date > D+1` is not a candidate. Re-running `POST_ROOM_CHARGES` on the same **D** after a successful extend is a no-op for extend (zero candidates).

Order: process candidates in stable query order (e.g. `reservation_id ASC`); order is not guest-visible.

### Lock 3 — What extend does

For each candidate reservation on date **D**:

1. **Next departure:** `newDeparture = D+2` (+1 calendar day on `departure_date`).
2. **Ledger room type:** `allocatedId = allocated_room_type_id || room_type_id` (virtual-types lock — sold ledger on physical allocated type).
3. **Added stay night:** `addedNight = D+1` (the night being acquired; half-open `[arrival, newDeparture)` gains this date).
4. **Assigned room gate:** if `room_id` is set, call `assertRoomAssignableSync(room_id, { reservationId, allocatedRoomTypeId: allocatedId, arrivalDate, departureDate: newDeparture })`. On **any** assignability throw (`ROOM_ALREADY_ASSIGNED`, `ROOM_OUT_OF_ORDER`, OOO range hit ~6205–6217, `ROOM_TYPE_MISMATCH`, etc.) → **skip** this reservation (continue loop).
5. **Inventory:** acquire **one** sold night on `allocatedId` for stay-date **`D+1`** using the same helpers the modify date-extend path uses:
   - Prefer wrapping `commitSoldNightsSync(allocatedId, arrivalDate, newDeparture, [D+1])` inside try/catch for `NoAvailabilityError` / `UnbookableError` / restriction failures from `restrictionFailureSync` → **skip**.
   - Do **not** invent a second availability algorithm.
6. **Reservation row:** `UPDATE reservation SET departure_date = newDeparture, updated_at = ? WHERE reservation_id = ?`. **Keep `room_id`** unchanged.
7. **Rate snapshot:** append quote-snapshot night for **`D+1`** — call `syncReservationRateNightsOnModifySync(reservationId, room_type_id, rate_plan_id, oldNights, newNights)` where `oldNights = enumerateStayDates(arrival, D+1)` and `newNights = enumerateStayDates(arrival, D+2)` (lazy backfill pattern; same as modify extend — do not invent a second snapshot writer).
8. **ARI version:** `bumpAriVersionSync()` when sold commits (same as modify inventory path).
9. **Outbox:** emit the same events modify emits for a date change:
   - `reservation.modified` (payload `from` / `to` dates)
   - `availability.changed` on `allocatedId` spanning the union of old/new night ranges (mirror ~8011–8023 same-SKU branch)
10. **Audit:** `appendAuditLogSync` with:
    - `commandId: 'reservations.modify'` (already in `AUDIT_WRITER_COMMAND_IDS` — **do not** add a new writer id)
    - `actor: this.auditActorSync({ kind: 'system', reason: 'night_audit' })` — **do not** add `night_audit.auto_extend` catalog command; **do not** add a new `SystemActor.reason` unless typecheck forces it (prefer existing `'night_audit'`)
    - `beforeJson`: `{ departureDate: D+1, … }`; `afterJson`: `{ departureDate: D+2, automated: true }`
    - `entityType: 'reservation'`, `entityId: reservationId`, `reservationId`

**Do not** call `tryModifyReservation` RPC — no `gatePermission('reservations:write')`, no `touchInteractive()`, no per-stay `runIdempotent`. Extract / reuse private sync helpers only.

**Per-reservation skip** (assignability, no availability, restriction) → continue; step completes **`COMPLETED`**. **`postRoomChargesSync(D)` still runs** after the loop.

### Lock 4 — SPA

**`SettingsScreen` → Property / Night audit**

Add `hint` on the existing Auto extend `DomainBool` (~478–483):

**“When on, night audit extends in-house stays that are due out tomorrow by one night if the extra night is available.”**

Update **`SettingsScreen.test.tsx`**: add assertion that the hint string is visible (keep existing toggle case ~128–141 green).

**Do not** add a new Settings tab. **Do not** add `listDomainConfig` reads elsewhere.

### Lock 5 — Replay / degraded

Night audit stays **`FAIL_CLOSED`** as today. No HTTP surface. No `QUEUE_PROVISIONAL` change. Config is read at step execution time from stored DOMAIN config (`readConfigValueSync`).

---

## 3. Commands / HTTP (unchanged)

| | |
|---|---|
| Night-audit steps | Existing eight — no new step token |
| Commands | **None** — no `night_audit.auto_extend` id |
| Audit writer | Reuse **`reservations.modify`** for extend audit rows only |
| HTTP | **Unchanged** — `[131]` last |
| Config | `pms.night_audit.auto_extend` register entry unchanged (~118–124) |

No catalog length change. No `AUDIT_WRITER_COMMAND_IDS` size change.

---

## 4. Schema

**None.** `PROPERTY_SCHEMA_HEAD` stays **28**. No migration, no demo seed rewrite.

---

## 5. Errors (existing only)

No new wire codes.

| Situation | Behaviour |
|---|---|
| Per-reservation no availability / restriction / unbookable night | **Skip** reservation; step **`COMPLETED`** |
| Assigned room OOO / overlap on extended range | **Skip** reservation |
| Missing BAR / `RateMissingError` on extra night **D+1** during extend | **Skip** reservation (same class as no-avail); step **`COMPLETED`** |
| Other uncaught throw in helper or `postRoomChargesSync` (e.g. `CURRENCY_UNSET`) | Step **`FAILED`**; Txn B rolled back |
| Config `false` | Helper not called; POST unchanged |
| Confirmed due out `D+1` | Not a candidate; `PROCESS_NO_SHOWS` behaviour unchanged |

Desk modify errors (`NOT_MODIFIABLE`, `NO_AVAILABILITY` wire codes) apply only to `tryModifyReservation` — auto-extend uses internal skip, not guest-facing RPC errors.

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/src/property-do.ts` | `runAutoExtendSync`; Lock 1 branch in `runAuditStep`; reuse `commitSoldNightsSync`, `assertRoomAssignableSync`, `syncReservationRateNightsOnModifySync`, outbox/audit pattern from modify |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | Auto extend `hint` |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | Hint RTL assertion |
| `apps/pms-core/test/night-audit-auto-extend.spec.ts` (new, preferred) or extend `night-audit-room-charges.spec.ts` | DO cases §7.1 |
| `packages/contracts/src/register.test.ts` | Verify pins unchanged: catalog **79**, writers **54**, `[131]` last, `[128]`/`[127]` unmoved, `NIGHT_AUDIT_STEPS.length === 8`, no `AUTO_EXTEND` |

**Not touched:** `packages/contracts/src/commands/catalog.ts`, `v1-http-routes.ts`, `v1-dispatch.ts`, `packages/client-core`, `config/register.ts`, migrations, `NIGHT_AUDIT_STEPS` array contents/length, `permissions.ts` (unless typecheck requires — prefer not), demo seed, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`.

---

## 7. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Use **`provisionedPropertyStub`** and night-audit helpers from `night-audit-room-charges.spec.ts` / `night-audit-auto-transfer.spec.ts`. Date math: **`addCalendarDays`** from `date-helpers.ts` (or local `addDays` matching room-charges spec). **`tryPutDomainConfig`** for config-off case (pattern from `night-audit-no-shows.spec.ts` ~64–70). Sold asserts via **`stub.readAvailabilityDay`**. **Do not** `vi.spyOn` into the DO isolate. **Do not** invent `provisionedPropertyWorker`.

**CI (encode for implementer):**

- Rebuild `@hospai/contracts` before pms-core tests only if contracts change (this chunk should not).
- Rebuild `@hospai/client-core` before web-pms tests only if client changes (should not).
- File-filter vitest; unsharded `pnpm --filter @hospai/pms-core test` may segfault. Shards: `--shard=N/8` with **no** `--` before `--shard`. Workerd 503: retry that shard once. Do not `|| true`.
- `pnpm check:web-pms-colors` if SPA files touched.
- Living plan checkboxes only on the last plan task (for the later plan writer).

### DO — auto-extend (`night-audit-auto-extend.spec.ts` or sibling)

| # | Case | Assert |
|---|---|---|
| 1 | Config default **true**; `checked_in`, `departure = D+1`, inventory free for `D+1`; rate seeded for tonight **D** | After `POST_ROOM_CHARGES`: `departure_date = D+2`; `readAvailabilityDay(allocatedType, D+1).sold` incremented by 1; exactly **one** NIGHT_AUDIT ROOM line for night **D** |
| 2 | `tryPutDomainConfig('pms.night_audit.auto_extend', false)`; same fixture | `departure_date` unchanged **D+1**; no sold increment on **D+1** |
| 3 | **`confirmed`** (not checked_in), `departure = D+1` | Not extended; still `confirmed`; no sold increment on **D+1** |
| 4 | No availability on **D+1** (sell out type or `stop_sell` on **D+1**) | Skip; `departure` unchanged; step **`COMPLETED`**; POST still posts ROOM for **D** |
| 5 | Assigned `room_id`; `trySetOooRange` covering **D+1** | Skip; `departure` unchanged; step **`COMPLETED`** |
| 6 | Rerun `POST_ROOM_CHARGES` same **D** after successful extend | No second sold increment on **D+1**; `departure` stays **D+2** |
| 7 | Static pin | `NIGHT_AUDIT_STEPS.length === 8`; `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'`; no `'AUTO_EXTEND'` in array |

Optional on case **1**: audit row `commandId === 'reservations.modify'` and `afterJson.automated === true`; outbox contains `reservation.modified` and `availability.changed`.

### SPA RTL

| # | Case | Assert |
|---|---|---|
| 8 | Settings property tab | New auto-extend hint copy visible (`SettingsScreen.test.tsx`) |

### Register pin

`register.test.ts`: catalog **79**, writers **54**, `[131]` last, `[128]`/`[127]` unmoved; `NIGHT_AUDIT_STEPS.length === 8`; `PLATFORM_GAPS === []`.

---

## 8. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **Multi-night auto-extend** | Only +1 night per audit |
| 2 | **Desk / CRS extend for due-out** | Modify RPC remains the desk path |
| 3 | **Extend confirmed no-shows** | Explicitly out — no-show step owns `confirmed` |
| 4 | **Smarter extend heuristics** | Rate re-quote, guest consent, payment guarantee |
| 5 | **Recurring / `breakfast_rule` in POST** | Night-audit E2E leftover **3** — unrelated |
| 6 | ~~**`rooms.delete`**~~ **Closed** in [2026-08-15 rooms delete — physical-unit archive](./2026-08-15-rooms-delete-archive-design.md). | ~~Phase 1 queue item **4**~~ |

---

## 9. Implementation checklist

- [x] `runAutoExtendSync(businessDate)`: candidate query Lock 2; per-reservation extend Lock 3; skip vs throw contract.
- [x] `runAuditStep` `POST_ROOM_CHARGES`: config gate → helper → `postRoomChargesSync` (Lock 1).
- [x] Reuse `commitSoldNightsSync` / `assertRoomAssignableSync` / `syncReservationRateNightsOnModifySync`; emit modify outbox + audit (`automated: true`).
- [x] `SettingsScreen` hint + `SettingsScreen.test.tsx` case **8**.
- [x] DO tests §7.1 cases **1–7**; register pins unchanged.
- [x] `pnpm check:web-pms-colors` if SPA tokens touched.
- [x] Bidirectional pointers: night-audit E2E §12 leftover **4**; property-setup §8.1 + leftover **16**; auto-assign §8 leftover **5** (final implementation task).

---

## 10. Tree conflicts with reviewer locks

**None.** Verified: heads match §1.1; `POST_ROOM_CHARGES` today calls only `postRoomChargesSync` (~2637–2638); `pms.night_audit.auto_extend` already DOMAIN + default `true` (~118–124); `reservations.modify` already in audit writers; `[131]`/`[128]`/`[127]` pins match `register.test.ts` ~619–661; `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1067); `SystemActor.reason` already includes `'night_audit'` (~13).

**Note for implementer:** `tryModifyReservation` rejects `checked_in` with `NOT_MODIFIABLE` (~7733–7738) — auto-extend **must** be a separate internal sync helper, not an RPC wrapper. Helper runs **before** `postRoomChargesSync` so tonight’s charge uses pre-extend in-house filter (`departure_date > D`) correctly for guests extended from `D+1` → `D+2`.
