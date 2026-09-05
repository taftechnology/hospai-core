# Cross-tenant provision hardening (R0.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-04)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **S1** (cross-org membership graft via global `getProperty`), **S3** (leaky `existing` on conflict), and **G1** (missing cross-org characterization test). Add org-id match gate in `provisionProperty`; map `property_exists` → **409** in `handlePostOrgProperties`; strip `existing` from failure results and HTTP bodies.

**Architecture:** Characterization tests land **first** and must fail on current `main`. Production is a three-file change (contracts type, `provision.ts` gate, `handlePostOrgProperties` mapping). No new route, command, event, or migration. Pins frozen.

**Tech Stack:** Cloudflare Workers + D1 + OrgDO/PropertyDO (`apps/pms-core`), `@hospai/contracts`, vitest + `cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-09-04-cross-tenant-provision-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-04 per spec. No catalog/route/schema pin updates in any task.

---

## Locked behaviour (do not re-litigate)

| Scenario | DO result | HTTP |
|---|---|---|
| `existing.orgId !== input.orgId` (any jurisdiction) | `{ ok: false, error: 'property_exists' }` — no `existing` | **409** `{ error: 'property_exists' }` only |
| Same org, jurisdiction mismatch | `{ ok: false, error: 'jurisdiction_conflict' }` — no `existing` | **409** `{ error: 'jurisdiction_conflict' }` only |
| Same org, jurisdiction match | `{ ok: true, property, locationHint }` | **201** (unchanged) |
| Fresh insert | `{ ok: true, property, locationHint }` | **201** (unchanged) |

**Evaluation order in `provisionProperty`:** after `getProperty`, **org match first**, then jurisdiction, then sync.

**Dispatch branch order in `handlePostOrgProperties`:** `property_exists` → `jurisdiction_conflict` → `tenant_not_active` → `invalid_*` → generic 400.

**Out of scope:** `auth.spec.ts` org-takeover cases, `setupCompanyWindowAtZeroBalance`, `scripts/demo-seed.mjs`, SPA, new routes/commands.

---

## Sequencing gate

```
Task 1 (red tests) → Task 2 (production, green) → Task 3 (full CI + R0.1 tick)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1, T2, T3 revised assertion, T5, T6). Task 2 makes them green. Task 3 runs the full CI `checks` job sequence plus pms-core shards.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:** `apps/pms-core/test/tenancy.spec.ts`, `apps/pms-core/test/provision-routes.spec.ts` (new)

**Interfaces:** none (tests only)

### Step 1 — Library tests T1–T4 in `tenancy.spec.ts`

`tenancy.spec.ts` already imports `resolveOrgStub` and `OrgDO` (lines 10–11). Do **not** add duplicate imports. Add the new `it(...)` blocks below and apply the T3 assertion change only.

Add after the existing `rejects jurisdiction conflict with 409 semantics` test block:

**T1 — cross-org re-provision returns property_exists and does not graft membership**

```ts
  it('cross-org re-provision returns property_exists and does not graft membership', async () => {
    const victimPropertyId = `prop_victim_${crypto.randomUUID()}`;
    const orgB = `org_b_${crypto.randomUUID()}`;
    const orgA = `org_a_${crypto.randomUUID()}`;
    const victimOwner = 'user_victim_owner';
    const attacker = 'user_attacker';

    const victimProvision = await provisionProperty(env, {
      orgId: orgB,
      propertyId: victimPropertyId,
      name: 'Victim Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: victimOwner,
    });
    expect(victimProvision.ok).toBe(true);

    const victimOrgBefore = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    const membersBefore = await victimOrgBefore.listMembers();
    expect(membersBefore.some((m) => m.userId === victimOwner)).toBe(true);
    expect(membersBefore.some((m) => m.userId === attacker)).toBe(false);

    const crossOrg = await provisionProperty(env, {
      orgId: orgA,
      propertyId: victimPropertyId,
      name: 'Attacker Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
      actorUserId: attacker,
    });
    expect(crossOrg.ok).toBe(false);
    if (crossOrg.ok) return;
    expect(crossOrg.error).toBe('property_exists');
    expect('existing' in crossOrg).toBe(false);

    const victimOrgAfter = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    const membersAfter = await victimOrgAfter.listMembers();
    expect(membersAfter.some((m) => m.userId === attacker)).toBe(false);
    expect(membersAfter).toEqual(membersBefore);
  });
```

**T2 — cross-org with jurisdiction mismatch still returns property_exists**

