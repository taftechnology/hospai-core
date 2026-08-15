# Derived rate plans — property-local percent-of-parent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-08-15)

**Goal:** Ship property-local one-level derived rate plans (`parent_rate_plan_id` + `derive_bps`) with synchronous `rate_day` rematerialization on parent writes and derived plan create/update, extended POST/PATCH/GET plan APIs, read-only derived matrix in `RatesScreen` — **no** new catalog command, HTTP route, OrgDO table, or night-audit step.

**Architecture:** v30 adds nullable derivation columns on `rate_plan`. Independent plans stay editable; derived plans materialize child `rate_day` rows via `roundHalfAwayFromZero(P × (10_000 + b), 10_000)` whenever a parent cell is written or when a derived plan is created/updated. Manual writes to derived plans reject with `derived_rate_plan_write_forbidden` (422); archive parent with active children rejects with existing `archive_blocked` (409). Quotes and reservation snapshots already read `rate_day` by `rate_plan_id`.

**Tech Stack:** PropertyDO sqlite + `@hospai/money`, `@hospai/contracts` wire codes + dispatch status map, vitest Worker HTTP specs (`rate-plans-routes.spec.ts` / `derived-rate-plans.spec.ts`), web-pms RTL (`RatesScreen.test.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-15-derived-rate-plans-design.md` (Approved at `41e7674` — every Lock normative).

---

## Sequencing gate (read before starting)

This slice closes rate-plans leftover **Derived / linked plans** (~35 / §8 ~419) and property-setup leftover **2** (~539) — property-local half only. Bidirectional pointer sentences land in **Task 4 only**. Leftover **14** `rematerializesRates` stays open.

| After this plan | Do not start |
|---|---|
| `COMMAND_CATALOG` length stays **81** | New catalog id |
| `AUDIT_WRITER_COMMAND_IDS.size` stays **56** | New audit writer |
| HTTP `[133] post_folio_reconcile_payment` last; `[132]`/`[131]`/`[127]` unmoved | New V1 HTTP route |
| `PROPERTY_SCHEMA_HEAD` **29 → 30** | OrgDO `rate_plan` migration |
| `ORG_SCHEMA_HEAD` **7** unchanged | Cross-property parent lookup |
| `NIGHT_AUDIT_STEPS` length **8**; `[3] === 'AUTO_TRANSFER'` | 9th night-audit step |
| `PLATFORM_GAPS === []` | `CLASS_DENYLIST` edit |
| Property-local derived plans + sync rematerialize | OrgDO chain-wide projection Workflow |
| Tests Lock 6 cases **1–8** (HTTP/DO) | Ticking Tasks 1–3 living boxes; push |
| — | Leftover **14** currency rematerialize consumer |
| — | Promo; virtual-type sharing; plan-scoped restrictions |

---

## Open decisions (locked — do not re-litigate)

### D1 — Frozen heads (spec §1.1)

**Locked:** `COMMAND_CATALOG` length **81** (extend `rates.create_plan` / `rates.update_plan` input shapes only). `AUDIT_WRITER_COMMAND_IDS.size` **56**. HTTP `[133] post_folio_reconcile_payment` last; `[132] delete_room` / `[131] post_folio_routing_rule_archive` / `[127] post_demo_seed` **unmoved**. `PROPERTY_SCHEMA_HEAD` **29 → 30**. `ORG_SCHEMA_HEAD` **7**. `NIGHT_AUDIT_STEPS` length **8** with `[3] === 'AUTO_TRANSFER'`. `PLATFORM_GAPS` stays `[]`.

### D2 — v30 columns; one-level graph (spec Lock 2)

**Locked:** Append migration v30 `derived_rate_plans`:

```sql
ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT;
ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000));
CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = 'active';
```

**No FK** on `parent_rate_plan_id`. Pairing invariant: `(parent_rate_plan_id IS NULL) ↔ (derive_bps IS NULL)` — mismatch → **`derived_rate_plan_invalid`**. Parent must be active independent (`parent_rate_plan_id IS NULL`). No derived-of-derived. Self-parent rejected. Archive parent blocked when active child exists → **`archive_blocked`** HTTP **409** (mirror room archive dispatch ~1020–1022). New wire codes: **`derived_rate_plan_invalid`**, **`derived_rate_plan_write_forbidden`** → HTTP **422**.

### D3 — Sync rematerialization (spec Lock 3)

**Locked:** Formula:

```ts
childMinor = Number(
  roundHalfAwayFromZero(BigInt(P) * BigInt(10_000 + b), 10_000n),
);
```

Import `roundHalfAwayFromZero` from `@hospai/money`. Helpers (private sync, `property-do.ts` adjacent to plan RPCs ~10511+):

- `isDerivedRatePlanSync(ratePlanId)`
- `computeDerivedAmountMinorSync(parentMinor, deriveBps)`
- `rematerializeDerivedChildrenSync(parentRatePlanId, roomTypeId, stayDate)` — skip when parent cell missing
- `backfillDerivedPlanSync(childRatePlanId)` — all parent `rate_day` rows × active room types

**Hooks:** end of `tryUpsertRateDay` txn (~12426+); per cell in `tryBulkUpdateRates` (~12546+); after successful `tryCreateRatePlan` / `tryUpdateRatePlan` when derived or parent/bps changed. Start of `tryUpsertRateDay` / bulk loop: derived target → **`derived_rate_plan_write_forbidden`**. Child upserts emit existing **`rate.changed`** + audit per cell (same shape as parent upsert).

### D4 — Extend existing API only (spec Lock 4)

**Locked:** Optional body fields `parentRatePlanId?: string | null`, `deriveBps?: number | null` on POST/PATCH + fingerprint allowlists. PATCH invalid_body guard extends to include them (~3701–3710 pattern). `listRatePlans` + GET JSON adds `parentRatePlanId`, `deriveBps`. `client-core` `createRatePlan` / `updateRatePlan` input types (~1639–1671). **`handleDeleteRatePlan`** must map `ARCHIVE_BLOCKED` → **409** explicitly (today falls through `mapReservationCommandErrorStatus` → 422; room archive uses explicit branch ~1020–1022).

### D5 — SPA (spec Lock 5)

**Locked:** Extend **`RatesScreen`** only (~211–228 plans form; matrix ~389+). Create form: parent select (active plans with `parentRatePlanId == null`), derive % → integer bps (`−15%` → `-1500`). Matrix when selected plan derived: cells read-only; bulk fill disabled; helper copy **exactly:** `Edit the parent plan’s rates.` Optional badge in plans table. **No** Folio/Settings changes. Separate UI labels for cancel penalty bps vs derive bps.

### D6 — Tests / CI discipline (spec Lock 6)

**Locked:** Cases **1–8** in `apps/pms-core/test/derived-rate-plans.spec.ts` (or extend `rate-plans-routes.spec.ts`). **No `vi.spyOn` into DO isolate.** Rebuild **`@hospai/contracts`** before pms-core tests (Task 2). Rebuild **`@hospai/client-core`** before web-pms tests (Task 3). File-filter vitest; `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` (**no `--` before `--shard`**). Workerd 503: retry that shard **once**. Never `|| true`. Never unsharded `pnpm --filter @hospai/pms-core test`. Register pin: `pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"`.

### D7 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. Bidirectional pointers — **Task 4 only**. Do **not** close leftover **14**. No push.

---

## Global Constraints

- **`PROPERTY_SCHEMA_HEAD` moves 29 → 30** — only `parent_rate_plan_id`, `derive_bps`, optional index on `rate_plan`.
- **No new catalog / HTTP / audit writer** — catalog stays **81**, writers **56**, last route `[133] post_folio_reconcile_payment`.
- **Property-local only** — no OrgDO `rate_plan`, no cross-property parent, no async `rate_plan.changed` rematerialize Workflow.
- **One-level graph** — parent must be independent; derived-of-derived → `derived_rate_plan_invalid`.
- **Pairing** — both derivation columns set or both cleared; mismatch → `derived_rate_plan_invalid`.
- **Manual derived `rate_day` writes forbidden** — upsert, bulk, matrix PUT → `derived_rate_plan_write_forbidden` (422).
- **Archive parent with active children** — `archive_blocked` (409), same wire code as room archive.
- **Rematerialization is synchronous in PropertyDO** — not the `rematerializesRates` config consumer (leftover **14** stays open).
- **Derived → independent demotion** — existing child `rate_day` rows remain (no scrub).
- **SPA matrix helper exact string:** `Edit the parent plan’s rates.`
- **Scope-out (forbidden all tasks):** OrgDO plans; promo; leftover 14 Workflow; virtual-type sharing; plan-scoped restrictions; night-audit growth; new catalog/HTTP; ticking Tasks 1–3 living boxes; push.

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/do-runtime/src/property-migrations.ts` | `DERIVED_RATE_PLANS_V30_*`; append v30 to `PROPERTY_MIGRATIONS` | 1 |
| `packages/do-runtime/src/index.ts` | export v30 SQL/constants | 1 |
| `migrations/do-property/0030_derived_rate_plans.sql` | generated DDL | 1 |
| `packages/do-runtime/src/migrate.test.ts` | MemorySql v30 handlers; head **30** pins; DDL file match | 1 |
| `packages/contracts/src/idempotency.ts` | + `DERIVED_RATE_PLAN_INVALID`, `DERIVED_RATE_PLAN_WRITE_FORBIDDEN` | 2 |
| `packages/contracts/src/idempotency.test.ts` | wire code assertions | 2 |
| `apps/pms-core/src/property-do.ts` | validation, helpers, hooks on plan/rate RPCs ~10511–12580 | 2 |
| `apps/pms-core/src/v1-dispatch.ts` | POST/PATCH bodies + fingerprints; delete 409 for `ARCHIVE_BLOCKED`; 422 map for new codes | 2 |
| `packages/client-core/src/api.ts` | extend create/update types | 2 |
| `apps/pms-core/test/derived-rate-plans.spec.ts` | Lock 6 cases **1–8** | 2 |
| `apps/web-pms/src/screens/RatesScreen.tsx` | derived create fields; read-only matrix + helper | 3 |
| `apps/web-pms/src/screens/RatesScreen.test.tsx` | RTL derived form + read-only matrix | 3 |
| `docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md` | Close scope-out ~35 + §8 ~419 | 4 |
| `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` | Close leftover **2** ~539 only | 4 |
| `docs/superpowers/specs/2026-08-15-derived-rate-plans-design.md` | Tick §4 checklist | 4 |
| `docs/superpowers/plans/2026-08-15-derived-rate-plans.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `COMMAND_CATALOG` length, `audit-writers.ts`, `v1-http-routes.ts` route list, `NIGHT_AUDIT_STEPS`, OrgDO migrations, `FolioScreen.tsx`, `SettingsScreen.tsx`, leftover **14** pointer (~551).

---

## Spec §1.2 / §4 → task map

| Spec item | Task |
|---|---|
| §1.2 (1) v30 migration | 1 |
| §1.2 (2) validation + wire codes | 2 |
| §1.2 (3) rematerialization helpers + hooks | 2 |
| §1.2 (4) reject manual derived writes | 2 |
| §1.2 (5) HTTP POST/PATCH/GET + client-core | 2 |
| §1.2 (6) SPA derived form + read-only matrix | 3 |
| §1.2 (7) tests + register pins | 2, 4 |
| Lock 6 cases **1–8** | 2 |
| SPA RTL | 3 |
| §4 checklist + pointers | 4 |
| §1.3 scope out | forbidden all |

---

### Task 1: v30 schema — derived rate plan columns

**Spec:** §2 Lock 2 (DDL only), §4 item 1.

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` — after `ROOM_ARCHIVE_V29_*` (~1020–1027); append to `PROPERTY_MIGRATIONS` (~1170–1174)
- Modify: `packages/do-runtime/src/index.ts` — export v30 constants (~112–113)
- Modify: `packages/do-runtime/src/migrate.test.ts` — MemorySql (~180–188, ~225–237, ~626–627, ~818–838); add v30 tests
- Create: `migrations/do-property/0030_derived_rate_plans.sql` — via `pnpm generate:ddl`

**Interfaces:**
- Produces: `DERIVED_RATE_PLANS_V30_STATEMENTS`, `DERIVED_RATE_PLANS_V30_SQL`
- Produces: `PROPERTY_SCHEMA_HEAD === 30` (via `Math.max` on migrations array)

**Forbidden this commit:** PropertyDO RPC changes, wire codes, HTTP, SPA, tests beyond migrate pins, spec pointers.

- [ ] **Step 1: Write failing migrate tests (schema head 30 + v30 DDL match)**

In `packages/do-runtime/src/migrate.test.ts`:

1. Import `DERIVED_RATE_PLANS_V30_SQL` alongside `ROOM_ARCHIVE_V29_SQL` (~46).
2. Update `applies property migrations through version 29` → **version 30** (~225–237): expect `v1`/`v2` === 30, `schemaVersion` length 30, version array ends with `30`.
3. Update `schema head constants` (~626–627):

```typescript
    expect(PROPERTY_SCHEMA_HEAD).toBe(30);
```

4. Add after room_archive block (~818–838):

```typescript
  it('property schema head is 30 after derived_rate_plans', () => {
    const v30 = PROPERTY_MIGRATIONS.find((m) => m.version === 30);
    expect(v30?.name).toBe('derived_rate_plans');
    expect(v30?.statements).toEqual([
      'ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT',
      `ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000))`,
      'CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = \'active\'',
    ]);
  });

  it('migrations/do-property/0030_derived_rate_plans.sql matches DERIVED_RATE_PLANS_V30_SQL', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '../../../migrations/do-property/0030_derived_rate_plans.sql');
    const onDisk = readFileSync(path, 'utf8');
    const body = onDisk
      .split('\n')
      .filter((l) => !l.startsWith('--'))
      .join('\n')
      .trim();
    expect(body).toBe(DERIVED_RATE_PLANS_V30_SQL.trim());
  });
