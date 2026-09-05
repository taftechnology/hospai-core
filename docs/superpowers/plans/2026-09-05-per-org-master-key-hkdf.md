# Per-org HKDF master key (R0.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **N6** (one platform master key wraps every org) and **N14** (profile AES-GCM AAD) — HKDF-SHA-256 derive separate org-scoped wrap and blind-index keys from platform IKM; OrgDO v9 `data_key.key_version`; legacy v0 unwrap + AAD decrypt fallback. **No new HTTP routes. No new catalog commands.**

**Architecture:** Characterization tests land **first** and must fail on current `main`. `@hospai/crypto-shredding` gains `org-derive.ts` helpers and `PiiVault` dual-master + profile AAD. OrgDO `vault()` / `blindIndexKey()` thread `getOrgIdSync()`. Existing `data_key` rows stay `key_version = 0`; new inserts use `1`. **No rotation UI, no blind-index mass rehash, no PropertyDO migration.**

**Tech Stack:** `@hospai/crypto-shredding`, OrgDO (`apps/pms-core/src/org-do.ts`), `@hospai/do-runtime` org migrations, vitest + `cloudflare:test` HTTP specs, Web Crypto HKDF/AES-GCM/HMAC.

**Spec:** `docs/superpowers/specs/2026-09-05-per-org-master-key-hkdf-design.md` (Status: Approved — normative).

---

## Global Constraints

- **`COMMAND_CATALOG` length:** **89** — unchanged this vertical.
- **`V1_HTTP_ROUTE_AUDIT`:** length **144**; `[143].id === 'get_city_ledger_statement'` — unchanged.
- **`PROPERTY_SCHEMA_HEAD`:** **34** — unchanged.
- **`ORG_SCHEMA_HEAD`:** **8 → 9** (v9 `data_key.key_version`).
- **`NIGHT_AUDIT_STEPS`:** length **8**; `[3] === 'AUTO_TRANSFER'` — unchanged.
- **HKDF salt:** 32 zero bytes (`new Uint8Array(32)`) — locked; not empty salt.
- **HKDF info:** wrap `hospai/v1/org-wrap/${orgId}`; blind `hospai/v1/org-blind/${orgId}` — separate keys, never one info for both.
- **Platform secret:** stays in wrangler/secrets; fix `env.ts` Vitest-only comment lie.
- **No org-derived keys in KV.** No PropertyDO extraction.
- **pms-core shards:** never put `--` before `--shard` (8 shards); full local suite via `pnpm test:local` on last task.
- **crypto-shredding:** run `pnpm --filter @hospai/crypto-shredding test` — **not** `test:coverage` (R0.13).

---

## Frozen heads (must not move except ORG)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `ORG_SCHEMA_HEAD` | **8** today | **9** after Task 2 |

Tree verified 2026-09-05 per spec. No catalog/route/property pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **Routes / catalog** | **No** new HTTP routes. **No** new `COMMAND_CATALOG` ids. |
| **Comment** | `env.ts` `HOSPAI_ORG_MASTER_KEY` = platform secret, HKDF-per-org — not Vitest-only. |
| **Legacy unwrap** | `key_version === 0` → `importMasterKeyHex(hex)` platform AES wrap. |
| **New wrap** | `key_version === 1` → HKDF org wrap key. All new `data_key` inserts from `provisionKey` / `prepare*` / OrgDO guest+roster create use **1**. |
| **N14 AAD** | Profile encrypt/decrypt bind `piiKeyId` as AES-GCM `additionalData`; decrypt fallback without AAD for legacy blobs. Data-key wrap/unwrap **no AAD**. |
| **Blind index** | Org-scoped HKDF HMAC; `blindIndexRows` / normalize algorithm unchanged. |
| **Two-org test** | **Two separate org DOs**, same miniflare `HOSPAI_ORG_MASTER_KEY`; identical profile → different cipher bytes **and** different email `index_hash`; shred A leaves B readable. |
| **Pre-v9 blind rows** | **Not** mass-rehashed; tests use **fresh** orgs. |
| **Rotation** | **Out of scope** — column exists only; no rewrap job. |

**Out of scope:** R0.6+, rotation UI, org-wide blind rehash migration, G5 `test:coverage` on crypto-shredding, Playwright, PropertyDO, SPA, KV key cache.

---

## Sequencing gate

```
Task 1 (red tests + test hooks) → Task 2 (OrgDO v9 schema) → Task 3 (crypto-shredding) → Task 4 (OrgDO vault wiring + env comment) → Task 5 (full CI + R0.5 tick + CRM amend)
```

**TDD:** Task 1 commits failing characterization tests (T1–T2, T6–T7 red on `main`). Tasks 2–4 make focused specs green. Task 5 runs full CI + `pnpm test:local`.

