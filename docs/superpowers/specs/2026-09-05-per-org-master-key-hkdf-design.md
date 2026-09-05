# Per-org HKDF master key (R0.5)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 8`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`. **This slice bumps `ORG_SCHEMA_HEAD` → 9** only.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 5](../../audit/2026-09-04-full-codebase-audit.md) (**N6**, **N14** AAD absorbed); [Guests + crypto-shredding (shipped)](./2026-07-28-guests-crypto-shredding-design.md) (envelope AES-GCM, shred, `data_key` — **derive** wrap/HMAC keys; do not rebuild envelope); [Guests / PII vertical](./2026-08-06-guests-pii-vertical-design.md); [Guest CRM directory (shipped)](./2026-08-13-guest-crm-directory-design.md) (blind-index HMAC — **this slice amends key derivation**); [AGENTS.md §1 PII/crypto](../../../AGENTS.md) (platform master + HKDF over `orgId`; never “one hex wraps every org”); `apps/pms-core/src/org-do.ts` (`vault()` ~279–288, `blindIndexKey()` ~291–299, `getOrgIdSync()` ~429–433, `tryCreateGuest` ~1522–1541, `ensureGuestBlindIndex` ~394–426); `packages/crypto-shredding/src/vault.ts`; `packages/crypto-shredding/src/blind-index.ts`; `packages/crypto-shredding/src/master-key.ts`; `apps/pms-core/src/org-key-store.ts`; `apps/pms-core/src/env.ts` (~73–74); `packages/do-runtime/src/org-migrations.ts` (`data_key` DDL ~44–51).

**Closes:** Audit **N6** (one platform master key wraps every org; comment lie). **Absorbs:** **N14** profile AES-GCM `additionalData` (locked because `PiiVault.encrypt` is touched). **Roadmap:** **R0.5**. **Requires:** guest crypto-shredding + CRM blind-index verticals shipped. **Amends:** [2026-08-13 guest CRM directory spec](./2026-08-13-guest-crm-directory-design.md) — blind-index key is **org-scoped HKDF**, not platform-wide `hospai.guest-blind-index.v1`. **Does not** advance R0.6+, master-key rotation UI/rewrap job, G5 `test:coverage` on crypto-shredding (R0.13), Playwright, PropertyDO extraction, new HTTP routes, or new catalog commands.

---

## Executive summary

Guest PII envelope encryption and blind-index HMAC today both import the **same** 32-byte platform secret (`HOSPAI_ORG_MASTER_KEY`) as a **global** AES-GCM wrap key and a **global** HMAC key. Two orgs with identical plaintext produce **identical** ciphertext and **identical** blind-index hashes — a platform blast-radius defect (**N6**). The env comment falsely labels the binding Vitest-only.

This spec locks **HKDF-SHA-256** derivation of **two separate org-scoped keys** from the platform IKM: one for data-key wrap/unwrap, one for blind-index HMAC. Salt is **32 zero bytes** (fixed). Existing `data_key` rows stay **`key_version = 0`** and unwrap with the legacy imported platform AES key; **new** keys insert **`key_version = 1`** and wrap/unwrap with the HKDF wrap key. OrgDO `vault()` / `blindIndexKey()` derive from `getOrgIdSync()` — never cache a vault across org ids. Profile encrypt/decrypt gains AES-GCM **`additionalData = UTF-8(piiKeyId)`** with legacy decrypt fallback (**N14**). Characterization tests (two fresh orgs, same plaintext) land **first** and must fail on current `main`. **No new HTTP routes. No new catalog commands.** OrgDO migration **v9** bumps `ORG_SCHEMA_HEAD` 8 → 9.

---

## Locked product call

1. **Comment lie (ship first in vertical):** `apps/pms-core/src/env.ts` — `HOSPAI_ORG_MASTER_KEY` is the **platform** master key material (staging/production + local/tests), **not** Vitest-only.
2. **Derive per org:** HKDF-SHA-256 the platform AES key material over `orgId`. **Two infos** — do **not** use one derived key for both wrap and HMAC:
   - wrap: `hospai/v1/org-wrap/${orgId}`
   - blind-index HMAC: `hospai/v1/org-blind/${orgId}`
   - Salt: **32 zero bytes** (`new Uint8Array(32)` — all `0x00`). IKM = raw 32-byte platform key (same 64-char hex as today).
