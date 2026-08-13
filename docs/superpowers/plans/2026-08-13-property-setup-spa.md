# Property Setup SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** Rebuild the prototype inventory / rates / settings screens against live APIs so a hotelier can configure a property without curl — four FAIL_CLOSED read routes (111–114), one DOMAIN reclass, client-core methods, gated SPA, and booking leftovers 3 and 6.

**Architecture:** No new catalog command. Reads append at the end of `V1_HTTP_ROUTE_AUDIT` / `V1_ROUTES`. PropertyDO grows four list RPCs and widens `listRatePlans`; writers already exist. SPA is core `nav.ts` (not a module). `pms.ops.auto_assign_rooms` becomes DOMAIN + `consumersExempt` so Settings PUT can round-trip; no consumer is invented. Schema stays at head 24.

**Tech Stack:** Cloudflare Durable Objects (PropertyDO), `@hospai/contracts`, `@hospai/client-core`, vitest + cloudflare:test, React SPA in `apps/web-pms`.

**Spec:** `docs/superpowers/specs/2026-08-13-property-setup-spa-design.md` (Approved). Spec commit: `ecd6e9a37364d8e121795bb2f9f923fc08e2cb2e`.

## Global Constraints

- Route audit **append-only**. `[110] = post_folio_fx_adjustment` does not move. New routes are **`[111] get_room_types`**, **`[112] get_rate_days`**, **`[113] get_restriction_days`**, **`[114] get_domain_config`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES`. Do not splice GET next to the existing POST/PUT siblings (index zip with `check:permissions`). Method + first-match makes shared paths legal.
- `COMMAND_CATALOG.length` stays **74**. Reads omit `commandId`. `AUDIT_WRITER_COMMAND_IDS.size` stays **49**. `PLATFORM_GAPS` stays `[]`.
- **Schema freeze.** No new table, ALTER, or `PROPERTY_SCHEMA_HEAD` bump (stays **24**). `pnpm generate:ddl` may run as hygiene only; it **must produce a no-op diff and change no migration files**.
- `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- `runIdempotent` stays sync-only. New RPCs are reads (`assertRpcAvailable`).
- Reclass **only** `pms.ops.auto_assign_rooms` → DOMAIN + `consumersExempt: true`. Sibling `pms.ops.auto_assign_rule` / `pms.ops.auto_assign_rooming` stay OPERATIONAL and off-screen. Do **not** add a PropertyDO reader, night-audit branch, or auto-assign at check-in.
- Restrictions GET/SPA are type-wide (`rate_plan_id = '*'`) only. Do not accept a foreign `ratePlanId` query. No bulk restriction command.
- Money is integers. Rate cells use `formatMinor` / `parseMajorToMinor` for display only. Ledger currency on Settings is read-only. FX on Settings is a **link** to `/in-house`, not a second editor.
- Nav: Inventory `/inventory` order **42** `inventory:write`; Rates `/rates` order **44** `rates:write`; Settings `/settings` order **70** `settings:configure`. Core `nav.ts`, not `module-ui-registry.ts`. Housekeeping module stays `order: 25`.
- Route gates copy `StaffRoute` / `BookRoute` (`hasPropertyPermission`, no `ROLE_GRANTS`). Deep-link without grant → `/arrivals`.
- `GET /rooms` permission stays `housekeeping:read`. Do not add `rooms.delete`. Never send `roomTypeId` on room PATCH.
- Fixture dates from property-local `business_date` when the date is load-bearing. Shared-storage tests key fixtures with `crypto.randomUUID()`.
- **Rebuild:** after any `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests. After client-core source change, `pnpm --filter @hospai/client-core build` before web-pms tests.
- Task 1 must **not** touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT` (`check:permissions` stays green).
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 11). Do not backfill historical plans.
- No either/or forks. Open questions in spec §22 are **locked**.
- Scope-out (do not implement): virtual room types, derived/OrgDO plans, `rooms.delete`, tape chart/WS, `ui-kit`, city ledger/AR, invoices, auto-transfer, recurring charges, partial refunds, exception workbench, PCI, plan-scoped restrictions, `rematerializesRates` consumer, `currencies_list` as FX allowlist, auto-extend/auto-assign **consumers**, photos, inclusions.

## File map

| File | Role |
|---|---|
| `packages/contracts/src/config/register.ts` | `auto_assign_rooms` → DOMAIN + `consumersExempt` (Task 1) |
| `packages/contracts/src/register.test.ts` | Reclass pin (Task 1); `[111]`–`[114]` pins (Task 2) |
| `packages/contracts/src/v1-http-routes.ts` | Append `[111]`–`[114]` (Task 2 only) |
| `apps/pms-core/src/property-do.ts` | `listRoomTypes` / `listRateDays` / `listRestrictionDays` / `listDomainConfig`; widen `listRatePlans` |
| `apps/pms-core/src/v1-dispatch.ts` | GET handlers + append four `V1_ROUTES` at **END** |
| `apps/pms-core/test/property-setup-reads.spec.ts` | New: GET 111–114, date cap, staff 403/200, kill-switch, round-trip |
| `apps/pms-core/test/domain-config-routes.spec.ts` | PUT `auto_assign_rooms` succeeds after reclass |
| `apps/pms-core/test/rate-plans-routes.spec.ts` | GET includes cancel-policy columns |
| `packages/client-core/src/api.ts` | Setup methods (Task 3) |
| `packages/client-core/test/api-property-setup.test.ts` | New client tests |
| `apps/web-pms/src/shell/nav.ts` | Three nav entries |
| `apps/web-pms/src/App.tsx` | Nested routes |
| `apps/web-pms/src/screens/InventoryRoute.tsx` (+ test) | `inventory:write` gate |
| `apps/web-pms/src/screens/InventoryScreen.tsx` (+ test) | Types + rooms |
| `apps/web-pms/src/screens/RatesRoute.tsx` (+ test) | `rates:write` gate |
| `apps/web-pms/src/screens/RatesScreen.tsx` (+ test) | Plans + matrix + restrictions |
| `apps/web-pms/src/screens/SettingsRoute.tsx` (+ test) | `settings:configure` gate |
| `apps/web-pms/src/screens/SettingsScreen.tsx` (+ test) | DOMAIN + charges + tax + FX link |
| `apps/web-pms/src/screens/use-unsaved-changes.ts` | `beforeunload` + `useBlocker` |
| `apps/web-pms/src/screens/BookingScreen.tsx` | Leftover 6 labels |
| `apps/web-pms/src/screens/BoardScreen.tsx` | Leftover 3 property-local today |
| Sibling specs | One-sentence pointers (Task 9) |

## Test file split (spec §20 → file)

