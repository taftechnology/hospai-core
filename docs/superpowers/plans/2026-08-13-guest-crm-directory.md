# Guest CRM Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Give staff an org-wide guest directory and profile so they can look up returning guests (name / email / phone) without re-creating them — without storing PII in PropertyDO.

**Architecture:** OrgDO v7 adds `guest_blind_index` (HMAC hashes only). Three FAIL_CLOSED reads append at **124–126**. No new catalog commands. Existing `guests.create` / `update` / `erase` maintain the index. Stay history is this PropertyDO only (`reservation_guest_ref_idx`). SPA is core `nav.ts`. Profile contact reuses `[42] get_guest`. Search `q` is POST-body only.

**Tech Stack:** Cloudflare Durable Objects (OrgDO + PropertyDO), `@hospai/crypto-shredding`, `@hospai/contracts`, `@hospai/client-core`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` (Approved). Spec commit: `a555723`.

## Global Constraints

- Route audit **append-only**. `[123] = post_provisional_exception_note` does not move. `[39] post_guests`, `[40] patch_guest`, `[41] post_guest_erase`, `[42] get_guest`, `[65] post_guests_batch` stay those ids. New routes are **`[124] get_guests`**, **`[125] post_guests_search`**, **`[126] get_guest_stays`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` in **identical order**.
- Task 1 and Task 2 must **not** touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT` (`check:permissions` stays green). Task 3 appends **124–126** together so the zip stays aligned.
- `COMMAND_CATALOG.length` stays **77**. Reads omit `commandId`. Do **not** add `guests.search` / `guests.get_profile` / `guests.merge` / `guests.update_consent`. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
- **Org schema v7 only.** `CREATE TABLE guest_blind_index` + lookup index. Do **not** ALTER `guest`. `PROPERTY_SCHEMA_HEAD` stays **25**. `pnpm generate:ddl` must produce `migrations/do-org/0007_guest_blind_index.sql` and a **no-op** PropertyDO diff.
- `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `PROPERTY_GUEST_PII_COLUMNS` stays `billed_party` only. No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- `runIdempotent` stays sync-only. HMAC prep is async and stays **outside** `transactionSync` (same hybrid as vault seal).
- Blind index stores **hashes only**. No plaintext, no `normalized_value`, no PropertyDO copy. Index key is HKDF from `HOSPAI_ORG_MASTER_KEY` hex — **not** the per-guest data key, **not** the non-extractable AES-GCM `CryptoKey` from `importMasterKeyHex`.
- Erase / `clearGuestProfileBlobs` **DELETE** `guest_blind_index` rows for that `guest_id` in the same txn as the guest mutation (erase) or immediately with the blob zero (purge).
- Search is **equality + name tokens**, not substring. `"Ad"` does not find `"Ada"`. `"Ada"` finds `"Ada Lovelace"` via `name_token`.
- List / search omit erased guests. Exact `[42]` still returns the tombstone. Stays GET does **not** call OrgDO.
- Stay history is **this property only**. No PropertyDO fan-out. Stay JSON has no names / no `piiKeyId`.
- New HTTP reads are **`FAIL_CLOSED`**. Do **not** reclass `get_front_desk_*` / `get_guest` / `post_guests_batch` / `get_reservation_search` to `READ_STALE`. Do **not** rewrite `[105]`.
- Search `q` travels in the **POST body**. Do not add `GET …/guests-search` or `GET …/guests?q=`.
- `Cache-Control: private, no-store` on 124–126.
- Nav: Guests `/guests` order **36** `guests:read` (between Reservations 35 and Book 40). Core `nav.ts`, not `module-ui-registry.ts`. Index `/` stays `/board`.
- Existing tokens / `guestSeverity` / `statusClass` / `check:web-pms-colors`. No Tailwind, no `ui-kit`, no new `--status-*` pairs.
- Fixture dates from property-local `business_date` when load-bearing. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- **Rebuild:** after any `@hospai/do-runtime` source change, `pnpm --filter @hospai/do-runtime build` **before** `pnpm generate:ddl`. After `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests. After `@hospai/crypto-shredding` source change, `pnpm --filter @hospai/crypto-shredding build` before org-do tests. After client-core source change, `pnpm --filter @hospai/client-core build` before web-pms tests.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 9). Do not backfill historical plans.
- No either/or forks. Spec §16 locks stand.
- Scope-out (do not implement): virtual types, derived/OrgDO plans, `rooms.delete`, tape/WS, property-setup rebuild, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring, partial refunds, PCI, list-route `READ_STALE` reclass, merge, consent, pending shred queue, tags / guest-level VIP / LTV / guest notes, cross-property stays, substring/trigram, `[105]` rewrite, E.164, master-key rotation rebuild, ID docs, guest portal / Whistle, `GuestProfile` widen, PropertyDO PII columns, HK DND join, `entitlement.changed` WS.

## File map

| File | Role |
|---|---|
| `packages/crypto-shredding/src/blind-index.ts` | HKDF import, HMAC, normalize, `blindIndexRows` (Task 1) |
| `packages/crypto-shredding/src/blind-index.test.ts` | Spec §15.4–15.6 (Task 1) |
| `packages/crypto-shredding/src/index.ts` | Re-export functions + `BlindIndexKind` |
| `packages/do-runtime/src/org-migrations.ts` | v7 statements; `ORG_GUEST_BLIND_INDEX_SQL` (Task 2) |
| `packages/do-runtime/src/index.ts` | Re-export `ORG_GUEST_BLIND_INDEX_SQL` / `_STATEMENTS` |
| `packages/do-runtime/src/migrate.test.ts` | Head **7**; on-disk match; MemorySql apply |
| `packages/do-runtime/src/guest-blind-index-migration.sqlite.test.ts` | Real SQLite (Task 2) |
| `migrations/do-org/0007_guest_blind_index.sql` | `pnpm generate:ddl` |
| `scripts/property-ddl.mjs` | Add org `0007` target + import |
| `packages/contracts/src/v1-http-routes.ts` | Append `[124]`–`[126]` (Task 3) |
| `packages/contracts/src/register.test.ts` | Route pins; catalog stays 77; no new guest command ids |
| `apps/pms-core/src/org-do.ts` | Index key cache; writer maintenance; `listGuests` / `searchGuests` / `ensureGuestBlindIndex`; erase + `clearGuestProfileBlobs` DELETE |
| `apps/pms-core/src/property-do.ts` | `listReservationsByGuestRef` |
| `apps/pms-core/src/v1-dispatch.ts` | Three handlers; append three `V1_ROUTES` |
| `apps/pms-core/test/guests-routes.spec.ts` | List / search / 403 / 503 / erase-clears-index (Task 3) |
| `apps/pms-core/test/guests.spec.ts` | Backfill + writer index rows (Task 3) |
| `apps/pms-core/test/guest-stays-routes.spec.ts` | Stays GET (Task 3) |
| `packages/client-core/src/api.ts` | `listGuests` / `searchGuests` / `listGuestStays` / `getGuest` / `updateGuest` / `eraseGuest` (Task 4) |
| `packages/client-core/test/api-guest-crm.test.ts` | Client tests (Task 4) |
| `apps/web-pms/src/shell/nav.ts` | Guests order 36 |
| `apps/web-pms/src/App.tsx` | `/guests`, `/guests/:guestRef` |
| `apps/web-pms/src/screens/GuestsDirectoryScreen.tsx` (+ test) | Directory (Task 5) |
| `apps/web-pms/src/screens/GuestProfileScreen.tsx` (+ test) | Profile (Task 5) |
| `apps/web-pms/src/screens/guest-row.tsx` | `GuestNameLink` (Task 6) |
| `apps/web-pms/src/screens/BookingScreen.tsx` (+ test) | Find-existing (Task 6) |
| Board / tape / folio / reservations / exceptions / AppShell search | Chip → profile link (Task 6) |
| `apps/web-pms/src/auth/me.test.ts` | Nav id `guests` |
| Sibling specs | Pointers (Task 7) |

## Test file split (spec §15 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 route / catalog pins | `register.test.ts` | 3 |
| 3 schema / purge / denylist | `migrate.test.ts` + Task 8 CI | 2, 8 |
| 4–6 HMAC / rows / HKDF | `blind-index.test.ts` | 1 |
| 7–12 list / search / erase / backfill / 403 / 503 / outbox | `guests-routes.spec.ts` + `guests.spec.ts` | 3 |
| 13–14 stays | `guest-stays-routes.spec.ts` | 3 |
| client-core | `api-guest-crm.test.ts` | 4 |
| 15 nav / directory | `me.test.ts` + `GuestsDirectoryScreen.test.tsx` | 5 |
| 16 profile | `GuestProfileScreen.test.tsx` | 5 |
| 17 chip links | Board / tape / folio / `ExceptionsScreen.test.tsx` | 6 |
| 18 wizard | `BookingScreen.test.tsx` | 6 |
| 19–20 ddl / checks | Task 8 | 8 |
| Bidirectional pointers | sibling specs | 7 |

---

### Task 1: crypto-shredding blind-index helpers (own commit, no schema, no HTTP)

**Spec:** §5.1–§5.2, §15.4–15.6. Keep `check:permissions` green.

**Files:**
- Create: `packages/crypto-shredding/src/blind-index.ts`
- Create: `packages/crypto-shredding/src/blind-index.test.ts`
- Modify: `packages/crypto-shredding/src/index.ts` — re-export
- Test: `packages/crypto-shredding` vitest

**Interfaces:**

```ts
export type BlindIndexKind = 'name' | 'name_token' | 'email' | 'phone';

