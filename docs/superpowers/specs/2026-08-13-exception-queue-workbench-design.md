# Exception-queue workbench

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** ARCHITECTURE.md §4.6 (exception queue is a first-class operator screen; replay failures never auto-resolve into money; `issuedAt` is the only authority for business-date attribution; depth is a paged alert), §9 (shell owns degraded watermarks; never show a provisional write as confirmed), §13 (`degraded.exception_queue_depth` pages at > 0), §14 Phase 1 (degraded mode end-to-end: command classes, pending queue, replay, **exception screen**, SPA watermarks), §16.3 / §16.4 (preserve interaction; `ui-kit` is a later slice); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md); [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) leftovers **9** (retry-original) and **10** (full workbench); [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) leftover **10**; [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover **11**; command catalog (`provisional.resolve_exception`); `v1-http-routes.ts` (next free **120**); `apps/pms-core/src/provisional-queue.ts` / `pending-commands-consumer.ts` / `property-do.ts` (`provisional_exception`); `apps/web-pms/src/screens/ExceptionsPanel.tsx` / `shell/nav.ts` / `App.tsx`; [staff management SPA](./2026-08-10-staff-management-spa-design.md) (`GET …/members`); web-interface guidelines

**Closes:** ARCHITECTURE.md §4.6 / §14 Phase 1 **exception screen** (the operator UX still owed in the 2026-07-27c revision note). Night-audit leftovers **9** (re-apply a resolved provisional command — retry is the actuator; resolve stays acknowledge-only) and **10** (filter, retry-original, assign, notes, audit trail, batch, affected-entity links). Tape-chart leftover **10**. Property-setup leftover **11**.

**Amends:** [night-audit E2E](./2026-08-12-night-audit-e2e-design.md) leftovers 9 and 10 (this chunk **closes** them); [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) leftover 10; [property setup SPA](./2026-08-13-property-setup-spa-design.md) leftover 11. Bidirectional pointer: one sentence in those specs when this chunk lands. ARCHITECTURE “Still owed: the exception-queue operator UX” is dropped in the same implementation PR (keep fiscalization as still owed).

---

## 1. Context & Motivation

Degraded-mode replay already lands unresolvable commands in `provisional_exception`. Night audit already refuses to close a date that still has open rows. The operator surface is a shell badge that toggles a list of ids and a Resolve button. Resolve stamps `resolved_at` and does **not** replay. There is no filter, no retry, no assignee, no note, no audit trail on the exception itself, no batch, and no link to the stay / folio / room / guest the command touched.

Architecture §4.6 is explicit: the exception queue is a first-class operator screen, not a dead-letter table. This chunk is that screen. It reuses the table and `provisional.resolve_exception`. It adds the reads and the two-or-three writers the badge cannot fake.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| Table `provisional_exception` | v9 (`property-migrations.ts` ~260–270): `exception_id` PK, `idempotency_key` UNIQUE, `command_type`, `payload` (JSON text), `issued_at`, `business_date`, `reason`, `detail`, `created_at`. v19 ALTER: `resolved_at INTEGER`, `resolved_by TEXT`. **No assignee, no notes column, no retry key.** Already in `PROPERTY_PURGE_INVENTORY_TABLES`. |
| Insert | `PropertyDO.recordProvisionalException` (~2095): `INSERT OR IGNORE` with a fresh `exception_id`. Unique `idempotency_key` ⇒ one row per original queued command. |
| List RPC | `listProvisionalExceptions` (~2118): **open only** (`resolved_at IS NULL`), `ORDER BY created_at DESC`, no filters, no limit. Wire: `exceptionId, idempotencyKey, commandType, payload, issuedAt, businessDate, reason, detail, createdAt, resolvedAt, resolvedBy`. |
| Count RPC | `countProvisionalExceptions` (~2160): `COUNT(*) WHERE resolved_at IS NULL`. Badge uses this. Night-audit status uses a **closing-date** count separately (`business_date = ? AND resolved_at IS NULL`, ~3510). |
| Resolve | Catalog `provisional.resolve_exception` (INTERACTIVE, **FAIL_CLOSED**, idempotent, `night_audit:run`, `pms.core`, event `provisional.exception_resolved`). `tryResolveProvisionalException` stamps `resolved_at` / `resolved_by`, `appendAuditLogSync` (`entityType: 'provisional_exception'`), outbox. Already-resolved + same fingerprint → `{ ok: true, alreadyResolved: true }`. **Not a replay.** Catalog notes say so. |
| Replay consumer | `pending-commands-consumer.ts` `REPLAY_DISPATCH`: `reservations.check_in` / `check_out` / `cancel_check_in` / `update_status`, `folio.add_item`, `rooms.update_status` / `bulk_update_status`, `housekeeping.assign`. Unknown type → exception `unknown_command`. Domain `{ ok: false }` → exception with `reason` (or `business_date_closed`). Terminal ack deletes D1 `pending_command_open`. |
| Idempotency of a failed replay | `runIdempotent` **always inserts** the execute result, including `{ ok: false }`. Retry with the **original** `idempotency_key` returns the cached failure and never re-applies. Night-audit leftover 9 exists because of this. |
| HTTP already shipped | `[18] get_provisional_exceptions` `GET …/provisional-exceptions` (`property:read`, `FAIL_CLOSED`, no `commandId`). `[19] get_provisional_exception_count` `GET …/provisional-exception-count` (same). `[91] post_provisional_exception_resolve` `POST …/provisional-exceptions/:id/resolve` (`night_audit:run`, `provisional.resolve_exception`, `pms.core`). Dispatcher patterns at `v1-dispatch.ts` ~5817 / ~5824 / ~6395. |
| SPA today | `ExceptionsPanel` in `AppShell` side-panels: count badge, toggle inline list of ids, Resolve if `night_audit:run`. `data-testid="exceptions-panel"`. `id="replay-exceptions"`. Night-audit screen links with `<a href="#replay-exceptions">`. **No nav entry. No `/exceptions` route.** |
| Audit log | `GET /v1/properties/:pid/audit-log` (`get_audit_log`, `folio:read`). Filters: actor, shiftId, reservationId, fromAt, toAt. **No `entityType` / `entityId` filter.** Resolve already writes `audit_log` for the exception. |
| Staff picker source | `GET /v1/properties/:pid/members` (`list_property_members`, `staff:read`). OrgDO. Do **not** call OrgDO from a PropertyDO txn. |
| Affected-entity screens | `/folio/:reservationId`, `/check-in/:reservationId`, `/reservations`, `/housekeeping`, `/inventory/rooms`. **No guest CRM page.** `guestRef` hydrates via `POST …/guests/batch`. |
| Catalog / routes / audit | `COMMAND_CATALOG` **74** (`register.test.ts` ~548). `V1_HTTP_ROUTE_AUDIT` indices **0–119**, last `[119] = get_front_desk_stream`. Next free **120**. `AUDIT_WRITER_COMMAND_IDS.size === 49` (includes `provisional.resolve_exception`). `PLATFORM_GAPS = []`. |
| Schema head | `PROPERTY_SCHEMA_HEAD === 24`. Next free **25**. |
| Class denylist / purge / night audit | No new `export class` expected. No new table. `NIGHT_AUDIT_STEPS` length **7**. `REPLAY_COMMAND_IDS` is `Object.keys(REPLAY_DISPATCH)`. |
| `reservations.update_extras` | Catalog `QUEUE_PROVISIONAL` (~822) but **not** in `REPLAY_DISPATCH` — a queued extras update would land as `unknown_command`. Not this chunk’s replay registry expansion (named leftover). |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[119] = get_front_desk_stream` | next **120**; four rows **120–123** |
| `COMMAND_CATALOG` | length **74** | **77** (three writers) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **49** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **24** | **25** (ALTER existing table only) |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | already includes `provisional_exception` | unchanged (no new table) |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Dedicated `/exceptions` workbench: filterable table, detail drawer, affected-entity links, batch resolve/retry, assign, notes, audit trail (§8–§12).
2. `ExceptionsPanel` badge **stays** in the shell; clicking it navigates to `/exceptions`. Inline list + Resolve move off the badge (§12).
3. Widen existing `GET …/provisional-exceptions` with optional filters. Default (no query) remains “all open, uncapped” so shipped tests stay honest (§6).
4. New `GET …/provisional-exceptions/:id` for the row + audit trail + notes (§7).
5. New commands: `provisional.retry_exception`, `provisional.assign_exception`, `provisional.add_exception_note` (§4). Keep `provisional.resolve_exception` acknowledge-only.
6. v25 ALTER of `provisional_exception` for assignee + in-flight retry key. **No new table** (§5).
7. Night-audit “open exceptions” link points at the workbench with the closing date pre-filtered (§12.4).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **Tape chart / live board / WebSockets.** Already shipped. This chunk does not subscribe, broadcast, or invalidate via the front-office socket. Workbench refetches on mutation settle (React Query), same as today’s badge.
- **Property setup / rates / settings SPA.** Already shipped.
- **Guest CRM directory.** No org-wide guest list, no blind-index search. Guest is a `guestRef` chip hydrated by existing batch compose when a reservation id is present.
- **Virtual room types.**
- **Derived / OrgDO rate plans.**
- **`rooms.delete` / archive lifecycle.**
- **`ui-kit` / visual identity** (§16.4). Existing tokens, `statusClass`, `check:web-pms-colors`. No Tailwind, no prototype palette, no `packages/ui-kit`.
- **City ledger / invoices / auto-transfer / recurring charges / partial refunds.**
- **Any PCI / real PSP work.** Payment commands stay `FAIL_CLOSED`; they never enter this queue.
- **Reclassifying existing `get_front_desk_*` (or exception GETs) to `READ_STALE`.** Exception reads stay `FAIL_CLOSED`. There is no KV exception projection.
- **New PropertyDO tables.** Assignee + retry key are ALTERs on `provisional_exception`. Notes and the action trail live in existing `audit_log`.
- **A batch HTTP command.** SPA loops the existing single-id POSTs with distinct idempotency keys (cap 50).
- **Extending `REPLAY_DISPATCH`** with `reservations.update_extras` or any other catalog `QUEUE_PROVISIONAL` id not already dispatched (leftover).
- **Changing resolve into a replay.** Catalog notes stay: acknowledge, not apply.
- **Client-side IndexedDB pending-command UX** beyond the existing `QueuedCommandsPanel`.
- **`entitlement.changed` WebSocket.**
- **Growing `NIGHT_AUDIT_STEPS`.** PRE_CHECK still counts `resolved_at IS NULL` only.
- **Editing / deleting notes.** Append-only.
- **Assigning to roster housekeepers** (`assigneeRef` / `roster.*`). Assignee is a **property membership `userId`**, same grain as `resolved_by`.

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers.** Retry of `folio.add_item` reapplies the stored integer payload. No float on the wire. This chunk does not post, reverse, or display folio balances except via navigation to FolioScreen.
2. **The folio is append-only.** Retry may cause the inner command to insert a new `folio_line`. This chunk never `UPDATE`s `folio_line` amounts. Resolve never writes folio.
3. **Domain code has zero platform imports.**
4. **Every new mutation emits events + audit.** The three new commands and the existing resolve write `audit_log` (`entityType: 'provisional_exception'`) and an outbox event in the same txn as the row change. Notes are audit rows, not a JSON blob that silently replaces history.
5. **Degraded mode never creates an obligation.** All new HTTP reads are `FAIL_CLOSED`. All three new writers are `FAIL_CLOSED`. Retry is a **live** apply while the DO is reachable — it must not `QUEUE_PROVISIONAL` (that would nest a retry of a queued command during another outage). Transport failure → existing 503 body, nothing enqueued.
6. **`runIdempotent` stays sync-only.** Inner `tryCheckIn` / friends are async (permission gate). Retry therefore uses the adapter-outside-txn pattern in §5.2: persist `open_retry_key` first, invoke inner, then stamp. The inner key is deterministic so a crash after apply and before stamp cannot double-post.
7. **Schema.** v25 ALTERs `provisional_exception` only. No new PropertyDO table. `pnpm generate:ddl` produces `migrations/do-property/0025_exception_queue_workbench.sql`. Do not add a covering index; the queue is a paged alert, not a warehouse scan.
8. **No new purge table.** `PROPERTY_PURGE_INVENTORY_TABLES` already names `provisional_exception`. Unchanged.
9. **No new `export class`.** File-local errors mapped to wire codes. Do not add to `CLASS_DENYLIST`.
10. **`NIGHT_AUDIT_STEPS` stays seven.** Open-exception PRE_CHECK continues to count `resolved_at IS NULL` only. Assign / note do not close a row. Retry **success** does (same as resolve).
11. **Route audit append-only.** New routes start at index **120**. `[119] = get_front_desk_stream` does not move. `[18]` / `[19]` / `[91]` stay those ids. `findRoute` is method + first-match — do **not** register `GET …/provisional-exceptions/:id` in a way that shadows the list `$` path (list is exact; detail is one extra segment; both are legal).
12. **New catalog commands** carry lane + degraded + idempotent + events + permission, and `entitlement: 'pms.core'` because they are `FAIL_CLOSED` with events. They go in `AUDIT_WRITER_COMMAND_IDS`.
13. **Resolve is acknowledge-only.** It never invokes `REPLAY_DISPATCH`. Retry is the only apply path from this screen.
14. **Retry never reuses the original `idempotency_key`.** That key already holds the cached `{ ok: false }` (or the successful apply that raced). Inner apply uses `open_retry_key`.
15. **`issuedAt` / `businessDate` on retry are the stored exception values**, not “now”. A closed-date failure retried while that date is still closed fails again — that is honest. The operator uses the stay link + Resolve instead. Do not silently rewrite `businessDate` to the open date.
16. **Guest names never live in PropertyDO or on exception JSON.** `affected.guestRef` only. SPA composes via `POST …/guests/batch`.
17. **PropertyDO does not call OrgDO** to validate `assignedTo`. Assignee is an opaque `userId` string (same as `resolved_by`). The SPA picker is `list_property_members`.
18. **One exception row per original command.** Failed retry updates `reason` / `detail` on the **same** row. Do not `recordProvisionalException` a second row from retry.
19. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
20. **Visual identity is not this chunk.** Existing tokens, `exceptionBadgeSeverity`, `statusClass`, `check:web-pms-colors`. Interaction (filters, retry, assign, notes, batch, links) is the specification; appearance is not.

---

## 3. HTTP routes to append (normative)

Append-only. Do not reorder 0–119. Do not duplicate `[18]` / `[19]` / `[91]`.

| Index | `id` | Method / path | Permission | `commandId` | Entitlement | `degradedRead` |
|---|---|---|---|---|---|---|
| 120 | `get_provisional_exception` | `GET` `/v1/properties/:pid/provisional-exceptions/:id` | `property:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 121 | `post_provisional_exception_retry` | `POST` `/v1/properties/:pid/provisional-exceptions/:id/retry` | `night_audit:run` | `provisional.retry_exception` | `pms.core` | *(omit — writer)* |
| 122 | `post_provisional_exception_assign` | `POST` `/v1/properties/:pid/provisional-exceptions/:id/assign` | `night_audit:run` | `provisional.assign_exception` | `pms.core` | *(omit)* |
| 123 | `post_provisional_exception_note` | `POST` `/v1/properties/:pid/provisional-exceptions/:id/notes` | `night_audit:run` | `provisional.add_exception_note` | `pms.core` | *(omit)* |

Dispatcher patterns (append at **end** of `V1_ROUTES` in **identical order**; method-discriminated):

```
GET   /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)$/
POST  /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/retry$/
POST  /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/assign$/
POST  /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/notes$/
```

Existing, **not** re-appended:

```
GET   /^\/v1\/properties\/([^/]+)\/provisional-exceptions$/          // [18] — widen query params in place
GET   /^\/v1\/properties\/([^/]+)\/provisional-exception-count$/     // [19] — unchanged (open count)
POST  /^\/v1\/properties\/([^/]+)\/provisional-exceptions\/([^/]+)\/resolve$/  // [91]
```

Do **not** add `GET …/provisional-exceptions/workbench` (second list URL). Do **not** nest detail under `/reservations/:id` or `/audit-log`. Do **not** add a batch POST.

Kill-switch: entitled reads follow the existing `entitlementForRoute` pair (402 / 503). Writers follow `invokePropertyDo`. Missing permission → 403 with the table’s permission (`property:read` on GET detail; `night_audit:run` on the three POSTs and existing resolve). Transport failure on GETs → existing `degradedFailClosedReadResponse()`.

`[18]` / `[19]` already carry `degradedRead: 'FAIL_CLOSED'` and `pms.core` is **not** currently on those two audit rows (verified: permission `property:read` only). This chunk does **not** backfill entitlement on `[18]`/`[19]` (append-only honesty; they already 503 on transport). New GET **120** does set `entitlement: 'pms.core'` to match every other entitled property read shipped since the gate.

---

## 4. Command catalog decision (normative)

### 4.1 What existing reads/writes suffice for

| Need | Existing | Decision |
|---|---|---|
| Badge count | `[19]` + `countProvisionalExceptions` | **Reuse.** Open-only. Do not count assigned-but-open differently. |
| Filtered list | `[18]` + `listProvisionalExceptions` | **Widen in place** (§6). No new list route. |
| Acknowledge / drop from PRE_CHECK | `provisional.resolve_exception` / `[91]` | **Reuse unchanged.** Optional note on the resolve body is **rejected** (would change `[91]` fingerprint `{ propertyId, exceptionId }` and mix acknowledge with comment). SPA posts note then resolve when the operator wants both. |
| Audit of resolve | `appendAuditLogSync` already | **Reuse.** Detail GET reads `audit_log` for `entity_type = 'provisional_exception' AND entity_id = ?`. Do not add `entityId` to `get_audit_log` this chunk (that GET is `folio:read`; exception reads are `property:read`). |
| Staff names for the picker | `list_property_members` | **Reuse.** |
| Stay / folio / room / guest navigation | Existing SPA routes + `GET` reservation / folio / rooms / guest | **Reuse.** Workbench only emits links. |

### 4.2 What must be new commands

Resolve cannot replay (`runIdempotent` cached the failure; catalog forbids it). There is no assignee column writer. There is no append-only note writer.

| `id` | Lane / degraded | Permission | Events | Idempotent fingerprint |
|---|---|---|---|---|
| `provisional.retry_exception` | `INTERACTIVE` / **FAIL_CLOSED** | `night_audit:run` | `provisional.exception_retried`; on **success** also `provisional.exception_resolved` with `action: 'retried'` | `{ exceptionId }` |
| `provisional.assign_exception` | `INTERACTIVE` / **FAIL_CLOSED** | `night_audit:run` | `provisional.exception_assigned` | `{ exceptionId, assignedTo }` (`assignedTo` may be `null`) |
| `provisional.add_exception_note` | `INTERACTIVE` / **FAIL_CLOSED** | `night_audit:run` | `provisional.exception_noted` | `{ exceptionId, noteId }` |

`prototypeAction: null` on all three (no prototype workbench). `entitlement: 'pms.core'`. All three join `AUDIT_WRITER_COMMAND_IDS` (49 → **52**). Catalog length 74 → **77**.

`event-consumer.ts` allowlists the three new event types (shape only; still does not call PropertyDO).

**Rejected alternatives**

- One `provisional.update_exception` mega-command — hides retry vs assign vs note in `afterJson`; worse audit.
- Requeue via `enqueueProvisionalCommand` — async, can insert a second exception row, UI cannot show the outcome, and a DO outage would queue a retry of a queued command. Locked: live PropertyDO invoke through shared `REPLAY_DISPATCH`.
- SPA-only notes in `localStorage` — not an audit trail.
- Batch catalog command — N keys, N POSTs, partial failure is per row.

---

## 5. Schema v25 (normative)

Migration name `exception_queue_workbench`. Pin `PROPERTY_SCHEMA_HEAD === 25`.

```sql
ALTER TABLE provisional_exception ADD COLUMN assigned_to TEXT;
ALTER TABLE provisional_exception ADD COLUMN assigned_at INTEGER;
ALTER TABLE provisional_exception ADD COLUMN assigned_by TEXT;
ALTER TABLE provisional_exception ADD COLUMN open_retry_key TEXT;
```

- No CHECK beyond existing table. `assigned_to` NULL = unassigned. `open_retry_key` NULL = no in-flight retry.
- No new index.
- `MemorySql` in `migrate.test.ts` must list the four `ALTER TABLE provisional_exception ADD COLUMN …` prefixes (same pattern as `resolved_at` / `resolved_by`).
- Real-SQLite migration test: apply ≤24, insert an open v9-shaped row, apply 25, `SELECT` the new columns as NULL, then `UPDATE` assignee. Do not rebuild / rename the table (v19 already ALTERed it; stay additive).
- Purge list unchanged. `countPropertyInventoryRows` already counts `provisional_exception`.

**Notes are not a column.** Each `provisional.add_exception_note` inserts `audit_log` only. Detail GET composes `notes[]` from those rows.

---

## 6. List widening — `[18] get_provisional_exceptions`

### 6.1 Query (all optional)

| Param | Meaning | Invalid |
|---|---|---|
| `resolution` | `open` (default) \| `resolved` \| `all` | **400** `{ error: 'invalid_query' }` |
| `commandType` | Exact catalog id | unknown id → **200** empty list (stale deep-links) |
| `reason` | Exact `reason` string | *(any string; empty list if none)* |
| `businessDateFrom` / `businessDateTo` | Inclusive `YYYY-MM-DD` on `business_date` | bad date or from > to → **400** |
| `assigned` | `all` (default) \| `unassigned` \| `assigned` | **400** |
| `assignedTo` | Exact `userId`; implies assigned | *(opaque)* |
| `limit` | 1–200; **omit = no cap** (today’s behaviour) | **400** |
| `cursor` | Opaque `{ createdAt, exceptionId }` | `invalid_cursor` **400** |

No query params at all → **identical to today**: `resolution=open`, no other filters, no limit. `night-audit-precheck` / `degraded-mode` list assertions stay green.

Workbench SPA always sends `limit=50` plus whatever filters are in the URL.

### 6.2 RPC

Widen `listProvisionalExceptions(filters)` — `assertRpcAvailable`, sync SQL, no OrgDO, no lane touch beyond the existing read.

Add `affected` on every item via `affectedFromPayload(commandType, payload)` (§11). Keep `payload` (debug expander). Include `assignedTo`, `assignedAt`, `assignedBy`, `openRetryKey` (null when idle).

Wire list:

```ts
{
  ok: true;
  exceptions: Array<{
    exceptionId: string;
    idempotencyKey: string;
    commandType: string;
    payload: unknown;
    issuedAt: string;
    businessDate: string;
    reason: string;
    detail: unknown | null;
    createdAt: number;
    resolvedAt: number | null;
    resolvedBy: string | null;
    assignedTo: string | null;
    assignedAt: number | null;
    assignedBy: string | null;
    openRetryKey: string | null;
    affected: AffectedRefs;
  }>;
  nextCursor: string | null;
}
```

Empty → `{ ok: true, exceptions: [], nextCursor: null }` (not 404). Order `created_at DESC, exception_id DESC`.

Count GET **unchanged** (open, all dates). Badge is not a filtered count.

---

## 7. Detail — `[120] get_provisional_exception`

404 `{ error: 'not_found' }` if the id is missing (including resolved rows that exist — those are **200**).

RPC `readProvisionalException(exceptionId)`: the list row shape plus:

```ts
{
  ok: true;
  exception: /* list item */;
  actions: Array<{
    at: number;
    actor: string;
    commandId: string;
    action: 'resolved' | 'retried' | 'retry_failed' | 'assigned' | 'noted';
    afterJson: unknown;
  }>;
  notes: Array<{ noteId: string; at: number; actor: string; text: string }>;
}
```

`actions` = `audit_log` rows `entity_type = 'provisional_exception' AND entity_id = ?` `ORDER BY at ASC, seq ASC`. Map `commandId` → `action` (`provisional.resolve_exception` → `resolved`, retry success/fail from `afterJson.ok`, etc.). `notes` = the subset whose `commandId === 'provisional.add_exception_note'`, `text` from `afterJson.text`.

Do not require `folio:read`. Permission is `property:read` so anyone who sees the badge can open a row; writers stay `night_audit:run`.

Missing permission → 403. DO down → 503 `FAIL_CLOSED`.

---

## 8. Retry — `[121]` / `provisional.retry_exception`

### 8.1 Body

```ts
{ idempotencyKey: string }
```

Missing key → 400 `{ error: 'invalid_body' }`. Fingerprint `{ exceptionId }` (propertyId is tenancy, not payload).

### 8.2 Semantics

1. Load the row. Missing → 404 `not_found`. `resolved_at IS NOT NULL` → 422 `{ error: 'already_resolved' }` (not idempotent success — retrying a closed row is a mistake).
2. `command_type` not in `REPLAY_DISPATCH` → 422 `{ error: 'unknown_command' }`. Operator must Resolve.
3. **Crash-safe inner key (normative):**
   - If `open_retry_key` is NULL, in a txn set it to `provisional-retry:${exceptionId}:${crypto.randomUUID()}` (UUID is stored on the row **before** the inner call; it is not regenerated on the next attempt of the *same* in-flight retry).
   - Invoke the **same** `REPLAY_DISPATCH[command_type].invoke` as the consumer, with:
     - actor = the operator (`{ kind: 'user', userId }`), not `REPLAY_ACTOR`
     - payload = `JSON.parse(row.payload)`
     - idempotency `{ key: open_retry_key, fingerprint: fingerprintPayload(payload) }`
     - `ProvisionalContext { issuedAt: row.issued_at, businessDate: row.business_date }`
   - Share the dispatch table. Do **not** fork a second switch in PropertyDO.
4. Inner `{ ok: true }` (including inner `already*` / cached success): txn stamps `resolved_at` / `resolved_by`, clears `open_retry_key`, audit `afterJson: { action: 'retried', resolvedAt, resolvedBy }`, outbox `provisional.exception_retried` then `provisional.exception_resolved` with `{ …, action: 'retried' }`. HTTP **200** `{ ok: true, retried: true }`.
5. Inner `{ ok: false }` (including `business_date_closed`): txn updates `reason` / `detail` on the **same** row, clears `open_retry_key` so the next click mints a new key, audit `afterJson: { action: 'retry_failed', reason, detail }`. **No** second insert. **No** `exception_resolved`. HTTP **422** `{ ok: false, error: <reason>, retried: false }` — the exception stays open.
6. Inner `org_unreachable` → 503 `FAIL_CLOSED` (same as other writers that need OrgDO for the gate); leave `open_retry_key` set so a retry of the **same** outer idempotency key resumes.

Outer `runIdempotent` covers the **stamp** side. Because the inner call is async, the outer key is written after step 4 or 5. A duplicate POST with the same outer key after success returns `{ ok: true }` from the idempotency row (include `retried: true` in that stored response).

### 8.3 Copy lock

Retry control label: **Retry**. Disabled when resolved or `commandType` is not retryable. Tooltip / inline hint: “Reapplies the original command on the original business date. Closed-date failures will fail again — open the stay and Resolve instead.”

Never label retry “Resolve”. Never show a successful retry as anything other than resolved (badge drops).

---

## 9. Assign — `[122]` / `provisional.assign_exception`

Body:

```ts
{ assignedTo: string | null; idempotencyKey: string }
```

`assignedTo` omitted → 400. `null` unassigns. Empty string → 400.

Open row only; resolved → 422 `already_resolved`. Missing → 404.

Sets `assigned_to` / `assigned_at` / `assigned_by` (`assigned_at`/`assigned_by` still stamp on unassign so the trail shows who cleared it; `assigned_to` NULL). Audit + `provisional.exception_assigned` with `{ assignedTo }`.

Same `assignedTo` + same fingerprint → idempotent 200. Reassign to a different person is a **new** idempotency key (SPA mints per click). Different fingerprint on the same key → existing `idempotency_key_reused`.

No OrgDO membership check inside PropertyDO (§2.17).

---

## 10. Note — `[123]` / `provisional.add_exception_note`

Body:

```ts
{ noteId: string; text: string; idempotencyKey: string }
```

Client mints `noteId` (`crypto.randomUUID()`). `text` trimmed; empty → 400. Max **2000** UTF-16 code units → 400 `{ error: 'note_too_long' }`. `noteId` missing → 400.

Allowed on **open and resolved** rows (comment after acknowledge). Missing id → 404.

Does **not** UPDATE `provisional_exception` except via the outer idempotency row. Persistence is `audit_log` `afterJson: { noteId, text }`. Event `provisional.exception_noted`.

Max **50** notes per exception: count audit rows for that entity + command; excess → 422 `{ error: 'note_limit' }`. Duplicate `noteId` + same fingerprint → idempotent 200.

---

## 11. Affected-entity links (normative)

Server helper `affectedFromPayload(commandType, payload): AffectedRefs` — never throws; missing keys are null.

```ts
type AffectedRefs = {
  reservationId: string | null;
  roomId: string | null;
  guestRef: string | null; // filled only when the RPC can read reservation.guest_ref sync; else null
  folioLineId: string | null;
};
```

| `commandType` | Mapping |
|---|---|
| `reservations.check_in` / `check_out` / `cancel_check_in` / `update_status` | `payload.reservationId`; optional `payload.roomId`; `guestRef` from `reservation` if the id exists |
| `folio.add_item` | `payload.reservationId`, `payload.folioLineId` |
| `rooms.update_status` | `payload.roomId` |
| `rooms.bulk_update_status` | `payload.updates[0]?.roomId` (first room; list is in payload expander) |
| `housekeeping.assign` | `payload.roomId` |
| anything else | all null |

SPA one-click targets (use `<Link>`, not `div` onClick):

| Ref present | Href | Label |
|---|---|---|
| `reservationId` | `/folio/:reservationId` | Folio |
| `reservationId` and command is `reservations.check_in` | also `/check-in/:reservationId` | Check-in |
| `roomId` | `/housekeeping` | Room (HK board). Do **not** send operators to `/inventory/rooms` — that route is `inventory:write`. |
| `guestRef` | `/guests/:guestRef` | Hydrated name (batch) or `guestRef`. **Closed 2026-08-13** by [guest CRM directory](./2026-08-13-guest-crm-directory-design.md). |

Omit a control rather than linking to a screen that does not exist.

---

## 12. SPA

### 12.1 Badge — `ExceptionsPanel` stays

Keep `data-testid="exceptions-panel"`, keep the count query, keep fail-closed copy (“Exceptions unavailable — property unreachable”).

**Change:** the badge is a `<Link to="/exceptions">` (Cmd/Ctrl-click works). It does **not** toggle an inline list. Remove Resolve from the panel. Remove the `open` local state and the list query from the panel (workbench owns those).

`id="replay-exceptions"` may remain as a heading anchor; NightAuditScreen must not rely on it (§12.4).

Zero count: still render the badge (`0`), `exception` severity only when count > 0 via existing `exceptionBadgeSeverity`. Do not hide the control.

### 12.2 Nav + route

`nav.ts`: `{ id: 'exceptions', label: 'Exceptions', path: '/exceptions', order: 65, permission: 'property:read' }` (between Night audit 60 and Settings 70).

`App.tsx`: `<Route path="exceptions" element={<ExceptionsScreen />} />`. Anyone with `property:read` (every live shell) can open it. Writer buttons gated `night_audit:run` the same way Resolve is today.

Index `/` stays `/board`.

### 12.3 Workbench — `/exceptions`

URL is the source of truth (`?commandType=&reason=&resolution=&businessDateFrom=&businessDateTo=&assigned=&assignedTo=`). Changing filters `replace`s the query string.

Layout:

- `h1` Exceptions (`text-wrap: balance`).
- Filter bar: command type `<select>` (blank = all, plus every `REPLAY_COMMAND_IDS` value plus any `commandType` present in the current page), reason text input, resolution segmented control (Open / Resolved / All), two `type="date"` labels Business Date From / To, assigned segmented (All / Unassigned / Assigned) + optional assignee select when `staff:read`.
- Table columns (Title Case headers, `tabular-nums` on dates): checkbox, created, business date, command type, reason, assigned, resolution, links, row actions. Long reason `truncate` + `min-w-0`.
- Empty: “No exceptions match these filters.” Fail-closed: error, **not** the empty state.
- Lists > 50: paginate via `cursor` (guidelines: virtualize or paginate; this chunk paginates — the queue is a paged alert, not a 10k-row grid).
- Click a row (not the checkbox) → detail drawer/panel: payload expander, `actions[]` timeline (`Intl.DateTimeFormat` with property time zone), notes list, note `<textarea>` (`autocomplete="off"`), Assign, Retry, Resolve.
- Assign: “Assign to Me” always; full member `<select>` when `list_property_members` succeeds; Unassign. `spellCheck={false}` on ids.
- Batch: selected rows, toolbar **Retry Selected** / **Resolve Selected**. Cap 50. Confirmation modal (never immediate): Resolve copy “Resolve N exceptions without retrying? The original commands will not be applied.” Retry copy “Retry N exceptions? Each reapplies the original command on its original business date.” Partial failure: per-row error; do not abort siblings. Distinct idempotency keys per id (`provisional:retry:${propertyId}:${exceptionId}:${clickNonce}`).
- Submit buttons stay enabled until the request starts; label becomes “Saving…” / “Retrying…” / “Resolving…” during flight.
- Unsaved note: `beforeunload` + in-app guard.
- `aria-live="polite"` on batch/resolve/retry outcome.

`statusClass` / `exceptionBadgeSeverity` for open vs resolved chips. Do not invent `--status-*` pairs without `check:web-pms-colors`.

### 12.4 Night audit link

Replace `<a href="#replay-exceptions">` with `<Link to={/exceptions?resolution=open&businessDateFrom={closing}&businessDateTo={closing}}>`. Same permission visibility as today.

### 12.5 Web-interface guidelines (new chrome)

- Icon-only controls need `aria-label`; decorative icons `aria-hidden`.
- Every filter has a `<label>` or `aria-label`. Checkboxes share a hit target with their row label.
- Visible `:focus-visible` rings; no `outline-none` without replacement.
- `tabular-nums` on counts, dates, ids in the table.
- Loading strings end with `…`. Curly apostrophes in copy.
- Links are `<Link>` / `<a>`.
- Destructive / acknowledge-without-apply needs the confirmation modal (§12.3).
- `overscroll-behavior: contain` on the detail drawer.
- Honor `prefers-reduced-motion`; never `transition: all`.
- `autocomplete="off"` on non-auth fields; `spellCheck={false}` on ids / command types.
- Dates via `Intl.DateTimeFormat` + `usePropertyTimeZone`; never a hardcoded `YYYY/MM/DD` string.
- Command ids / exception ids: `translate="no"`.

---

## 13. File map (acceptance list, not a split mandate)

| Area | Likely paths |
|---|---|
| Route audit | `packages/contracts/src/v1-http-routes.ts` (append **120–123**); `register.test.ts` pins; `[18]` query behaviour documented in tests not a new audit row |
| Catalog | `packages/contracts/src/commands/catalog.ts` (+3); `audit-writers.ts` size **52**; wire codes `already_resolved` / `note_too_long` / `note_limit` in `idempotency.ts` (or existing `NOT_FOUND` reuse where 404) |
| Events | `apps/pms-core/src/event-consumer.ts` allowlist three types |
| Schema | `packages/do-runtime/src/property-migrations.ts` v25; `migrate.test.ts` MemorySql prefixes; `migrations/do-property/0025_exception_queue_workbench.sql` via `pnpm generate:ddl` |
| PropertyDO | widen `listProvisionalExceptions`; `readProvisionalException`; `tryRetryProvisionalException`; `tryAssignProvisionalException`; `tryAddExceptionNote`; `affectedFromPayload`; keep `tryResolveProvisionalException` semantics |
| Consumer | export/share `REPLAY_DISPATCH` for retry; no behaviour change on drain |
| Dispatcher | four handlers; widen `[18]` query parse |
| Tests | `apps/pms-core/test/exception-workbench.spec.ts` (new) + existing degraded-mode / night-audit-precheck stay green |
| client-core | `getProvisionalExceptions(query)`, `getProvisionalException`, `retryProvisionalException`, `assignProvisionalException`, `addProvisionalExceptionNote` |
| Shell / SPA | `nav.ts`; `App.tsx`; `ExceptionsPanel.tsx` (badge-as-link); `ExceptionsScreen.tsx` (new); `NightAuditScreen.tsx` link; tests |
| Pointers | One-sentence amends in night-audit / tape / property-setup specs **when this chunk lands**; ARCHITECTURE still-owed sentence in the same PR |

No `ARCHITECTURE.md` rewrite beyond dropping the exception-queue UX clause from “Still owed” (keep fiscalization). Do not silently skip leftover pointers.

---

## 14. Leftovers folded in (this chunk **does** them)

| # | Item | From |
|---|---|---|
| 1 | Full exception-queue operator UX (filter, assign, notes, audit trail, batch, links) | ARCHITECTURE §4.6 / §14; night-audit leftover **10**; tape leftover **10**; property-setup leftover **11** |
| 2 | Retry-original / re-apply | Night-audit leftover **9**. Resolve stays acknowledge-only; retry is the new command |
| 3 | Badge is the entry point, not the workbench | User requirement; `ExceptionsPanel` remains mounted in `AppShell` |
| 4 | Night-audit closing-date deep link | Replaces `#replay-exceptions` hash |
| 5 | Honest failed-replay idempotency | Documented and designed around (`open_retry_key`); not a silent reuse of the original key |

---

## 15. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | Tape chart / live board / WebSockets | Shipped; no exception deltas on the front-office socket |
| 2 | Property setup / rates / settings rebuild | Shipped |
| 3 | Guest CRM directory | **Closed 2026-08-13** by [guest CRM directory](./2026-08-13-guest-crm-directory-design.md). |
| 4 | Virtual room types | §7.1 |
| 5 | Derived / OrgDO rate plans | §7.2 |
| 6 | `rooms.delete` / unit archive | Rooms-vertical leftover |
| 7 | `ui-kit` / visual identity | §16.4 |
| 8 | City ledger / AR | §7.3 |
| ~~| 9 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md). |
| 10 | Night-audit auto-transfer | Pinned 7 steps |
| 11 | Recurring charges | Prototype-holes leftover 1 |
| 12 | Partial refunds | Folio-money leftover |
| 13 | PCI / real PSP | Simulate stays |
| 14 | Reclass `get_front_desk_*` / exception GETs to `READ_STALE` | No KV projection |
| 15 | `entitlement.changed` WebSocket | Org-scoped |
| 16 | `REPLAY_DISPATCH` + `reservations.update_extras` (and any future `QUEUE_PROVISIONAL` not already dispatched) | Unknown-command path stays; workbench Resolves those |
| 17 | `entityId` filter on `get_audit_log` | Detail GET is the exception trail; folio audit stays `folio:read` |
| 18 | Client-side IndexedDB pending-command durability copy | `QueuedCommandsPanel` unchanged |
| 19 | Year-end `ARCHIVE` prune of `audit_log` | Night-audit leftover 1 |
| 20 | Settlement-file exception queue | Multi-currency leftover; different table / rule |
| 21 | Assign to roster housekeeper refs | Membership `userId` only |
| 22 | Editing / deleting notes | Append-only |
| 23 | Batch HTTP command | SPA loop |
| 24 | New PropertyDO table | Rejected |
| 25 | Rewriting `businessDate` on retry to the open date | Violates §4.6 `issuedAt` rule |