| Spec # | File | Task |
|---|---|---|
| 3 reclass / invariants | `packages/contracts/src/register.test.ts` | 1 |
| 1–2, 4 route pins | `register.test.ts` | 2 |
| 5–6 room-types GET | `property-setup-reads.spec.ts` | 2 |
| 7 rate-days GET | `property-setup-reads.spec.ts` | 2 |
| 8 restriction-days GET | `property-setup-reads.spec.ts` | 2 |
| 9–10 domain GET + PUT auto_assign | `property-setup-reads.spec.ts` + `domain-config-routes.spec.ts` | 2 |
| 11 rate-plans cancel fields | `rate-plans-routes.spec.ts` | 2 |
| 12 kill-switch | `property-setup-reads.spec.ts` | 2 |
| client-core | `api-property-setup.test.ts` | 3 |
| 13 nav | `apps/web-pms/src/auth/me.test.ts` | 4 |
| 14 Inventory | `InventoryRoute.test.tsx` + `InventoryScreen.test.tsx` | 4–5 |
| 15–16 Rates / restrictions | `RatesScreen.test.tsx` | 6 |
| 17 Settings | `SettingsScreen.test.tsx` | 7 |
| 18 Booking labels | `BookingScreen.test.tsx` | 8 |
| 19 Board date | `BoardScreen.test.tsx` | 8 |
| 25–26 pins, ddl no-op, purge, denylist | Task 10 CI | 10 |
| Bidirectional pointers | sibling specs | 9 |

---

### Task 1: Reclass `pms.ops.auto_assign_rooms` (own commit, no HTTP routes)

**Spec:** §8.1, §20.3. Keep `check:permissions` green.

**Files:**
- Modify: `packages/contracts/src/config/register.ts` (the existing OPERATIONAL entry at the `pms.ops.auto_assign_rooms` line — **edit in place**, do not move the entry in `CONFIG_REGISTER`)
- Modify: `packages/contracts/src/register.test.ts`
- Test: `packages/contracts` vitest

**Interfaces:**
- Produces: `getConfigEntry('pms.ops.auto_assign_rooms')` → `{ class: 'DOMAIN', consumersExempt: true, default: true, permission: 'settings:configure' }`
- Consumes: nothing from later tasks
- **Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, any DO method body, any SPA, any migration, `AUDIT_WRITER_COMMAND_IDS` membership, new catalog ids, sibling ops keys, `pms.night_audit.auto_extend`.

- [ ] **Step 1: Write the failing tests**

In `packages/contracts/src/register.test.ts`, add next to the existing `assertRegisterInvariants` test:

```ts
it('pms.ops.auto_assign_rooms is DOMAIN + consumersExempt (property-setup SPA)', () => {
  const entry = getConfigEntry('pms.ops.auto_assign_rooms');
  expect(entry?.class).toBe('DOMAIN');
  expect(entry?.consumersExempt).toBe(true);
  expect(entry?.default).toBe(true);
  expect(entry?.permission).toBe('settings:configure');
  expect(() => assertRegisterInvariants()).not.toThrow();

  const extend = getConfigEntry('pms.night_audit.auto_extend');
  expect(extend?.class).toBe('DOMAIN');
  expect(getConfigEntry('pms.ops.auto_assign_rule')?.class).toBe('OPERATIONAL');
  expect(getConfigEntry('pms.ops.auto_assign_rooming')?.class).toBe('OPERATIONAL');
});
```

Import `getConfigEntry` if not already imported (it is). Do **not** add `[111]` assertions this commit (`[110]` stays `post_folio_fx_adjustment`; `[111]` is undefined until Task 2). Size pins stay **74** / **49**.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

Expected: FAIL — `class` is still `'OPERATIONAL'`.

- [ ] **Step 3: Implement**

Replace the `pms.ops.auto_assign_rooms` entry **in place** (keep it in the OPERATIONAL comment block; GET order is register order):

```ts
entry({
  key: 'pms.ops.auto_assign_rooms',
  prototypeKey: 'pms_sys_auto_assign_rooms',
  class: 'DOMAIN',
  schema: bool,
  default: true,
  consumersExempt: true,
}),
```

Same family as `pms.folio.close_window_on_check_out`. Default stays `true`. Do not add `consumers`. Do not touch sibling ops keys.

- [ ] **Step 4: Rebuild contracts, re-run tests, check:permissions**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
pnpm check:entitlements
```

Expected: all exit 0. `check:permissions` still reports the current `V1_HTTP_ROUTE_AUDIT.length` (no new route). `assertRegisterInvariants` stays green via `consumersExempt`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/config/register.ts packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
feat(contracts): reclass auto_assign_rooms as DOMAIN

EOF
)"
```

---

### Task 2: DO list RPCs + HTTP routes 111–114 + widen `listRatePlans`

**Spec:** §3, §4.1, §6.1–6.2, §7.1, §8.2, §16, §20.1–20.2, §20.5–20.12.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append four audit rows after `post_folio_fx_adjustment`
- Modify: `packages/contracts/src/register.test.ts` — `[111]`–`[114]` pins
- Modify: `apps/pms-core/src/property-do.ts` — four list methods; widen `listRatePlans`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — four GET handlers; append four `V1_ROUTES` at **END** (after `handlePostFolioFxAdjustment`)
- Create: `apps/pms-core/test/property-setup-reads.spec.ts`
- Modify: `apps/pms-core/test/domain-config-routes.spec.ts` — PUT `auto_assign_rooms`
- Modify: `apps/pms-core/test/rate-plans-routes.spec.ts` — cancel columns on GET

**Interfaces:**

```ts
async listRoomTypes(status: 'active' | 'archived' | 'all'): Promise<Array<{
  roomTypeId: string; code: string; name: string; roomCount: number;
  maxOccupancy: number; maxAdults: number; status: 'active' | 'archived';
  createdAt: number; updatedAt: number;
}>>

async listRateDays(q: {
  fromDate: string; toDate: string; roomTypeId?: string; ratePlanId?: string;
}): Promise<Array<{
  roomTypeId: string; ratePlanId: string; stayDate: string;
  amountMinor: number; currency: string; version: number;
}>>
// omitted ratePlanId → DEFAULT_RATE_PLAN_ID ('BAR')

async listRestrictionDays(q: {
  fromDate: string; toDate: string; roomTypeId?: string;
}): Promise<Array<{
  roomTypeId: string; stayDate: string;
  minLos: number | null; maxLos: number | null;
  cta: boolean; ctd: boolean; stopSell: boolean; version: number;
}>>
// SQL: rate_plan_id = '*' (TYPE_WIDE_RATE_PLAN)

async listDomainConfig(): Promise<Array<{
  key: string; value: unknown;
  source: 'stored' | 'default' | 'unset';
  version: number | null; permission: string; consumersExempt: boolean;
}>>
// Do not rename existing listDomainKeys()

// listRatePlans return rows gain:
cancelPenaltyType: 'none' | 'first_night' | 'nights' | 'percent' | 'full'
cancelGraceHours: number
cancelPenaltyNights: number | null
cancelPenaltyBps: number | null
cancelPolicyText: string | null
```

HTTP bodies wrap as `{ ok: true, roomTypes }` / `{ ok: true, days }` / `{ ok: true, keys }` / existing `{ ok: true, plans }`.

- [ ] **Step 1: Write the failing register pins**

In the existing route-audit `it` that already pins `[110]`, append:

