# Booking sources and market segments — design

**Roadmap:** R1.6 · **Status:** accepted 2026-10-28, shipped · **Date:** 2026-10-28

**Sources:** roadmap R1.6 lock; `ARCHITECTURE.md` §5.1 (config classes and where each lives); [domain-config register](2026-07-27-domain-config-register-design.md) (`pms.property.sources`, `pms.property.market_segments` are declared `OPERATIONAL`); [products catalog](2026-10-28-products-catalog-design.md) (R1.5, for the Settings and module patterns); AGENTS.md *Config that the SPA can save must be read by pms-core or hidden*; prototype `Settings.tsx` Property subtabs.

## 1. Context

The prototype's Settings → Property has six subtabs: amenities, sources, policies, market segments, split inventory and spaces. R1.6 decides what each becomes. Two of them matter now:

- **Booking sources** (walk-in, phone, website, a named OTA, a travel agent) and **market segments** (corporate, leisure, group, government) are the two codes every hotel report and accounting export groups by. Track P needs them: R4.3 records the channel as the source, R4.14's distribution report groups by it, and R4.12 can map revenue by segment.
- None of them exists today. Reservations have no source or segment column. Both keys are declared `OPERATIONAL` in the config register, but **no OPERATIONAL config store exists yet**: the only store is PropertyDO's `property_config`, which holds `DOMAIN` keys.

### 1.1 Scope in

- The first, narrow slice of the **OPERATIONAL config plane** (§2.1): an OrgDO store, one read route and one write command, accepting only the two list keys.
- `sourceCode` and `marketSegmentCode` on the reservation (PropertyDO v36), set on create and editable afterwards.
- Settings → **Sources & segments** tab; optional *Source* and *Segment* selects on the booking screen and the stay's front-office editor.

### 1.2 Scope out — and what happens to the other subtabs

| Prototype subtab | Decision |
|---|---|
| Amenities | **Hidden.** Room types have no amenities field, so the lock's condition ("if inventory already has a field") does not hold. A property amenities checklist has no consumer until the booking engine (R4.2) shows it; saving it now would be a control that changes nothing. R4.2 adds it. |
| Policies | **Hidden** until R1.4 wires the booking keys (roadmap lock). |
| Split inventory | **Hidden** — group allotments are R4.1. |
| Spaces | **Hidden** — meeting rooms are R5.12. |

Also out: reports by source or segment (R4.14), mapping segments to ledgers (R4.12), and validating a reservation's code against the list inside PropertyDO (§2.4).

## 2. Decisions locked

### 2.1 OPERATIONAL config lives in OrgDO, as ARCHITECTURE §5.1 says

§5.1 is explicit that the class decides the storage: `OPERATIONAL` keys live in **OrgDO**, never in PropertyDO. This slice builds the store for property-scoped OPERATIONAL keys and nothing more.

```sql
-- OrgDO migration v10
CREATE TABLE operational_config (
  property_id   TEXT NOT NULL,
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL,
  version       INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  updated_by    TEXT NOT NULL,
  PRIMARY KEY (property_id, key)
);

CREATE TABLE operational_config_audit (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id  TEXT NOT NULL,
  key          TEXT NOT NULL,
  actor        TEXT NOT NULL,
  reason       TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
```

- **Allowlist, not the whole class.** The write accepts only `pms.property.sources` and `pms.property.market_segments`. Every other OPERATIONAL key stays unwritable until a slice gives it a consumer — that keeps the "no dead settings" rule true as the plane grows.
- **Versioned and audited** (§5.1 change management): every write bumps `version`, records actor, before, after and a reason.
- **The KV projection is deferred.** §5.1's read path for OPERATIONAL is a version-keyed KV projection. Here only Settings and the booking form read these lists, so the read goes to OrgDO directly and is `FAIL_CLOSED`. The projection lands when a hot path reads OPERATIONAL config (the booking engine, R4.2). `ARCHITECTURE.md` §5.1 gets a one-line note saying so.
- **Purge:** both tables are org data; the org purge already drops OrgDO storage. The test suite checks rows are gone after purge.

### 2.2 The two list keys get a real schema

Today both keys are `json` with default `[]`. They become a typed list:

```ts
type NamedListEntry = {
  code: string;      // ^[A-Z0-9_]{1,32}$, unique in the list
  name: string;      // trimmed, 1–60
  status: 'active' | 'archived';
};
```

- At most **50 entries** per list (`422 limit_exceeded`).
- **Codes are never removed.** A write that drops a code already stored is rejected (`422 config_code_removed`) — reservations keep the code, so the list must keep resolving it. Retire a code by archiving it.
- The register entries change from `json` to this schema; the `scope` stays `property`.

### 2.3 Routes and command

| Route id | Method + path | Permission | Command |
|---|---|---|---|
| `get_operational_config` | `GET /v1/properties/:pid/operational-config` | `reservations:read` | — (`degradedRead: FAIL_CLOSED`) |
| `put_operational_config` | `PUT /v1/properties/:pid/operational-config/:key` | `settings:configure` | `config.put_operational` |

