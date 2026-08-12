# Staff Roster (OrgDO)

**Date:** 2026-08-12  
**Status:** Accepted — implementation-ready  
**Sources:** ARCHITECTURE.md §4.8 (Staff-class PII, per-staff keys, permission split, exit ≠ deletion, statutory retention), §16.1 (housekeeper roster as the prototype surface; maintenance as a separate worker surface), §16.3 rule 4 (record prototype divergence), §16.5 (prototype coverage audit: core HK — roster, assignment, inventory, manager priorities — is in Phase 1; extra HK tabs are out unless named); [housekeeping module mechanism](./2026-08-11-housekeeping-module-mechanism-design.md) (`assignee_ref` pin, assign UI deferred, `housekeeping.staff_*` notes); [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md) (opaque assignee, staff scoped out); [guests + crypto-shredding](./2026-07-28-guests-crypto-shredding-design.md); [guests / PII vertical](./2026-08-06-guests-pii-vertical-design.md) (`tryCreateGuest` prepare-outside / re-check-inside; `gateGuestRef`); [staff management SPA](./2026-08-10-staff-management-spa-design.md) (membership, not roster); [purge workflow](./2026-08-12-purge-workflow-design.md) (org churn `deleteAll()`, certificate `org_do: reached`, `PITR_LIMITATION` only)

**Implementation order:** (1) contracts (rename, permissions, notes, events) + OrgDO schema/triggers + vault `StaffProfile` → (2) OrgDO RPCs + `tryEraseGuest` isolation test → (3) `gateStaffRef` / `gateGuestRef` `org_unreachable` union + assign preamble + dual degraded HTTP/replay tests → (4) HTTP roster routes + strip → (5) housekeeping picker + roster SPA.

**Vehicle:** the Staff-class record, not an OrgDO module extraction. Guests remain the better vehicle for that (gate-trust already names it).

---

## 1. Context & Motivation

Four catalogued roster commands are unrouted. `assignee_ref` is pinned to `^staff_[A-Za-z0-9_-]+$` and nothing mints those ids, so the housekeeping board’s assign affordance is still deferred. `KeyScope = 'staff'` and `data_key`’s `CHECK (scope IN ('guest','staff'))` have been reserved since crypto-shredding; staff provisioning is test-only (`testProvisionStaffKey` / `testStaffRoundTrip`). `StaffScreen.tsx` is membership — Clerk grants, not employment records.

This is the first Staff-class PII surface. It is not the first OrgDO module. Using the roster to prove both at once is the anti-pattern the housekeeping module chunk refused: a mistake in module shape and a mistake in domain would be harder to separate.

The mechanical problem is already solved. `tryCreateGuest` prepares async crypto **outside** `transactionSync`, then re-checks and commits inside. The re-check is load-bearing: the `await` yields the DO’s I/O gate, so state can change between pre-check and commit. Roster writes copy that pattern. They do not extend `ModuleTxnCtx`.

### 1.1 Where the record lives

**OrgDO, guest-shaped, outside `pms.housekeeping`.** Per-staff keys already live in OrgDO; §4.8 requires the encrypted employment record under those keys; ciphertext and key stay colocated, same as `guest`. The housekeeping module stays PropertyDO-only (room status, assign, board). It consumes `staff_…` refs the way reservations consume `guest_ref`.

Rejected: extending the module contract to OrgDO this chunk (first Staff-class PII × first OrgDO module). Rejected: a PropertyDO operational projection of skills/status (plaintext that can outlive the key lifecycle; a hotel roster is tens of rows — decrypt-on-list is enough).

Catalog prefixes are **domain namespaces, not module ids**. `guests.create` is not a module command. Location does not, by itself, force a rename.

### 1.2 What the record is

**An org-wide staff record with a `kinds` set on one identity, not a housekeeper table.**

§16.1 files “Housekeeper roster” under Housekeeping and lists Maintenance as its own worker surface. §4.8 describes the class as Staff — name, contact, hourly rate, rating, skills, shift history — and uses housekeepers only as the concrete exposure. The key scope is `'staff'`. The `assignee_ref` pin chose `staff_` over `hk_` because §4.8 keys per staff identity, not per role: the same person can be a housekeeper and something else.

A housekeeper-only roster contradicts that pin. Maintenance would then need a second table, a second key-scope story, a second permission split, and a second pseudonymize-on-exit path. A single-valued `kind` column would give a dual-role person two rows, two `staff_…` ids, two keys — the per-role identity the pin rejected, reintroduced as schema.

That requires `kinds` to be a **set on one `staff_…` identity**, not a second row. Schema and the command that mutates the set: §2.1.

Housekeeping **filters** the org-wide list (`kind = 'housekeeper'`) for the assign picker. It does not own the parent row. Phase 1 ships `housekeeper` as the only permitted member; adding `maintenance` later is a freeze-gate rebuild of `roster_kind` (§2.1), not a new table. Per-property roster membership is out — Phase 1 list is org-wide.

**Roster ≠ membership.** Membership is Clerk login (`user_…`, `member` / `property_member`, commands `staff.add` / `staff.update` / `staff.delete`). Roster mints `staff_…` employment records. A housekeeper does not need a PMS account; a Clerk member does not automatically become assignable. Do not wire roster to Clerk.

### 1.3 Naming

`staff.*` is taken by membership. `housekeeping.staff_*` collides with that family and names a housekeeper table we are not building. The namespace follows from what the record is:

**`roster.*`** — `roster.add`, `roster.update`, `roster.status`, `roster.exit`.

`prototypeAction` values stay the prototype names (`ADD_HOUSEKEEPER`, …, `DELETE_HOUSEKEEPER`) as recorded divergence (§16.3 rule 4). Exit is not deletion.

Events rename in the same breath. `staff.housekeeper_changed` is housekeeper-specific and sits in the membership `staff.` namespace (`staff.changed`). It has never been emitted (unrouted; `event-consumer.ts` is a stub allowlist). After this chunk, R2 archives events permanently. Replace with guest-shaped OrgDO outbox events: `roster.created` / `roster.updated` / `roster.exited`. Payload is refs only (`orgId`, `staffRef`, `piiKeyId`) via `appendOrgOutbox`, same as guests. Status changes emit `roster.updated`.

### 1.4 Tenant purge vs statutory retention

§4.8: staff data follows statutory employment retention, often years, and is explicitly not the guest-erasure path. Org churn `deleteAll()`s the OrgDO, roster included; the certificate records `org_do: reached`.

**That is correct, and it is a legal position, not an implementation accident.** Retention sits with the employer. A departing tenant takes the records with them. The platform does not keep employment files after the org is gone. Guest erasure still must not touch staff keys.

**No certificate change.** `limitations[]` is only `PITR_LIMITATION`. Destroying employment records on tenant churn is already in scope of `org_do: reached`. Do not add a store, a `retained` row, or a note.

Guest/staff shred isolation is proven at the primitive (`vault.test.ts`: shreds guest keys without touching staff keys) and at a test-hook DO path (`guests.spec.ts` test 3: `testShredGuestKey` + `testProvisionStaffKey`, no staff row). This chunk adds the reachable equivalent: `tryEraseGuest` on an org that holds a live roster row leaves the staff key and ciphertext intact.

### 1.5 Scope in

1. OrgDO `roster` + `roster_kind`, guest-shaped (id + `pii_key_id` + cipher/iv + tombstone + kinds set). First triggers in any `do-org` migration (`check:ddl` generates from `org-migrations.ts`).
2. OrgDO RPCs for `roster.*`, using prepare-outside / re-check-inside. No `ModuleTxnCtx` change. No housekeeping-module schema/writes change for this table.
3. Reclassify `roster.add` / `roster.status` / `roster.update` to `FAIL_CLOSED` (exit already is, as `housekeeping.staff_delete`). Every OrgDO catalog command is `FAIL_CLOSED`; `REPLAY_DISPATCH` is PropertyDO-only; `check:degraded` requires a replay entry for every HTTP-routed `QUEUE_PROVISIONAL` command. Current `QUEUE_PROVISIONAL` is a prototype-catalog artifact from before DO ownership was chosen. Same notes family as `guests.create` (OrgDO sits on `requirePermission` → `assertPermission`; add is read-your-write because the client needs a minted `staff_…`; minting a key at replay is as sensitive as shredding one). `entitlement: 'pms.core'`; drop the `housekeeping.staff_delete` opt-out; four audit-writer exemptions (OrgDO home, same reason as `guests.*`).
4. Mint `staff_…` ids at add. Unblock the housekeeping board assign picker (list filters kind = housekeeper).
5. Permission split: compensation/performance gated separately from the operational roster. Assigning a room does not require seeing pay.
6. Exit = re-seal identity off the blob; keep the key. No platform-enforced retention window this chunk — `exited_at` starts the employer’s clock; the row remains until tenant purge.
7. `tryEraseGuest` isolation test against a live roster row.
8. `gateGuestRef` gains the same `org_unreachable` result-union treatment as `gateStaffRef` (live 500 on `reservations.create` today).
9. Roster management SPA (not a section on the membership Staff screen). Rewrite `HOUSEKEEPING_STAFF_FAMILY_NOTES` → `ROSTER_FAMILY_NOTES`.

### 1.6 Scope out

