# Demo tenant seed (one-command hotel)

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** [DEMO-READY.md](../../../DEMO-READY.md) P0-1; [README.md](../../../README.md) “Run locally”; ARCHITECTURE.md §4.3 / §7.1 / §7.8 / §14; [tenancy spine](./2026-07-27-tenancy-spine-design.md); [PMS inventory](./2026-07-27-pms-inventory-design.md); [rate plans vertical](./2026-08-05-rate-plans-vertical-design.md); [rooms & housekeeping](./2026-08-05-rooms-housekeeping-vertical-design.md); [reservations book](./2026-07-27-reservations-book-design.md); [booking wizard](./2026-08-11-booking-wizard-design.md); [guests / PII](./2026-08-06-guests-pii-vertical-design.md); [guest CRM directory](./2026-08-13-guest-crm-directory-design.md); [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md); [property setup SPA](./2026-08-13-property-setup-spa-design.md); `v1-http-routes.ts` (next free **127**); `apps/pms-core/src/provision.ts` / `v1-dispatch.ts` / `property-do.ts` (`commitSoldNightsSync`, `tryCreateReservation`, `tryCheckIn`); `packages/do-runtime` (`DEFAULT_RATE_PLAN_ID = 'BAR'`, `PROPERTY_SCHEMA_HEAD === 25`, `ORG_SCHEMA_HEAD === 7`); `apps/web-pms/.env.example`; `apps/web-pms/src/screens/TapeChartScreen.tsx` (`GuestNameLink`); web-interface guidelines

**Closes:** DEMO-READY P0-1 (one-command named demo hotel). README “Run locally” step 3 becomes this command. The empty-board default after the three-curl bootstrap is no longer the meeting path.

**Amends:** [README.md](../../../README.md) “Run locally” §3 (implementation PR). DEMO-READY P0-1 checkboxes (same PR). Bidirectional pointer: one sentence in DEMO-READY when this chunk lands. Do **not** rewrite ARCHITECTURE §14 / §16 as “demo seed shipped” beyond an optional Phase 1 note.

---

## 1. Context & Motivation

The 8-minute investor path already runs on live APIs. The meeting still opens on an empty tape because local bootstrap is three curls that create `org_demo` / `prop_demo` / one `rt_king` type and **zero** physical rooms, rates, guests, or stays. Book looks unpriced. Stay blocks cannot show a guest name because there are no guests.