export async function importBlindIndexKeyHex(hex: string): Promise<CryptoKey>;
// Same HEX_RE as importMasterKeyHex (64 hex chars).
// Import raw as HKDF IKM (deriveKey only).
// deriveKey: { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8('hospai.guest-blind-index.v1') }
// → HMAC-SHA-256, 256-bit, usages ['sign'], extractable false.

export function normalizeBlindIndexValue(kind: BlindIndexKind, raw: string): string | null;
// name: NFKC, trim, collapse whitespace to U+0020, lowercase. Empty → null.
// name_token: same; UTF-16 length < 2 → null.
// email: trim, lowercase. Empty → null.
// phone: strip non-digits. Empty → null.

export async function blindIndexHash(
  key: CryptoKey,
  kind: BlindIndexKind,
  normalized: string,
): Promise<Uint8Array>;
// HMAC-SHA256(key, kind || 0x1f || utf8(normalized)). 32 bytes.

export async function blindIndexRows(
  key: CryptoKey,
  profile: GuestProfile,
): Promise<Array<{ kind: BlindIndexKind; hash: Uint8Array }>>;
// name from displayName; name_token per unique token of the normalized name;
// email / phone if present after normalize.
```

**Forbidden this commit:** `org-migrations.ts`, `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, `org-do.ts`, any SPA, `CLASS_DENYLIST`, new `export class`.