```

5. In `MemorySql.exec` (~180–188), ensure v30 index is handled (generic `CREATE INDEX` branch ~77–79 already covers `rate_plan_parent_active`; `ALTER TABLE rate_plan ADD COLUMN` ~188 already covers both new columns).

- [ ] **Step 2: Run migrate tests to verify they fail**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|derived_rate_plans|through version"
```

Expected: **FAIL** — head still **29**; v30 migration / DDL file missing.

- [ ] **Step 3: Add v30 migration constants + array entry**

In `packages/do-runtime/src/property-migrations.ts` after `ROOM_ARCHIVE_V29_SQL`:

```typescript
export const DERIVED_RATE_PLANS_V30_STATEMENTS = [
  `ALTER TABLE rate_plan ADD COLUMN parent_rate_plan_id TEXT`,
  `ALTER TABLE rate_plan ADD COLUMN derive_bps INTEGER
  CHECK (derive_bps IS NULL OR (derive_bps >= -9900 AND derive_bps <= 10000))`,
  `CREATE INDEX rate_plan_parent_active ON rate_plan(parent_rate_plan_id) WHERE status = 'active'`,
] as const;

export const DERIVED_RATE_PLANS_V30_SQL =
  DERIVED_RATE_PLANS_V30_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 30,
    name: 'derived_rate_plans',
    statements: DERIVED_RATE_PLANS_V30_STATEMENTS,
  },
```

