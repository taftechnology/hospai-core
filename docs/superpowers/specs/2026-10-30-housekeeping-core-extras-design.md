# Housekeeping core extras — priority, inventory, staff ops, maintenance (R1.9)

**Status:** Accepted · 2026-10-30
**Roadmap:** R1.9 Housekeeping — KEEP core extras
**Builds on:** [housekeeping module](./2026-08-11-housekeeping-module-mechanism-design.md), [room-ops HK completion](./2026-08-12-room-operations-hk-completion-design.md) (leftover 5: maintenance subscribes to `room.ooo_changed`), [staff roster](./2026-08-12-staff-roster-design.md) (leftover 2: `maintenance` kind; leftover 7: shifts / capacity / operational skills), [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) row 5.
**Prototype:** `hospai-pms-prototype/src/components/Housekeeping.tsx` — Priority tab and score (~601–690), Inventory tab (committed `HEAD` only; the working copy deletes it), Maintenance tickets (~74–97, 713–782), Staff cards (~2711–2962); `TicketsSettings.tsx` task types and checklists.
**Architecture:** §7.1 rule 3 (OOO opens a `maintenance` work order), §11 (`modules/pms/maintenance`), §16.1 (housekeeper roster with shifts/skills/capacity, task assignment, inventory, manager priorities; maintenance work orders, task types, checklists).

---

## 0. How it ships (decided 2026-10-30)

One spec, **four commits**, built and verified in this order. Each is its own commit on the user's go-ahead; the pins in §9 move per commit.

| Part | Commit | Owns |
|---|---|---|
| A | Priority | `housekeeping_priority`, Priority tab |
| B | Inventory | `housekeeping_inventory_*`, Inventory tab |
| C | Staff ops | OrgDO `roster_kind` rebuild (+`maintenance`), shift / capacity / skill tags, workload n / max |
| D | Maintenance | `modules/pms/maintenance`, in-transaction `subscribes`, tickets, task types, checklists |

C lands before D because D assigns tickets to `maintenance` staff.

## 1. Decisions (locked)

1. **Prototype keys stay excluded.** `pms_hk_manager_priorities`, `pms_hk_inventory` and `pms_maintenance_tickets` are per-room or per-item **data**, not configuration. Same precedent as R1.5 `pms_products_*`: they map to module tables, not `CONFIG_REGISTER`. The roadmap's "un-exclude" is met by shipping the feature; the `EXCLUDED_PROTOTYPE_KEYS` comment is reworded to say *data bags served by module tables* (and the stale "89-key" text fixed). `EXPECTED_PROTOTYPE_KEYS` stays 97.
2. **Priority is per room per business date.** Keying on `business_date` means yesterday's override never leaks into today — no reset job, no night-audit step (`NIGHT_AUDIT_STEPS` unchanged). Prototype has no reset at all; that is a prototype bug, not a feature.
3. **Score is computed on read, never stored.** Only the manager level is stored.
4. **Inventory is an operational list inside `pms.housekeeping`.** Integer counts, par level, a movement log. **No cost, no valuation, no stores, no purchase orders** (§16.6 *Integrate*). R4.11 minibar / amenity stock moves against this list later.
5. **Staff ops are plaintext, per property, on `roster_property`.** Shift, capacity and skill tags are operational, not HR data — they are **not** `StaffProfile.skills` (encrypted, compensation-gated; roster spec §2.3). Different staff can work different shifts at different hotels.
6. **Capacity warns, never blocks.** Over-capacity assignment is a supervisor's call. The server does not gate on it; the SPA labels it.
7. **`maintenance` roster kind.** OrgDO migration rebuilds `roster_kind` (create-copy-drop-rename; a CHECK cannot be altered) with `kind IN ('housekeeper','maintenance')`. `PHASE1_ROSTER_KINDS` gains `maintenance`. `assertStaffAssignable` takes the required kind.
8. **Maintenance is its own module** — `modules/pms/maintenance`, id `pms.maintenance`, entitlement `pms.core`, prefix `maintenance_`. Housekeeping never writes a ticket.
9. **`room.ooo_changed` is consumed in the same transaction** (decided 2026-10-30). Manifest `subscribes` becomes real: when PropertyDO appends an outbox event inside `transactionSync`, it calls every subscribed module handler with the same `ModuleTxnCtx`. The ticket exists the moment the OOO commits; no queue lag; the SPA sees it without WebSocket.
   - **One level deep.** A handler may write its own tables and append outbox rows, but an event appended by a handler does **not** dispatch further subscribers. The dispatcher enforces this (nested dispatch throws `INTERNAL_ERROR` in tests).
   - **A handler failure aborts the originating command.** Fail closed and atomic: no OOO without its ticket. Handlers are sync (`SyncUseCase`) — no `await` inside `transactionSync`.
   - `check:module-manifests` gains: every `subscribes[].event` is in some manifest's `publishes` or in a catalog `events[]`, and every `handler` resolves to an export of that module. `handleDomainEvent` keeps its `room.ooo_changed` no-op case — the queue still archives the event.
