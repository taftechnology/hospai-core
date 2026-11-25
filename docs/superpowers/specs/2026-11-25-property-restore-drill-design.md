# Restore one hotel to a point in time (go-live restore drill)

**Date:** 2026-11-25
**Status:** Draft. Built locally behind tests on the defaults below; the owner confirms §7 before it is deployed.
**Roadmap:** go-live checklist, *Operations runbooks* — "one restore drill from DO point-in-time recovery that refuses points before a purge". Research: [PMS SaaS ops console features](../../research/reports/PMS%20SaaS%20ops%20console%20features.md) (restore drill section).
**Sources:** Cloudflare SQLite storage API, PITR section (`getCurrentBookmark`, `getBookmarkForTime`, `onNextSessionRestoreBookmark`, then `ctx.abort()`; 30 days; not available in local dev); [ops platform](./2026-11-22-ops-platform-design.md) (operator commands, `operator_action`, suspend); [purge workflow](./2026-08-12-purge-workflow-design.md) (`purge_certificate`); [R7.4](./2026-11-24-head-office-view-design.md) (`stateVersion` from the outbox sequence).

## 1. What it is

An audited operator action that rewinds **one PropertyDO** to an earlier moment, plus its undo, so a bad deploy or a bad bulk change at one hotel can be reversed, and so the restore can be rehearsed on staging before the first hotel goes live. OrgDO (the guest vault, Form C persons, buyer snapshots) is **not** restorable in v1: rewinding it could bring back erased personal data.

## 2. Preconditions — refused unless all hold

