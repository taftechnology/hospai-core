# Property-scoped guest and roster lists (R0.4)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 7`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`. **This slice bumps `ORG_SCHEMA_HEAD` → 8** only.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 4](../../audit/2026-09-04-full-codebase-audit.md) (**S2**, **S7**); [Guest CRM directory (shipped)](./2026-08-13-guest-crm-directory-design.md) (OrgDO vault + blind-index CRM — **this slice amends list/search scope**; tags/LTV/merge stay deferred); [Guests / PII vertical](./2026-08-06-guests-pii-vertical-design.md); [Guests + crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md); [Staff roster (shipped)](./2026-08-12-staff-roster-design.md) (OrgDO roster vault; kinds; no `property_id` on `roster` today); [AGENTS.md §1 tenancy](../../../AGENTS.md) (property-URL reads of OrgDO PII must filter to that property); ARCHITECTURE.md §7.6 (shared guest profile in OrgDO; **no PropertyDO → OrgDO calls** on interactive paths); `apps/pms-core/src/org-do.ts` (`listGuests` ~2229, `searchGuests` ~2301, `readGuest` ~2153, `readGuests` ~2186, `listRoster` ~2103, `readRoster` ~2059, `tryCreateGuest` ~1443, `tryUpdateGuest` ~1531, `tryCreateRoster` ~1713); `apps/pms-core/src/v1-dispatch.ts` (`get_guests`, `post_guests_search`, `post_guests_batch`, `get_guest`, `get_roster`, `get_roster_one`, `post_reservations` ~2293); `apps/pms-core/test/guests-routes.spec.ts`; `apps/pms-core/test/roster-routes.spec.ts`; `packages/do-runtime/src/org-migrations.ts`.

**Closes:** Audit **S2** (`guests:read` on a property URL decrypts the org guest book), **S7** (`roster:read` on a property URL decrypts org-wide staff). **Roadmap:** **R0.4**. **Requires:** guest CRM directory + staff roster verticals shipped. **Amends:** [2026-08-13 guest CRM directory spec](./2026-08-13-guest-crm-directory-design.md) — property-URL list/search are **not** org-wide (one explicit sentence in §11). **Does not** advance R0.3/R0.5, R1.8 tags/VIP/merge, P11 decrypt-on-list, Playwright, PropertyDO extraction, or new org-wide CRM routes.

---

## Executive summary

OrgDO as the PII vault is correct (erasure, blind index, shared profile across properties per ARCHITECTURE §7.6). The defect is **read scope**: `listGuests`, `searchGuests`, `readGuest`, `readGuests`, `listRoster`, and `readRoster` use `propertyId` only for `gatePermission`; SQL decrypts **every** org row. A clerk at hotel A with `guests:read` / `roster:read` can see hotel B’s PII today.

This spec locks **property-scoped association tables** on OrgDO — `guest_property (guest_id, property_id)` and `roster_property (staff_id, property_id)` — written on existing property-URL **write** paths and on successful **book** from the Worker (PropertyDO **must not** call OrgDO). List/search **filter SQL to associated ids first, then decrypt the page** (P11 — do not “fix” S2 by decrypting the org faster). GET/batch: no association → **404** `not_found` (GET) or per-id `guest_not_found` in batch (no foreign profile fields). **No new HTTP routes. No new catalog commands.** **OrgDO migration v8** bumps `ORG_SCHEMA_HEAD` 7 → 8. Characterization tests (two properties, same org) land **first** and must fail on current `main`.

---

## Locked product call