10. **OOO always opens a ticket; a ticket never sets OOO.** One path to out of order (the existing board form, `rooms.set_ooo_range`, `inventory:write`). A standalone ticket (dripping tap) is created on the Maintenance screen with no OOO. Resolving a ticket does **not** release the room — the dialog offers *Release room now*, which calls the existing OOO release as a second command. Cross-module writes to `room` / `room_ooo` from maintenance are forbidden (`check:module-manifests`).
11. **Task types are property catalog data** under Settings, `settings:configure` (same as products). A task type carries a default category, default priority and a checklist; a ticket **snapshots** the checklist when created, so editing a task type never rewrites open tickets.
12. **New permissions `maintenance:read` / `maintenance:write`**, property-scoped. `ROLE_GRANTS`: owner all; admin both; staff both (attendants report faults). Kill-switch: standard `pms.core` mutation behaviour; nothing here is lifecycle.

## 2. Part A — Priority

**Table** (property migration, part A):

```sql
CREATE TABLE housekeeping_priority (
  room_id       TEXT NOT NULL,
  business_date TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('vip','guest_waiting','high','rush','early_arrival')),
  set_by        TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (room_id, business_date)
)
```

`standard` is the absence of a row. Manifest `schema.tables` and `writes` gain it.

**Command** `housekeeping.set_priority` — `INTERACTIVE`, `QUEUE_PROVISIONAL` (same class as `housekeeping.assign`), `housekeeping:write`, event `housekeeping.priority_changed` `{ propertyId, roomId, businessDate, level | null }`. Body `{ roomId, businessDate, level: Level | 'standard' }`. `standard` deletes the row. Unknown level → 400 `invalid_body`; unknown or archived room → existing `room_not_found`. Business date validated as a calendar date only, same as `housekeeping.assign`.

**Read** `get_housekeeping_priorities?date=` — `housekeeping:read`. Returns the cleaning queue: rooms with status `dirty` (not OOO, not clean / inspected, not archived), each `{ roomId, code, floor, level, score, reasons[], stay: 'arriving'|'departing'|'stayover'|'vacant', vip, dnd, assigneeRef }`, sorted by `score` desc, then room `code`.

**Score** (from the prototype, minus free-text parsing):

| Factor | Points | Reason code |
|---|---|---|
| Manager `vip` / `guest_waiting` / `high` / `rush` / `early_arrival` | 160 / 140 / 120 / 80 / 60 | the level |
| Stay `vip_flag` on the room's reservation (skipped if manager `vip`) | 100 | `stay_vip` |
| Arriving today (assigned, `pending`/`confirmed`, arrival = date) | 50 | `arriving` |
| Departing today (`in_house`, departure = date) | 30 | `departing` |
| Stayover (`in_house`) | 10 | `stayover` |
| Vacant | 5 | — |
| Dirty | 15 | — |
| `dnd_flag` on the stay | 0 | `dnd` (badge only) |