1. The operator is `ops_admin`, gives a reason (1-500) and types the property id to confirm.
2. The hotel's org is **suspended** (`ops.suspend`). Suspension stops staff writes, so nothing races the restore; system work continues and the fence (§4) handles it. Reinstating is the operator's last step.
3. The target time is within the last **29 days** (one day of margin under Cloudflare's 30).
4. **Purge floor:** the target time is later than the newest `purge_certificate.recorded_at` for the org (any kind, any outcome). A restore never lands before a recorded erasure or purge. PropertyDO holds no plaintext PII, but this keeps the rule simple and checkable: no restore crosses a purge.
5. The property is not `purging` / `purged`, and no other restore for it is `pending`.

## 3. Ledger (Platform D1, outside the restored object)

`property_restore` (platform migration), append-mostly:

```
restore_id         TEXT PRIMARY KEY
property_id        TEXT NOT NULL
org_id             TEXT NOT NULL
kind               TEXT NOT NULL CHECK (kind IN ('restore','undo'))
undo_of            TEXT            -- restore_id this undoes (kind = 'undo')
target_time        INTEGER         -- null for an undo
target_bookmark    TEXT NOT NULL
undo_bookmark      TEXT            -- returned by onNextSessionRestoreBookmark
fence_ari_version  INTEGER NOT NULL -- ARI version read just before the restore
fence_outbox_seq   INTEGER NOT NULL -- outbox sequence read just before the restore
status             TEXT NOT NULL CHECK (status IN ('pending','restored','fenced','failed'))
operator_id        TEXT NOT NULL
reason             TEXT NOT NULL
created_at         INTEGER NOT NULL
updated_at         INTEGER NOT NULL
```

Status moves only forward (`pending → restored → fenced`, or `→ failed`), enforced by a trigger like `org_status_transition`. Rows are never deleted. The undo bookmark and reason live here because anything written inside the PropertyDO is rewound by the restore itself.

## 4. Mechanism

**Step A — prepare and arm** (one operator command, `ops.restore_property`):
1. Check §2 in `OpsEntrypoint` (operator, suspension, floor, window, no pending restore).
2. `PropertyDO.prepareRestore({ targetTime | targetBookmark, restoreId })` reads its current ARI version and outbox sequence, resolves the bookmark (`getBookmarkForTime(targetTime)` or the given undo bookmark), calls `onNextSessionRestoreBookmark(bookmark)`, and returns `{ bookmark, undoBookmark, aRIVersion, outboxSeq }`. It then schedules `ctx.abort()` after replying, so the restart applies the restore.
3. Insert the ledger row `pending` with the fence values and the undo bookmark **before** calling the DO (insert first with nulls, update after the DO replies, in that order — if the DO call fails the row goes `failed` and nothing was armed).
4. Write the `operator_action` row (the hotel sees "HospAI restored this hotel to <time>, reason …").

**Step B — fence** (same command, after the restart; retried by the operator if it fails):
`PropertyDO.fenceAfterRestore({ restoreId, minAriVersion, minOutboxSeq })` runs in one `transactionSync`:
- sets the ARI version to `max(current, minAriVersion) + 1`, so no ARI_KV entry written before the restore is ever read as current (a rewound version number would otherwise be reused with different contents);
- raises the outbox `AUTOINCREMENT` counter (`sqlite_sequence`) to at least `minOutboxSeq`, so new events never reuse a sequence number consumers have already seen (R7.4's `stateVersion` and any seq cursor rely on it);
- appends one event `property.restored { propertyId, restoreId, targetTime }` (no reason text);
- is idempotent per `restoreId`.
Ledger → `fenced`.

**Undo:** `ops.restore_property` with `undoOf: <restoreId>` restores to that row's `undo_bookmark`, with the same preconditions except the floor check (undo goes forward in time) and the same fence.

**Consumers of `property.restored`:** `pms.head_office_projection` adds it to its events (re-reads the row). Nothing else in v1.

## 5. What a restore does not fix (runbook, not code)

`docs/runbooks/restore-one-hotel.md` lists them for the operator:
- Events delivered after the target time already changed other stores: the org guest vault, R2 documents and event log, accounting journal exports, Form C submissions, payments taken at the PSP, invoices issued (IRN). The runbook says to reconcile these by hand and to tell the hotel which business dates to re-check.
- ARI_KV: the fence invalidates it; the next availability read rebuilds it.
- Night audit: if the restore crosses a business-date roll, the hotel's open date moves back; the next audit runs from there.

## 6. Ops Console

On the hotel health page, for `ops_admin`: **Restore to a point in time** (date and time in the hotel's time zone, reason, ticket, type the property id) and a **Restores** table from the ledger (time, kind, target, status, operator) with **Undo** on the latest `fenced` restore. The action is disabled with the reason shown when the org is not suspended. Plain-language warning before submit: what is rewound and what is not (§5).

## 7. Decisions for the owner (defaults built)

- **Q-R1 Who may restore.** Default: one `ops_admin` with reason and typed confirmation, on a suspended org. ARCHITECTURE.md §4.9 asks for a second approver on writes into a live hotel; with one operator today that cannot be met (ops spec Q2). Alternative: require a second operator, and block until there is one.
- **Q-R2 Staging only until reviewed?** Default: the command is available in every environment, guarded by the preconditions. Alternative: an env flag `OPS_RESTORE_ENABLED`, on for staging only until the drill has been run once.

## 8. Scope out

OrgDO restore; restoring several hotels at once; automatic reconciliation of derived stores; restoring to before a purge (refused by design); a restore initiated by the hotel.

## 9. Tests

PITR does not run locally, so `PropertyDO` reaches it through a small `PitrPort` (`getBookmarkForTime`, `getCurrentBookmark`, `onNextSessionRestoreBookmark`, `abort`) with the real `ctx.storage` in production and a recording fake in tests.
- Refusals: viewer; not suspended; target older than 29 days; target at or before the newest purge certificate; property purging; a pending restore exists; wrong typed id.
- Happy path with the fake: ledger `pending → restored → fenced`; operator action written; fake saw `onNextSessionRestoreBookmark(bookmark)` then `abort`.
- Fence: ARI version ends above the pre-restore value; the next outbox event's `seq` is above `fence_outbox_seq`; replaying the fence is a no-op; `property.restored` emitted once.
- Undo uses the stored undo bookmark and skips the floor check.
- Ledger triggers refuse backwards status moves and deletes.
- web-admin: the action is hidden for viewers, disabled with the reason when not suspended, and the Undo button appears only on the latest fenced restore.
- Staging rehearsal (manual, after deploy, owner's go): the runbook's drill steps on a staging hotel.

## 10. Pins

`COMMAND_CATALOG` 162 → **163** (`ops.restore_property`), platform D1 migration +1 (`property_restore`), event `property.restored` registered. `V1_HTTP_ROUTE_AUDIT`, `PROPERTY_SCHEMA_HEAD`, `ORG_SCHEMA_HEAD` unchanged (the fence uses existing tables). AGENTS.md pins table updated in the same commit.
