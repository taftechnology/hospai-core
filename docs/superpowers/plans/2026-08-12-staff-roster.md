# Staff Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the OrgDO Staff-class PII roster (`roster.*`), mint `staff_…` ids, gate housekeeping assign on the live roster, and add the roster SPA plus board picker.

**Architecture:** Guest-shaped OrgDO record (not a housekeeping table, not membership). Four catalog commands `FAIL_CLOSED` on OrgDO; `housekeeping.assign` stays `QUEUE_PROVISIONAL` with a PropertyDO preamble that consults OrgDO. Exit re-seals identity off the blob and keeps the key. Catalog rename is commit 1, before any HTTP routes exist. Six roster routes and six `V1_HTTP_ROUTE_AUDIT` rows land in the same later commit.

**Tech Stack:** Cloudflare Durable Objects (OrgDO / PropertyDO), SQLite + `RAISE(ABORT)` triggers, `@hospai/crypto-shredding`, `@hospai/contracts`, `@hospai/money`, vitest + cloudflare:test, React SPA in `apps/web-pms` + `modules/pms/housekeeping`.

**Spec:** `docs/superpowers/specs/2026-08-12-staff-roster-design.md` (Accepted).

## Global Constraints

- Location: OrgDO, guest-shaped, **outside** `pms.housekeeping`. Do not extend `ModuleTxnCtx`.
- Record: org-wide **staff** identity with a `kinds` set. Phase 1 permitted kind: `'housekeeper'` only.
- Roster ≠ membership. Do not wire to Clerk. Do not reuse `staff:*`.
- Commands: `roster.add|update|status|exit`. Events: `roster.created|updated|exited` (refs only). Drop `housekeeping.staff_*` and `staff.housekeeper_changed`. `prototypeAction` stays prototype names.
- All four roster commands `FAIL_CLOSED`, `entitlement: 'pms.core'`, audit-writer exemptions (OrgDO home). `housekeeping.assign` stays `QUEUE_PROVISIONAL`.
- Cipher mutable iff `OLD.exited_at IS NULL`. Do not key the trigger off `NEW.exited_at`.
- Exit = re-seal A (drop displayName/email/phone, keep employment fields, keep key). Second exit: app short-circuit before SQL. Update/status after exit: **application** `staff_exited` (HTTP 409); trigger is backstop.
- Add takes `StaffProfileCreate` (`displayName: string` required). At-rest/post-exit is `StaffProfile` (all optional).
- Server mints `staff_${crypto.randomUUID()}`. Client `staffId` on add → 400 `invalid_body`.
- Assign: PropertyDO down → 202; OrgDO down → 503 `org_unreachable` FAIL_CLOSED, not 500, not 202. Replay: domain errors ack; `org_unreachable` → `msg.retry()`.
- Fold `gateGuestRef` into the same `org_unreachable` union. `assertPermission` does **not** gain `assertRpcAvailable`.
- Six new HTTP routes + six `V1_HTTP_ROUTE_AUDIT` entries in the **same commit**. Catalog rename is a **prior** commit with no routes.
- Nav `/roster` order 55, permission `roster:write`. Picker on `HousekeepingApp`. No free-text assignee.
- Compensation HTTP uses `Money` from `@hospai/money`. Strip is application-level.
- No either/or forks. Do not reopen location, kinds cardinality, exit=re-seal, FAIL_CLOSED roster, or QUEUE_PROVISIONAL assign.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/commands/catalog.ts` | Rename four ids; `ROSTER_FAMILY_NOTES` / `ROSTER_FAIL_CLOSED_NOTES` |
| `packages/contracts/src/permissions.ts` | `roster:read\|write\|compensation`; ROLE_GRANTS |
| `packages/contracts/src/entitlements.ts` | Drop `housekeeping.staff_delete` opt-out |
| `packages/contracts/src/commands/audit-writers.ts` | Four OrgDO exemptions |
| `packages/contracts/src/idempotency.ts` | `STAFF_*` / `staff_exited` wire codes |
| `packages/contracts/src/v1-http-routes.ts` | Six audit rows (Task 6 only) |
| `packages/contracts/src/register.test.ts` | Retarget family notes; pin new audit indices |
| `apps/pms-core/src/event-consumer.ts` | Allowlist `roster.*` events (Task 1, no routes) |
| `packages/crypto-shredding/src/types.ts` | `StaffProfile` / `StaffProfileCreate` |
| `packages/crypto-shredding/src/vault.ts` | Generic prepare/seal |
| `packages/do-runtime/src/org-migrations.ts` | v6 `roster` + `roster_kind` + triggers |
| `migrations/do-org/0006_roster.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | Wire `ORG_ROSTER_SQL` |
| `apps/pms-core/src/org-do.ts` | Roster RPCs + `assertStaffAssignable` + `assertRpcAvailable` on guest/staff asserts |
| `apps/pms-core/src/property-do.ts` | `gateOrgRef` / `gateStaffRef`; assign preamble |
| `apps/pms-core/src/v1-dispatch.ts` | Six roster routes + assign/book `org_unreachable` mapping |
| `apps/pms-core/src/pending-commands-consumer.ts` | Replay retries `org_unreachable` |
| `apps/pms-core/src/roster-http.ts` | Strip + compensation-write gate (unit-testable) |
| `apps/pms-core/test/roster.spec.ts` | OrgDO RPC tests 1–13 |
| `apps/pms-core/test/roster-routes.spec.ts` | HTTP tests 1a, 10, 14–19 |
| `apps/pms-core/test/roster-assign.spec.ts` | Assign + dual degraded 20–27, 29 |
| `packages/client-core/src/api.ts` | `listRoster` / roster mutations / `assignHousekeeping` |
| `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx` | Picker |
| `apps/web-pms/src/screens/RosterRoute.tsx` | Nav-gated SPA |
| `apps/web-pms/src/shell/nav.ts` | `/roster` order 55 |

---

### Task 1: Contracts rename (own commit, no HTTP routes)

**Files:**
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/permissions.ts`
- Modify: `packages/contracts/src/entitlements.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `apps/pms-core/src/event-consumer.ts`
- Test: `packages/contracts` vitest + `apps/pms-core/test/events-queue.spec.ts`

**Interfaces:**
- Produces: catalog ids `roster.add|update|status|exit`; events `roster.created|updated|exited`; permissions `roster:read|write|compensation`; four audit exemptions; event-consumer allowlist
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any `/roster` handler. `check:permissions` stays green because audit length still matches dispatcher.

- [ ] **Step 1: Write the failing register tests**

In `packages/contracts/src/register.test.ts`, replace the `housekeeping.staff_*` test and add notes-equality + gone-id canaries:

```ts
it('catalog has no housekeeping.staff_* and no staff.housekeeper_changed', () => {
  expect(COMMAND_CATALOG.map((c) => c.id)).not.toEqual(
    expect.arrayContaining([
      'housekeeping.staff_add',
      'housekeeping.staff_status',
      'housekeeping.staff_delete',
      'housekeeping.staff_update',
    ]),
  );
  expect(COMMAND_CATALOG.flatMap((c) => c.events)).not.toContain('staff.housekeeper_changed');
});

it('roster.* family records §4.8 notes; add/update/status share ROSTER_FAIL_CLOSED_NOTES', () => {
  const add = COMMAND_CATALOG.find((c) => c.id === 'roster.add');
  const update = COMMAND_CATALOG.find((c) => c.id === 'roster.update');
  const status = COMMAND_CATALOG.find((c) => c.id === 'roster.status');
  const exit = COMMAND_CATALOG.find((c) => c.id === 'roster.exit');
  for (const c of [add, update, status, exit]) {
    expect(c?.permission).toBe('roster:write');
    expect(c?.degraded).toBe('FAIL_CLOSED');
    expect(c?.entitlement).toBe('pms.core');
    expect(c?.notes).toMatch(/Staff-class PII/i);
    expect(c?.notes).toMatch(/membership staff\.\*/i);
  }
  expect(add?.events).toEqual(['roster.created']);
  expect(update?.events).toEqual(['roster.updated']);
  expect(status?.events).toEqual(['roster.updated']);
  expect(exit?.events).toEqual(['roster.exited']);
  expect(add?.notes).toBe(update?.notes);
  expect(add?.notes).toBe(status?.notes);
  expect(add?.notes).toMatch(/KV permission projection/i);
  expect(add?.notes).toMatch(/minted staff_/i);
  expect(exit?.notes).toMatch(/pseudonymize/i);
  expect(exit?.notes).not.toBe(add?.notes);
});

it('HOUSEKEEPING_STAFF_FAMILY_NOTES is gone', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'commands/catalog.ts'), 'utf8');
  expect(src).not.toMatch(/HOUSEKEEPING_STAFF_FAMILY_NOTES/);
});
```

Keep `expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(30)` — exemptions grow, the writer set does not.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @hospai/contracts test -- src/register.test.ts`

Expected: FAIL — `roster.add` not in catalog / old ids still present.

- [ ] **Step 3: Replace catalog notes + four entries**

In `packages/contracts/src/commands/catalog.ts`, delete `HOUSEKEEPING_STAFF_FAMILY_NOTES`. Add:

```ts
export const ROSTER_FAMILY_NOTES =
  'Roster family (Staff-class PII / per-staff key), distinct from membership staff.* ' +
  '(access revocation). §4.8: staff exit is not deletion — identity is pseudonymized and ' +
  'employment follows statutory retention. Command ids are roster.*.';

export const ROSTER_FAIL_CLOSED_NOTES =
  'FAIL_CLOSED because OrgDO is on the pre-handler permission gate path ' +
  '(requirePermission → assertPermission), not because roster writes are ' +
  'unimportant. Revisit when the §4.3 KV permission projection lets ' +
  'property-scoped requests survive an OrgDO blip — then an org ' +
  'provisional plane becomes meaningful. Also read-your-write: client ' +
  'needs a minted staff_… before the assign picker can offer it.';

export const ROSTER_EXIT_NOTES =
  ROSTER_FAMILY_NOTES +
  ' Exit is FAIL_CLOSED (OrgDO home) and pseudonymize-not-shred: re-seal drops ' +
  'displayName/email/phone, keeps the staff key and employment fields.';
```

Replace the four `housekeeping.staff_*` objects in place (same array slot, so surrounding catalog order is unchanged):

```ts
{
  id: 'roster.add',
  prototypeAction: 'ADD_HOUSEKEEPER',
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['roster.created'],
  entitlement: 'pms.core',
  permission: 'roster:write',
  notes: ROSTER_FAIL_CLOSED_NOTES + ' ' + ROSTER_FAMILY_NOTES,
},
{
  id: 'roster.status',
  prototypeAction: 'UPDATE_HOUSEKEEPER_STATUS',
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['roster.updated'],
  entitlement: 'pms.core',
  permission: 'roster:write',
  notes: ROSTER_FAIL_CLOSED_NOTES + ' ' + ROSTER_FAMILY_NOTES,
},
{
  id: 'roster.exit',
  prototypeAction: 'DELETE_HOUSEKEEPER',
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['roster.exited'],
  entitlement: 'pms.core',
  permission: 'roster:write',
  notes: ROSTER_EXIT_NOTES,
},
{
  id: 'roster.update',
  prototypeAction: 'UPDATE_HOUSEKEEPER',
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['roster.updated'],
  entitlement: 'pms.core',
  permission: 'roster:write',
  notes: ROSTER_FAIL_CLOSED_NOTES + ' ' + ROSTER_FAMILY_NOTES,
},
```

`prototypeAction` stays the prototype names (ARCHITECTURE §16.3 rule 4).

- [ ] **Step 4: Permissions + grants**

In `packages/contracts/src/permissions.ts`, append to `PROPERTY_SCOPED_PERMISSIONS` (after `housekeeping:write` is fine):

```ts
  'roster:read',
  'roster:write',
  'roster:compensation',
```

`ROLE_GRANTS.admin` is an explicit list — add all three after `housekeeping:write`. `ROLE_GRANTS.staff` gets `'roster:read'` only. Owner already receives `GRANTABLE_PERMISSIONS`.

- [ ] **Step 5: Entitlements + audit exemptions**

In `packages/contracts/src/entitlements.ts`, **delete** the `{ id: 'housekeeping.staff_delete', … }` opt-out row.

In `packages/contracts/src/commands/audit-writers.ts`, append four exemptions (writer set size stays 30):

```ts
  { id: 'roster.add', reason: 'OrgDO home — staff PII not on PropertyDO audit_log' },
  { id: 'roster.update', reason: 'OrgDO home — staff PII not on PropertyDO audit_log' },
  { id: 'roster.status', reason: 'OrgDO home — staff PII not on PropertyDO audit_log' },
  { id: 'roster.exit', reason: 'OrgDO home — staff PII not on PropertyDO audit_log' },
```

- [ ] **Step 6: Event consumer allowlist (required this commit)**

`apps/pms-core/test/events-queue.spec.ts` iterates every `COMMAND_CATALOG` event type. In `apps/pms-core/src/event-consumer.ts`, replace `case 'staff.housekeeper_changed':` with:

```ts
    case 'roster.created':
    case 'roster.updated':
    case 'roster.exited':
```

Keep `staff.changed` (membership). Do not add HTTP routes.

- [ ] **Step 7: Run tests + gates that must stay green**

```
pnpm --filter @hospai/contracts test
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
pnpm check:permissions
pnpm check:degraded
pnpm check:entitlements
```

Expected: all green. `check:permissions` route counts unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/commands/catalog.ts packages/contracts/src/permissions.ts \
  packages/contracts/src/entitlements.ts packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/register.test.ts apps/pms-core/src/event-consumer.ts
git commit -m "$(cat <<'EOF'
refactor(contracts): rename housekeeping.staff_* to roster.*

Unrouted catalog ids, events, permissions, and audit exemptions land before any HTTP routes so check:permissions never sees a half-applied dispatcher/audit pair.
EOF
)"
```

---

### Task 2: `StaffProfileCreate` + generic vault