This chunk is staging only. It does not change how a hotel is provisioned, how a reservation is booked, or how the tape paints a name. It makes the existing product look occupied.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| README three-curl bootstrap | `README.md` §3: `POST /v1/orgs` `{ orgId: org_demo, name: Demo Org }` → `POST /v1/orgs/org_demo/properties` `{ propertyId: prop_demo, name: Demo Hotel, timeZone: UTC, currency: USD }` → `POST …/room-types` `{ roomTypeId: rt_king, code: KNG, name: King, roomCount: 10 }`. Empty board is the default. |
| SPA tenant ids | `apps/web-pms/.env.example`: `VITE_ORG_ID=org_demo`, `VITE_PROPERTY_ID=prop_demo`, `VITE_USE_DEV_ACTOR=1`, `VITE_DEV_ACTOR=user_owner`. Tape / boards read this property. |
| Org create | `[0] post_orgs` `POST /v1/orgs` (`scope: 'bootstrap'`). Insert-only. **409** `{ error: 'org_exists' }`. On 201, `ensureMember(actor, 'owner')`. On 409, member is **not** re-ensured. |
| Property provision | `[2] post_org_properties` `POST /v1/orgs/:orgId/properties` (`property:provision`, `pms.core`). `provisionProperty`: existing property → **201** with the existing row (does **not** rename; timezone / currency are first-write no-ops). Missing org is upserted. Actor is synced onto OrgDO / PropertyDO. |
| Property name | `[43] patch_property_details` `PATCH /v1/properties/:pid` (`property.update_details`, `config:write`). **Name only.** Body `{ name, idempotencyKey }`. |
| Property read | `GET /v1/properties/:pid` → `{ property: { propertyId, timeZone, name } }`. Tape header today is “Board” + dates — it does **not** print `propertyId`. P0-3 will put **name** on the rail. |
| Room types | `POST /room-types` (`inventory.add_room_type`); `PUT /room-types/:id` (`inventory.update_room_type`); `GET /room-types` `[111]`. `roomCount` is sellable physical on `availability_day`, **not** a physical `room` row. Create seeds availability from **open business date** forward (`HORIZON_DAYS`). |
| Physical rooms | `POST /rooms` (`rooms.create`) `{ roomId, roomTypeId, code, floor?, idempotencyKey }`. Default `room.status = 'clean'`. Unique `code`. **No `rooms.delete`.** |
| BAR | PropertyDO v12 seeds `rate_plan` `BAR` / “Best Available Rate”. `DEFAULT_RATE_PLAN_ID === 'BAR'`. Create reservation defaults `ratePlanId` to BAR. **No rate_day rows** until someone PUTs them. |
| Rate days | `PUT /rate-days` (`rates.upsert_day`); `POST /rates/bulk` (`rates.bulk_update`, BULK, integer `amountMinor` + ISO `currency`). `GET /rate-days` `[112]`. |
| Guests | `POST /guests` (`guests.create`) `{ guestId, displayName, email?, phone?, idempotencyKey }`. `GuestProfile.displayName` is one string (first + last go here). **409** `GUEST_EXISTS`. PII in OrgDO. PropertyDO stores `guest_ref` only. |
| Reservations | `POST /reservations` (`reservations.create`) `{ reservationId, roomTypeId, guestRef, arrivalDate, departureDate, quoteAriVersion, status?, idempotencyKey }`. Default status `confirmed`. `commitSoldNightsSync`: missing `availability_day` row → `UNBOOKABLE`. Horizon starts at `__meta.business_date` (first-write = property-local clock date at provision). **Nights before business date cannot be booked over public HTTP.** |
| Assign / check-in | `POST …/assign-room`; `POST …/check-in` (`reservations.check_in`). Check-in requires `status === 'confirmed'` and a room; already-`checked_in` → `INVALID_STATUS_TRANSITION` (not a success). New rooms are `clean` → strict cleanliness passes. Check-in does **not** require `arrival_date === today`. |
| Front-desk predicates (tape spec §7.1) | Arrivals: `arrival_date = date AND status IN ('confirmed','pending')`. In-house: `status = 'checked_in'`. Due out: `departure_date = date AND status = 'checked_in'`. Occupying tape blocks: `pending\|confirmed\|checked_in`, half-open `[arrival, departure)`. |
| Tape labels | `StayBlock` renders `GuestNameLink` → `guestLabel` → `displayName` when `POST …/guests/batch` resolves. Fallback is `guestRef (name pending)`, **not** `reservationId`. Folio is a separate link. Seeding named guests is sufficient; **no tape UI change**. |
| SPA “today” | `propertyLocalToday(timeZone)` from the property TZ + wall clock. **Not** `__meta.business_date`. Night audit rolls the business date; it does **not** move the tape’s today. |
| Dev HTTP | `[1] post_migration_sweep` `POST /v1/admin/migration-sweep`, `scope: 'dev'`. `handleV1` / `dispatchV1`: dev scope **404** unless `isDevActorAllowed` (`HOSPAI_UNSAFE_LOCAL=1` **and** `HOSPAI_ALLOW_DEV_ACTOR=1`). Pattern for a local-only seed actuator. |
| Unsafe-local DO guard | `PropertyDO.assertUnsafeLocal` / OrgDO equivalent — test helpers that must never run in prod. |
| Root scripts | `package.json` has `check:*` / `generate:ddl` → `node scripts/*.mjs`. **No `demo:seed`.** No `*seed*` files in the tree. |
| Catalog / routes / schema | `COMMAND_CATALOG` length **77**. `V1_HTTP_ROUTE_AUDIT` indices **0–126**, last `[126] = get_guest_stays`. Next free **127**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS = []`. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS` length **7**. |
| Local persist | `apps/pms-core/wrangler.jsonc`: D1 `PLATFORM_DB` + DO classes, no custom `persistDir`. Wrangler default: `apps/pms-core/.wrangler/state`. |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[126] = get_guest_stays` | next **127**; one row `post_demo_seed` (`scope: 'dev'`) |
| `COMMAND_CATALOG` | length **77** | **77** (no new commands) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **25** | **25** (no PropertyDO migration) |
| `ORG_SCHEMA_HEAD` | **7** | **7** (no OrgDO migration) |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | unchanged | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Root command `pnpm demo:seed` that provisions the **named** demo tenant against a running local Worker (§3, §6).
2. Human property **name** a GM would recognize; stable wire ids stay `org_demo` / `prop_demo` so `.env.example` does not change (§4).
3. Three room types with GM names + ~20 physical rooms with human codes (§5.1–§5.2).
4. BAR `rate_day` cells across the visible Book / tape window (§5.3).
5. Today’s board: **8** in-house, **4** arrivals, **3** departures, mix of assigned rooms and **one unassigned arrival**; named guests (first + last) (§5.4–§5.6).
6. Idempotent re-run of the same command; documented wipe + re-seed when the hotel is dirty (§7).
7. README “Run locally” points at `pnpm demo:seed`; three-curl remains a developer empty-hotel path (§8).
8. One local-only Worker route that backfills pre-business-date `availability_day` rows and applies the hotel fixture through existing PropertyDO / OrgDO writers (§3, §6). **No new tables.**

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **P0-2 folio first-paint / Advanced.** Do not restyle FolioScreen. Do not auto-open a cashier shift (P0-2 names that leftover). Seed may leave empty folios; walk-in + post-minibar is the 8-minute script (P0-5).
- **P0-3 chrome + skin.** No sidebar, tokens, icons, “Room Plan” title, or property-name rail. Seed data will surface on the current chrome.
- **P0-4 sign-in / Clerk.** Script authenticates as `X-Dev-Actor: user_owner`. Do not remove `VITE_USE_DEV_ACTOR`. Do not build `/sign-in`.
- **P0-5 script + dry runs.** No speaker notes, kill list, or timed rehearsal in this chunk.
- **Any UI change** beyond what seeded rows already paint (tape names via existing `GuestNameLink` + batch). No `data-testid` churn.
- **Production deployment.** This is local-dev seed. The Worker route **404s** without `isDevActorAllowed`.
- **Changing `POST /v1/orgs` / `POST /v1/orgs/:id/properties` request or response shapes.** Those routes stay the provision interface. The script calls them as they exist today.
- **New PropertyDO / OrgDO tables** (or ALTERs) for seed bookkeeping. Seed uses `room_type`, `room`, `rate_plan`, `rate_day`, `availability_day`, `guest`, `reservation` as they are.
- **New catalog commands.** Dev HTTP is not a domain command.
- **Virtual room types, derived / OrgDO rate plans, `rooms.delete`.**
- **`ui-kit` / Tailwind / prototype palette.**
- **City ledger / invoices / auto-transfer / recurring charges / partial refunds.**
- **PCI / real PSP.** Simulate stays.
- **Second property / isolation demo** (P0-5 optional moat).
- **Night-audit run as a seed step.** SPA today is wall-clock, not `__meta.business_date`. Rolling audit does not create calendar-today departures.
- **Org purge / property wipe HTTP.** Recovery is filesystem persist delete (§7.2).
- **Rewriting tape / board / Book screens** to hide `roomTypeId` / `reservationId` leftovers that P0-3 already owns.
- **Client-side IndexedDB** or a seed fixture committed as JSON the SPA reads.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers.** Rate cells are `amountMinor` + `currency: 'USD'`. No float on the wire. This chunk does not post folio lines.
2. **The folio is append-only.** Seed does not `UPDATE` `folio_line`. Creating a reservation may `ensureGuestFolioWindowSync` (existing writer). Do not add seed charges.
3. **Domain code has zero platform imports.** Fixture constants may live next to the Worker handler; they are not a `domain/` package.
4. **Events + audit ride the existing writers.** `guests.create`, `inventory.add_room_type`, `rooms.create`, `rates.upsert_day` / `bulk_update`, `reservations.create`, `reservations.assign_room`, `reservations.check_in` already emit. The seed orchestrator does not invent a `demo.seeded` event and does not skip `runIdempotent` on those writers.
5. **Degraded mode never creates an obligation.** If PropertyDO or OrgDO is unreachable, the route / script fails closed (503 / non-zero exit). Nothing is queued. Seed is not `QUEUE_PROVISIONAL`.
6. **`runIdempotent` stays sync-only.** Guest vault seal stays outside `transactionSync` (existing hybrid). The new route may `await` OrgDO then PropertyDO **in the Worker handler**, not inside a PropertyDO txn that calls OrgDO.
7. **Schema freeze.** No PropertyDO / OrgDO migration. `pnpm generate:ddl` is a no-op diff. Past-night `availability_day` rows are `INSERT OR IGNORE` into the **existing** freeze-gate table.
8. **No new purge table.** `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. Seed rows are ordinary inventory / stay / guest rows and already in the census.
9. **No new `export class`.** Handler + fixture + `ensurePastAvailabilityDays` are functions. Do not add to `CLASS_DENYLIST`.
10. **`NIGHT_AUDIT_STEPS` stays seven.** Seed does not run night audit.
11. **Route audit append-only.** New route is index **127**. `[126] = get_guest_stays` does not move. `[0]` / `[2]` provision rows do not change shape.
12. **No new catalog commands.** `COMMAND_CATALOG` length stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
13. **Guest names never live in PropertyDO.** Seed writes `displayName` through `guests.create` (OrgDO). Reservations carry `guestRef`. Tape compose stays `POST …/guests/batch`.
14. **PropertyDO does not call OrgDO.** The dispatcher (or a Worker-level orchestrator function) creates guests via OrgDO RPC, then stays via PropertyDO RPC.
15. **Provision API surface is unchanged.** `POST /v1/orgs` and `POST /v1/orgs/:id/properties` bodies, status codes, and 409/201 behaviour stay. Seed does not add `seed: true` to those bodies.
16. **Local-only actuator.** `POST /v1/admin/demo-seed` is `scope: 'dev'`. Without `isDevActorAllowed` → **404** `{ error: 'not_found' }` (same as migration-sweep). Production must not expose it.
17. **Occupying predicate is unchanged.** Seeded in-house / arrivals / departures must satisfy the shipped front-desk SQL, not a seed-only flag.
18. **Past nights are a Worker backfill, not a clock lie.** Do not change first-write `__meta.business_date`. Do not teach the SPA a `VITE_DEMO_DATE`. Do not run night audit to “make yesterday exist.”
19. **Fixture-date discipline** for tests (`check:pms-core-test-dates`). Shared-storage tests provision a **random** org/property and pass those ids into the seed route. Do not hard-bind tests to a single shared `org_demo` row.
20. **Visual identity is not this chunk.** No tokens, no chrome. Interaction already exists; data is the specification.