```ts
expect(V1_HTTP_ROUTE_AUDIT[110]?.id).toBe('post_folio_fx_adjustment');
expect(V1_HTTP_ROUTE_AUDIT[111]?.id).toBe('get_room_types');
expect(V1_HTTP_ROUTE_AUDIT[111]).toMatchObject({
  scope: 'property',
  permission: 'inventory:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[111] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[112]?.id).toBe('get_rate_days');
expect(V1_HTTP_ROUTE_AUDIT[112]).toMatchObject({
  scope: 'property',
  permission: 'rates:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[112] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[113]?.id).toBe('get_restriction_days');
expect(V1_HTTP_ROUTE_AUDIT[113]).toMatchObject({
  scope: 'property',
  permission: 'rates:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[113] ?? {})).toBe(false);
expect(V1_HTTP_ROUTE_AUDIT[114]?.id).toBe('get_domain_config');
expect(V1_HTTP_ROUTE_AUDIT[114]).toMatchObject({
  scope: 'property',
  permission: 'settings:configure',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
});
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[114] ?? {})).toBe(false);
expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(49);
expect(COMMAND_CATALOG).toHaveLength(74);
expect(PLATFORM_GAPS).toEqual([]);
```

- [ ] **Step 2: Write failing HTTP tests** (`apps/pms-core/test/property-setup-reads.spec.ts`)

Copy provision helpers from `domain-config-routes.spec.ts` / `rate-plans-routes.spec.ts` (`postOrg`, `postProperty`, `crypto.randomUUID()` ids, `ensurePlatformSchema` / `setKillSwitch` in `beforeEach`/`afterEach`, `org.ensureMember(staff, 'staff')`).

Required cases (spec §20.5–20.12):

1. `GET /room-types` as owner → 200; empty property → `{ ok: true, roomTypes: [] }` (not 404). After POST type, list contains code/name/occupancy. `status=all` includes archived after DELETE. Invalid `status=nope` → 400.
2. Staff member (`ensureMember(..., 'staff')`) GET room-types → **200** (`inventory:read`). Stranger → 404/403 per existing membership mapping (same as `get_rate_plans` test 19).
3. PUT a BAR cell then `GET /rate-days?fromDate=&toDate=` returns that cell (`amountMinor` integer). Omitted `ratePlanId` defaults BAR. Missing cells omitted (do not invent `0`). `fromDate=2026-01-01&toDate=2026-04-05` → 400 `{ error: 'date_range_exceeds_max' }` (same pair as `availability-read.spec.ts` Test 5). `fromDate > toDate` → 400.
4. PUT type-wide restriction (`ratePlanId` omitted) then GET returns booleans. `GET .../restriction-days?...&ratePlanId=CORP` → 400 `{ error: 'invalid_query', detail: 'type_wide_only' }`.
5. `GET /config/domain` as staff → **403** with `permission: 'settings:configure'`. Owner body includes `pms.night_audit.auto_extend` and `pms.ops.auto_assign_rooms`. Keys do **not** include `pms.ops.auto_assign_rule` or any `pms.ui.*` / SECRET. After provision, `pms.money.currency_code` and `pms.time.time_zone` have `source: 'stored'`. PUT then GET round-trips `source: 'stored'`.
6. Kill-switch: `setKillSwitch(env, 'pms.core', true)` then owner GET on each of the four paths → 503 (existing entitlement pair; see `folio-fx-routes.spec.ts`).

In `domain-config-routes.spec.ts` add:

```ts
it('PUT pms.ops.auto_assign_rooms succeeds after DOMAIN reclass', async () => {
  const owner = 'user_cfg_auto_assign';
  const { propertyId, stub } = await provisionHotel(owner);
  const res = await putDomainConfig(propertyId, owner, {
    key: 'pms.ops.auto_assign_rooms',
    value: false,
    reason: 'ops:explicit-assign',
    idempotencyKey: 'idem-cfg-auto-assign',
  });
  expect(res.status).toBe(200);
  expect(await stub.readConfig('pms.ops.auto_assign_rooms')).toBe(false);
});
```

Do **not** change check-in / assign tests.

In `rate-plans-routes.spec.ts` extend the BAR seed test (or add):

```ts
const bar = body.plans.find((p) => p.ratePlanId === DEFAULT_RATE_PLAN_ID);
expect(bar).toMatchObject({
  cancelPenaltyType: 'none',
  cancelGraceHours: 0,
});
expect('cancelPenaltyNights' in (bar ?? {})).toBe(true);
expect('cancelPenaltyBps' in (bar ?? {})).toBe(true);
expect('cancelPolicyText' in (bar ?? {})).toBe(true);
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/property-setup-reads.spec.ts test/domain-config-routes.spec.ts test/rate-plans-routes.spec.ts
```

Expected: FAIL — missing audit rows / handlers / extra plan columns / auto_assign PUT still class-gated (if Task 1 dist is built, PUT may already succeed; the GET tests still fail).

- [ ] **Step 4: Implement DO RPCs**

`listRoomTypes` — `assertRpcAvailable`; `status` default `'active'`; `WHERE (? = 'all' OR status = ?)`; `ORDER BY code`. Map snake_case columns.

`listRateDays` — default `ratePlanId` to `DEFAULT_RATE_PLAN_ID`. SQL:

```sql
SELECT room_type_id, rate_plan_id, stay_date, amount_minor, currency, version
FROM rate_day
WHERE stay_date >= ? AND stay_date <= ?
  AND rate_plan_id = ?
  AND (? IS NULL OR room_type_id = ?)
ORDER BY room_type_id, stay_date
```

`listRestrictionDays` — always `rate_plan_id = '*'`. Map `cta`/`ctd`/`stop_sell` integers to booleans.

`listDomainConfig` — iterate `domainConfigKeys()` (register order). One `SELECT key, value_json, version FROM property_config`. For each DOMAIN entry:

- row present → `source: 'stored'`, `value: JSON.parse(value_json)`, `version`
- row missing and key is `pms.money.currency_code` or `pms.time.time_zone` → `source: 'unset'`, `value: null`, `version: null`
- else → `source: 'default'`, `value: entry.default`, `version: null`

Include `permission: entry.permission` and `consumersExempt: Boolean(entry.consumersExempt)`. Do **not** send Zod. Do not include OPERATIONAL / PRESENTATION / SECRET. Do not change `listDomainKeys()`.

Widen `listRatePlans` SELECT to add `cancel_penalty_type`, `cancel_grace_hours`, `cancel_penalty_nights`, `cancel_penalty_bps`, `cancel_policy_text`. Still `WHERE status = 'active'`.

- [ ] **Step 5: Implement HTTP handlers + append routes**

Copy `handleGetRatePlans` / `handleGetRooms` (resolvePropertyContext, `degradedFailClosedReadResponse` on `isPropertyDoTransportFailure`).

`handleGetRoomTypes`: query `status` default `active`; allow `archived` | `all`; else 400. Call `listRoomTypes`. Return `{ ok: true, roomTypes }`.

`handleGetRateDays` / `handleGetRestrictionDays`: copy the availability date checks (do **not** refactor `handleGetAvailability` this chunk):