```ts
  it('cross-org re-provision with jurisdiction mismatch still returns property_exists', async () => {
    const victimPropertyId = `prop_victim_jx_${crypto.randomUUID()}`;
    const orgB = `org_b_jx_${crypto.randomUUID()}`;
    const orgA = `org_a_jx_${crypto.randomUUID()}`;

    expect(
      (
        await provisionProperty(env, {
          orgId: orgB,
          propertyId: victimPropertyId,
          name: 'Victim Hotel',
          jurisdiction: 'eu',
          timeZone: 'Europe/Berlin',
          currency: 'EUR',
          actorUserId: 'user_victim',
        })
      ).ok,
    ).toBe(true);

    const crossOrg = await provisionProperty(env, {
      orgId: orgA,
      propertyId: victimPropertyId,
      name: 'Attacker Hotel',
      jurisdiction: 'us',
      timeZone: 'America/New_York',
      currency: 'USD',
      actorUserId: 'user_attacker',
    });
    expect(crossOrg.ok).toBe(false);
    if (crossOrg.ok) return;
    expect(crossOrg.error).toBe('property_exists');
    expect('existing' in crossOrg).toBe(false);
  });
```

**T3 — revise existing jurisdiction conflict test (strip S3 leak assertion)**

In `rejects jurisdiction conflict with 409 semantics`, replace:

```ts
    expect(second.existing?.jurisdiction).toBe('eu');
```

with:

```ts
    expect('existing' in second).toBe(false);
```

**T4 — same-org idempotent re-provision (regression guard; should pass on `main` today)**

Add explicit idempotent case (may overlap timezone test behaviour; keep as named T4):

```ts
  it('same-org idempotent re-provision with matching jurisdiction succeeds', async () => {
    const propertyId = `prop_idem_${crypto.randomUUID()}`;
    const orgId = `org_idem_${crypto.randomUUID()}`;
    const first = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Idem Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(first.ok).toBe(true);

    const second = await provisionProperty(env, {
      orgId,
      propertyId,
      name: 'Idem Hotel',
      jurisdiction: 'eu',
      timeZone: 'Europe/Paris',
      currency: 'EUR',
      actorUserId: 'user_owner',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.property.propertyId).toBe(propertyId);
    expect(second.property.orgId).toBe(orgId);
  });
```

### Step 2 — HTTP tests T5–T7 in new `provision-routes.spec.ts`

Create `apps/pms-core/test/provision-routes.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOrgStub } from '@hospai/tenant-router';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import { ensurePlatformSchema, resetPlatformSchemaGate } from '../src/registry.js';

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

async function postProperty(
  orgId: string,
  propertyId: string,
  actor: string,
  overrides: {
    name?: string;
    jurisdiction?: 'eu' | 'us' | 'fedramp' | null;
    timeZone?: string;
    currency?: string;
  } = {},
) {
  return worker.fetch(
    new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({
        propertyId,
        name: overrides.name ?? 'Provision Hotel',
        jurisdiction: overrides.jurisdiction ?? null,
        timeZone: overrides.timeZone ?? 'UTC',
        currency: overrides.currency ?? 'USD',
      }),
    }),
    env,
  );
}

function assertPropertyExistsBody(body: unknown) {
  expect(body).toEqual({ error: 'property_exists' });
  const record = body as Record<string, unknown>;
  for (const key of ['orgId', 'propertyId', 'name', 'jurisdiction', 'existing'] as const) {
    expect(record).not.toHaveProperty(key);
  }
}

describe('provision HTTP routes (cross-tenant)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
  });

  it('T5: cross-org POST with victim propertyId returns 409 property_exists without identifiers', async () => {
    const orgA = `org_a_http_${crypto.randomUUID()}`;
    const orgB = `org_b_http_${crypto.randomUUID()}`;
    const victimPropertyId = `prop_victim_http_${crypto.randomUUID()}`;
    const victimOwner = 'user_victim_http';
    const attacker = 'user_attacker_http';

    expect((await postOrg(orgB, 'Org B', victimOwner)).status).toBe(201);
    expect(
      (
        await postProperty(orgB, victimPropertyId, victimOwner, {
          jurisdiction: 'eu',
          timeZone: 'Europe/Berlin',
          currency: 'EUR',
        })
      ).status,
    ).toBe(201);

    const victimOrgBefore = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    const membersBefore = await victimOrgBefore.listMembers();

    expect((await postOrg(orgA, 'Org A', attacker)).status).toBe(201);

    const res = await postProperty(orgA, victimPropertyId, attacker, {
      jurisdiction: 'eu',
      timeZone: 'Europe/Berlin',
      currency: 'EUR',
    });
    expect(res.status).toBe(409);
    assertPropertyExistsBody(await res.json());

    const victimOrgAfter = resolveOrgStub(env.ORG_DO, { orgId: orgB }) as DurableObjectStub<OrgDO>;
    expect(await victimOrgAfter.listMembers()).toEqual(membersBefore);
    expect((await victimOrgAfter.listMembers()).some((m) => m.userId === attacker)).toBe(false);
  });

  it('T6: cross-org POST with jurisdiction mismatch still returns property_exists', async () => {
    const orgA = `org_a_jx_http_${crypto.randomUUID()}`;
    const orgB = `org_b_jx_http_${crypto.randomUUID()}`;
    const victimPropertyId = `prop_victim_jx_http_${crypto.randomUUID()}`;

    expect((await postOrg(orgB, 'Org B', 'user_b')).status).toBe(201);
    expect(
      (
        await postProperty(orgB, victimPropertyId, 'user_b', {
          jurisdiction: 'eu',
          timeZone: 'Europe/Berlin',
          currency: 'EUR',
        })
      ).status,
    ).toBe(201);

    expect((await postOrg(orgA, 'Org A', 'user_a')).status).toBe(201);

    const res = await postProperty(orgA, victimPropertyId, 'user_a', {
      jurisdiction: 'us',
      timeZone: 'America/New_York',
      currency: 'USD',
    });
    expect(res.status).toBe(409);
    assertPropertyExistsBody(await res.json());
  });

  it('T7: same-org re-provision via HTTP returns 201', async () => {
    const orgId = `org_idem_http_${crypto.randomUUID()}`;
    const propertyId = `prop_idem_http_${crypto.randomUUID()}`;
    const owner = 'user_idem_http';

    expect((await postOrg(orgId, 'Idem Org', owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
    expect((await postProperty(orgId, propertyId, owner)).status).toBe(201);
  });
});
```