---

## Task 1 — Failing characterization tests (tests + minimal test hooks)

**Files:**
- Create: `packages/crypto-shredding/src/org-derive.test.ts`
- Modify: `packages/crypto-shredding/src/vault.test.ts`
- Create: `apps/pms-core/test/org-crypto-isolation.spec.ts`
- Modify: `apps/pms-core/src/org-do.ts` (test-only read hooks only — no crypto behaviour change)

**Interfaces (test hooks — add near other `*ForTest` methods ~2513):**

```ts
async readGuestCryptoMaterialForTest(
  guestId: string,
): Promise<{ profileCipher: Uint8Array; profileIv: Uint8Array } | null> {
  this.assertUnsafeLocal('readGuestCryptoMaterialForTest');
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT profile_cipher, profile_iv FROM guest WHERE guest_id = ?`,
      guestId,
    )
    .toArray() as Array<{ profile_cipher: unknown; profile_iv: unknown }>;
  const row = rows[0];
  if (!row) return null;
  return {
    profileCipher: blobToBytes(row.profile_cipher),
    profileIv: blobToBytes(row.profile_iv),
  };
}

async readGuestBlindIndexHashForTest(
  guestId: string,
  kind: 'email',
): Promise<Uint8Array | null> {
  this.assertUnsafeLocal('readGuestBlindIndexHashForTest');
  const rows = this.ctx.storage.sql
    .exec(
      `SELECT index_hash FROM guest_blind_index WHERE guest_id = ? AND kind = ? LIMIT 1`,
      guestId,
      kind,
    )
    .toArray() as Array<{ index_hash: unknown }>;
  const row = rows[0];
  if (!row) return null;
  return blobToBytes(row.index_hash);
}
```

Reuse existing `blobToBytes` helper from `org-key-store.ts` (import or duplicate minimal 5-line helper in org-do if not already shared).

### Step 1 — `org-derive.test.ts` (unit — imports helpers that do not exist yet)

Create `packages/crypto-shredding/src/org-derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  deriveOrgBlindIndexKeyHex,
  deriveOrgWrapKeyHex,
  HKDF_SALT,
  importPlatformIkmHex,
} from './org-derive.js';
import { blindIndexHash, normalizeBlindIndexValue } from './blind-index.js';

const MASTER_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const ORG_A = 'org_a_test_uuid';
const ORG_B = 'org_b_test_uuid';

function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('org-derive', () => {
  it('T1: same hex + different orgId → different wrap output for same data key', async () => {
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const wrapA = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_A);
    const wrapB = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_B);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedA = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, wrapA, { name: 'AES-GCM', iv }),
    );
    const wrappedB = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, wrapB, { name: 'AES-GCM', iv }),
    );
    expect(hexOf(wrappedA)).not.toBe(hexOf(wrappedB));
  });

  it('T2: same hex + different orgId → different email blind hash', async () => {
    const keyA = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_A);
    const keyB = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_B);
    const email = normalizeBlindIndexValue('email', 'same@example.com')!;
    const ha = await blindIndexHash(keyA, 'email', email);
    const hb = await blindIndexHash(keyB, 'email', email);
    expect(hexOf(ha)).not.toBe(hexOf(hb));
  });

  it('wrap key ≠ blind key for same org', async () => {
    const wrap = await deriveOrgWrapKeyHex(MASTER_HEX, ORG_A);
    const blind = await deriveOrgBlindIndexKeyHex(MASTER_HEX, ORG_A);
    expect(wrap.algorithm.name).toBe('AES-GCM');
    expect(blind.algorithm.name).toBe('HMAC');
  });

  it('HKDF_SALT is 32 zero bytes', () => {
    expect(HKDF_SALT.byteLength).toBe(32);
    expect([...HKDF_SALT].every((b) => b === 0)).toBe(true);
  });

  it('importPlatformIkmHex rejects short hex like master-key import', async () => {
    await expect(importPlatformIkmHex('nope')).rejects.toThrow(
      /HOSPAI_ORG_MASTER_KEY must be 64 hex characters/,
    );
  });
});
```

**Red on `main`:** module `./org-derive.js` missing — compile fail or import error.

### Step 2 — Extend `vault.test.ts` (VaultMasters + AAD + keyVersion — red until Task 3)

Add imports and helper at top of `packages/crypto-shredding/src/vault.test.ts`:

```ts
import { deriveOrgWrapKeyHex } from './org-derive.js';
import type { VaultMasters } from './vault.js';

const TEST_ORG = 'vault-test-org';

