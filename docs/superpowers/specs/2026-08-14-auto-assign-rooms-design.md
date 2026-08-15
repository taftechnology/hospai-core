# Auto-assign rooms at check-in

**Tree verified 2026-08-14:** `COMMAND_CATALOG` length **79** (`register.test.ts` ~664), `AUDIT_WRITER_COMMAND_IDS.size === 54` (`register.test.ts` ~663), `V1_HTTP_ROUTE_AUDIT[131].id === 'post_folio_routing_rule_archive'` (`register.test.ts` ~655–661; `v1-http-routes.ts` ~772), `[128] post_folio_stay_discount` (`register.test.ts` ~633–638; `v1-http-routes.ts` ~751–756), `[127] post_demo_seed` (`register.test.ts` ~619–624; `v1-http-routes.ts` ~747), `PROPERTY_SCHEMA_HEAD === 28` / `ORG_SCHEMA_HEAD === 7` (`migrate.test.ts` ~618–619), `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'` (`property-do.ts` ~1063–1072), `PLATFORM_GAPS === []` (`register.test.ts` ~665).

**Date:** 2026-08-14  
**Status:** Approved (reviewer, 2026-08-14)  
**Sources:** ARCHITECTURE.md §7.1 (assign-at-check-in); §4.6 (`QUEUE_PROVISIONAL` check-in); [reservation lifecycle completion](./2026-08-12-reservations-lifecycle-completion-design.md) §4.1–4.4 (`tryCheckIn` resolution, `ROOM_REQUIRED`, replay table); [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) §2.4 (auto-assign deferred until rooms exist); [property setup SPA](./2026-08-13-property-setup-spa-design.md) §8.1 (`pms.ops.auto_assign_rooms` DOMAIN + `consumersExempt`; unread copy); [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) (assignability gates); [virtual room types](./2026-08-14-virtual-room-types-design.md) (`allocated_room_type_id` for physical assign); `packages/contracts/src/config/register.ts` (`pms.ops.auto_assign_rooms` ~279–286); `packages/contracts/src/commands/catalog.ts` (`reservations.check_in` ~86–94, `QUEUE_PROVISIONAL`); `packages/contracts/src/v1-http-routes.ts` (`post_reservation_check_in` ~76–79); `apps/pms-core/src/property-do.ts` (`tryCheckIn` ~8098–8277, `assertRoomAssignableSync` ~6173–6219, `readConfigValueSync` ~1852+, cleanliness ~8211–8230, check-in audit ~8253–8265); `apps/pms-core/src/v1-dispatch.ts` (`handlePostReservationCheckIn` ~2244–2268, fingerprint `{ reservationId, roomId?, overrideCleanliness? }`); `packages/client-core/src/api.ts` (`checkIn` ~605–628, omits `roomId` when undefined); `apps/web-pms/src/screens/CheckInScreen.tsx` (~120, ~151, ~86–93); `apps/web-pms/src/screens/CheckInScreen.test.tsx` (case **53** ~116–142); `apps/web-pms/src/screens/SettingsScreen.tsx` (~604–606); `apps/web-pms/src/screens/SettingsScreen.test.tsx` (~143–148); `apps/pms-core/test/reservations-check-in.spec.ts` (cases **23–30**); `apps/pms-core/test/degraded-mode.spec.ts` (replay **32** ~1090–1116); `apps/pms-core/test/domain-config-routes.spec.ts` (`tryPutDomainConfig` for `auto_assign_rooms` ~255–265).

**Closes:** [reservation lifecycle completion](./2026-08-12-reservations-lifecycle-completion-design.md) leftover **3** — `pms.ops.auto_assign_rooms` has no consumer. Also discharges [property setup SPA](./2026-08-13-property-setup-spa-design.md) “display/edit only / no consumer” for `auto_assign_rooms`, and [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) §2.4 “auto-assign deferred until rooms exist.”

**Amends:** [reservation lifecycle completion](./2026-08-12-reservations-lifecycle-completion-design.md) §4.1 resolution order (add config-gated auto-pick step **3** before `ROOM_REQUIRED`); §4.4 replay row “No resolved room” (still `ROOM_REQUIRED` when config off or zero eligible candidates); CheckInScreen copy note (~297). [property setup SPA](./2026-08-13-property-setup-spa-design.md) §8 unread copy + leftover **16** (consumer lands here). [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md) §2.4 deferred sentence (closed). [room operations & HK completion](./2026-08-12-room-operations-hk-completion-design.md) leftover **11** (closed). Bidirectional one-sentence pointers in those specs are the **final implementation task**, not this spec writer’s job.