**Files:**
- Modify: `packages/crypto-shredding/src/types.ts`
- Modify: `packages/crypto-shredding/src/vault.ts`
- Modify: `packages/crypto-shredding/src/index.ts`
- Modify: `packages/crypto-shredding/src/vault.test.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Test: `packages/crypto-shredding` vitest

**Interfaces:**
- Consumes: Task 1 catalog ids (not called yet)
- Produces: `StaffProfile`, `StaffProfileCreate`, generic `preparePiiRecord` / `prepareProfileSeal`, wire codes `STAFF_NOT_FOUND` / `STAFF_EXITED` / `STAFF_NOT_ASSIGNABLE` / `INVALID_KINDS` / `EMPTY_KINDS`

- [ ] **Step 1: Write the failing type/vault test**

In `packages/crypto-shredding/src/vault.test.ts`:

```ts
it('preparePiiRecord + prepareProfileSeal round-trip a StaffProfileCreate, then a thin StaffProfile', async () => {
  const vault = new PiiVault(await importMasterKeyHex(MASTER_HEX), new MemoryKeyStore());
  const created: StaffProfileCreate = { displayName: 'Ada', email: 'ada@example.com' };
  const material = await vault.preparePiiRecord('staff', 'staff_ada', created);
  store.insert({ piiKeyId: material.piiKeyId, scope: 'staff', subjectId: 'staff_ada', wrappedKey: material.wrappedKey });
  const opened = await vault.decryptProfile<StaffProfile>(material.piiKeyId, material.profileCipher, material.profileIv);
  expect(opened.displayName).toBe('Ada');

  const { displayName: _n, email: _e, phone: _p, ...employment } = opened;
  const resealed = await vault.prepareProfileSeal(material.piiKeyId, employment);
  const afterExit = await vault.decryptProfile<StaffProfile>(material.piiKeyId, resealed.profileCipher, resealed.profileIv);
  expect(afterExit).toEqual({});
  expect('displayName' in afterExit).toBe(false);
});
```

(`store` is the `MemoryKeyStore` instance passed to the vault — keep a reference.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hospai/crypto-shredding test`

Expected: FAIL — `preparePiiRecord` / `StaffProfileCreate` not exported.

- [ ] **Step 3: Types**

In `packages/crypto-shredding/src/types.ts`:

```ts
export type StaffProfile = {
  displayName?: string;
  email?: string;
  phone?: string;
  hourlyRateMinor?: number;
  hourlyRateCurrency?: string;
  rating?: number;
  skills?: string[];
};

export type StaffProfileCreate = StaffProfile & { displayName: string };
```

Keep existing `GuestProfile` unchanged (`displayName: string` required).

- [ ] **Step 4: Generic vault**

In `packages/crypto-shredding/src/vault.ts`, change `prepareGuestRecord` / `prepareProfileSeal` to generics. Keep `prepareGuestRecord` as a thin alias so existing guest callers compile:

```ts
async preparePiiRecord<T extends object>(
  scope: KeyScope,
  subjectId: string,
  profile: T,
): Promise<{
  piiKeyId: string;
  wrappedKey: Uint8Array;
  profileCipher: Uint8Array;
  profileIv: Uint8Array;
}> {
  // same body as today's prepareGuestRecord, JSON.stringify(profile)
}

async prepareGuestRecord(
  scope: KeyScope,
  subjectId: string,
  profile: GuestProfile,
) {
  return this.preparePiiRecord(scope, subjectId, profile);
}

async prepareProfileSeal<T extends object>(
  piiKeyId: string,
  profile: T,
): Promise<{ profileCipher: Uint8Array; profileIv: Uint8Array }> {
  // same body as today
}

async decryptProfile<T>(piiKeyId: string, ciphertext: Uint8Array, iv: Uint8Array): Promise<T> {
  const plain = await this.decrypt(piiKeyId, ciphertext, iv);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
```

`encryptGuestProfile` / `decryptGuestProfile` stay as guest wrappers.

Export the new types from `packages/crypto-shredding/src/index.ts`.

- [ ] **Step 5: Wire codes**

In `packages/contracts/src/idempotency.ts`, after the guest codes:

```ts
export const STAFF_NOT_FOUND = 'staff_not_found' as const;
export const STAFF_EXITED = 'staff_exited' as const;
export const STAFF_NOT_ASSIGNABLE = 'staff_not_assignable' as const;
export const INVALID_KINDS = 'invalid_kinds' as const;
export const EMPTY_KINDS = 'empty_kinds' as const;
```

- [ ] **Step 6: Tests pass + commit**

Run: `pnpm --filter @hospai/crypto-shredding test` and `pnpm --filter @hospai/contracts test`

```bash
git add packages/crypto-shredding packages/contracts/src/idempotency.ts
git commit -m "$(cat <<'EOF'
feat(crypto): generic profile seal and StaffProfileCreate

Add-path displayName is required in the type; at-rest/post-exit StaffProfile is all-optional so a thin exit can re-seal to {}.
EOF
)"
```

---

### Task 3: OrgDO schema v6 + triggers + DDL

**Files:**
- Modify: `packages/do-runtime/src/org-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `migrations/do-org/0006_roster.sql` (via `pnpm generate:ddl`)
- Test: `packages/do-runtime` vitest + `pnpm check:ddl`

**Interfaces:**
- Consumes: nothing from Task 2 at runtime (DDL only)
- Produces: `ORG_ROSTER_SQL`, `ORG_MIGRATIONS` version 6, on-disk `0006_roster.sql`

- [ ] **Step 1: Write the failing migrate test**

In `packages/do-runtime/src/migrate.test.ts`:

1. `MemorySql.exec`: treat `CREATE TRIGGER` like `CREATE TABLE` (record and return). Without this, v6 throws `Unhandled SQL`.
2. Change `expect(migrateSql(sql, [...ORG_MIGRATIONS])).toBe(5)` to `6`.
3. Add a disk-match test for `migrations/do-org/0006_roster.sql` vs `ORG_ROSTER_SQL` (copy the 0005 pattern).
4. Import `ORG_ROSTER_SQL`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hospai/do-runtime test -- src/migrate.test.ts`

Expected: FAIL — version still 5 / `ORG_ROSTER_SQL` missing.

- [ ] **Step 3: Migration SQL**

Append to `packages/do-runtime/src/org-migrations.ts`:

```ts
export const ORG_ROSTER_STATEMENTS: string[] = [
  `CREATE TABLE roster (
  staff_id        TEXT PRIMARY KEY,
  pii_key_id      TEXT NOT NULL,
  profile_cipher  BLOB NOT NULL,
  profile_iv      BLOB NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  exited_at       INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (pii_key_id) REFERENCES data_key(pii_key_id)
)`,

  `CREATE TABLE roster_kind (
  staff_id TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('housekeeper')),
  PRIMARY KEY (staff_id, kind),
  FOREIGN KEY (staff_id) REFERENCES roster(staff_id)
)`,

  `CREATE TRIGGER roster_insert
BEFORE INSERT ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster insert must be active and not exited')
  WHERE NEW.status != 'active' OR NEW.exited_at IS NOT NULL;
END`,

  `CREATE TRIGGER roster_update
BEFORE UPDATE ON roster
BEGIN
  SELECT RAISE(ABORT, 'roster cannot be active and exited')
  WHERE NEW.status = 'active' AND NEW.exited_at IS NOT NULL;
  SELECT RAISE(ABORT, 'roster exited is terminal')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.exited_at IS NOT OLD.exited_at OR NEW.status IS NOT 'inactive'
  );
  SELECT RAISE(ABORT, 'roster cipher frozen after exit')
  WHERE OLD.exited_at IS NOT NULL AND (
    NEW.profile_cipher IS NOT OLD.profile_cipher
    OR NEW.profile_iv IS NOT OLD.profile_iv
  );
  SELECT RAISE(ABORT, 'roster exit requires inactive')
  WHERE OLD.exited_at IS NULL AND NEW.exited_at IS NOT NULL AND NEW.status IS NOT 'inactive';