```ts
if (!fromDate || !toDate || !dateRe.test(fromDate) || !dateRe.test(toDate)) {
  return json({ error: 'invalid_date' }, 400);
}
if (fromDate > toDate) {
  return json({ error: 'invalid_date_range' }, 400);
}
if (toDate > addDays(fromDate, 89)) {
  return json({ error: 'date_range_exceeds_max' }, 400);
}
```

`addDays` already exists at the bottom of `v1-dispatch.ts`. Restriction handler: if `ratePlanId` query is present and not `'*'`, return `400 { error: 'invalid_query', detail: 'type_wide_only' }`.

`handleGetDomainConfig`: `listDomainConfig()` → `{ ok: true, keys }`.

Append **at the END** of `V1_HTTP_ROUTE_AUDIT` (after `post_folio_fx_adjustment`):

```ts
{
  id: 'get_room_types',
  scope: 'property',
  permission: 'inventory:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_rate_days',
  scope: 'property',
  permission: 'rates:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_restriction_days',
  scope: 'property',
  permission: 'rates:read',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
{
  id: 'get_domain_config',
  scope: 'property',
  permission: 'settings:configure',
  entitlement: 'pms.core',
  degradedRead: 'FAIL_CLOSED',
},
```

Append **at the END** of `V1_ROUTES` (after `handlePostFolioFxAdjustment`). `CommandLink` allows `{ entitlement: FeatureKey; commandId?: never }`. Omit `commandId`. Patterns:

```
GET  /^\/v1\/properties\/([^/]+)\/room-types$/
GET  /^\/v1\/properties\/([^/]+)\/rate-days$/
GET  /^\/v1\/properties\/([^/]+)\/restriction-days$/
GET  /^\/v1\/properties\/([^/]+)\/config\/domain$/
```

Do **not** add `GET …/room-types/:id`. Do **not** add `GET …/room-types/:id/rates`. Do **not** put config GET at `/config` without `/domain`.

- [ ] **Step 6: Rebuild and run**

```bash
pnpm --filter @hospai/contracts build
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
pnpm --filter @hospai/pms-core exec vitest run test/property-setup-reads.spec.ts test/domain-config-routes.spec.ts test/rate-plans-routes.spec.ts
```

Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts packages/contracts/src/register.test.ts \
  apps/pms-core/src/property-do.ts apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/property-setup-reads.spec.ts \
  apps/pms-core/test/domain-config-routes.spec.ts \
  apps/pms-core/test/rate-plans-routes.spec.ts
git commit -m "$(cat <<'EOF'
feat(http): add property-setup read routes [111-114]

EOF
)"
```

---

### Task 3: client-core methods

**Spec:** §14.

**Files:**
- Modify: `packages/client-core/src/api.ts` — add methods on the `createClient` return object
- Create: `packages/client-core/test/api-property-setup.test.ts`

**Interfaces:** (later SPA tasks consume these names exactly)

```ts
listRoomTypes(propertyId, query?: { status?: 'active' | 'archived' | 'all' })
createRoomType(propertyId, input: { roomTypeId: string; code: string; name: string; roomCount: number; maxOccupancy: number; maxAdults: number })
updateRoomType(propertyId, roomTypeId, input: { code?: string; name?: string; roomCount?: number; maxOccupancy?: number; maxAdults?: number })
archiveRoomType(propertyId, roomTypeId)

createRoom(propertyId, input: { roomId: string; roomTypeId: string; code: string; floor?: string })
updateRoom(propertyId, roomId, input: { code?: string; floor?: string })
// listRooms already exists — do not duplicate

listRatePlans(propertyId)
createRatePlan(propertyId, input: { ratePlanId: string; code: string; name: string; cancelPenaltyType?: string; cancelGraceHours?: number; cancelPenaltyNights?: number | null; cancelPenaltyBps?: number | null; cancelPolicyText?: string | null })
updateRatePlan(propertyId, ratePlanId, patch: Record<string, unknown>)
archiveRatePlan(propertyId, ratePlanId)

listRateDays(propertyId, query: { fromDate: string; toDate: string; roomTypeId?: string; ratePlanId?: string })
putRateDay(propertyId, input: { roomTypeId: string; ratePlanId?: string; stayDate: string; amountMinor: number; currency: string })
bulkUpdateRates(propertyId, updates: Array<{ roomTypeId: string; ratePlanId?: string; stayDate: string; amountMinor: number; currency: string }>)

listRestrictionDays(propertyId, query: { fromDate: string; toDate: string; roomTypeId?: string })
putRestrictionDay(propertyId, input: { roomTypeId: string; stayDate: string; minLos?: number | null; maxLos?: number | null; cta?: boolean; ctd?: boolean; stopSell?: boolean })

listDomainConfig(propertyId)
putDomainConfig(propertyId, input: { key: string; value: unknown; reason: string; effectiveFrom?: string })
updatePropertyDetails(propertyId, input: { name: string })

listChargeCodes(propertyId, query?: { status?: 'active' | 'archived' | 'all' })
createChargeCode(propertyId, input: { code: string; name: string })
updateChargeCode(propertyId, code, input: { name?: string; taxGroup?: string | null })
setChargeCodeStatus(propertyId, code, status: 'active' | 'archived')

listTaxRules(propertyId)
createTaxRule(propertyId, input: { taxRuleId: string; ruleKey: string; name: string; ruleType: string; rate: string; taxGroup: string; outputChargeCode: string; validFrom: string; validTo?: string | null })
supersedeTaxRule(propertyId, taxRuleId, input: Record<string, unknown>)
```

Writes: `getJson(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, idempotencyKey }) })` with `idempotencyKey = stableKeyForOperation(opId, opts.keyStore)`. Do **not** use `bookingReservationOpId`. Reads: `getJson` like `listRooms`.

HTTP paths (existing writers):

| Method | Path |
|---|---|
| GET/POST | `/v1/properties/:pid/room-types` |
| PUT/DELETE | `/v1/properties/:pid/room-types/:id` |
| POST | `/v1/properties/:pid/rooms` |
| PATCH | `/v1/properties/:pid/rooms/:id` |
| GET/POST | `/v1/properties/:pid/rate-plans` |
| PATCH/DELETE | `/v1/properties/:pid/rate-plans/:id` |
| GET/PUT | `/v1/properties/:pid/rate-days` |
| POST | `/v1/properties/:pid/rates/bulk` |
| GET/PUT | `/v1/properties/:pid/restriction-days` |
| GET/PUT | `/v1/properties/:pid/config/domain` |
| PATCH | `/v1/properties/:pid` |
| GET/POST | `/v1/properties/:pid/charge-codes` |
| PATCH | `/v1/properties/:pid/charge-codes/:code` |
| PUT | `/v1/properties/:pid/charge-codes/:code/status` |
| GET/POST | `/v1/properties/:pid/tax-rules` |
| PUT | `/v1/properties/:pid/tax-rules/:id/supersede` |

- [ ] **Step 1: Write failing client tests**

`packages/client-core/test/api-property-setup.test.ts` — reuse `mockTransport` / `createClient` from `api.test.ts`. Assert:

- `listRoomTypes('p', { status: 'all' })` GETs `/v1/properties/p/room-types?status=all`
- `putRateDay` POSTs integer `amountMinor` and an `idempotencyKey` (not empty)
- `putRestrictionDay` omits `ratePlanId` from JSON
- `putDomainConfig` PUTs `{ key, value, reason, idempotencyKey }`
- 503 `{ degraded: 'FAIL_CLOSED' }` on `listDomainConfig` throws `ClassifiedError` and does **not** append the queued-command log

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-property-setup.test.ts
```

