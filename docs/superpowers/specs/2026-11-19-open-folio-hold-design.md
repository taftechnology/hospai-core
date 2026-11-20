# Open folio — bill on hold (R4.23)

**Date:** 2026-11-19
**Status:** Accepted for implementation
**Roadmap:** R4.23 (Track P). Pilot checklist: *Front-office billing and open folio*.
**Depends:** R1.10 (shared night-audit check evaluator), R1.15 (stay card).
**Sources:**
- The roadmap R4.23 locks.
- ARCHITECTURE.md §7.3 rule 3 and its open-folio amendment.
- AGENTS §2: checkout reads the guest window only; COMPANY / city-ledger AR rules apply.
- `tryCheckOut`: the balance gate on `<res>:GUEST`, `overrideBalance`, and `pms.folio.close_window_on_check_out`.
- `tryAddFolioLine`, which today checks only that the reservation exists and the window is OPEN.
- `tryCloseFolioWindow` / `tryReopenFolioWindow` (`folio:adjust`).
- `evaluateNightAuditChecksSync` / `countNightAuditCheckSync`.
- BluePMS Front Office inventory: *Bill on hold / open folio*.

**Client Q12** (who approves, default dates) is unanswered. This spec ships configurable defaults and a dedicated permission, so the answer is configuration, not code.

---

## 1. Characterize first