Reservation rows are read to label the room's stay, not to answer capacity — no `availability_day` question is asked. The prototype's "early" substring match on special requests is **not** copied (no parsing free text). Stay VIP only — guest-level VIP (R1.8) lives in OrgDO ciphertext and is not decrypted for a board read.

**SPA:** Housekeeping gets sub-routes **Board** `/housekeeping`, **Priority** `/housekeeping/priority`, **Inventory** `/housekeeping/inventory` (route tabs like Rates; each `PageHeader` title matches). Priority tab: rank, room, floor, stay, reason badges, level `NativeSelect` (Standard + five levels), assignee, Assign picker. The Board row shows a level `Badge` when one is set; the Board's sort is unchanged.

## 3. Part B — Inventory

**Tables** (property migration, part B):

```sql
CREATE TABLE housekeeping_inventory_item (
  item_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('linens','towels','toiletries','chemicals','equipment','other')),
  unit        TEXT NOT NULL,
  par_level   INTEGER NOT NULL CHECK (par_level >= 0),
  on_hand     INTEGER NOT NULL CHECK (on_hand >= 0),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX housekeeping_inventory_item_name ON housekeeping_inventory_item (lower(name)) WHERE archived_at IS NULL;
CREATE TABLE housekeeping_inventory_movement (
  movement_id   TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES housekeeping_inventory_item(item_id),
  kind          TEXT NOT NULL CHECK (kind IN ('receive','issue','count')),
  quantity      INTEGER NOT NULL,
  on_hand_after INTEGER NOT NULL,
  note          TEXT,
  actor_ref     TEXT NOT NULL,
  business_date TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX housekeeping_inventory_movement_by_item ON housekeeping_inventory_movement (item_id, created_at);
```

**Commands** — all `INTERACTIVE`, `FAIL_CLOSED`, `housekeeping:write`, event `housekeeping.inventory_changed` `{ propertyId, itemId }`:

| Command | Body | Rules |
|---|---|---|
| `housekeeping.inventory_create_item` | `{ itemId, name, category, unit, parLevel, onHand }` | client id, first-writer-wins; ≤ 200 live items → else 422 `limit_exceeded`; duplicate live name → 409 `inventory_item_exists`; initial `onHand` logs one `count` movement |
| `housekeeping.inventory_update_item` | `{ itemId, name, category, unit, parLevel, archived }` | full replace; does **not** touch `on_hand`; archive hides from the list, history kept |
| `housekeeping.inventory_adjust` | `{ itemId, kind, quantity, note? }` | `receive` +q, `issue` −q (q ≥ 1), `count` sets on_hand = q (q ≥ 0); `issue` below zero → 422 `insufficient_stock`; archived → 409 `inventory_item_archived`; business date = property's current |

Caps: name ≤ 80, unit ≤ 20, note ≤ 200, quantities and par ≤ 1,000,000 → 422 `limit_exceeded`. Unknown item → 404 `inventory_item_not_found`.

**Reads:** `get_housekeeping_inventory` (live items, `low = onHand < parLevel`; `?archived=1` includes archived) and `get_housekeeping_inventory_movements?itemId=` (latest 50, newest first) — `housekeeping:read`.

**SPA (Inventory tab):** `DataTable` of items — name, category, on hand / par, unit, a **Low** `Badge` (word, not colour). Header count "N low". Row actions: Receive, Issue, Count (one `Dialog`, quantity + note), Edit, History (movements). Add item form. No valuation column.

## 4. Part C — Staff ops

**OrgDO migration** (part C, one version): rebuild `roster_kind` with `('housekeeper','maintenance')` keeping exit triggers; `ALTER TABLE roster_property ADD COLUMN shift TEXT CHECK (shift IN ('morning','evening','night','any'))`, `max_rooms INTEGER CHECK (max_rooms BETWEEN 1 AND 50)`, `ops_skills TEXT` (JSON array). Nulls mean *not set*.

