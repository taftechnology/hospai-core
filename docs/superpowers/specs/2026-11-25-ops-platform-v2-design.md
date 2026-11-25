# R7.3 Operations platform v2 — support access and fleet health

**Date:** 2026-11-25
**Status:** Draft for owner review. Not built. §10 lists the decisions only the owner can make.
**Roadmap:** [R7.3](../../roadmap.md) (Track G, Part C, before hotel 3). Locks: [ops spec §12](./2026-11-22-ops-platform-design.md) and `ARCHITECTURE.md` §4.9; this spec does not loosen either.
**Sources:** [ops platform v1](./2026-11-22-ops-platform-design.md) (operators, `operator_action`, `kill:ops.write`, the hotel's "HospAI account changes" card); [R7.4](./2026-11-24-head-office-view-design.md) (`pms.head_office_projection`); [R7.2](./2026-11-22-alerts-paging-log-retention-design.md) (`ops_alert`); [restore drill](./2026-11-25-property-restore-drill-design.md); [kill-switch runbook](../../runbooks/kill-switch.md); research: [PMS SaaS ops console features](../../research/reports/PMS%20SaaS%20ops%20console%20features.md).

## 1. What v2 adds

| Part | What | Needs the owner first? |
|---|---|---|
| **A. Fleet** | Health columns on the customer list, a fleet page per hotel, schema and code version per hotel | No |
| **B. Account fixes** | Owner names (not user ids), search by hotel name, an audited kill-switch command, origin and outcome on the operator log, refused attempts recorded | Q-V3, Q-V4 |
| **C. READ grants** | Time-boxed, reasoned, logged read access to one hotel through a fixed read surface | Q-V1, Q-V2 |
| **D. WRITE grants** | Dual-control, 15-minute grants for one named domain operation | Q2 (second operator) |
| **E. Access review** | The weekly review screen and its sign-off | No |

Build order: A → B → E → C → D. D stays switched off until a second `ops_admin` exists (§4.9 is not weakened for a solo phase; ops spec §12).

## 2. Part A — Fleet health without calling every DO

**Platform D1 `property_fleet_row`** (one row per property; platform migration):
`property_id` PK, `org_id`, `business_date`, `audit_state` (`idle|running|halted`), `audit_failed_step`, `last_completed_date`, `last_completed_at`, `schema_version`, `code_version`, `state_version`, `updated_at`.

- Written by the existing R7.4 consumer `pms.head_office_projection` in the same handler, after the OrgDO write: one D1 upsert guarded by `state_version` (same ordering rule as R7.4). No new consumer, no new event.
- `PropertyDO.readHeadOfficeRow()` gains `schemaVersion` (its applied migration head). `code_version` is the Worker version that handled the event (`CF_VERSION_METADATA` binding, `id` field).
- **Open alerts** per property come from `ops_alert` (R7.2), `status = 'open'`, grouped in SQL.
- **Customer list** gains three columns, all from D1 joins: *Hotels needing attention* (count of properties with `audit_state = 'halted'`, a night audit more than 26 h behind, or an open alert), *Oldest data* (min `updated_at`), *Schema* (min–max `schema_version` across the org's hotels). Still no DO call (ops spec §4).
- **Fleet page** (`/fleet`): one row per property across all customers: customer, hotel, business date, audit state with the step, last completed, open alerts, schema version, code version, updated. Filters: needs attention / all. Sorted with halted and stale first. Paged at 50 like the customer list.
- **Stale hotels:** a hotel that has not run an audit shows its `updated_at` age in words ("not seen for 3 days"). A dormant hotel is not woken to fill the column.

## 3. Part B — Account fixes

1. **Owner names.** Customer detail shows each owner's name and email beside the user id, resolved through Clerk (`pms-core` holds the Clerk secret) by `OpsEntrypoint.getCustomer`, batched, cached for the request only. Clerk failure shows the id with "name unavailable"; it never blocks the page.
2. **Search by hotel name.** The customer list search matches `property.name` as well as org name and id (one `EXISTS` subquery; same escaping).
3. **Audited kill-switch command** `ops.set_kill_switch { featureKey, on, reason, ticketRef? }` (`ops_admin`): writes or deletes `kill:<featureKey>` in `ENTITLEMENT_KV`, records an `operator_action` with `org_id = null`, and the fleet page shows a banner listing every switch that is on. `kill:ops.write` is **not** settable from the console (if operator credentials are suspect, the console is suspect); it stays on the runbook. `kill:support.grants` (§4) is settable. The runbook is updated to prefer the command.
4. **Origin and outcome on the operator log.** `operator_action` gains `origin` (`console` or `system`) and `outcome` (`ok` or the refusal code), and refused writes (bad reason, wrong role, kill-switch, validation) are recorded with `outcome = <code>` instead of leaving no trace. The client IP is **not** stored by default (Q-V4).
5. **Ticket reference.** Stays optional free text until there is a helpdesk (Q-V3). `ARCHITECTURE.md` §4.9 says "required, validated against the helpdesk system"; this spec does not claim that until Q-V3 is answered, and the grant forms (§4, §5) make the ticket **required** but unvalidated.

## 4. Part C — READ grants

**Grant record** (Platform D1 `support_grant`, append-mostly, status only moves forward):
`grant_id`, `org_id`, `property_id` (required for v1: one hotel), `mode` (`READ|WRITE`), `reason`, `ticket_ref` (required), `requested_by`, `approved_by` (WRITE only, never = requested_by, CHECK), `operation` (WRITE only, §5), `status` (`active|expired|revoked|used`), `created_at`, `expires_at` (READ ≤ 60 min, WRITE ≤ 15 min, CHECK), `ended_at`, `read_count`.

- **Request:** `ops.request_read_grant { orgId, propertyId, reason, ticketRef, minutes ≤ 60 }`, self-serve for `ops_admin` and `ops_viewer` (Q-V1). No renewal: a new grant needs a new reason.
- **Use:** every support read RPC (below) takes a `grantId` and checks, in this order: the grant exists, belongs to this operator, matches the URL org and property, is `active`, `now < expires_at`, and `kill:support.grants` is off (read uncached, so a thrown switch voids every grant at once, §4.9 rule 4). Any miss → refused and recorded (§3.4).
- **Read surface** (fixed list, OpsEntrypoint → one PropertyDO or OrgDO, never raw SQL): reservation search by confirmation number or guest name; reservation detail with folio windows and balances; night-audit run detail (steps, status, error text); event-delivery exceptions; housekeeping room states. Guest names are decrypted for display; **card data, ID document numbers, Form C person details and guest documents are never returned** under a grant (Q-V2).
- **Each read is logged** in Platform D1 `support_read` (`grant_id`, `kind`, `record_ref` = an id, never a name, `at`) and increments `read_count`.
- **The hotel sees it.** Grant start, end (expired / revoked / used) and the read count appear in the hotel's **HospAI account changes** card through `get_org_operator_actions` (the grant lifecycle writes `operator_action` rows: `support.grant_started`, `support.grant_ended`). Reason and ticket are shown; record ids are not.
- **Ending a grant:** expiry is evaluated on use; `ops.end_grant` ends it early; `kill:support.grants` voids all.
- **Console:** a "Support" tab on customer detail: request form (hotel, minutes, reason, ticket), a countdown banner while active, the read screens, and "End now".

## 5. Part D — WRITE grants (off until a second operator exists)

- `ops.request_write_grant { orgId, propertyId, operation, reason, ticketRef }` creates a `pending` request; `ops.approve_write_grant { grantId }` by a **different** `ops_admin` makes it `active` for 15 minutes. The approver sees the hotel, operation, reason and ticket. A request not approved in 30 minutes lapses.
- **Operations are domain commands from a fixed allowlist**, run through the same `try*` methods a hotel user would use, with actor `{ kind: 'operator', operatorId, grantId }` and the hotel's own audit trail: v1 list (Q-V5) — retry a failed night-audit step; resolve a night-audit halt; retry an event-delivery exception; release a stuck pending command. One grant = one operation, used once (`status = used`).
- **Solo guard:** while only one `ops_admin` is active, the request button is hidden and the command refuses with `second_operator_required`. The interim rule stands: the hotel adds a named HospAI member (go-live checklist).

## 6. Part E — Weekly access review

`/access-review`: for a chosen week, grants per operator (READ / WRITE), WRITE grants and their tickets, repeat grants against the same hotel (more than 3 in 7 days), refused attempts by code, kill-switch toggles, operator role changes. `ops.record_access_review { weekStart, notes }` signs it off (an `operator_action` with `org_id = null`). The fleet page shows "Access review overdue" when the last sign-off is older than 8 days.

## 7. Security notes

- Grants are internal RBAC in Platform D1, never resolved from a tenant's entitlements (§4.9 rule 3).
- An operator never becomes a tenant member; no grant writes `member` or `property_member` rows.
- Support reads never fan out: one grant, one hotel, one DO per call.
- Break-glass SQL stays outside the platform (ops spec scope out).

## 8. Pins (estimate; final in the build)

`COMMAND_CATALOG` +6 on top of the restore drill's 163 (`ops.set_kill_switch`, `ops.request_read_grant`, `ops.end_grant`, `ops.request_write_grant`, `ops.approve_write_grant`, `ops.record_access_review`). A `version_metadata` binding (`CF_VERSION_METADATA`) is added to pms-core's wrangler config for `code_version`; none exists today. Platform D1 migrations +3 (`property_fleet_row`, `support_grant`, `support_read`) and `operator_action` columns. No `V1_ROUTES` change (operator surface is the console Worker → `OpsEntrypoint`); `get_org_operator_actions` returns the new row kinds. `PROPERTY_SCHEMA_HEAD`, `ORG_SCHEMA_HEAD` unchanged.

## 9. Tests (outline)

Fleet: a halted audit at hotel A shows on the customer list and fleet page with no DO call from the list; ordering by `state_version`. Grants: every refusal in §4's order; a READ grant cannot read another hotel; expiry is hard; `kill:support.grants` voids an active grant on the next call; reads logged without names; the hotel sees start and end. WRITE: approver ≠ requester enforced in SQL and code; solo guard; one use only; the operation writes the hotel's normal audit row with the operator actor. Kill command: cannot set `kill:ops.write`; banner lists active switches. Owner names: Clerk failure degrades to ids.

## 10. Decisions for the owner

- **Q2 (existing) Second operator.** Who and when. Until then Part D stays off.
- **Q-V1 Who may take a READ grant:** `ops_admin` only, or `ops_viewer` too? Draft: both (self-serve, logged).
- **Q-V2 What a READ grant may show:** draft shows guest names, never card data, ID numbers, Form C details or documents. Narrower (no names, search by confirmation number only) is possible.
- **Q-V3 Helpdesk:** which one, and should the ticket be validated against it? Draft: required free text, not validated.
- **Q-V4 Client IP on the operator log:** PCI 10.2.2 lists origin; an IP is personal data. Draft: `origin = console`, no IP. Alternative: a keyed hash of the IP.
- **Q-V5 WRITE allowlist:** the four operations in §5, or a different set.
- **Q-V6 Removing a leaver / resending an invite:** add `ops.remove_org_member` and a Clerk invitation from `ops.add_org_owner` (ops spec Q3) to Part B, or keep them with the hotel's own staff screens.