- [x] **Step 1: Write the failing tests**

In `blind-index.test.ts` use the same fixture hex as `vault.test.ts`:

```
00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
```

Cover spec §15.4–15.6:

1. Same normalized email (`Ada@Ex.com` vs `ada@ex.com`) → identical 32-byte hash.
2. `name` vs `email` for payload `"a@b.c"` → different hashes (domain separator).
3. `blindIndexRows({ displayName: 'Ada Lovelace', email: 'ada@ex.com', phone: '555-0100' })` → five rows (`name`, two `name_token`, `email`, `phone`). Phone hash uses digits `5550100`.
4. Missing email/phone omitted. `displayName: 'A'` → no `name_token` (length < 2); `name` row still present if the full normalized name is non-empty.
5. Two `importBlindIndexKeyHex` calls on the same hex produce HMAC keys that sign the same message identically.
6. `importBlindIndexKeyHex` is not `importMasterKeyHex` — wrapping an AES key with the HMAC key (or vice versa) is not required; assert the HMAC key `algorithm.name === 'HMAC'` and cannot be used as AES-GCM wrap (importMasterKeyHex key `algorithm.name === 'AES-GCM'`).

Also: `importBlindIndexKeyHex('nope')` throws the same class of error as a bad master hex (reuse `HEX_RE`).

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/crypto-shredding exec vitest run src/blind-index.test.ts
```

Expected: fail (module missing).

- [x] **Step 3: Implement helpers**

Functions only. Reuse `HEX_RE` by exporting it from `master-key.ts` **or** duplicate the 64-hex check in `blind-index.ts` — do **not** change `importMasterKeyHex` usages. Prefer exporting `HEX_RE` from `master-key.ts` if that file already has it as a module-local; if exporting it risks a public-API debate, duplicate the regex in `blind-index.ts`.

Do not add a class. Do not persist keys.

- [x] **Step 4: Re-export and build**

```bash
pnpm --filter @hospai/crypto-shredding exec vitest run src/blind-index.test.ts
pnpm --filter @hospai/crypto-shredding build
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add packages/crypto-shredding/src/blind-index.ts \
  packages/crypto-shredding/src/blind-index.test.ts \
  packages/crypto-shredding/src/index.ts \
  packages/crypto-shredding/src/master-key.ts
git commit -m "$(cat <<'EOF'
feat(crypto-shredding): guest blind-index HMAC helpers

EOF
)"
```

Omit `master-key.ts` if you did not export `HEX_RE`.

---

### Task 2: OrgDO v7 `guest_blind_index` (own commit, no HTTP routes)

**Spec:** §5 (DDL), §15.3 / §15.19 (schema pins). Keep `check:permissions` green.

**Files:**
- Modify: `packages/do-runtime/src/org-migrations.ts` — append version 7
- Modify: `packages/do-runtime/src/index.ts` — export `ORG_GUEST_BLIND_INDEX_SQL` / `_STATEMENTS`
- Modify: `packages/do-runtime/src/migrate.test.ts` — head 6→7; on-disk match; apply count
- Create: `packages/do-runtime/src/guest-blind-index-migration.sqlite.test.ts`
- Modify: `scripts/property-ddl.mjs` — import + `0007` target
- Create (via generate): `migrations/do-org/0007_guest_blind_index.sql`

**SQL (exact):**

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

Export pattern matches roster:

```ts
export const ORG_GUEST_BLIND_INDEX_STATEMENTS: string[] = [ /* two statements */ ];
export const ORG_GUEST_BLIND_INDEX_SQL =
  ORG_GUEST_BLIND_INDEX_STATEMENTS.join(';\n\n') + ';\n';
```

`ORG_MIGRATIONS` append:

```ts
{
  version: 7,
  name: '0007_guest_blind_index',
  statements: ORG_GUEST_BLIND_INDEX_STATEMENTS,
},
```

**Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, `org-do.ts` writer bodies, PropertyDO, SPA, `CLASS_DENYLIST`, any PropertyDO migration.

- [x] **Step 1: Write the failing tests**

In `migrate.test.ts`:

- `expect(migrateSql(sql, [...ORG_MIGRATIONS])).toBe(7);` (was 6).
- `expect(ORG_SCHEMA_HEAD).toBe(7);` (was 6). Keep `PROPERTY_SCHEMA_HEAD === 25`.
- Add `migrations/do-org/0007_guest_blind_index.sql matches ORG_GUEST_BLIND_INDEX_SQL` (copy the `0006_roster` on-disk test).
- Historical: leave any “org head is 6 after roster” as a `filter version <= 6` assertion if present; change **only** the global pin.

Real SQLite (`guest-blind-index-migration.sqlite.test.ts`), `PRAGMA foreign_keys = ON`:

1. Apply `ORG_MIGRATIONS` version ≤ 6. Insert a v2-shaped `data_key` + `guest` row (need a valid `pii_key_id` FK — copy a minimal insert from `guests.spec.ts` / roster sqlite tests).
2. Apply version 7. `SELECT COUNT(*) FROM guest_blind_index` is 0. Guest row still present.
3. Insert a hash row with the existing `guest_id` → OK.
4. `INSERT … kind='passport'` fails CHECK.
5. `INSERT … guest_id='missing'` fails FK.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/guest-blind-index-migration.sqlite.test.ts
```