END`,

  `CREATE TRIGGER roster_kind_insert
BEFORE INSERT ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_update
BEFORE UPDATE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = NEW.staff_id AND exited_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,

  `CREATE TRIGGER roster_kind_delete
BEFORE DELETE ON roster_kind
BEGIN
  SELECT RAISE(ABORT, 'roster_kind frozen after exit')
  WHERE EXISTS (SELECT 1 FROM roster WHERE staff_id = OLD.staff_id AND exited_at IS NOT NULL);
END`,
];

export const ORG_ROSTER_SQL = ORG_ROSTER_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `ORG_MIGRATIONS`:

```ts
  {
    version: 6,
    name: '0006_roster',
    statements: ORG_ROSTER_STATEMENTS,
  },
```

Cipher mutability is **`OLD.exited_at IS NULL`** (the freeze trigger fires only when OLD is set). Do not rewrite it as “immutable when `NEW.exited_at` is set” — that aborts the exit UPDATE.

Export `ORG_ROSTER_SQL` from `packages/do-runtime/src/index.ts` next to `ORG_MEMBER_AUDIT_COLUMNS_SQL`.

- [ ] **Step 4: DDL generator**

In `scripts/property-ddl.mjs`:

1. Destructure `ORG_ROSTER_SQL` from the dynamic import (alongside `ORG_MEMBER_AUDIT_COLUMNS_SQL`).
2. Append a target after 0005:

```js
  {
    path: join(root, 'migrations/do-org/0006_roster.sql'),
    header: `-- OrgDO staff roster + kinds + freeze triggers — generated from @hospai/do-runtime
-- DO NOT EDIT BY HAND. Edit packages/do-runtime/src/org-migrations.ts
-- Regenerate: pnpm generate:ddl

`,
    sql: ORG_ROSTER_SQL,
  },
```

- [ ] **Step 5: Generate + check**

```
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
pnpm check:ddl
pnpm --filter @hospai/do-runtime test -- src/migrate.test.ts
```

Expected: `0006_roster.sql` written; checks green; migrateSql → 6.

- [ ] **Step 6: Commit**

```bash
git add packages/do-runtime scripts/property-ddl.mjs migrations/do-org/0006_roster.sql
git commit -m "$(cat <<'EOF'
feat(org-do): roster schema, kinds, and freeze triggers

First OrgDO triggers: cipher is mutable iff OLD.exited_at IS NULL so exit can rewrite the blob and later updates cannot.
EOF
)"
```

---

### Task 4: OrgDO roster RPCs + guest isolation

**Files:**
- Modify: `apps/pms-core/src/org-do.ts`
- Create: `apps/pms-core/test/roster.spec.ts`
- Create: `apps/pms-core/test/roster-helpers.ts`
- Modify: `apps/pms-core/test/guests.spec.ts` (test 13 lives here or in roster.spec — put it in roster.spec)
- Test: `pnpm --filter @hospai/pms-core exec vitest run test/roster.spec.ts test/guests.spec.ts`

**Interfaces:**
- Consumes: `StaffProfileCreate`, `preparePiiRecord`, v6 schema, wire codes from Task 2
- Produces: `tryCreateRoster` / `tryUpdateRoster` / `trySetRosterStatus` / `tryExitRoster` / `readRoster` / `listRoster` / `assertStaffAssignable` / `execSqlForTest`

`PHASE1_ROSTER_KINDS` is `['housekeeper'] as const`. Empty `kinds` → `EMPTY_KINDS`. Unknown kind → `INVALID_KINDS` (application 422, not a raw CHECK abort).

Fingerprint for add: `{ profile, kinds }` sorted kinds — **no `staffId`**. Mint `staff_${crypto.randomUUID()}` after idempotent replay miss, before `preparePiiRecord`.

- [ ] **Step 1: Write failing RPC tests** (`apps/pms-core/test/roster.spec.ts`)

Cover spec tests 1–13 at the OrgDO RPC layer (HTTP 1a/14–19 wait for Task 6). Helper `createHousekeeper(org, propertyId, displayName, extra?)` in `roster-helpers.ts` calling `tryCreateRoster`.

Minimum cases (each `it` named with the spec number):

```ts
it('1: add mints staff_…, outbox roster.created has refs not displayName', async () => { /* … */ });
it('2: duplicate idempotency key replays same pair; one data_key row', async () => { /* … */ });
it('3: empty kinds → empty_kinds', async () => { /* … */ });
it('4: kinds including maintenance → invalid_kinds', async () => { /* … */ });
it('5: update kinds full replace; omit kinds leaves rows', async () => { /* … */ });
it('5a: update displayName succeeds while employed', async () => { /* … */ });
it('6: status inactive is not assignable; active housekeeper is', async () => { /* … */ });
it('7: exit drops identity keys, keeps employment, emits roster.exited refs only', async () => { /* … */ });
it('8: exit thin profile re-seals to {}', async () => { /* … */ });
it('9: second exit is ok without a second outbox row', async () => { /* … */ });
it('10: update and status after exit → staff_exited', async () => { /* … */ });
it('11: trigger aborts active + exited_at via execSqlForTest', async () => { /* … */ });
it('12: trigger aborts cipher rewrite when OLD.exited_at set; exit itself succeeds', async () => { /* … */ });
it('13: tryEraseGuest with live roster row leaves staff key round-trippable', async () => { /* … */ });
```

Test 11/12: `execSqlForTest` (gated by `HOSPAI_UNSAFE_LOCAL`, same as `setTransportBlockedForTest`) runs raw `UPDATE roster SET status='active', exited_at=1` / cipher rewrite after exit. Expect the exec to throw with the trigger message.

Test 13: `createHousekeeper` + `createGuest` + `tryEraseGuest` + `testStaffRoundTrip` / `readRoster` still decrypts.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/roster.spec.ts`

Expected: FAIL — methods missing.

- [ ] **Step 3: Implement RPCs on `OrgDO`**

Copy `tryCreateGuest` structure. Differences that must not be missed:

**`tryCreateRoster(actor, propertyId, input: { profile: StaffProfileCreate; kinds: string[] }, idem)`**
- `gatePermission(..., 'roster:write')` then `gateCoreEntitlement`.
- If `input.profile` has `hourlyRateMinor` / `hourlyRateCurrency` / `rating` / `skills`, also `gatePermission(..., 'roster:compensation')`.
- Reject `kinds.length === 0` → `EMPTY_KINDS`; reject any kind not in `PHASE1_ROSTER_KINDS` → `INVALID_KINDS`.
- Replay first. Then `const staffId = \`staff_${crypto.randomUUID()}\``; `preparePiiRecord('staff', staffId, input.profile)` **outside** `transactionSync`.
- Inside: insert `data_key` (scope `'staff'`), insert `roster` (`status='active'`, `exited_at=NULL`), insert `roster_kind` rows, `appendOrgOutbox` `{ eventType: 'roster.created', payload: { orgId, staffRef: staffId, piiKeyId } }`.
- Return `{ ok: true, staffId, piiKeyId }`.