1. **Keep property URLs.** Do **not** add org-wide CRM/roster routes this slice. Org-wide CRM remains a future org route (`org:manage` / `guests:org_read`) — out of scope.
2. **S2 guests:** `GET /v1/properties/:propertyId/guests`, `POST …/guests-search`, `GET …/guests/:id`, `POST …/guests/batch` (and any other property-URL guest **read** that decrypts OrgDO PII) return only guests **associated with that property**. Hotel A must not see hotel B’s guest in list, search, GET body, or batch payload.
3. **Association (guests):** OrgDO `guest_property (guest_id, property_id)` PK. Upsert on property-URL **create** and **update**. Worker **book** handlers that set `guestRef` also upsert after successful reservation create (Worker may call OrgDO; **PropertyDO must not call OrgDO** — ARCHITECTURE §7.6). List/search: filter SQL to associated ids first, then decrypt the page. GET/batch: no association → **404** `not_found` (GET) or omit / `guest_not_found` per id in batch. Do not document the mismatch away.
4. **S7 roster:** `GET …/roster` and `GET …/roster/:staffId` must not decrypt org-wide staff. OrgDO `roster_property (staff_id, property_id)` PK. Upsert on property-URL **add** only. List/read filter to that property. Unlinked staff → omitted from list / **404** on GET. Do **not** move roster to `org:manage` this slice.
5. **Tests (fail on current main):** two properties, same org. Guest created/stayed only at hotel B → absent from A list/search/GET/batch; present at B. Same pattern for roster staff added only at B. Extend `guests-routes.spec.ts` and `roster-routes.spec.ts`.
6. **Kill-switch / entitlement:** existing `pms.core` + `guests:read` / `roster:read` unchanged. Handlers use `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`.
7. **No `await` in `transactionSync`.** Index HMAC / vault decrypt stay outside sync tx as today; association upserts are sync SQL inside existing `transactionSync` blocks.
8. **Existing rows:** no magical backfill of every historical guest/staff onto every property. Tests use fresh two-property fixtures. Demo-seed / single-property tenants: association is written on the write paths they already use (`tryCreateGuest`, book, `tryCreateRoster`).
9. **Amends CRM spec** with one explicit sentence: property-URL list/search are **not** org-wide.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Routes** | **No** new HTTP routes. **No** org-wide CRM/roster list routes this slice. |
| **Catalog** | **No** new `COMMAND_CATALOG` ids. Association maintenance is private OrgDO SQL + one Worker-callable OrgDO RPC for book linkage. |
| **S2 reads** | `listGuests`, `searchGuests`, `readGuest`, `readGuests` filter by `guest_property.property_id = ?` before decrypt. |
| **S2 writes** | `tryCreateGuest`, `tryUpdateGuest` upsert `guest_property` in same `transactionSync`. Worker `post_reservations` success + `demo-seed.ts` reservation loop call OrgDO `upsertGuestPropertyAssociation`. |
| **PropertyDO boundary** | PropertyDO **never** calls OrgDO for association. Book linkage is Worker-only. |
| **S7 reads** | `listRoster`, `readRoster` filter by `roster_property.property_id = ?` before decrypt. |
| **S7 writes** | `tryCreateRoster` upsert `roster_property` in same `transactionSync`. PATCH/status/exit do **not** add property links. |
| **GET / batch** | Unassociated guest → **404** `not_found` on GET; batch entry `{ ok: false, guestId, error: 'guest_not_found' }`. Unassociated staff → **404** on GET; omitted from list. |
| **Search algorithm** | Blind-index hit set → **intersect** with `guest_property` for property → sort/page → decrypt page only. **Forbidden:** decrypt-then-filter (P11). |
| **Backfill** | **None.** No migration that copies all guests/staff to all properties. |
| **Schema** | OrgDO **v8** adds `guest_property` + `roster_property`. `ORG_SCHEMA_HEAD` **8**. `PROPERTY_SCHEMA_HEAD` stays **34**. |
| **Perf (P11)** | Keep sequential decrypt of the **page** after SQL filter. Do not parallelize org-wide decrypt. |

---

## 1. Problem / evidence

### 1.1 S2 — `guests:read` lists org-wide PII (high)

**Permission gate only — SQL is org-wide:**