Export from `packages/do-runtime/src/index.ts`:

```typescript
  DERIVED_RATE_PLANS_V30_SQL,
  DERIVED_RATE_PLANS_V30_STATEMENTS,
```

- [ ] **Step 4: Generate on-disk DDL**

```bash
pnpm generate:ddl
```

Expected: creates/updates `migrations/do-property/0030_derived_rate_plans.sql`.

- [ ] **Step 5: Run migrate tests + check:ddl**

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head|derived_rate_plans|through version"
pnpm check:ddl
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 30`.

- [ ] **Step 6: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  packages/do-runtime/src/index.ts \
  packages/do-runtime/src/migrate.test.ts \
  migrations/do-property/0030_derived_rate_plans.sql
git commit -m "$(cat <<'EOF'
feat(do-runtime): v30 derived rate plan columns

EOF
)"
```

---

### Task 2: PropertyDO + HTTP + client-core + Lock 6 tests 1–8

**Spec:** §2 Locks 2–4, §4 items 2–5, Lock 6 cases **1–8** (no SPA).

**Files:**
- Modify: `packages/contracts/src/idempotency.ts` — after `DEFAULT_RATE_PLAN_PROTECTED` (~100)
- Modify: `packages/contracts/src/idempotency.test.ts`
- Modify: `apps/pms-core/src/property-do.ts` — ~10511–10913 plans; ~12375–12580 rates; import new wire codes + `roundHalfAwayFromZero`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostRatePlans` ~3646–3655; `handlePatchRatePlan` ~3691–3710; `handleDeleteRatePlan` ~3793–3798; `mapReservationCommandErrorStatus` ~277–345
- Modify: `packages/client-core/src/api.ts` — ~1639–1671
- Create: `apps/pms-core/test/derived-rate-plans.spec.ts`

**Interfaces:**
- Produces: `DERIVED_RATE_PLAN_INVALID = 'derived_rate_plan_invalid'`
- Produces: `DERIVED_RATE_PLAN_WRITE_FORBIDDEN = 'derived_rate_plan_write_forbidden'`
- Produces: `normalizeDerivedPlanFields(input)` → `{ parentRatePlanId: string | null; deriveBps: number | null }` or throws `DerivedRatePlanInvalidError`
- Produces: `private isDerivedRatePlanSync(ratePlanId: string): boolean`
- Produces: `private computeDerivedAmountMinorSync(parentMinor: number, deriveBps: number): number`
- Produces: `private rematerializeDerivedChildrenSync(parentRatePlanId: string, roomTypeId: string, stayDate: string): void`
- Produces: `private backfillDerivedPlanSync(childRatePlanId: string): void`
- Produces: extended `tryCreateRatePlan` / `tryUpdateRatePlan` / `listRatePlans` / `tryDeleteRatePlan` return types including new errors + `ARCHIVE_BLOCKED` on delete
- Consumes: Task 1 v30 columns on `rate_plan`

**Forbidden this commit:** SPA, spec pointers, ticking Task 4 checkboxes.

- [ ] **Step 1: Write failing tests (`derived-rate-plans.spec.ts`)**

Create `apps/pms-core/test/derived-rate-plans.spec.ts`:

```typescript
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_BLOCKED,
  DEFAULT_RATE_PLAN_PROTECTED,
  DERIVED_RATE_PLAN_INVALID,
  DERIVED_RATE_PLAN_WRITE_FORBIDDEN,
} from '@hospai/contracts';
import { DEFAULT_RATE_PLAN_ID } from '@hospai/do-runtime';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { resolvePropertyFromRegistry } from '../src/provision.js';
import {
  cancelSubscription,
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { addCalendarDays } from './date-helpers.js';
import { createGuest, idemFor, orgStub, provisionedPropertyStub, TEST_OWNER_ACTOR } from './guest-helpers.js';
import type { PropertyDO } from '../src/property-do.js';

async function postOrg(orgId: string, name: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name }),
    }),
    env,
  );
}

