# Housekeeping tasks, room status history and block details (R4.30)

**Date:** 2026-11-20
**Status:** Accepted for implementation
**Roadmap:** R4.30 (Track P). Pilot checklist: *Task assignment to attendants*; *Room status (… with comments)*; *Maintenance / out-of-order blocks*.
**BluePMS page group:** Housekeeping → *Tasks, attendants and maintenance*, *Status and turnaround* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- tasks by date, type, room, attendant, priority, status and supervisor notes;
- search, start, update, complete, review and cancel;
- counters;
- mark dirty with a reason, recorded as a transaction;
- clear dirty with comments;
- blocks with type, start and end time, inspection notes and a release history.

**Sources:**
- The roadmap R4.30 locks.
- [Housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md): `moduleTxnCtx`, unprefixed tables, `staff_…` refs.
- [Room operations / HK completion](./2026-08-12-room-operations-hk-completion-design.md):
  - OOO is the only state that blocks inventory;
  - a full release deletes the `room_ooo` row.
- [Housekeeping core extras](./2026-10-30-housekeeping-core-extras-design.md):
  - task types are catalog data;
  - a ticket never releases a room.
- `check:module-manifests`: pms-core must not write a module-owned table.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Task record.** A new table `housekeeping_task`, owned by `pms.housekeeping` and written only through its use cases via `moduleTxnCtx`.<br>Columns: `task_id`, `business_date`, `task_type` (code), `room_id` (required), `assignee_ref` (`staff_…` or null), `priority` (`low \| normal \| high`), `status`, `notes` (≤ 500), `supervisor_notes` (≤ 500), created, started, completed and reviewed times, the actor of each, and cancel reason. |
| D2 | **Lifecycle.**<br>• `pending` → `in_progress` (start) → `completed` (complete) → `reviewed` (review, with optional supervisor notes).<br>• Cancel is allowed from `pending` or `in_progress`, with a required reason.<br>• Update (type, assignee, priority, notes, date) is allowed only while `pending` or `in_progress`.<br>• Any other move → `422 invalid_task_transition` (a new code in the one status table).<br>Nothing is deleted. |
| D3 | **Task types are a property list.** The DOMAIN key `pms.housekeeping.task_types` holds a list of `{ code, label }`, at most 20, with codes matching `^[a-z][a-z0-9_]{0,31}$`. Defaults: departure clean, stayover clean, deep clean, turndown, inspection. pms-core reads it inside the create/update transaction and refuses an unknown code (`invalid_request`). Settings → Housekeeping edits it with the existing reason-required pattern. |
| D4 | **Relation to `housekeeping.assign`.**<br>• The day's room assignment stays as it is, and the assign screen keeps working.<br>• A task created for a room with no assignee takes that day's assigned attendant, if any, copied at create time.<br>• Assign never creates or changes tasks. There is no auto-generation (auto-assign stays an R1.9 leftover).<br>R4.11 stages and R5.2 hang off this record later. |
| D5 | **Counters and list.** `get_housekeeping_tasks` filters by business date (required), status, assignee, room and a search on room code or notes, capped at 500 rows. It returns counters for that date:<br>• `open` = pending + in progress;<br>• `pending`, `inProgress`, `completed` (completed + reviewed);<br>• `overdue` = pending or in progress with `business_date` < today's business date. Overdue is counted across all earlier dates, so it is not limited to the selected date. |
| D6 | **Room status history.** A new table `room_status_history`, owned by `pms.housekeeping`.<br>Columns: `history_id`, `room_id`, `business_date`, `from_status`, `to_status`, `reason`, `comment`, `source` (`desk \| bulk \| check_out \| room_move \| stay_change \| ooo`), `actor`, `created_at`.<br>The `room` row and its history row are written in the same transaction by one module use case, `recordRoomStatusChange`.<br>• `rooms.update_status` and `rooms.bulk_update_status` gain optional `reason` (≤ 200) and `comment` (≤ 500). **Marking dirty requires a reason** (`reason_required`). Clean or inspected takes an optional comment. Bulk uses one reason and comment for the batch; its cap stays `ROOMS_BULK_STATUS_MAX` (200). Reason and comment join the idempotency payload.<br>• **System changes write history too**, through the same use case with a system actor: checkout's automatic dirty (`markRoomDirtySync`: `check_out`, `room_move`, `stay_change`) and the OOO status flip (`syncOooStatusForRoomSync`: `ooo`). pms-core calls the module use case and does not write the table itself.<br>• A no-op change (same status) writes no row. An idempotent replay writes no new row. |
| D7 | **Block details.** PropertyDO migration 52 adds to `room_ooo`:<br>• `block_type` (`maintenance \| renovation \| deep_clean \| other`, default `maintenance`);<br>• `start_time` and `end_time` (`HH:MM`, optional, display and audit only);<br>• `inspection_notes` (≤ 500).<br>`rooms.set_ooo_range` accepts them. **`availability_day` stays per night.** The OOO → `blocked` rules, the horizon rule and the maintenance consumer are unchanged. `room.ooo_changed` gains `blockType` as an additive payload field. |
| D8 | **Release history and reason.** A new core table `room_ooo_event` (`event_id`, `ooo_id`, `room_id`, `kind` `created \| updated \| released`, `before_json`, `after_json`, `reason`, `actor`, `at`) is written by `trySetOooRange` in the same transaction as every create, edit and release. It **survives a full release**, which still deletes the `room_ooo` row as today.<br>A **release reason is required** (`releaseReason`, 1–200, else `reason_required`) when the edit computes to `released`, or when it moves the end date earlier to on or before the business date (the SPA's release-now partial release). A ticket still never releases a room by itself (Q22). |
| D9 | **Reads:**<br>• `get_room_status_history`: `GET …/rooms/:roomId/status-history`, the newest 100 rows (`housekeeping:read`);<br>• `get_room_ooo_history`: `GET …/rooms/:roomId/ooo-history`, the newest 100 events (`housekeeping:read`).<br>Both are property-scoped through `resolvePropertyContext`. |

## 2. Commands and routes

| Command | Route | Permission |
|---|---|---|
| `housekeeping.create_task` | `post_housekeeping_tasks`: `POST /v1/properties/:propertyId/housekeeping/tasks` | `housekeeping:write` |
| `housekeeping.update_task` | `patch_housekeeping_task`: `PATCH …/housekeeping/tasks/:taskId` | `housekeeping:write` |
| `housekeeping.transition_task` | `post_housekeeping_task_transition`: `POST …/housekeeping/tasks/:taskId/transition`, body `{ action: start \| complete \| review \| cancel, notes?, reason? }` | `housekeeping:write` |
| (read) | `get_housekeeping_tasks`: `GET …/housekeeping/tasks` | `housekeeping:read` |
| (read) | `get_room_status_history` | `housekeeping:read` |
| (read) | `get_room_ooo_history` | `housekeeping:read` |

- The three commands are INTERACTIVE and `pms.core`-entitled, so the kill-switch applies. They are not queued offline. They are idempotent (`{ commandId, payload }`, per user, header `x-idempotency-key`) and audit writers.
- The existing room-status and OOO commands keep their ids, lanes and permissions.

## 3. SPA

- **Housekeeping → Tasks** (a tab beside the existing assign and priority views):
  - counters;
  - filters (date, status, attendant, room, search);
  - a *New task* `Dialog` (type from the property list, room, attendant defaulting per D4, priority, notes);
  - row actions by state: *Start*, *Complete*, *Review* (supervisor notes), *Cancel* (`intent=destructive`, confirm, reason), *Edit* while open;
  - words, never codes, for type, status and priority;
  - error, empty and "no tasks match" are three states.
- **Room status changes:** *Mark dirty* asks for a reason; *Clean* and *Inspected* take an optional comment. Bulk dirty asks once for the batch.
- **History** per room: a `Dialog` listing status changes (from → to, reason or comment, who, or "Checkout" / "Room move" / "Out of order" for system rows, and when). The same goes for blocks on the Maintenance screen: created, extended, released, with reasons.
- **Out of order** (Maintenance screen and wherever OOO is set):
  - block type, optional start and end time, inspection notes;
  - *Release* requires a reason.
- **Settings → Housekeeping:** the task-type list editor.
- **Cache keys:**
  - `['housekeeping-tasks', propertyId, businessDate, filters…]`;
  - `['room-status-history', propertyId, roomId]`;
  - `['room-ooo-history', propertyId, roomId]`.

  Mutations invalidate them plus `['rooms', propertyId]`, `['room-board', …]` (R4.27) and the tape. Tests assert the keys.

## 4. Tests

pms-core (`apps/pms-core/test/housekeeping-tasks.spec.ts`, `room-status-history.spec.ts`):
1. **Task lifecycle:** create → start → complete → review. Complete from `pending` → `invalid_task_transition`. Cancel from `completed` → refused. Update after complete → refused. A create replay → one task. An unknown type → `invalid_request`. The assignee defaults from the day's assignment.
2. **Counters,** including overdue from an earlier date.
3. **Status history:**
   - one desk change → one row with reason/comment and actor; a retry with the same key → no new row;
   - dirty without a reason → `reason_required`;
   - same-status → no row;
   - bulk → one row per changed room;
   - checkout → a `check_out` row with a system actor.
4. **Blocks:**
   - create with type, times and notes;
   - a full release with a reason deletes `room_ooo`, keeps a `released` event and frees `blocked` as today;
   - a release without a reason → `reason_required`;
   - `availability_day` per night unchanged by times.
5. **Tenancy:** two properties in one org; hotel A's task, history and OOO-history reads show no hotel B rows.
6. **`check:module-manifests`:** passes with the new tables owned by `pms.housekeeping` (tasks, history), and `room_ooo_event` in core.

contracts: catalog, routes, audit writers, config key, the error code.

do-runtime: migration 52.

web-pms:
- the task list states and actions;
- the cancel confirm;
- dirty needs a reason;
- the history dialog shows words;
- release needs a reason;
- the settings list;
- the cache keys.

## 5. Pins

- `COMMAND_CATALOG` +3 → **130**.
- `V1_HTTP_ROUTE_AUDIT` +6 → **214**, last id **`get_room_ooo_history`**.
- `AUDIT_WRITER_COMMAND_IDS` +3 → **96**.
- `PROPERTY_SCHEMA_HEAD` **52**.
- Config +1 (`pms.housekeeping.task_types`).
- New tables join the purge inventory, the DDL files and the manifest.
- Update the AGENTS.md pins table.

## 6. Out of scope

- Auto-assign and auto-generated tasks.
- SLA and escalation.
- Attendant mobile capture (R4.10).
- Public-area tasks with no room.
- A supervisor-only review permission.
- Tickets releasing rooms (Q22).
- Time-based availability.