3. **`data_key.key_version`:** OrgDO **v9** `ALTER TABLE data_key ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0`. Existing rows = **0**. **New** `provisionKey` / `preparePiiRecord` / `prepareGuestRecord` inserts **`key_version = 1`**.
4. **Unwrap:** `key_version === 0` → wrap/unwrap with **imported platform AES-GCM key** (legacy, today’s behaviour). `key_version === 1` → wrap/unwrap with **HKDF-derived wrap key**. Master-key rotation UI / rewrap job is **out of scope**; the column must exist for a future rotation path.
5. **Blind index:** HMAC uses HKDF blind key (org-scoped). Two orgs, same plaintext → **different** `index_hash`. `ensureGuestBlindIndex` and create/update paths rewrite hashes with the org-scoped key. Characterization tests use **fresh** orgs (no cross-org backfill job this slice).
6. **Two-org test (fail on main):** same `displayName` / `email` on org A and org B → ciphertext bytes differ **and** blind-index hashes differ. Shred org A’s guest key; org B still decrypts.
7. **N14 AAD (locked):** profile `encrypt` / `decrypt` pass AES-GCM `additionalData` = UTF-8 `piiKeyId`. Decrypt: try with AAD; if authentication fails, retry **without** AAD (legacy v0 ciphertext). Wrap of data keys (`wrapKey` / `unwrapKey` on the master) does **not** use AAD.
8. **OrgDO derivation:** `vault()` / `blindIndexKey()` must take **`orgId` from `getOrgIdSync()`** — never a global vault cached without org context (one DO = one org already; still derive from stored orgId and fail closed if unset).
9. **Platform secret stays platform:** Master key material remains a **platform** secret in wrangler/secrets — never comment it as “one hex wraps every org” after this slice; comments must describe HKDF-per-org derivation.
10. **Boundaries:** Do not extract PropertyDO. Do not put org-derived keys in KV.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Routes / catalog** | **No** new HTTP routes. **No** new `COMMAND_CATALOG` ids. |
| **Comment** | Fix `env.ts` `HOSPAI_ORG_MASTER_KEY` JSDoc — platform secret, not Vitest-only. |
| **HKDF salt** | **32 zero bytes** for wrap and blind derivations. Do not use empty salt or invent per-org salt. |
| **HKDF info (wrap)** | UTF-8 `hospai/v1/org-wrap/${orgId}` → AES-GCM-256 `CryptoKey` (`wrapKey`, `unwrapKey`). |
| **HKDF info (blind)** | UTF-8 `hospai/v1/org-blind/${orgId}` → HMAC-SHA-256 `CryptoKey` (`sign`). |
| **Legacy unwrap** | `key_version === 0` → platform `importMasterKeyHex(hex)`. |
| **New wrap** | `key_version === 1` → HKDF wrap key. All new `data_key` rows from `provisionKey` / `prepare*` paths insert **1**. |
| **Schema** | OrgDO **v9** adds `data_key.key_version`. `ORG_SCHEMA_HEAD` **9**. `PROPERTY_SCHEMA_HEAD` stays **34**. |
| **OrgDO keys** | `vault()` / `blindIndexKey()` call `getOrgIdSync()`; throw/`ORG_ID_UNSET` if missing before derive. |
| **Blind index** | Replace platform-wide `importBlindIndexKeyHex(hex)` with org-scoped derive; create/update + `ensureGuestBlindIndex` use org key. |
| **N14 AAD** | Profile encrypt/decrypt bind `piiKeyId` as AAD; decrypt fallback without AAD for v0 rows. Data-key wrap unchanged (no AAD). |
| **Two-org test** | Fresh orgs; same profile → different cipher + different blind hash; shred A leaves B readable. |
| **Rotation** | **Out of scope** — no UI, no batch rewrap, no blind-index mass rehash job. Column exists only. |
| **KV / PropertyDO** | No org wrap key in KV. No PropertyDO migration. |