async function postProperty(orgId: string, propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: 'Derived Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function postRoomType(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        roomTypeId: 'rt_king',
        code: 'KNG',
        name: 'King',
        roomCount: 10,
        maxOccupancy: 2,
        maxAdults: 2,
        idempotencyKey: `idem-rt-${crypto.randomUUID()}`,
      }),
    }),
    env,
  );
}

async function provisionHotel(actor: string) {
  const orgId = `org_der_${crypto.randomUUID()}`;
  const propertyId = `prop_der_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, 'Derived Org', actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  expect((await postRoomType(propertyId, actor)).status).toBe(201);
  const resolved = await resolvePropertyFromRegistry(env, propertyId);
  if (resolved) await resolved.stub.flushOutbox();
  return { orgId, propertyId, actor, stub: resolved!.stub as DurableObjectStub<PropertyDO> };
}

async function postRatePlan(
  propertyId: string,
  actor: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        idempotencyKey: `idem-plan-${crypto.randomUUID()}`,
        ...body,
      }),
    }),
    env,
  );
}

async function patchRatePlan(
  propertyId: string,
  actor: string,
  ratePlanId: string,
  body: Record<string, unknown>,
) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-patch-${crypto.randomUUID()}`, ...body }),
      },
    ),
    env,
  );
}

async function getRatePlans(propertyId: string, actor: string) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans`, {
      headers: { 'x-dev-actor': actor },
    }),
    env,
  );
}

async function deleteRatePlan(propertyId: string, actor: string, ratePlanId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-plans/${encodeURIComponent(ratePlanId)}`,
      {
        method: 'DELETE',
        headers: {
          'x-dev-actor': actor,
          'x-idempotency-key': `idem-del-${crypto.randomUUID()}`,
        },
      },
    ),
    env,
  );
}

async function putRateDays(propertyId: string, actor: string, body: Record<string, unknown>) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rate-days`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify(body),
    }),
    env,
  );
}

describe('derived rate plans', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  it('case 1: create derived from BAR −15%; list returns parent + bps', async () => {
    const actor = `user_der_1_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    const create = await postRatePlan(propertyId, actor, {
      ratePlanId: childId,
      code: 'BAR15',
      name: 'BAR −15%',
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    });
    expect(create.status).toBe(201);
    const list = (await (await getRatePlans(propertyId, actor)).json()) as {
      plans: Array<{ ratePlanId: string; parentRatePlanId: string | null; deriveBps: number | null }>;
    };
    const child = list.plans.find((p) => p.ratePlanId === childId);
    expect(child).toMatchObject({
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    });
  });

  it('case 2: parent BAR 10000 → child rate_day 8500', async () => {
    const actor = `user_der_2_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const stayDate = '2026-08-20';
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          stayDate,
          amountMinor: 10000,
          currency: 'USD',
          idempotencyKey: `idem-bar-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    const rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows).toEqual([{ stayDate, amountMinor: 8500, currency: 'USD', ratePlanId: childId }]);
  });

  it('case 3: parent night missing → no child row invented', async () => {
    const actor = `user_der_3_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: '2026-08-21',
      toDate: '2026-08-21',
    });
    expect(rows).toEqual([]);
  });

  it('case 4: archive BAR with active derived child → 409 archive_blocked', async () => {
    const actor = `user_der_4_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: 'CHILD',
        code: 'CHILD',
        name: 'Child',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1000,
      })).status,
    ).toBe(201);
    const res = await deleteRatePlan(propertyId, actor, DEFAULT_RATE_PLAN_ID);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: ARCHIVE_BLOCKED });
  });

  it('case 5: derived parent → 422 derived_rate_plan_invalid', async () => {
    const actor = `user_der_5_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: 'MID',
        code: 'MID',
        name: 'Mid',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -500,
      })).status,
    ).toBe(201);
    const res = await postRatePlan(propertyId, actor, {
      ratePlanId: 'GRAND',
      code: 'GRAND',
      name: 'Grandchild',
      parentRatePlanId: 'MID',
      deriveBps: -500,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DERIVED_RATE_PLAN_INVALID });
  });

  it('case 6: PUT rate-days on derived plan → 422 derived_rate_plan_write_forbidden', async () => {
    const actor = `user_der_6_${crypto.randomUUID()}`;
    const { propertyId } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const res = await putRateDays(propertyId, actor, {
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      stayDate: '2026-08-22',
      amountMinor: 9000,
      currency: 'USD',
      idempotencyKey: `idem-forbidden-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false, error: DERIVED_RATE_PLAN_WRITE_FORBIDDEN });
  });

  it('case 7: quote + reservation_rate_night snapshot use derived child rate_day', async () => {
    const name = `der-7-${crypto.randomUUID()}`;
    const { stub, orgId } = await provisionedPropertyStub(name, 'UTC', 'USD');
    const org = orgStub(orgId);
    const guest = await createGuest(org, name, `guest_${name}`, 'Guest');
    const addInput = {
      roomTypeId: 'rt_king',
      code: 'KNG',
      name: 'King',
      roomCount: 5,
      maxOccupancy: 2,
      maxAdults: 2,
    };
    const added = await stub.tryAddRoomType(TEST_OWNER_ACTOR, addInput, await idemFor('rt', addInput));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const childId = `plan_${crypto.randomUUID()}`;
    const plan = {
      ratePlanId: childId,
      code: 'BAR15',
      name: 'BAR −15%',
      parentRatePlanId: DEFAULT_RATE_PLAN_ID,
      deriveBps: -1500,
    };
    expect(await stub.tryCreateRatePlan(TEST_OWNER_ACTOR, plan, await idemFor('cp', plan))).toMatchObject({
      ok: true,
    });
    const night = added.fromDate;
    const barRate = {
      roomTypeId: 'rt_king',
      ratePlanId: DEFAULT_RATE_PLAN_ID,
      stayDate: night,
      amountMinor: 10000,
      currency: 'USD',
    };
    expect(
      await stub.tryUpsertRateDay(TEST_OWNER_ACTOR, barRate, await idemFor('bar', barRate)),
    ).toMatchObject({ ok: true });
    expect(
      await stub.quoteStay({
        roomTypeId: 'rt_king',
        ratePlanId: childId,
        arrivalDate: night,
        departureDate: addCalendarDays(night, 1),
      }),
    ).toEqual({ ok: true, totalMinor: 8500, currency: 'USD' });
    const reservationId = `res_${crypto.randomUUID()}`;
    const createRes = {
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: guest.guestRef,
      ratePlanId: childId,
      arrivalDate: night,
      departureDate: addCalendarDays(night, 1),
    };
    expect(
      await stub.tryCreateReservation(TEST_OWNER_ACTOR, createRes, await idemFor('cr', createRes)),
    ).toMatchObject({ ok: true });
    expect(await stub.listReservationRateNightsForTest(reservationId)).toEqual([
      { stayDate: night, amountMinor: 8500, currency: 'USD', ratePlanId: childId },
    ]);
  });

  it('case 8: PATCH deriveBps rematerializes existing nights', async () => {
    const actor = `user_der_8_${crypto.randomUUID()}`;
    const { propertyId, stub } = await provisionHotel(actor);
    const childId = `plan_${crypto.randomUUID()}`;
    expect(
      (await postRatePlan(propertyId, actor, {
        ratePlanId: childId,
        code: 'BAR15',
        name: 'BAR −15%',
        parentRatePlanId: DEFAULT_RATE_PLAN_ID,
        deriveBps: -1500,
      })).status,
    ).toBe(201);
    const stayDate = '2026-08-23';
    expect(
      (
        await putRateDays(propertyId, actor, {
          roomTypeId: 'rt_king',
          ratePlanId: DEFAULT_RATE_PLAN_ID,
          stayDate,
          amountMinor: 10000,
          currency: 'USD',
          idempotencyKey: `idem-bar8-${crypto.randomUUID()}`,
        })
      ).status,
    ).toBe(200);
    let rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows[0]?.amountMinor).toBe(8500);
    expect(
      (await patchRatePlan(propertyId, actor, childId, { deriveBps: -2000 })).status,
    ).toBe(200);
    rows = await stub.listRateDaysForTest({
      roomTypeId: 'rt_king',
      ratePlanId: childId,
      fromDate: stayDate,
      toDate: stayDate,
    });
    expect(rows[0]?.amountMinor).toBe(8000);
  });
});
```

**Note for implementer:** wire `listRateDaysForTest` if missing (mirror existing read helpers ~2308+). Fix imports (`createGuest` path, `resolveOrgStub` usage) to match repo fixtures; case 7 may use HTTP-only path if stub helpers unavailable — behaviour must match Lock 6.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/derived-rate-plans.spec.ts
```