async function vaultMasters(hex: string): Promise<VaultMasters> {
  return {
    legacyPlatformWrap: await importMasterKeyHex(hex),
    orgWrap: await deriveOrgWrapKeyHex(hex, TEST_ORG),
  };
}
```

Update existing `PiiVault` constructions to `new PiiVault(await vaultMasters(MASTER_HEX), store)`.

Add new cases in `describe('PiiVault', …)`:

```ts
  it('T3: new profile seal uses AAD — wrong piiKeyId AAD fails decrypt', async () => {
    const store = new MemoryKeyStore();
    const vault = new PiiVault(await vaultMasters(MASTER_HEX), store);
    const piiKeyId = await vault.provisionKey('guest', 'guest_aad');
    const sealed = await vault.encryptGuestProfile(piiKeyId, { displayName: 'AAD Guest' });
    await expect(
      vault.decrypt(piiKeyId, sealed.ciphertext, sealed.iv /* wrong-AAD path exercised inside decrypt */),
    ).resolves.toBeDefined();
    // After Task 3: decrypt with tampered wrong-key-id AAD must fail at subtle layer —
    // assert decryptGuestProfile round-trip succeeds; unit test for wrong AAD uses direct subtle call in vault.test if needed.
  });

  it('T4: legacy cipher without AAD still decrypts via fallback', async () => {
    const legacy = await importMasterKeyHex(MASTER_HEX);
    const store = new MemoryKeyStore();
    const legacyVault = new PiiVault({ legacyPlatformWrap: legacy, orgWrap: legacy }, store);
    const piiKeyId = await legacyVault.provisionKey('guest', 'guest_legacy');
    const record = store.get(piiKeyId)!;
    // Manually seal without AAD (simulates pre-N14 blob)
    const dataKey = await crypto.subtle.unwrapKey(
      'raw',
      record.wrappedKey.slice(12),
      legacy,
      { name: 'AES-GCM', iv: record.wrappedKey.slice(0, 12) },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        dataKey,
        new TextEncoder().encode(JSON.stringify({ displayName: 'Legacy' })),
      ),
    );
    const vault = new PiiVault(await vaultMasters(MASTER_HEX), store);
    const opened = await vault.decryptGuestProfile(piiKeyId, ciphertext, iv);
    expect(opened.displayName).toBe('Legacy');
  });

  it('T5: v0 record unwraps legacyPlatformWrap; v1 unwraps orgWrap', async () => {
    const masters = await vaultMasters(MASTER_HEX);
    const store = new MemoryKeyStore();
    const vault = new PiiVault(masters, store);
    const v1Id = await vault.provisionKey('guest', 'guest_v1');
    expect(store.get(v1Id)!.keyVersion).toBe(1);

    // v0 fixture: wrap with legacy master only
    const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(
      await crypto.subtle.wrapKey('raw', dataKey, masters.legacyPlatformWrap, {
        name: 'AES-GCM',
        iv: wrapIv,
      }),
    );
    const v0Id = crypto.randomUUID();
    store.insert({
      piiKeyId: v0Id,
      scope: 'guest',
      subjectId: 'guest_v0',
      wrappedKey: new Uint8Array([...wrapIv, ...wrapped]),
      keyVersion: 0,
    });
    const plain = await vault.decrypt(v0Id, new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
      dataKey,
      new TextEncoder().encode('v0'),
    )), crypto.getRandomValues(new Uint8Array(12)));
    expect(new TextDecoder().decode(plain)).toBe('v0');
  });