Expected: head still 6 / file missing.

- [x] **Step 3: Implement migration + generator target**

Add statements + `ORG_MIGRATIONS` row. Export from `index.ts`. In `scripts/property-ddl.mjs`: destructure `ORG_GUEST_BLIND_INDEX_SQL` next to `ORG_ROSTER_SQL`; append a `targets` entry for `migrations/do-org/0007_guest_blind_index.sql` with the same header style as `0006_roster.sql`.

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
```

Expected: new `0007` file; **no** PropertyDO file changes (`git diff -- migrations/do-property` empty).

If MemorySql throws `Unhandled SQL` on `CREATE TABLE guest_blind_index` / `CREATE INDEX guest_blind_index_lookup`, add the prefixes the same way other CREATE TABLE/INDEX paths are accepted (generic handlers already cover these — only add prefixes if the test throws).

- [x] **Step 4: Re-run tests**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts src/guest-blind-index-migration.sqlite.test.ts
pnpm check:ddl
```

Expected: pass. `ORG_SCHEMA_HEAD === 7`. `PROPERTY_SCHEMA_HEAD === 25`.

- [x] **Step 5: Commit**

```bash
git add packages/do-runtime/src/org-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/guest-blind-index-migration.sqlite.test.ts \
  packages/do-runtime/src/schema-head.ts \
  scripts/property-ddl.mjs \
  migrations/do-org/0007_guest_blind_index.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): OrgDO v7 guest blind-index table

EOF
)"
```

`schema-head.ts` is derived — add it only if the file itself changed (it should not; it reads `ORG_MIGRATIONS`).

---

### Task 3: OrgDO RPCs + writer maintenance + stays + routes 124–126