Expected: **FAIL** — wire codes / DO logic / imports missing.

- [ ] **Step 3: Add wire codes**

`packages/contracts/src/idempotency.ts` after `DEFAULT_RATE_PLAN_PROTECTED`:

```typescript
export const DERIVED_RATE_PLAN_INVALID = 'derived_rate_plan_invalid' as const;
export const DERIVED_RATE_PLAN_WRITE_FORBIDDEN = 'derived_rate_plan_write_forbidden' as const;
```

`packages/contracts/src/idempotency.test.ts`:

```typescript
    expect(DERIVED_RATE_PLAN_INVALID).toBe('derived_rate_plan_invalid');
    expect(DERIVED_RATE_PLAN_WRITE_FORBIDDEN).toBe('derived_rate_plan_write_forbidden');
```

- [ ] **Step 4: Implement PropertyDO validation + rematerialization**

Add error classes near `ArchiveBlockedError` (~372):

```typescript
class DerivedRatePlanInvalidError extends Error {
  constructor() {
    super(DERIVED_RATE_PLAN_INVALID);
    this.name = 'DerivedRatePlanInvalidError';
  }
}
class DerivedRatePlanWriteForbiddenError extends Error {
  constructor() {
    super(DERIVED_RATE_PLAN_WRITE_FORBIDDEN);
    this.name = 'DerivedRatePlanWriteForbiddenError';
  }
}
```

Add helpers (~10500, before `tryCreateRatePlan`):