---

## 3. Shape of the command (normative)

### 3.1 Decision — combination (locked)

| Layer | What | Why |
|---|---|---|
| Operator command | `pnpm demo:seed` | One line in the room. Matches DEMO-READY’s example. |
| Script | `scripts/demo-seed.mjs` (Node ESM, same family as `scripts/web-pms-colors-check.mjs`) | Root `package.json` already runs `node scripts/*.mjs`. No extra runtime. |
| Worker route | `POST /v1/admin/demo-seed` (`scope: 'dev'`) | Public HTTP cannot book nights before `business_date` (`commitSoldNightsSync` → `UNBOOKABLE`). Departures **today** require `arrival < today`. That backfill is local-only SQL on the existing `availability_day` table. |
| Not a shell script | — | Need structured HTTP, JSON, retries, and a non-zero exit. `curl` sequences are what we are replacing. |
| Not script-only | — | A Node script talking only to shipped writers cannot create calendar-today due-outs. |
| Not a new provision body | — | Org / property stay on `[0]` / `[2]`. |

Rejected alternatives:

- **Night-audit roll to manufacture “yesterday.”** SPA `today` is wall-clock. Audit advances `__meta.business_date` only. Due-out on the board would still be wrong. Also pulls P0-5 / folio posting into P0-1.
- **`VITE_DEMO_DATE` / tape query override as the meeting path.** Lab flag. P0-4 forbids lab flags in the room; P0-3 owns chrome.
- **New PropertyDO seed table / `seed_generation` column.** Forbidden (§1.3).
- **Catalog `demo.seed`.** Not a hotel command; must not appear in `COMMAND_CATALOG` or `AUDIT_WRITER_COMMAND_IDS`.
- **Property-scoped `POST /v1/properties/:pid/demo-seed` with a permission.** Would be a visible production route (403 vs 404). Dev scope already 404s when flags are off.