**`tryUpdateRoster(actor, propertyId, input: { staffId; profile?: Partial<StaffProfileCreate>; kinds?: string[] }, idem)`**
- Load row. Missing → `STAFF_NOT_FOUND`. `exited_at != null` → **`STAFF_EXITED` before any seal** (spec §2.5.6 — this is the 409, not the trigger).
- Optional `kinds`: if present, same empty/invalid checks, full replace (DELETE then INSERT). If omitted, leave child rows.
- If profile present: prepare-outside / re-check-inside; UPDATE cipher/iv/`updated_at` WHERE `staff_id=? AND exited_at IS NULL`.
- Compensation fields in the patch → extra `roster:compensation` gate.
- Outbox `roster.updated` refs only.

**`trySetRosterStatus(actor, propertyId, input: { staffId; status: 'active'|'inactive' }, idem)`**
- Exited → `STAFF_EXITED` in application code before SQL.
- UPDATE `status`, `updated_at`. Outbox `roster.updated`.

**`tryExitRoster(actor, propertyId, input: { staffId }, idem)`**
- Missing → `STAFF_NOT_FOUND`.
- If `exited_at != null`: return `{ ok: true, staffId, piiKeyId }` **before** opening the write (copy `tryEraseGuest`).
- Else: decrypt, omit `displayName`/`email`/`phone` (delete keys, do not set `''`), `prepareProfileSeal` of remainder (may be `{}`), then in one txn: UPDATE cipher/iv, `exited_at=now`, `status='inactive'`. Outbox `roster.exited` refs only.

**`assertStaffAssignable(staffId)`** — actor-less, like `assertGuestRef`:
- Call `this.assertRpcAvailable()` (new on `assertGuestRef` too — Task 5 can do guest if not done here; do **both** in this task so the test hook works).
- No row → `STAFF_NOT_FOUND`. `exited_at != null` → `STAFF_EXITED`. Else if `status != 'active'` OR no `roster_kind` row `kind='housekeeper'` → `STAFF_NOT_ASSIGNABLE`. Else `{ ok: true, staffId }`.

**`readRoster` / `listRoster`**: `roster:read`; decrypt `StaffProfile`; include `kinds`, `status`, `exitedAt`. Do not strip here — HTTP strips.

**`readRosterProfile(staffId)`** test helper (like `readGuestProfile`).

**`execSqlForTest(sql: string, ...binds: unknown[])`**: `assertUnsafeLocal`; `this.ctx.storage.sql.exec(sql, ...binds)`.

**`countDataKeysForSubject(scope, subjectId)`** test helper for test 2.

Do not change `tryEraseGuest` to touch `roster` / staff keys.

- [ ] **Step 4: Tests pass**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/roster.spec.ts test/guests.spec.ts`

Expected: PASS. Existing guest tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/org-do.ts apps/pms-core/test/roster.spec.ts apps/pms-core/test/roster-helpers.ts
git commit -m "$(cat <<'EOF'
feat(org-do): roster RPCs with re-seal exit and assignable assert

Application code returns staff_exited on update/status after exit; second exit short-circuits before SQL like tryEraseGuest.
EOF
)"
```

---

### Task 5: Assign preamble + dual degraded (guest hole included)

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handlePostHousekeepingAssign`, `handlePostReservations` only — still **no** roster routes)
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Modify: `apps/pms-core/test/rooms.spec.ts`
- Modify: `apps/pms-core/test/rooms-routes.spec.ts`
- Modify: `apps/pms-core/test/degraded-mode.spec.ts` (test 23 must seed a real housekeeper)
- Create: `apps/pms-core/test/roster-assign.spec.ts`
- Test: roster-assign + rooms + degraded-mode 23

**Interfaces:**
- Consumes: `assertStaffAssignable`, `assertGuestRef` (now `assertRpcAvailable`)
- Produces: `gateOrgRef` helper; `tryAssignHousekeeping` distinguished errors; HTTP 503 `org_unreachable` for assign **and** `reservations.create`; replay retries `org_unreachable`

Existing assign tests use ghost ids (`staff_alice`, `staff_bob`, `staff_deg`). After `gateStaffRef` they fail `staff_not_found` unless they mint via OrgDO **RPC** (HTTP roster does not exist yet). Use `createHousekeeper` from `roster-helpers.ts`. `provisionedPropertyStub` already creates an org you can `orgStub(targetOrgId)` — `rooms.spec.ts` must take the org id (derive `org_prop_${name}` the same way the helper does, or change the helper to return `{ stub, orgId }`). Prefer a small local wrap rather than a wide fixture refactor: in the assign test, `const orgId = \`org_prop_${name}\`` after using that `name` with `provisionedPropertyStub`.

- [ ] **Step 1: Write failing tests** (`roster-assign.spec.ts`)

```ts
it('21: assign staff_notreal → 422 staff_not_found', async () => { /* POST housekeeping/assignments */ });
it('22: assign exited → 422 staff_exited', async () => { /* exit via OrgDO RPC, then assign */ });
it('23: assign inactive / non-housekeeper → 422 staff_not_assignable', async () => { /* status inactive */ });
it('24 analogue: PropertyDO blocked still 202 queues (existing degraded-mode 23, after seeding housekeeper)', async () => {});
it('25: OrgDO blocked on assign → 503 org_unreachable, not 500, not 202', async () => {
  await org.setTransportBlockedForTest(true);
  const res = await postAssign(...);
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({
    error: 'org_unreachable',
    degraded: 'FAIL_CLOSED',
    commandId: 'housekeeping.assign',
  });
  expect(res.status).not.toBe(202);
});
it('26: replay staff_exited → provisional exception + ack', async () => { /* queue then exit then dispatchPendingBatch */ });
it('27: replay org_unreachable → msg.retry(), no exception row', async () => {});
it('29: book with OrgDO blocked at assertGuestRef → 503 org_unreachable commandId reservations.create, not 500', async () => {
  // permission still passes (assertPermission has no assertRpcAvailable)
  await org.setTransportBlockedForTest(true);
  const res = await postReservation(...);
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({
    error: 'org_unreachable',
    degraded: 'FAIL_CLOSED',
    commandId: 'reservations.create',
  });
});
```