---

## 1. Context & Motivation

Property-setup SPA reclassified `pms.ops.auto_assign_rooms` to **DOMAIN + `consumersExempt: true`** with default **`true`**, editable on Settings, but explicitly deferred the consumer. Reservation lifecycle §4.1 locked check-in resolution to `input.roomId` → `reservation.room_id` → **`ROOM_REQUIRED`**, naming auto-assign as leftover **3**. Rooms-housekeeping §2.4 deferred auto-assign until physical `room` rows exist in the field — that precondition is now met on properties using inventory SPA.

This chunk wires the **only** consumer: deterministic lowest-`code` pick inside **`tryCheckIn`** when config is on and no room is resolved. No new catalog command, HTTP route, or schema migration. Check-in stays **`QUEUE_PROVISIONAL`** and entitlement-ungated; replay picks at apply time.

### 1.1 What already exists (verified — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Check-in DO path | `tryCheckIn` — `property-do.ts` ~8098–8277: `resolvedRoomId = input.roomId ?? reservation.room_id`; missing → `RoomRequiredError` / `ROOM_REQUIRED` ~8158–8159; assign-at-check-in branch ~8161–8188; cleanliness ~8211–8230; audit ~8253–8265 |
| Assignability gate | `assertRoomAssignableSync` ~6173–6219: type vs `allocatedRoomTypeId`, overlap → `ROOM_ALREADY_ASSIGNED`, OOO status + `room_ooo` range |
| Config key | `pms.ops.auto_assign_rooms` — `register.ts` ~279–286: `DOMAIN`, `bool`, **`default: true`**, **`consumersExempt: true`**; siblings `auto_assign_rule` / `auto_assign_rooming` OPERATIONAL ~287–288 |
| Config read in DO | `readConfigValueSync` ~1852+ (already used in `tryCheckIn` for cleanliness ~8211) |
| Command | `reservations.check_in` — `catalog.ts` ~86–94: `QUEUE_PROVISIONAL`, events `reservation.status_changed` + `reservation.room_assigned`, fingerprint `{ reservationId, roomId?, overrideCleanliness? }` |
| HTTP | `post_reservation_check_in` — `v1-http-routes.ts` ~76–79; handler ~2244–2268; fingerprint excludes unknown picked id (correct — pick happens inside DO) |
| Client | `api.checkIn` ~605–628: omits `roomId` from JSON when `extra.roomId === undefined` |
| SPA check-in | `CheckInScreen.tsx`: `canCheckIn` requires `roomId` ~120; always sends `{ roomId, … }` ~92; copy “A room is required” ~151 |
| SPA settings | `SettingsScreen.tsx` ~604–606: hint “Stored for later. Check-in still requires an explicit room.” |
| Check-in tests | `reservations-check-in.spec.ts` **23–30**; `degraded-mode.spec.ts` replay **32** |
| Catalog / audit / gaps | `COMMAND_CATALOG` **79** (~664); `AUDIT_WRITER_COMMAND_IDS.size` **54** (~663); `PLATFORM_GAPS` `[]` (~665) |
| Schema heads | `PROPERTY_SCHEMA_HEAD` **28** (~618); `ORG_SCHEMA_HEAD` **7** (~619) |
| HTTP head | `[131] post_folio_routing_rule_archive` (~655–661) — **unchanged**; `[128]` / `[127]` unmoved |
| Night audit | `NIGHT_AUDIT_STEPS` length **8**; index **3** `AUTO_TRANSFER` (~1063–1072) |