```2248:2276:apps/pms-core/src/org-do.ts
    const permDenied = await this.gatePermission(actor, propertyId, 'guests:read');
    if (permDenied) return permDenied;
    // … entitlement …
    const rows = (
      cursor
        ? this.ctx.storage.sql.exec(
            `SELECT guest_id, created_at FROM guest
             WHERE erased_at IS NULL
               AND (created_at, guest_id) < (?, ?)
             ORDER BY created_at DESC, guest_id DESC
             LIMIT ?`,
            cursor.createdAt,
            cursor.guestId,
            limit,
          )
        : this.ctx.storage.sql.exec(
            `SELECT guest_id, created_at FROM guest
             WHERE erased_at IS NULL
             ORDER BY created_at DESC, guest_id DESC
             LIMIT ?`,
            limit,
          )
    ).toArray() as Array<{ guest_id: string; created_at: number }>;
```

`propertyId` never appears in the query. Same for `searchGuests` (~2320–2368): blind-index hits are org-wide; no `guest_property` join.

**Id-in reads also org-wide:**

```2176:2183:apps/pms-core/src/org-do.ts
    const entry = await this.readGuestEntry(guestId);
    if (entry.ok === false && entry.error === GUEST_NOT_FOUND) {
      return { ok: false, error: GUEST_NOT_FOUND };
    }
    // … decrypt …
    return entry;
```

`readGuest` / `readGuests` (~2210–2225) decrypt any org `guest_id` when the caller has `guests:read` on **any** property in the org.

**HTTP routes (unchanged ids):** `get_guests` ~8412, `post_guests_search` ~8421, `post_guests_batch` ~7875, `get_guest` ~7677 — all property-scoped in URL and permission, org-wide in OrgDO SQL.

**CRM spec assumed org-wide directory:** [2026-08-13 guest CRM directory](./2026-08-13-guest-crm-directory-design.md) shipped list/search on the property URL without a property filter. This slice **corrects** that behaviour; it does not rebuild blind-index, profile, or stay history.

### 1.2 S7 — `roster:read` lists org-wide staff PII (medium)

```2123:2132:apps/pms-core/src/org-do.ts
    const permDenied = await this.gatePermission(actor, propertyId, 'roster:read');
    if (permDenied) return permDenied;
    // … entitlement …
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT staff_id, pii_key_id, profile_cipher, profile_iv, status, exited_at FROM roster ORDER BY staff_id`,
      )