---

## 1. Problem / evidence

### 1.1 N6 — one platform key wraps every org (high)

**Vault and blind index share the same raw import — no `orgId`:**

```279:299:apps/pms-core/src/org-do.ts
  private async vault(): Promise<PiiVault> {
    if (!this.vaultPromise) {
      this.vaultPromise = (async () => {
        const hex = this.env.HOSPAI_ORG_MASTER_KEY;
        if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
        const master = await importMasterKeyHex(hex);
        return new PiiVault(master, new SqlKeyStore(this.ctx.storage.sql));
      })();
    }
    return this.vaultPromise;
  }

  private async blindIndexKey(): Promise<CryptoKey> {
    if (!this.blindIndexKeyPromise) {
      this.blindIndexKeyPromise = (async () => {
        const hex = this.env.HOSPAI_ORG_MASTER_KEY;
        if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
        return importBlindIndexKeyHex(hex);
      })();
    }
    return this.blindIndexKeyPromise;
  }
```

`getOrgIdSync()` exists (~429–433) but is **not** threaded into key derivation.

**Blind index HKDF info is platform-wide (August C5 → N6):**

```4:35:packages/crypto-shredding/src/blind-index.ts
const BLIND_INDEX_INFO = new TextEncoder().encode('hospai.guest-blind-index.v1');
// …
export async function importBlindIndexKeyHex(hex: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', hexToBytes(hex) as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: BLIND_INDEX_INFO,
    },
```

Same hex → same HMAC key for every org. Salt today is **empty**, not the locked **32 zero bytes**.

**Wrap key is direct AES import — no HKDF:**

```3:16:packages/crypto-shredding/src/master-key.ts
/** Import a 32-byte AES-256 master key from 64 hex chars (local / org binding). */
export async function importMasterKeyHex(hex: string): Promise<CryptoKey> {
  // …
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ]);
}
```

**Profile encrypt has no AAD (N14):**

```44:61:packages/crypto-shredding/src/vault.ts
  async encrypt(piiKeyId: string, plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    const iv = crypto.getRandomValues(new Uint8Array(DATA_IV_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, plaintext as BufferSource),
    );
    return { ciphertext, iv };
  }

  async decrypt(piiKeyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
    const dataKey = await this.unwrapDataKey(piiKeyId);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        dataKey,
        ciphertext as BufferSource,
      ),
    );
  }
```

### 1.2 Comment lie — env says Vitest-only (medium, ship with N6)

```73:74:apps/pms-core/src/env.ts
  /** Vitest-only: 64-char hex org master key for guest PII envelope encryption. */
  HOSPAI_ORG_MASTER_KEY?: string;
```

Staging deploy docs and wrangler secrets treat this as **production** platform material ([2026-08-16 staging deploy spec](./2026-08-16-staging-deploy-smoke-design.md)). The comment is wrong and must not survive this vertical.

### 1.3 `data_key` has no rotation version column

```44:51:packages/do-runtime/src/org-migrations.ts
  `CREATE TABLE data_key (
  pii_key_id    TEXT PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('guest', 'staff')),
  subject_id    TEXT NOT NULL,
  wrapped_key   BLOB,
  created_at    INTEGER NOT NULL,
  shredded_at   INTEGER
)`,
```

`SqlKeyStore.insert` (~50–57) does not persist a version. Unwrap always uses the single master passed to `PiiVault`.

### 1.4 New guest keys always insert version implicitly “0” today

```1535:1541:apps/pms-core/src/org-do.ts
          this.ctx.storage.sql.exec(
            `INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at) VALUES (?, ?, ?, ?, ?)`,
            material.piiKeyId,
            'guest',
            input.guestId,
            material.wrappedKey,
            now,
          );
```

After this slice, the same INSERT must include `key_version = 1` and `PiiVault` must wrap with the HKDF org wrap key.

### 1.5 Tests encode single-org / same-key happy path (gap)