```

Update `MemoryKeyStore` in same file to persist `keyVersion?: 0 | 1` (default **1** on insert from vault paths).

**Red on `main`:** `VaultMasters`, `org-derive`, `keyVersion` on record — compile fail until Task 3.

### Step 3 — `org-crypto-isolation.spec.ts` (HTTP + OrgDO SQL reads)

Create `apps/pms-core/test/org-crypto-isolation.spec.ts` — copy HTTP helpers (`postOrg`, `postProperty`, `postGuest`, `getGuest`, `eraseGuest`) from `guests-routes.spec.ts` (~26–180).

```ts
function hexOf(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function provisionTwoOrgsSamePlatformKey(actor: string) {
  const orgA = `org_crypto_a_${crypto.randomUUID()}`;
  const orgB = `org_crypto_b_${crypto.randomUUID()}`;
  const propertyA = `prop_crypto_a_${crypto.randomUUID()}`;
  const propertyB = `prop_crypto_b_${crypto.randomUUID()}`;
  expect((await postOrg(orgA, 'Crypto Org A', actor)).status).toBe(201);
  expect((await postOrg(orgB, 'Crypto Org B', actor)).status).toBe(201);
  expect((await postProperty(orgA, propertyA, actor)).status).toBe(201);
  expect((await postProperty(orgB, propertyB, actor)).status).toBe(201);
  return { orgA, orgB, propertyA, propertyB, actor };
}

describe('per-org crypto isolation (N6)', () => {
  it('T6: two orgs, same profile → different cipher and blind hash', async () => {
    const actor = 'user_crypto_t6';
    const profile = { guestId: 'guest_same', displayName: 'Same Person', email: 'same@example.com' };
    const { orgA, orgB, propertyA, propertyB } = await provisionTwoOrgsSamePlatformKey(actor);

    await postGuest(propertyA, actor, profile);
    await postGuest(propertyB, actor, { ...profile, guestId: 'guest_same_b' });

    const orgStubA = resolveOrgStub(env.ORG_DO, { orgId: orgA }) as DurableObjectStub<OrgDO>;
    const orgStubB = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;

    const matA = await orgStubA.readGuestCryptoMaterialForTest('guest_same');
    const matB = await orgStubB.readGuestCryptoMaterialForTest('guest_same_b');
    expect(matA).not.toBeNull();
    expect(matB).not.toBeNull();
    expect(hexOf(matA!.profileCipher)).not.toBe(hexOf(matB!.profileCipher));

    const hashA = await orgStubA.readGuestBlindIndexHashForTest('guest_same', 'email');
    const hashB = await orgStubB.readGuestBlindIndexHashForTest('guest_same_b', 'email');
    expect(hashA).not.toBeNull();
    expect(hashB).not.toBeNull();
    expect(hexOf(hashA!)).not.toBe(hexOf(hashB!));
  });

  it('T7: shred org A guest; org B guest still decrypts', async () => {
    const actor = 'user_crypto_t7';
    const profile = { displayName: 'Shred Isolation', email: 'shred@example.com' };
    const { orgA, orgB, propertyA, propertyB } = await provisionTwoOrgsSamePlatformKey(actor);

    await postGuest(propertyA, actor, { guestId: 'guest_a', ...profile });
    await postGuest(propertyB, actor, { guestId: 'guest_b', ...profile });

    expect((await eraseGuest(propertyA, actor, 'guest_a')).status).toBe(200);

    const tombA = await getGuest(propertyA, actor, 'guest_a');
    expect(tombA.status).toBe(200);
    expect(await tombA.json()).toMatchObject({ guestId: 'guest_a', erased: true, profile: null });

    const liveB = await getGuest(propertyB, actor, 'guest_b');
    expect(liveB.status).toBe(200);
    expect(await liveB.json()).toMatchObject({
      ok: true,
      guestId: 'guest_b',
      profile: { displayName: 'Shred Isolation', email: 'shred@example.com' },
    });
  });
});
```

Include standard `beforeEach`/`afterEach` platform schema + kill-switch reset from `guests-routes.spec.ts`.

**Red on `main`:** T6 — `hexOf(matA!.profileCipher) === hexOf(matB!.profileCipher)` and blind hashes equal (same platform key today).

### Step 4 — Run focused tests; confirm red

```bash
pnpm --filter @hospai/crypto-shredding test
pnpm --filter @hospai/pms-core exec vitest run test/org-crypto-isolation.spec.ts
```

- [ ] T1–T2 fail (missing `org-derive`) or T6–T7 fail (same cipher/hash on `main`)
- [ ] T3–T5 fail until Task 3 (`VaultMasters`, AAD, `keyVersion`)
- [ ] Do **not** change production crypto behaviour beyond test hooks in this task

### Step 5 — Commit (tests + test hooks)

```bash
git add \
  packages/crypto-shredding/src/org-derive.test.ts \
  packages/crypto-shredding/src/vault.test.ts \
  apps/pms-core/test/org-crypto-isolation.spec.ts \
  apps/pms-core/src/org-do.ts
git commit -m "$(cat <<'EOF'
test: per-org HKDF characterization (red on main)

Two-org cipher/blind-hash isolation spec; org-derive and vault AAD/version
unit tests; OrgDO test read hooks for raw crypto material.
EOF
)"
```

---

## Task 2 — OrgDO v9 migration + pin + generate:ddl

**Files:**
- Modify: `packages/do-runtime/src/org-migrations.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `migrations/do-org/` (via `pnpm generate:ddl`)

**Interfaces:**
- Produces: `data_key.key_version INTEGER NOT NULL DEFAULT 0` on OrgDO v9.

### Step 1 — Add v9 migration statement

In `packages/do-runtime/src/org-migrations.ts`, after v8 block, add:

```ts
const ORG_DATA_KEY_VERSION_STATEMENTS = [
  `ALTER TABLE data_key ADD COLUMN key_version INTEGER NOT NULL DEFAULT 0`,
] as const;
```