### 3.2 Operator sequence (one command)

`pnpm demo:seed` does all of the following. The operator does **not** curl.

1. Fail fast if `http://127.0.0.1:8787` is not accepting connections. Copy: “Start the Worker first: `pnpm --filter @hospai/pms-core dev`.” Exit 1.
2. `POST /v1/orgs` with the named org (§4). Treat **201** and **409 `org_exists`** as success.
3. `POST /v1/orgs/org_demo/properties` with the named property (§4). Treat **201** (create **or** already-present — verified: existing returns 201) as success. **409** `jurisdiction_conflict` / `tenant_not_active` → exit 1 with the wire error.
4. `GET /v1/properties/prop_demo`. If `property.name !==` the locked name, `PATCH` it (`property.update_details`) with a stable idempotency key `demo-seed:v1:property-name`.
5. `POST /v1/admin/demo-seed` `{ orgId, propertyId }` with `X-Dev-Actor: user_owner` and `content-type: application/json`.
6. Print a short summary from the route body (property name, room count, board counts, wipe hint). Exit 0.

Default base URL `http://127.0.0.1:8787`. Optional `--base-url` for tests. Optional `--actor` (default `user_owner`). Do **not** start the Worker or the Vite SPA from this script (two-process README stays).

Root `package.json`:

```json
"demo:seed": "node scripts/demo-seed.mjs"
```

### 3.3 HTTP route to append (normative)

Append-only. Do not reorder 0–126.

| Index | `id` | Method / path | Scope | Permission | `commandId` | Entitlement | `degradedRead` |
|---|---|---|---|---|---|---|---|
| 127 | `post_demo_seed` | `POST` `/v1/admin/demo-seed` | `dev` | *(omit)* | *(omit)* | *(omit)* | *(omit)* |

Dispatcher pattern (append at **end** of `V1_ROUTES`; method-discriminated):

```
POST  /^\/v1\/admin\/demo-seed$/
```

Same 404 gate as `[1] post_migration_sweep`: `isDevActorAllowed` false or method ≠ POST → `{ error: 'not_found' }`. Actor is still resolved (dev actor or Clerk). The handler must `requirePermission` **`property:provision`** on the target org **after** parsing the body (dev scope skips the generic permission loop — do this inside the handler so a random logged-in user cannot seed an org they do not own). Missing permission → 403 `{ error: 'forbidden', permission: 'property:provision' }`. Unknown property → 404. `orgId` / `propertyId` mismatch vs registry → 400 `{ error: 'org_property_mismatch' }`.

Body:

```ts
{ orgId: string; propertyId: string }
```

Both required; `validateTenantId` on each. Extra keys ignored.

Do **not** add `GET /v1/admin/demo-seed`. Do **not** nest under `/v1/orgs` or `/v1/properties/:id` (would look like a provision API change). Do **not** accept a fixture override body this chunk (one hotel).

`Cache-Control` is irrelevant (POST). No `demo.seeded` outbox event.

---

## 4. Named tenant (normative)

Wire ids stay the SPA defaults so the meeting does not edit `.env`.

| Field | Value | Notes |
|---|---|---|
| `orgId` | `org_demo` | Valid `validateTenantId`. Matches `VITE_ORG_ID`. |
| Org `name` | `Harborlight Hospitality` | 201 path only. 409 does **not** rename the org (no org-rename API). First-run and wipe+re-seed get this name. Leftover “Demo Org” after a prior curl is acceptable; it is not on the tape. |
| `propertyId` | `prop_demo` | Matches `VITE_PROPERTY_ID`. **Must not** be the tape header label. |
| Property `name` | `The Meridian Seattle` | PATCH on every run if different (heals README “Demo Hotel”). |
| `timeZone` | `America/Los_Angeles` | First-write only. Re-run after the UTC three-curl keeps `UTC`. Seed **dates** always use the stored TZ from `GET` / PropertyDO, not this constant blindly. |
| `currency` | `USD` | First-write ledger currency. Required on provision today. |

Do not change `.env.example` ids. A one-line comment that `pnpm demo:seed` fills this tenant is allowed in README, not required in the env file.

---

## 5. Seeded hotel (normative fixture)

All dates are property-local calendar dates from the stored timezone + Worker clock at seed time. Let `T` = that date (`YYYY-MM-DD`). `T-n` / `T+n` are calendar days, not business-date rolls.

Stable resource ids below are **per PropertyDO** (rooms / types / reservations) or **per OrgDO** (guests). Tests targeting a random property reuse the same suffixes; collisions across properties are impossible for PropertyDO rows. Guest ids include the `propertyId` suffix in tests if two properties share one org; the meeting tenant is one org / one property, so the table’s guest ids are exact.

### 5.1 Room types