**Command** `roster.set_ops` — `FAIL_CLOSED`, `roster:write`, `pms.core`, on the **URL property**: `{ staffId, shift | null, maxRooms | null, skills: string[] }`. Staff not linked to the URL property → 404 `not_found` (no other-property data in the body). Skills: trim, collapse whitespace, case-insensitive dedupe; ≤ 10 tags × 32 chars → 422 `limit_exceeded`. Kinds stay on `roster.update` (already a set) — it now accepts `maintenance`.

**Reads:** `get_roster` rows gain `ops: { shift, maxRooms, skills }` for the URL property. `?kind=maintenance` works.

**SPA:**
- Roster: kinds become checkboxes (Housekeeper, Maintenance; at least one). A **Work at this hotel** card: shift select, max rooms, skill-tag chips (R1.8 chip pattern). Skill tags are **not** behind `roster:compensation`.
- HK Board workload strip: `n / max` per housekeeper when `maxRooms` is set, `Badge rung="attention"` "Full" at or over. Assign picker labels `Name · Morning · 8/12` and sorts on-capacity first; over-capacity stays selectable.
- No auto-assign / smart dispatch (leftover 1).

## 5. Part D — Maintenance module

`modules/pms/maintenance/src/module.manifest.ts`: id `pms.maintenance`, `pms.core`, prefix `maintenance_`, tables below, `publishes ['maintenance.ticket_changed']`, `subscribes [{ event: 'room.ooo_changed', handler: 'onRoomOooChanged' }]`, permissions `maintenance:read|write`. `ui.manifest.ts`: nav `/maintenance`, after Housekeeping, `maintenance:read`. Kernel registry, `package.json`, purge inventory list, class denylist, `check:module-manifests` all updated as R1.5 products did.

**Tables** (property migration, part D):

```sql
CREATE TABLE maintenance_task_type (
  task_type_id     TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,   -- plumbing|electrical|hvac|furniture|locks|housekeeping|other
  default_priority TEXT NOT NULL,   -- low|medium|high|emergency
  checklist        TEXT NOT NULL,   -- JSON string[] ≤ 20 × 80
  active           INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE maintenance_ticket (
  ticket_id       TEXT PRIMARY KEY,
  ticket_no       INTEGER NOT NULL UNIQUE,  -- per-property sequence, shown as #N
  room_id         TEXT NOT NULL,
  category        TEXT NOT NULL,
  priority        TEXT NOT NULL,
  description     TEXT NOT NULL,            -- ≤ 2,000
  task_type_id    TEXT,
  checklist       TEXT NOT NULL,            -- JSON [{ label, done }]
  status          TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','cancelled')),
  assignee_ref    TEXT,
  source          TEXT NOT NULL CHECK (source IN ('desk','ooo')),
  ooo_id          TEXT UNIQUE,
  ooo_released_at INTEGER,
  resolution_note TEXT,                     -- ≤ 2,000
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX maintenance_ticket_by_status ON maintenance_ticket (status, created_at);
CREATE INDEX maintenance_ticket_by_room ON maintenance_ticket (room_id, created_at);
```

Categories and priorities are the prototype's; held as contracts constants, validated at HTTP and in the module.

**Subscriber `onRoomOooChanged`** (same transaction, §1.9):
- `created` → insert ticket `source='ooo'`, `ooo_id`, room, category `other`, priority `high`, description = OOO reason (or "Out of order" when blank), empty checklist, `status='open'`, `created_by` = the OOO actor.
- `updated` → no ticket change.
- `released` → set `ooo_released_at` on the linked ticket; status unchanged.
- Duplicate `ooo_id` (replay) → no-op, not an error.

**Commands** — `INTERACTIVE`, `FAIL_CLOSED`, event `maintenance.ticket_changed` `{ propertyId, ticketId, status }` (task types: `maintenance.task_type_changed`):