**Heads (frozen — this chunk does not move them):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[131] = post_folio_routing_rule_archive` | **unchanged** — `[128]`/`[127]`/`[102]` unmoved |
| `COMMAND_CATALOG` | length **79** | **79** (same command) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **54** | **54** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **28** | **28** (no migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** |
| `NIGHT_AUDIT_STEPS` | length **8** | unchanged |

### 1.2 Scope in

1. **`tryCheckIn` resolution order** — insert config-gated auto-pick between pre-assign and `ROOM_REQUIRED` (Lock 1).
2. **Deterministic pick helper** — lowest `room.code` of booked physical type, same assignability/cleanliness/inspection gates as explicit check-in (Lock 2).
3. **Audit / outbox** — `reservation.room_assigned` when pick writes `room_id`; check-in audit `afterJson.autoAssigned: true` when pick occurred (Lock 2).
4. **SPA** — optional room on `CheckInScreen`; Settings hint update (Lock 4).
5. **Tests** §9; register pin verification (heads unchanged).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- `pms.ops.auto_assign_rule` / `pms.ops.auto_assign_rooming` consumers
- Auto-assign at booking, confirm, modify, night audit, or standalone `reservations.assign_room`
- New catalog command / HTTP route / schema migration
- Changing `ROOM_REQUIRED` into a new wire code
- Requiring a room when config is **`false`** (today’s behaviour — unchanged)
- `rooms.delete`, `pms.night_audit.auto_extend` consumer, derived rates, promo, invoices, city ledger
- Recurring / `breakfast_rule`
- New `export class` / `CLASS_DENYLIST` edit
- Demo seed rewrite
- Promoting check-in to `FAIL_CLOSED`
- `listDomainConfig` / Settings reads on `CheckInScreen`
- Bidirectional pointer sentences in amended specs (final implementation task)

---

## 2. Behaviour (normative locks)

Implementation that violates these is out of spec.

### Lock 1 — Check-in only, same command

Wire the consumer **inside `tryCheckIn`** (`property-do.ts` ~8158 region). Replace the block that sets `resolvedRoomId = input.roomId ?? reservation.room_id` then immediately throws `RoomRequiredError`.

**Resolution order** (first match wins):

1. `input.roomId` if present — explicit always wins.
2. Else `reservation.room_id` if set — pre-assign wins.
3. Else if `readConfigValueSync('pms.ops.auto_assign_rooms') === true` → run pick (Lock 2); if pick returns an id, use it as `resolvedRoomId`.
4. Else `ROOM_REQUIRED` (`RoomRequiredError` → existing wire code).

**Do not** add `reservations.auto_assign` or `rooms.auto_assign` catalog ids. **Do not** add HTTP routes. Command stays **`reservations.check_in`** (`QUEUE_PROVISIONAL`, entitlement-ungated per lifecycle §4.3). HTTP fingerprint stays **`{ reservationId, roomId?, overrideCleanliness? }`** — do **not** put the picked id in the HTTP fingerprint (unknown at enqueue).

**Do not** auto-assign on create / confirm / modify / night audit / standalone `tryAssignRoom`.

After `resolvedRoomId` is known, the remainder of `tryCheckIn` is **unchanged**: assign-at-check-in branch when `resolvedRoomId !== reservation.room_id` (~8161–8188), occupancy (~8190), room load + OOO + cleanliness + inspection (~8192–8230), status flip (~8232+).

### Lock 2 — Deterministic pick; same gates as explicit check-in

Add a private sync helper, e.g. `pickAutoAssignRoomSync(reservation, input)`, called only from the Lock 1 step **3** branch inside the existing `runIdempotent` transaction.

**Candidate query**

- `room` rows where `room_type_id = (reservation.allocated_room_type_id || reservation.room_type_id)`.
- **`ORDER BY code ASC`** (string sort on `room.code`).
- Virtual-types lock: match **allocated physical** type, not sold virtual SKU ([virtual room types](./2026-08-14-virtual-room-types-design.md)).

**Per-candidate filter** (skip — do not throw — unless the helper’s outer contract is “return null”):

| Check | Same as explicit path | On failure during pick |
|---|---|---|
| Room exists | `assertRoomAssignableSync` preconditions | skip |
| `room.status === 'out_of_order'` | ~6187, ~8197 | skip |
| Stay ∩ `room_ooo` | ~6205–6217, ~8198–8210 | skip |
| Type mismatch vs `allocatedRoomTypeId` | ~6188 | skip |
| Overlap / `ROOM_ALREADY_ASSIGNED` | ~6189–6204 | skip |
| `dirty` + `pms.reservations.check_in_cleanliness === 'strict'` + no `input.overrideCleanliness` | ~8214–8219 | skip |
| `pms.housekeeping.require_inspection === true` + strict + `room.status === 'clean'` + no override | ~8221–8229 | skip |

Implement skip by calling the same predicates (prefer reusing `assertRoomAssignableSync` in try/catch for assignability throws, then inline the cleanliness/inspection conditions already in `tryCheckIn` ~8211–8229) — **do not** invent a second overlap/OOO algorithm.

**First remaining candidate wins.** **None eligible → pick returns `null` → Lock 1 step 4 `ROOM_REQUIRED`.** No new wire code.

**After pick assigns:** when pick’s id differs from `reservation.room_id`, run the **same** assign-at-check-in body as explicit `input.roomId` (~8161–8188): `assertRoomAssignableSync`, `UPDATE reservation SET room_id`, emit **`reservation.room_assigned`**. Set flag `autoAssigned = true` for audit (below).

**Check-in audit** (`appendAuditLogSync` ~8253–8265): when pick wrote `room_id` in this txn, add **`afterJson.autoAssigned: true`**. Do **not** invent a new audit `commandId`. Pre-assigned / explicit-room paths omit the flag.

### Lock 3 — Config register (no change)

Keep `pms.ops.auto_assign_rooms` as **DOMAIN + `consumersExempt: true`** (`register.ts` ~279–286). Pick does not touch ARI / night-audit / rate rematerialization. **Do not** consume `pms.ops.auto_assign_rule` or `pms.ops.auto_assign_rooming` (stay OPERATIONAL, off Settings).

Default remains **`true`**. Config **`false`** via `tryPutDomainConfig` → step 3 skipped → step 4 `ROOM_REQUIRED` when no explicit/pre-assigned room.

### Lock 4 — SPA

**`CheckInScreen`**

| UI | Behaviour |
|---|---|
| Room `<select>` | Stays; **optional** (blank `""` allowed) |
| `canCheckIn` | **`!checkIn.isPending` only** — must **not** require `roomId` |
| Check-in mutation | When blank, call `api.checkIn(…, opId, { … })` **without** `roomId` key (omit; do **not** send `""`) |
| Copy | Replace “A room is required to check in.” with visible helper: **“Leave blank to auto-assign a vacant room of the booked type.”** |
| `ROOM_REQUIRED` | Surfaces via existing classified error path / `classifiedUserMessage` — no new SPA branch required |

**Assign room** button behaviour unchanged (still requires selected `roomId`).

**`SettingsScreen` → Property / Charges**

Replace unread hint **“Stored for later. Check-in still requires an explicit room.”** with **“When on, check-in without a room picks the lowest room code of the booked type that is vacant and ready.”**

Update **`SettingsScreen.test.tsx`** `shows auto_assign_rooms unread copy` (~143–148) to assert the new string.

**Existing** `CheckInScreen.test.tsx` case **53** that selects explicit `roomId` and sends `{ roomId: 'rm_1' }` stays green. Add RTL case: blank room → check-in enabled → `checkIn` called without `roomId` in payload.

**Do not** add `listDomainConfig` / `settings:configure` reads on `CheckInScreen` — desk behaviour follows server config only.

### Lock 5 — Replay

Keep **`QUEUE_PROVISIONAL`**. A queued check-in with **no** `roomId` and no pre-assign picks at **replay** time (Lock 1 step 3 inside `tryCheckIn`). Contention / no candidate → **`provisional_exception` `ROOM_REQUIRED`** (existing story; `degraded-mode.spec.ts` **32** pattern). **Do not** promote check-in to `FAIL_CLOSED`.

Replay uses the **same** `tryCheckIn` body — no second pick implementation. Config value at replay time governs pick (stored DOMAIN config in PropertyDO).

---

## 3. Commands / HTTP (unchanged)

| | |
|---|---|
| Command | `reservations.check_in` — `catalog.ts` ~86–94 |
| Degraded | `QUEUE_PROVISIONAL` |
| Permission | `reservations:write` |
| HTTP | `POST …/reservations/:rid/check-in` — `post_reservation_check_in` ~76–79 |
| Fingerprint | `{ reservationId, roomId?, overrideCleanliness? }` — picked id **not** in fingerprint |
| Client | `api.checkIn` ~605–628 — already omits undefined `roomId` |

No catalog length change. No `AUDIT_WRITER_COMMAND_IDS` change. `check_in` stays **off** the writer set (lifecycle §4.6).

---

## 4. Schema

**None.** `PROPERTY_SCHEMA_HEAD` stays **28**. No migration, no demo seed rewrite.

---

## 5. Errors (existing only)

No new wire codes.

| Code | When (including auto-assign) |
|---|---|
| `ROOM_REQUIRED` | Config off; or config on but zero eligible candidates; or property has no `room` rows of booked type |
| `ROOM_NOT_READY` | Explicit/pre-assigned/picked room fails cleanliness/inspection at final gate (~8214–8229) — should not occur for pick-skipped dirty rooms; if override applies to picked room, same as today |
| `ROOM_OUT_OF_ORDER` | Final gate on resolved room |
| `ROOM_ALREADY_ASSIGNED` | Explicit assign-at-check-in overlap (pick skips occupied) |
| `ROOM_TYPE_MISMATCH` | Explicit path only if desk forces wrong type; pick never selects mismatch |
| `INVALID_STATUS_TRANSITION` | Unchanged |
| `NOT_FOUND` | Unchanged |

Config **`false`** + omitted `roomId` + no pre-assign → **`ROOM_REQUIRED`** (regression for case **23** with config forced off).

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `apps/pms-core/src/property-do.ts` | Lock 1 resolution + `pickAutoAssignRoomSync`; audit `autoAssigned`; reuse assign-at-check-in block |
| `apps/web-pms/src/screens/CheckInScreen.tsx` | Optional room, copy, `canCheckIn`, omit `roomId` when blank |
| `apps/web-pms/src/screens/CheckInScreen.test.tsx` | Optional-room RTL; keep case **53** explicit path |
| `apps/web-pms/src/screens/SettingsScreen.tsx` | Hint copy |
| `apps/web-pms/src/screens/SettingsScreen.test.tsx` | Updated hint assertion |
| `apps/pms-core/test/reservations-check-in.spec.ts` (extend) or `reservations-auto-assign.spec.ts` (new) | DO cases §9.1 |
| `apps/pms-core/test/degraded-mode.spec.ts` | Optional: replay pick / no-candidate exception (only if natural) |
| `packages/contracts/src/register.test.ts` | Verify pins: catalog **79**, writers **54**, `[131]` last, `[128]`/`[127]` unmoved, `NIGHT_AUDIT_STEPS.length === 8` |

**Not touched:** `packages/contracts/src/commands/catalog.ts`, `v1-http-routes.ts`, `v1-dispatch.ts` (handler already optional `roomId`), `packages/client-core/src/api.ts`, `config/register.ts`, migrations, `NIGHT_AUDIT_STEPS`, demo seed, `ORG_SCHEMA_HEAD`, `PLATFORM_GAPS`, `CLASS_DENYLIST`.

---

## 7. Tests (minimum — fixture dates via `crypto.randomUUID()`)

Use **`provisionedPropertyStub`** / patterns from `reservations-check-in.spec.ts` (`provisionedPropertyWithGuest`, `addRoomType`, `createRoom`, `bookConfirmed`, `tryPutDomainConfig`, `idemFor`). **Do not** `vi.spyOn` into the DO isolate. **Do not** invent `provisionedPropertyWorker`.

**CI (encode for implementer):**

- Rebuild `@hospai/contracts` before pms-core tests if contracts change (this chunk likely does not).
- Rebuild `@hospai/client-core` before web-pms tests if client changes (likely does not).
- File-filter vitest; unsharded `pnpm --filter @hospai/pms-core test` may segfault. Shards: `--shard=N/8` with **no** `--` before `--shard`. Workerd 503: retry that shard once. Do not `|| true`.
- `pnpm check:web-pms-colors` if SPA files touched.
- Living plan checkboxes only on the last plan task (for the later plan writer).

### DO — auto-assign (`reservations-check-in.spec.ts` extend or sibling)

| # | Case | Assert |
|---|---|---|
| 1 | Config default **true**; two vacant **clean** rooms same type (`code` **201** and **101**); check-in no `roomId`, no pre-assign | `checked_in`; `room_id` = lower **`code`** room (**101** if codes sort that way) |
| 2 | Explicit `input.roomId` = higher-code room; lower-code vacant exists | Explicit wins |
| 3 | Pre-assigned `reservation.room_id`; input omits `roomId` | Pre-assign wins; no second `room_assigned` if unchanged |
| 4 | `tryPutDomainConfig('pms.ops.auto_assign_rooms', false)`; omitted `roomId` | `ROOM_REQUIRED`; status stays `confirmed` |
| 5 | Only **dirty** rooms + strict cleanliness, no override | `ROOM_REQUIRED` (pick skips all dirty) |
| 6 | One room **occupied** (overlap) + one eligible | Occupied skipped; eligible picked |
| 7 | Virtual-type reservation: sold virtual SKU, `allocated_room_type_id` physical; rooms on constituent types | Pick room of **`allocated_room_type_id`** only; never wrong-type (`ROOM_TYPE_MISMATCH` path stays for explicit wrong picks) |
| 8 | Regressions | Existing **24–30** explicit-room / cleanliness / overlap / cancel_check_in green; case **23** updated: default config **true** but **zero** `room` rows → still `ROOM_REQUIRED` |

Optional audit assert on case **1**: check-in audit row `afterJson.autoAssigned === true`; `reservation.room_assigned` outbox present.

### SPA RTL

| # | Case | Assert |
|---|---|---|
| 9 | Blank room select | Check-in button enabled; `checkIn` called without `roomId` in args |
| 10 | Settings property tab | New hint copy visible (`SettingsScreen.test.tsx`) |

### HTTP

Only if an existing check-in HTTP test file is the natural home — **`worker.fetch` + `x-dev-actor` + `provisionHotel`**. Do **not** invent `provisionedPropertyWorker`. Smoke optional: POST check-in without `roomId` body field when config on + seeded rooms → 200.

### Register pin

`register.test.ts`: catalog **79**, writers **54**, `[131]` last, `[128]`/`[127]` unmoved; `NIGHT_AUDIT_STEPS.length === 8`.

---

## 8. Leftovers this chunk names

| # | Item | Notes |
|---|---|---|
| 1 | **`pms.ops.auto_assign_rule` / `pms.ops.auto_assign_rooming`** | OPERATIONAL; no consumer; off Settings |
| 2 | **Auto-assign outside check-in** | Booking / confirm / modify / night audit / `assign_room` — §1.3 |
| 3 | **Smarter pick heuristics** | Floor preference, VIP, adjoining — only lowest `code` |
| 4 | **Waiting-for-room / queue product** | Lifecycle §16.5 — different surface |
| 5 | ~~**`auto_extend` consumer** — Night-audit leftover — unrelated~~ **Closed** in [2026-08-15 night-audit auto-extend](./2026-08-15-night-audit-auto-extend-design.md). |

---

## 9. Implementation checklist

- [x] `tryCheckIn`: resolution order Lock 1 (steps 1–4); call `pickAutoAssignRoomSync` at step 3.
- [x] `pickAutoAssignRoomSync`: candidate query `ORDER BY code ASC`; skip ineligible; first win; null → `ROOM_REQUIRED`.
- [x] Reuse assign-at-check-in txn block for pick-forced assign; `reservation.room_assigned` when pick writes `room_id`.
- [x] Check-in audit `afterJson.autoAssigned: true` when pick assigned in this txn.
- [x] `CheckInScreen`: optional room, copy, `canCheckIn`, omit `roomId`; RTL case **9**.
- [x] `SettingsScreen` hint + `SettingsScreen.test.tsx` case **10**.
- [x] DO tests §7.1 cases **1–8**; register pins unchanged.
- [x] `pnpm check:web-pms-colors` if SPA tokens touched.
- [x] Bidirectional pointers: lifecycle §4.1 + leftover **3**; property-setup §8 + leftover **16**; rooms-housekeeping §2.4; room-operations leftover **11** (final implementation task).

---

## 10. Tree conflicts with reviewer locks

**None.** Verified: heads match §1.1; `tryCheckIn` today throws at ~8158–8159 without config read; `pms.ops.auto_assign_rooms` already DOMAIN + default `true` (~279–286); HTTP/client already treat `roomId` as optional; `[131]`/`[128]`/`[127]` pins match `register.test.ts` ~619–661; `NIGHT_AUDIT_STEPS[3] === 'AUTO_TRANSFER'` (~1067).

**Note for implementer:** Case **23** in `reservations-check-in.spec.ts` currently expects `ROOM_REQUIRED` with default config and **no physical rooms** — behaviour stays **`ROOM_REQUIRED`** (zero candidates). Split case **4** (config **false**) from case **23** (config true, no rooms) so both stay explicit.