| `roomTypeId` | `code` | `name` | `roomCount` | `maxOccupancy` | `maxAdults` |
|---|---|---|---|---|---|
| `rt_king` | `KDX` | `King Deluxe` | 10 | 2 | 2 |
| `rt_twin` | `TWN` | `Twin` | 6 | 2 | 2 |
| `rt_suite` | `STE` | `Suite` | 4 | 3 | 2 |

Heal the README curl: if `rt_king` exists as `King` / `KNG` / `roomCount: 10`, **PUT** name `King Deluxe`, code `KDX`, `roomCount: 10` (stable idempotency `demo-seed:v1:rt_king`). Do **not** archive a leftover type this chunk. Do **not** lead the UI with `rt_king` — Book already labels from `GET /room-types` names.

### 5.2 Physical rooms (20)

Default status `clean`. Codes are the operator-visible labels.

| `roomId` | `code` | `roomTypeId` | `floor` |
|---|---|---|---|
| `rm_101` … `rm_110` | `101` … `110` | `rt_king` | `1` |
| `rm_201` … `rm_206` | `201` … `206` | `rt_twin` | `2` |
| `rm_301` … `rm_304` | `301` … `304` | `rt_suite` | `3` |

Walk-in inventory left free after seed (Book / assign must not be sold out): `108`–`110`, `205`–`206`, `303`–`304` (and any unassigned type capacity).

### 5.3 BAR rates

Plan: existing `BAR` (do **not** `POST /rate-plans` a second BAR).

Inclusive stay dates **`T-2` … `T+13`** (16 nights) × three types. Covers: past occupying nights, default tape (`T`…`T+6`), Rates matrix default (today→+13), Book of a short stay.

| Type | `amountMinor` | `currency` |
|---|---|---|
| King Deluxe | `28900` | `USD` |
| Twin | `21900` | `USD` |
| Suite | `42900` | `USD` |

Integer minor only. Use existing `rates.bulk_update` (or repeated `rates.upsert_day`) with stable idempotency keys `demo-seed:v1:rate:{roomTypeId}:{stayDate}`. Re-PUT of the same cell is success.

### 5.4 Guests (first + last)

`displayName` is `"First Last"`. Optional email `first.last@example.com` (deterministic, not a real inbox). No phone required.

| `guestId` | `displayName` | Role |
|---|---|---|
| `gst_james_whitaker` | James Whitaker | in-house |
| `gst_priya_nair` | Priya Nair | in-house |
| `gst_elena_rossi` | Elena Rossi | in-house |
| `gst_marcus_chen` | Marcus Chen | in-house |
| `gst_hannah_brooks` | Hannah Brooks | in-house |
| `gst_robert_hale` | Robert Hale | departing |
| `gst_sofia_alvarez` | Sofia Alvarez | departing |
| `gst_david_okonkwo` | David Okonkwo | departing |
| `gst_claire_fontaine` | Claire Fontaine | arrival assigned |
| `gst_tomiko_sato` | Tomiko Sato | arrival assigned |
| `gst_benjamin_walsh` | Benjamin Walsh | arrival assigned |
| `gst_amira_hassan` | Amira Hassan | arrival **unassigned** |
| `gst_lydia_grant` | Lydia Grant | future (tape window) |
| `gst_owen_fischer` | Owen Fischer | future (tape window) |

Fourteen guests, fourteen stays. `GUEST_EXISTS` on re-run is success when `GET …/guests/:id` returns the same `displayName`.

### 5.5 Stays (board + tape)

All `status` at create = `confirmed`, `ratePlanId` = `BAR`, `adults` = 1, `quoteAriVersion` from a PropertyDO availability read **after** types exist (Worker-internal `readAvailabilityRange` / equivalent — do not depend on KV). Then assign (except Amira) and check in the eight in-house / departing rows.

| `reservationId` | Guest | Type | Room | Arrival | Departure | After seed |
|---|---|---|---|---|---|---|
| `res_demo_ih_01` | James Whitaker | King Deluxe | `101` | `T-1` | `T+3` | `checked_in` |
| `res_demo_ih_02` | Priya Nair | King Deluxe | `102` | `T-1` | `T+2` | `checked_in` |
| `res_demo_ih_03` | Elena Rossi | Twin | `201` | `T-2` | `T+4` | `checked_in` |
| `res_demo_ih_04` | Marcus Chen | Suite | `301` | `T-1` | `T+5` | `checked_in` |
| `res_demo_ih_05` | Hannah Brooks | King Deluxe | `103` | `T-1` | `T+3` | `checked_in` |
| `res_demo_dep_01` | Robert Hale | King Deluxe | `104` | `T-2` | `T` | `checked_in` |
| `res_demo_dep_02` | Sofia Alvarez | Twin | `202` | `T-1` | `T` | `checked_in` |
| `res_demo_dep_03` | David Okonkwo | King Deluxe | `105` | `T-2` | `T` | `checked_in` |
| `res_demo_arr_01` | Claire Fontaine | King Deluxe | `106` | `T` | `T+2` | `confirmed` assigned |
| `res_demo_arr_02` | Tomiko Sato | Twin | `203` | `T` | `T+3` | `confirmed` assigned |
| `res_demo_arr_03` | Benjamin Walsh | Suite | `302` | `T` | `T+2` | `confirmed` assigned |
| `res_demo_arr_04` | Amira Hassan | King Deluxe | *(none)* | `T` | `T+2` | `confirmed` **unassigned** |
| `res_demo_fut_01` | Lydia Grant | King Deluxe | `107` | `T+2` | `T+4` | `confirmed` assigned |
| `res_demo_fut_02` | Owen Fischer | Twin | `204` | `T+3` | `T+5` | `confirmed` assigned |