`packages/crypto-shredding/src/vault.test.ts` and `blind-index.test.ts` use one `MASTER_HEX` with no org dimension. `apps/pms-core/test/guests-routes.spec.ts` provisions one org per case — no two-org ciphertext / blind-hash isolation. Audit Vertical 5 (~312–324): add the two-org characterization **first**; must fail on `main`.

### 1.6 Prior spec assumed platform-wide blind key

[2026-08-13 guest CRM directory §5.2](./2026-08-13-guest-crm-directory-design.md) locked `info = 'hospai.guest-blind-index.v1'`. **This slice amends derivation only** — envelope, shred, search algorithm, and property-scoped lists are unchanged.

---

## 2. Locked behaviour

### 2.1 HKDF helpers (`packages/crypto-shredding`)

Add **functions only** (no new `export class`). Shared constants:

```ts
const PLATFORM_IKM_HEX_RE = /^[0-9a-fA-F]{64}$/; // same rule as today
const HKDF_SALT = new Uint8Array(32); // 32 zero bytes — locked; do not change

function orgWrapInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-wrap/${orgId}`);
}
function orgBlindInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-blind/${orgId}`);
}
```

**New exports (names locked for implementer):**

| Function | Output | Web Crypto usage |
|---|---|---|
| `importPlatformIkmHex(hex: string)` | `CryptoKey` (HKDF extract, non-extractable) | Same 32-byte raw import as today’s hex decode |
| `deriveOrgWrapKeyHex(hex: string, orgId: string)` | `CryptoKey` AES-GCM-256 | HKDF expand → `{ name: 'AES-GCM', length: 256 }`, usages `wrapKey`, `unwrapKey` |
| `deriveOrgBlindIndexKeyHex(hex: string, orgId: string)` | `CryptoKey` HMAC-SHA-256 | HKDF expand → `{ name: 'HMAC', hash: 'SHA-256', length: 256 }`, usage `sign` |

**Parameters (normative):**

- `hash`: `SHA-256`
- `salt`: `HKDF_SALT` (32 zero bytes) for **both** derivations
- `info`: as locked in §Executive summary
- `orgId`: caller-supplied; must be the OrgDO’s `getOrgIdSync()` value, not URL body data on OrgDO paths

**Legacy helpers:**

- Keep `importMasterKeyHex(hex)` for **`key_version === 0`** unwrap/wrap compatibility.
- Deprecate org-agnostic `importBlindIndexKeyHex(hex)` for OrgDO call sites — replace with `deriveOrgBlindIndexKeyHex(hex, orgId)`. Unit tests may keep a thin wrapper or migrate assertions to org-scoped derive.

**Forbidden:** one HKDF info for both wrap and HMAC; empty salt; persisting derived keys in SQL or KV; extractable derived keys.

### 2.2 OrgDO schema v9 (`ORG_SCHEMA_HEAD` 9)

Append migration **v9** `data_key_key_version` in `packages/do-runtime/src/org-migrations.ts`:

```sql
ALTER TABLE data_key ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0;
```

- Existing rows remain **`key_version = 0`** (legacy platform wrap).
- **No** backfill that rewraps v0 → v1 this slice.
- Run `pnpm generate:ddl`; bump pin in `packages/do-runtime/src/migrate.test.ts`: `ORG_SCHEMA_HEAD === 9`.

### 2.3 `KeyStore` / `SqlKeyStore` / `WrappedKeyRecord`

Extend types in `packages/crypto-shredding/src/types.ts`:

```ts
export type WrappedKeyRecord = {
  piiKeyId: string;
  scope: KeyScope;
  subjectId: string;
  wrappedKey: Uint8Array;
  shredded: boolean;
  keyVersion: 0 | 1; // default 0 when column absent in memory tests only
};
```

**`KeyStore.insert`:** add optional `keyVersion?: 0 | 1`; default **`1`** for all new inserts from `PiiVault` production paths.

**`SqlKeyStore.get`:** `SELECT …, key_version FROM data_key …`; map null/missing → `0`.