```

`readRoster` (~2085–2086) loads any `staff_id` by PK with no `roster_property` check.

[2026-08-12 staff roster spec](./2026-08-12-staff-roster-design.md) §1.2 explicitly shipped “Phase 1 list is org-wide.” **This slice amends list/read scope only** — the staff **record** stays org-wide in `roster`; property URL gates **which rows decrypt**.

### 1.3 Tests encode single-property happy path (gap)

`apps/pms-core/test/guests-routes.spec.ts` provisions one hotel per case — no two-property same-org isolation. Audit Vertical 4 (~304): add the isolation case. `roster-routes.spec.ts` same gap.

### 1.4 Book path does not link guest to property today

`handlePostReservations` (~2293–2426) commits `guestRef` on PropertyDO but never tells OrgDO the guest is associated with this property. A guest booked only via reservation (never `POST …/guests` at this property) would be invisible in list/search after this slice unless book upserts `guest_property`.

`tryModifyReservation` (~8818) does **not** change `guestRef` — no modify upsert required today. Any future route that mutates `guestRef` must use the same Worker → OrgDO upsert pattern.

---

## 2. Locked behaviour

### 2.1 OrgDO schema v8 (`ORG_SCHEMA_HEAD` 8)

Append migration **v8** `property_pii_association` in `packages/do-runtime/src/org-migrations.ts`:

```sql
CREATE TABLE guest_property (
  guest_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (guest_id, property_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
);

CREATE INDEX guest_property_by_property
  ON guest_property (property_id, guest_id);

CREATE TABLE roster_property (
  staff_id      TEXT NOT NULL,
  property_id   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (staff_id, property_id),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);

CREATE INDEX roster_property_by_property
  ON roster_property (property_id, staff_id);
```

- **No** `property_id` column on `guest` or `roster` parent tables (staff record stays org-wide per roster spec).
- Org churn `deleteAll()` / purge removes these tables with the OrgDO — no separate retention store.
- Run `pnpm generate:ddl`; bump pin in `packages/do-runtime/src/migrate.test.ts`: `ORG_SCHEMA_HEAD === 8`.

### 2.2 Private sync helpers (OrgDO)

Inside `org-do.ts`, add sync helpers callable only from `transactionSync`:

```ts
upsertGuestPropertySync(guestId: string, propertyId: string, now: number): void
  // INSERT OR IGNORE / UPSERT into guest_property

upsertRosterPropertySync(staffId: string, propertyId: string, now: number): void

isGuestLinkedToPropertySync(guestId: string, propertyId: string): boolean

isStaffLinkedToPropertySync(staffId: string, propertyId: string): boolean
```

**Forbidden:** `await` inside these helpers or their callers within `transactionSync`.

### 2.3 Guest association writes

| Path | Where | When |
|---|---|---|
| `POST …/guests` | `tryCreateGuest` ~1482–1518 | After `INSERT INTO guest`, `upsertGuestPropertySync(input.guestId, propertyId, now)` |
| `PATCH …/guests/:id` | `tryUpdateGuest` ~1572–1591 | After profile update, same upsert (establishes link if guest was org-only before) |
| `POST …/reservations` (book) | Worker `handlePostReservations` after `result.ok` | Call new OrgDO RPC (§2.5) with `body.guestRef` |
| Demo seed | `demo-seed.ts` reservation loop ~205+ | Same OrgDO RPC after each successful `tryCreateReservation` |

**Not association writes this slice:** `guests.erase` (org-wide shred), reservation modify/cancel/check-in/out (guest already linked via create or book).

### 2.4 Worker → OrgDO RPC for book linkage

Add OrgDO method (name locked for implementer):

```ts
async upsertGuestPropertyAssociation(
  actor: ActorContext,
  propertyId: string,
  guestId: string,
): Promise<
  | { ok: true }
  | { ok: false; error: typeof GUEST_NOT_FOUND }
  | /* existing gate errors: FORBIDDEN, NOT_MEMBER, ENTITLEMENT_*, ORG_ID_UNSET */
>
```

**Gate:** `gatePermission(actor, propertyId, 'reservations:write')` **or** `guests:write` (either suffices — book actor has `reservations:write`).

**Body:** verify `guest` row exists and `erased_at IS NULL`; else `GUEST_NOT_FOUND`. Then `transactionSync` → `upsertGuestPropertySync`.

**Call sites:** `handlePostReservations` (~2426, success path before `return json(result, 201)`); `demo-seed.ts` after reservation create success.

**Forbidden:** calling from PropertyDO `tryCreateReservation` or any PropertyDO method.

### 2.5 Guest reads (S2)

#### `listGuests`

Replace org-wide `FROM guest` with property-filtered query, preserving cursor semantics:

```sql
SELECT g.guest_id, g.created_at
FROM guest g
INNER JOIN guest_property gp ON gp.guest_id = g.guest_id AND gp.property_id = ?
WHERE g.erased_at IS NULL
  [AND (g.created_at, g.guest_id) < (?, ?)  -- when cursor]
ORDER BY g.created_at DESC, g.guest_id DESC
LIMIT ?
```

Then decrypt page sequentially (unchanged P11 pattern).

#### `searchGuests`

1. `hashesForSearchQuery` + blind-index lookup (unchanged).
2. **Filter `hitIds`:** keep only ids present in `guest_property` for `propertyId` **before** building `liveIds` / sort / page.
3. Decrypt page only.

Equality search remains org-index-backed; property scope is the association intersect, not a second index.

#### `readGuest`

After permission + entitlement gates, **before** `readGuestEntry`:

```ts
if (!this.isGuestLinkedToPropertySync(guestId, propertyId)) {
  return { ok: false, error: GUEST_NOT_FOUND };
}
```

HTTP `get_guest` maps `guest_not_found` → **404** `not_found` (existing mapper).

#### `readGuests` (batch)

For each id: if not linked → `{ ok: false, guestId, error: GUEST_NOT_FOUND }` **without** decrypt. Linked ids use existing `readGuestEntry`. **Forbidden:** returning profile fields for unlinked ids.

Reservation-search name hydrate (~2766–2804) uses `readGuests` — unlinked refs naturally drop from display name resolution at property A.

### 2.6 Roster reads (S7)

#### `listRoster`

Replace `FROM roster ORDER BY staff_id` with:

```sql
SELECT r.staff_id, r.pii_key_id, r.profile_cipher, r.profile_iv, r.status, r.exited_at
FROM roster r
INNER JOIN roster_property rp ON rp.staff_id = r.staff_id AND rp.property_id = ?
ORDER BY r.staff_id
```

Decrypt loop unchanged. HTTP `?kind=` filter (~2061–2063) runs **after** property-scoped list returns.

#### `readRoster`

After gates, before `loadRosterRow` decrypt:

```ts
if (!this.isStaffLinkedToPropertySync(staffId, propertyId)) {
  return { ok: false, error: STAFF_NOT_FOUND };
}
```

### 2.7 Roster association writes

| Path | Where | When |
|---|---|---|
| `POST …/roster` | `tryCreateRoster` ~1763–1773 | After `INSERT INTO roster`, `upsertRosterPropertySync(staffId, propertyId, now)` |

**Not this slice:** `tryUpdateRoster`, status, exit — editing staff at property B does **not** auto-link to B unless they were added there.

### 2.8 HTTP / error contract

| Route id | Change |
|---|---|
| `get_guests` | Response items only associated guests (may be empty page) |
| `post_guests_search` | Hits only associated guests |
| `get_guest` | Unassociated → **404** |
| `post_guests_batch` | Per-id `guest_not_found` for unassociated |
| `get_roster` | Staff list property-scoped |
| `get_roster_one` | Unlinked → **404** |

**No new wire codes.** Use existing `GUEST_NOT_FOUND` / `STAFF_NOT_FOUND` and HTTP table (`not_member` → 404, etc.).

**Handlers:** when touching guest/roster read handlers in this vertical, pass `ctx.tenantProperty` into `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)` per AGENTS.md (F1 threading — do not skip `assertTenantActive`).

### 2.9 Existing data / demo / single-property tenants

- **No backfill migration.** Historical guests/staff appear in list/search only after a write path upserts association (create, update, book, roster add).
- **Single-property orgs:** next create/book/add writes the link; until then list may be empty for pre-v8 data — acceptable; tests use fresh fixtures.
- **Demo seed:** already calls `tryCreateGuest` + reservation create at one `propertyId` — upserts on those paths repopulate association without a special backfill job.

### 2.10 Out of scope reads

| Route | Reason |
|---|---|
| `get_guest_stays` | Already property-scoped via PropertyDO `guest_ref` on **this** property’s reservations |
| `get_reservation_search` | Property-scoped reservation rows; guest hydrate via scoped `readGuests` |
| Org-wide future CRM route | Explicitly deferred |

---

## 3. Implementation steps

**Order: failing characterization tests on `main`, then schema + OrgDO + Worker call sites.**

### 3.1 Tests first (red on `main`)

**`apps/pms-core/test/guests-routes.spec.ts`**

Add helper `provisionTwoHotels(actor)` → `{ orgId, propertyA, propertyB, actor }` (two `postProperty` same org).

- **Add** `two-property isolation: guest at B absent from A list/search/GET/batch`:
  - Create guest at `propertyB` (`POST …/guests` or book with new guest).
  - `GET …/propertyA/guests` → `items` does not contain guest id; no profile fields in JSON.
  - `POST …/propertyA/guests-search` with matching `q` → empty `items`.
  - `GET …/propertyA/guests/:id` → **404**.
  - `POST …/propertyA/guests/batch` `{ refs: [guestId] }` → entry `guest_not_found` or absent profile.
  - Repeat list/search/GET at `propertyB` → guest **present**.
- **Add** `book links guest to property without prior POST /guests`:
  - Mint guest at B only via `POST …/propertyB/guests`.
  - Book at B with `guestRef` → list at B includes guest (regression guard for §2.3 book path).
- **Add** `create at A then update at A: visible at A not B` (optional compact variant of above).

**`apps/pms-core/test/roster-routes.spec.ts`**

- **Add** `two-property isolation: staff added at B absent from A list/GET`:
  - `POST …/propertyB/roster` → `staffId`.
  - `GET …/propertyA/roster` → does not include `staffId`; no decrypted names from B.
  - `GET …/propertyA/roster/:staffId` → **404**.
  - `GET …/propertyB/roster` and `GET …/propertyB/roster/:staffId` → **200**.

Keep all existing single-property tests green.

### 3.2 Schema (`packages/do-runtime`)

1. Add v8 migration statements (§2.1).
2. `pnpm generate:ddl` — commit generated DDL.
3. `migrate.test.ts`: `expect(ORG_SCHEMA_HEAD).toBe(8)`.

### 3.3 OrgDO (`apps/pms-core/src/org-do.ts`)

1. Sync helpers §2.2.
2. `tryCreateGuest` / `tryUpdateGuest` — upsert §2.3.
3. `tryCreateRoster` — upsert §2.7.
4. `upsertGuestPropertyAssociation` RPC §2.4.
5. `listGuests`, `searchGuests`, `readGuest`, `readGuests` — §2.5.
6. `listRoster`, `readRoster` — §2.6.

### 3.4 Worker (`apps/pms-core/src/v1-dispatch.ts`, `demo-seed.ts`)

1. `handlePostReservations`: on success, `org.upsertGuestPropertyAssociation(actor, propertyId, body.guestRef)` — log/ignore `GUEST_NOT_FOUND` only if book succeeded (should not happen; gateGuestRef already ran).
2. `demo-seed.ts`: same call after reservation create in the stay loop.

### 3.5 CRM spec amendment (final task in vertical)

One sentence appended to [2026-08-13 guest CRM directory spec](./2026-08-13-guest-crm-directory-design.md) **Relationship / amends** section:

> **Amended by [2026-09-05 property-scoped lists](./2026-09-05-property-scoped-guest-roster-lists-design.md):** `GET …/guests` and `POST …/guests-search` on a property URL return only guests associated with that property via `guest_property`, not the org-wide vault.

(Spec writer documents here; implementer adds the sentence when the vertical lands.)

---

## 4. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `guests-routes.spec.ts` | Guest created at hotel B only | `GET` list/search/GET/batch at A | Absent / 404 / `guest_not_found` |
| T2 | `guests-routes.spec.ts` | Same guest | List/search/GET at B | Present |
| T3 | `guests-routes.spec.ts` | Book at B with `guestRef` | List at B | Guest linked |
| T4 | `roster-routes.spec.ts` | Staff added at B | `GET` list/one at A | Absent / 404 |
| T5 | `roster-routes.spec.ts` | Same staff | List/one at B | Present |
| T6 | regression | Existing single-property cases | — | Still green |
| T7 | regression | Blind-index search at B | Search at A with same `q` | No cross-property hit |

Tests **T1–T5, T7** must **fail on current `main`**.

---

## 5. Verify commands

**Focused (must fail before fix, pass after):**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/guests-routes.spec.ts \
  test/roster-routes.spec.ts
```