- `config.put_operational`: INTERACTIVE, FAIL_CLOSED, idempotent, audit writer, event `config.operational_changed` (key, property, version — no values), entitlement `pms.core`. The kill-switch stops it like any entitled write.
- Body: `{ value, reason, idempotencyKey }`, with the JSON-body idempotency key and a `{ commandId, payload }` fingerprint as everywhere else.
- **Tenancy:** the handler calls `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` and uses that row's `orgId` to reach the OrgDO. No org id is read from the body.
- `GET` returns `{ ok, items: [{ key, value, version, source: 'stored' | 'default' }] }` for the two keys. Defaults come from the register (rule 4: tenant rows store overrides only).
- An undeclared key, a key outside the allowlist, or a non-OPERATIONAL key is `400 config_key_not_writable`.

**Pins:** `COMMAND_CATALOG` 94 → **95**; `V1_HTTP_ROUTE_AUDIT` 150 → **152**, last id **`put_operational_config`**; `PROPERTY_SCHEMA_HEAD` 35 → **36**; `ORG_SCHEMA_HEAD` 9 → **10**.

### 2.4 The reservation carries the code; PropertyDO does not check it against the list

```sql
-- PropertyDO migration v36
ALTER TABLE reservation ADD COLUMN source_code TEXT;
ALTER TABLE reservation ADD COLUMN market_segment_code TEXT;
```

- `reservations.create` accepts optional `sourceCode` and `marketSegmentCode`. They join the command payload, so they are fingerprinted.
- They are edited through the existing **front-office update** (`post_reservation_front_office`), next to the VIP, DND and comment fields — not through `reservations.modify`, which is the inventory path and stays as it is.
- PropertyDO validates the **format** only (`^[A-Z0-9_]{1,32}$` or absent). It does **not** read OrgDO to check the code is on the list: OPERATIONAL config changes behaviour, not an invariant (§5.1), and a cross-DO read inside a reservation write is exactly what the architecture forbids. The SPA offers only active codes; the channel connector (R4.3) maps channels to codes; and a code no longer on the list still displays as the raw code.
- Reads that return a reservation (`get_reservation`, the front-desk lists, the directory) include both fields.

### 2.5 SPA

- **Settings → Sources & segments** (`/settings/sources`, behind `settings:configure`): two cards, *Booking sources* and *Market segments*. Each lists code, name and status, with add, rename and archive/restore. A save writes the whole list with a reason. Archived codes stay visible with a Restore button.
- **Booking screen:** optional *Source* and *Market segment* selects listing active entries. They appear only when the list has entries, so an unconfigured property sees no empty controls.
- **Front-office editor** (stay extras on the folio and check-in screens): the same two selects, prefilled; an archived current value shows as "CODE (archived)".
- Query key `['operational-config', propertyId]`; the write invalidates it.

## 3. Feature checklist (AGENTS §6)

- [x] Tenant: org from the resolved property row, never the body.
- [x] Authz: `settings:configure` writes, `reservations:read` reads; `pms.core`; kill-switch applies.
- [x] Catalog with a true lane; both routes in `V1_ROUTES` and `V1_HTTP_ROUTE_AUDIT`.
- [x] Idempotency `{ commandId, payload }`, user-prefixed key.
- [x] Lists capped at 50 at HTTP and in OrgDO.
- [x] `resolvePropertyContext(..., ctx.tenantProperty)`.
- [x] No money, no inventory change.
- [x] Errors through the one table.
- [x] SPA keys include the property; local invalidate; ui-kit; no control without a consumer.
- [x] Pins updated in the same commit.

## 4. Tests

- **OrgDO:** write and read back; version bumps; audit row with before and after; removing a stored code rejected; 51 entries rejected; bad code format rejected; non-allowlisted key rejected; two properties in one org keep separate lists.
- **HTTP:** permissions (staff can read, cannot write); idempotent replay; kill-switch 503; tenancy — a property URL cannot reach another org's OrgDO.
- **PropertyDO:** create with and without the codes; bad format → `422 validation_error`; front-office update sets and clears them; reads return them; v36 applies on a v35 store.
- **SPA:** Settings tab add, rename and archive (whole-list write, invalidation); booking screen shows the selects only with entries and sends the chosen codes; front-office editor round trip.

## 5. Risks

- **Codes are free text on the reservation.** A typo from an API client is stored as given. That is the price of not reading OrgDO inside a reservation write; the SPA and the channel connector only send listed codes, and reports can flag unknown ones.
- **No KV projection yet.** Fine at this read volume; it must exist before the booking engine reads OPERATIONAL config.

## 6. Follow-ons

- KV projection for OPERATIONAL config (R4.2).
- Amenities on room types and the property amenities list (R4.2).
- Reports by source and segment (R4.14); segment-to-ledger mapping (R4.12).