**`SqlKeyStore.insert`:** `INSERT INTO data_key (…, key_version) VALUES (…, ?)` with **`1`** for new material.

Update `keystore-conformance` + `MemoryKeyStore` in tests accordingly.

### 2.4 `PiiVault` dual master + AAD

**Constructor (locked shape):**

```ts
export type VaultMasters = {
  legacyPlatformWrap: CryptoKey; // importMasterKeyHex — key_version 0
  orgWrap: CryptoKey;            // deriveOrgWrapKeyHex — key_version 1
};

export class PiiVault {
  constructor(
    private readonly masters: VaultMasters,
    private readonly store: KeyStore,
  ) {}
}
```

**Wrap / unwrap data keys:**

- **New** material (`provisionKey`, `preparePiiRecord`, `prepareGuestRecord`): wrap with `masters.orgWrap`; persist `keyVersion: 1`.
- **Unwrap:** read `keyVersion` from store — `0` → `legacyPlatformWrap`, `1` → `orgWrap`.
- **No AAD** on `subtle.wrapKey` / `subtle.unwrapKey` for data keys.

**Profile encrypt / decrypt (N14 — locked):**

```ts
const aad = new TextEncoder().encode(piiKeyId);

// encrypt (all new ciphertext):
await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv, additionalData: aad },
  dataKey,
  plaintext,
);

// decrypt:
try {
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    dataKey,
    ciphertext,
  );
} catch {
  // legacy v0 profile blobs (no AAD at seal time)
  return await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dataKey,
    ciphertext,
  );
}
```

Apply to `encrypt`, `decrypt`, `preparePiiRecord`, `prepareProfileSeal` profile cipher paths. **`prepareGuestRecord`** included.

### 2.5 OrgDO `vault()` / `blindIndexKey()`

Replace singleton promises that ignore org id:

```ts
private async vault(): Promise<PiiVault> {
  const orgId = this.getOrgIdSync();
  if (!orgId) throw new Error('org_id unset');
  if (!this.vaultPromise) {
    const hex = this.env.HOSPAI_ORG_MASTER_KEY;
    if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
    this.vaultPromise = (async () => {
      const legacyPlatformWrap = await importMasterKeyHex(hex);
      const orgWrap = await deriveOrgWrapKeyHex(hex, orgId);
      return new PiiVault(
        { legacyPlatformWrap, orgWrap },
        new SqlKeyStore(this.ctx.storage.sql),
      );
    })();
  }
  return this.vaultPromise;
}

private async blindIndexKey(): Promise<CryptoKey> {
  const orgId = this.getOrgIdSync();
  if (!orgId) throw new Error('org_id unset');
  if (!this.blindIndexKeyPromise) {
    const hex = this.env.HOSPAI_ORG_MASTER_KEY;
    if (!hex) throw new Error('HOSPAI_ORG_MASTER_KEY unset');
    this.blindIndexKeyPromise = deriveOrgBlindIndexKeyHex(hex, orgId);
  }
  return this.blindIndexKeyPromise;
}
```

**Note:** One OrgDO instance = one org; promises remain instance-scoped. If `ensureMetaOrgId` runs after first vault access in a pathological test, fail closed — production always sets `__meta.org_id` before PII writes.

**All** `blindIndexRows(await this.blindIndexKey(), …)` call sites unchanged in shape; key material differs per org.

**Direct SQL `INSERT INTO data_key`** in `tryCreateGuest`, roster create, etc.: add `key_version` column value **`1`** to match vault output (or route inserts only through `KeyStore.insert` — prefer one path).

### 2.6 Blind index on existing orgs

| Path | Behaviour |
|---|---|
| `tryCreateGuest` / `tryUpdateGuest` | `replaceGuestBlindIndexSync` with org-scoped hashes (already runs after profile seal) |
| `ensureGuestBlindIndex` | Uses `blindIndexKey()` → org-scoped derive when backfilling **missing** rows |
| Pre-v9 guests with **existing** blind rows keyed under old platform-wide HMAC | **Not** mass-rehashed this slice; search may miss until guest update or missing-row backfill creates parallel rows — acceptable; **tests use fresh orgs** |

