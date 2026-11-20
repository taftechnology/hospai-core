# Guest CRM directory

**Date:** 2026-08-13  
**Status:** Approved (reviewer, 2026-08-13)  
**Sources:** ARCHITECTURE.md §4.3 (guest profiles live in OrgDO), §4.6 (`guest lookup` listed `READ_STALE`; shipped guest reads are `FAIL_CLOSED`), §4.8 (events carry `guest_ref` + `pii_key_id`; PII encrypted in OrgDO; erasure = crypto-shred; no raw PII on events), §5 / Rule 13 (events carry PII by reference, never by value), §7.6 (shared guest profile across properties is already correct because profiles live in OrgDO; interactive fan-out across PropertyDOs is forbidden), §7.8 (LTV / trends are warehouse), §14 Phase 1 (rebuild prototype screens against live APIs — guests is a named core-PMS surface), §16.1 (Guests: CRM, tags, VIP, stay history, lifetime value), §16.3 / §16.4 (preserve interaction; `ui-kit` is a later slice), §16.5 (guest substring search has no discovery path until a blind index exists); [guests + crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md); [guests / PII vertical](./2026-08-06-guests-pii-vertical-design.md) (property-scoped routes, org-wide rows, tombstone on `erased_at`, no list/CRM); [booking wizard](./2026-08-11-booking-wizard-design.md) (create-default + `?guestRef=`; destination later = equality blind index, not prototype substring); [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) leftover **2**; [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) leftovers **15** / **21**; [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md) leftover **3** and “no guest CRM href”; command catalog (`guests.create` / `update` / `erase`); `v1-http-routes.ts` (next free **124**); `apps/pms-core/src/org-do.ts`; `packages/do-runtime/src/org-migrations.ts` (`ORG_SCHEMA_HEAD === 6`); `apps/web-pms/src/screens/BookingScreen.tsx` / `guest-row.tsx` / `shell/nav.ts`; web-interface guidelines

**Closes:** ARCHITECTURE.md §14 Phase 1 / §16.3 item 3 for the **staff-facing guest CRM** (org-wide directory + profile + stay history at this property). Prototype-holes leftover **2** (stored blind-index guest discovery). Tape-chart leftovers **15** (blind-index) and **21** (guest CRM directory). Exception-queue leftover **3** (guest CRM page; chips become profile links). Booking-wizard destination “C-with-equality-lookup via blind index”. Guests-PII scope-out “Guest list / CRM beyond `GuestProfile`”.

**Amends:** [prototype holes sweep](./2026-08-13-prototype-holes-sweep-design.md) leftover 2 (this chunk **closes** it); [tape chart + live board](./2026-08-13-tape-chart-live-board-design.md) leftovers 15 and 21; [exception-queue workbench](./2026-08-13-exception-queue-workbench-design.md) leftover 3 and §11 `guestRef` “no CRM href”; [booking wizard](./2026-08-11-booking-wizard-design.md) §2.2 “No search box” / destination C. Bidirectional pointer: one sentence in those specs when this chunk lands. Do **not** rewrite ARCHITECTURE §16.1 tags / LTV as shipped — those stay deferred (§1.3). **Amended by [2026-09-05 property-scoped lists](./2026-09-05-property-scoped-guest-roster-lists-design.md):** `GET …/guests` and `POST …/guests-search` on a property URL return only guests associated with that property via `guest_property`, not the org-wide vault. **Amended by [2026-09-05 per-org HKDF master key](./2026-09-05-per-org-master-key-hkdf-design.md):** blind-index HMAC key is HKDF-derived per org, not platform-wide.

---

## 1. Context & Motivation

Staff can create a guest and book them. They cannot look the guest up again except by already holding the `guestRef`. `GET …/guests/:id` and `POST …/guests/batch` are **id-in, decrypt-out**. The booking wizard always mints a new guest unless the URL already carries `?guestRef=`. Front-desk chips hydrate names for reservation-linked rows and go nowhere. Reservation-search name hits decrypt at most 200 stay guests at **this** property — they are not an org-wide CRM and they are not a stored index.

ARCHITECTURE §4.8 / §5 / §7.6 already chose the storage: profiles live in OrgDO, encrypted under a per-guest data key; PropertyDO stores `guest_ref` only; shared-across-properties is free because the vault is org-scoped. What is missing is the **discovery** path that does not put plaintext name / email / phone on PropertyDO and does not `SELECT * FROM guest` and decrypt the org.

This chunk is that path: a staff CRM directory, a profile screen, equality blind-index search, property-scoped stay history, and the small link/wizard leftovers that make “returning guest” a click instead of a re-create.

### 1.1 What already exists (verified against the tree — do not re-spec)