Board counts on date `T` (must match shipped predicates):

| Board | Count | Why |
|---|---|---|
| In-house | **8** | five staying + three departing, all `checked_in` |
| Arrivals | **4** | four `confirmed` with `arrival_date = T` (checked-in rows with arrival `T` would drop off this board — none do) |
| Departures (due out) | **3** | three `checked_in` with `departure_date = T` |
| Unassigned occupying | **1** | Amira (`roomId` null, `confirmed`, overlaps tape) |

Future rows are in scope so `T+2` / `T+3` columns are not empty. They do not change today’s board counts.

### 5.6 Past-night availability backfill (normative)

Before any `reservations.create` whose nights include a date `<` open business date:

For each active seeded room type and each stay date in `[T-2, T)` (and any other fixture night still missing a row):

```
INSERT OR IGNORE INTO availability_day
  (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
VALUES (?, ?, :roomCount, 0, 0, 0, 0, 1)
```

`physical` = that type’s `room_count`. Do **not** bump `__meta.business_date`. Do **not** emit `availability.changed` for the backfill itself (no sold change yet). Subsequent `tryCreateReservation` increments `sold` and emits as today.

This helper is `assertUnsafeLocal` + called only from the dev route. It is not a catalog command and not a public inventory API.

### 5.7 What is deliberately not seeded

- Cashier shift (P0-2).
- Folio charges / payments / holds.
- Housekeeping assignments, dirty rooms, OOO ranges.
- Staff / roster beyond the existing `user_owner` membership from provision.
- Exceptions, night-audit runs, FX rates, charge codes beyond system defaults.
- A second property.
- VIP / DND flags (optional chrome; not a P0-1 checkbox).

---

## 6. Worker orchestrator (normative)

Handler `handlePostDemoSeed` (Worker module, not `domain/`):

```
assert isDevActorAllowed          // belt; handleV1 already 404s
parse body → validateTenantId
load registry property; 404 / mismatch
requirePermission(orgId, propertyId, actor, 'property:provision')
resolve OrgDO + PropertyDO stubs
today = property-local date from stored TZ (PropertyDO already has this clock)
ensure room types (§5.1) via existing tryAdd / tryUpdate
ensure 20 rooms via existing tryCreateRoom
ensurePastAvailabilityDays(T-2 .. T-1)
ensure BAR rate days (§5.3) via existing rate writers
for each guest: OrgDO tryCreateGuest (409/exists → read + continue)
for each stay: tryCreateReservation → tryAssignRoom (skip Amira) → tryCheckIn (ih/dep only)
return summary JSON
```

Each writer uses a **stable** idempotency key `demo-seed:v1:{kind}:{id}`. Fingerprints are the existing command fingerprints (not a mega-key).

Re-run rules (per resource):

| Resource | Already there | Action |
|---|---|---|
| Room type | same id | PUT names/codes/counts if they differ from §5.1 |
| Room | same `roomId` or unique `code` | skip create; do not change HK status (operator dirt stays) |
| Rate day | cell exists | PUT same integer (idempotent) |
| Guest | `GUEST_EXISTS` | skip; do not overwrite a staff edit of the profile |
| Reservation | id exists | skip create; assign if fixture has a room and `room_id` is null; check in if fixture says `checked_in` and status is still `confirmed` |
| Check-in | already `checked_in` | skip (do not POST check-in) |
| Extra operator stays | ids not in §5.5 | **leave them** |

Do not delete operator walk-ins from a failed dry run. Wipe is §7.2.

Response **200**:

```ts
{
  ok: true;
  orgId: string;
  propertyId: string;
  propertyName: string;
  timeZone: string;
  today: string; // T
  alreadySeeded: boolean; // true when every §5 row was already in the target state
  rooms: number; // 20
  roomTypes: Array<{ roomTypeId: string; code: string; name: string; roomCount: number }>;
  board: { inHouse: number; arrivals: number; departures: number; unassignedArrivals: number };
}
```

`alreadySeeded: true` is still **200**. Partial complete-the-missing is `alreadySeeded: false`.

Do not return guest PII (no `displayName` list). Do not return `reservationId`s unless needed for debug — omit; the summary counts are enough.

PropertyDO RPC name: `seedDemoHotel(actor, fixture)` **or** a Worker-local sequence of existing RPCs. Either is in spec; a single RPC must still call the existing `try*` methods (no raw `INSERT INTO reservation`). The only raw SQL unique to this chunk is `ensurePastAvailabilityDays`.

---

## 7. Idempotency and wipe (normative)

### 7.1 Re-run (preferred recovery)

`pnpm demo:seed` is safe to run twice on a healthy hotel. Second run exits 0, prints `alreadySeeded: true` (or completes a partial first run). Time budget: minutes, not a persist rebuild.

Org 409, property 201-existing, PATCH name no-op when already `The Meridian Seattle`, seed route skips existing fixture ids.

### 7.2 Wipe + re-seed (dirty hotel / leftover curl + extra types / failed mid-audit)

There is no seed-specific delete API this chunk.

1. Stop `pnpm --filter @hospai/pms-core dev`.
2. Delete local persist: `apps/pms-core/.wrangler/state` (Wrangler’s default D1 + DO + KV directory).
3. Start the Worker again.
4. `pnpm demo:seed`.

Document this in README next to the command. Do **not** tell the meeting to run org purge (Workflow, closing state, overkill).