**Forbidden:** org-wide `UPDATE guest_blind_index` migration; dual-write two hash generations silently.

### 2.7 Shred isolation (unchanged semantics, tighter keys)

`shredKey` / `SqlKeyStore.shred` behaviour unchanged. Two-org test proves shredding org A’s guest key does not affect org B’s decrypt — scope was already per `pii_key_id`; this slice adds cross-org ciphertext isolation.

### 2.8 `env.ts` comment (normative one-liner)

Replace Vitest-only JSDoc with:

```ts
/** Platform PII master key material (64-char hex). HKDF-derived per org in OrgDO — not a direct org wrap key. Set via wrangler secret in staging/production; miniflare binding in local/tests. */
HOSPAI_ORG_MASTER_KEY?: string;
```

Align `master-key.ts` / `blind-index.ts` module comments if they say “org binding” without HKDF.

### 2.9 HTTP / commands / routes

**No wire changes.** `guests.create`, `guests.update`, `guests.erase`, roster commands, and all HTTP routes unchanged. Idempotency fingerprints unchanged. Kill-switch / entitlement unchanged.

---

## 3. Implementation steps

**Order: failing characterization tests on `main`, then crypto-shredding helpers, schema, vault/store, OrgDO wiring, comment fix.**

### 3.1 Tests first (red on `main`)

**`packages/crypto-shredding/src/org-derive.test.ts`** (new file)

- Same platform hex + two different `orgId` strings → `deriveOrgWrapKeyHex` produces different `CryptoKey` usages (wrap two equal data keys → different `wrapped_key` bytes).
- Same platform hex + two orgs → `deriveOrgBlindIndexKeyHex` → different HMAC output for same normalized email.
- Wrap key ≠ blind key for the same org (algorithm name check, same as existing blind-index test).
- Salt is 32 bytes (assert helper constant length).

**`packages/crypto-shredding/src/vault.test.ts`**

- Extend `PiiVault` construction with `VaultMasters`.
- New ciphertext uses AAD: decrypt with wrong `piiKeyId` AAD fails; correct AAD succeeds.
- Legacy blob without AAD still decrypts via fallback.
- v0 record in store unwraps with `legacyPlatformWrap`; v1 with `orgWrap`.

**`apps/pms-core/test/org-crypto-isolation.spec.ts`** (new file — or extend `guests-routes.spec.ts` if Org harness already provisions two orgs)

Helper `provisionTwoOrgsSamePlatformKey()` → `{ orgA, orgB, propertyA, propertyB, actor }` (two org DOs, same miniflare `HOSPAI_ORG_MASTER_KEY` binding).

- **Add** `two-org isolation: same profile → different cipher and blind hash`:
  - Create guest `g1` at org A property with `{ displayName: 'Same Person', email: 'same@example.com' }`.
  - Create guest `g2` at org B property with **identical** profile.
  - Read raw `profile_cipher` / `profile_iv` from each OrgDO (test hook or direct SQL via existing org test harness) → ciphertext bytes **must differ**.
  - Query `guest_blind_index` for email kind → `index_hash` bytes **must differ**.
- **Add** `shred org A guest; org B guest still decrypts`:
  - `guests.erase` / shred path on A’s guest.
  - `GET …/guests/:id` at B → **200** with original displayName.
  - Decrypt A → `KeyShreddedError` / guest erased.

Tests **must fail on current `main`** (same ciphertext/hash today).

### 3.2 Schema (`packages/do-runtime`)

1. Add v9 migration statement (§2.2).
2. `pnpm generate:ddl`.
3. `migrate.test.ts`: `expect(ORG_SCHEMA_HEAD).toBe(9)`.

### 3.3 Crypto-shredding package

1. Add `org-derive.ts` (+ tests §3.1).
2. Extend `types.ts` / `KeyStore` with `keyVersion`.
3. Refactor `vault.ts` — `VaultMasters`, dual unwrap, AAD (§2.4).
4. Update `blind-index.ts` — org-scoped derive; keep normalize/hash/`blindIndexRows` unchanged.
5. Export new helpers from package index if other modules import from barrel.