**Spec:** §3, §5.3–§5.4, §6–§8, §15.1–2, §15.7–15.14. This is the server commit.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append three audit rows after `post_provisional_exception_note`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/org-do.ts`
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — three handlers; append three `V1_ROUTES` at **END** (after `handlePostProvisionalExceptionNote`)
- Modify: `apps/pms-core/test/guests-routes.spec.ts`
- Modify: `apps/pms-core/test/guests.spec.ts`
- Create: `apps/pms-core/test/guest-stays-routes.spec.ts`

**Audit rows (exact):**

```ts
{
  id: 'get_guests',
  scope: 'property',
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'post_guests_search',
  scope: 'property',
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_guest_stays',
  scope: 'property',
  permission: 'guests:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

No `commandId` on any of the three.

**Dispatcher patterns (append; identical order):**

```
GET   /^\/v1\/properties\/([^/]+)\/guests$/
POST  /^\/v1\/properties\/([^/]+)\/guests-search$/
GET   /^\/v1\/properties\/([^/]+)\/guests\/([^/]+)\/stays$/
```

Each: `permission: 'guests:read'`, `entitlement: 'pms.core'`. List/search handlers call OrgDO. Stays handler calls **PropertyDO only**.

**OrgDO RPCs:**

```ts
async listGuests(
  actor: Actor,
  propertyId: string,
  input: { cursor?: { createdAt: number; guestId: string }; limit: number },
): Promise<
  | { ok: true; items: Array<{ guestId: string; erased: false; profile: GuestProfile; createdAt: number }>; nextCursor: { createdAt: number; guestId: string } | null }
  | { ok: false; error: string }
>

async searchGuests(
  actor: Actor,
  propertyId: string,
  input: { q: string; cursor?: { guestId: string }; limit: number },
): Promise< /* same ok items shape; nextCursor { guestId } | null */ >

private async ensureGuestBlindIndex(scope: string | 'missing'): Promise<void>
```

Gate: `guests:read` + `gateCoreEntitlement` (same as `readGuest`). `limit` already clamped by HTTP (1–50, default 25).

Index key: cache like `vaultPromise` — `importBlindIndexKeyHex(this.env.HOSPAI_ORG_MASTER_KEY)` once per instance.

Writer maintenance (inside existing `transactionSync` execute, after guest INSERT/UPDATE):

```
DELETE FROM guest_blind_index WHERE guest_id = ?
-- INSERT one row per blindIndexRows() result
```

HMAC rows are computed **before** `transactionSync` (async). Erase: `DELETE FROM guest_blind_index WHERE guest_id = ?` even on already-erased success. `clearGuestProfileBlobs`: same DELETE, then existing cipher/iv zero.

`ensureGuestBlindIndex('missing')` at the start of `listGuests` and `searchGuests`: at most 25 live guests that have no index rows; decrypt via `readGuestEntry`; skip erased / `decrypt_unresolved` (log `guests.read.decrypt_incident`); write in `transactionSync` **without** `runIdempotent`.

**Search classify** (dispatcher or OrgDO — prefer OrgDO so HTTP stays thin): spec §7.1. Do **not** `logError` the raw `q`.

**List SQL / search SQL / stays SQL:** copy spec §6 / §7.2 / §8 exactly. SQLite tuple compare `(created_at, guest_id) < (?, ?)` is valid. If MemorySql/workerd rejects the tuple form, expand to the equivalent OR chain — do not change sort order.

**PropertyDO:**

```ts
async listReservationsByGuestRef(
  guestRef: string,
  input: { cursor?: { arrivalDate: string; reservationId: string }; limit: number },
): Promise<{
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
  nextCursor: { arrivalDate: string; reservationId: string } | null;
}>
```

`assertRpcAvailable`. Sync SQL. Use `reservation_guest_ref_idx`. **No OrgDO. No names. No `piiKeyId`.** Unknown `guestRef` → empty items.

**HTTP:**

- Reuse `encodeFrontDeskCursor` / `decodeFrontDeskCursor`. Invalid cursor → 400 `{ error: 'invalid_cursor' }`.
- Limit parser: default 25, max 50. Non-integer / `< 1` / `> 50` → 400 `{ error: 'invalid_limit' }`. Do **not** silently treat garbage as default (stricter than `parseOptionalFrontDeskLimit`).
- Search body: `{ q, cursor?, limit? }`. Trim `q`; empty or > 128 UTF-16 → 400 `{ error: 'invalid_query' }`.
- `GUEST_HEADERS = { 'Cache-Control': 'private, no-store' }` on all three 200/4xx PII responses (same class as roster GET). 503 degraded helper may keep its existing headers; if it lacks `no-store`, do not invent a second degraded helper — use `degradedFailClosedReadResponse()` as-is.
- Kill-switch / entitlement: existing `entitlementForRoute` pair (402 / 503). Missing permission → 403 `{ error: 'forbidden', permission: 'guests:read' }`.
- OrgDO transport on 124/125 → `degradedFailClosedReadResponse()`. PropertyDO transport on 126 → same.
- Stays 200 envelope: `{ ok: true, propertyId, guestId, scope: 'this_property', items, nextCursor }`. `nextCursor` is the **encoded** string or `null`.
- List/search 200: `{ ok: true, items, nextCursor }`. Do not echo `q`. Do not return `index_hash`.

**Forbidden this commit:** SPA, client-core, `CLASS_DENYLIST`, PropertyDO schema, catalog new ids, `GET …/guests?q=`, OrgDO call from stays handler.

- [x] **Step 1: Write the failing tests**

`register.test.ts` next to the `[123]` pin (add after the exception-note assertions):

```ts
expect(V1_HTTP_ROUTE_AUDIT[123]?.id).toBe('post_provisional_exception_note');
expect(V1_HTTP_ROUTE_AUDIT[124]?.id).toBe('get_guests');
expect(V1_HTTP_ROUTE_AUDIT[125]?.id).toBe('post_guests_search');
expect(V1_HTTP_ROUTE_AUDIT[126]?.id).toBe('get_guest_stays');
for (const i of [124, 125, 126] as const) {
  expect(V1_HTTP_ROUTE_AUDIT[i]).toMatchObject({
    scope: 'property',
    permission: 'guests:read',
    entitlement: 'pms.core',
    degradedRead: 'FAIL_CLOSED',
  });
  expect('commandId' in (V1_HTTP_ROUTE_AUDIT[i] ?? {})).toBe(false);
}
expect(COMMAND_CATALOG).toHaveLength(77);
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(52);
expect(PLATFORM_GAPS).toEqual([]);
for (const id of ['guests.search', 'guests.get_profile', 'guests.merge', 'guests.update_consent'] as const) {
  expect(COMMAND_CATALOG.find((c) => c.id === id)).toBeUndefined();
}
```

`guests-routes.spec.ts` (new cases; keep 1–19):

- **20:** create Ada with email + phone → `GET …/guests` 200, one item, `profile.displayName`, no cipher fields, `nextCursor` null, `Cache-Control` includes `no-store`.
- **21:** 26 creates → first page `limit=25` has `nextCursor`; second page no overlap; union is 26.
- **22:** `POST …/guests-search` `{ q: 'Ada' }` hits. `{ q: 'Ad' }` → `{ items: [] }`. Email `q` hits. Digit phone hits. After erase: list/search empty; `GET …/guests/:id` tombstone.
- **23:** PATCH email → old email search empty, new hits. After erase, `guest_blind_index` count for that id is 0 (OrgDO test hook or SQL via existing unsafe-local helper — add `countGuestBlindIndexForTest(guestId)` next to `verifyGuestKeyShredded` if needed). Second erase 200, still 0.
- **24:** staff without `guests:read` (if a role exists) or a stripped grant → 403. Kill-switch 402/503 pair (copy test 17/18). OrgDO transport block → 503 FAIL_CLOSED. `{ q: '' }` and 129-char `q` → 400 `invalid_query`. `cursor=%%%` → 400 `invalid_cursor`.
- Outbox create payload still has no `displayName` / `email` / `phone` (existing test 1; keep it).

`guests.spec.ts`:

- Insert a live guest **without** index rows (direct SQL after create, or create-then-`DELETE FROM guest_blind_index`). `listGuests` backfills ≤25; subsequent `searchGuests` hits.
- `decrypt_unresolved` guest is omitted from list items, not a thrown 500 (force via shredded key without `erased_at` if a hook exists — otherwise skip this branch and keep M4 as the HTTP incident for `[42]` only).

`guest-stays-routes.spec.ts`:

- Two reservations for `g1`, one for `g2`. `GET …/guests/g1/stays` returns two, newest `arrival_date` first, no `displayName` / `piiKeyId`, `scope: 'this_property'`. Cursor pages. Unknown id → `{ items: [] }` 200. Erase `g1` (OrgDO) → stays still 200.
- PropertyDO transport block → 503. Handler source: `handleGetGuestStays` must not reference `resolveOrgStub` / `readGuest`.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/guests-routes.spec.ts test/guest-stays-routes.spec.ts
```

Expected: route pins fail; new HTTP cases 404.

- [x] **Step 3: Implement RPCs + handlers + routes**

Follow spec §5.3–§8. After contracts edit:

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/crypto-shredding build
```

Then implement. `pnpm check:permissions` must stay green (audit zip = `V1_ROUTES` order).

- [x] **Step 4: Re-run tests**

```bash
pnpm check:permissions
pnpm check:degraded
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/guests-routes.spec.ts test/guests.spec.ts test/guest-stays-routes.spec.ts
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/org-do.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/guests-routes.spec.ts \
  apps/pms-core/test/guests.spec.ts \
  apps/pms-core/test/guest-stays-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): guest directory search and stay history reads

EOF
)"
```

---

### Task 4: client-core methods (own commit, no SPA)

**Spec:** §14 client row; profile compose uses `[42]` + `[126]`; directory uses `[124]` / `[125]`; edit/erase reuse `[40]` / `[41]`.

**Files:**
- Modify: `packages/client-core/src/api.ts`
- Create: `packages/client-core/test/api-guest-crm.test.ts`

Today `api.ts` has `createGuest` and `postGuestsBatch` only. Add:

```ts
async listGuests(propertyId: string, query?: { cursor?: string; limit?: number })
// GET /v1/properties/:pid/guests?cursor=&limit=

async searchGuests(propertyId: string, body: { q: string; cursor?: string; limit?: number })
// POST /v1/properties/:pid/guests-search  JSON body — q never as a query param

async listGuestStays(propertyId: string, guestId: string, query?: { cursor?: string; limit?: number })
// GET /v1/properties/:pid/guests/:guestId/stays

async getGuest(propertyId: string, guestId: string)
// GET /v1/properties/:pid/guests/:guestId   (existing [42])

async updateGuest(propertyId: string, guestId: string, input: { displayName: string; email?: string; phone?: string }, opId: string)
// PATCH …/guests/:id  + stableKeyForOperation

async eraseGuest(propertyId: string, guestId: string, opId: string)
// POST …/guests/:id/erase
```

Use existing `getJson` + `enc`. Types: inline or next to `GuestRowState` — do not invent a `packages/ui-kit` type.

- [x] **Step 1: Write the failing client tests** (fetch mock / existing api test pattern — copy `api-exception-workbench.test.ts` or `api-front-office-board.test.ts`)
  - `listGuests` hits `GET …/guests` with cursor query, not POST.
  - `searchGuests` hits `POST …/guests-search` with `{ q }` in the body; URL has no `q=`.
  - `listGuestStays` / `getGuest` are GETs.
  - `updateGuest` / `eraseGuest` send `idempotencyKey` from `stableKeyForOperation`.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-guest-crm.test.ts
```

- [x] **Step 3: Implement + build**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-guest-crm.test.ts
pnpm --filter @hospai/client-core build
```

- [x] **Step 4: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/test/api-guest-crm.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): guest CRM list, search, stays, and profile methods