**Pin assertions after implementation:**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG"
```

Expect: `ORG_SCHEMA_HEAD === 8`, `PROPERTY_SCHEMA_HEAD === 34`, `COMMAND_CATALOG.length === 89`, `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'`, `NIGHT_AUDIT_STEPS.length === 8`, `[3] === 'AUTO_TRANSFER'`.

**Full gate:**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**pms-core shards:** never put `--` before `--shard`.

---

## 6. Files in scope

| File | Change |
|---|---|
| `packages/do-runtime/src/org-migrations.ts` | v8 `guest_property`, `roster_property` |
| `packages/do-runtime/src/migrate.test.ts` | `ORG_SCHEMA_HEAD` pin **8** |
| Generated org DDL (via `pnpm generate:ddl`) | v8 statements |
| `apps/pms-core/src/org-do.ts` | Association helpers, read filters, write upserts, book RPC |
| `apps/pms-core/src/v1-dispatch.ts` | Book success → `upsertGuestPropertyAssociation`; `resolvePropertyContext(..., ctx.tenantProperty)` on touched handlers |
| `apps/pms-core/src/demo-seed.ts` | Book loop association upsert |
| `apps/pms-core/test/guests-routes.spec.ts` | Two-property S2 characterization |
| `apps/pms-core/test/roster-routes.spec.ts` | Two-property S7 characterization |
| `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` | One-sentence amend (implementer, when vertical lands) |