Expected: FAIL — methods missing.

- [ ] **Step 3: Implement methods on `createClient`**

Follow `listRooms` / `openShift`. Encode ids with existing `enc()`.

- [ ] **Step 4: Run + rebuild**

```bash
pnpm --filter @hospai/client-core exec vitest run test/api-property-setup.test.ts
pnpm --filter @hospai/client-core build
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/client-core/src/api.ts packages/client-core/test/api-property-setup.test.ts
git commit -m "$(cat <<'EOF'
feat(client-core): add property-setup inventory, rates, and config methods

EOF
)"
```

---

### Task 4: Nav + route gates

**Spec:** §13, §20.13–20.14 (gates).

**Files:**
- Modify: `apps/web-pms/src/shell/nav.ts`
- Modify: `apps/web-pms/src/auth/me.test.ts`
- Create: `apps/web-pms/src/screens/InventoryRoute.tsx` + `InventoryRoute.test.tsx`
- Create: `apps/web-pms/src/screens/RatesRoute.tsx` + `RatesRoute.test.tsx`
- Create: `apps/web-pms/src/screens/SettingsRoute.tsx` + `SettingsRoute.test.tsx`
- Modify: `apps/web-pms/src/App.tsx`
- Create stub screens that render a testid so gates can mount (Tasks 5–7 replace the bodies): `InventoryScreen.tsx`, `RatesScreen.tsx`, `SettingsScreen.tsx` each exporting a function that returns `<div data-testid="…-screen">` until filled.

**Interfaces:**
- Consumes: `hasPropertyPermission` / `meShellStateFromQuery` (StaffRoute)
- Produces: nav ids `inventory` / `rates` / `settings`; gates that do not mount the screen without the grant

- [ ] **Step 1: Write failing nav + gate tests**

`nav.ts` additions (core SPA, **not** `module-ui-registry.ts`):

```ts
{ id: 'inventory', label: 'Inventory', path: '/inventory', order: 42, permission: 'inventory:write' },
{ id: 'rates', label: 'Rates', path: '/rates', order: 44, permission: 'rates:write' },
{ id: 'settings', label: 'Settings', path: '/settings', order: 70, permission: 'settings:configure' },
```

Insert so `order` sorts correctly relative to book (40) and staff (50) / night-audit (60). Housekeeping stays module `order: 25` — do not move it.

In `me.test.ts`, extend the staff-role `#8` test (permissions already include `inventory:read` / `rates:read`, not write/configure):

```ts
expect(filtered.map((e) => e.id)).not.toContain('inventory');
expect(filtered.map((e) => e.id)).not.toContain('rates');
expect(filtered.map((e) => e.id)).not.toContain('settings');
```

Add an admin-shaped test: permissions include `inventory:write`, `rates:write`, `settings:configure` → all three ids present.

Copy `StaffRoute.test.tsx` three times: without grant → `/arrivals` and `queryByTestId('inventory-screen')` null; with grant → screen mounts. Same for rates / settings.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/auth/me.test.ts src/screens/InventoryRoute.test.tsx src/screens/RatesRoute.test.tsx src/screens/SettingsRoute.test.tsx
```

Expected: FAIL — ids missing / files missing.

- [ ] **Step 3: Implement**

Copy `StaffRoute.tsx` to `InventoryRoute` / `RatesRoute` / `SettingsRoute`. Swap permission to `inventory:write` / `rates:write` / `settings:configure`. Use `<Outlet />` so nested tabs work:

```tsx
if (shell.authority.kind === 'live') {
  if (!hasPropertyPermission(shell.authority.me, 'inventory:write')) {
    return <Navigate to="/arrivals" replace />;
  }
  return <Outlet />;
}
```

Unknown authority → fail open (`<Outlet />`), same as Staff.

`App.tsx` nested routes:

```tsx
<Route path="inventory" element={<InventoryRoute />}>
  <Route index element={<InventoryScreen tab="types" />} />
  <Route path="rooms" element={<InventoryScreen tab="rooms" />} />
</Route>
<Route path="rates" element={<RatesRoute />}>
  <Route index element={<Navigate to="matrix" replace />} />
  <Route path="plans" element={<RatesScreen tab="plans" />} />
  <Route path="matrix" element={<RatesScreen tab="matrix" />} />
  <Route path="restrictions" element={<RatesScreen tab="restrictions" />} />
</Route>
<Route path="settings" element={<SettingsRoute />}>
  <Route index element={<Navigate to="property" replace />} />
  <Route path="property" element={<SettingsScreen tab="property" />} />
  <Route path="charges" element={<SettingsScreen tab="charges" />} />
  <Route path="tax" element={<SettingsScreen tab="tax" />} />
</Route>
```

Stub screens: `<div data-testid="inventory-screen">` (and rates/settings). No `ROLE_GRANTS`. No `role === 'admin'` (fails `check:web-pms-me-gating`).

- [ ] **Step 4: Rebuild client-core if needed, run tests + me-gating**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/auth/me.test.ts src/screens/InventoryRoute.test.tsx src/screens/RatesRoute.test.tsx src/screens/SettingsRoute.test.tsx
pnpm check:web-pms-me-gating
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/shell/nav.ts apps/web-pms/src/auth/me.test.ts apps/web-pms/src/App.tsx \
  apps/web-pms/src/screens/InventoryRoute.tsx apps/web-pms/src/screens/InventoryRoute.test.tsx \
  apps/web-pms/src/screens/RatesRoute.tsx apps/web-pms/src/screens/RatesRoute.test.tsx \
  apps/web-pms/src/screens/SettingsRoute.tsx apps/web-pms/src/screens/SettingsRoute.test.tsx \
  apps/web-pms/src/screens/InventoryScreen.tsx apps/web-pms/src/screens/RatesScreen.tsx \
  apps/web-pms/src/screens/SettingsScreen.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): add inventory, rates, and settings nav gates

EOF
)"
```

---

### Task 5: Inventory SPA (room types + rooms)

**Spec:** §4.2–4.3, §5, §15, §16, §20.14.

**Files:**
- Create: `apps/web-pms/src/screens/use-unsaved-changes.ts`
- Modify: `apps/web-pms/src/screens/InventoryScreen.tsx` + create `InventoryScreen.test.tsx`

**Interfaces:**
- Consumes: `api.listRoomTypes`, `createRoomType`, `updateRoomType`, `archiveRoomType`, `listRooms`, `createRoom`, `updateRoom`
- Produces: `/inventory` types table + `/inventory/rooms` grouped rooms

- [ ] **Step 1: Write failing screen tests**

`InventoryScreen.test.tsx` — mock `../client.js` like `StaffScreen.test.tsx`. Cases:

- Empty types: copy “No room types yet — create one to start selling.”
- Create type: submit Code/Name/Room Count/Max Occupancy/Max Adults → `createRoomType` called with integer occupancy and a minted `roomTypeId`; button shows “Saving…” during flight.
- Archive: confirmation “Archive {code}?”; cancel does not call `archiveRoomType`; confirm does.
- Rooms tab: grouped by type; empty type copy includes sellable `roomCount`. Create room mints `roomId`. Update room PATCH body has `code`/`floor` and **no** `roomTypeId`.
- FAIL_CLOSED list → “Property unreachable — cannot load inventory.” (not an empty table).
- `ROOM_COUNT_EXCEEDED` → “This type’s room count is full. Raise the type’s room count first.”
- `ROOM_UNITS_EXCEED_COUNT` → “Cannot lower room count below the number of rooms. Rename rooms or wait for a delete path.”
- `ARCHIVE_BLOCKED` → “This type still has future sold or blocked inventory — it cannot be archived.”
- `ROOM_TYPE_CODE_EXISTS` → “An active room type already uses this code.”
- Duplicate room code → “Room code already exists.”
- No delete control (`queryByRole('button', { name: /delete/i })` null).
- No photos / amenities / virtual UI.

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

`use-unsaved-changes.ts`:

```ts
import { useEffect } from 'react';
import { useBlocker } from 'react-router';

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  const blocker = useBlocker(dirty);
  return blocker;
}
```

Inventory screen:

- Tabs via `<Link to="/inventory">` / `<Link to="/inventory/rooms">` (not buttons). Title Case: “Room Types”, “Rooms”.
- Types table: code (`translate="no"` `spellCheck={false}`), name, `roomCount`, occupancy `{maxAdults} / {maxOccupancy}`, physical room count from `listRooms` grouped by type (informational).
- Create/edit form labels: Code, Name, Room Count, Max Occupancy, Max Adults. `type="number"` `min={1}` on occupancy. `autocomplete="off"`. Client `crypto.randomUUID()` for `roomTypeId`. Submit enabled until request starts; then disable + “Saving…”. Errors `role="alert"`; focus first invalid field. Success `aria-live="polite"`.
- Archive is DELETE with modal; never immediate. Verb: “Archive Room Type”.
- Rooms: type picker from `listRoomTypes({ status: 'active' })`. Floor optional. Housekeeping status and `oooRanges` **read-only**. `content-visibility: auto` when `rooms.length > 50`. `font-variant-numeric: tabular-nums` on codes. No status dropdown. No assign-room.
- Degraded: screen-level error, keep the form, do not invent rows.
- Existing tokens only (`check:web-pms-colors`). No Tailwind, no prototype palette.

- [ ] **Step 4: Run tests + colors**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/InventoryScreen.test.tsx src/screens/InventoryRoute.test.tsx
pnpm check:web-pms-colors
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/InventoryScreen.tsx apps/web-pms/src/screens/InventoryScreen.test.tsx \
  apps/web-pms/src/screens/use-unsaved-changes.ts
git commit -m "$(cat <<'EOF'
feat(web-pms): add inventory room-type and rooms admin

EOF
)"
```

---

### Task 6: Rates SPA (plans + matrix + restrictions)

**Spec:** §6.3, §7.2, §14 (money integers), §20.15–20.16.

**Files:**
- Modify: `apps/web-pms/src/screens/RatesScreen.tsx`
- Create: `apps/web-pms/src/screens/RatesScreen.test.tsx`

**Interfaces:**
- Consumes: `listRoomTypes`, `listRatePlans`, `listRateDays`, `putRateDay`, `bulkUpdateRates`, `listRestrictionDays`, `putRestrictionDay`, `listDomainConfig` (ledger chrome only)
- Default matrix window: `propertyLocalToday(tz)` → +13 nights (14-day inclusive). URL query: `from`, `to`, `plan`.

- [ ] **Step 1: Write failing tests**

- Empty types → “Create a room type first.”
- Fill one cell (major `150.00`) → `putRateDay` with `amountMinor: 15000` (integer) and stored ledger currency from domain config; no float on the wire.
- Empty cell = no row (do not PUT `0` for blank).
- Bulk: date range + weekday checkboxes + amount → `bulkUpdateRates` cartesian product; window capped at 90 nights. Button “Fill Selected Days” / “Saving…”.
- GET rate-plans FAIL_CLOSED → block matrix (do not invent BAR client-side).
- BAR row: Archive control hidden (`ratePlanId === 'BAR'`).
- Restrictions tab: toggle stop-sell → `putRestrictionDay` **without** `ratePlanId`. Copy visible: “Stop sell hides the type from sale without changing inventory.”
- No yield / competitor / forecast tabs. No plan-scoped restriction column.
- Restrictions and matrix are separate tabs (do not write `restriction_day` from the matrix).

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx
```

- [ ] **Step 3: Implement**

Plans tab: list active; create/edit Code, Name, cancel penalty `<select>` (`none` | `first_night` | `nights` | `percent` | `full`), grace hours, nights/bps when needed, optional policy textarea. Archive with confirmation except BAR. No inclusions field.

Matrix: rows = active types; columns = dates in `[from, to]`. Plan selector. Cell = major input; blur/commit → `putRateDay`. Display `formatMinor` + `tabular-nums`. Ledger currency from `listDomainConfig` key `pms.money.currency_code` as read-only chrome (not a picker). Deep-link `?from=&to=&plan=`.

Bulk fill: selected types × matching dates; cap to 90-night window; `POST /rates/bulk` via `bulkUpdateRates`.

Restrictions: same date chrome. Per cell Min LOS, Max LOS, CTA, CTD, Stop sell. Writes omit `ratePlanId` (DO defaults `'*'`). Prefer cell-level edits; a range action is a confirmed loop of PUTs each with its own `stableKeyForOperation` key — no new bulk command.

Tabs via `<Link>`. `useUnsavedChanges` on dirty plan forms.

- [ ] **Step 4: Run**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/RatesScreen.test.tsx src/screens/RatesRoute.test.tsx
pnpm check:web-pms-colors
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/RatesScreen.tsx apps/web-pms/src/screens/RatesScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): add rates matrix, plans, and restrictions calendar

EOF
)"
```

---

### Task 7: Settings SPA (DOMAIN + charges + tax + FX link)

**Spec:** §8.3, §9, §10, §20.17.

**Files:**
- Modify: `apps/web-pms/src/screens/SettingsScreen.tsx`
- Create: `apps/web-pms/src/screens/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `listDomainConfig`, `putDomainConfig`, `updatePropertyDetails`, charge-code + tax methods
- Local `SYSTEM_CHARGE_CODES` copy (do **not** import `@hospai/do-runtime` from web-pms): `ROOM`, `PAYMENT`, `CANCEL`, `NO_SHOW`, `DISCOUNT`, `DAMAGE`, `FX_GAIN`, `FX_LOSS`, `CHARGEBACK_FEE`. Hide Archive when `code` is in that set. `MISC` is not system — Archive stays.

- [ ] **Step 1: Write failing tests**