Before any production change, add `apps/pms-core/test/open-folio.spec.ts` with a test that **passes on today's code**. It checks out a stay with `overrideBalance` (leaving the guest window OPEN, the default), then `folio.add_item` posts a charge onto it, and that succeeds. The production change then flips that test to expect `checked_out_requires_hold`, with the hold case added.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **A hold is a record on a stay's GUEST window.** It is never a window state and never deleted. There is at most one ACTIVE hold per window, enforced by a partial unique index. History is append-only in `folio_hold_event`. |
| D2 | **Permission `folio:hold`** (new, property-scoped) places, extends and releases holds. It is granted to `admin`, and `owner` gets it through `GRANTABLE_PERMISSIONS`. `staff` does not have it until Q12 says otherwise. **The approver is the acting user**, recorded on the hold; there is no second-person approval flow in this slice. |
| D3 | **Switched on per property.** The DOMAIN key `pms.folio.open_folio` holds `{ enabled: false, followUpDays: 3, closeByDays: 14, autoOpenOnDepartWithBalance: false, autoCloseAtZeroAfterDays: null }`. Ranges: followUpDays 0–60, closeByDays 1–180 (≥ followUpDays), autoCloseAtZeroAfterDays null or 0–30. pms-core reads every field (§4, §6). While `enabled` is false, placing a hold → `422 open_folio_disabled`. Existing holds keep working. |
| D4 | **Post-stay charges.** On a reservation in `checked_out`, a **charge** onto its **GUEST** window is accepted only while that window has an ACTIVE hold; otherwise → `422 checked_out_requires_hold`. The check sits in one helper used by every operator charge path into a GUEST window: `folio.add_item`, and any other command that inserts a positive charge line from the desk (list them in the PR). It does **not** affect payments, refunds, voids, discounts or transfers *out*, so a departed guest can still settle. COMPANY windows are unchanged (AGENTS §2). A **CLOSED** window still refuses with `window_closed` either way (rule 3), and a hold never reopens a window. |
| D5 | **Checkout with an active hold.** If the GUEST window has an ACTIVE hold, the balance gate passes by reference to the hold: no `overrideBalance` is needed, and the audit row records `heldBy: holdId`. `overrideBalance` and its config keep their existing meaning for stays without a hold. `folio.balance_due` is still emitted, with `held: true`. The window stays OPEN; `close_window_on_check_out` only closes at zero, as today. |
| D6 | **Placing a hold** works on `checked_in` (in advance of checkout) or `checked_out`, on an OPEN GUEST window, when no hold is active. The rules:<br>• reason 1–200 (required)<br>• notes ≤ 1000<br>• `followUpDate` ≥ business date<br>• `closeByDate` ≥ `followUpDate` (both default from D3)<br>• `expectedSettlement` ≤ 120<br>Errors: `422 hold_already_active`, `window_closed`, `invalid_request`. |
| D7 | **Extend** changes `followUpDate` and/or `closeByDate` (the same rules) with a required reason. **Release** ends the hold with a required reason (status RELEASED), after which D4 refuses charges again and the balance stays as a departed-with-balance stay. **Closing** is the existing `folio.close_window` at zero balance. In the same transaction it marks the ACTIVE hold CLOSED with a `closed` event. Each mutation writes `audit_log` and a hold event. |
| D8 | **Night-audit checks** (counts only, in the shared evaluator) join `NIGHT_AUDIT_CHECK_IDS` (7 → 10; R4.25 added `arrival_deposit_missing`), each defaulting to `warn`:<br>• `open_folio_unsettled`: ACTIVE holds whose GUEST balance > 0<br>• `open_folio_past_close_by`: ACTIVE holds with `closeByDate` < the closing business date<br>• `open_folio_zero_balance`: ACTIVE holds whose GUEST balance = 0<br>The strict schema, the defaults, the night-audit labels and Settings → Night audit all gain the three rows. `NIGHT_AUDIT_STEPS` does not grow. |
| D9 | **Automation inside an existing step.** Both features below are read from D3 inside the transaction of an existing night-audit step: the one that already does per-reservation end-of-day work. Pick it, name it in the PR, and do not add a step. Each row is caught separately; a failing row is logged and skipped, and the step continues (AGENTS §2).<br>• **Auto-open:** for every stay checked out on the closing business date with GUEST balance > 0 and no ACTIVE hold, place a system hold (`approvedBy: 'system:night_audit'`, reason `auto_open`, default dates).<br>• **Auto-close at zero:** for every ACTIVE hold whose GUEST balance has been 0 for at least `autoCloseAtZeroAfterDays` business days (use the latest line's business date), close the window (`closeFolioWindowSync`) and mark the hold CLOSED. |

## 3. Data model

PropertyDO migration (next head):

```sql
CREATE TABLE folio_hold (
  hold_id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  folio_window_id TEXT NOT NULL,          -- always '<res>:GUEST'
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','RELEASED','CLOSED')),
  reason TEXT NOT NULL,
  notes TEXT,
  follow_up_date TEXT NOT NULL,
  close_by_date TEXT NOT NULL,
  expected_settlement TEXT,
  approved_by TEXT NOT NULL,
  placed_at INTEGER NOT NULL,
  ended_at INTEGER,
  ended_reason TEXT
);
CREATE UNIQUE INDEX folio_hold_one_active ON folio_hold (folio_window_id) WHERE status = 'ACTIVE';
CREATE TABLE folio_hold_event (
  event_id TEXT PRIMARY KEY,
  hold_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('placed','extended','released','closed')),
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
```

Both tables join the purge inventory.

## 4. Commands and routes

| Command | Route | Permission |
|---|---|---|
| `folio.place_hold` | `post_folio_hold`: `POST /v1/properties/:propertyId/reservations/:reservationId/folio-hold` | `folio:hold` |
| `folio.extend_hold` | `post_folio_hold_extend`: `POST …/folio-hold/extend` | `folio:hold` |
| `folio.release_hold` | `post_folio_hold_release`: `POST …/folio-hold/release` | `folio:hold` |
| (read) | `get_folio_hold`: `GET …/folio-hold` returns the active hold (or null) plus its history | `folio:read` |
| (read) | `get_open_folios`: `GET /v1/properties/:propertyId/open-folios`. Lists ACTIVE holds with reservation, room code, departure, GUEST balance, follow-up and close-by dates, and an `overdue` flag. Capped at 200 rows, ordered by close-by date. | `folio:read` |

- Each command is INTERACTIVE, `pms.core`, kill-switch on, idempotent and an audit writer.
- The idempotency key goes in the same place `post_reservation_check_out` uses.
- Fingerprints are `{commandId, payload}` over the object sent.
- New errors go in the one status table, all 422: `open_folio_disabled`, `hold_already_active`, `no_active_hold`, `checked_out_requires_hold`.

## 5. Operator SPA

- **Folio (`FolioScreen`):** an **Open folio** card for `checked_in` and `checked_out` stays.
  - **No hold:** a **Place hold** button (with `folio:hold`, when enabled) opens a `Dialog` with reason, notes, follow-up date and close-by date (prefilled from the defaults), and expected settlement.
  - **Active hold:** the details, history, **Extend** (a `Dialog` with dates and a reason) and **Release** (`intent=destructive`, a confirm with a required reason).
  - **When disabled:** the card says "Open folio is off for this property" with a link to Settings for users who can configure it.
- **Checkout with a hold:** the check-out button reads **Check out on open folio** and skips the "Depart with open balance?" override.
- **Checked-out stay without a hold:** the post-charge controls are disabled with "Place an open-folio hold to post charges after checkout." A server `checked_out_requires_hold` maps to the same copy.
- **Open folios list:** the Folios page gets an **Open folios** section using `get_open_folios`, showing overdue rows with a `Badge` and linking to each folio. It is a working list, not the R4.14 register report.
- **Settings → Folio:** an **Open folio** group with the D3 fields (switch, two day numbers, auto-open switch, auto-close days or blank), saved with the existing reason-required config pattern.
- **Night audit:** the three new check rows show with labels, and each links to the Open folios list.
- **Cache keys:** `['folio-hold', propertyId, reservationId]` and `['open-folios', propertyId]`. Mutations invalidate them plus the folio and board keys. Tests assert the keys.

## 6. Tests (`apps/pms-core/test/open-folio.spec.ts` plus the night-audit specs)

1. The §1 characterization test, flipped: a charge on a checked-out stay without a hold → `checked_out_requires_hold`, and no line is written. With an active hold it posts. A payment on a checked-out stay without a hold still posts.
2. A CLOSED GUEST window refuses a charge with `window_closed`, whether or not a hold is active. Placing a hold on a closed window → `window_closed`. Nothing reopens.
3. Checkout with an active hold and a balance passes without `overrideBalance`, and the audit records the hold. Without a hold and without an override → the existing balance error.
4. Place-hold replay with the same key → one hold. A second active hold → `hold_already_active`.
5. A clerk without `folio:hold` → 403. Placing while `enabled` is false → `open_folio_disabled`.
6. Extend and release write hold events and audit rows. After release a charge is refused again. `folio.close_window` at zero closes the hold.
7. Night audit:
   - a hold past close-by counts in the preview and in PRE_CHECK under `open_folio_past_close_by`;
   - the unsettled and zero-balance counts are right;
   - the severity config accepts the three ids;
   - `NIGHT_AUDIT_STEPS` length is unchanged.
8. Auto-open places a system hold for a departed-with-balance stay. Auto-close closes a zero-balance hold after N days. One failing row does not stop the others.
9. COMPANY windows and city-ledger AR do not change through any hold operation.

web-pms tests:
- the card states;
- the dialogs need a reason;
- Release is destructive with a confirm;
- the checkout label with a hold;
- post-charge disabled after checkout without a hold;
- the open folios list;
- the settings fields;
- the cache keys.

## 7. Pins

- `COMMAND_CATALOG` +3.
- `V1_HTTP_ROUTE_AUDIT` +5, last id `get_open_folios`.
- `PROPERTY_SCHEMA_HEAD` +1.
- `AUDIT_WRITER_COMMAND_IDS` +3.
- `NIGHT_AUDIT_CHECK_IDS` 10.
- Permission `folio:hold` added, with the role grants and the `me.test.ts` mirror updated.
- Config +1 (`pms.folio.open_folio`).
- Update the AGENTS.md pins and the R1.10 night-audit operator spec's check list.

## 8. Out of scope

- Source-module bypass controls.
- A generic document hold.
- POS bill hold (R4.21).
- The open-folio register report (R4.14, Q10).
- Two-person approval (Q12).
- Hold on COMPANY windows.