Test 27: after queueing an assign (PropertyDO blocked), unblock PropertyDO, block OrgDO, dispatch replay; assert the mock queue received `retry` and `recordProvisionalException` was not called. Follow the existing `dispatchPendingBatch` / queue mock in `degraded-mode.spec.ts`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-core exec vitest run test/roster-assign.spec.ts`

Expected: FAIL — assign of `staff_notreal` still 200; booking OrgDO-block still 500.

- [ ] **Step 3: Shared gate in `property-do.ts`**

First import of `isOrgDoTransportFailure` / `ORG_DO_TRANSPORT_BLOCKED_MESSAGE` into this file. Replace `gateGuestRef` with:

```ts
private async gateOrgRef<T extends { ok: boolean }>(
  orgId: string,
  invoke: (org: DurableObjectStub<OrgDO>) => Promise<T>,
): Promise<T | { ok: false; error: 'org_unreachable' }> {
  try {
    const org = resolveOrgStub(this.env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
    return await invoke(org);
  } catch (e) {
    if (isOrgDoTransportFailure(e)) return { ok: false, error: 'org_unreachable' };
    throw e;
  }
}

private async gateGuestRef(orgId: string, guestRef: string) {
  return this.gateOrgRef(orgId, (org) => org.assertGuestRef(guestRef));
}

private async gateStaffRef(orgId: string, staffId: string) {
  return this.gateOrgRef(orgId, (org) => org.assertStaffAssignable(staffId));
}
```

Result union, **not** a throw. `invokePropertyDo` only queues on property transport.

In `tryAssignHousekeeping`, after format `isStaffRef` and **before** `transactionSync`:

```ts
const staffGate = await this.gateStaffRef(orgId, input.assigneeRef);
if (!staffGate.ok) return staffGate;
```

Add `'org_unreachable' | typeof STAFF_NOT_FOUND | typeof STAFF_EXITED | typeof STAFF_NOT_ASSIGNABLE` to the method's return union.

`tryCreateReservation` already returns `guestGate` — its union must include `'org_unreachable'`.

If `assertGuestRef` did not get `assertRpcAvailable` in Task 4, add it now. Do **not** add it to `assertPermission`.

- [ ] **Step 4: HTTP mapping (assign + book only)**

In `handlePostHousekeepingAssign`, after `invoked.kind === 'response'` / `!result.ok`:

```ts
if (err === 'org_unreachable') {
  return json(
    { error: 'org_unreachable', degraded: 'FAIL_CLOSED', commandId: 'housekeeping.assign' },
    503,
    { 'Retry-After': '30' },
  );
}
if (err === STAFF_NOT_FOUND || err === STAFF_EXITED || err === STAFF_NOT_ASSIGNABLE) {
  return json({ ok: false, error: err }, 422);
}
```

In `handlePostReservations`, same 503 mapping with `commandId: 'reservations.create'` when `err === 'org_unreachable'`.

- [ ] **Step 5: Replay**

In `apps/pms-core/src/pending-commands-consumer.ts`, after `dispatch.invoke` returns `!result.ok`:

```ts
if (result.error === 'org_unreachable') {
  msg.retry();
  continue;
}
```

**Before** `recordProvisionalException`. Domain errors (`staff_exited` etc.) still exception+ack.

- [ ] **Step 6: Fix existing assign tests**

`rooms.spec.ts`, `rooms-routes.spec.ts` (13a), `degraded-mode.spec.ts` (23): mint a housekeeper via `tryCreateRoster` and use the returned `staffId` as `assigneeRef`. Test 23's 202-while-PropertyDO-blocked behaviour must stay.

- [ ] **Step 7: Tests pass**

```
pnpm --filter @hospai/pms-core exec vitest run test/roster-assign.spec.ts test/rooms.spec.ts test/rooms-routes.spec.ts test/degraded-mode.spec.ts
```

Expected: PASS. `check:do-transport-guards` will **not** catch 25/29 — do not add a script case; the HTTP tests are the proof.

- [ ] **Step 8: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/pending-commands-consumer.ts apps/pms-core/test
git commit -m "$(cat <<'EOF'
feat(housekeeping): gate assign on OrgDO roster with dual degraded

OrgDO outage returns 503 org_unreachable (assign and reservations.create); PropertyDO outage still queues. Replay retries org_unreachable instead of acking it away.
EOF
)"
```

---

### Task 6: Six HTTP roster routes + six audit rows (same commit)

**Files:**
- Create: `apps/pms-core/src/roster-http.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Create: `apps/pms-core/test/roster-routes.spec.ts`
- Modify: `packages/client-core/src/api.ts` (client methods used by later SPA; adding them here keeps the HTTP surface complete)
- Test: roster-routes + `pnpm check:permissions` + `pnpm check:degraded`

**Interfaces:**
- Consumes: OrgDO RPCs from Task 4
- Produces: six `V1_ROUTES` + matching `V1_HTTP_ROUTE_AUDIT` indices 80–85 (verify length at implement time; HEAD at plan writing is 80 rows, indices 0–79, last id `post_org_purge`)

**Do not split this commit.** Housekeeping Task 3 went red by adding dispatcher rows without audit rows.

- [ ] **Step 1: Write failing HTTP tests + audit pin**

`roster-routes.spec.ts` (copy `guests-routes.spec.ts` provision helpers):

```ts
it('1a: POST body with staffId → 400 invalid_body; no row with that id', async () => {});
it('1 HTTP: POST /roster 200 { staffId, piiKeyId }; staffId matches STAFF_REF_RE', async () => {});
it('10 HTTP: PATCH / status after exit → 409 staff_exited', async () => {});
it('14: staff role POST/exit → 403 roster:write', async () => {});
it('15: staff role GET list is operational only — no hourlyRate/rating/skills/email/phone even if blob has them', async () => {});
it('16: owner GET includes contact + hourlyRate as Money', async () => {});
it('18: OrgDO blocked on add → 503 org_unreachable FAIL_CLOSED, not 500', async () => {});
it('19: kill-switch → 503 empty body', async () => {});
```

Test 17 is a **unit** test of the helper (today's roles cannot hold `roster:write` without `roster:compensation`). In `apps/pms-core/src/roster-http.test.ts`:

```ts
it('17: fabricated grants roster:write without roster:compensation → compensation write denied', () => {
  expect(
    compensationWriteDenied(['roster:write'], { hourlyRate: { amountMinor: 1500, currency: 'USD' } }),
  ).toBe(true);
  expect(compensationWriteDenied(['roster:write', 'roster:compensation'], { hourlyRate: { amountMinor: 1500, currency: 'USD' } })).toBe(false);
});
```

The HTTP handler maps `true` to **403** `{ error: 'forbidden', permission: 'roster:compensation' }` — not silent ignore.

In `register.test.ts` pin (adjust if length drifted):

```ts
expect(V1_HTTP_ROUTE_AUDIT[80]?.id).toBe('get_roster');
expect(V1_HTTP_ROUTE_AUDIT[81]?.id).toBe('get_roster_one');
expect(V1_HTTP_ROUTE_AUDIT[82]?.id).toBe('post_roster');
expect(V1_HTTP_ROUTE_AUDIT[83]?.id).toBe('patch_roster');
expect(V1_HTTP_ROUTE_AUDIT[84]?.id).toBe('post_roster_status');
expect(V1_HTTP_ROUTE_AUDIT[85]?.id).toBe('post_roster_exit');
expect(V1_HTTP_ROUTE_AUDIT[80]).toMatchObject({
  scope: 'property',
  permission: 'roster:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[80] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[82]).toMatchObject({
  scope: 'property',
  permission: 'roster:write',
  commandId: 'roster.add',
  entitlement: 'pms.core',
});
```

- [ ] **Step 2: Run to verify fail**

`pnpm check:permissions` — still green until dispatcher changes. `register.test` FAIL on missing ids. Add audit rows **together with** `V1_ROUTES` in step 3.

- [ ] **Step 3: `roster-http.ts` strip + compensation gate**

```ts
import type { Permission } from '@hospai/contracts';
import { currencyCode, money, type Money } from '@hospai/money';
import type { StaffProfile } from '@hospai/crypto-shredding';

export type RosterOperational = {
  staffId: string;
  kinds: string[];
  status: 'active' | 'inactive';
  exitedAt: number | null;
  displayName?: string;
};

export type RosterHttpRow = RosterOperational & {
  email?: string;
  phone?: string;
  hourlyRate?: Money;
  rating?: number;
  skills?: string[];
};

export function compensationWriteDenied(
  grants: readonly Permission[],
  patch: { hourlyRate?: unknown; rating?: unknown; skills?: unknown },
): boolean {
  const touches =
    patch.hourlyRate !== undefined || patch.rating !== undefined || patch.skills !== undefined;
  if (!touches) return false;
  return !grants.includes('roster:compensation');
}

export function stripRosterRow(grants: readonly Permission[], row: {
  staffId: string;
  kinds: string[];
  status: 'active' | 'inactive';
  exitedAt: number | null;
  profile: StaffProfile;
}): RosterHttpRow {
  const out: RosterHttpRow = {
    staffId: row.staffId,
    kinds: row.kinds,
    status: row.status,
    exitedAt: row.exitedAt,
  };
  if (row.profile.displayName !== undefined) out.displayName = row.profile.displayName;
  if (grants.includes('roster:write')) {
    if (row.profile.email !== undefined) out.email = row.profile.email;
    if (row.profile.phone !== undefined) out.phone = row.profile.phone;
  }
  if (grants.includes('roster:compensation')) {
    if (row.profile.hourlyRateMinor !== undefined && row.profile.hourlyRateCurrency) {
      out.hourlyRate = money(row.profile.hourlyRateMinor, currencyCode(row.profile.hourlyRateCurrency));
    }
    if (row.profile.rating !== undefined) out.rating = row.profile.rating;
    if (row.profile.skills !== undefined) out.skills = row.profile.skills;
  }
  return out;
}

export function profileFromHttpBody(body: {
  displayName?: string;
  email?: string;
  phone?: string;
  hourlyRate?: { amountMinor: number; currency: string };
  rating?: number;
  skills?: string[];
}): StaffProfile {
  const profile: StaffProfile = {};
  if (body.displayName !== undefined) profile.displayName = body.displayName;
  if (body.email !== undefined) profile.email = body.email;
  if (body.phone !== undefined) profile.phone = body.phone;
  if (body.hourlyRate) {
    const m = money(body.hourlyRate.amountMinor, currencyCode(body.hourlyRate.currency));
    profile.hourlyRateMinor = m.amountMinor;
    profile.hourlyRateCurrency = m.currency;
  }
  if (body.rating !== undefined) profile.rating = body.rating;
  if (body.skills !== undefined) profile.skills = body.skills;
  return profile;
}
```

Invalid money throws → HTTP 400 `invalid_body`.

- [ ] **Step 4: Handlers + `V1_ROUTES` + audit (one edit)**

Paths (property-scoped, like guests):

| method | pattern | permission | commandId / degradedRead |
|---|---|---|---|
| GET | `/v1/properties/:id/roster` | `roster:read` | `degradedRead: FAIL_CLOSED`, `entitlement: pms.core` |
| GET | `/v1/properties/:id/roster/:staffId` | `roster:read` | same |
| POST | `/v1/properties/:id/roster` | `roster:write` | `roster.add` |
| PATCH | `/v1/properties/:id/roster/:staffId` | `roster:write` | `roster.update` |
| POST | `/v1/properties/:id/roster/:staffId/status` | `roster:write` | `roster.status` |
| POST | `/v1/properties/:id/roster/:staffId/exit` | `roster:write` | `roster.exit` |

**GET list:** query `kind=housekeeper` filters to that kind (picker). `Cache-Control: private, no-store`. OrgDO transport → `degradedFailClosedOrgReadResponse()` (no `commandId` on GETs). Strip with `ROLE_GRANTS[role]` via `stripRosterRow`.

**POST add:** if `'staffId' in body` → 400 `{ error: 'invalid_body' }`. Require `displayName`, `kinds`, `idempotencyKey`. `compensationWriteDenied` → 403. Fingerprint `{ profile, kinds }` (sorted). Map OrgDO transport like `handlePostGuests` (`commandId: 'roster.add'`). Map `STAFF_EXITED` unused here; `EMPTY_KINDS`/`INVALID_KINDS` → 422; `FORBIDDEN` → 403 `roster:write` or `roster:compensation`.

**PATCH / status / exit:** `STAFF_EXITED` → **409**. `STAFF_NOT_FOUND` → 404. Idempotency keys required on mutations.

Append **six** objects to `V1_HTTP_ROUTE_AUDIT` (end of array) with ids `get_roster`, `get_roster_one`, `post_roster`, `patch_roster`, `post_roster_status`, `post_roster_exit` in that order — **same order as `V1_ROUTES` append**. Mutations include `commandId` + `entitlement: 'pms.core'`. GETs include `degradedRead: 'FAIL_CLOSED'` + `entitlement: 'pms.core'` and **no** `commandId`.

- [ ] **Step 5: Client methods**

In `packages/client-core/src/api.ts`, add `listRoster(propertyId, query?: { kind?: string })`, `getRoster(propertyId, staffId)`, `addRoster`, `updateRoster`, `setRosterStatus`, `exitRoster`, `assignHousekeeping` (POST existing assignments URL). `listRoster` is what `HousekeepingApi` will call.

- [ ] **Step 6: Gates + tests**

```
pnpm --filter @hospai/contracts test
pnpm check:permissions
pnpm check:degraded
pnpm --filter @hospai/pms-core exec vitest run test/roster-routes.spec.ts src/roster-http.test.ts
pnpm --filter @hospai/client-core test
```

Expected: `OK permissions: … HTTP routes` count +6. All green.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/v1-dispatch.ts apps/pms-core/src/roster-http.ts \
  apps/pms-core/src/roster-http.test.ts apps/pms-core/test/roster-routes.spec.ts \
  packages/client-core/src/api.ts
git commit -m "$(cat <<'EOF'
feat(http): roster routes with audit-row parity

Six V1_ROUTES and six V1_HTTP_ROUTE_AUDIT entries land together so check:permissions stays green. Add rejects client staffId; list strips contact and pay by grant.
EOF
)"
```

---

### Task 7: Housekeeping board picker

**Files:**
- Modify: `modules/pms/housekeeping/src/ui/HousekeepingApp.tsx`
- Create: `modules/pms/housekeeping/src/ui/HousekeepingApp.test.tsx`
- Modify: `apps/web-pms/src/screens/HousekeepingScreen.tsx`
- Test: housekeeping module vitest + web-pms if the screen test exists

**Interfaces:**
- Consumes: `api.listRoster` / `api.assignHousekeeping` from Task 6
- Produces: `<select>` per room; empty copy; `canAssign` flag; board joins `displayName` or falls back to `staff_…`

- [ ] **Step 1: Write failing UI tests**

```tsx
it('31: empty roster shows “No housekeepers on the roster” and no text input', async () => {
  render(<HousekeepingApp … api={apiWithEmptyRoster} canAssign />);
  expect(await screen.findByText('No housekeepers on the roster')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('20: select minted housekeeper calls assignHousekeeping with staffId; cell shows displayName', async () => { /* … */ });

it('28: historical assigneeRef absent from list renders the staff_… pseudonym', async () => {
  // assignments: staff_exited_one; listRoster: []
  expect(await screen.findByText('staff_exited_one')).toBeInTheDocument();
});
```

Extend `HousekeepingApi`:

```ts
export type HousekeepingRosterPerson = {
  staffId: string;
  displayName?: string;
  status: string;
  exitedAt: number | null;
  kinds: string[];
};

export type HousekeepingApi = {
  listRooms: …;
  listHousekeepingAssignments: …;
  updateRoomStatus: …;
  listRoster: (propertyId: string) => Promise<{ ok: true; staff: HousekeepingRosterPerson[] }>;
  assignHousekeeping: (
    propertyId: string,
    input: { roomId: string; businessDate: string; assigneeRef: string; idempotencyKey: string },
  ) => Promise<unknown>;
};

export type HousekeepingAppProps = {
  propertyId: string;
  defaultBusinessDate: string;
  api: HousekeepingApi;
  canAssign: boolean;
  classifyError?: …;
};
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/pms-housekeeping test`

Expected: FAIL — `listRoster` not on props.

- [ ] **Step 3: Implement picker**

- Query `api.listRoster(propertyId)` (server list already filtered when called with `kind=housekeeper`; client still ignores exited/inactive).
- Assignee cell: `displayName` from the list map, else the raw `assigneeRef` (test 28).
- Fourth cell: if `canAssign`, a `<select aria-label={Assign ${room.code}}>` with options `{ value: staffId, label: displayName ?? staffId }`. Empty list: disabled select or static text **No housekeepers on the roster** — never `<input type="text">`.
- `onChange` → `assignHousekeeping` with `crypto.randomUUID()` idempotency key; invalidate assignments query.
- `HousekeepingScreen` passes `canAssign={hasPropertyPermission(me, 'housekeeping:write')}`. That requires `me` on the screen — copy `StaffRoute`'s `useQuery(['me', propertyId])` + `hasPropertyPermission`. Do **not** import `ROLE_GRANTS`. `api={api}` already satisfies the new methods once client-core is built.

- [ ] **Step 4: Tests pass + commit**

```
pnpm --filter @hospai/pms-housekeeping test
pnpm --filter @hospai/web-pms test -- src/screens/HousekeepingScreen.tsx src/auth/me.test.ts
```

If `HousekeepingScreen` has no test, the module RTL tests are enough; still typecheck web-pms.

```bash
git add modules/pms/housekeeping apps/web-pms/src/screens/HousekeepingScreen.tsx
git commit -m "$(cat <<'EOF'
feat(housekeeping): assign picker from operational roster

Board offers server-minted housekeepers only; exited refs render the staff_… pseudonym because the name is gone from the blob.
EOF
)"
```

---

### Task 8: Roster management SPA

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/App.tsx`
- Create: `apps/web-pms/src/screens/RosterRoute.tsx`
- Create: `apps/web-pms/src/screens/RosterScreen.tsx`
- Create: `apps/web-pms/src/screens/RosterRoute.test.tsx`
- Create: `apps/web-pms/src/screens/RosterScreen.test.tsx`
- Modify: `apps/web-pms/src/auth/me.test.ts`
- Test: web-pms vitest

**Interfaces:**
- Consumes: client roster methods, `roster:write` / `roster:compensation` via `hasPropertyPermission`
- Produces: nav id `roster` order 55; `/roster` route; exit confirm copy

- [ ] **Step 1: Write failing tests**

Nav (`me.test.ts` staff-role fixture — add `'roster:read'` to the staff grants list so it matches production `/me`):

```ts
expect(filtered.map((e) => e.id)).not.toContain('staff');
expect(filtered.map((e) => e.id)).not.toContain('roster');
```

Fabricated me with `roster:write` shows `roster`. Staff grants include `roster:read` but not `roster:write`.

`RosterRoute.test.tsx`: without `roster:write` → redirect (same as StaffRoute). Label **not E2E**.

`RosterScreen.test.tsx`:

```ts
it('32: exit confirm names removal and retained employment record', async () => {
  expect(await screen.findByText(/The name and contact will be removed/)).toBeInTheDocument();
  expect(screen.getByText(/The employment record is kept/)).toBeInTheDocument();
  expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
});

it('33: compensation inputs absent without roster:compensation (fabricated me, not E2E)', async () => {});

it('34: read-without-write roster chrome (fabricated me, not E2E) — RosterRoute redirects', async () => {});

it('empty state: Add someone to the roster', async () => {
  expect(await screen.findByText(/Add someone to the roster/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @hospai/web-pms test -- src/auth/me.test.ts src/screens/RosterRoute.test.tsx`

Expected: FAIL — nav id missing / files missing.

- [ ] **Step 3: Implement**

`nav.ts`:

```ts
  { id: 'staff', label: 'Staff', path: '/staff', order: 50, permission: 'staff:read' },
  { id: 'roster', label: 'Roster', path: '/roster', order: 55, permission: 'roster:write' },
```

`App.tsx`: `<Route path="roster" element={<RosterRoute />} />` next to staff.

`RosterRoute.tsx`: copy `StaffRoute`, gate on `roster:write`, render `RosterScreen`.

`RosterScreen.tsx`:
- List via `api.listRoster`.
- Add form: `displayName` required; optional email/phone; compensation fields **only if** `hasPropertyPermission(me, 'roster:compensation')`.
- Inline status toggle → `setRosterStatus`.
- Exit button → `window.confirm('The name and contact will be removed. The employment record is kept. This cannot be undone.')` then `exitRoster`.
- Empty: *Add someone to the roster* + add affordance. Do not use membership “invite by email” copy.
- Do not show Clerk `user_…`. Do not link roster rows to members.

- [ ] **Step 4: Tests pass + `check:web-pms-me-gating`**

```
pnpm --filter @hospai/web-pms test
pnpm check:web-pms-me-gating
```

Expected: green. Client still must not import `ROLE_GRANTS`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms
git commit -m "$(cat <<'EOF'
feat(web-pms): roster SPA behind roster:write

Adjacent to membership Staff, different permission and ids. Housekeepers keep the picker; they do not get the HR nav entry.
EOF
)"
```

---

### Task 9: Full CI (`ci.yml` order)

**Files:** none expected. Fix anything this sequence turns red.

- [ ] **Step 1: Run the `checks` job commands in order**

```
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

- [ ] **Step 2: pms-core shards (same as `test-pms-core`)**

```
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Do not put `--` before `--shard`.

- [ ] **Step 3: Fix any red, then commit only if there are fixes**

If the tree is already green, do not create an empty commit.

---

## Spec coverage (self-review)

| Spec | Task |
|---|---|
| Catalog rename, notes, events, FAIL_CLOSED, exemptions, no `housekeeping.staff_*` | 1 |
| `StaffProfileCreate` / generic vault | 2 |
| Schema, triggers, `OLD.exited_at`, `check:ddl` | 3 |
| RPCs, mint, exit re-seal, second-exit, update/status `staff_exited`, test 13 | 4 |
| `gateStaffRef`, distinguished assign errors, dual degraded, guest hole, replay retry | 5 |
| Six routes + six audit rows, strip, 1a, 14–19, Money on the wire | 6 |
| Picker, no free-text, historical pseudonym | 7 |
| SPA, nav 55 `roster:write`, exit copy, fabricated-me chrome | 8 |
| Full `ci.yml` | 9 |
| Leftovers (per-property, maintenance kind, two-blob, HR read role, Clerk) | out of plan |

No either/or. Catalog rename is commit 1. Routes+audit are one commit. Final task is the full CI sequence.