### 3.4 Org key store + OrgDO

1. `org-key-store.ts` — read/write `key_version`.
2. `org-do.ts` — `vault()` / `blindIndexKey()` (§2.5); INSERT paths include `key_version = 1`.
3. `env.ts` comment (§2.8).

### 3.5 CRM spec amendment (final task in vertical)

One sentence appended to [2026-08-13 guest CRM directory spec](./2026-08-13-guest-crm-directory-design.md) **§5.2 Index key**:

> **Amended by [2026-09-05 per-org HKDF master key](./2026-09-05-per-org-master-key-hkdf-design.md):** blind-index HMAC key is HKDF-derived per org (`hospai/v1/org-blind/${orgId}`, 32-zero-byte salt), not platform-wide `hospai.guest-blind-index.v1`.

(Spec writer documents here; implementer adds the sentence when the vertical lands.)

---

## 4. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `org-derive.test.ts` | Same hex, org A vs B | Derive wrap keys | Different wrapped blobs for same data key |
| T2 | `org-derive.test.ts` | Same hex, org A vs B | HMAC same email | Different `index_hash` |
| T3 | `vault.test.ts` | New profile seal | Decrypt with AAD | Round-trip; wrong AAD fails |
| T4 | `vault.test.ts` | Legacy cipher fixture | Decrypt | Fallback without AAD succeeds |
| T5 | `vault.test.ts` | Store v0 vs v1 rows | Unwrap | Correct master per version |
| T6 | `org-crypto-isolation.spec.ts` | Fresh org A + B, same profile | Create guests | Ciphertext ≠; blind hash ≠ |
| T7 | `org-crypto-isolation.spec.ts` | Same guests | Shred A | B still decrypts |
| T8 | regression | Existing vault/blind-index/guest route tests | — | Green after adapter updates |

Tests **T1–T2, T6–T7** must **fail on current `main`**.

---

## 5. Verify commands

**Focused (must fail before fix, pass after):**

```bash
pnpm --filter @hospai/crypto-shredding test
pnpm --filter @hospai/pms-core exec vitest run test/org-crypto-isolation.spec.ts
```

**Pin assertions after implementation:**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "COMMAND_CATALOG"
```

Expect: `ORG_SCHEMA_HEAD === 9`, `PROPERTY_SCHEMA_HEAD === 34`, `COMMAND_CATALOG.length === 89`, `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'`, `NIGHT_AUDIT_STEPS.length === 8`, `[3] === 'AUTO_TRANSFER'`.

**Full gate:**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**Note:** G5 `test:coverage` on `@hospai/crypto-shredding` is **R0.13** — this vertical runs `pnpm --filter @hospai/crypto-shredding test` only. **pms-core shards:** never put `--` before `--shard`.

---

## 6. Files in scope

| File | Change |
|---|---|
| `packages/crypto-shredding/src/org-derive.ts` | HKDF wrap + blind derivations |
| `packages/crypto-shredding/src/org-derive.test.ts` | Derivation characterization |
| `packages/crypto-shredding/src/vault.ts` | `VaultMasters`, dual unwrap, N14 AAD |
| `packages/crypto-shredding/src/vault.test.ts` | Version + AAD tests |
| `packages/crypto-shredding/src/blind-index.ts` | Org-scoped derive export |
| `packages/crypto-shredding/src/blind-index.test.ts` | Update imports/assertions |
| `packages/crypto-shredding/src/types.ts` | `keyVersion` on record + insert |
| `packages/crypto-shredding/src/master-key.ts` | Comment only (platform IKM) |
| `packages/do-runtime/src/org-migrations.ts` | v9 `key_version` column |
| `packages/do-runtime/src/migrate.test.ts` | `ORG_SCHEMA_HEAD` pin **9** |
| Generated org DDL (via `pnpm generate:ddl`) | v9 statement |
| `apps/pms-core/src/org-key-store.ts` | Persist/read `key_version` |
| `apps/pms-core/src/org-do.ts` | `vault()` / `blindIndexKey()` + INSERT `key_version` |
| `apps/pms-core/src/env.ts` | Platform master comment fix |
| `apps/pms-core/test/org-crypto-isolation.spec.ts` | Two-org N6 characterization |
| `apps/pms-core/test/org-key-store.spec.ts` | `key_version` round-trip if present |
| `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` | One-sentence amend (implementer, when vertical lands) |