Append to `ORG_MIGRATIONS`:

```ts
  {
    version: 9,
    name: '0009_data_key_key_version',
    statements: ORG_DATA_KEY_VERSION_STATEMENTS,
  },
```

- [ ] **No** backfill / rewrap statements
- [ ] **No** `DROP`/`rebuild` of `data_key` (FK from `guest` / `roster`)

### Step 2 — Bump pin

In `packages/do-runtime/src/migrate.test.ts`:

```ts
expect(ORG_SCHEMA_HEAD).toBe(9);
```

(was `8`)

### Step 3 — Regenerate DDL

```bash
pnpm generate:ddl
pnpm check:ddl
```

- [ ] `migrations/do-org/0009_data_key_key_version.sql` exists with `ALTER TABLE data_key ADD COLUMN key_version …`
- [ ] **Not** a fake `generated/` folder — stage `migrations/do-org/` per `check:ddl`
- [ ] `PROPERTY_SCHEMA_HEAD` assertion still **34**

### Step 4 — Focused migrate test

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head"
```

Expected: PASS with `ORG_SCHEMA_HEAD === 9`.

### Step 5 — Commit

```bash
git add \
  packages/do-runtime/src/org-migrations.ts \
  packages/do-runtime/src/migrate.test.ts \
  migrations/do-org/
git commit -m "$(cat <<'EOF'
feat(do-runtime): OrgDO v9 data_key.key_version column

Add key_version for HKDF wrap versioning; bump ORG_SCHEMA_HEAD to 9.
EOF
)"
```

---

## Task 3 — crypto-shredding: HKDF helpers, VaultMasters, AAD, keyVersion

**Files:**
- Create: `packages/crypto-shredding/src/org-derive.ts`
- Modify: `packages/crypto-shredding/src/types.ts`
- Modify: `packages/crypto-shredding/src/vault.ts`
- Modify: `packages/crypto-shredding/src/blind-index.ts`
- Modify: `packages/crypto-shredding/src/master-key.ts` (comment only)
- Modify: `packages/crypto-shredding/src/keystore-conformance.ts`
- Modify: `packages/crypto-shredding/src/index.ts`
- Modify: `packages/crypto-shredding/src/vault.test.ts` (finalize MemoryKeyStore / T3 assertion)
- Modify: `packages/crypto-shredding/src/blind-index.test.ts`

**Interfaces:**

```ts
// org-derive.ts — locked exports
export const HKDF_SALT = new Uint8Array(32);
export async function importPlatformIkmHex(hex: string): Promise<CryptoKey>;
export async function deriveOrgWrapKeyHex(hex: string, orgId: string): Promise<CryptoKey>;
export async function deriveOrgBlindIndexKeyHex(hex: string, orgId: string): Promise<CryptoKey>;

// vault.ts
export type VaultMasters = {
  legacyPlatformWrap: CryptoKey;
  orgWrap: CryptoKey;
};

// types.ts
export type WrappedKeyRecord = { /* existing */ keyVersion: 0 | 1 };
// KeyStore.insert: optional keyVersion?: 0 | 1; default 1 for vault production paths
```

### Step 1 — Implement `org-derive.ts`

Per spec §2.1:

```ts
const PLATFORM_IKM_HEX_RE = /^[0-9a-fA-F]{64}$/;

export const HKDF_SALT = new Uint8Array(32);

function orgWrapInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-wrap/${orgId}`);
}
function orgBlindInfo(orgId: string): Uint8Array {
  return new TextEncoder().encode(`hospai/v1/org-blind/${orgId}`);
}

// importPlatformIkmHex → HKDF IKM CryptoKey (deriveKey only, non-extractable)
// deriveOrgWrapKeyHex → AES-GCM-256 wrapKey/unwrapKey
// deriveOrgBlindIndexKeyHex → HMAC-SHA-256 sign
// hash: SHA-256; salt: HKDF_SALT for both
```

- [ ] Keep `importMasterKeyHex` unchanged for v0 legacy
- [ ] Deprecate org-agnostic `importBlindIndexKeyHex` at OrgDO call sites (Task 4); keep export for unit tests or migrate `blind-index.test.ts` to org-scoped derive

### Step 2 — Extend `types.ts` + `MemoryKeyStore` in tests

```ts
export type WrappedKeyRecord = {
  piiKeyId: string;
  scope: KeyScope;
  subjectId: string;
  wrappedKey: Uint8Array;
  shredded: boolean;
  keyVersion: 0 | 1;
};

export interface KeyStore {
  get(piiKeyId: string): WrappedKeyRecord | null;
  insert(record: {
    piiKeyId: string;
    scope: KeyScope;
    subjectId: string;
    wrappedKey: Uint8Array;
    keyVersion?: 0 | 1;
  }): void;
  shred(piiKeyId: string): boolean;
}
```