| Piece | Where (verified) |
|---|---|
| OrgDO `guest` vault | v2 (`org-migrations.ts` ~55–64): `guest_id` PK, `pii_key_id`, `profile_cipher`, `profile_iv`, `erased_at`, `created_at`, `updated_at`. **No name / email / phone columns. No index table.** |
| `data_key` | Same migration: per-subject wrapped key, `scope IN ('guest','staff')`, shred = `wrapped_key = x''` + `shredded_at`. |
| `GuestProfile` | `packages/crypto-shredding/src/types.ts`: `{ displayName: string; email?: string; phone?: string }`. **No consent, tags, VIP, notes, LTV, passport.** |
| Vault | `PiiVault` AES-GCM envelope. `importMasterKeyHex` imports `HOSPAI_ORG_MASTER_KEY` as **non-extractable** AES-GCM wrap/unwrap only — cannot HMAC from that `CryptoKey`. No blind-index helper today. |
| Writers | `tryCreateGuest` / `tryUpdateGuest` / `tryEraseGuest` (`org-do.ts` ~1299–1501). Hybrid idempotency. Events `{ orgId, guestRef, piiKeyId }` — no PII. Erase shreds key, sets `erased_at`, does **not** scan PropertyDO. |
| Reads | `readGuest` (tombstone on `erased_at`, never catch-decrypt), `readGuests` (id list), `assertGuestRef`, `readGuestProfile` (legacy, no tombstone). **Id-in only.** |
| HTTP already shipped | `[39] post_guests` `POST …/guests` (`guests:write`, `guests.create`). `[40] patch_guest` `PATCH …/guests/:id` (`guests.update`). `[41] post_guest_erase` `POST …/guests/:id/erase` (`guests:erase`). `[42] get_guest` `GET …/guests/:id` (`guests:read`, `pms.core`, `FAIL_CLOSED`). `[65] post_guests_batch` `POST …/guests/batch` (`guests:read`, `pms.core`, `FAIL_CLOSED`, max **50** refs). Dispatcher ~6219 / ~6427. |
| Reservation link | PropertyDO `reservation.guest_ref` + `pii_key_id` (v7). Index `reservation_guest_ref_idx`. `gateGuestRef` on **create only**. Lists / tape / directory items carry `guestRef`, never names. |
| Reservation name search | `[105] get_reservation_search` `GET …/reservations-search?q=` — exact id or decrypt-scan ≤200 stay guests, cap 20. **Not** a stored index. Org-wide `SELECT * FROM guest` forbidden (prototype-holes §7.3). |
| SPA today | `BookingScreen`: create-default or `?guestRef=` hydrate via batch. **No search box.** `guest-row.tsx` is a label helper, not a link. Board / tape / folio / reservations directory / exceptions / AppShell search compose via `postGuestsBatch`. Folio + board “Book for guest” → `/book?guestRef=`. **No `/guests` route. No nav entry.** ExceptionsScreen test asserts **no** `a[href*="/guests"]`. |
| Permissions | `guests:read` / `guests:write` on owner, admin, **staff**. `guests:erase` on owner / admin only (`permissions.ts` ~90–92, ~116–117). Property-scoped (`ORG_SCOPED_PERMISSIONS` does not include guests). |
| Catalog / routes / audit | `COMMAND_CATALOG` length **77** (`register.test.ts` ~607). `V1_HTTP_ROUTE_AUDIT` indices **0–123**, last `[123] = post_provisional_exception_note`. Next free **124**. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS = []`. |
| Schema heads | `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 6`. Next org free **7**. |
| Purge | Guest erase starts the guest Workflow; `clearGuestProfileBlobs` zeros cipher/iv (`org-do.ts` ~446). Org `countNonBookkeepingRows` counts **every** non-bookkeeping table via `sqlite_master` — a new OrgDO table is automatically in the residue census. `PROPERTY_GUEST_PII_COLUMNS` is only `billed_party`. No guest name column on PropertyDO. |
| Class denylist / night audit | No new `export class` expected. `NIGHT_AUDIT_STEPS` length **7**. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged (no PropertyDO table). |

**Heads (do not insert before):**

| | Current | This chunk |
|---|---|---|
| `V1_HTTP_ROUTE_AUDIT` | `[123] = post_provisional_exception_note` | next **124**; three rows **124–126** |
| `COMMAND_CATALOG` | length **77** | **77** (no new commands) |
| `AUDIT_WRITER_COMMAND_IDS.size` | **52** | **52** |
| `PLATFORM_GAPS` | `[]` | stays empty |
| `PROPERTY_SCHEMA_HEAD` | **25** | **25** (no PropertyDO migration) |
| `ORG_SCHEMA_HEAD` | **6** | **7** (new OrgDO table only) |
| `NIGHT_AUDIT_STEPS` | length **7** | unchanged |
| `PROPERTY_PURGE_INVENTORY_TABLES` | unchanged | unchanged |
| `PROPERTY_GUEST_PII_COLUMNS` | `billed_party` only | unchanged |
| `CLASS_DENYLIST` | no new `export class` expected | unchanged |

### 1.2 Scope in

1. Org-wide staff directory at `/guests`: paginated live-guest list + equality blind-index search on name / email / phone (§6–§8).
2. Guest profile at `/guests/:guestRef`: contact from OrgDO vault, shred status, property-scoped stay history, existing erase / update / book-for-guest actions (§9–§10).
3. OrgDO v7 `guest_blind_index` (HMAC hashes only). Create / update / erase / guest-purge blob-clear maintain it. Lazy backfill for pre-v7 rows (§5).
4. Three HTTP reads appended at **124–126**. No new catalog commands (§3–§4).
5. Booking wizard **Find existing guest** uses the same search (closes wizard destination C) (§11.3).
6. Reservation-linked guest chips become `<Link to="/guests/:guestRef">` (board, tape, folio, reservations directory, exceptions, AppShell search popover) (§11.4).

### 1.3 Scope out (normative — name them so a later pass does not “fix” them here)

- **Virtual room types** (§7.1).
- **Derived / OrgDO rate plans** (§7.2).
- **`rooms.delete` / archive lifecycle.**
- **Tape chart / live board / WebSockets.** Already shipped. Directory does not subscribe, broadcast, or invalidate via the front-office socket. React Query refetch on mutation settle.
- **Property setup / rates / settings SPA.** Already shipped.
- **`ui-kit` / visual identity** (§16.4). Existing tokens, `statusClass`, `guestSeverity`, `check:web-pms-colors`. No Tailwind, no prototype palette, no `packages/ui-kit`.
- **City ledger / invoices / auto-transfer / recurring charges / partial refunds.**
- **Any PCI / real PSP work.**
- **Reclassifying existing `get_front_desk_*` / `get_guest` / `post_guests_batch` / `get_reservation_search` to `READ_STALE`.** New guest reads are also `FAIL_CLOSED`. There is no KV guest projection. Prototype-holes leftover **4** remains.
- **New PropertyDO tables for PII.** PII stays in the OrgDO vault. `PROPERTY_GUEST_PII_COLUMNS` does not grow. Do not add `display_name` / `email` / `phone` (or hashes of them) to PropertyDO.
- **Guest-facing portal or self-service.** Staff CRM only.
- **`guests.merge` / dedupe / alias table.** Domain has no merge. Duplicate `guest_id`s remain accepted debt. No merge button.
- **`guests.update_consent` / consent flags.** Built by R4.15 as append-only `guest_consent` rows, not fields on `GuestProfile`. See `docs/superpowers/specs/2026-11-19-guest-documents-consent-design.md`.
- **Pending shred-request queue.** `guests.erase` is immediate crypto-shred. Profile shows live vs erased. No “requested / scheduled” state.
- **Tags, guest-level VIP, lifetime value, guest notes.** §16.1 names them. VIP is already a **stay** flag (`reservation.vip_flag`). LTV is warehouse (§7.8). Tags / guest notes / profile VIP are a later CRM slice.
- **Cross-property stay fan-out.** §7.6 forbids interactive PropertyDO fan-out. Stay history is **this property only**. Chain LTV / other-property stays are warehouse / Phase 3.
- **Prototype substring / trigram / prefix typeahead.** Search is **equality** (full field + name tokens). Reservation-search decrypt-scan stays as-is (leftover: optionally point it at the blind index later).
- **E.164 phone canonicalization / libphonenumber.** Phase 1 strips non-digits.
- **Org master-key rotation rebuild** of hashes.
- **ID documents / passport / R2 guest files.** Built by R4.15 (`guest_document` in OrgDO, scans in `GUEST_DOCS_R2`). See `docs/superpowers/specs/2026-11-19-guest-documents-consent-design.md`.
- **Whistle / guest-engagement** (Phase 3 module group).
- **New catalog command ids.** Reads are not commands. Existing `guests.create` / `update` / `erase` fingerprints do not change.
- **Widening `GuestProfile` JSON** with new keys this chunk.
- **A second confirmation number.**
- **Changing `GET /guests/:id` body** except documentation that the profile screen consumes it as-is.
- **Client-side IndexedDB guest cache.**

---

## 2. Invariants (normative)

Implementation that violates these is out of spec.

1. **Money is integers.** This chunk does not post, reverse, or display folio balances except via navigation to FolioScreen.
2. **The folio is append-only.** Unchanged. Stay history is a reservation read, not a folio rewrite.
3. **Domain code has zero platform imports.**
4. **Events carry no raw guest PII** (§4.8 / §5 Rule 13). `guest.created` / `updated` / `erased` stay `{ orgId, guestRef, piiKeyId }`. Search / list / stays emit **no** events.
5. **Guest PII lives in OrgDO.** Ciphertext + per-guest data key. Blind-index **hashes** also live only in OrgDO. PropertyDO continues to store `guest_ref` / `pii_key_id` only.
6. **Blind index stores no plaintext and no reversible ciphertext of name / email / phone.** HMAC-SHA256 of a normalized value under an org-level index key. A DB dump plus the per-guest data key cannot produce the index; a dump plus the index key cannot decrypt profiles.
7. **The index key is not the per-guest data key.** A per-guest key cannot answer “who has this email?” without already knowing the guest. Derive from `HOSPAI_ORG_MASTER_KEY` hex via HKDF (§5.2). Do not HMAC with the non-extractable AES-GCM `CryptoKey` from `importMasterKeyHex`.
8. **Erasure deletes index rows in the same `transactionSync` as `erased_at`.** An HMAC of an email is still identifying. `clearGuestProfileBlobs` (purge step) also `DELETE FROM guest_blind_index WHERE guest_id = ?`. Never leave hashes on a shredded subject.
9. **Never un-erase.** Create against an erased id stays `GUEST_EXISTS`. Backfill skips `erased_at IS NOT NULL`.
10. **Degraded mode never creates an obligation.** All three new HTTP reads are `FAIL_CLOSED`. OrgDO or PropertyDO transport failure → existing 503 body, nothing queued. Search is not `QUEUE_PROVISIONAL`.
11. **`runIdempotent` stays sync-only.** Unchanged. Index HMAC prep is async and stays **outside** `transactionSync`, same hybrid as vault seal on create/update.
12. **Schema.** Org v7 adds `guest_blind_index` only. No PropertyDO table, ALTER, or index. `pnpm generate:ddl` produces `migrations/do-org/0007_guest_blind_index.sql` and a **no-op** PropertyDO diff.
13. **No new PropertyDO purge table.** `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. Org residue census already counts every table; do not add a parallel allowlist unless one already exists for org (it does not — `sqlite_master` scan).
14. **No new `export class`.** HMAC helpers are functions in `@hospai/crypto-shredding`. File-local errors mapped to wire codes. Do not add to `CLASS_DENYLIST`.
15. **`NIGHT_AUDIT_STEPS` stays seven.**
16. **Route audit append-only.** New routes start at index **124**. `[123] = post_provisional_exception_note` does not move. `[39]`–`[42]` / `[65]` stay those ids. `findRoute` is method + first-match — do **not** register `GET …/guests/:id/stays` in a way that is shadowed, and do **not** put search under `GET …/guests/:id` (the literal `search` would be captured). Hyphenated `guests-search` at the end, same lesson as `reservations-search`.
17. **No new catalog commands.** `COMMAND_CATALOG` length stays **77**. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**.
18. **Stay history is property-scoped.** Dispatcher calls **this** PropertyDO with `guest_ref = ?`. Do not fan-out to other properties on the interactive path (§7.6).
19. **PropertyDO does not call OrgDO** for search, list, or stays. Search/list are OrgDO. Stays are PropertyDO. The SPA (and the stays GET) compose. Do not join names onto stay JSON.
20. **Guest names never live in PropertyDO or on stay JSON.** Stays carry `guestRef` only. Profile contact comes from `get_guest`.
21. **Search is equality, not substring.** Full normalized name / email / phone, plus equality on each whitespace name token length ≥ 2. `"Ad"` does not find `"Ada"`. `"Ada"` finds `"Ada Lovelace"` via the `name_token` row. Deliberate divergence from prototype `useExistingGuest` substring (booking-wizard lock).
22. **List / search omit erased guests.** Exact `GET …/guests/:id` still returns the tombstone. Directory is for returning guests.
23. **Org-wide `SELECT * FROM guest` + decrypt is forbidden** as a search implementation. List decrypts **only the current page** (≤ 50). Search decrypts **only hash hits** (≤ 50).
24. **PII query strings.** Search `q` is name / email / phone. It travels in the **POST body**, not the URL, so access logs / CF logs / `Referer` do not collect it. The SPA may still put `q` in the **client** query string (`/guests?q=`) for deep-link / back-button (web guideline: URL reflects state). That is a browser-local concern, not a server log.
25. **Fixture-date discipline** (`check:pms-core-test-dates`). Shared-storage tests key fixtures with `crypto.randomUUID()`.
26. **Visual identity is not this chunk.** Existing tokens, `guestSeverity`, `statusClass`, `check:web-pms-colors`. Interaction (directory, search, profile, stays, find-existing, chip links) is the specification; appearance is not.

