# Charge-Code Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `folio_line.charge_code` FK-able against an identity-only `charge_code` registry with seed, distinct-backfill, write validation, and narrow CRUD — before tax or window routing.

**Architecture:** Migration v14 creates `charge_code`, seeds `ROOM`/`MISC`/`PAYMENT`, backfills distinct codes from existing lines, rebuilds `folio_line` with FK (indexes after rename). Application `assertChargeCodeSync` gates new charges on active codes and derived splits on existence only. CRUD is create / update name / set status (archive+restore); system codes `ROOM`+`PAYMENT` are protected.

**Tech Stack:** Cloudflare Durable Objects, TypeScript, vitest / `@cloudflare/vitest-pool-workers`, Node 22 `node:sqlite` (`DatabaseSync`) for the real-SQLite backfill probe, existing `gatePermission` / `runIdempotent` / `V1_HTTP_ROUTE_AUDIT` patterns.

**Spec:** [`docs/superpowers/specs/2026-08-07-charge-code-registry-design.md`](../specs/2026-08-07-charge-code-registry-design.md)

## Global Constraints

- **Identity only** — no `taxable` / `tax_group` / `default_window_kind` this slice.
- **Migration order is load-bearing:** create → seed (named display) → distinct-backfill → `folio_line_v14` → INSERT → DROP → RENAME → **then** three indexes.
- **`SYSTEM_CHARGE_CODES`** = codes the DO writes without an operator naming them → `ROOM`, `PAYMENT` (`MISC` is client-only, archivable).
- **New charges** require active code; **split derived writes** require existence only (unreachable throw under healthy FK — keep the call, do not test the throw).
- **Restore in scope** via `folio.set_charge_code_status`; fingerprint `{ code, status }`.
- **Wire:** `CHARGE_CODE_NOT_FOUND` → 404; `CHARGE_CODE_EXISTS` / `SYSTEM_CHARGE_CODE_PROTECTED` → **422** (rate-plan siblings).
- **Routes 50–53** on **both** `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`, same order.
- **GET** permission is `folio:read` only; mutations `settings:configure`.
- **Real-SQLite test 2:** `PRAGMA foreign_keys = ON` after open (mirror PropertyDO constructor); keep ON for migration + asserts.
- **Touch `scripts/property-ddl.mjs`** — exports are hardcoded by name.
- **TDD:** contracts/DDL/assert/CRUD/HTTP tests written RED before implementation where noted.

### Reviewer mutation targets

| Mutation | Must be caught by |
|---|---|
| Drop `status` from set-status fingerprint | Test 19a (same key → cached success instead of `idempotency_key_reused`) |
| Skip distinct-backfill | Real-SQLite test 2 (junk `ZZZ` / FK abort) |
| FK probe without `PRAGMA foreign_keys = ON` | Test 2 false-negative — harness must set pragma |
| Create indexes before DROP/RENAME | Migration abort / DDL sync |
| Require `active` on split path | Test 7 (archive then split fails) |
| Map protected/exists to 409 | Test 9/11 vs rate-plan 422 |
| Append audit without matching `V1_ROUTES` | `check:permissions` |
| Omit `charge_code.changed` from consumer | Test 16 / events-queue allowlist |
| Omit `CHARGE_CODE_V14_SQL` from `property-ddl.mjs` | `check:ddl` miss |

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/contracts/src/idempotency.ts` | Three wire constants |
| `packages/contracts/src/commands/catalog.ts` | Three CRUD commands |
| `packages/contracts/src/v1-http-routes.ts` | Audit 50–53 |
| `packages/do-runtime/src/property-migrations.ts` | v14 statements + `SYSTEM_CHARGE_CODES` + SQL export |
| `packages/do-runtime/src/index.ts` | Re-exports |
| `migrations/do-property/0014_charge_code.sql` | Generated DDL |
| `scripts/property-ddl.mjs` | Declare/destructure/target for v14 |
| `packages/do-runtime/src/migrate.test.ts` | Version 14 sequence + SQL sync |
| `packages/do-runtime/src/charge-code-migration.sqlite.test.ts` | Real-SQLite backfill + FK (new) |
| `apps/pms-core/src/property-do.ts` | Assert/ensure, gate writers, CRUD, list |
| `apps/pms-core/src/v1-dispatch.ts` | Four handlers; 404/422 map; `V1_ROUTES` 50–53 |
| `apps/pms-core/src/event-consumer.ts` | `charge_code.changed` case |
| `apps/pms-core/test/charge-codes.spec.ts` | Matrix (new) |

---

### Task 1: Contracts — constants, catalog, route audit

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `packages/contracts/src/commands/catalog.ts` (insert after `folio.split_charge_payment` block)
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/register.test.ts`