| Command | Permission | Body / rules |
|---|---|---|
| `maintenance.create_ticket` | `maintenance:write` | `{ ticketId, roomId, category?, priority?, description, taskTypeId? }` — task type fills category / priority defaults and snapshots its checklist; inactive or unknown task type → 404 `task_type_not_found`; archived room → `room_not_found`; `source='desk'` |
| `maintenance.update_ticket` | `maintenance:write` | `{ ticketId, priority?, description?, assigneeRef? | null, checklistDone?: boolean[], status?, resolutionNote? }` — transitions `open→in_progress`, `open|in_progress→resolved|cancelled`; anything else 409 `invalid_ticket_transition`; resolved / cancelled are terminal → 409 `ticket_closed`; `cancelled` requires `resolutionNote`; `checklistDone` length must equal the snapshot → 422; assignee must be active `maintenance` staff at the property (`assertStaffAssignable(…, 'maintenance')`) |
| `maintenance.create_task_type` | `settings:configure` | `{ taskTypeId, name, category, defaultPriority, checklist }`; ≤ 100 per property |
| `maintenance.update_task_type` | `settings:configure` | full replace incl. `active`; never touches existing tickets |

Unknown ticket → 404 `ticket_not_found`. Resolving with unticked checklist items is allowed (the SPA confirms).

**Reads:** `get_maintenance_tickets?status=open|in_progress|closed|all&roomId=` (newest first, ≤ 200; no PII — `created_by` / `assignee_ref` are staff refs resolved to names through the existing roster read) — `maintenance:read`. `get_maintenance_task_types` — `maintenance:read` (the create form needs them).

**SPA:**
- `/maintenance` — `PageHeader` "Maintenance", subtitle `property.name`. Status filter (Open · In progress · Closed). `DataTable`: #N, room, category, priority `Badge` (emergency = `rung="danger"`, word shown), description, assignee, age, *OOO* badge while the linked range is active. **Report issue** form (room, task type, category, priority, description).
- Ticket `Dialog`: assign picker (maintenance kind), priority, description, checklist checkboxes, Start / Resolve / Cancel. Resolve asks for a note; if the room's OOO is still active it offers **Release room now** (second command, existing OOO release; failure shows its own `Alert`, the ticket stays resolved). Cancel is `intent=destructive` with confirm.
- Board OOO success `Alert` says "Ticket #N opened" with a link.
- `/settings/maintenance` — task types `DataTable` + form (checklist as an ordered list of text rows). Hidden without `settings:configure`.
- Local invalidation on every mutation: `['maintenance-tickets', propertyId, …]`, and after an OOO save also `['maintenance-tickets', propertyId]`.

## 6. Wire, idempotency, errors

- JSON via the shared parse helper; blind casts are not validation. Every array (checklist, `checklistDone`, skills) capped at HTTP **and** in the `try*` RPC.
- Fingerprint `commandFingerprint(commandId, normalisedBody)`; key per user; the object hashed is the object sent. Idempotency key location follows the neighbouring routes: HK writes and roster writes use the same place their existing siblings use (recorded per route in the As-built).
- New error codes in `contracts/src/idempotency.ts` and the one `commandErrorHttpStatus` table: `inventory_item_not_found` 404, `inventory_item_exists` 409, `inventory_item_archived` 409, `insufficient_stock` 422, `ticket_not_found` 404, `ticket_closed` 409, `invalid_ticket_transition` 409, `task_type_not_found` 404. `limit_exceeded` 422 and `room_not_found` reuse existing entries.
- Every property route calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.
- Audit: every new writer is in `AUDIT_WRITER_COMMAND_IDS`.

## 7. Out (do not build here)

Auto-assign / smart dispatch; budgeting, metrics, HK report catalog (R4.14); mobile attendant (R4.10); inspections, lost and found, damage, minibar / amenity posting, guest requests (R4.11); SLA timers and escalation emails; stock cost, valuation, purchase orders, stores (§16.6); tickets for public areas without a room; DND as a room status.

## 8. Leftovers (named)

