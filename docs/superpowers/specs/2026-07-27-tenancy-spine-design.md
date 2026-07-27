# Tenancy Spine Design

**Date:** 2026-07-27  
**Status:** Approved for Phase 0 foundation (post schema-freeze)  
**Sources:** ARCHITECTURE.md §2, §4.3, §4.5, §14

## Purpose

Make every PropertyDO reachable only through a Platform D1 tenant registry row (immutable jurisdiction) and an OrgDO that mirrors membership + properties. Prove provision → resolve → self-check end-to-end.

## Scope

**In:** Platform D1 `org` + `property` tables; OrgDO (`member`, `property_ref`); provision/resolve through `tenant-router`; `X-Dev-Actor` stub auth.

**Out:** Clerk; OrgEntitlementDO; plans/features/subscriptions; AlarmScheduler/LaneGuard; Queues; `pms.inventory`.

## Invariants (§4.5)

1. Jurisdiction is stored on the registry row at provisioning and is **immutable** (D1 trigger `property_jurisdiction_immutable` + provision-path 409).
2. Every PropertyDO resolution loads jurisdiction from D1 — callers never supply it.
3. First open of a PropertyDO records expected jurisdiction via `setRecordedJurisdiction`.
4. Changing jurisdiction after insert returns **409** and leaves the row unchanged.

## Data model

### Platform D1

- `org(org_id PK, name, status, created_at)`
- `property(property_id PK, org_id FK, name, jurisdiction NULL|eu|us|fedramp, time_zone, status, created_at)`

### OrgDO

- `member(user_id PK, role, created_at)` — roles: `owner` | `admin` | `staff`
- `property_ref(property_id PK, name, jurisdiction, time_zone, status)` — mirror only; routing SoR is D1

## Provisioning

`provisionProperty({ orgId, propertyId, name, jurisdiction, timeZone, actorUserId })`:

1. Validate IANA timezone; derive `locationHint` via `locationHintFromTimeZone`.
2. Upsert org; insert property (reject jurisdiction conflict).
3. OrgDO: upsert `property_ref` + ensure actor in `member`.
4. Open PropertyDO via `resolvePropertyStub` + `setRecordedJurisdiction`.
5. Return `PropertyRecord`.

## Dev auth

Mutating and read `/v1/*` routes require `X-Dev-Actor` **only when** both `HOSPAI_UNSAFE_LOCAL=1` and `HOSPAI_ALLOW_DEV_ACTOR=1` are set (via `.dev.vars`, never top-level wrangler `vars`). Absent those flags, the Worker returns 401. Misconfigured `simulate` / `ALLOW_DEV_ACTOR` without `UNSAFE_LOCAL` returns 500 on every request.

## Success tests

- EU provision → resolve uses jurisdictional path; recorded jurisdiction set
- Conflicting re-provision → 409; row unchanged
- Direct `UPDATE property SET jurisdiction` aborted by trigger
- Null-jurisdiction property works on default namespace
- OrgDO lists `property_ref` after provision
- Worker returns 500 if `simulate` set without `HOSPAI_UNSAFE_LOCAL`
- All `/v1/*` routes require gated `X-Dev-Actor`