**Interfaces:**
- Produces: `CHARGE_CODE_NOT_FOUND`, `CHARGE_CODE_EXISTS`, `SYSTEM_CHARGE_CODE_PROTECTED`
- Produces: catalog ids `folio.create_charge_code` / `folio.update_charge_code` / `folio.set_charge_code_status`
- Produces: audit rows 50–53

- [ ] **Step 1: Failing register / constant tests (RED)**

```ts
// idempotency.test.ts
expect(CHARGE_CODE_NOT_FOUND).toBe('charge_code_not_found');
expect(CHARGE_CODE_EXISTS).toBe('charge_code_exists');
expect(SYSTEM_CHARGE_CODE_PROTECTED).toBe('system_charge_code_protected');

// register.test.ts
for (const id of [
  'folio.create_charge_code',
  'folio.update_charge_code',
  'folio.set_charge_code_status',
] as const) {
  const c = COMMAND_CATALOG.find((x) => x.id === id);
  expect(c?.entitlement).toBe('pms.core');
  expect(c?.permission).toBe('settings:configure');
  expect(c?.degraded).toBe('FAIL_CLOSED');
  expect(c?.events).toEqual(['charge_code.changed']);
}
expect(V1_HTTP_ROUTE_AUDIT[50]?.id).toBe('post_charge_codes');
expect(V1_HTTP_ROUTE_AUDIT[51]?.id).toBe('patch_charge_code');
expect(V1_HTTP_ROUTE_AUDIT[52]?.id).toBe('put_charge_code_status');
expect(V1_HTTP_ROUTE_AUDIT[53]?.id).toBe('get_charge_codes');
expect(V1_HTTP_ROUTE_AUDIT[53]?.permission).toBe('folio:read');
expect(V1_HTTP_ROUTE_AUDIT[53]?.degradedRead).toBe('FAIL_CLOSED');
expect(V1_HTTP_ROUTE_AUDIT[53]?.commandId).toBeUndefined();
```

Run: `pnpm --filter @hospai/contracts test`  
Expected: FAIL — constants / catalog / rows missing.

- [ ] **Step 2: Add constants**

```ts
// packages/contracts/src/idempotency.ts — after DEFAULT_RATE_PLAN_PROTECTED
export const CHARGE_CODE_NOT_FOUND = 'charge_code_not_found' as const;
export const CHARGE_CODE_EXISTS = 'charge_code_exists' as const;
export const SYSTEM_CHARGE_CODE_PROTECTED = 'system_charge_code_protected' as const;
```

- [ ] **Step 3: Add catalog entries**

```ts
{
  id: 'folio.create_charge_code',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['charge_code.changed'],
  entitlement: 'pms.core',
  permission: 'settings:configure',
},
{
  id: 'folio.update_charge_code',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['charge_code.changed'],
  entitlement: 'pms.core',
  permission: 'settings:configure',
},
{
  id: 'folio.set_charge_code_status',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['charge_code.changed'],
  entitlement: 'pms.core',
  permission: 'settings:configure',
  notes: 'Archive or restore (status flip). Never hard-deletes. ROOM/PAYMENT protected from archive.',
},
```

- [ ] **Step 4: Append audit rows 50–53**

```ts
{
  id: 'post_charge_codes',
  scope: 'property',
  permission: 'settings:configure',
  commandId: 'folio.create_charge_code',
},
{
  id: 'patch_charge_code',
  scope: 'property',
  permission: 'settings:configure',
  commandId: 'folio.update_charge_code',
},
{
  id: 'put_charge_code_status',
  scope: 'property',
  permission: 'settings:configure',
  commandId: 'folio.set_charge_code_status',
},
{
  id: 'get_charge_codes',
  scope: 'property',
  permission: 'folio:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

- [ ] **Step 5: Run contracts tests (GREEN)**

Run: `pnpm --filter @hospai/contracts test`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/idempotency.ts packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/commands/catalog.ts packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): charge-code registry constants, catalog, route audit

EOF
)"
```