1. Auto-assign using shift / capacity / skills / priority.
2. Report issue **and** take out of order in one form (today: two actions).
3. Reopen a resolved ticket.
4. Ticket SLA from task type and escalation rules (prototype `slaMins`, `EscalationRule`).
5. Public-area tickets (no `room_id`).
6. Guest-level VIP (R1.8) in the priority score — needs a non-decrypting projection.
7. Issue-to-room stock movements (R4.11 minibar / amenities build on `housekeeping_inventory_*`).
8. Per-property roster kinds (kinds remain org-wide).

## 9. Pins (per commit)

| Part | Commands | Routes (`V1_HTTP_ROUTE_AUDIT`) | `PROPERTY_SCHEMA_HEAD` | `ORG_SCHEMA_HEAD` |
|---|---|---|---|---|
| start | 95 | 152 · `put_operational_config` | 36 | 10 |
| A | +1 `housekeeping.set_priority` | +2 `put_housekeeping_priority`, `get_housekeeping_priorities` | 37 | — |
| B | +3 | +5 `post_housekeeping_inventory_item`, `patch_housekeeping_inventory_item`, `post_housekeeping_inventory_adjust`, `get_housekeeping_inventory`, `get_housekeeping_inventory_movements` | 38 | — |
| C | +1 `roster.set_ops` | +1 `put_roster_ops` | — | 11 |
| D | +4 | +6 `post_maintenance_ticket`, `patch_maintenance_ticket`, `get_maintenance_tickets`, `post_maintenance_task_type`, `patch_maintenance_task_type`, `get_maintenance_task_types` | 39 | — |
| end | **104** | **166** | **39** | **11** |

Route ids are final at build time if a sibling's naming differs; the AGENTS pin table is updated in each commit. `check:*` stays **17** — part D extends `check:module-manifests` rather than adding a script.

## 10. Tests (acceptance)

**A**
1. Set / change / clear (`standard`) a level; second set on the same room+date replaces.
2. Level on date D is absent on D+1.
3. Score order follows the table: manager `vip` on a dirty vacant room (160 + 15 + 5 = 180) ranks above a dirty room with an arriving stay-VIP (100 + 50 + 15 = 165); equal scores sort by room code.
4. Queue excludes clean, inspected, OOO and archived rooms.
5. Replay of a queued `set_priority` re-checks `housekeeping:write` for that user.

**B**
6. Create → receive → issue → count round-trip; `on_hand` and movements agree after each step.
7. Issue below zero → 422 `insufficient_stock`, nothing written.
8. 201st live item → 422; duplicate live name → 409; archived name can be reused.
9. Hotel A's items are invisible at hotel B (same org).

**C**
10. Migration keeps existing housekeeper kinds and exit triggers; `maintenance` accepted on `roster.update`.
11. `set_ops` on staff not linked to the URL property → 404, body carries no other-property data.
12. Ops at hotel A do not appear at hotel B for the same staff member.
13. Assign over capacity succeeds (no server gate).

**D**
14. OOO create opens exactly one `source='ooo'` ticket in the same transaction; a forced handler failure rolls the OOO back (no `room_ooo` row, no `blocked` delta).
15. OOO release stamps `ooo_released_at`; ticket stays open.
16. Room assigned to an arriving stay: OOO still fails closed (`OOO_ROOM_ASSIGNED`) and **no** ticket is written.
17. Nested dispatch (handler appends a subscribed event) does not re-dispatch.
18. Transitions: every illegal one → 409; terminal → `ticket_closed`; cancel without note → 422.
19. Task type snapshot: editing the task type does not change an open ticket's checklist.
20. Assign to a housekeeper-only staff member → rejected; to active maintenance staff → ok.
21. `check:module-manifests` fails on a `subscribes` event nobody publishes.

**SPA:** each tab's query key includes `propertyId` (+ date / filters); every mutation invalidates the consumer key; disabled actions say why; three distinct states (empty / error / no matches) on each new list.

## 11. AGENTS §6 checklist