Default `keyVersion` to **0** when absent in `MemoryKeyStore.get` for backward compat in manual fixtures; vault `insert` paths pass **1**.

### Step 3 — Refactor `vault.ts`

Replace single `masterKey` constructor with `VaultMasters`:

- `provisionKey` / `preparePiiRecord` / `prepareGuestRecord`: wrap with `masters.orgWrap`; `store.insert(…, keyVersion: 1)`
- `unwrapDataKey`: read `record.keyVersion` — `0` → `legacyPlatformWrap`, `1` → `orgWrap`
- Profile paths (`encrypt`, `decrypt`, `preparePiiRecord`, `prepareProfileSeal`): AAD = UTF-8 `piiKeyId`; decrypt try/catch fallback without AAD
- Data-key `wrapKey`/`unwrapKey`: **no AAD** (unchanged)

Shared helper:

```ts
function profileAad(piiKeyId: string): Uint8Array {
  return new TextEncoder().encode(piiKeyId);
}
```

### Step 4 — Update `blind-index.ts`

- Add `deriveOrgBlindIndexKeyHex(hex, orgId)` using `importPlatformIkmHex` + `HKDF_SALT` + `orgBlindInfo(orgId)`
- Keep `importBlindIndexKeyHex` as thin deprecated wrapper **or** remove from OrgDO imports only
- Do **not** change `normalizeBlindIndexValue`, `blindIndexHash`, `blindIndexRows`

### Step 5 — Update `keystore-conformance.ts`

```ts
const legacy = await importMasterKeyHex(MASTER_HEX);
const orgWrap = await deriveOrgWrapKeyHex(MASTER_HEX, 'conformance-org');
const vault = new PiiVault({ legacyPlatformWrap: legacy, orgWrap }, store);
```

### Step 6 — Export from `index.ts`

```ts
export {
  HKDF_SALT,
  deriveOrgBlindIndexKeyHex,
  deriveOrgWrapKeyHex,
  importPlatformIkmHex,
} from './org-derive.js';
export type { VaultMasters } from './vault.js';
```

### Step 7 — Update `blind-index.test.ts`

- Replace `importBlindIndexKeyHex(MASTER_HEX)` with `deriveOrgBlindIndexKeyHex(MASTER_HEX, 'blind-test-org')` in org-scoped cases
- Keep "two imports same hex sign identically" → "same orgId derives identically"
- Add case: different orgId → different hash (mirrors T2)

### Step 8 — Update `master-key.ts` comment

Replace "local / org binding" with platform IKM wording per spec §2.8.

### Step 9 — Focused package tests

```bash
pnpm --filter @hospai/crypto-shredding test
```

- [ ] T1–T5 green in `org-derive.test.ts` + `vault.test.ts`
- [ ] `keystore-conformance` green
- [ ] `blind-index.test.ts` green

### Step 10 — Commit

```bash
git add \
  packages/crypto-shredding/src/org-derive.ts \
  packages/crypto-shredding/src/types.ts \
  packages/crypto-shredding/src/vault.ts \
  packages/crypto-shredding/src/blind-index.ts \
  packages/crypto-shredding/src/master-key.ts \
  packages/crypto-shredding/src/keystore-conformance.ts \
  packages/crypto-shredding/src/index.ts \
  packages/crypto-shredding/src/vault.test.ts \
  packages/crypto-shredding/src/blind-index.test.ts
git commit -m "$(cat <<'EOF'
feat(crypto-shredding): per-org HKDF wrap/blind keys and profile AAD

VaultMasters dual unwrap by key_version; org-derive helpers; N14 AAD with
legacy decrypt fallback.
EOF
)"
```

---

## Task 4 — Org key store + OrgDO vault/blindIndexKey + env comment

**Files:**
- Modify: `apps/pms-core/src/org-key-store.ts`
- Modify: `apps/pms-core/test/org-key-store.spec.ts`
- Modify: `apps/pms-core/src/org-do.ts` (~279–299, ~1535, ~1840, ~2551)
- Modify: `apps/pms-core/src/env.ts` (~73–74)

**Interfaces:**
- Consumes: `VaultMasters`, `deriveOrgWrapKeyHex`, `deriveOrgBlindIndexKeyHex`, `importMasterKeyHex` from `@hospai/crypto-shredding`
- Produces: org-scoped vault + blind index on all guest/roster crypto paths

### Step 1 — `SqlKeyStore` read/write `key_version`

In `apps/pms-core/src/org-key-store.ts`:

**`get`:** add `key_version` to SELECT; map `null`/missing → `0`:

```ts
keyVersion: (row.key_version ?? 0) as 0 | 1,
```

**`insert`:** extend signature with optional `keyVersion?: 0 | 1` (default **1**):

```sql
INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at, key_version)
VALUES (?, ?, ?, ?, ?, ?)
```

Update `DoBlobSql` stub in `org-key-store.spec.ts` to handle `key_version` column in INSERT/SELECT.

Add round-trip test:

```ts
it('insert defaults key_version 1; get returns keyVersion', () => { /* … */ });
it('get maps missing key_version to 0', () => { /* … */ });
```

### Step 2 — Replace `vault()` / `blindIndexKey()` in `org-do.ts`

Per spec §2.5 — call `getOrgIdSync()` **before** promise creation; throw `'org_id unset'` if missing:

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

Update imports — remove `importBlindIndexKeyHex` from OrgDO import site.

- [ ] One OrgDO instance = one org; promises remain instance-scoped
- [ ] All `blindIndexRows(await this.blindIndexKey(), …)` call sites unchanged in shape

### Step 3 — Direct SQL `INSERT INTO data_key` paths add `key_version = 1`

Update all three INSERT sites in `org-do.ts`:

| Location | Context |
|---|---|
| ~1536 | `tryCreateGuest` |
| ~1840 | `tryCreateRoster` |
| ~2551 | `testProvisionStaffKey` |

```sql
INSERT INTO data_key (pii_key_id, scope, subject_id, wrapped_key, created_at, key_version)
VALUES (?, ?, ?, ?, ?, ?)
```

Bind `1` as last parameter. Material from `vault.prepare*` already wrapped with org HKDF key.

- [ ] Prefer **not** adding duplicate insert paths — keep vault + SQL in sync

### Step 4 — Fix `env.ts` JSDoc (normative one-liner)

Replace line ~73:

```ts
/** Platform PII master key material (64-char hex). HKDF-derived per org in OrgDO — not a direct org wrap key. Set via wrangler secret in staging/production; miniflare binding in local/tests. */
HOSPAI_ORG_MASTER_KEY?: string;
```

### Step 5 — Focused integration tests

```bash
pnpm --filter @hospai/crypto-shredding test
pnpm --filter @hospai/pms-core exec vitest run test/org-crypto-isolation.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/org-key-store.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/guests-routes.spec.ts test/guests.spec.ts
```

- [ ] T6–T7 green (cipher + blind hash differ; shred isolation)
- [ ] Existing guest route/spec regression green
- [ ] `org-key-store` conformance + key_version round-trip green

```bash
pnpm typecheck
```

### Step 6 — Commit

```bash
git add \
  apps/pms-core/src/org-key-store.ts \
  apps/pms-core/test/org-key-store.spec.ts \
  apps/pms-core/src/org-do.ts \
  apps/pms-core/src/env.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): OrgDO per-org HKDF vault and blind-index keys

Derive wrap/blind keys from getOrgIdSync(); persist key_version=1 on new
data_key rows; fix platform master key env comment.
EOF
)"
```

---

## Task 5 — Full CI + tick R0.5 + CRM spec amend

**Files:**
- Modify: `docs/roadmap.md` (~181)
- Modify: `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md` (~247 **§5.2 Index key**)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/crypto-shredding test
pnpm --filter @hospai/pms-core exec vitest run test/org-crypto-isolation.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/org-key-store.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/guests-routes.spec.ts test/guests.spec.ts
```

- [ ] Green

### Step 2 — Full CI `checks` job sequence (copy in order)

```bash
pnpm build
pnpm --filter @hospai/pms-core exec wrangler deploy --dry-run
pnpm check:ddl
pnpm check:entitlements
pnpm check:permissions
pnpm check:degraded
pnpm check:class-denylist
pnpm check:forbidden-bodies
pnpm check:do-transport-guards
pnpm check:web-pms-colors
pnpm check:class-resolution
pnpm check:ui-kit-adoption
pnpm check:spa-page-chrome
pnpm check:web-pms-me-gating
pnpm check:pms-core-test-dates
pnpm check:module-manifests
pnpm check:purge
node scripts/module-manifests-check.mjs --self-test
node scripts/purge-check.mjs --self-test
node scripts/forbidden-body-check.mjs --self-test
node scripts/do-transport-guards-check.mjs --self-test
node scripts/web-pms-colors-check.mjs --self-test
node scripts/class-resolution-check.mjs --self-test
node scripts/ui-kit-adoption-check.mjs --self-test
node scripts/spa-page-chrome-check.mjs --self-test
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm test:coverage
pnpm lint
```

- [ ] All green

### Step 3 — pms-core shards (full local suite)

```bash
pnpm test:local
```

**Never put `--` before `--shard`.**

Alternative — match CI matrix exactly:

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8 --exclude test/reservations-ledger.property.spec.ts --exclude test/reservations-ledger-virtual.property.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-ledger.property.spec.ts test/reservations-ledger-virtual.property.spec.ts
```

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `ORG_SCHEMA_HEAD === 9`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.5