---

## 3. HTTP routes to append (normative)

Append-only. Do not reorder 0–123. Do not duplicate `[39]`–`[42]` / `[65]`.

| Index | `id` | Method / path | Permission | `commandId` | Entitlement | `degradedRead` |
|---|---|---|---|---|---|---|
| 124 | `get_guests` | `GET` `/v1/properties/:pid/guests` | `guests:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 125 | `post_guests_search` | `POST` `/v1/properties/:pid/guests-search` | `guests:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |
| 126 | `get_guest_stays` | `GET` `/v1/properties/:pid/guests/:guestId/stays` | `guests:read` | *(omit)* | `pms.core` | `FAIL_CLOSED` |

Dispatcher patterns (append at **end** of `V1_ROUTES` in **identical order**; method-discriminated):

```
GET   /^\/v1\/properties\/([^/]+)\/guests$/
POST  /^\/v1\/properties\/([^/]+)\/guests-search$/
GET   /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/stays$/
```

Existing, **not** re-appended:

```
POST   /^\/v1\/properties\/([^/]+)\/guests$/                    // [39] create
PATCH  /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/           // [40] update
POST   /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/erase$/    // [41] erase
GET    /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)$/           // [42] profile contact + tombstone
POST   /^\/v1\/properties\/([^/]+)\/guests\/batch$/             // [65] chip hydrate
```

`GET …/guests` (exact) does not shadow `GET …/guests/:id`. `GET …/guests/:id/stays` is one extra segment past `[42]` — legal. `POST …/guests-search` is hyphenated so it cannot be captured as a guest id.

Do **not** add `GET …/guests-search` (PII in query logs). Do **not** add `GET …/guests/:id/profile` ( `[42]` is the profile). Do **not** add merge / consent POSTs. Do **not** add a batch-search POST.