---

## 16. Tests (acceptance-shaped)

**Contracts / register**

1. `V1_HTTP_ROUTE_AUDIT[119].id === 'get_front_desk_stream'`; `[120]='get_provisional_exception'`; `[121]='post_provisional_exception_retry'`; `[122]='post_provisional_exception_assign'`; `[123]='post_provisional_exception_note'`. `[18]`/`[19]`/`[91]` unmoved.
2. `[120]`: `scope:'property'`, no `commandId`, `permission:'property:read'`, `entitlement:'pms.core'`, `degradedRead:'FAIL_CLOSED'`.
3. `[121]`–`[123]`: `commandId` as §3, `permission:'night_audit:run'`, `entitlement:'pms.core'`, no `degradedRead`.
4. `COMMAND_CATALOG` length **77**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`.
5. `PROPERTY_SCHEMA_HEAD === 25`. Purge table list unchanged. `NIGHT_AUDIT_STEPS.length === 7`.

**pms-core — list / detail**

6. No-query `GET /provisional-exceptions` still returns only open rows, uncapped (seed 2 open + 1 resolved → 2).
7. `?resolution=all` returns 3. `?resolution=resolved` returns 1. `?commandType=reservations.check_in` filters. `?businessDateFrom=&businessDateTo=` inclusive. `?assigned=unassigned` hides assigned.
8. `GET …/provisional-exceptions/:id` 200 for resolved; 404 unknown; includes `actions` after a resolve; `affected.reservationId` for a check-in payload.
9. Staff without `night_audit:run` GETs 200; POST retry 403. Actor without `property:read` GET 403. DO down → 503 `FAIL_CLOSED` on 120 and on widened 18.

**pms-core — retry / assign / note / resolve**

10. Seed a `ROOM_ALREADY_ASSIGNED` check-in exception. Retry with the conflict still present → 422, same `exceptionId`, `resolved_at` still NULL, `reason` updated, **no** second row. Clear the conflict, retry with a **new** outer key → 200, row resolved, reservation `checked_in`, events include `provisional.exception_retried` and `provisional.exception_resolved` with `action: 'retried'`.
11. Retry using the **original** queued `idempotency_key` is not offered; asserting the inner key is `open_retry_key` and ≠ original. Crash protocol: set `open_retry_key`, inner already `{ ok: true }` in idempotency, call retry again → resolves, **one** check-in (no double status transition).
12. `business_date_closed` retry while the date is still closed → 422, stays open. Resolve then PRE_CHECK no longer counts it.
13. `unknown_command` retry → 422 `unknown_command`. Resolve still works.
14. Assign user A, list `assignedTo=A` hits, unassign, `assigned=unassigned` hits. Resolved assign → 422 `already_resolved`.
15. Note on open + resolved; empty text 400; 51st note 422 `note_limit`. Detail `notes[]` length 2 after two notes.
16. Resolve still idempotent `alreadyResolved`; still does not apply the original command (check-in stays `confirmed`).
17. `folio.add_item` retry success appends one `folio_line` (integer amount); resolve-without-retry appends zero.

**web-pms**

18. Badge is a link to `/exceptions`; no inline Resolve. `ExceptionsPanel.test.tsx` updated. Fail-closed copy remains. `AppShell.boot.test.tsx` still sees “Replay exceptions” (or updated heading **Exceptions** if copy changes — pick one string and pin it; recommended heading **Exceptions**, keep `data-testid="exceptions-panel"`).
19. Nav order 65; `/exceptions` renders filters from query string; changing resolution writes `?resolution=`.
20. Retry / Resolve / Assign / Note visible iff `night_audit:run`. Confirmation modal before resolve and before batch.
21. Folio `<Link>` present for a check-in row; no guest CRM href.
22. Night-audit closing-date control navigates to `/exceptions?resolution=open&businessDateFrom=…&businessDateTo=…`.
23. `prefers-reduced-motion` / no `transition: all` in new CSS. `check:web-pms-colors` green.

---

## 17. Acceptance / reviewer checklist

- [ ] Four routes appended at **120–123** only; `[119]` / `[18]` / `[19]` / `[91]` unmoved. List filters are query params on `[18]`, not a fifth audit row.
- [ ] Catalog **77**; three new FAIL_CLOSED INTERACTIVE commands with events; audit writers **52**; `PLATFORM_GAPS` [].
- [ ] v25 ALTER four columns on `provisional_exception`; **no new table**; purge list unchanged; `NIGHT_AUDIT_STEPS` 7; no new `export class`.
- [ ] Command decision §4: resolve reused; retry / assign / note new; batch is SPA-only; list/count reused.
- [ ] Retry uses `REPLAY_DISPATCH` + `open_retry_key`; never the original idempotency key; never QUEUE_PROVISIONAL; preserves `issuedAt` / `businessDate`; success resolves; failure updates the same row.
- [ ] Assign + notes + audit trail on the exception (audit_log compose). Notes append-only.
- [ ] Badge stays; click → `/exceptions`. Inline list/resolve removed from the panel.
- [ ] Filters: command type, business date, reason (status), resolution state. Batch resolve/retry with confirmation. One-click folio / check-in / housekeeping links. No guest CRM.
- [ ] Exception reads `FAIL_CLOSED`. No `READ_STALE` reclass. No WebSocket work. No ui-kit.
- [ ] Scope-out §1.3 / §15 named. Folded leftovers §14 and deferred §15 both present. Guidelines §12.5 applied.
- [ ] Tests §16 green in the later implementation plan — this spec does not implement them.
- [ ] ARCHITECTURE “Still owed” exception-queue UX closed in the implementation PR; fiscalization remains.

---

## 18. Open questions (locked)

1. **New commands vs reuse.** **Locked: three new writers** (`retry`, `assign`, `note`). Resolve / list / count reused. Batch is not a command.
2. **Retry via Queue vs live DO.** **Locked: live PropertyDO invoke** through shared `REPLAY_DISPATCH`, `FAIL_CLOSED`. Queue would nest provisionals and could insert a second row.
3. **Original vs new idempotency key.** **Locked: `open_retry_key`.** Original key is a cached failure (`runIdempotent` inserts `{ ok: false }`).
4. **Retry `businessDate`.** **Locked: stored exception values.** Do not coerce to the open date.
5. **Notes storage.** **Locked: `audit_log` only.** No `notes_json` column (avoids in-place history rewrite).
6. **Assignee grain.** **Locked: property membership `userId`.** Not roster `assigneeRef`. No OrgDO validate in PropertyDO.
7. **Badge vs dedicated screen.** **Locked: both.** Badge remains the alert; `/exceptions` is the workbench.
8. **List route vs new workbench GET.** **Locked: widen `[18]`.** Default no-query behaviour is today’s open-uncapped list.
9. **Schema.** **Locked: v25 ALTER, no new table.**
10. **HTTP `degradedRead`.** **Locked: `FAIL_CLOSED` on new GET.** Do not label exception reads `READ_STALE` without a projection.
11. **Permission for assign/note.** **Locked: `night_audit:run`**, same as resolve/retry (exceptions gate PRE_CHECK; one writer gate).
12. **`get_audit_log` entity filter.** **Locked: not this chunk.** Detail GET composes the trail under `property:read`.

---

## 19. Implementation checklist (for the plan author; not a plan)

This section is a spec acceptance outline. **Do not treat it as the implementation plan.** The reviewer approves this spec before any plan or code.

- [ ] Catalog + audit-writers + event allowlist + wire codes; `register.test.ts` pins 77 / 52 / `[120]`–`[123]`.
- [ ] v25 ALTER + `pnpm generate:ddl` + MemorySql prefixes + real-SQLite add-column test.
- [ ] PropertyDO list widen, detail, retry (shared dispatch + `open_retry_key`), assign, note; resolve untouched semantically.
- [ ] Dispatcher `[18]` query parse + four new handlers at end of `V1_ROUTES`.
- [ ] client-core methods; SPA badge-as-link, `/exceptions`, night-audit Link; tests §16.
- [ ] Pointer sentences in the amended specs + ARCHITECTURE still-owed trim in the same PR as the implementation.
- [ ] No plan file and no production code until the reviewer approves this spec.