- [ ] Tenant: URL property only; `roster.set_ops` rejects staff not at the URL property without leaking.
- [ ] Authz: `permission` on every route; `maintenance:*` added to `PERMISSIONS`, `ROLE_GRANTS`, permissions-check; kill-switch = standard `pms.core`.
- [ ] Catalog lanes true (`INTERACTIVE`); routes in `V1_ROUTES` **and** `V1_HTTP_ROUTE_AUDIT`.
- [ ] Idempotency `{ commandId, payload }`, per user, same object hashed and sent.
- [ ] Arrays capped at HTTP and RPC; JSON via the parse helper.
- [ ] `resolvePropertyContext(..., ctx.tenantProperty)` on property routes.
- [ ] Money: none. Inventory ledger: untouched (OOO path unchanged except the subscriber).
- [ ] Errors: one table; `{ ok: false, error }`.
- [ ] SPA: tenant + params in keys; local invalidate; `classifiedUserMessage`; ui-kit; live `property.name`; no inline styles.
- [ ] Tests: two-property cases for inventory and staff ops; no `it.only`.
- [ ] Pins per §9 in each commit; migration `.sql` files regenerated by `property-ddl.mjs`.
- [ ] No Settings control pms-core does not read (task types are read by `create_ticket`).
- [ ] Existing specs searched: room-ops leftover 5, roster leftovers 2 and 7, holes sweep row 5.

## 12. As built

### Part A — Priority (2026-10-30)

- Routes `put_housekeeping_priority` (`PUT …/housekeeping/priority`) and `get_housekeeping_priorities` (`GET …/housekeeping/priorities?date=`). Idempotency key: JSON body `idempotencyKey`, same as `post_housekeeping_assign`; the SPA sends a fresh `crypto.randomUUID()` per change.
- Property schema **37** (`0037_housekeeping_priority.sql`); table in the purge inventory. Pins: commands **96**, routes **154** (last `get_housekeeping_priorities`). `AUDIT_WRITER_COMMAND_IDS` unchanged at 68 — `housekeeping.assign` is not in that set either; the command still writes an audit row.
- In-house is `reservation.status = 'checked_in'`. **Overstay:** a stay still checked in after its departure date is scored `departing` (due out), not `vacant` — fixed on review.
- An arriving booking wins over an in-house stay on the same room for the stay label (turnover: clean for the arrival).
- The manager level badge uses `rung="attention"` on both Board and Priority; other reasons are informational, DND is attention.
- `@hospai/pms-housekeeping` gains a `react-router` peer dependency for the route tabs.

### Part B — Inventory (2026-10-30)

- Routes `post_housekeeping_inventory_item`, `patch_housekeeping_inventory_item`, `post_housekeeping_inventory_adjust`, `get_housekeeping_inventory`, `get_housekeeping_inventory_movements`. Idempotency key: JSON body `idempotencyKey`; SPA sends `crypto.randomUUID()` per attempt.
- Property schema **38** (`0038_housekeeping_inventory.sql`); both tables in the purge inventory. Pins: commands **99**, routes **159** (last `get_housekeeping_inventory_movements`), `AUDIT_WRITER_COMMAND_IDS` **71** — entitled FAIL_CLOSED PropertyDO writers (unlike `set_priority`, which is QUEUE_PROVISIONAL without entitlement).
- Movement `quantity` is always the positive request magnitude; direction is the movement `kind`. Issue stores `quantity = q` with `on_hand -= q`.
- Inventory dialogs use the host `FormDialog` (the existing `.app-modal`), not a second overlay.
- Fixed on review: restoring an archived item re-checks the 200 live-item cap and the live-name rule; editing an archived item no longer collides with a live item's name, and keeps its original `archived_at`. Row actions carry item-specific accessible names (`Receive Bath towels`), and the add form resets fully after a save.
- Known, not fixed here: the shared `FormDialog` does not submit on Enter and has one width, so the history table is narrow. Both are shell-wide; change them in the shell, not per screen.