Kill-switch: entitled reads follow the existing `entitlementForRoute` pair (402 / 503). Missing permission → 403 `{ error: 'forbidden', permission: 'guests:read' }`. Transport failure → existing `degradedFailClosedReadResponse()`. `[126]` fails closed if **either** PropertyDO (stays SQL) or — if the handler also hydrates, which it must **not** — OrgDO is down. Stays handler talks to PropertyDO only.

`Cache-Control: private, no-store` on all three (same class as staff directory / `/me` — these responses are PII).

---

## 4. Command catalog decision (normative)

### 4.1 What existing reads/writes suffice for

| Need | Existing | Decision |
|---|---|---|
| Contact details | `[42] get_guest` → `{ erased: false, profile }` or tombstone | **Reuse unchanged.** Profile screen does not invent `guests.get_profile`. |
| Chip hydrate on boards / tape / folio | `[65] post_guests_batch` | **Reuse.** Directory list/search return decrypted profile on the page so the directory itself does not need a second batch. Chips elsewhere stay batch. |
| Create returning-guest if none | `guests.create` / `[39]` | **Reuse.** Wizard still creates when search misses. |
| Edit contact | `guests.update` / `[40]` | **Reuse.** Profile screen may expose the same fields (`displayName`, optional `email` / `phone`). Fingerprint unchanged. |
| Shred | `guests.erase` / `[41]` | **Reuse.** Immediate. Staff without `guests:erase` see status, no button. |
| Book again | `/book?guestRef=` | **Reuse.** |
| Stay occupancy flags (VIP / DND) | stay columns + existing reservation GET | **Reuse on stay rows.** Not guest-profile VIP. |

### 4.2 What looks like a new command and is not

| Suggested id | Verdict | Why |
|---|---|---|
| `guests.search` | **Reject as catalog command.** | Read. No mutation, no outbox, no idempotency key. HTTP `[125]` + OrgDO `searchGuests`. |
| `guests.get_profile` | **Reject.** | `[42]` already returns the vault profile + tombstone. Stays are a different store → `[126]`. |
| `guests.merge` | **Defer.** | No alias table, no surviving-id rewrite of `reservation.guest_ref`, no catalog row. Duplicate guests stay accepted debt. |
| `guests.update_consent` | **Built by R4.15.** | Append-only `guest_consent`. Not a JSON key on `GuestProfile`. |

`PLATFORM_GAPS` stays `[]`. Do not add merge/consent as gaps — they are named leftovers, not catalog holes.

### 4.3 Existing writers — behaviour change, same ids

`guests.create` / `guests.update` / `guests.erase` keep lane `INTERACTIVE`, `FAIL_CLOSED`, `pms.core`, events, permissions, fingerprints, and revisit notes.

They **gain** blind-index maintenance inside the existing `transactionSync` (§5.3). That is not a new command and not a fingerprint change (the profile fields are already in the create/update fingerprint). Replay of create/update must not insert a second index set — delete-then-insert for that `guest_id` is idempotent.

`event-consumer.ts` allowlist unchanged.

**Rejected alternatives**

- One `guests.upsert_profile` mega-command — hides create vs update vs erase.
- PropertyDO “guest search” that stores normalized names next to `guest_ref` — violates §4.8 and this chunk’s PII denylist.
- Decrypt-scan of all OrgDO guests for `q` — the thing leftover 2 exists to replace; forbidden even with a cap.
- Cataloguing the reads as `READ_STALE` commands — reads are not commands; `degradedRead` lives on the route audit.

---

## 5. Schema v7 — OrgDO blind index (normative)

Migration name `guest_blind_index`. Pin `ORG_SCHEMA_HEAD === 7`. `PROPERTY_SCHEMA_HEAD` stays **25**.

```sql
CREATE TABLE guest_blind_index (
  guest_id    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('name', 'name_token', 'email', 'phone')),
  index_hash  BLOB NOT NULL,
  PRIMARY KEY (kind, index_hash, guest_id),
  FOREIGN KEY (guest_id) REFERENCES guest(guest_id)
);

CREATE INDEX guest_blind_index_lookup
  ON guest_blind_index (kind, index_hash);
```

- No plaintext column. No `normalized_value`. No PropertyDO copy.
- `index_hash` is 32-byte HMAC-SHA256.
- One guest may have many rows (full name + each token + email + phone).
- Two guests with the same email produce two rows that share `(kind, index_hash)` and differ by `guest_id` — both return.
- `MemorySql` in `migrate.test.ts` must list `CREATE TABLE guest_blind_index` and `CREATE INDEX guest_blind_index_lookup` (or the generic CREATE TABLE/INDEX path must already accept them).
- Real-SQLite: apply ≤6, insert a v2-shaped `data_key` + `guest`, apply 7, `SELECT` from `guest_blind_index` is empty, then insert a hash row with FK. Inserting `kind='passport'` fails CHECK. FK to missing `guest_id` fails.
- `pnpm generate:ddl` → `migrations/do-org/0007_guest_blind_index.sql`.

Do **not** ALTER `guest`. Do **not** add covering indexes on PropertyDO.

### 5.1 Normalization (normative)

Apply **before** HMAC. Store nothing but the hash.

| Kind | Input | Normalize |
|---|---|---|
| `name` | `displayName` | Unicode NFKC, trim, collapse internal whitespace to one U+0020, lowercase (default locale). Empty → **no row**. |
| `name_token` | each whitespace-split token of the normalized name | Same; drop tokens with UTF-16 length **< 2**. Deduplicate tokens. |
| `email` | `email` | Trim, lowercase. Empty / omitted → no row. Do not validate RFC beyond “contains `@`” at **search classify** time; create/update already accept optional free text. |
| `phone` | `phone` | Strip every non-digit. Empty → no row. No country-code inference. |

### 5.2 Index key (normative)

New helpers in `packages/crypto-shredding` (functions, not a new `export class`):

```ts
// importBlindIndexKeyHex(hex: string): Promise<CryptoKey>
// HKDF-SHA256 extract+expand, info = 'hospai.guest-blind-index.v1', 32-byte HMAC key
// Same HEX_RE as importMasterKeyHex.

// blindIndexHash(key: CryptoKey, kind: BlindIndexKind, normalized: string): Promise<Uint8Array>
// HMAC-SHA256(key, kind || 0x1f || utf8(normalized))

// blindIndexRows(key, profile: GuestProfile): Promise<Array<{ kind, hash }>>
```

Domain separator `0x1f` (unit separator) between `kind` and payload so `name:"a@b"` cannot collide with `email:"a@b"` under a naive concat.

> **Amended by [2026-09-05 per-org HKDF master key](./2026-09-05-per-org-master-key-hkdf-design.md):** blind-index HMAC key is HKDF-derived per org (`hospai/v1/org-blind/${orgId}`, 32-zero-byte salt), not platform-wide `hospai.guest-blind-index.v1`.

OrgDO constructs the HMAC key once per instance from `env.HOSPAI_ORG_MASTER_KEY` (same binding as the vault). Do not persist the HMAC key. Do not wrap it in `data_key` this chunk (scope CHECK is `'guest' | 'staff'` only — do not widen).