**Not in scope:** new routes, catalog entries, PropertyDO migration, SPA changes (list/search consumers unchanged — they already hit property URLs), Playwright, P11 parallel decrypt, org-wide CRM route.

---

## 7. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

**Must change in same vertical:**

| Pin | From → To |
|---|---|
| `ORG_SCHEMA_HEAD` | **7 → 8** |

No new dispatched command. Existing idempotency on `guests.create`, `guests.update`, `roster.add`, `reservations.create` unchanged; association writes are side effects inside those transactions or the book success hook.

---

## 8. Out of scope

- **R0.3** city-ledger AR, **R0.5** per-org HKDF master key (N6)
- **R1.8** tags, VIP, merge, LTV, passport
- **P11** “decrypt the org faster” / parallel org-wide decrypt
- Org-wide CRM or roster routes (`org:manage`, `guests:org_read`)
- Moving roster list behind `org:manage` (rejected — keep property URLs)
- PropertyDO PII columns or PropertyDO → OrgDO calls
- Magical backfill of `guest_property` / `roster_property` for all historical rows
- Playwright / Cypress e2e
- Rebuilding blind-index CRM, guest erase/shred, roster exit semantics
- ARI, purge workflow rebuild, occupancy reservation scan
- `resolvePropertyContext` threading for **unrelated** handlers (only guest/roster reads + book touched in this vertical unless typecheck forces adjacent lines)