```typescript
  private normalizeDerivedPlanFields(input: {
    parentRatePlanId?: string | null;
    deriveBps?: number | null;
  }): { parentRatePlanId: string | null; deriveBps: number | null } {
    const parent = input.parentRatePlanId ?? null;
    const bps = input.deriveBps ?? null;
    const parentSet = parent != null && parent !== '';
    const bpsSet = bps != null;
    if (parentSet !== bpsSet) throw new DerivedRatePlanInvalidError();
    if (!parentSet) return { parentRatePlanId: null, deriveBps: null };
    if (bps! < -9900 || bps! > 10_000) throw new DerivedRatePlanInvalidError();
    return { parentRatePlanId: parent, deriveBps: bps };
  }

  private assertDerivedParentEligibleSync(parentRatePlanId: string, childRatePlanId?: string): void {
    if (childRatePlanId && parentRatePlanId === childRatePlanId) throw new DerivedRatePlanInvalidError();
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT status, parent_rate_plan_id FROM rate_plan WHERE rate_plan_id = ?`,
        parentRatePlanId,
      )
      .toArray() as Array<{ status: string; parent_rate_plan_id: string | null }>;
    const parent = rows[0];
    if (!parent || parent.status !== 'active' || parent.parent_rate_plan_id != null) {
      throw new DerivedRatePlanInvalidError();
    }
  }

  private isDerivedRatePlanSync(ratePlanId: string): boolean {
    const rows = this.ctx.storage.sql
      .exec(`SELECT parent_rate_plan_id FROM rate_plan WHERE rate_plan_id = ?`, ratePlanId)
      .toArray() as Array<{ parent_rate_plan_id: string | null }>;
    return rows[0]?.parent_rate_plan_id != null;
  }

  private computeDerivedAmountMinorSync(parentMinor: number, deriveBps: number): number {
    const child = Number(
      roundHalfAwayFromZero(BigInt(parentMinor) * BigInt(10_000 + deriveBps), 10_000n),
    );
    if (!Number.isSafeInteger(child)) throw new InvalidMoneyError('derived amount overflow');
    return child;
  }

  private upsertDerivedChildRateDaySync(
    actor: ActorContext,
    propertyId: string,
    roomTypeId: string,
    childRatePlanId: string,
    stayDate: string,
    amountMinor: number,
    currency: string,
  ): void {
    const beforeRows = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor, currency FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
        roomTypeId,
        childRatePlanId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number; currency: string }>;
    this.ctx.storage.sql.exec(
      `INSERT INTO rate_day (room_type_id, rate_plan_id, stay_date, amount_minor, currency, version)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(room_type_id, rate_plan_id, stay_date) DO UPDATE SET
         amount_minor = excluded.amount_minor,
         currency = excluded.currency,
         version = rate_day.version + 1`,
      roomTypeId,
      childRatePlanId,
      stayDate,
      amountMinor,
      currency,
    );
    this.appendPropertyOutbox({
      eventId: crypto.randomUUID(),
      eventType: 'rate.changed',
      payload: { propertyId, roomTypeId, ratePlanId: childRatePlanId, stayDate },
    });
    this.appendAuditLogSync({
      actor: this.auditActorSync(actor),
      commandId: 'rates.upsert_day',
      entityType: 'rate_day',
      entityId: `${roomTypeId}:${childRatePlanId}:${stayDate}`,
      beforeJson: beforeRows[0]
        ? { amountMinor: beforeRows[0].amount_minor, currency: beforeRows[0].currency }
        : null,
      afterJson: { roomTypeId, ratePlanId: childRatePlanId, stayDate, amountMinor, currency },
    });
  }

  private rematerializeDerivedChildrenSync(
    actor: ActorContext,
    propertyId: string,
    parentRatePlanId: string,
    roomTypeId: string,
    stayDate: string,
  ): void {
    const parentRows = this.ctx.storage.sql
      .exec(
        `SELECT amount_minor, currency FROM rate_day
         WHERE room_type_id = ? AND rate_plan_id = ? AND stay_date = ?`,
        roomTypeId,
        parentRatePlanId,
        stayDate,
      )
      .toArray() as Array<{ amount_minor: number; currency: string }>;
    const parentCell = parentRows[0];
    if (!parentCell) return;
    const children = this.ctx.storage.sql
      .exec(
        `SELECT rate_plan_id, derive_bps FROM rate_plan
         WHERE status = 'active' AND parent_rate_plan_id = ?`,
        parentRatePlanId,
      )
      .toArray() as Array<{ rate_plan_id: string; derive_bps: number }>;
    for (const child of children) {
      const amountMinor = this.computeDerivedAmountMinorSync(
        parentCell.amount_minor,
        child.derive_bps,
      );
      this.upsertDerivedChildRateDaySync(
        actor,
        propertyId,
        roomTypeId,
        child.rate_plan_id,
        stayDate,
        amountMinor,
        parentCell.currency,
      );
    }
  }

  private backfillDerivedPlanSync(actor: ActorContext, propertyId: string, childRatePlanId: string): void {
    const childRows = this.ctx.storage.sql
      .exec(
        `SELECT parent_rate_plan_id, derive_bps FROM rate_plan WHERE rate_plan_id = ?`,
        childRatePlanId,
      )
      .toArray() as Array<{ parent_rate_plan_id: string | null; derive_bps: number | null }>;
    const child = childRows[0];
    if (!child?.parent_rate_plan_id || child.derive_bps == null) return;
    const parentDays = this.ctx.storage.sql
      .exec(
        `SELECT room_type_id, stay_date, amount_minor, currency FROM rate_day WHERE rate_plan_id = ?`,
        child.parent_rate_plan_id,
      )
      .toArray() as Array<{
      room_type_id: string;
      stay_date: string;
      amount_minor: number;
      currency: string;
    }>;
    for (const day of parentDays) {
      const amountMinor = this.computeDerivedAmountMinorSync(day.amount_minor, child.derive_bps);
      this.upsertDerivedChildRateDaySync(
        actor,
        propertyId,
        day.room_type_id,
        childRatePlanId,
        day.stay_date,
        amountMinor,
        day.currency,
      );
    }
  }
```

Extend **`tryCreateRatePlan`**: parse optional fields; validate; INSERT includes `parent_rate_plan_id, derive_bps`; after txn success call `backfillDerivedPlanSync` when derived. Extend **`tryUpdateRatePlan`**: track parent/bps changes; full rematerialize via `backfillDerivedPlanSync` when changed. Extend **`tryDeleteRatePlan`**: before archive, query active children → `ArchiveBlockedError`. Extend **`listRatePlans`**: SELECT + return `parentRatePlanId`, `deriveBps`.

In **`tryUpsertRateDay`**: after `assertActiveRatePlanSync`, if derived → throw `DerivedRatePlanWriteForbiddenError`; after parent upsert audit, call `rematerializeDerivedChildrenSync(actor, propertyId, ratePlanId, roomTypeId, stayDate)`.

In **`tryBulkUpdateRates`**: same derived guard per cell; rematerialize after each parent cell write.

Map errors in catch blocks to wire codes. Extend return type unions with `DERIVED_RATE_PLAN_INVALID`, `DERIVED_RATE_PLAN_WRITE_FORBIDDEN`, `ARCHIVE_BLOCKED` on delete.

- [ ] **Step 5: Extend dispatch + client-core**

`handlePostRatePlans` / `handlePatchRatePlan`: add optional `parentRatePlanId`, `deriveBps` to body type, `commandPayload`, fingerprint, and PATCH invalid_body guard.

`handleDeleteRatePlan` (~3793):

```typescript
    if (err === ARCHIVE_BLOCKED) {
      return json({ ok: false, error: err }, 409);
    }
```

`mapReservationCommandErrorStatus` (~319+): add `DERIVED_RATE_PLAN_INVALID`, `DERIVED_RATE_PLAN_WRITE_FORBIDDEN` to 422 list.

`packages/client-core/src/api.ts`:

```typescript
        parentRatePlanId?: string | null;
        deriveBps?: number | null;