- Extending the module mechanism to OrgDO; extracting guests into a module.
- Shift scheduling (§16.1 “shifts” is its own vertical).
- Maintenance/work orders (kind value later; not a second roster).
- Compensation reporting; Iceberg-side analytics.
- Per-property roster membership.
- Wiring roster rows to Clerk `user_…`.
- Changing org-churn `deleteAll()` or adding a certificate store for employment records.
- Fixing `requirePermission` OrgDO 500 (property-me leftover #11).

---

## 2. Field split, `kinds` cardinality, exit

Two questions are the same question: what can the list filter without holding the key, and can one person be a housekeeper and something else without a second identity.

### 2.1 `kinds` is a set on one identity

```sql
CREATE TABLE roster (
  staff_id         TEXT PRIMARY KEY,
  pii_key_id       TEXT NOT NULL,
  profile_cipher   BLOB NOT NULL,
  profile_iv       BLOB NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  exited_at        INTEGER,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
);

CREATE TABLE roster_kind (
  staff_id  TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('housekeeper')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
);
```

Phase 1’s permitted member is `housekeeper` only. The set can have one element. Adding `maintenance` later is a **table rebuild** (create-copy-drop-rename), not `ALTER` — SQLite cannot modify a `CHECK`. Same freeze-gate shape as `reservation` v5 → v7 → v8 → v11. Still not a second table or a second key.

A JSON column on `roster` would make “we’ll just store one for now” the path of least resistance. The child table is the cardinality.

Add rejects an empty set (a row with no capabilities is unfilterable and unassignable).

**Who mutates `kinds`:** `roster.add` requires `kinds` (non-empty, every member permitted). **`roster.update` owns the set:** optional `kinds` on the payload is a **full replace** of `roster_kind` (still non-empty, still permitted members). Omitting `kinds` leaves the child rows unchanged.

Phase 1’s only permitted member is `housekeeper`, so the dual-role write cannot succeed yet — two distinct kinds is a 422 / CHECK abort until the freeze-gate rebuild. The command surface is a set from day one; adding `maintenance` does not grow a new command. That is how §1.2’s cardinality argument is cashed by the API.

### 2.2 The guest line, drawn for staff

Guests: `guest_id` + `pii_key_id` plaintext; profile encrypted. Encrypt everything and the roster cannot list active housekeepers. Encrypt nothing and you have built the §4.8 exposure (`hourlyRate`, `rating`, `skills` next to the name).

**Plaintext (queryable, no key):**

| Column | Role |
|---|---|
| `staff_id` | PK; the `assignee_ref` the pin describes |
| `pii_key_id` | FK to `data_key` |
| `roster_kind.kind` | assignment eligibility |
| `status` | `active` \| `inactive` (`roster.status`); picker lists `active` |
| `exited_at` | tombstone; exit ≠ delete. `NULL` = present |
| `created_at` / `updated_at` | |

**Encrypted (`profile_cipher` / `profile_iv`, `StaffProfile` JSON):**

```ts
type StaffProfile = {
  displayName?: string;          // absent after exit
  email?: string;
  phone?: string;
  hourlyRateMinor?: number;      // integer minor units, never float
  hourlyRateCurrency?: string;   // ISO; required if hourlyRateMinor set
  rating?: number;
  skills?: string[];             // HR / performance — not kinds
};

type StaffProfileCreate = StaffProfile & { displayName: string };
```

`StaffProfileCreate` is the add/update-while-employed input — omitting `displayName` is a compile error, not a 422. At-rest / post-exit decrypt is `StaffProfile` (all optional). `prepareProfileSeal` / `prepareGuestRecord` become generic over a profile type (they already `JSON.stringify`; the `GuestProfile` parameter is the lie). Add takes `StaffProfileCreate`.

Names stay encrypted at rest. A hotel roster is tens of rows: list decrypts, then strips by permission (§3). Do not add a plaintext `display_name` for the picker.

**The compensation split is application-level, not cryptographic.** One blob, one key. Anyone who unwraps it sees `hourlyRateMinor` and `rating` next to `displayName`. §4.8 asks for permission-gating, not separate encryption. The strip is **security-critical**: a test on the operational path asserts `hourlyRateMinor` / `hourlyRateCurrency` / `rating` / `skills` are absent **regardless of what the blob contains**. The guarantee must not live in an unwatched `delete obj.hourlyRateMinor`.

When compensation fields cross HTTP, they are `Money` from `packages/money` (`money(hourlyRateMinor, currencyCode(hourlyRateCurrency))`), not a raw minor+string pair. Rule 6 binds the boundary; loose JSON is at-rest only.

### 2.3 Skills are not kinds

§4.8 lists `skills` with `hourlyRate` and `rating` as the exposure — compensation and performance, permission-gated separately from the roster. §16.1’s “shifts/skills/capacity” is the prototype operational surface; shifts and capacity are out of this chunk, and operational matching tags (“suites”, “linen”) are not this chunk either.

**`kinds`** = which verticals may assign this person (plaintext set).  
**`skills`** = HR/performance inside the encrypted blob. The assign picker does not filter on it. Do not name the discriminator `skills`.

If a later chunk needs operational skill tags for matching, that is a new plaintext column (or table), not a decrypt of this field.

### 2.4 What the operational list can filter

Without the key, SQL can answer: active, not exited, kind = housekeeper. That is the assign picker. Display names come from decrypt-on-list. Pay, rating, skills, and contact never appear on that path.

### 2.5 Exit = re-seal identity off the blob; keep the key

Shredding the staff key is forbidden: the profile blob **is** the employment record §4.8 says follows statutory retention. Destroying the key destroys what retention requires.

| Option | What it is | Verdict |
|---|---|---|
| **A. Re-seal** | Decrypt, drop `displayName` / `email` / `phone`, re-encrypt remaining employment fields under the same key; set `exited_at` | **This chunk** |
| **B. Two blobs, two keys** | Identity key shredded; employment key retained. Makes exit *and* the compensation split cryptographic | Rejected |
| **C. Tombstone + ACL** | Blob unchanged; we just stop showing the name | Rejected |

**C** is policy-true, not pseudonymization. A dump plus master key plus wrapped staff key still yields the name. §4.8 says the identity *is* pseudonymized.

**B** is the only cryptographically-true shred of identity. It also doubles the key story: `KeyScope` is `CHECK (scope IN ('guest','staff'))` and `data_key_active_subject` is unique on `(scope, subject_id) WHERE shredded_at IS NULL` — a second live staff key is a `data_key` rebuild (same freeze-gate as §2.1) plus a new envelope primitive, inside the first Staff-class PII chunk. §4.8 asked for permission-gating of compensation, not a second key. Decline. It remains the argument that would make §2.2 cryptographic; leftover if a DPA requires it.

**A.** `roster.exit` is a write, not a shred:

1. Prepare-outside / re-check-inside, same as update.
2. Decrypt; omit `displayName`, `email`, `phone` (absent keys, not empty strings).
3. Re-seal whatever employment fields remain (`hourlyRateMinor` / currency / `rating` / `skills`).
4. Same transaction: `exited_at = now`, `status = 'inactive'`, replace cipher/iv, `appendOrgOutbox` `roster.exited` with refs only.
5. Second exit is idempotent success in **application code**, same as `tryEraseGuest`: if `exited_at != null`, return `{ ok: true, … }` **before** opening the write (and before any re-seal). The trigger’s job is to make the invalid transition impossible; a replay that reaches SQL would `RAISE(ABORT)` rather than succeed.
6. `roster.update` / `roster.status` after exit: application check returns `staff_exited` (HTTP 409). The trigger is the backstop, not the 409 — without the check, `RAISE(ABORT)` becomes an opaque SQL error on the generic path.

The employment record is those retained **fields**, not the ciphertext bytes. AES-GCM re-seal changes the IV; statutory retention does not care. After exit the blob is frozen (trigger below). `staff_id` is the remaining identifier — the pseudonym audit logs and `assignee_ref` already carry.

Every `StaffProfile` employment field is optional, so a row created with only `displayName` re-seals to `{}`. That is intended: a valid AES-GCM of `{}` satisfies `profile_cipher BLOB NOT NULL`, and the row is a pure pseudonymous tombstone. Do not refuse exit on thin records.

**Retention window:** none enforced this chunk. `exited_at` starts the employer’s clock; the row remains until tenant purge (`deleteAll()`, §1.4). Jurisdiction-specific destruction after N years is a later entitlement (ARCHITECTURE: retention policy per data class as an entitlement). Do not invent a number of years.

PITR can restore the pre-exit identity-bearing ciphertext — same class as guest shred, already in `PITR_LIMITATION`. No certificate change.

Add takes `StaffProfileCreate` (`displayName` required in the type). After exit, decrypt is `StaffProfile` and must not contain the three identity keys (test).

### 2.6 `status` and `exited_at` — trigger-encoded

Two fields, two jobs. `status` is operational (`active` ↔ `inactive` while employed — `roster.status`). `exited_at` is the legal tombstone. `guest` has only `erased_at`; there is no inherited invariant.

**Graph:**

- Insert: `status = 'active'`, `exited_at IS NULL`.
- While `exited_at IS NULL`: `active` ↔ `inactive`.
- Exit (one UPDATE): `exited_at = now` **and** `status = 'inactive'`.
- `exited_at IS NOT NULL` is terminal: `status` stays `inactive`; `exited_at` cannot clear or change; `roster_kind` cannot insert/update/delete.

**Cipher mutability: the cipher is mutable iff `OLD.exited_at IS NULL`.** That is the one line. It permits `roster.update` and the exit UPDATE (both run while the tombstone is still null) and freezes every later rewrite. Do not write the trigger as “cipher is immutable when `exited_at` is set” — that reads `NEW` and aborts the exit it is meant to allow. Do not write it as “cipher mutable only when this UPDATE also sets `exited_at`” — that breaks every rename.

OrgDO has no triggers today. This is the first, same `RAISE(ABORT)` idiom as Platform D1 `org_status_update`. Application checks are not enough — the picker predicate is `exited_at IS NULL AND status = 'active' AND kind = 'housekeeper'`, and an `active` + `exited_at` row would show.

`kinds` stay on the row (they are an employment fact: this person was a housekeeper). The picker already excludes them via `exited_at` / `status`.

---

## 3. Permission split

§4.8: compensation and performance are gated separately from the roster; assigning a room does not require seeing a pay rate. `staff:read` / `staff:write` are membership (owner/admin only). `housekeeping:read` / `housekeeping:write` are also on the `staff` role.

Reuse either existing pair and you lose:

| Gate the operational list on… | What happens |
|---|---|
| `housekeeping:read` | Every housekeeper sees whatever the list returns. Maintenance later needs a second read permission on the same table. |
| `staff:read` | Assign picker is empty for the `staff` role. Granting `staff:read` to that role also unhides the membership Staff nav. |

**Resolution: three new property-scoped permissions.** Org-wide record, property-scoped gate — same as `guests:*` (in `PROPERTY_SCOPED_PERMISSIONS` despite living in OrgDO). Do not reuse `staff:*`. Do not grant `staff:read` to the `staff` role.

| Permission | Meaning | owner | admin | staff |
|---|---|---|---|---|
| `roster:read` | Operational roster: `staffId`, `kinds`, `status`, `exitedAt`, `displayName` | ✓ | ✓ | ✓ |
| `roster:write` | `roster.add` / `update` / `status` / `exit` | ✓ | ✓ | — |
| `roster:compensation` | `hourlyRate` (`Money`), `rating`, `skills` on read **and** write | ✓ | ✓ | — |

`ROLE_GRANTS.admin` is an explicit list — add all three. `staff` gets `roster:read` only. Owner already receives `GRANTABLE_PERMISSIONS`.

**Why `roster:read` on the `staff` role.** `housekeeping.assign` stays `housekeeping:write`, which that role already holds. The picker must list assignable people. `roster:read` is the list permission that does not also mean “membership” or “housekeeping owns the staff table.”

**Why nav is `roster:write`, not `roster:read`.** A `roster:read` nav entry would show the HR roster SPA to every housekeeper. The `staff` role uses operational reads only from the housekeeping board picker. Deep-link without write: redirect / no-access, same as Staff screen without `staff:read`. Read-only roster chrome for a fabricated `me` that has `roster:read` without `roster:write` is unit-only, labelled not E2E — same class as the membership SPA’s unexercisable read-only.

**The strip is server-side.** Operational list and get-one return the operational shape unless the caller holds extra grants.

| Caller holds | List/get-one body |
|---|---|
| `roster:read` only | operational: `staffId`, `kinds`, `status`, `exitedAt`, `displayName` |
| + `roster:write` | + `email`, `phone` |
| + `roster:compensation` | + `hourlyRate: Money`, `rating`, `skills` |

**Contact rides on `roster:write`.** Three field classes, two read gates. Contact visibility is gated on write because no read-only HR role exists. Seeing an email currently implies the ability to edit the roster. Revisit if a read-only HR role appears; do not add a fourth permission now.

**`roster:compensation` is a deliberate `noun:noun`.** Every other permission is `noun:verb`. This one is a field-class gate, and it collapses read and write of pay/rating/skills into one grant (“you handle compensation data or you don’t”). That forecloses `roster:compensation` vs `roster:compensation:write` and diverges from `folio:read` / `folio:post` / `folio:adjust`. Unexercisable with today’s roles; the id is contract surface — record the divergence so it does not read as an oversight.

**Names are deliberately unwrapped for peers.** `roster:read` on the `staff` role means every housekeeper sees decrypted `displayName`s of every other staff member. That is required for the picker. §4.8’s exposure is pay/rating/skills *next to* the name, not names alone. Encrypt-at-rest still holds; the operational path unwraps **only** `displayName`, for a broad audience, on purpose.

Live split with today’s three roles: `staff` has `roster:read` and not `roster:compensation`. Owner/admin hold write and compensation together, so a writer-without-pay path is unexercisable with real roles. Still gate writes of `hourlyRate` / `rating` / `skills` on `roster:compensation` (in addition to `roster:write`); prove it with a fabricated actor. PATCH of those fields without the grant is **403**, not silent ignore (the caller would believe a pay change saved). The operational-path strip test is the live one.

Catalog: the four `roster.*` commands carry `permission: 'roster:write'`. HTTP list: `roster:read`. HTTP get-one: `roster:read` (handler strips). Six new routes (list, get-one, add, update, status, exit) need six `V1_HTTP_ROUTE_AUDIT` entries with matching `V1_ROUTES` indices in the **same commit** — `check:permissions` / `check:degraded` assert audit↔dispatcher parity, and a half-applied add goes red (housekeeping Task 3 hit this). Catalog rename of the four command ids is a **prior** commit, before any of those routes exist. Client still must not import `ROLE_GRANTS` (`check:web-pms-me-gating`).

`housekeeping.assign` is unchanged (`housekeeping:write`). The picker is a `roster:read` list filtered to `kind = 'housekeeper' AND status = 'active' AND exited_at IS NULL`.

---

## 4. `assignee_ref` production and the assign picker

Nothing mints `staff_…` today. The board shows the raw ref and an empty fourth column. `housekeeping.assign` validates **format only** (`isStaffRef`); it does not ask whether a roster row exists. The module spec deferred the picker for exactly that gap.

### 4.1 Server mints the id

`roster.add` does **not** take a client `staffId`. OrgDO mints `staff_${crypto.randomUUID()}` (hyphens are legal in `STAFF_REF_RE`). Response is `{ staffId, piiKeyId }`. Replay of the same idempotency key returns the same pair.

This diverges from `guests.create` (client-supplied `guestId`) because guests have no format pin and `assignee_ref` does. A client-supplied id is how `hk_alice` / `user_…` / display names leak into the column the pin exists to protect. Body must not include `staffId`; if present → **400 `invalid_body`**. Idempotency is the key, not the id; fingerprint is profile + `kinds` (no `staffId`).

### 4.2 Assign preamble consults the roster; the use case stays format-only

Precedent: `gateGuestRef` ([property-do.ts:792](../../../apps/pms-core/src/property-do.ts:792) → `assertGuestRef`). Copy two things:

1. **Never caches.** `gateGuestRef` returns the looked-up `piiKeyId` so the caller does not trust the client. Assign has nothing to persist (names stay off `housekeeping_assignment`), but the check still must not cache and still must not treat a well-formed `staff_…` as assignable.
2. **Distinguish the failures**, like `GUEST_NOT_FOUND | GUEST_ALREADY_ERASED`. Not a single `assignee_not_assignable`:

| Error | Meaning |
|---|---|
| `staff_not_found` | no roster row |
| `staff_exited` | `exited_at IS NOT NULL` |
| `staff_not_assignable` | live but inactive, or missing `kind = 'housekeeper'` |

Picker path does not care. A queued replay’s provisional-exception **reason** does — exited vs never-existed vs wrong kind are different operator stories.

`assignHousekeeping` stays sync and OrgDO-free: format check, room exists, upsert. **PropertyDO preamble** (already async: `gatePermission`) calls actor-less OrgDO `assertStaffAssignable` (same shape as `assertGuestRef`: the PropertyDO caller is already gated). If not assignable: the distinguished error above.

Without that check the roster does not actually own the refs that land in `housekeeping_assignment` — any `staff_notreal` would assign. The module still never receives an OrgDO handle (`ModuleTxnCtx` unchanged).

Race: exit between preamble and commit is accepted (no cross-DO re-check inside `transactionSync`).

Do **not** copy `displayName` into `housekeeping_assignment` or `housekeeping.assigned`. Events stay refs. Names are a client join onto the operational roster list. After exit the name is gone from the blob entirely, so `staff_…` is the *only* thing the board can render for that ref — the UI honours exit semantics because the data does.

### 4.3 Picker on the existing board

`HousekeepingApp` already has the Assignee column and a vacant action cell. This chunk fills them.

- Same operational list as §3 (`roster:read`), filtered `kind=housekeeper AND status=active AND exited_at IS NULL`.
- `<select>` per room, options `displayName`, values `staffId`. No free-text. Empty roster: *No housekeepers on the roster* — not an id field. That was the reason the affordance was deferred.
- Mutate via existing `POST …/housekeeping/assignments` (`housekeeping:write`). Client may re-assert `isStaffRef` on the body; the picker only offers server ids.
- Chrome: `canAssign: boolean` injected from the screen (`hasPropertyPermission(me, 'housekeeping:write')`). Do not import `ROLE_GRANTS`. Today every role with `housekeeping:read` also has `housekeeping:write`; still pass the flag.
- Board display: join `assigneeRef` → `displayName` from the same list. Historical / exited refs that are absent from the list render the **pseudonym** (`staff_…`), not a decrypted name.

`HousekeepingApi` grows `listRoster` (operational) and `assignHousekeeping`. `web-pms` already passes the full `api` object; add the client-core methods.

Unassign is not a catalog command. Out of scope.

### 4.4 Dual degraded story — do not reclassify assign

`housekeeping.assign` stays `QUEUE_PROVISIONAL`. It becomes the first command in that class whose preamble depends on OrgDO. (`reservations.create` is the only `gateGuestRef` caller today, and it is `FAIL_CLOSED`.) `gatePermission` already called OrgDO from this method; `gateStaffRef` makes the second-DO dependency load-bearing and visible.

`gateGuestRef` has the **same defect today**: it returns `org.assertGuestRef(guestRef)` bare. `isOrgDoTransportFailure` is not imported into `property-do.ts`. `handlePostReservations` uses `invokePropertyDo` with no OrgDO catch of its own. OrgDO down on create: throw → `invokePropertyDo` non-property branch → **500 `internal_error`**. The correct `FAIL_CLOSED` response is `503 org_unreachable`. `check:do-transport-guards` cannot see it because the handler does use `invokePropertyDo`.

**This chunk folds the `gateGuestRef` fix.** Shipping two adjacent cross-DO gates with different failure behaviour — one 503, one 500 — is worse than a slightly larger chunk. Shared helper in `property-do.ts` (first import of `isOrgDoTransportFailure` there). `assertGuestRef` / `assertStaffAssignable` call `assertRpcAvailable` so the test hook works. `handlePostReservations` maps `org_unreachable` to 503 `FAIL_CLOSED` with `commandId: 'reservations.create'`.

`assertPermission` has no `assertRpcAvailable` (leave it). Production OrgDO outage may still 500 at `requirePermission` (leftover §8.6 / property-me leftover #11); this chunk closes the hole **once inside PropertyDO**.

**HTTP (two DOs, two stories) for assign:**

| Outage | Behaviour |
|---|---|
| PropertyDO down | `invokePropertyDo` → 202 queued (degraded-mode test 23 unchanged) |
| OrgDO down | **503 `org_unreachable` `FAIL_CLOSED`**, not queued, not 500 |

Preamble wraps `gatePermission` + `gateStaffRef`. OrgDO transport → `{ ok: false, error: 'org_unreachable' }` (result union, not a throw). `invokePropertyDo` only queues on `isPropertyDoTransportFailure`; an `ok: false` result is a successful RPC. The assign handler maps `org_unreachable` to the guest-route 503 body (`commandId: 'housekeeping.assign'`). An uncaught throw is today’s hole: `invokePropertyDo` → 500 `internal_error`. Proof is an HTTP test: OrgDO blocked → 503 `org_unreachable`, not 500, not 202.

**Replay** (preamble re-runs outside the HTTP handler):

| Outcome | Consumer |
|---|---|
| `staff_not_found` / `staff_exited` / `staff_not_assignable` | `recordProvisionalException` + ack (domain; do not retry forever) |
| `org_unreachable` | **`msg.retry()`** — OrgDO blip must not ack-away a queued assign |
| PropertyDO transport | already `msg.retry()` |

Do not treat `org_unreachable` as a domain exception on replay. That would drop the command.

Rejected: reclassify assign to `FAIL_CLOSED`. That throws away the queue-during-PropertyDO-outage behaviour the housekeeping chunk kept and test 23 pins.

---

## 5. Roster management SPA

Not a section on the membership Staff screen. Adjacent in the nav, different permission, different ids (`staff_…` vs `user_…`).

**Nav:** `{ id: 'roster', label: 'Roster', path: '/roster', order: 55, permission: 'roster:write' }` — after Staff (50). `roster:read` on the `staff` role must not reveal this entry; the picker lives on the housekeeping board.

**Server shapes first** (same order as the membership SPA). One list endpoint; the handler strips by grants (§3 table). `GET` query `kind=housekeeper` is the picker filter. `Cache-Control: private, no-store`. `degradedRead: 'FAIL_CLOSED'`; OrgDO transport → `org_unreachable` (no `commandId` on the GETs).

**Mutations** (all `FAIL_CLOSED`, `roster:write`, `entitlement: 'pms.core'`):

| Route | Command |
|---|---|
| `POST …/roster` | `roster.add` — no client `staffId`; returns `{ staffId, piiKeyId }` |
| `PATCH …/roster/:staffId` | `roster.update` — optional `kinds` full replace; compensation fields without `roster:compensation` → **403** |
| `POST …/roster/:staffId/status` | `roster.status` — `{ status: 'active' \| 'inactive' }` |
| `POST …/roster/:staffId/exit` | `roster.exit` |

**Screen:** list + add; inline status; exit behind a confirm that names the consequence (*The name and contact will be removed. The employment record is kept. This cannot be undone.*). Compensation inputs only when `hasPropertyPermission(me, 'roster:compensation')`. Do not show Clerk `user_…`. Do not link a roster row to a member.

Empty state: *Add someone to the roster* + add affordance, not the membership “invite by email” copy.

Writer-without-compensation and read-without-write chrome: fabricated-`me` unit tests, labelled not E2E, same as the membership SPA.

**Catalog notes.** Replace `HOUSEKEEPING_STAFF_FAMILY_NOTES` with `ROSTER_FAMILY_NOTES`: Staff-class PII, distinct from membership `staff.*`, exit is pseudonymize-not-delete, ids are `roster.*`. Drop the “rename deferred / `housekeeping.roster_*`” sentence. Retarget `register.test.ts`. Catalog must not still contain `housekeeping.staff_*`. `event-consumer.ts`: drop `staff.housekeeper_changed`; allowlist `roster.created` / `roster.updated` / `roster.exited`.

`ROSTER_FAIL_CLOSED_NOTES` on add/update/status — copy `GUESTS_FAIL_CLOSED_NOTES`, substituting minted `staff_…` / assign picker for guest / booking. Identical string on those three entries; guard equality in `register.test.ts`. Exit notes cover FAIL_CLOSED (already was) plus pseudonymize-not-shred.

---

## 6. Test matrix

### 6.1 OrgDO roster

| # | Test | Assertion |
|---|---|---|
| 1 | `roster.add` | 200 `{ staffId, piiKeyId }`; `staffId` matches `STAFF_REF_RE`; outbox `roster.created` has refs, not `displayName` |
| 1a | Add with `{ staffId: 'staff_client_chosen', … }` | **400 `invalid_body`**; no row with that id |
| 2 | Add duplicate idempotency key | replay same `{ staffId, piiKeyId }`; one `data_key` row |
| 3 | Add empty `kinds` | 422 |
| 4 | Add `kinds: ['housekeeper','maintenance']` | 422 / CHECK abort (Phase 1 permitted set) |
| 5 | Update `kinds` full replace | child table matches payload; omit `kinds` leaves rows |
| 5a | Update `displayName` | 200; list reflects the new name (allowed cipher rewrite while `OLD.exited_at IS NULL`) |
| 6 | `status` active ↔ inactive | picker predicate excludes inactive |
| 7 | Exit | decrypt has no `displayName`/`email`/`phone`; `exited_at` set; `status=inactive`; `roster.exited` refs only |
| 8 | Exit thin profile (name only) | re-seals to `{}`; 200; not refused |
| 9 | Second exit | 200 idempotent; no second outbox; no trigger abort |
| 10 | Update / status after exit | 409 `staff_exited` |
| 11 | Trigger: `active` + `exited_at` | `RAISE(ABORT)` |
| 12 | Trigger: cipher rewrite with `OLD.exited_at` set | abort; exit itself (OLD null) succeeds |
| 13 | `tryEraseGuest` with live roster row | guest shredded; staff key still round-trips; roster decrypts |
| 14 | `staff` role add/exit | 403 `roster:write` |
| 15 | `staff` role list | 200 operational shape; **no** `hourlyRate`/`rating`/`skills`/`email`/`phone` even if blob contains them |
| 16 | Owner list | contact present; compensation present as `Money` |
| 17 | PATCH pay without `roster:compensation` | **403** (fabricated actor) |
| 18 | OrgDO blocked on add | 503 `org_unreachable` FAIL_CLOSED, not 500 |
| 19 | Kill-switch | 503 empty body |

### 6.2 Assign + dual degraded

| # | Test | Assertion |
|---|---|---|
| 20 | Picker assign minted housekeeper | 200; board shows `displayName`; event has `assigneeRef` only |
| 21 | Assign `staff_notreal` | 422 `staff_not_found` |
| 22 | Assign exited | 422 `staff_exited` |
| 23 | Assign inactive / non-housekeeper | 422 `staff_not_assignable` |
| 24 | PropertyDO down | 202 queued (existing degraded-mode test 23 analogue stays) |
| 25 | OrgDO blocked on assign | **503 `org_unreachable`, not 500, not 202** |
| 26 | Replay `staff_exited` | provisional exception reason `staff_exited`; ack |
| 27 | Replay `org_unreachable` | **`msg.retry()`**, no exception row |
| 28 | Historical assignment after exit | board renders `staff_…`, not a name |
| 29 | **Book with OrgDO blocked at `assertGuestRef`** | **503 `org_unreachable` `commandId: 'reservations.create'`, not 500** |

Test 29: `assertPermission` has no `assertRpcAvailable` (leave it). `assertGuestRef` gains it, so `setTransportBlockedForTest` hits the PropertyDO catch without dying at `requirePermission`.

### 6.3 SPA (unit / RTL)

| # | Test | Assertion |
|---|---|---|
| 30 | `staff` role | Roster nav hidden; housekeeping picker visible with names |
| 31 | Empty roster | *No housekeepers on the roster* — no text input |
| 32 | Exit confirm | copy names removal + retained employment record |
| 33 | Compensation inputs | absent without `roster:compensation` (fabricated `me`) |
| 34 | Read-without-write roster chrome | fabricated `me` only, labelled not E2E |

### 6.4 Canaries

| # | Mutation | Catch |
|---|---|---|
| M1 | Drop `gateStaffRef` | 21–23 fail (format-valid ghost assign succeeds) |
| M2 | Operational list includes `hourlyRateMinor` | 15 fails |
| M3 | Second exit reaches SQL | 9 fails (trigger abort) |
| M4 | Cipher trigger reads `NEW.exited_at` | 7 fails (happy-path exit aborts) |
| M5 | Drop OrgDO catch on `gateGuestRef` | 29 fails (500) |
| M6 | Replay maps `org_unreachable` to exception + ack | 27 fails (queued assign dropped) |
| M7 | Catalog still has `housekeeping.staff_*` or old notes constant | `register.test` fails |
| M8 | `roster.add` accepts client `staffId` as PK | 1a fails |
| M9 | Cipher trigger allows rewrite only when the UPDATE also sets `exited_at` | 5a fails (rename aborts) |

### 6.5 Checks

`check:permissions` / `check:degraded` / `check:entitlements` / `check:ddl` / `check:do-transport-guards` / `check:web-pms-me-gating` green. `do-transport-guards` will **not** catch tests 25/29 — those are HTTP proofs, not the script. Naming that limit here is what stops someone later assuming the script has it handled.

---

## 7. Acceptance

- [ ] OrgDO `roster` + `roster_kind`; first OrgDO triggers; `check:ddl` green
- [ ] Server-minted `staff_…`; client `staffId` on add is 400; prepare-outside / re-check-inside; events refs-only on OrgDO outbox
- [ ] Exit re-seals identity off; key kept; thin `{}` allowed; second exit short-circuits in application code; `roster.update` of `displayName` succeeds while employed
- [ ] `tryEraseGuest` does not touch a live staff key
- [ ] Three permissions; operational strip test (15); PATCH pay without grant is 403
- [ ] Assign preamble `gateStaffRef`; distinguished errors; names never in PropertyDO / `housekeeping.assigned`
- [ ] Assign: PropertyDO down → 202; OrgDO down → 503 not 500 not 202; replay `org_unreachable` retries
- [ ] `gateGuestRef` same `org_unreachable` union; booking test 29
- [ ] Picker on the board; no free-text; nav `/roster` at 55 on `roster:write`
- [ ] Catalog `roster.*` `FAIL_CLOSED` `pms.core`; `ROSTER_FAMILY_NOTES` / `ROSTER_FAIL_CLOSED_NOTES`; no `housekeeping.staff_*`; no `staff.housekeeper_changed`; audit exemptions for the four commands
- [ ] `HOUSEKEEPING_STAFF_FAMILY_NOTES` gone

---

## 8. Leftovers

| # | Item | Notes |
|---|---|---|
| 1 | Per-property roster membership | Org-wide Phase 1 |
| 2 | `maintenance` kind | Freeze-gate `roster_kind` rebuild; `roster.update` already takes a set |
| 3 | Two-blob identity/employment keys | If a DPA requires cryptographic compensation split / identity shred |
| 4 | Read-only HR role | Contact currently rides on `roster:write` |
| 5 | Split `roster:compensation` into read vs write | Deliberate `noun:noun` this chunk |
| 6 | `requirePermission` OrgDO 500 | property-me leftover #11 — not this chunk |
| 7 | Shifts / capacity / operational skill tags | §16.1; not `StaffProfile.skills` |
| 8 | OrgDO module extraction | Guests remain the vehicle |
| 9 | Wiring roster rows to Clerk | Roster ≠ membership |

---

## 9. Decisions locked (index)

| Topic | Lock |
|---|---|
| Location | OrgDO, guest-shaped; not `pms.housekeeping`; no `ModuleTxnCtx` change |
| Record | Org-wide staff identity; `kinds` set; not a housekeeper table |
| Commands / events | `roster.*` / `roster.created\|updated\|exited`; not `housekeeping.staff_*` / `staff.housekeeper_changed` |
| Degraded | All four `FAIL_CLOSED`; assign stays `QUEUE_PROVISIONAL` |
| Tenant purge | Roster dies with OrgDO; no certificate change |
| `kinds` | Child table; add requires; update owns full replace; Phase 1 `{housekeeper}` |
| Encrypted | `StaffProfileCreate` on add (`displayName` required); at-rest `StaffProfile`; compensation strip is application-level + tested |
| Skills vs kinds | Encrypted HR vs plaintext capability set; do not name the discriminator `skills` |
| Exit | Re-seal A, not shred, not ACL; empty `{}` allowed; app-level second-exit short-circuit; update/status after exit → `staff_exited` (app check, trigger backstop) |
| Cipher trigger | Mutable iff `OLD.exited_at IS NULL` |
| Permissions | `roster:read` / `write` / `compensation`; contact on write; names unwrapped for peers on purpose |
| Mint | Server `staff_${uuid}`; client `staffId` → 400 |
| Assign check | `gateStaffRef` à la `gateGuestRef`; distinguished errors; never cache |
| Dual degraded | PropertyDO down → 202; OrgDO down → 503; replay `org_unreachable` retries |
| `gateGuestRef` | Same `org_unreachable` union this chunk |
| SPA | `/roster` order 55, `roster:write`; picker on housekeeping board |
| PATCH pay | 403 without `roster:compensation` |