- Toggle `pms.night_audit.auto_extend` → `putDomainConfig` with `{ key: 'pms.night_audit.auto_extend', value: false, reason }` (reason required).
- `pms.ops.auto_assign_rooms` checkbox present; copy “Stored for later. Check-in still requires an explicit room.”
- `pms.money.currency_code` has no enabled editor (read-only text; copy “Ledger currency is set at provision and cannot change here.”).
- `pms.money.currencies_list` textarea copy includes “Not the FX allowlist”.
- `pms.folio.breakfast_rule` copy “Display only — night audit does not auto-post from this.”
- FX panel: `<a href="/in-house">` or `<Link to="/in-house">Open in-house board</Link>`; **no** `fx-rates-editor`; no `/settings/fx`.
- SECRET / PRESENTATION keys absent (`pms.ui.date_format` not in document).
- `pms.ops.auto_assign_rule` absent.
- Charge codes: `ROOM` has no Archive button; copy “System code — cannot archive.” Restore still in scope for non-system archived rows.
- Tax: create sends `rate` as a **string**. Open rule offers Supersede, not in-place PATCH. Copy “Superseding closes this rule and opens a new one. Posted tax lines stay.”
- FAIL_CLOSED → “Property unreachable — cannot load settings.”
- `reason` placeholder “Why this change…”

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/client-core build
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx
```

- [ ] **Step 3: Implement Property / Charges / Tax tabs**

Group DOMAIN keys under headings (do not dump a raw table):

| Group | Keys |
|---|---|
| Property | PATCH name (`updatePropertyDetails`); `pms.time.time_zone` (`spellCheck={false}`) |
| Availability | `pms.availability.allow_overbooking`, `oversell_allowance` |
| Night audit | `audit_time`, `auto_no_show`, `auto_extend` |
| Booking | `same_day_bookings`, `same_day_cutoff`, `require_prepayment`, `booking_date_change` |
| Money | currency **read-only**; `payment_alloc`; `currencies_list` JSON textarea |
| Folio | `breakfast_rule`, `close_window_on_check_out`, `auto_capture_on_check_out`, `pms.folio.configs` |
| Reservations | `pending_hold_hours`, `inquiry_ttl_days`, `check_in_cleanliness`, `check_out_require_zero_balance` |
| Housekeeping | `pms.housekeeping.require_inspection` |
| Ops (unread) | `pms.ops.auto_assign_rooms` only |

Each PUT: operator `reason` required; `stableKeyForOperation` via client-core. Boolean = checkbox. Integer = `type="number"`. Enum = `<select>`. Time = `type="time"` or `HH:mm`. Submit “Save {label}”; “Saving…” in flight. `aria-live="polite"` “Saved.” `autocomplete="off"` on non-auth fields. `useUnsavedChanges` on dirty fields.

Timezone PUT is allowed; do not claim rates rematerialize.

Charge codes: `listChargeCodes({ status: 'all' })`. Create Code + Name. Edit name + tax group. Archive/restore via `setChargeCodeStatus` with confirmation.

Tax: `listTaxRules`. Create POST body; `rate` stays a decimal **string**. `ruleType` select: `PERCENTAGE` | `PER_PERSON_PER_NIGHT` | `FLAT`. Occupancy/tourist leftovers stay out.

FX Rates panel (Property tab): the spec copy + Link. Do not call `listFxRates` / create / supersede.

- [ ] **Step 4: Run**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/SettingsScreen.test.tsx src/screens/SettingsRoute.test.tsx
pnpm check:web-pms-colors
pnpm check:web-pms-me-gating
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-pms/src/screens/SettingsScreen.tsx apps/web-pms/src/screens/SettingsScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): add settings DOMAIN, charge-code, and tax admin

EOF
)"
```

---

### Task 8: Booking leftover 6 + Board leftover 3

**Spec:** §11, §12, §20.18–20.19.

**Files:**
- Modify: `apps/web-pms/src/screens/BookingScreen.tsx` + `BookingScreen.test.tsx`
- Modify: `apps/web-pms/src/screens/BoardScreen.tsx` + `BoardScreen.test.tsx`

- [ ] **Step 1: Write failing tests**

Booking (`BookingScreen.test.tsx`):

- Mock `listRoomTypes` returning `{ roomTypes: [{ roomTypeId: 'rt_x', code: 'KNG', name: 'King Deluxe', ... }] }` with availability selectable `['rt_x']`. Radio label contains `King Deluxe` and `KNG` (`translate="no"` on code).
- `listRoomTypes` rejects / FAIL_CLOSED: still list `rt_x` (raw id); Confirm still gated on `quoteAriVersion` (do not block).

Board:

- Change the timezone mock to a mutable holder so existing tests keep `'UTC'`:

```ts
const tzState: { current: string | null } = { current: 'UTC' };
vi.mock('../shell/PropertyTimeZone.js', () => ({
  usePropertyTimeZone: () => tzState.current,
}));
```