---

### Task 2: Migration v14 + DDL sync + real-SQLite backfill test

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts`
- Modify: `packages/do-runtime/src/index.ts`
- Modify: `packages/do-runtime/src/migrate.test.ts`
- Modify: `scripts/property-ddl.mjs`
- Create: `migrations/do-property/0014_charge_code.sql` (via `pnpm generate:ddl`)
- Create: `packages/do-runtime/src/charge-code-migration.sqlite.test.ts`

**Interfaces:**
- Produces: `SYSTEM_CHARGE_CODES`, `CHARGE_CODE_V14_STATEMENTS`, `CHARGE_CODE_V14_SQL`, `PROPERTY_MIGRATIONS` version 14
- Produces: real-SQLite proof of distinct-backfill + FK

- [ ] **Step 1: Write real-SQLite failing test first (RED — statements missing)**

```ts
// packages/do-runtime/src/charge-code-migration.sqlite.test.ts
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  CHARGE_CODE_V14_STATEMENTS,
  FREEZE_GATE_STATEMENTS,
  PAYMENT_V13_STATEMENTS,
  // …apply a minimal prefix: freeze folio tables + payment v13 alter, OR run PROPERTY_MIGRATIONS 1–13 then v14
  PROPERTY_MIGRATIONS,
} from './property-migrations.js';

function execAll(db: DatabaseSync, statements: string[]) {
  for (const s of statements) db.exec(s);
}

describe('charge_code v14 real sqlite', () => {
  it('distinct-backfills junk codes and enforces FK', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON'); // required — SQLite defaults OFF

    // Apply migrations 1..13 via PROPERTY_MIGRATIONS filter, then plant junk, then v14
    for (const m of PROPERTY_MIGRATIONS) {
      if (m.version > 13) break;
      execAll(db, [...m.statements]);
    }

    db.exec(`INSERT INTO folio_window (folio_window_id, reservation_id, kind, status)
             VALUES ('fw1', 'res1', 'GUEST', 'OPEN')`);
    db.exec(`INSERT INTO folio_line (
      folio_line_id, folio_window_id, reservation_id, charge_code,
      amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
    ) VALUES ('fl1', 'fw1', 'res1', 'ZZZ', 100, 'USD', 100, '1', 0, 0)`);

    const v14 = PROPERTY_MIGRATIONS.find((m) => m.version === 14);
    expect(v14).toBeDefined();
    execAll(db, [...v14!.statements]);

    const zzz = db.prepare(`SELECT code, name, status FROM charge_code WHERE code = 'ZZZ'`).get() as {
      code: string;
      name: string;
      status: string;
    };
    expect(zzz).toEqual({ code: 'ZZZ', name: 'ZZZ', status: 'active' });

    const room = db.prepare(`SELECT name FROM charge_code WHERE code = 'ROOM'`).get() as { name: string };
    expect(room.name).toBe('Room'); // seed-before-backfill

    expect(() => {
      db.exec(`INSERT INTO folio_line (
        folio_line_id, folio_window_id, reservation_id, charge_code,
        amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at, created_at
      ) VALUES ('fl2', 'fw1', 'res1', 'NOPE', 1, 'USD', 1, '1', 0, 0)`);
    }).toThrow(); // FK
  });
});
```

Run: `pnpm --filter @hospai/do-runtime test`  
Expected: FAIL — version 14 missing.

- [ ] **Step 2: Implement v14 statements**

Add to `property-migrations.ts`:

```ts
export const SYSTEM_CHARGE_CODES = ['ROOM', 'PAYMENT'] as const;
export type SystemChargeCode = (typeof SYSTEM_CHARGE_CODES)[number];

