# Housekeeping depth, Part B: scored inspections, cleaning stages, guest-count audit (R4.11)

**Date:** 2026-11-20
**Status:** Accepted for implementation (Part B of three)
**Roadmap:** R4.11 Housekeeping depth (Track P). Part A, guest requests, lost and found and cases, is in `5a9f725`. Part C (linen, minibar, amenities) follows.
**BluePMS page groups:** Housekeeping → *Quality and cleaning* and *Guest service and exceptions* ([inventory](../../research/2026-09-12-bluepms-modules.md)):
- **Inspection checklists:** sections, weights, mandatory items and order; templates can be activated and deactivated.
- **Inspection capture:** inspector, attendant, answers, defects, remarks, result, item and overall scores, and history.
- **Cleaning stages:** started, paused, resumed, inspected, completed and released, by task, room, attendant and time.
- **Guest-count audit:** front-office against housekeeping counts by room, floor, type, date and session, with count adjustment, a variance reason, saved evidence and history.

**Sources:**
- The roadmap R4.11 entry (desktop capture first).
- The [R4.30 spec](./2026-11-20-housekeeping-tasks-status-history-design.md): the `housekeeping_task` lifecycle, `recordRoomStatusChange`, and the module pattern.
- The [Part A spec](./2026-11-20-housekeeping-depth-a-requests-lost-found-cases-design.md).
- The existing DOMAIN keys `pms.housekeeping.require_inspection` and `pms.housekeeping.check_in_cleanliness`. Read what they are named and what they do before relying on them.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Inspection templates.** Tables `housekeeping_inspection_template`:<br>• name (≤ 80);<br>• active flag;<br>• pass threshold (integer percent, 0–100, default 80).<br>And `housekeeping_inspection_template_item`:<br>• section (≤ 60);<br>• label (≤ 120);<br>• weight (integer 1–10);<br>• mandatory flag;<br>• sort order.<br>At most 20 templates and 60 items per template, enforced at HTTP and RPC. A template is created, edited (replacing its items as one set) and activated or deactivated through `housekeeping.save_inspection_template`, which needs `settings:configure`. Templates are never deleted. Editing a template does not change past inspections (D2). |
| D2 | **Inspections.** Table `housekeeping_inspection`:<br>• business date;<br>• `room_id`;<br>• optional `task_id` (an R4.30 task for that room);<br>• `template_id`;<br>• inspector (`staff_…`) and attendant (`staff_…` or null);<br>• `answers_json`, a **snapshot** of every template item (section, label, weight, mandatory) with its result (`pass \| fail \| not_applicable`) and an optional defect note (≤ 200);<br>• remarks (≤ 500);<br>• `score_percent`;<br>• `result`.<br>**Score** = Σ weight of passed items / Σ weight of passed + failed items, as a whole percent, rounded half up. Items marked not applicable do not count. When nothing is applicable the score is 100. **Result** is `fail` if any mandatory item failed or the score is below the template threshold, else `pass`. Every item needs an answer (else `invalid_request`). Inspections are never edited or deleted; a re-inspection is a new row. Recorded through `housekeeping.record_inspection` (`housekeeping:write`), only with an active template. |
| D3 | **Cleaning stages on the R4.30 task.**<br>• The task status gains `paused`. New `transition_task` actions:<br>  – `pause`: in progress → paused;<br>  – `resume`: paused → in progress;<br>  – `release`: completed → released, when the room is handed back for sale.<br>• Cancel is also allowed from paused.<br>• Recording an inspection with a `task_id` on a completed task stamps the task's latest inspection and result. The *inspected* stage is that stamp, not a separate status.<br>• **Release** writes the room status through `recordRoomStatusChange` (source `task_release`, with the actor): `inspected` when the task's latest inspection passed, else `clean`. When the property requires inspection (the existing key), release without a passed inspection → `422 inspection_required` (a new code).<br>• An append-only table `housekeeping_task_stage` (`task_id`, `stage` `started \| paused \| resumed \| inspected \| completed \| released`, `at`, `actor`, optional note) is written in the same transaction as each move. It gives times by task, room and attendant.<br>• R4.30's `reviewed` stays as the supervisor review of a completed task. Review and release are independent. |
| D4 | **Guest-count audit.** Tables `housekeeping_guest_audit_session` (business date, status `open \| closed`, started by, closed by and time, notes ≤ 500) and `housekeeping_guest_audit_line`, one per occupied room at start.<br>Each line holds:<br>• the room;<br>• the **front-office counts** snapshotted at start: adults and children summed over that room's `checked_in` stays;<br>• the housekeeping counts (null until counted);<br>• a variance reason (≤ 200, **required when a counted value differs** from front office);<br>• an evidence note (≤ 500, text only; photo capture comes with R4.10);<br>• counted by and time.<br>Re-counting a line replaces its counts and appends to `housekeeping_guest_audit_line_event`, so the count adjustment keeps its history.<br>Commands:<br>• `housekeeping.start_guest_audit`: one open session per business date, else `audit_session_open` (a new 422 code);<br>• `housekeeping.record_guest_audit_count`;<br>• `housekeeping.close_guest_audit`: refused while any line is uncounted, or differs without a reason (`invalid_request`).<br>Correcting the stay's own party size stays the existing in-house stay change; the audit links to the stay, it does not edit it. No names are stored: counts only. |
| D5 | **Reads** (`housekeeping:read`, FAIL_CLOSED, property-scoped, capped at 500):<br>• `get_inspection_templates`;<br>• `get_inspections` (date range, room, result, inspector);<br>• `get_housekeeping_task_stages` (one task's stage history);<br>• `get_guest_audits` (sessions by date range);<br>• `get_guest_audit` (one session with its lines, line events, and totals by floor and room type: front office, housekeeping, variance). |
| D6 | **SPA:**<br>• **Housekeeping → Inspections tab:**<br>  – a list with score and result words and filters;<br>  – a *Record inspection* `Dialog`: room, template, optional task, inspector and attendant, each item as pass / fail / not applicable with a defect note, remarks, and a **live score and result** using the same rule as D2 (shared from contracts);<br>  – a detail view of the snapshot answers.<br>• **Tasks tab:**<br>  – *Pause*, *Resume*, *Inspect* (opens the dialog prefilled with the task) and *Release* actions by state;<br>  – a stage timeline in a task detail `Dialog`;<br>  – release is refused with a clear message when inspection is required and missing.<br>• **Guest audit tab:**<br>  – *Start audit* for the business date;<br>  – rows of room, floor and type, front-office adults and children, and housekeeping count inputs;<br>  – variance highlighted with words;<br>  – reason and evidence fields;<br>  – totals by floor and type;<br>  – *Close audit*;<br>  – past sessions read-only.<br>• **Settings → Housekeeping:** the inspection template editor (sections, items, weight, mandatory, order, threshold, active).<br>Words, never codes. Settled Alerts. Three states (error, empty, no match). Date defaults from the R4.30 business-date hook. |

## 2. Commands, pins

| Command | Route | Permission |
|---|---|---|
| `housekeeping.save_inspection_template` | `post_inspection_template`: `POST …/housekeeping/inspection-templates` | `settings:configure` |
| `housekeeping.record_inspection` | `post_housekeeping_inspection`: `POST …/housekeeping/inspections` | `housekeeping:write` |
| `housekeeping.start_guest_audit` | `post_guest_audit`: `POST …/housekeeping/guest-audits` | `housekeeping:write` |
| `housekeeping.record_guest_audit_count` | `post_guest_audit_count`: `POST …/housekeeping/guest-audits/:sessionId/counts` | `housekeeping:write` |
| `housekeeping.close_guest_audit` | `post_guest_audit_close`: `POST …/housekeeping/guest-audits/:sessionId/close` | `housekeeping:write` |
| (reads) | `get_inspection_templates`, `get_inspections`, `get_housekeeping_task_stages`, `get_guest_audits`, `get_guest_audit` | `housekeeping:read` |

- All commands are INTERACTIVE, `pms.core`-entitled, idempotent (`x-idempotency-key`, `{ commandId, payload }` per user) and audit writers.
- `housekeeping.transition_task` gains the `pause`, `resume` and `release` actions without changing its id.
- Pins:
  - `COMMAND_CATALOG` +5 → **141**;
  - `V1_HTTP_ROUTE_AUDIT` +10 → **234**, last id **`get_guest_audit`**;
  - `AUDIT_WRITER_COMMAND_IDS` +5 → **107**;
  - `PROPERTY_SCHEMA_HEAD` **54** (one migration: the seven new tables);
  - new error codes `inspection_required` and `audit_session_open` (422).
- New tables are owned by `pms.housekeeping`, in the purge inventory and the DDL files. Update the AGENTS.md pins table.

## 3. Tests

pms-core (`apps/pms-core/test/housekeeping-depth-b.spec.ts`):
1. Template save, edit and deactivate; caps; a record against an inactive template is refused.
2. Score rule: weights 3/2/5, one not applicable, rounding half up. A mandatory fail → `fail` at 100 %. Below the threshold → `fail`. All not applicable → 100 and pass.
3. Inspection snapshot: editing the template afterwards leaves the stored answers unchanged.
4. Stages:
   - start → pause → resume → complete → inspect → release writes 5 stage rows plus the inspected stamp;
   - release sets the room `inspected` after a pass and `clean` without an inspection;
   - with inspection required, release without a pass → `inspection_required`;
   - pause from pending → `invalid_task_transition`.
5. Guest audit:
   - start snapshots front-office counts from in-house stays;
   - a second start that day → `audit_session_open`;
   - a different count without a reason → refused; with one → accepted, and a re-count appends an event;
   - close is refused while uncounted;
   - totals by floor and type.
6. Two properties in one org: hotel A's reads show no hotel B rows.

contracts: the shared score function (also used by the SPA), pins and codes.

do-runtime: migration 54.

web-pms and module:
- the template editor;
- the inspection dialog's live score;
- the task stage actions and timeline;
- the audit grid with variance and reason;
- cache keys asserted.

## 4. Out of scope

- Photo evidence and attendant capture (R4.10).
- Auto-creating tasks from inspection defects.
- Linen, minibar and amenities (Part C).
- Reports (R4.14).
- A supervisor-only inspect permission.