### Step 3 — Run vitest; confirm red

After Steps 1–2 (library tests + new HTTP file written):

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tenancy.spec.ts test/provision-routes.spec.ts
```

- [ ] T1, T2, T3 revised assertion, T5, T6 **fail** on current `main` (T1/T2: cross-org graft returns `ok: true`; T3: `'existing' in second` is true; T5/T6: HTTP **201** instead of **409**)
- [ ] T4, T7 **pass** on current `main`
- [ ] Do **not** touch `auth.spec.ts`, `setupCompanyWindowAtZeroBalance`, or `scripts/demo-seed.mjs`

### Step 4 — Commit (tests only)

```bash
git add apps/pms-core/test/tenancy.spec.ts apps/pms-core/test/provision-routes.spec.ts
git commit -m "$(cat <<'EOF'
test(pms-core): add cross-tenant provision characterization (red)

Add library T1–T4 and HTTP T5–T7 for org-id match on re-provision.
Tests fail on current main where cross-org graft and existing leak remain.
EOF
)"
```

---

## Task 2 — Production fix (types + provision gate + dispatch mapping)

**Files:** `packages/contracts/src/tenancy/types.ts`, `apps/pms-core/src/provision.ts`, `apps/pms-core/src/v1-dispatch.ts`

**Interfaces:**

```ts
// packages/contracts/src/tenancy/types.ts — failure variant only
export type ProvisionPropertyResult =
  | { ok: true; property: PropertyRecord; locationHint: string }
  | {
      ok: false;
      error:
        | 'property_exists'
        | 'jurisdiction_conflict'
        | 'invalid_timezone'
        | 'invalid_currency'
        | 'invalid_tenant_id'
        | 'tenant_not_active'
        | string;
    };