```

on `createRatePlan` input; `updateRatePlan` patch already `Record<string, unknown>` — document fields in JSDoc if present.

- [ ] **Step 6: Rebuild contracts + run tests + register pins**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/derived-rate-plans.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/rate-plans-routes.spec.ts
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
```

Expected: cases **1–8** **PASS**; existing rate-plans routes unchanged **PASS**; catalog **81**; writers **56**; `[133]` last; `PROPERTY_SCHEMA_HEAD === 30`.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/idempotency.ts \
  packages/contracts/src/idempotency.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  packages/client-core/src/api.ts \
  apps/pms-core/test/derived-rate-plans.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): property-local derived rate plans

EOF
)"
```

---

### Task 3: SPA RatesScreen — derived create + read-only matrix

**Spec:** §2 Lock 5, Lock 6 SPA (not in cases 1–8).

**Files:**
- Modify: `apps/web-pms/src/screens/RatesScreen.tsx` — types ~32–42; create form ~211–385; `RateCell` ~99–133; matrix ~389–520
- Modify: `apps/web-pms/src/screens/RatesScreen.test.tsx`

**Interfaces:**
- Consumes: Task 2 `listRatePlans` rows with `parentRatePlanId`, `deriveBps`; `createRatePlan` optional fields

**Forbidden this commit:** Folio/Settings, DO/contracts changes, spec pointers, ticking Task 4 checkboxes.

- [ ] **Step 1: Write failing RTL tests**

Extend `RatePlanRow` mock data. Add tests:

```typescript
  it('derived plan create sends parentRatePlanId and deriveBps', async () => {
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        bar,
        {
          ratePlanId: 'CORP',
          code: 'CORP',
          name: 'Corporate',
          status: 'active',
          cancelPenaltyType: 'none',
          cancelGraceHours: 0,
          cancelPenaltyNights: null,
          cancelPenaltyBps: null,
          cancelPolicyText: null,
          parentRatePlanId: null,
          deriveBps: null,
        },
      ],
    });
    renderRates('/rates/plans');
    fireEvent.change(await screen.findByLabelText('Derived from'), { target: { value: 'BAR' } });
    fireEvent.change(screen.getByLabelText('Derive percent'), { target: { value: '-15' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'BAR15' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BAR −15%' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Rate Plan' }));
    await waitFor(() => expect(createRatePlan).toHaveBeenCalled());
    expect(createRatePlan.mock.calls[0]?.[1]).toMatchObject({
      parentRatePlanId: 'BAR',
      deriveBps: -1500,
    });
  });

  it('derived matrix is read-only with exact helper copy', async () => {
    listRatePlans.mockResolvedValue({
      ok: true,
      plans: [
        bar,
        {
          ...bar,
          ratePlanId: 'BAR15',
          code: 'BAR15',
          name: 'BAR −15%',
          parentRatePlanId: 'BAR',
          deriveBps: -1500,
        },
      ],
    });
    listRateDays.mockResolvedValue({
      ok: true,
      days: [
        {
          roomTypeId: 'rt_king',
          ratePlanId: 'BAR15',
          stayDate: '2026-08-13',
          amountMinor: 8500,
          currency: 'USD',
        },
      ],
    });
    renderRates('/rates/matrix?from=2026-08-13&to=2026-08-13&plan=BAR15');
    expect(await screen.findByText('Edit the parent plan’s rates.')).toBeTruthy();
    const cell = screen.getByLabelText('Rate for KNG on 2026-08-13');
    expect(cell).toHaveAttribute('readonly');
    fireEvent.blur(cell);
    expect(putRateDay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Fill Selected Days' })).toBeNull();
  });
```

- [ ] **Step 2: Run RTL tests to verify they fail**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx -t "derived"
```

Expected: **FAIL** — fields/helper absent.

- [ ] **Step 3: Implement RatesScreen derived UX**

1. Extend `RatePlanRow` with `parentRatePlanId: string | null; deriveBps: number | null`.
2. Plans table: optional badge when derived (e.g. `−15% of BAR` from bps / parent code lookup).
3. Create form state: `derivedFrom` (`''` = independent), `derivePercent` string.
4. Fields: `Derived from` `NativeSelect` — active plans where `parentRatePlanId == null`, plus empty option “Independent”.
5. When derived selected: `Derive percent` number input (UI −15 → `deriveBps: -1500` via `Math.round(parseFloat(v) * 100)`).
6. `createPlan.mutationFn`: pass `parentRatePlanId` / `deriveBps` when derived; omit or null when independent.
7. `RateCell`: add `readOnly?: boolean`; render read-only display or `<Input readOnly disabled />`; skip blur PUT when readOnly.
8. Matrix tab: `const selectedPlan = plans.find(p => p.ratePlanId === plan)`; `const isDerived = selectedPlan?.parentRatePlanId != null`; pass `readOnly={isDerived}`; when derived show `<p className="muted">Edit the parent plan’s rates.</p>`; hide bulk fill form.

- [ ] **Step 4: Rebuild client-core + run RTL + color check**

```bash
pnpm build
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx
pnpm check:web-pms-colors
```

Expected: **PASS** (including existing matrix tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/RatesScreen.tsx \
  apps/web-pms/src/screens/RatesScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): derived rate plan form and read-only matrix

EOF
)"
```

---

### Task 4: Leftover pointers + full CI

**Spec:** §4 checklist, §5 closes pointers, D6/D7.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md` — scope-out ~35 + §8 table ~419
- Modify: `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` — leftover **2** ~539 (**do not** edit leftover **14** ~551)
- Modify: `docs/superpowers/specs/2026-08-15-derived-rate-plans-design.md` — tick §4 checklist
- Modify: `docs/superpowers/plans/2026-08-15-derived-rate-plans.md` — Task 4 checkboxes only (this file)

**Pointer sentences (normative — one sentence each):**

Rate-plans vertical scope-out (~35):

> ~~Derived / linked plans ("BAR minus 10%"). ARCHITECTURE §7.2's derivation graph and OrgDO-hosted plan definitions stay deferred~~ **Closed (property-local half)** in [2026-08-15 derived rate plans](./2026-08-15-derived-rate-plans-design.md): one-level percent-of-parent on PropertyDO `rate_plan` with sync `rate_day` rematerialization; OrgDO chain-wide stays out.