**Not in scope:** new routes, catalog entries, PropertyDO migration, SPA changes, KV key cache, rotation UI/rewrap job, org-wide blind-index rehash migration, Playwright, `test:coverage` script (R0.13).

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
| `ORG_SCHEMA_HEAD` | **8 → 9** |

No new dispatched command. Existing idempotency on guest/roster commands unchanged; crypto material changes are backward-compatible reads (v0 unwrap + AAD fallback).

---

## 8. Out of scope

- **R0.6+** desk freshness, board keys, tape cache
- Master-key **rotation UI**, batch **rewrap** v0→v1, platform hex rotation runbook
- Org-wide **blind-index rehash** job for existing `guest_blind_index` rows (guest **update** + `ensureGuestBlindIndex` missing-row path only)
- **G5** `test:coverage` on `@hospai/crypto-shredding` (R0.13)
- New HTTP routes / catalog commands
- PropertyDO extraction; org wrap key in KV
- Rebuilding envelope shred semantics, guest CRM directory UI, property-scoped lists (R0.4)
- Playwright / Cypress e2e
- PITR / post-shred platform hex rotation policy (operational — see [2026-07-28 crypto-shredding spec](./2026-07-28-guests-crypto-shredding-design.md) operational caveat)

---

## 9. Success criteria

1. Two fresh orgs, same platform hex, identical guest profile → **different** `profile_cipher` bytes (**N6** ciphertext isolation).
2. Same setup → **different** email `index_hash` in `guest_blind_index`.
3. Shred org A guest key → org B guest **still decrypts**.
4. Legacy `key_version = 0` rows still unwrap and decrypt (incl. profile blobs **without** AAD).
5. New guests insert `key_version = 1`; wrap uses HKDF org wrap key.
6. Profile encrypt/decrypt binds `piiKeyId` as AAD; legacy fallback works (**N14**).
7. `env.ts` comment describes platform secret + HKDF-per-org — not Vitest-only.
8. `ORG_SCHEMA_HEAD === 9`; other pins unchanged (§7).
9. `pnpm --filter @hospai/crypto-shredding test` and new isolation spec green; `pnpm test:local` green.

---

## 10. Relationship to prior specs

[2026-07-28-guests-crypto-shredding-design.md](./2026-07-28-guests-crypto-shredding-design.md) shipped envelope AES-GCM, per-subject data keys, shred, and OrgDO vault. **This slice amends key derivation only** — shred = destroy wrapped key; events still carry `guest_ref` / `pii_key_id` only.

[2026-08-13-guest-crm-directory-design.md](./2026-08-13-guest-crm-directory-design.md) shipped blind-index search and directory UX. **This slice amends §5.2 index key** to org-scoped HKDF; normalize/hash/`blindIndexRows` algorithm unchanged.

[2026-08-06-guests-pii-vertical-design.md](./2026-08-06-guests-pii-vertical-design.md) HTTP + PropertyDO guest refs unchanged.

[2026-09-05-property-scoped-guest-roster-lists-design.md](./2026-09-05-property-scoped-guest-roster-lists-design.md) (R0.4) is independent — association filters reads; this slice does not touch `guest_property`.

Audit [Vertical 5](../../audit/2026-09-04-full-codebase-audit.md) locked the product call; this spec is the implementation contract for **R0.5**.

---

## 11. Schema head decision

**Locked:** OrgDO **v9** migration adds `data_key.key_version` only. **`ORG_SCHEMA_HEAD` → 9.** **`PROPERTY_SCHEMA_HEAD` stays 34.** No PropertyDO tables. Column enables future rewrap/rotation; no rotation behaviour in this vertical.