Master-key rotation that changes the hex **invalidates every hash** — named leftover. Do not silently dual-write two generations.

### 5.3 Writer maintenance

Order stays the guests-PII hybrid:

```
gatePermission → gateCoreEntitlement → readIdempotentReplay
→ await vault prep + await blindIndexRows(profile)   // create/update
→ transactionSync(runIdempotent(…))
```

Inside the execute callback, after the `guest` INSERT/UPDATE:

```
DELETE FROM guest_blind_index WHERE guest_id = ?
-- then INSERT one row per { kind, hash }
```

Erase (already-erased idempotent success included): `DELETE FROM guest_blind_index WHERE guest_id = ?` even when the key was already shredded (second erase must not 500 if rows are already gone).

`clearGuestProfileBlobs`: same DELETE, then the existing cipher/iv zero.

### 5.4 Backfill (normative)

`migrate()` is sync and cannot decrypt. Pre-v7 guests have zero index rows and would be invisible to search.

OrgDO `ensureGuestBlindIndex(guestId | 'missing')`:

1. `SELECT guest_id FROM guest WHERE erased_at IS NULL AND guest_id NOT IN (SELECT DISTINCT guest_id FROM guest_blind_index)` — if the argument is a specific id, restrict to it.
2. Cap **25** guests per call (same as a list page). Decrypt via `readGuestEntry`; skip erased / `decrypt_unresolved` (log `guests.read.decrypt_incident` for unresolved; do not 500).
3. Write rows in `transactionSync` (no `runIdempotent` — this is not a client command).

Call sites: start of `listGuests` and `searchGuests` (so the first directory open heals a page); `tryUpdateGuest` already rewrites that id. Do **not** backfill the entire org on cold start (OrgDO single-thread; a large vault would stall INTERACTIVE). Remaining unindexed guests heal on later pages / later searches / later updates.

Create after v7 always writes rows — no backfill needed for new guests.

List-without-search still works for unindexed guests because list is `guest` keyed, not hash keyed. Search **misses** unindexed guests until backfill reaches them — acceptable; the first `listGuests` page heals 25, and the SPA list is the default landing.

---

## 6. Directory list — `[124] get_guests`

| | |
|---|---|
| HTTP | `GET /v1/properties/:propertyId/guests?cursor=&limit=` |
| OrgDO RPC | `listGuests(actor, propertyId, { cursor?, limit })` |

Query:

- `limit` optional, default **25**, max **50**, same parser spirit as `parseOptionalFrontDeskLimit`. Illegal → 400 `invalid_limit`.
- `cursor` optional. Reuse `encodeFrontDeskCursor` / `decodeFrontDeskCursor`. Payload `{ createdAt: number; guestId: string }`. Invalid → 400 `invalid_cursor`.
- No `q` on this GET (search is `[125]`).

SQL (live only):

```
SELECT guest_id, created_at FROM guest
 WHERE erased_at IS NULL
   AND (created_at, guest_id) < (:cursorCreatedAt, :cursorGuestId)  -- if cursor
 ORDER BY created_at DESC, guest_id DESC
 LIMIT :limit
```

Then decrypt each id via `readGuestEntry`. Omit `decrypt_unresolved` from `items` (log incident). Do not pad the page — a skipped decrypt can make a page shorter than `limit`; that is honest. `nextCursor` is the last **returned** item’s `{ createdAt, guestId }`, or `null` if the SQL page was shorter than `limit`.

Response:

```ts
{
  ok: true;
  items: Array<{
    guestId: string;
    erased: false;
    profile: { displayName: string; email?: string; phone?: string };
    createdAt: number;
  }>;
  nextCursor: string | null;
}
```

Empty org → `{ ok: true, items: [], nextCursor: null }` (200, not 404).

Do **not** include stay counts on the list (that would be PropertyDO per row). The directory is OrgDO-only.

---

## 7. Blind-index search — `[125] post_guests_search`

| | |
|---|---|
| HTTP | `POST /v1/properties/:propertyId/guests-search` |
| OrgDO RPC | `searchGuests(actor, propertyId, { q, cursor?, limit })` |

Body:

```ts
{ q: string; cursor?: string; limit?: number }
```

`q` required, trimmed, 1–128 UTF-16 code units; else 400 `invalid_query`. `limit` / `cursor` same as §6. Cursor payload `{ guestId: string }` over the **stable sorted hit set** (not created_at — search ranking is id-stable).

### 7.1 Classify `q` (normative)

After trim:

| Predicate | Kinds hashed |
|---|---|
| `q` includes `@` | `email` only |
| `q` matches `/^[+]?[\d\s().-]{7,}$/` | `phone` only (normalize = digits) |
| otherwise | `name` **and** `name_token` (normalize `q` as a name; also hash the full string as `name` and each token ≥ 2 as `name_token`) |

Do not search every kind for every `q` (false collisions + extra decrypts).

### 7.2 Lookup

1. `ensureGuestBlindIndex('missing')` (one page, §5.4).
2. For each classified `(kind, hash)`: `SELECT DISTINCT guest_id FROM guest_blind_index WHERE kind = ? AND index_hash = ?`.
3. Union ids. Join `guest` and drop `erased_at IS NOT NULL`.
4. Stable sort `guest_id ASC`. Apply cursor (`guest_id > cursor.guestId`), then `limit`.
5. Decrypt the page. Same unresolved skip as §6.

Cap **50** distinct ids **before** decrypt even if the union is larger (then page inside that cap). An equality index should not return hundreds; the cap is a safety brake, not a substring window.

Response shape **identical** to §6 (`items` + `nextCursor`). Empty hits → 200 `{ items: [], nextCursor: null }`.

Do **not** return `index_hash`. Do **not** echo `q` in the JSON (log redaction: handlers must not `logError` the raw `q`).

### 7.3 Why this replaces leftover 2

Prototype-holes leftover 2 is “replace the decrypt-scan.” That scan is **reservation-search**, property-scoped, substring. This chunk does **not** rewrite `[105]`. It provides the **org-wide stored index** leftover 2 asked for, and the CRM / wizard consume it. Pointing `[105]` at the index is a named leftover (reservation-search would still need a stay join).

---

## 8. Stay history — `[126] get_guest_stays`

| | |
|---|---|
| HTTP | `GET /v1/properties/:propertyId/guests/:guestId/stays?cursor=&limit=` |
| PropertyDO RPC | `listReservationsByGuestRef(guestRef, { cursor?, limit })` |

Permission `guests:read` (the operator is on the CRM). Do **not** require `reservations:read` in addition — staff who can open the profile can see that this guest stayed here. Folio money still sits behind `folio:read` on FolioScreen.