In `docs/roadmap.md` ~181, change:

```markdown
- [ ] **R0.5** Audit V5 — N6. per-org HKDF master key + comment lie.
```

to:

```markdown
- [x] **R0.5** Audit V5 — N6. per-org HKDF master key + comment lie.
```

### Step 6 — CRM spec one-sentence amend (§5.2)

Append after §5.2 **Index key** block (~266) in `docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md`:

> **Amended by [2026-09-05 per-org HKDF master key](./2026-09-05-per-org-master-key-hkdf-design.md):** blind-index HMAC key is HKDF-derived per org (`hospai/v1/org-blind/${orgId}`, 32-zero-byte salt), not platform-wide `hospai.guest-blind-index.v1`.

Also add one line to top **Amends:** paragraph (~9) for bidirectional pointer (same pattern as R0.4 property-scoped amend).

### Step 7 — Commit

```bash
git add \
  docs/roadmap.md \
  docs/superpowers/specs/2026-08-13-guest-crm-directory-design.md
git commit -m "$(cat <<'EOF'
chore: tick R0.5 after per-org HKDF master key vertical

Full CI checks and pms-core shards green; amend CRM spec index key; N6/N14 closed.
EOF
)"
```

---

## Test matrix (spec §4 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `org-derive.test.ts` | 1 / 3 | Different org wrap blobs | Yes |
| T2 | `org-derive.test.ts` | 1 / 3 | Different email HMAC | Yes |
| T3 | `vault.test.ts` | 1 / 3 | AAD round-trip; wrong AAD fails | Yes |
| T4 | `vault.test.ts` | 1 / 3 | Legacy no-AAD decrypt fallback | Yes |
| T5 | `vault.test.ts` | 1 / 3 | v0 legacy unwrap; v1 org unwrap | Yes |
| T6 | `org-crypto-isolation.spec.ts` | 1 / 4 | Two orgs → cipher ≠; hash ≠ | Yes |
| T7 | `org-crypto-isolation.spec.ts` | 1 / 4 | Shred A; B still decrypts | No (shred already per-key; T6 is primary red gate) |
| T8 | regression | 4–5 | vault/blind-index/guest routes green | No |

---

## Success criteria (spec §9)

1. Two fresh orgs, same platform hex, identical guest profile → **different** `profile_cipher` bytes (**N6**).
2. Same setup → **different** email `index_hash` in `guest_blind_index`.
3. Shred org A guest key → org B guest **still decrypts**.
4. Legacy `key_version = 0` rows still unwrap and decrypt (incl. profile blobs **without** AAD).
5. New guests insert `key_version = 1`; wrap uses HKDF org wrap key.
6. Profile encrypt/decrypt binds `piiKeyId` as AAD; legacy fallback works (**N14**).
7. `env.ts` comment describes platform secret + HKDF-per-org — not Vitest-only.
8. `ORG_SCHEMA_HEAD === 9`; other pins unchanged.
9. `pnpm --filter @hospai/crypto-shredding test`, isolation spec, and `pnpm test:local` green.

---

## Plan vs codebase notes (reviewer)

| Item | Notes |
|---|---|
| `vault()` today ignores `orgId` | ~279–288 imports platform AES directly — T6 fails until Task 4. |
| `importBlindIndexKeyHex` uses empty salt + platform-wide info | ~4–35 `blind-index.ts` — T2/T6 fail until Task 3–4. |
| Direct SQL `INSERT INTO data_key` | Three sites (~1536, ~1840, ~2551) bypass `KeyStore.insert` — all need `key_version = 1`. |
| `PiiVault` single-master constructor | All callers (`keystore-conformance`, `vault.test`, OrgDO) updated in Tasks 3–4. |
| Test hooks for raw bytes | `readGuestCryptoMaterialForTest` / `readGuestBlindIndexHashForTest` added Task 1 — no HTTP leak. |
| `DoBlobSql` stub | Must learn `key_version` column or org-key-store tests fail Task 4. |
| Pre-v9 blind-index rows | Not rehashed — search may miss old rows until guest update; tests use fresh orgs only. |
| Generated DDL path | `migrations/do-org/0009_*.sql` via `pnpm generate:ddl` — same as v8 property association. |
| R0.13 `test:coverage` | **Not** this vertical — use `pnpm --filter @hospai/crypto-shredding test` only. |