Do not add `pnpm demo:seed --wipe` that shells `rm -rf` unless the script first refuses while the Worker is still bound to those files and prints the same four steps. Preferred: document, don’t automate a destructive delete in v1.

---

## 8. README (normative)

Replace “### 3 — Bootstrap tenant” as the **meeting / local happy path** with:

```bash
# terminal A — Worker (already running)
# terminal B
pnpm demo:seed
```

Keep the three curls under a new subheading **“Developer bootstrap (empty hotel)”**: still valid for engineers who want a blank property; not the meeting path. Mention that a prior curl + `demo:seed` heals `rt_king` → King Deluxe and PATCHes the property name, and that a dirty mix of leftover types is a wipe (§7.2).

Do not remove env-file or “start servers” steps. Seed is step 3, after both processes are documented; the script only requires the Worker.

---

## 9. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `package.json` | `"demo:seed": "node scripts/demo-seed.mjs"` |
| `scripts/demo-seed.mjs` | new — health check, org, property, name PATCH, POST admin seed, summary |
| `packages/contracts/src/v1-http-routes.ts` | append `[127] post_demo_seed` `scope: 'dev'` |
| `packages/contracts/src/register.test.ts` | pin `[126]` unmoved; `[127]`; catalog **77**; audit size **52** |
| `apps/pms-core/src/v1-dispatch.ts` | `V1_ROUTES` append; `handlePostDemoSeed` |
| `apps/pms-core/src/demo-seed.ts` (or equivalent) | fixture table + orchestrator; `ensurePastAvailabilityDays` |
| `apps/pms-core/src/property-do.ts` | unsafe-local past-day helper **or** accept a package-local SQL function using `this.ctx.storage.sql` behind `assertUnsafeLocal` |
| `apps/pms-core/test/demo-seed.spec.ts` | new |
| `README.md` | step 3 + wipe + developer curls |
| DEMO-READY.md | tick P0-1 in the **implementation** PR, not this spec turn |

No `pending-commands-consumer` / `NIGHT_AUDIT_STEPS` / `client-core` method required (script uses `fetch`). No `apps/web-pms` source changes. No `ARCHITECTURE.md` rewrite required.

---

## 10. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | One local command, named tenant | DEMO-READY P0-1 |
| 2 | GM property name, not `prop_demo` as the label | P0-1 |
| 3 | ~20 rooms, human codes, type names | P0-1 |
| 4 | BAR across the visible window | P0-1 |
| 5 | Occupied board (8 / 4 / 3 + one unassigned) | P0-1 |
| 6 | Named guests; tape shows `displayName` | P0-1 + shipped `GuestNameLink` |
| 7 | Idempotent re-run + documented wipe | P0-1 |
| 8 | README meeting path vs developer curls | P0-1 |
| 9 | Heal README `rt_king` / “Demo Hotel” | implied by re-run after today’s bootstrap |

---

## 11. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | **P0-2** folio first-paint / Advanced / shift auto-open | Next slice |
| 2 | **P0-3** chrome + skin + “Room Plan” + property-name rail | Next slice; seed only supplies `name` |
| 3 | **P0-4** Clerk / real `/sign-in` / hide `X-Dev-Actor` | Script stays on dev actor |
| 4 | **P0-5** 8-minute speaker script + dry runs | Documentation / rehearsal |
| 5 | Virtual room types | §7.1 |
| 6 | Derived / OrgDO rate plans | §7.2 |
| 7 | `rooms.delete` / unit archive | Rooms-vertical leftover |
| 8 | `ui-kit` / visual identity | §16.4 |
| 9 | City ledger / invoices / auto-transfer / recurring / partial refunds | Phase 1 leftovers |
| 10 | PCI / real PSP | Simulate |
| 11 | Second property isolation beat | P0-5 optional moat |
| 12 | Night-audit execution in seed | P0-5 / night-audit screen |
| 13 | Folio minibar + capture as seed data | 8-minute walk-in does this live |
| 14 | Dirty / OOO / HK assignments | Housekeeping beat is live |
| 15 | Org rename API (“Demo Org” leftover) | No writer exists |
| 16 | Timezone rewrite after first-write UTC curl | Wipe, or live with UTC dates |
| 17 | Changing provision HTTP | Forbidden |
| 18 | New DO tables / catalog commands | Forbidden |
| 19 | Production seed / remote demo tenant | Local only |
| 20 | Guest CRM / tape / exception UI work | Already shipped; no markup here |

---

## 12. Tests (acceptance-shaped)

**Contracts / register**

1. `V1_HTTP_ROUTE_AUDIT[126].id === 'get_guest_stays'`; `[127] === 'post_demo_seed'`; `[127].scope === 'dev'`; no `commandId` / `permission` / `entitlement` / `degradedRead`.
2. `COMMAND_CATALOG` length **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. No `demo.seed` catalog id.
3. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. Purge table list unchanged. `CLASS_DENYLIST` unchanged.

**pms-core — gate**

4. Without `HOSPAI_ALLOW_DEV_ACTOR` / unsafe local: `POST /v1/admin/demo-seed` → **404** `not_found` (even with a valid actor header).
5. Flags on, actor without `property:provision` on that org → **403**. Unknown `propertyId` → **404**. Body `orgId` ≠ registry org → **400** `org_property_mismatch`.

**pms-core — fixture (shared storage: random org/property)**