EOF
)"
```

---

### Task 5: SPA directory + profile + nav

**Spec:** §10.1–§10.3, §15.15–15.16.

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts` — insert `{ id: 'guests', label: 'Guests', path: '/guests', order: 36, permission: 'guests:read' }`
- Modify: `apps/web-pms/src/App.tsx` — two routes under `AppShell`
- Create: `apps/web-pms/src/screens/GuestsDirectoryScreen.tsx`
- Create: `apps/web-pms/src/screens/GuestsDirectoryScreen.test.tsx`
- Create: `apps/web-pms/src/screens/GuestProfileScreen.tsx`
- Create: `apps/web-pms/src/screens/GuestProfileScreen.test.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts` — live `guests:read` includes `guests` at order 36; without the grant, omitted
- Modify: `apps/web-pms/src/shell/AppShell.boot.test.tsx` only if a heading pin lists nav ids

**Directory (`/guests`):**

- URL `?q=&cursor=` is source of truth (`replace` on search change).
- Empty `q` → `api.listGuests`. Non-empty → `api.searchGuests({ q })` (body). Debounce 300 ms.
- Search field: `role="search"`, `type="search"`, `name="guest-search"`, `autoComplete="off"`, `spellCheck={false}`, visible label “Name, email, or phone”, `placeholder="Ada Lovelace, ada@…, or 5550100…"`, `data-testid="guest-directory-search"`.
- `h1` Guests. Results `aria-live="polite"`. Loading “Loading…”. Empty “No guests yet.” / “No guests match that search.”
- Fail-closed: “Guest directory unavailable — organization unreachable.”
- Table: name is `<Link to={/guests/:guestId} data-testid="guest-profile-link">`, email, phone, created (`Intl.DateTimeFormat`, `tabular-nums`). `guestId` `translate="no"`. `truncate` + `min-w-0`.
- Next uses `nextCursor` (write into URL). No offset math.
- Existing tokens only. `prefers-reduced-motion` on any spinner.