`guestId` is an opaque string. **Do not** `assertGuestRef` / OrgDO-hydrate. An erased guest still has stays (guests-PII §2.5: erase does not cascade). Unknown `guest_ref` with zero rows → 200 `{ items: [], nextCursor: null }`, not 404 (404 would leak “this id exists in OrgDO”).

SQL uses `reservation_guest_ref_idx`:

```
SELECT reservation_id, room_type_id, arrival_date, departure_date, status,
       room_id, adults, children, vip_flag, dnd_flag, rate_plan_id
  FROM reservation
 WHERE guest_ref = ?
   AND (arrival_date, reservation_id) < (:cursorArrival, :cursorId)  -- if cursor
 ORDER BY arrival_date DESC, reservation_id DESC
 LIMIT :limit
```

Cursor `{ arrivalDate: string; reservationId: string }`. Default / max limit same as §6.

Response:

```ts
{
  ok: true;
  propertyId: string;
  guestId: string;
  scope: 'this_property';
  items: Array<{
    reservationId: string;
    roomTypeId: string;
    arrivalDate: string;
    departureDate: string;
    status: string;
    roomId: string | null;
    adults: number;
    children: number;
    vipFlag: boolean;
    dndFlag: boolean;
    ratePlanId: string | null;
  }>;
  nextCursor: string | null;
}
```

**No `displayName`. No `piiKeyId`. No folio balances.** SPA links `reservationId` → `/folio/:reservationId`.

Copy on the profile (not a payload field the client invents): “Stays at this property.” Do not imply chain history.

---

## 9. Profile screen — compose, do not invent a fourth GET

`/guests/:guestRef` loads in parallel:

1. `[42] get_guest` — contact + `erased`.
2. `[126] get_guest_stays` — stay table.
3. Optional `[40]` / `[41]` when the operator edits or shreds.

```
                    ┌──────────── OrgDO ────────────┐
 GET /guests/:id ──►│ vault profile / tombstone     │
                    └───────────────────────────────┘
                    ┌────────── PropertyDO ─────────┐
 GET /…/stays   ──►│ reservation WHERE guest_ref=? │
                    └───────────────────────────────┘
```

PII controls (what the screen shows — only these):

| Control | Source | Who |
|---|---|---|
| View contact | `[42]` `profile` | `guests:read` |
| Erased tombstone | `[42]` `erased: true`, `profile: null` | `guests:read` |
| Shred | existing `[41]` + confirm modal | `guests:erase` (owner/admin) |
| Shred status | live vs erased. No pending-request chip | — |
| Consent flags | **not modeled** — omit the row | — |
| Merge / dedupe | **not modeled** — omit the action | — |
| Edit contact | existing `[40]` | `guests:write` |
| Book again | `/book?guestRef=` | `reservations:write` |

After erase: `[42]` tombstone; stays GET still 200; index rows gone; chips elsewhere show `guestRef (erased)` via existing `guestLabel`.

Decrypt incident on `[42]` stays 500 `internal_error` + `guests.read.decrypt_incident` (do not render as erased).

---

## 10. SPA

### 10.1 Nav + routes

`nav.ts` (between Reservations 35 and Book 40):

```ts
{ id: 'guests', label: 'Guests', path: '/guests', order: 36, permission: 'guests:read' }
```

`App.tsx`:

```
<Route path="guests" element={<GuestsDirectoryScreen />} />
<Route path="guests/:guestRef" element={<GuestProfileScreen />} />
```

Index `/` stays `/board`. Hide nav when `me` is degraded / no `guests:read`.

### 10.2 Directory — `/guests`

URL is the source of truth: `?q=&cursor=`. Changing search `replace`s the query string. `q` in the **client** URL is allowed (§2.24); the HTTP call for a non-empty `q` is `POST …/guests-search` with `q` in the body. Empty `q` → `GET …/guests`.

Layout:

- `h1` Guests (`text-wrap: balance`).
- Search field: `role="search"`, `type="search"`, `name="guest-search"`, `autoComplete="off"`, `spellCheck={false}`, visible label (“Name, email, or phone”), `placeholder="Ada Lovelace, ada@…, or 5550100…"`, `data-testid="guest-directory-search"`. Debounce 300 ms. Honor `prefers-reduced-motion` on any spinner.
- Table: name (link to profile), email, phone, created (Intl date, `tabular-nums`). `guestId` `translate="no"` as secondary text or title. Long fields `truncate` + `min-w-0`.
- Pagination: Next uses `nextCursor`; Previous may be browser back (URL cursor) or omitted — do not invent offset math. `limit` not in the URL unless the operator changes it (default 25).
- Empty: “No guests yet.” / “No guests match that search.” — do not render a broken table.
- Loading: “Loading…” (`…` not `...`). `aria-live="polite"` on the results region.
- Fail-closed: “Guest directory unavailable — organization unreachable.” No client-side scan of batch caches.

Page size 25 ⇒ no virtualization requirement (guideline threshold is >50).

### 10.3 Profile — `/guests/:guestRef`

- `h1` = displayName or `guestRef` if erased / pending (`text-wrap: balance`).
- Contact definition list: name, email (`type` display), phone. Missing optionals: omit the row, do not show “undefined”.
- PII panel: Live / Erased. Erase button (`guests:erase`) opens a **confirmation modal** (`overscroll-behavior: contain`); copy: “This permanently destroys the guest’s contact details. Stay records remain. This cannot be undone.” Confirm label “Erase guest”, not “Continue”. `aria-label` if icon-only cancel.
- Stays table: reservation id (`<Link to="/folio/:id">`, `translate="no"`), dates, status (`statusClass`), room, VIP/DND badges (`badge-vip` / `badge-dnd` reused), party size. Empty: “No stays at this property.” Caption: “Stays at this property.”
- Actions: Edit (write), Book for guest (write reservation), Erase (erase).
- Unsaved edit: `beforeunload` / router guard.
- Submit stays enabled until the request starts; then spinner “Saving…”.
- Errors inline; focus first error.

### 10.4 Guidelines that bind (not a visual identity)

- Guest chips and directory names are `<Link>` / `<a href>`, not `div` onClick (Cmd/Ctrl-click, middle-click).
- Icon-only controls need `aria-label`. Form controls have a label. Search results `aria-live="polite"`.
- Visible `:focus-visible` ring. No `outline: none` without a replacement.
- `…` in loading / placeholders. Curly quotes in copy. Non-breaking space in `⌘ K` if the shell later adds it — do not add a shortcut this chunk.
- `translate="no"` on `guestId` / `reservationId`.
- `Cache-Control` is a server concern; the SPA does not persist profiles in `localStorage`.

---

## 11. Folded leftovers (small; do them in this chunk)