export const CHARGE_CODE_V14_STATEMENTS: string[] = [
  `CREATE TABLE charge_code (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'archived')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at) VALUES
  ('ROOM', 'Room', 'active', 0, 0),
  ('MISC', 'Misc', 'active', 0, 0),
  ('PAYMENT', 'Payment', 'active', 0, 0)`,
  `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at)
  SELECT DISTINCT charge_code, charge_code, 'active', 0, 0 FROM folio_line`,
  `CREATE TABLE folio_line_v14 (
  folio_line_id         TEXT PRIMARY KEY,
  folio_window_id       TEXT NOT NULL,
  reservation_id        TEXT NOT NULL,
  charge_code           TEXT NOT NULL,
  amount_minor          INTEGER NOT NULL,
  txn_currency          TEXT NOT NULL,
  ledger_amount_minor   INTEGER NOT NULL,
  fx_rate               TEXT NOT NULL,
  fx_rate_at            INTEGER NOT NULL,
  source                TEXT,
  business_date         TEXT,
  split_of              TEXT,
  created_at            INTEGER NOT NULL,
  payment_id            TEXT,
  CHECK (source <> 'NIGHT_AUDIT' OR business_date IS NOT NULL),
  FOREIGN KEY (folio_window_id) REFERENCES folio_window(folio_window_id),
  FOREIGN KEY (payment_id) REFERENCES payment(payment_id),
  FOREIGN KEY (charge_code) REFERENCES charge_code(code)
)`,
  `INSERT INTO folio_line_v14 (
     folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id)
   SELECT folio_line_id, folio_window_id, reservation_id, charge_code,
     amount_minor, txn_currency, ledger_amount_minor, fx_rate, fx_rate_at,
     source, business_date, split_of, created_at, payment_id FROM folio_line`,
  `DROP TABLE folio_line`,
  `ALTER TABLE folio_line_v14 RENAME TO folio_line`,
  `CREATE UNIQUE INDEX folio_line_audit_uniq
  ON folio_line (reservation_id, business_date, charge_code)
  WHERE source = 'NIGHT_AUDIT'`,
  `CREATE INDEX folio_line_window_idx ON folio_line (folio_window_id)`,
  `CREATE UNIQUE INDEX folio_line_payment_uidx
  ON folio_line(payment_id) WHERE payment_id IS NOT NULL`,
];

export const CHARGE_CODE_V14_SQL = CHARGE_CODE_V14_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```ts
{
  version: 14,
  name: 'charge_code',
  statements: CHARGE_CODE_V14_STATEMENTS,
},
```

Export from `index.ts`: `SYSTEM_CHARGE_CODES`, `CHARGE_CODE_V14_SQL`, `CHARGE_CODE_V14_STATEMENTS`.

- [ ] **Step 3: Wire `scripts/property-ddl.mjs`**

Add `let CHARGE_CODE_V14_SQL;` next to `PAYMENT_V13_SQL`, destructure it from the import, and append a `doPropertyTargets` entry for `0014_charge_code.sql` with header noting ORDER: seed → backfill → rebuild → indexes after rename.

- [ ] **Step 4: Update `migrate.test.ts`**

- Bump “through version 13” → 14; expect versions `[1..14]`.
- Add SQL-match test for `0014_charge_code.sql` ↔ `CHARGE_CODE_V14_SQL`.

- [ ] **Step 5: Generate DDL and run tests (GREEN)**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl   # or: node scripts/property-ddl.mjs --write
pnpm --filter @hospai/do-runtime test
pnpm check:ddl      # if exposed at root
```

Expected: PASS — including real-SQLite test 2.

- [ ] **Step 6: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  packages/do-runtime/src/charge-code-migration.sqlite.test.ts \
  scripts/property-ddl.mjs migrations/do-property/0014_charge_code.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): charge_code table and folio_line FK rebuild (v14)

EOF
)"
```

---

### Task 3: `assertChargeCodeSync` + gate folio writers

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/test/folio-routes.spec.ts` (unregistered reject) and/or create `apps/pms-core/test/charge-codes.spec.ts`
- Touch payments / night-audit specs only if seeds or system writers regress

**Interfaces:**
- Produces: `assertChargeCodeSync(code, { requireActive })`, `ensureSystemChargeCodesSync()`
- Consumes: `SYSTEM_CHARGE_CODES` from `@hospai/do-runtime`
- Changes: `tryAddFolioLine` → `requireActive: true` before insert; night audit + capture same; `splitFolioLineSync` → `requireActive: false` before each insert (or once on `source.charge_code`)

- [ ] **Step 1: Failing test — unregistered add_item (RED)**

In `folio-routes.spec.ts` or new `charge-codes.spec.ts` stub:

```ts
const res = await postFolioLine(propertyId, reservationId, owner, {
  chargeCode: 'NO_SUCH_CODE',
  amountMinor: 100,
  idempotencyKey: `idem-${crypto.randomUUID()}`,
});
expect(res.status).toBe(404);
expect(await res.json()).toMatchObject({ error: 'charge_code_not_found' });
```

Run relevant pms-core test — Expected: FAIL (still 200).

- [ ] **Step 2: Implement helpers + gates**

```ts
import { SYSTEM_CHARGE_CODES } from '@hospai/do-runtime';
import { CHARGE_CODE_NOT_FOUND, /* … */ } from '@hospai/contracts';