**Profile (`/guests/:guestRef`):**

- Parallel `getGuest` + `listGuestStays`.
- `h1` = displayName or `guestRef`. Contact dl; omit missing email/phone.
- PII panel: Live / Erased. Erase (`guests:erase`) confirmation modal (`overscroll-behavior: contain`). Copy from spec §10.3. Confirm “Erase guest”.
- Stays table: folio `<Link>`, dates, `statusClass`, room, `badge-vip` / `badge-dnd`, party size. Caption “Stays at this property.” Empty “No stays at this property.” Stays 503: “Stay history unavailable — property unreachable.” Contact 503: do not invent a name from stays.
- Edit (`guests:write`) uses `updateGuest`. Book for guest → `/book?guestRef=`. No merge button. No consent row.
- Unsaved edit: `beforeunload` / router guard. Submit enabled until request starts; then “Saving…”.
- `data-testid`: `guest-profile`, `guest-erase`, `guest-stays`, `guest-book`.

**Forbidden this commit:** chip-link sweep on board/tape (Task 6), wizard find box (Task 6), leftover spec pointers, `ui-kit`.

- [x] **Step 1: Write the failing SPA tests**
  - `me.test.ts`: staff with `guests:read` sees `guests` order 36 between `reservations` and `book`; without grant, absent.
  - Directory: empty state; type “Ada” calls `searchGuests` not `listGuests`; click name → `/guests/g1`.
  - Profile: contact + stay folio link + Book href; erase confirm then tombstone; queryByText `/merge/i` and `/consent/i` null.

- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/auth/me.test.ts src/screens/GuestsDirectoryScreen.test.tsx src/screens/GuestProfileScreen.test.tsx
```

- [x] **Step 3: Implement screens + nav + routes**
- [x] **Step 4: Re-run tests**
- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/App.tsx \
  apps/web-pms/src/screens/GuestsDirectoryScreen.tsx \
  apps/web-pms/src/screens/GuestsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/GuestProfileScreen.tsx \
  apps/web-pms/src/screens/GuestProfileScreen.test.tsx \
  apps/web-pms/src/auth/me.test.ts \
  apps/web-pms/src/shell/AppShell.boot.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): guest directory and profile screens

EOF
)"
```

Omit `AppShell.boot.test.tsx` if unchanged.

---

### Task 6: Chip links + wizard find-existing (folded leftovers 4–6)

**Spec:** §11.4–§11.6, §15.17–15.18.

**Files:**
- Modify: `apps/web-pms/src/screens/guest-row.tsx` — add `GuestNameLink({ state, guestRef })` wrapping `guestLabel` in `<Link to={/guests/:guestRef} data-testid="guest-profile-link">`. Keep `guestLabel` exported.
- Modify: `BoardScreen.tsx`, `TapeChartScreen.tsx`, `FolioScreen.tsx`, `ReservationsDirectoryScreen.tsx`, `ExceptionsScreen.tsx`, `AppShell.tsx` (search popover) — use `GuestNameLink` (or equivalent `<Link>`) for the guest cell / hit. Keep “Book for guest” → `/book?guestRef=`.
- Modify: `ExceptionsScreen.test.tsx` — invert “no guest CRM href”: when `affected.guestRef` is set, expect `a[href="/guests/g1"]`.
- Modify matching Board / tape / folio / directory / AppShell search tests so the guest name is a link.
- Modify: `BookingScreen.tsx` — Guest step search field `data-testid="guest-find"`. Debounced `searchGuests`. Pick a hit → `setContextGuestRef(hit.guestId)` (context mode; **no** `createGuest`). Miss / skip → existing create-default. Do **not** substring-filter client-side.
- Modify: `BookingScreen.test.tsx` — find “Ada” → pick → Confirm does not call `createGuest`; `createReservation` uses that `guestRef`. Skip search + type a new name → create-default still works.

**Forbidden:** merge UI, consent UI, changing `[105]` reservation-search, WebSocket work.

- [x] **Step 1: Write / flip the failing tests**
- [x] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run \
  src/screens/ExceptionsScreen.test.tsx \
  src/screens/BoardScreen.test.tsx \
  src/screens/TapeChartScreen.test.tsx \
  src/screens/FolioScreen.test.tsx \
  src/screens/ReservationsDirectoryScreen.test.tsx \
  src/shell/AppShell.search.test.tsx \
  src/screens/BookingScreen.test.tsx
```

- [x] **Step 3: Implement links + wizard find**
- [x] **Step 4: Re-run tests**
- [x] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/guest-row.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx \
  apps/web-pms/src/screens/BoardScreen.test.tsx \
  apps/web-pms/src/screens/TapeChartScreen.tsx \
  apps/web-pms/src/screens/TapeChartScreen.test.tsx \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.tsx \
  apps/web-pms/src/screens/ReservationsDirectoryScreen.test.tsx \
  apps/web-pms/src/screens/ExceptionsScreen.tsx \
  apps/web-pms/src/screens/ExceptionsScreen.test.tsx \
  apps/web-pms/src/screens/BookingScreen.tsx \
  apps/web-pms/src/screens/BookingScreen.test.tsx \
  apps/web-pms/src/shell/AppShell.tsx \
  apps/web-pms/src/shell/AppShell.search.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): guest profile links and wizard find-existing

EOF
)"
```

Add any other screen test files you actually edit.