| # | Item | From | What to do |
|---|---|---|---|
| 1 | Stored blind-index guest discovery | Prototype-holes leftover **2** | §5–§7. Wizard leftover “no search box” destination C. |
| 2 | Guest CRM directory | Tape leftover **21**; exception leftover **3**; guests-PII scope-out | `/guests` + `/guests/:guestRef` + nav. |
| 3 | Blind-index search (named as its own leftover) | Tape leftover **15** | Same as #1 — one implementation. |
| 4 | Exception `guestRef` has no CRM href | Exception §11 / test “no guest CRM href” | Link to `/guests/:guestRef` when `guestRef` is present. Flip the test. Hydrate still via batch. |
| 5 | Reservation-linked chips go nowhere | Board, tape, folio, reservations directory, AppShell search popover | Wrap `guestLabel` output in `<Link to={/guests/:guestRef}>`. Keep `Book for guest` → `/book?guestRef=`. Erased / not_found / pending still link (profile explains). |
| 6 | Booking wizard find-existing | Booking-wizard §2.2 destination C | Search box on the Guest step (`data-testid="guest-find"`). `POST …/guests-search`. Pick a hit → context mode (`setContextGuestRef`) **without** `createGuest`. Miss → existing create-default. Equality only — do not substring-filter client-side. Duplicate create remains possible if the operator skips search. |
| 7 | Index maintenance on existing writers | Implied by leftover 2 | §5.3–§5.4. |

`guest-row.tsx` may grow a `GuestNameLink` helper so chips share one `data-testid="guest-profile-link"` pattern. Do not extract `packages/ui-kit`.

---

## 12. Leftovers deferred (explicitly out; do not fold)

| # | Item | Notes |
|---|---|---|
| 1 | Virtual room types | §7.1 |
| 2 | Derived / OrgDO rate plans | §7.2 |
| 3 | `rooms.delete` / unit archive | Rooms-vertical leftover |
| 4 | Tape chart / live board / WebSockets | Shipped; no guest deltas on the socket |
| 5 | Property setup / rates / settings | Shipped |
| 6 | `ui-kit` / visual identity | §16.4 |
| 7 | ~~City ledger / AR~~ **Closed** in [2026-08-15 city ledger / AR](./2026-08-15-city-ledger-ar-design.md). | ~~§7.3~~ |
| ~~| 8 | Invoice generation | §16.1 / §4.7 R2 |~~ **Closed** in [2026-08-15 invoice generation engine](./2026-08-15-invoice-generation-engine-design.md). |
| 9 | Night-audit auto-transfer | Pinned 7 steps |
| 10 | Recurring charges / `breakfast_rule` engine | Prototype-holes leftover 1 |
| 11 | Partial refunds | Folio-money leftover |
| 12 | PCI / real PSP | Simulate stays |
| 13 | Reclass guest / front-desk GETs to `READ_STALE` | Prototype-holes leftover **4** — still no KV projection |
| 14 | `guests.merge` / alias / surviving-id rewrite | Domain does not support it |
| 15 | Consent flags / `guests.update_consent` | Built by R4.15 as `guest_consent`, not on `GuestProfile` |
| 16 | Pending shred-request workflow | Erase is immediate |
| 17 | Tags / guest-level VIP / guest notes | §16.1 remainder; stay VIP already exists |
| 18 | Lifetime value | Warehouse §7.8 |
| 19 | Cross-property stay history | §7.6 fan-out ban; Phase 3 / Iceberg |
| 20 | Substring / trigram / prefix typeahead | Equality + tokens only |
| 21 | Point `[105] reservations-search` at the blind index | Decrypt-scan stays; optional later |
| 22 | E.164 phone canonicalization | Digit-strip only |
| 23 | Master-key rotation hash rebuild | Dual-generation leftover |
| 24 | ID documents / passport / R2 guest files | Built by R4.15 |
| 25 | Guest-facing portal / Whistle | Phase 3 |
| 26 | Widening `GuestProfile` | displayName / email / phone only |
| 27 | New PropertyDO PII columns or tables | Denylist unchanged |
| 28 | DND on housekeeping board | Prototype-holes leftover 3 |
| 29 | `entitlement.changed` WebSocket | Org-scoped; refetch-on-402 stays |

---

## 13. Degraded-mode behaviour (summary)

| Situation | Behaviour |
|---|---|
| List / search, OrgDO up | 200, page of decrypted live guests |
| List / search, OrgDO down | 503 FAIL_CLOSED; no queue; SPA banner |
| Stays, PropertyDO up | 200, including when the guest is erased |
| Stays, PropertyDO down | 503 FAIL_CLOSED |
| Profile compose, OrgDO down / PropertyDO up | Contact 503; do not fake a name from stays |
| Profile compose, OrgDO up / PropertyDO down | Contact 200; stays 503; show contact + “Stay history unavailable — property unreachable.” |
| Create / update / erase | Existing FAIL_CLOSED writers |
| Erase during list | Next list omits the id; in-flight profile becomes tombstone |
| Print / folio in DEGRADED | Unchanged — this chunk does not print |

---

## 14. File map (implementation will touch; not a plan)