---

## 9. Success criteria

1. Two-property same-org test: guest at B only → **absent** from A list, search, GET, batch (**S2** closed).
2. Same test: staff at B only → **absent** from A roster list/GET (**S7** closed).
3. Hotel B list/search/GET includes the guest/staff.
4. Book at property creates `guest_property` row without prior `POST /guests`.
5. Roster add at property creates `roster_property` row.
6. List/search decrypt only the filtered page (SQL filter before decrypt — **P11** respected).
7. `ORG_SCHEMA_HEAD === 8`; other pins unchanged (§7).
8. Existing single-property guest/roster route tests green.
9. `pnpm test:local` green.

---

## 10. Relationship to prior specs

[2026-08-13-guest-crm-directory-design.md](./2026-08-13-guest-crm-directory-design.md) shipped OrgDO vault, blind-index search, directory SPA, profile, and stay history. **This slice amends read scope only** — property URL list/search are **not** org-wide. Tags, VIP, notes, LTV, merge remain deferred in that spec.

[2026-08-12-staff-roster-design.md](./2026-08-12-staff-roster-design.md) shipped org-wide `roster` + `roster_kind` with property-gated permissions. **This slice amends list/read scope** — property URL returns linked staff only; the employment record stays org-wide.

[2026-08-06-guests-pii-vertical-design.md](./2026-08-06-guests-pii-vertical-design.md) and [2026-07-28-guests-crypto-shredding-design.md](./2026-07-28-guests-crypto-shredding-design.md) are unchanged — vault, shred, and property-scoped **routes** remain; association is the missing filter layer.

Audit [Vertical 4](../../audit/2026-09-04-full-codebase-audit.md) locked the product call; this spec is the implementation contract for **R0.4**.

---

## 11. Schema head decision

**Locked:** OrgDO **v8** migration adds `guest_property` and `roster_property` only. **`ORG_SCHEMA_HEAD` → 8.** **`PROPERTY_SCHEMA_HEAD` stays 34.** No PropertyDO tables. Association rows are non-PII linkage metadata; purge/deleteAll removes them with OrgDO.