---

### Task 7: Bidirectional leftover pointers (docs only)

**Spec:** Amends blurb. **When this chunk lands** — this is that commit. Do not mix typecheck fixes.

**Files (one sentence each, do not rewrite):**
- `docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md` — leftover **2** closed by guest CRM directory spec
- `docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md` — leftovers **15** and **21** closed
- `docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md` — leftover **3** closed; §11 `guestRef` now links to `/guests/:guestRef`
- `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` — §2.2 destination C (equality blind index) closed; create-default remains the miss path

Optional one sentence in `ARCHITECTURE.md` §16.3 that the guests CRM directory now has a live SPA (do **not** claim tags / LTV shipped).

Pointer sentence example:

```markdown
**Closed 2026-08-13** by [guest CRM directory](./2026-08-13-guest-crm-directory-design.md).
```

- [x] **Step 1: Edit pointers**
- [x] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-prototype-holes-sweep-design.md \
  docs/superpowers/specs/2026-08-13-tape-chart-live-board-design.md \
  docs/superpowers/specs/2026-08-13-exception-queue-workbench-design.md \
  docs/superpowers/specs/2026-08-11-booking-wizard-design.md \
  ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: point leftover specs at the guest CRM directory

EOF
)"
```

Omit `ARCHITECTURE.md` if you skip the optional §16.3 sentence.

---

### Task 8: CI / checks job

**Spec:** §2 invariants, §15.1–3, §15.19–20, §17.

- [x] **Step 1: Hygiene pins**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
git diff --exit-code -- migrations/do-property packages/do-runtime/src/property-migrations.ts
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
```

Expected: PropertyDO ddl no-op. Org `0007` already committed in Task 2 (no further drift). `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. `PROPERTY_GUEST_PII_COLUMNS` only `billed_party`. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `[123]=post_provisional_exception_note`; `[124]`–`[126]` as spec. `CLASS_DENYLIST` untouched.

- [x] **Step 2: `checks` job — copy `.github/workflows/ci.yml` in order**

```bash
pnpm install
pnpm build
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
```

Expected: all exit 0.

- [x] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 9: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–9 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [x] **Step 1: Mark checkboxes**
- [x] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-guest-crm-directory.md
git commit -m "$(cat <<'EOF'
docs: tick guest CRM directory plan checkboxes after merge

EOF
)"
```

---

## Spec §18 acceptance / reviewer checklist (copied; implementation must satisfy)

- [x] Verified-current-state table matches the tree (route **124**, catalog **77**, org head **6→7**, property head **25**, no new commands).
- [x] Normative invariants include integer money, append-only folio, schema-freeze (no PropertyDO PII table), Rule 3/events-by-ref, no new `export class`, no new PropertyDO purge table, route audit append-only.
- [x] Command decision is explicit: existing reads/writes suffice; `guests.search` / `get_profile` are HTTP-only; `merge` / `update_consent` deferred.
- [x] Blind index is OrgDO HMAC only; PropertyDO stays `guest_ref`; erase deletes hashes.
- [x] Routes **124–126** named with method, path, permission, entitlement, `FAIL_CLOSED`.
- [x] Scope-out names every required exclusion (virtual types, derived rates, `rooms.delete`, tape/WS, property setup, `ui-kit`, city ledger / invoices / auto-transfer / recurring / partial refunds, PCI, `READ_STALE` reclass, PropertyDO PII tables, guest portal).
- [x] Folded leftovers named (spec §11). Deferred leftovers named (spec §12).
- [x] Acceptance / reviewer checklist present.
- [x] Three routes appended at **124–126** only; `[123]` / `[39]`–`[42]` / `[65]` unmoved.
- [x] Catalog **77**; no `guests.search` / `merge` / `update_consent` / `get_profile` command ids; audit writers **52**; `PLATFORM_GAPS` [].
- [x] Org v7 `guest_blind_index` only; **no PropertyDO table**; purge list unchanged; `NIGHT_AUDIT_STEPS` 7; no new `export class`.
- [x] Search is POST-body equality + tokens; list is GET cursor; stays are PropertyDO-only; `[42]` reused for contact.
- [x] Nav Guests `/guests` order 36. Profile compose. Chip links. Wizard find-existing. Exception href flipped.
- [x] Guest reads `FAIL_CLOSED`. No `READ_STALE` reclass. No WebSocket work. No ui-kit. No merge / consent UI.
- [x] Tests spec §15 green. Pointers Task 7 landed.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| HKDF/HMAC helpers, no new `export class` | 1 |
| Org v7 table + ddl + real SQLite; PropertyDO head 25 | 2 |
| Writer + erase + purge blob-clear maintain hashes; lazy backfill | 3 |
| Routes 124–126; `[123]` / `[39–42]` / `[65]` untouched | 3 |
| `listGuests` / `searchGuests` OrgDO; stays PropertyDO; no fan-out | 3 |
| client-core methods including missing `getGuest` / update / erase | 4 |
| `/guests` + `/guests/:guestRef` + nav order 36 | 5 |
| Chip links + wizard find-existing + exception href | 6 |
| Leftover pointers | 7 |
| Full CI, org 7, catalog 77, no new class/PropertyDO table | 8 |
| Plan checkboxes | 9 |
| No merge / consent / LTV / WS / ui-kit / `[105]` rewrite | all (forbidden) |