| Area | Touch |
|---|---|
| `packages/do-runtime/src/org-migrations.ts` | v7 statements; `ORG_MIGRATIONS` length 7 |
| `migrations/do-org/0007_guest_blind_index.sql` | `pnpm generate:ddl` |
| `packages/do-runtime/src/migrate.test.ts` | `ORG_SCHEMA_HEAD === 7`; MemorySql prefixes if needed |
| `packages/crypto-shredding/src/blind-index.ts` (+ test) | HKDF import, HMAC, `blindIndexRows` |
| `packages/crypto-shredding/src/index.ts` | re-export functions |
| `packages/contracts/src/v1-http-routes.ts` | append `[124]`–`[126]` |
| `packages/contracts/src/register.test.ts` | route-id pins; catalog length **77**; audit size **52** |
| `apps/pms-core/src/org-do.ts` | `listGuests`, `searchGuests`, `ensureGuestBlindIndex`; writer + `clearGuestProfileBlobs` maintenance |
| `apps/pms-core/src/property-do.ts` | `listReservationsByGuestRef` (sync SQL, existing index) |
| `apps/pms-core/src/v1-dispatch.ts` | three handlers; `V1_ROUTES` append |
| `apps/pms-core/test/guests-routes.spec.ts` / `guests.spec.ts` | list, search, backfill, erase-clears-index, stays |
| `packages/client-core/src/api.ts` | `listGuests`, `searchGuests`, `listGuestStays` |
| `apps/web-pms/src/shell/nav.ts` / `App.tsx` | Guests nav + routes |
| `apps/web-pms/src/screens/GuestsDirectoryScreen.tsx` | new |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` | new |
| `apps/web-pms/src/screens/guest-row.tsx` | `GuestNameLink` |
| `apps/web-pms/src/screens/BookingScreen.tsx` | find-existing |
| Board / tape / folio / reservations / exceptions / AppShell search | chip → profile link |
| Pointer sentences | prototype-holes, tape, exception, booking-wizard specs |

No `pending-commands-consumer` / `REPLAY_DISPATCH` / `NIGHT_AUDIT_STEPS` / PropertyDO migration.

---

## 15. Tests (acceptance-shaped)

**Contracts / register**

1. `V1_HTTP_ROUTE_AUDIT[123].id === 'post_provisional_exception_note'`; `[124]='get_guests'`; `[125]='post_guests_search'`; `[126]='get_guest_stays'`. Each new row: `scope:'property'`, no `commandId`, `entitlement:'pms.core'`, `degradedRead:'FAIL_CLOSED'`, `permission:'guests:read'`.
2. `COMMAND_CATALOG` length **77** at the time of this directory spec. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `PLATFORM_GAPS` `[]`. No `guests.search` / `guests.merge` / `guests.get_profile` ids. `guests.update_consent` was added later by R4.15.
3. `ORG_SCHEMA_HEAD === 7`. `PROPERTY_SCHEMA_HEAD === 25`. `NIGHT_AUDIT_STEPS.length === 7`. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `PROPERTY_GUEST_PII_COLUMNS` still only `billed_party`. `CLASS_DENYLIST` unchanged.

**Blind index / crypto**

4. Same normalized email → same 32-byte hash; different kind + same payload → different hash. `name` vs `email` for `"a@b.c"` do not collide.
5. `blindIndexRows`: name + two tokens + email + phone → five rows; missing email/phone omitted; one-letter token dropped.
6. HKDF key from fixture hex is stable across two imports; it is not the AES wrap key object.

**OrgDO / HTTP — directory + search**

7. Create Ada (`email`, `phone`) → `GET …/guests` returns her profile, no cipher fields, `nextCursor` null. Second page after 26 creates uses cursor; no overlap.
8. `POST …/guests-search` `{ q: 'Ada' }` hits via `name_token`. `{ q: 'Ad' }` → empty. `{ q: ada@… }` email kind. Digit phone hits. Erased Ada disappears from list and search; `GET …/guests/:id` tombstone.
9. Update email → old email search empty, new email hits. Erase deletes `guest_blind_index` rows (count 0). Second erase 200, still 0 rows.
10. Pre-v7 guest (row in `guest`, zero index rows): first `GET …/guests` backfills ≤25 and search then hits. `decrypt_unresolved` skipped, not 500.
11. Missing `guests:read` → 403. Kill-switch → 402/503 entitled pair. OrgDO down → 503 FAIL_CLOSED. `q` empty / 129 chars → 400. Invalid cursor → 400.
12. Outbox `guest.created` JSON has no `displayName` / `email` / `phone`.

**Stays**

13. Two reservations for `g1` at this property, one for `g2`: `GET …/guests/g1/stays` returns the two, newest arrival first, no names, no `piiKeyId`. Cursor pages. Unknown id → `{ items: [] }`. Erased `g1` still returns stays.
14. PropertyDO down → 503. Do not call OrgDO from the stays handler (unit: handler / RPC has no org stub).

**SPA**

15. Nav Guests visible with `guests:read`; hidden without. `/guests` search + empty state. Click name → `/guests/:id`.
16. Profile shows contact; stays link to folio; Book for guest → `/book?guestRef=`. Erase confirm then tombstone. No merge button. No consent row.
17. Board / tape / folio / exceptions guest cell is a profile `<Link>`. Exceptions test that forbade `/guests` hrefs is inverted.
18. Wizard: find “Ada” → pick → Confirm does **not** call `createGuest`; reservation uses that `guestRef`. Skip search + type a new name → create-default still works.

**Pins**

19. `pnpm generate:ddl` PropertyDO diff empty. Org DDL file matches v7 statements.
20. `check:permissions` / `check:degraded` / `check:entitlements` / `check:web-pms-colors` / `check:class-denylist` / `check:purge` green.

---

## 16. Open questions (locked)

1. **Search semantics.** **Locked: equality + name tokens**, as spec’d in §2.21 / §7. Not prototype substring. Not trigram.
2. **Stay history grain.** **Locked: this property only.** §7.6. UI says so.
3. **Merge.** **Locked: defer.** No button, no command, no leftover “half-merge.”
4. **Consent.** **Locked: omit.** Not modeled.
5. **Search HTTP verb.** **Locked: POST `guests-search`.** PII stays out of server query strings. SPA URL may still hold `q`.
6. **List vs search routes.** **Locked: two routes** (`GET` list, `POST` search). Do not overload `GET …/guests?q=`.
7. **Profile GET.** **Locked: reuse `[42]` + `[126]`.** No `guests.get_profile` command or fourth GET.
8. **Reservation-search rewrite.** **Locked: out.** `[105]` decrypt-scan remains until leftover 21 in §12.
9. **Wizard.** **Locked: add find-existing** (folded leftover 6). Create-default remains the miss path.
10. **Degraded class.** **Locked: FAIL_CLOSED** on 124–126, matching shipped guest reads, not the §4.6 table row.

---

## 17. Implementation checklist (for the plan author; not a plan)

- [ ] Org v7 `guest_blind_index`; `pnpm generate:ddl`; `ORG_SCHEMA_HEAD === 7`; PropertyDO head stays 25.
- [ ] crypto-shredding HKDF/HMAC helpers + tests. No new `export class`.
- [ ] Create/update/erase + `clearGuestProfileBlobs` maintain / delete hashes. Lazy backfill.
- [ ] `[124]`–`[126]` audit + dispatcher + OrgDO/PropertyDO RPCs.
- [ ] SPA: nav, directory, profile, chip links, wizard find-existing, exception href flip.
- [ ] Tests in §15. Pointer sentences in prototype-holes / tape / exception / booking-wizard specs.
- [ ] Checks in §15.20 green.
- [ ] Stop. Do not write merge, consent, LTV, cross-property fan-out, or a PropertyDO name column.

---

## 18. Reviewer checklist

- [ ] Verified-current-state table matches the tree (route **124**, catalog **77**, org head **6→7**, property head **25**, no new commands).
- [ ] Normative invariants include integer money, append-only folio, schema-freeze (no PropertyDO PII table), Rule 3/events-by-ref, no new `export class`, no new PropertyDO purge table, route audit append-only.
- [ ] Command decision is explicit: existing reads/writes suffice; `guests.search` / `get_profile` are HTTP-only; `merge` stays deferred. `update_consent` shipped in R4.15.
- [ ] Blind index is OrgDO HMAC only; PropertyDO stays `guest_ref`; erase deletes hashes.
- [ ] Routes **124–126** named with method, path, permission, entitlement, `FAIL_CLOSED`.
- [ ] Scope-out names every required exclusion (virtual types, derived rates, `rooms.delete`, tape/WS, property setup, `ui-kit`, city ledger / invoices / auto-transfer / recurring / partial refunds, PCI, `READ_STALE` reclass, PropertyDO PII tables, guest portal).
- [ ] Folded leftovers named (§11). Deferred leftovers named (§12).
- [ ] Acceptance / reviewer checklist present.
- [ ] This file is a **spec only** — no implementation plan, no code, no commit in the spec-authoring turn.