```

### Step 1 — Update contracts type

In `packages/contracts/src/tenancy/types.ts`:

- [ ] Add `'property_exists'` to the error literal union
- [ ] **Delete** `existing?: PropertyRecord` from the `{ ok: false; ... }` variant

### Step 2 — Org gate in `provision.ts`

In `apps/pms-core/src/provision.ts`, replace the `if (existing) {` block (~58–65) with:

```ts
  const existing = await getProperty(env, input.propertyId);
  if (existing) {
    if (existing.orgId !== input.orgId) {
      return { ok: false, error: 'property_exists' };
    }
    if (existing.jurisdiction !== input.jurisdiction) {
      return { ok: false, error: 'jurisdiction_conflict' };
    }
    await syncOrgAndPropertyDo(env, existing, locationHint, input.actorUserId, ledgerCurrency);
    return { ok: true, property: existing, locationHint };
  }
```

- [ ] Org gate runs **before** jurisdiction check
- [ ] Jurisdiction branch returns `{ ok: false, error: 'jurisdiction_conflict' }` with **no** `existing`
- [ ] Same-org sync path and fresh-insert path unchanged

### Step 3 — HTTP mapping in `handlePostOrgProperties`

In `apps/pms-core/src/v1-dispatch.ts` (~1330–1344), replace the error branch with:

```ts
  if (!result.ok) {
    if (result.error === 'property_exists') {
      return json({ error: 'property_exists' }, 409);
    }
    if (result.error === 'jurisdiction_conflict') {
      return json({ error: 'jurisdiction_conflict' }, 409);
    }
    if (result.error === 'tenant_not_active') {
      return json({ error: 'tenant_not_active' }, 409);
    }
    if (
      result.error === 'invalid_timezone' ||
      result.error === 'invalid_currency' ||
      result.error === 'invalid_tenant_id'
    ) {
      return json({ error: result.error }, 400);
    }
    return json({ error: result.error }, 400);
  }
```

- [ ] `property_exists` branch is **before** generic 400 fallthrough
- [ ] `jurisdiction_conflict` body has **no** `existing`
- [ ] No drive-by refactor elsewhere in dispatch

### Step 4 — Focused test run (must go green)

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tenancy.spec.ts test/provision-routes.spec.ts test/auth.spec.ts
```

- [ ] T1–T7 green
- [ ] Existing `tenancy.spec.ts` regression tests green (EU, null-jurisdiction, first-write, etc.)
- [ ] `auth.spec.ts` unchanged and green

### Step 5 — Grep sanity

```bash
grep -n "ensureMember" apps/pms-core/src/provision.ts
```

- [ ] `ensureMember` remains only inside `syncOrgAndPropertyDo`, reachable only after org match

### Step 6 — Typecheck

```bash
pnpm typecheck
```

- [ ] No TS errors from removing `existing` on failure variant (fix any compile errors in callers — should be only `v1-dispatch.ts`)

### Step 7 — Commit

```bash
git add packages/contracts/src/tenancy/types.ts apps/pms-core/src/provision.ts apps/pms-core/src/v1-dispatch.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): block cross-org provision graft and strip conflict leak

Gate re-provision on org-id match; map property_exists to 409; remove
existing from jurisdiction_conflict DO and HTTP bodies (audit S1/S3).
EOF
)"
```

---

## Task 3 — Full verify + tick R0.1

**Files:** `docs/roadmap.md` (R0.1 checkbox only)

### Step 1 — Named vitest files (provision slice)

```bash
pnpm --filter @hospai/pms-core exec vitest run test/tenancy.spec.ts test/provision-routes.spec.ts test/auth.spec.ts
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

Prefer the repo wrapper (8 shards, includes ledger property specs locally):

```bash
pnpm test:local
```

**Alternative — match CI matrix exactly** (8 shards excluding ledger property specs + isolated ledger job):

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

**Never put `--` before `--shard`.**

- [ ] All shards green

### Step 4 — Pin freeze confirmation

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] `COMMAND_CATALOG` length **89**
- [ ] `V1_HTTP_ROUTE_AUDIT` length **144**, last id `get_city_ledger_statement`
- [ ] `PROPERTY_SCHEMA_HEAD === 34`
- [ ] `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`

### Step 5 — Tick roadmap R0.1

In `docs/roadmap.md`, change:

```markdown
- [ ] **R0.1** Audit V1 — S1/S3/G1 provision graft. ...
```

to:

```markdown
- [x] **R0.1** Audit V1 — S1/S3/G1 provision graft. ...
```

- [ ] Tick in **this** commit only (same change-set as verify landing — not a separate docs-only commit)

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.1 after cross-tenant provision hardening

Full CI checks and pms-core shards green; audit S1/S3/G1 closed.
EOF
)"
```

---

## Test matrix (spec §5 — mapped to tasks)

| # | Layer | Task | Expect |
|---|---|---|---|
| T1 | library | Task 1 | `property_exists`, no `existing`, victim OrgDO unchanged |
| T2 | library | Task 1 | mismatch jurisdiction → still `property_exists` |
| T3 | library | Task 1 | same-org jurisdiction mismatch → `jurisdiction_conflict`, no `existing` |
| T4 | library | Task 1 | same-org idempotent → `ok: true` |
| T5 | HTTP | Task 1 | **409** clean body; victim members unchanged |
| T6 | HTTP | Task 1 | **409** `property_exists` (not `jurisdiction_conflict`) |
| T7 | HTTP | Task 1 | same-org re-provision **201** |
| T8 | regression | Task 2 verify | existing `tenancy.spec.ts` cases green |
| T9 | regression | Task 2 verify | `auth.spec.ts` org takeover / non-member 404 unchanged |

---

## Success criteria (spec §10)

1. Cross-org attempt → **409** / `property_exists`, no victim fields in JSON.
2. Victim OrgDO membership unchanged — attacker not added to org B.
3. Same-org jurisdiction mismatch → **409** / `jurisdiction_conflict`, no `existing`.
4. Same-org idempotent re-provision → **201**, sync allowed.
5. T1–T7 would have failed on pre-fix `main`.
6. All pins unchanged; full verify green.
7. `ensureMember` in `provision.ts` unreachable on cross-org input.