- New test: `tzState.current = 'America/Los_Angeles'`; `vi.useFakeTimers({ now: Date.parse('2026-08-14T06:00:00.000Z') })` (UTC date `2026-08-14`, Pacific `2026-08-13`). Arrivals query uses `2026-08-13`. URL gains `?date=2026-08-13` via replace.
- `?date=2026-09-14` still wins (no timezone override).
- In-house does **not** wait on date (`getInHouse` called while arrivals would still be gated).
- Source: `todayUtc` is gone (`grep` the file in the test via a comment assertion — or simply stop exporting/using it).

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx src/screens/BoardScreen.test.tsx
```

- [ ] **Step 3: Implement labels**

After (or in parallel with) availability, `api.listRoomTypes(propertyId, { status: 'active' })`. Label = `{name} ({code})`. Fallback: keep `roomTypeId`. Confirm still requires `quoteAriVersion`. Add `listRoomTypes` to the existing `api` mock in `BookingScreen.test.tsx` (default resolved empty/matching fixture).

- [ ] **Step 4: Implement Board date seed**

Lock:

1. Valid `dateParam` wins.
2. Else `date: string | null` starts `null`. When `usePropertyTimeZone()` yields a zone, set `propertyLocalToday(tz)` **once** (effect; do not overwrite a later user edit). Track with a `seededRef`.
3. Arrivals / departures `enabled: date != null`. In-house unchanged (`enabled: true`, no date).
4. After seeding, `navigate({ search: \`?date=${seeded}\` }, { replace: true })` so refresh stays consistent. Do not loop if `dateParam` already matches.
5. **Delete** `todayUtc`. Severity already uses `propertyLocalToday`.
6. While `date == null` and timezone pending (arrivals/departures): “Loading…” (`…` not `...`). Do not fetch UTC-today.

Update existing Board tests if they assumed a date on first paint — `waitFor` the arrivals mock. UTC mock keeps `propertyLocalToday('UTC') ===` previous `todayUtc()` after the effect.

- [ ] **Step 5: Run**

```bash
pnpm --filter @hospai/web-pms exec vitest run src/screens/BookingScreen.test.tsx src/screens/BoardScreen.test.tsx
```

Expected: exit 0. `rg todayUtc apps/web-pms/src/screens/BoardScreen.tsx` is empty.

- [ ] **Step 6: Commit**

```bash
git add apps/web-pms/src/screens/BookingScreen.tsx apps/web-pms/src/screens/BookingScreen.test.tsx \
  apps/web-pms/src/screens/BoardScreen.tsx apps/web-pms/src/screens/BoardScreen.test.tsx
git commit -m "$(cat <<'EOF'
feat(web-pms): label booking types and seed board from property-local today

EOF
)"
```

---

### Task 9: Sibling spec pointers

**Spec:** §17 pointers, Amends line. Docs only. No code.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-booking-wizard-design.md` leftovers **3** and **6**
- Modify: `docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md` leftover **4**
- Modify: `docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md` leftover **3**
- Modify: `docs/superpowers/specs/2026-08-06-rule3-config-surface-design.md` leftovers block
- Modify: `docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md` (end of leftovers / HTTP section)
- Modify: `docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md` leftover **2**
- Optional one sentence in `ARCHITECTURE.md` Phase 1 / §16.3 that inventory / rates / settings now have a live SPA (do not rewrite §16.5).

Exact sentences (one each; do not close leftovers that this chunk did not close):

- Booking leftover 3: **Closed 2026-08-13** by [property setup SPA](./2026-08-13-property-setup-spa-design.md) (`BoardScreen` seeds `propertyLocalToday`; `todayUtc` removed).
- Booking leftover 6: **Closed 2026-08-13** by [property setup SPA](./2026-08-13-property-setup-spa-design.md) (`GET /room-types` labels `{name} ({code)}`; FAIL_CLOSED falls back to id).
- Night-audit leftover 4: Settings can display/edit `pms.night_audit.auto_extend` ([property setup SPA](./2026-08-13-property-setup-spa-design.md)); the 7-step machine still does not read it.
- Lifecycle leftover 3: `pms.ops.auto_assign_rooms` reclassified DOMAIN + `consumersExempt` and is editable on Settings ([property setup SPA](./2026-08-13-property-setup-spa-design.md)); check-in stays explicit — no consumer.
- Rule-3: `GET /v1/properties/:pid/config/domain` added by [property setup SPA](./2026-08-13-property-setup-spa-design.md) so DOMAIN PUT can round-trip. `rematerializesRates` remains a dead flag.
- Rate-plans: `GET /rate-days` added by [property setup SPA](./2026-08-13-property-setup-spa-design.md). Plan-scoped `rate_plan_id ≠ '*'` restrictions stay out.
- Multi-currency leftover 2: `pms.money.currencies_list` may appear on Settings; it is still not the FX allowlist ([property setup SPA](./2026-08-13-property-setup-spa-design.md)).

- [ ] **Step 1: Edit the six specs (+ optional ARCHITECTURE sentence)**

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-booking-wizard-design.md \
  docs/superpowers/specs/2026-08-12-night-audit-e2e-design.md \
  docs/superpowers/specs/2026-08-12-reservations-lifecycle-completion-design.md \
  docs/superpowers/specs/2026-08-06-rule3-config-surface-design.md \
  docs/superpowers/specs/2026-08-05-rate-plans-vertical-design.md \
  docs/superpowers/specs/2026-08-13-multi-currency-folio-design.md \
  ARCHITECTURE.md
git commit -m "$(cat <<'EOF'
docs: point leftover specs at the property setup SPA

EOF
)"
```

If `ARCHITECTURE.md` is unchanged, omit it from `git add`.

---

### Task 10: Full CI (ci.yml sequence)

**Spec:** §2 invariant 7, §20.1–20.4, §21 heads. Final verification task — not a subset.

- [ ] **Step 1: Hygiene — `generate:ddl` must be a no-op**

```bash
pnpm generate:ddl
git diff --exit-code -- migrations/ packages/do-runtime/src/property-migrations.ts scripts/property-ddl.mjs
```

Expected: exit 0 (empty diff). If it writes files, **revert them** — this chunk does not migrate. Do not commit DDL.

Also:

```bash
git diff --exit-code -- scripts/class-denylist.mjs
```

`PROPERTY_SCHEMA_HEAD` stays 24 (`packages/do-runtime` migrate test). `NIGHT_AUDIT_STEPS.length === 7`. `PROPERTY_PURGE_INVENTORY_TABLES` list unchanged (still includes `fx_rate` / `payment_event` / `payment_dispute`; still no new table).

- [ ] **Step 2: `checks` job — copy `.github/workflows/ci.yml` in order**

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

Pins after build: `AUDIT_WRITER_COMMAND_IDS.size === 49`; `COMMAND_CATALOG.length === 74`; `PLATFORM_GAPS` `[]`; `NIGHT_AUDIT_STEPS.length === 7`; `SYSTEM_CHARGE_CODES` length 9; `PROPERTY_SCHEMA_HEAD === 24`; `[110]=post_folio_fx_adjustment`; `[111]=get_room_types`; `[112]=get_rate_days`; `[113]=get_restriction_days`; `[114]=get_domain_config`.

- [ ] **Step 3: pms-core vitest shards (no `--` before `--shard`)**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/4
pnpm --filter @hospai/pms-core exec vitest run --shard=2/4
pnpm --filter @hospai/pms-core exec vitest run --shard=3/4
pnpm --filter @hospai/pms-core exec vitest run --shard=4/4
```

Expected: all four exit 0.

If typecheck fails, fix in a **new** commit (`fix(types): …`) — never mix typecheck fixes into docs.

---

### Task 11: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–11 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [ ] **Step 1: Mark checkboxes**

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-property-setup-spa.md
git commit -m "$(cat <<'EOF'
docs: tick property setup SPA plan checkboxes after merge

EOF
)"
```

If CI was already green and this file is unchanged, skip — but the intent is this commit is last.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Reclass `auto_assign_rooms` DOMAIN + `consumersExempt`; siblings stay OPERATIONAL | 1 |
| Routes 111–114 append-only; `[110]` unmoved; no catalog ids; FAIL_CLOSED | 2 |
| `GET /room-types` + staff 200 | 2 + 5 |
| Widen `GET /rate-plans` cancel fields | 2 |
| `GET /rate-days` 90-night cap; missing cells omitted | 2 + 6 |
| `GET /restriction-days` type-wide only | 2 + 6 |
| `GET /config/domain` staff 403; currency/tz `stored` after provision; SECRET/PRESENTATION absent | 2 + 7 |
| PUT `auto_assign_rooms` succeeds; no check-in consumer | 2 |
| Kill-switch 402/503 pair | 2 |
| client-core methods + `stableKeyForOperation` | 3 |
| Nav 42/44/70 + StaffRoute-shaped gates | 4 |
| Inventory types + rooms; no delete; occupancy; unsaved guard | 5 |
| Rates matrix integers + bulk; BAR not archivable; restrictions separate | 6 |
| Settings DOMAIN groups; currency read-only; FX **link**; charges + tax supersede | 7 |
| Booking leftover 6 labels | 8 |
| Board leftover 3 property-local today | 8 |
| Sibling pointers | 9 |
| Schema head 24; ddl no-op; catalog 74; writers 49; CI | 10 |
| Plan checkbox tick | 11 |
| Virtual types / OrgDO plans / `rooms.delete` / tape / `ui-kit` / PCI / consumers | not implemented (spec §19) |