6. Provision random org + property (USD + a real TZ). `POST /v1/admin/demo-seed`. `GET /room-types` returns King Deluxe / Twin / Suite (names, not only ids). `GET /rooms` has 20 rows with codes `101`…`110`, `201`…`206`, `301`…`304`.
7. `GET /rate-days?fromDate=T&toDate=T+6&ratePlanId=BAR` has a cell for each type × each night; amounts 28900 / 21900 / 42900; no floats.
8. `GET /front-desk/summary?date=T`: `inHouse === 8`, `arrivals === 4`, `departuresDue === 3`. `GET /front-desk/arrivals?date=T` includes Amira with `roomId` null and three assigned arrivals. In-house list length 8.
9. `GET /front-desk/tape?fromDate=T&toDate=T+6`: unassigned lane has Amira’s block; assigned blocks sit on `101`…`107` / `201`…`204` / `301`–`302` as in §5.5. **No `displayName` on tape JSON.** `POST /guests/batch` of those `guestRef`s returns first+last names. `GET /guests/:id` for Amira is `Amira Hassan`.
10. Second `POST /v1/admin/demo-seed` → 200 `alreadySeeded: true`; reservation count for fixture ids unchanged; an extra operator reservation created between calls is still present.
11. Pre-create README curl shape (`rt_king` / `KNG` / `King` / `roomCount: 10`, property name `Demo Hotel`). Seed → type name `King Deluxe`, code `KDX`; `GET` property name `The Meridian Seattle`.
12. Booking a new confirmed stay on a free King Deluxe night after seed succeeds (`quoteAriVersion` from `GET /availability`) — walk-in inventory is not sold out.
13. `pnpm generate:ddl` PropertyDO and OrgDO diffs empty.

**Script smoke (optional in pms-core; required as a documented manual check)**

14. With Worker down, `node scripts/demo-seed.mjs` exits non-zero and does not print a fake success. With Worker up on a wiped persist, it exits 0 and prints `The Meridian Seattle` and board counts.

**Pins**

15. `check:permissions` / `check:degraded` / `check:entitlements` / `check:class-denylist` / `check:ddl` green. No new `export class`.

---

## 13. Open questions (locked)

1. **Node vs shell vs Worker vs combination.** **Locked: combination** — `pnpm demo:seed` → `scripts/demo-seed.mjs` + `POST /v1/admin/demo-seed`. §3.1.
2. **Wire ids.** **Locked: `org_demo` / `prop_demo`.** Names are Harborlight / The Meridian Seattle. `.env.example` ids unchanged.
3. **Past nights.** **Locked: unsafe-local `availability_day` backfill** on the existing table. Not night audit. Not a demo clock. Not a provision API change.
4. **Board arithmetic.** **Locked: 8 in-house includes the 3 due-outs** (all `checked_in`). Arrivals are 4 other `confirmed` rows. One of those four is unassigned.
5. **Re-run vs wipe.** **Locked: re-run is skip/heal.** Wipe is delete `apps/pms-core/.wrangler/state`. No purge Workflow. No `--wipe` rm in v1.
6. **Catalog.** **Locked: no `demo.seed` command.** Dev route only.
7. **Schema.** **Locked: no migration.**
8. **UI.** **Locked: no SPA source changes.** Tape already shows `displayName`.
9. **Shift / folio lines / HK dirt.** **Locked: out** (P0-2 / P0-5 / live beats).
10. **Timezone after UTC curl.** **Locked: do not rewrite first-write TZ.** Dates follow stored TZ. Wipe if the meeting needs Los Angeles.

---

## 14. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Append `[127] post_demo_seed`; `V1_ROUTES` append; catalog 77 / audit 52 / schema heads unchanged.
- [ ] Fixture §5 + `ensurePastAvailabilityDays` behind `assertUnsafeLocal` / `isDevActorAllowed`.
- [ ] Orchestrator uses existing `try*` writers; PropertyDO does not call OrgDO.
- [ ] `scripts/demo-seed.mjs` + root `pnpm demo:seed`; org/property HTTP unchanged.
- [ ] README step 3 + wipe + developer curls subsection.
- [ ] Tests §12. Stop. Do not start P0-2 / P0-3 / P0-4 / P0-5.

---

## 15. Reviewer checklist

- [ ] Verified-current-state table matches the tree (route **127**, catalog **77**, property head **25**, org head **7**, no new commands, BAR already seeded as a plan, tape already composes names, `commitSoldNightsSync` cannot book pre-horizon nights).
- [ ] Normative invariants include integer money, append-only folio, schema freeze, no PropertyDO→OrgDO, unchanged provision HTTP, local-only 404 gate, no new `export class`.
- [ ] Command / shape decision is explicit: Node script + one `scope: 'dev'` Worker route; not shell-only; not a catalog command; not a provision-body flag.
- [ ] Exact command `pnpm demo:seed`, script `scripts/demo-seed.mjs`, route `POST /v1/admin/demo-seed`.
- [ ] Idempotency (stable ids / 409-as-success / skip check-in) and wipe (`apps/pms-core/.wrangler/state`) are both specified.
- [ ] Seeded data is tabulated: org, property, 3 types, 20 rooms, BAR cells, 14 named guests, 14 stays, board 8/4/3 + one unassigned.
- [ ] Scope-out names P0-2, P0-3, P0-4, P0-5, UI-beyond-data, production, provision API changes, new DO tables.
- [ ] Folded leftovers §10 and deferred leftovers §11 both present.
- [ ] Acceptance tests §12 and this reviewer checklist present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn.