class ChargeCodeNotFoundError extends Error {
  constructor() {
    super(CHARGE_CODE_NOT_FOUND);
  }
}

private ensureSystemChargeCodesSync(): void {
  const now = Date.now();
  for (const code of SYSTEM_CHARGE_CODES) {
    const name = code === 'ROOM' ? 'Room' : 'Payment';
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO charge_code (code, name, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`,
      code,
      name,
      now,
      now,
    );
  }
}

private assertChargeCodeSync(code: string, opts: { requireActive: boolean }): void {
  if ((SYSTEM_CHARGE_CODES as readonly string[]).includes(code)) {
    this.ensureSystemChargeCodesSync();
  }
  const rows = this.ctx.storage.sql
    .exec(`SELECT status FROM charge_code WHERE code = ?`, code)
    .toArray() as Array<{ status: string }>;
  const row = rows[0];
  if (!row) throw new ChargeCodeNotFoundError();
  if (opts.requireActive && row.status !== 'active') throw new ChargeCodeNotFoundError();
}
```

Inside `tryAddFolioLine`'s `runIdempotent` execute, after reservation exists / before insert:

```ts
this.assertChargeCodeSync(input.chargeCode, { requireActive: true });
```

Catch `ChargeCodeNotFoundError` → `{ ok: false, error: CHARGE_CODE_NOT_FOUND }`.

In `postRoomChargesSync` / capture insert paths: assert with `requireActive: true` (ensure folds in for system codes).

In `splitFolioLineSync` at start:

```ts
this.assertChargeCodeSync(source.charge_code, { requireActive: false });
```

- [ ] **Step 3: Map HTTP 404 for `CHARGE_CODE_NOT_FOUND`** in the folio error mapper (same place as `RATE_PLAN_NOT_FOUND`).

- [ ] **Step 4: Run folio + night-audit + payments tests (GREEN)**

Existing `MISC`/`ROOM`/`PAYMENT` posts must still pass via seeds.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/folio-routes.spec.ts apps/pms-core/test/charge-codes.spec.ts
git commit -m "$(cat <<'EOF'
feat(property-do): validate folio charge codes against registry

EOF
)"
```

---

### Task 4: CRUD DO methods + list

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Create/extend: `apps/pms-core/test/charge-codes.spec.ts` (DO-level cases 5–12, 19a/19b)

**Interfaces:**
- Produces:
  - `tryCreateChargeCode(actor, { code, name }, idem)`
  - `tryUpdateChargeCode(actor, { code, name }, idem)`
  - `trySetChargeCodeStatus(actor, { code, status: 'active' | 'archived' }, idem)` — fingerprint `{ code, status }`
  - `listChargeCodes(status?: 'active' | 'archived' | 'all')`

- [ ] **Step 1: Write DO tests RED** for create, archive blocks add_item, restore, system protect, 19a/19b (can be HTTP in Task 5 — prefer at least set-status fingerprint at DO layer):

```ts
const archiveIdem = { key: 'k1', fingerprint: await fingerprintPayload({ code: 'PARKING', status: 'archived' }) };
await stub.trySetChargeCodeStatus(owner, { code: 'PARKING', status: 'archived' }, archiveIdem);
const restoreSame = await stub.trySetChargeCodeStatus(
  owner,
  { code: 'PARKING', status: 'active' },
  { key: 'k1', fingerprint: await fingerprintPayload({ code: 'PARKING', status: 'active' }) },
);
expect(restoreSame).toEqual({ ok: false, error: IDEM_KEY_REUSED }); // 19a

const restoreOk = await stub.trySetChargeCodeStatus(
  owner,
  { code: 'PARKING', status: 'active' },
  { key: 'k2', fingerprint: await fingerprintPayload({ code: 'PARKING', status: 'active' }) },
);
expect(restoreOk).toMatchObject({ ok: true }); // 19b
```

- [ ] **Step 2: Implement CRUD**

Mirror `tryCreateRatePlan` / archive pattern:

- Gate: `gatePermission(actor, 'settings:configure')` + `gateCoreEntitlement`
- Create: reject if row exists (`CHARGE_CODE_EXISTS` for active **or** archived)
- Update name: missing → `CHARGE_CODE_NOT_FOUND` (archived may still update name — or reject; prefer allow name update on archived so operators can relabel before restore)
- Set status: if `status === 'archived'` && `SYSTEM_CHARGE_CODES.includes(code)` → `SYSTEM_CHARGE_CODE_PROTECTED`; missing → not found; else `UPDATE … SET status=?, updated_at=?`
- Outbox: `charge_code.changed` with `{ propertyId, code, op, at }` (`op`: `create` | `update` | `status`)

- [ ] **Step 3: GREEN DO tests + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(property-do): charge code create/update/status CRUD

EOF
)"
```

---

### Task 5: HTTP routes, error map, event consumer, full matrix

**Files:**
- Modify: `apps/pms-core/src/v1-dispatch.ts` — handlers + `V1_ROUTES` 50–53
- Modify: `apps/pms-core/src/event-consumer.ts` — add `charge_code.changed` to the allowlist group
- Create: `apps/pms-core/test/charge-codes.spec.ts` — HTTP matrix 1, 3–18, 19a/19b if not covered in Task 4
- Modify: `apps/pms-core/test/events-queue.spec.ts` if catalog allowlist is asserted there

**Interfaces:**
- Produces: handlers wired at indices 50–53 matching audit ids

- [ ] **Step 1: Error map**

```ts
if (
  error === CHARGE_CODE_EXISTS ||
  error === SYSTEM_CHARGE_CODE_PROTECTED
) {
  return 422;
}
if (error === CHARGE_CODE_NOT_FOUND) return 404;
```

(Add to the same 422 block as rate-plan constants.)

- [ ] **Step 2: Handlers**

| Route | Handler sketch |
|---|---|
| POST `/charge-codes` | body `{ code, name, idempotencyKey }` → fingerprint `{ code, name }` → `tryCreateChargeCode` |
| PATCH `/charge-codes/:code` | body `{ name, idempotencyKey }` → fingerprint `{ code, name }` |
| PUT `/charge-codes/:code/status` | body `{ status, idempotencyKey }` → fingerprint `{ code, status }` |
| GET `/charge-codes?status=` | `listChargeCodes`; default `active` |

- [ ] **Step 3: Append `V1_ROUTES` 50–53** in the **same order** as audit (after `get_folio_payments`).

- [ ] **Step 4: Event consumer**

```ts
case 'charge_code.changed':
```

in the Phase-0 presence group next to `rate_plan.changed`.

- [ ] **Step 5: Full HTTP matrix (GREEN)**

Cover spec tests 1, 3–18, 19a, 19b. For test 15:

```ts
await org.ensureMember(staffUserId, 'staff');
// GET charge-codes with x-dev-actor: staff → 200
// POST charge-codes with staff → 403
```

For test 7: create PARKING, post line, archive, split via existing split route — expect 200 / balance feet.

For test 18: kill-switch / cancel subscription → 503 / 402 on mutates (copy rate-plans pattern).

- [ ] **Step 6: Run checks**

```bash
pnpm --filter @hospai/contracts test
pnpm --filter @hospai/do-runtime test
pnpm --filter pms-core test  # or project-equivalent
# root: check:permissions check:entitlements check:degraded check:ddl
```

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pms-core): charge-code HTTP routes and registry matrix

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| `charge_code` identity schema | 2 |
| Seed → backfill → rebuild → indexes after rename | 2 |
| Real-SQLite test 2 + `PRAGMA foreign_keys = ON` | 2 |
| `property-ddl.mjs` + `0014` + migrate sync | 2 |
| Active vs exists validation split | 3 |
| Ensure folded into assert | 3 |
| Create / update / set-status (+ restore) | 4 |
| Fingerprint `{ code, status }` (19a/19b) | 4–5 |
| Routes 50–53 dual list | 1 + 5 |
| GET `folio:read` | 1 + 5 |
| 404 / 422 wire map | 3 + 5 |
| `charge_code.changed` catalog + consumer | 1 + 5 |
| Breaking add_item + degrade named (doc only) | spec; behavior in 3 |
| System code protection | 4 |
| Leftovers (tax/occupancy/routing) | out of plan |

## Open questions

None — settled in the approved spec.
