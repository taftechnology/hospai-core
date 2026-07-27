# Command Catalog Design

**Date:** 2026-07-27  
**Status:** Approved for Phase 0 schema-freeze  
**Sources:** ARCHITECTURE.md §4.2, §4.6, §10.1; `hospai-pms-prototype/src/context/PMSContext.tsx`

## Purpose

Annotate every prototype `PMSAction` with lane, degraded-mode class, idempotency, and emitted events. This is a **contract** prerequisite (not a PropertyDO schema freeze item).

## Count correction

ARCHITECTURE said “~50”; the prototype has **35** `PMSAction` types. Catalog uses those 35 plus documented **platform gaps** that Phase 1 must add.

## Legend

| Field | Values |
|-------|--------|
| Lane | `INTERACTIVE` \| `BACKGROUND` \| `BULK` \| `SHELL` (not a PropertyDO command) |
| Degraded | `READ_STALE` \| `QUEUE_PROVISIONAL` \| `FAIL_CLOSED` \| `N/A` |
| Idempotent | required on mutating platform commands |

## Catalog (35 prototype actions)

| # | Command id | Prototype | Lane | Degraded | Idem | Events |
|---|------------|-----------|------|----------|------|--------|
| 1 | `shell.set_role` | `SET_ROLE` | SHELL | N/A | no | — |
| 2 | `shell.set_property` | `SET_PROPERTY` | SHELL | N/A | no | — |
| 3 | `reservations.create` | `ADD_RESERVATION` | INTERACTIVE | FAIL_CLOSED | yes | `reservation.created`, `availability.changed` |
| 4 | `reservations.update_status` | `UPDATE_RESERVATION_STATUS` | INTERACTIVE | QUEUE_PROVISIONAL* | yes | `reservation.status_changed` |
| 5 | `reservations.cancel_check_in` | `CANCEL_CHECK_IN` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `reservation.status_changed` |
| 6 | `reservations.assign_room` | `ASSIGN_ROOM` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `reservation.room_assigned` |
| 7 | `reservations.modify` | `MODIFY_RESERVATION` | INTERACTIVE | FAIL_CLOSED | yes | `reservation.modified`, `availability.changed` |
| 8 | `rooms.update_status` | `UPDATE_ROOM_STATUS` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `room.status_changed`, `availability.changed`† |
| 9 | `rooms.bulk_update_status` | `BULK_UPDATE_ROOM_STATUS` | BULK | QUEUE_PROVISIONAL | yes | `room.status_changed` |
| 10 | `housekeeping.assign` | `ASSIGN_HOUSEKEEPER` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `housekeeping.assigned` |
| 11 | `folio.add_item` | `ADD_FOLIO_ITEM` | INTERACTIVE | QUEUE_PROVISIONAL‡ | yes | `folio.line_posted` |
| 12 | `folio.split_charge` | `SPLIT_FOLIO_CHARGE` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `folio.line_posted` (rev+2) |
| 13 | `night_audit.run` | `RUN_NIGHT_AUDIT` | BACKGROUND | FAIL_CLOSED | yes | `night_audit.*` |
| 14 | `channels.sync` | `SYNC_CHANNEL` | BULK | FAIL_CLOSED | yes | `channel.synced` |
| 15 | `channels.add` | `ADD_CHANNEL` | INTERACTIVE | FAIL_CLOSED | yes | `channel.mapping.created` |
| 16 | `audit.append` | `ADD_AUDIT_LOG` | BACKGROUND | QUEUE_PROVISIONAL | yes | `audit.recorded` |
| 17 | `guests.create` | `ADD_GUEST` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `guest.created` |
| 18 | `guests.update` | `UPDATE_GUEST` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `guest.updated` |
| 19 | `rates.create_plan` | `ADD_RATE_PLAN` | INTERACTIVE | FAIL_CLOSED | yes | `rate_plan.changed` |
| 20 | `rates.update_plan` | `UPDATE_RATE_PLAN` | INTERACTIVE | FAIL_CLOSED | yes | `rate_plan.changed` |
| 21 | `rates.delete_plan` | `DELETE_RATE_PLAN` | INTERACTIVE | FAIL_CLOSED | yes | `rate_plan.changed` |
| 22 | `rates.update_room_type_rate` | `UPDATE_ROOM_TYPE_RATE` | INTERACTIVE | FAIL_CLOSED | yes | `rate_plan.changed` |
| 23 | `rates.bulk_update` | `UPDATE_BULK_RATES` | BULK | FAIL_CLOSED | yes | `rate_plan.changed` |
| 24 | `property.update_details` | `UPDATE_PROPERTY_DETAILS` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `property.updated` |
| 25 | `housekeeping.staff_add` | `ADD_HOUSEKEEPER` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `staff.housekeeper_changed` |
| 26 | `housekeeping.staff_status` | `UPDATE_HOUSEKEEPER_STATUS` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `staff.housekeeper_changed` |
| 27 | `housekeeping.staff_delete` | `DELETE_HOUSEKEEPER` | INTERACTIVE | FAIL_CLOSED | yes | `staff.housekeeper_changed` |
| 28 | `housekeeping.staff_update` | `UPDATE_HOUSEKEEPER` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `staff.housekeeper_changed` |
| 29 | `inventory.add_room_type` | `ADD_ROOM_TYPE` | INTERACTIVE | FAIL_CLOSED | yes | `inventory.room_type_changed`, `availability.changed` |
| 30 | `inventory.update_room_type` | `UPDATE_ROOM_TYPE` | INTERACTIVE | FAIL_CLOSED | yes | `inventory.room_type_changed`, `availability.changed` |
| 31 | `inventory.delete_room_type` | `DELETE_ROOM_TYPE` | INTERACTIVE | FAIL_CLOSED | yes | `inventory.room_type_changed` |
| 32 | `staff.add` | `ADD_STAFF` | INTERACTIVE | FAIL_CLOSED | yes | `staff.changed` |
| 33 | `staff.update` | `UPDATE_STAFF` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `staff.changed` |
| 34 | `staff.delete` | `DELETE_STAFF` | INTERACTIVE | FAIL_CLOSED | yes | `staff.changed` |
| 35 | `reservations.update_extras` | `UPDATE_RESERVATION_EXTRAS` | INTERACTIVE | QUEUE_PROVISIONAL | yes | `reservation.modified` |

\* Check-in/out → `QUEUE_PROVISIONAL`; cancel-with-penalty / inventory-affecting status → `FAIL_CLOSED` (platform splits this later).  
† When OOO range changes `blocked`.  
‡ Non-payment folio posts only; payment auth/capture is always `FAIL_CLOSED` (§4.6).

## Platform gaps (not in prototype — Phase 1+)

| Command id | Why required |
|------------|--------------|
| `availability.book` | Ledger decrement in same txn as reservation (§7.1) |
| `rooms.set_ooo_range` | Explicit OOO delta on `blocked` |
| `restrictions.upsert_day` | `restriction_day` ledger |
| `folio.transfer_charge` | Window routing / night-audit auto-transfer |
| `folio.split_charge_v2` | Reverse + two posts (replace mutate-in-place) |
| `config.put_domain` | Write DOMAIN config with `config.changed` |

## Rules

1. `SHELL` commands never hit PropertyDO.
2. Unclassified commands fail closed at the edge.
3. Inventory-consuming commands are `FAIL_CLOSED` in degraded mode.
4. Canonical implementation: `packages/contracts/src/commands/catalog.ts`.