Rate-plans vertical §8 table (~419):

> ~~Derived / linked plans ("BAR − 10%") \| Needs derivation workflow + `rate_plan.changed` rematerialization~~ **Closed (property-local half)** in [2026-08-15 derived rate plans](./2026-08-15-derived-rate-plans-design.md).

Property-setup §19 leftover **2** (~539):

> ~~**2** \| Derived / OrgDO rate plans \| §7.2; property-local plans stay~~ **Closed (property-local half)** in [2026-08-15 derived rate plans](./2026-08-15-derived-rate-plans-design.md); OrgDO-hosted chain-wide stays out.

- [ ] **Step 1: Pin frozen heads (register + schema + night-audit step count)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **81**; writers **56**; `[133]=post_folio_reconcile_payment`; `[132]=delete_room`; `[131]=post_folio_routing_rule_archive`; `[127]=post_demo_seed`; `PLATFORM_GAPS === []`; `PROPERTY_SCHEMA_HEAD === 30`; `ORG_SCHEMA_HEAD === 7`; `NIGHT_AUDIT_STEPS.length === 8`.

- [ ] **Step 2: Targeted test superset (spec Lock 6 + SPA)**

```bash
pnpm build
pnpm --filter @hospai/pms-core exec vitest run test/derived-rate-plans.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/rate-plans-routes.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/folio-quote-snapshot.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx
pnpm check:permissions
pnpm check:entitlements
pnpm check:degraded
pnpm check:class-denylist
pnpm check:web-pms-colors
pnpm check:pms-core-test-dates
```

Expected: **PASS**.

- [ ] **Step 3: Full CI sequence (`.github/workflows/ci.yml` `checks` job + 8-shard pms-core)**

```bash
pnpm build
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
node scripts/property-ddl.mjs --self-test
pnpm typecheck
pnpm exec turbo run test --filter=!@hospai/pms-core
pnpm lint
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
pnpm --filter @hospai/pms-core exec vitest run --shard=2/8
pnpm --filter @hospai/pms-core exec vitest run --shard=3/8
pnpm --filter @hospai/pms-core exec vitest run --shard=4/8
pnpm --filter @hospai/pms-core exec vitest run --shard=5/8
pnpm --filter @hospai/pms-core exec vitest run --shard=6/8
pnpm --filter @hospai/pms-core exec vitest run --shard=7/8
pnpm --filter @hospai/pms-core exec vitest run --shard=8/8
```

If any shard fails with workerd 503, retry that shard once. Do not `|| true` failures. Do **not** run unsharded `pnpm --filter @hospai/pms-core test`.

- [ ] **Step 4: Apply doc pointers + tick spec §4 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-derived-rate-plans-design.md` §4. **Do not** close property-setup leftover **14** (~551).

- [ ] **Step 5: Tick Task 4 checkboxes in this plan only**

Do **not** tick Tasks 1–3 checkboxes.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md \
  docs/superpowers/specs/2026-08-13-property-setup-spa-design.md \
  docs/superpowers/specs/2026-08-15-derived-rate-plans-design.md \
  docs/superpowers/plans/2026-08-15-derived-rate-plans.md
git commit -m "$(cat <<'EOF'
docs: close derived rate plans leftovers

EOF
)"
```

**Stop.** OrgDO chain-wide plans, promo, leftover **14** `rematerializesRates` consumer, and plan-scoped restrictions stay deferred per spec §1.3.

---

## Spec §4 reviewer checklist (Task 4 ticks these in the spec file when CI is green)

| §4 item | Satisfied by |
|---|---|
| v30 migration + `PROPERTY_SCHEMA_HEAD` **30** | Task 1 |
| Derived create/update/archive validation + wire codes | Task 2 |
| Parent write rematerialize + derived create backfill + update rematerialize | Task 2 |
| Derived manual rate write rejected on all write paths | Task 2 |
| HTTP POST/PATCH + GET list + client-core extended; fingerprints updated | Task 2 |
| SPA derived form + read-only matrix | Task 3 |
| Tests Lock 6 (**1–8**); register pins **81** / **56** / `[133]` / steps **8** | Tasks 2 + 4 |
| Bidirectional closes pointers | Task 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.2 scope in (1–7) | 1–4 |
| §1.3 scope out | forbidden all |
| §2 Locks 1–6 | 1–4 |
| §3 implementation pointers | 2 |
| §4 checklist + pointers | 4 |
| Heads table §1.1 | 1 + 4 verify |
| D-locks 1–7 | Open decisions |

**Gaps:** None — all Lock 6 numbered cases **1–8** and §4 checklist items map to Tasks 1–4. Leftover **14** explicitly remains open.

**Placeholder scan:** No TBD/TODO/similar-to-only references.

**Final CI:** Task 4 Step 3 pastes full `checks` job + 8 shards from `.github/workflows/ci.yml`.

**Tree conflicts:** None (spec §5). Verified on `main` post auth-hold-lapse: `tryCreateRatePlan` ~10511, `tryUpsertRateDay` ~12375, `RatesScreen` plan form ~211–228 / matrix ~389+, `roundHalfAwayFromZero` ~123 (`packages/money`), `ARCHIVE_BLOCKED` ~15 (`idempotency.ts`), catalog **81**, writers **56**, `[133] post_folio_reconcile_payment` last, `PROPERTY_SCHEMA_HEAD` **29** (this plan → **30**).

**Implementer notes (from spec §5, not lock violations):**

1. **`cancel_penalty_bps` vs `derive_bps`** — separate SPA labels; do not reuse “Penalty bps” for derivation.
2. **Bulk update** — derived-target cells fail fast; parent cells still write + rematerialize children.
3. **Backfill on create** — O(types × parent nights); acceptable Phase 1; no Workflow chunking.
4. **Derived → independent demotion** — child `rate_day` rows remain until overwritten.
5. **`handleDeleteRatePlan`** — add explicit `ARCHIVE_BLOCKED` → 409 (not in `mapReservationCommandErrorStatus` 409 list today).
6. **Case 7** — reuse `folio-quote-snapshot.spec.ts` patterns (`listReservationRateNightsForTest` ~2339); pass explicit `ratePlanId` on create.
