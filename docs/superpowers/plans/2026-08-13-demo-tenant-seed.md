# Demo Tenant Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Do **not** start implementing until the parent reviewer approves this plan. Do not commit this file in the same turn it is written.

**Goal:** One local command (`pnpm demo:seed`) provisions a named demo hotel so the 8-minute investor path opens on an occupied tape — without curl, without new DO tables, and without changing provision HTTP.

**Architecture:** Node script `scripts/demo-seed.mjs` calls existing `POST /v1/orgs` + `POST /v1/orgs/:id/properties` + name `PATCH`, then `POST /v1/admin/demo-seed` (`scope: 'dev'`, audit index **127**). The Worker orchestrator applies the spec §5 fixture through existing OrgDO / PropertyDO `try*` writers. The only new SQL is `INSERT OR IGNORE` into existing `availability_day` for nights before `__meta.business_date` (unsafe-local). No catalog command. No SPA changes.

**Tech Stack:** Cloudflare Durable Objects (OrgDO + PropertyDO), Platform D1 registry, `@hospai/contracts`, vitest + cloudflare:test, Node ESM root script (`fetch`).

**Spec:** `docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md` (Approved). Spec commit: `7466037`.

## Global Constraints

- Route audit **append-only**. `[126] = get_guest_stays` does not move. `[0] post_orgs` and `[2] post_org_properties` bodies / status codes do not change. New route is **`[127] post_demo_seed`** at the **END** of both `V1_HTTP_ROUTE_AUDIT` and `V1_ROUTES` (identical order). `check:permissions` zips the two arrays — never append one without the other.
- Task 1 must **not** touch `V1_ROUTES` / `V1_HTTP_ROUTE_AUDIT` (`check:permissions` stays green). Task 2 appends **127** on both sides together.
- `COMMAND_CATALOG.length` stays **77**. Do **not** add `demo.seed`. `AUDIT_WRITER_COMMAND_IDS.size` stays **52**. `PLATFORM_GAPS` stays `[]`.
- **No schema migration.** `PROPERTY_SCHEMA_HEAD` stays **25**. `ORG_SCHEMA_HEAD` stays **7**. `pnpm generate:ddl` is a no-op diff. Past nights are `INSERT OR IGNORE` into the existing freeze-gate `availability_day` table.
- `PROPERTY_PURGE_INVENTORY_TABLES` unchanged. No new `export class`. **`CLASS_DENYLIST` is not edited.** `NIGHT_AUDIT_STEPS.length` stays **7**.
- `runIdempotent` stays sync-only. Guest vault seal stays outside `transactionSync`. PropertyDO does **not** call OrgDO. Dispatcher / `runDemoSeed` creates guests via OrgDO RPC, then stays via PropertyDO RPC.
- Money is integers (`amountMinor` + `currency: 'USD'`). No folio line posts. No `demo.seeded` event — existing writers emit their own events.
- `POST /v1/admin/demo-seed` is `scope: 'dev'`. Without `isDevActorAllowed` → **404** `{ error: 'not_found' }` (same as `[1] post_migration_sweep`). Handler still `requirePermission(..., 'property:provision')` after parsing the body.
- Seed dates: `T` = property-local **wall-clock** date from stored TZ via `enumerateHorizonDates(tz, new Date(), 1)[0]`. **Not** `__meta.business_date`. Do not run night audit. Do not add `VITE_DEMO_DATE`.
- Wire ids for the meeting tenant: `org_demo` / `prop_demo`. Names: `Harborlight Hospitality` / `The Meridian Seattle`. Tests provision a **random** org/property and pass those ids into the seed route.
- Idempotency keys: `demo-seed:v1:{kind}:{id}`. Fingerprints are the existing command fingerprints.
- No SPA / `client-core` / `ui-kit` / Tailwind. Tape already shows `displayName` via `GuestNameLink`.
- **Rebuild:** after `@hospai/contracts` source change, `pnpm --filter @hospai/contracts build` **before** `check:permissions` / pms-core tests.
- Unsharded `pnpm --filter @hospai/pms-core test` segfaults — use `vitest run <file>` or `vitest run --shard=N/4` with **no** `--` before `--shard`.
- Living plan checkboxes: tick `- [x]` on merge only (Task 6). Do not backfill historical plans.
- No either/or forks. Spec §13 locks stand.
- Scope-out (do not implement): P0-2 folio first-paint / shift auto-open, P0-3 chrome + skin, P0-4 Clerk / `/sign-in`, P0-5 speaker script, UI beyond seed data, production deploy, provision HTTP shape changes, new DO tables, new catalog commands, virtual types, derived/OrgDO plans, `rooms.delete`, `ui-kit`, city ledger / invoices / auto-transfer / recurring / partial refunds, PCI, second property, night-audit-in-seed, org purge wipe, `--wipe` `rm -rf`.

## File map

| File | Role |
|---|---|
| `apps/pms-core/src/demo-seed-fixture.ts` | Spec §4–§5 constants + `buildDemoSeedPlan(today)` (Task 1) |
| `apps/pms-core/src/property-do.ts` | `ensurePastAvailabilityDays` behind `assertUnsafeLocal` (Task 1) |
| `apps/pms-core/test/demo-seed-horizon.spec.ts` | Past-day helper only (Task 1) |
| `packages/contracts/src/v1-http-routes.ts` | Append `[127] post_demo_seed` `scope: 'dev'` (Task 2) |
| `packages/contracts/src/register.test.ts` | `[126]` unmoved; `[127]`; catalog **77**; no `demo.seed` (Task 2) |
| `apps/pms-core/src/demo-seed.ts` | `runDemoSeed` orchestrator (Task 2) |
| `apps/pms-core/src/v1-dispatch.ts` | `handlePostDemoSeed`; append `V1_ROUTES` (Task 2) |
| `apps/pms-core/test/demo-seed.spec.ts` | Spec §12.4–12.12 (Task 2) |
| `scripts/demo-seed.mjs` | Operator command (Task 3) |
| `package.json` | `"demo:seed": "node scripts/demo-seed.mjs"` (Task 3) |
| `README.md` | Step 3 + wipe + developer curls (Task 4) |
| `DEMO-READY.md` | Tick P0-1 checkboxes (Task 4) |

## Test file split (spec §12 → file)

| Spec # | File | Task |
|---|---|---|
| 1–2 route / catalog pins | `register.test.ts` | 2 |
| 3 schema / purge / denylist | Task 5 CI + existing `migrate.test.ts` heads | 5 |
| 4–5 404 / 403 / 400 gates | `demo-seed.spec.ts` | 2 |
| 6–12 hotel fixture + heal + walk-in + idempotent re-run | `demo-seed.spec.ts` | 2 |
| Past-day `INSERT OR IGNORE` | `demo-seed-horizon.spec.ts` | 1 |
| 13 ddl no-op | Task 5 `pnpm generate:ddl` | 5 |
| 14 script Worker-down | `scripts/demo-seed.mjs` manual + Task 3 smoke | 3 |
| 15 checks | Task 5 | 5 |

---

### Task 1: Fixture + past-night `availability_day` helper (own commit, no HTTP routes)

**Spec:** §5.1–§5.6, §2.7, §2.18. Keep `check:permissions` green.

**Files:**
- Create: `apps/pms-core/src/demo-seed-fixture.ts`
- Modify: `apps/pms-core/src/property-do.ts` — add `ensurePastAvailabilityDays` next to other unsafe-local helpers (~1306)
- Create: `apps/pms-core/test/demo-seed-horizon.spec.ts`
- Test: `pnpm --filter @hospai/pms-core exec vitest run test/demo-seed-horizon.spec.ts`

**Interfaces:**

```ts
// demo-seed-fixture.ts
export const DEMO_ORG_ID = 'org_demo';
export const DEMO_ORG_NAME = 'Harborlight Hospitality';
export const DEMO_PROPERTY_ID = 'prop_demo';
export const DEMO_PROPERTY_NAME = 'The Meridian Seattle';
export const DEMO_TIME_ZONE = 'America/Los_Angeles';
export const DEMO_CURRENCY = 'USD';

export const DEMO_RATE_AMOUNTS = {
  rt_king: 28900,
  rt_twin: 21900,
  rt_suite: 42900,
} as const;

export type DemoRoomType = {
  roomTypeId: 'rt_king' | 'rt_twin' | 'rt_suite';
  code: string;
  name: string;
  roomCount: number;
  maxOccupancy: number;
  maxAdults: number;
};

export type DemoRoom = { roomId: string; code: string; roomTypeId: DemoRoomType['roomTypeId']; floor: string };

export type DemoGuest = { guestId: string; displayName: string; email: string };

export type DemoStay = {
  reservationId: string;
  guestId: string;
  roomTypeId: DemoRoomType['roomTypeId'];
  roomId: string | null; // null = Amira
  arrivalOffset: number; // days from T
  departureOffset: number;
  checkIn: boolean;
};

export const DEMO_ROOM_TYPES: readonly DemoRoomType[]; // spec §5.1
export const DEMO_ROOMS: readonly DemoRoom[];         // spec §5.2 — 20 rows
export const DEMO_GUESTS: readonly DemoGuest[];       // spec §5.4 — 14 rows
export const DEMO_STAYS: readonly DemoStay[];         // spec §5.5 — 14 rows

export function addIsoDate(iso: string, deltaDays: number): string;
// UTC Y-M-D arithmetic (copy the algorithm in packages/client-core/src/booking.ts addCalendarDays).
// Do not import client-core from pms-core.

export function buildDemoSeedPlan(today: string): {
  today: string;
  rateFrom: string;      // T-2
  rateTo: string;        // T+13
  backfillFrom: string;  // T-2
  backfillToExclusive: string; // T
  stays: Array<DemoStay & { arrivalDate: string; departureDate: string }>;
};

export function demoIdempotencyKey(kind: string, id: string): string;
// `demo-seed:v1:${kind}:${id}`
```

PropertyDO (public RPC — tests + orchestrator):

```ts
async ensurePastAvailabilityDays(fromDate: string, toExclusive: string): Promise<{ inserted: number }>
```

- First line: `this.assertUnsafeLocal('ensurePastAvailabilityDays')`.
- `fromDate` / `toExclusive` must match `/^\d{4}-\d{2}-\d{2}$/` and `fromDate < toExclusive`; else throw `Error('invalid_date_range')`.
- For each **active** `room_type` and each stay date in `[fromDate, toExclusive)`:

```sql
INSERT OR IGNORE INTO availability_day
  (room_type_id, stay_date, physical, blocked, held, sold, oversell, version)
VALUES (?, ?, ?, 0, 0, 0, 0, 1)
```

`physical` = that type’s `room_count`. Do **not** bump `__meta.business_date`. Do **not** emit `availability.changed`. Do **not** bump ARI. Return `{ inserted }` = rows actually inserted (`changes()` or count-before/after).

**Forbidden this commit:** `V1_ROUTES`, `V1_HTTP_ROUTE_AUDIT`, `v1-dispatch.ts`, `scripts/demo-seed.mjs`, any SPA, `CLASS_DENYLIST`, `INSERT INTO reservation`, night audit, new `export class`.

- [x] **Step 1: Write the failing horizon test**

Copy the local `postOrg` / `postProperty` / `postRoomType` helpers from `apps/pms-core/test/rate-plans-routes.spec.ts` (~26–70). Use `crypto.randomUUID()` org/property ids. Actor `user_owner`. Timezone `America/Los_Angeles`, currency `USD`.

```ts
it('ensurePastAvailabilityDays inserts missing pre-horizon nights and is idempotent', async () => {
  const { propertyId, stub } = await provisionHotel('user_owner');
  const tz = (await stub /* or GET /v1/properties */) ;
  // T = property-local today. After provision, GET property and compute via
  // the same Intl en-CA parts as apps/web-pms/src/status/property-local-today.ts
  // OR read business_date (fresh provision ⇒ T === business_date).
  const businessDate = await stub.readBusinessDate();
  expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const tMinus2 = addIsoDate(businessDate!, -2);
  const tMinus1 = addIsoDate(businessDate!, -1);

  const first = await stub.ensurePastAvailabilityDays(tMinus2, businessDate!);
  expect(first.inserted).toBeGreaterThan(0);

  const sql = async (date: string) => {
    // GET availability for that single date via HTTP:
    // GET /v1/properties/:pid/availability?fromDate=&toDate=&roomTypeId=rt_king
    // Before backfill, fromDate < business_date may 400 or return empty —
    // assert via stub SQL is allowed only through a tiny test helper:
    // prefer GET …/availability?fromDate=tMinus2&toDate=tMinus2
  };
  // After backfill, availability GET for tMinus2 on rt_king returns physical 10
  // (postRoomType in the rate-plans helper uses rt_king / roomCount 10).

  const second = await stub.ensurePastAvailabilityDays(tMinus2, businessDate!);
  expect(second.inserted).toBe(0);
});
```

`provisionHotel` in this file must create **one** room type `rt_king` / `KNG` / `King` / `roomCount: 10` (README curl shape) so the helper has a type to backfill. Do **not** call `POST /v1/admin/demo-seed` this task.

Also pin the fixture file:

```ts
import { DEMO_ROOMS, DEMO_GUESTS, DEMO_STAYS, DEMO_ROOM_TYPES, buildDemoSeedPlan } from '../src/demo-seed-fixture';

it('fixture tables match spec §5 counts', () => {
  expect(DEMO_ROOM_TYPES).toHaveLength(3);
  expect(DEMO_ROOMS).toHaveLength(20);
  expect(DEMO_GUESTS).toHaveLength(14);
  expect(DEMO_STAYS).toHaveLength(14);
  expect(DEMO_STAYS.filter((s) => s.checkIn)).toHaveLength(8);
  expect(DEMO_STAYS.filter((s) => s.roomId === null)).toHaveLength(1);
  expect(DEMO_STAYS.find((s) => s.reservationId === 'res_demo_arr_04')?.guestId).toBe('gst_amira_hassan');
  const plan = buildDemoSeedPlan('2026-08-13');
  expect(plan.rateFrom).toBe('2026-08-11');
  expect(plan.rateTo).toBe('2026-08-26');
  expect(plan.stays.find((s) => s.reservationId === 'res_demo_dep_01')?.departureDate).toBe('2026-08-13');
});
```

Copy every row from spec §5.1–§5.5 into `DEMO_*` arrays. Do not invent extra guests.

- [x] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/demo-seed-horizon.spec.ts
```

Expected: FAIL (module / method missing).

- [x] **Step 3: Implement fixture + helper**

`demo-seed-fixture.ts`: literal tables from spec §5. `addIsoDate` as specified. `buildDemoSeedPlan` maps offsets onto `today`.

`ensurePastAvailabilityDays`: `assertUnsafeLocal`, date check, loop active types × dates, `INSERT OR IGNORE`, return insert count. Use `enumerateFromDate` from `@hospai/pms-inventory` **or** a local `addIsoDate` loop — do not change horizon reconcile.

- [x] **Step 4: Re-run the test**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/demo-seed-horizon.spec.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/pms-core/src/demo-seed-fixture.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/demo-seed-horizon.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): demo seed fixture and past-night availability backfill

EOF
)"
```

---

### Task 2: Route 127 + orchestrator + hotel tests

**Spec:** §3.3, §6, §12.1–12.2, §12.4–12.12.

**Files:**
- Modify: `packages/contracts/src/v1-http-routes.ts` — append after `[126] get_guest_stays` (~746)
- Modify: `packages/contracts/src/register.test.ts` — extend the existing guests-route pin test (~606)
- Create: `apps/pms-core/src/demo-seed.ts` — `runDemoSeed`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — `handlePostDemoSeed`; append one `V1_ROUTES` entry **after** `handleGetGuestStays` (~7105)
- Create: `apps/pms-core/test/demo-seed.spec.ts`
- Test: contracts vitest + `demo-seed.spec.ts`

**Interfaces:**

```ts
// demo-seed.ts
export type DemoSeedResult = {
  ok: true;
  orgId: string;
  propertyId: string;
  propertyName: string;
  timeZone: string;
  today: string;
  alreadySeeded: boolean;
  rooms: number;
  roomTypes: Array<{ roomTypeId: string; code: string; name: string; roomCount: number }>;
  board: { inHouse: number; arrivals: number; departures: number; unassignedArrivals: number };
};

export async function runDemoSeed(input: {
  env: PmsEnv;
  actor: { kind: 'user'; userId: string };
  orgId: string;
  propertyId: string;
  propertyName: string;
  timeZone: string;
}): Promise<DemoSeedResult>;
```

Orchestrator order (spec §6) — **exact**:

1. `today = enumerateHorizonDates(timeZone, new Date(), 1)[0]` (import from `@hospai/pms-inventory`, same as PropertyDO).
2. `plan = buildDemoSeedPlan(today)`.
3. `let mutated = false`.
4. For each `DEMO_ROOM_TYPES`: `tryAddRoomType`. On exists / `room_type_already_exists` (or the existing wire string from `RoomTypeExistsError`): `tryUpdateRoomType` with name/code/roomCount/occupancy if they differ. Stable key `demo-seed:v1:rt:{roomTypeId}`. Fingerprint = existing add/update fingerprint (`fingerprintPayload` from `@hospai/contracts`).
5. For each `DEMO_ROOMS`: `tryCreateRoom`. On `room_code_exists` / id exists: skip (do **not** change HK status). Key `demo-seed:v1:room:{roomId}`.
6. `stub.ensurePastAvailabilityDays(plan.backfillFrom, plan.backfillToExclusive)`.
7. For each type × each date in `[rateFrom, rateTo]` inclusive: `tryUpsertRateDay` `{ roomTypeId, ratePlanId: 'BAR', stayDate, amountMinor: DEMO_RATE_AMOUNTS[type], currency: 'USD' }`. Key `demo-seed:v1:rate:{roomTypeId}:{stayDate}`. Do **not** `POST` a second BAR plan.
8. For each guest: OrgDO `tryCreateGuest(actor, propertyId, { guestId, profile: { displayName, email } }, idem)`. On `GUEST_EXISTS`: skip (do not overwrite). Key `demo-seed:v1:guest:{guestId}`.
9. `const { ariVersion } = await stub.readAvailabilityRange(plan.rateFrom, plan.rateTo)` (DO, not KV).
10. For each stay: `readReservation(id)` if present → skip create; else `tryCreateReservation` with `status: 'confirmed'`, `quoteAriVersion: ariVersion`, dates from the plan, `guestRef: guestId`. Then if `roomId` and current `room_id` is null: `tryAssignRoom`. Then if `checkIn` and status is `confirmed`: `tryCheckIn` (no `overrideCleanliness`). If already `checked_in`: skip. Keys `demo-seed:v1:res:{id}`, `demo-seed:v1:assign:{id}`, `demo-seed:v1:checkin:{id}`.
11. Re-read tape/summary predicates via existing PropertyDO reads (`readFrontOfficeSummary(today)` if present, else SQL-equivalent already used by `[118]`). Fill `board`. `rooms` = 20 (or `listRooms().length` after seed). `roomTypes` from `listRoomTypes('active')` filtered to the three demo ids (include healed names).
12. `alreadySeeded = !mutated` where `mutated` is true if any create/update/check-in actually applied (not an exists-skip).

`fingerprintPayload` + `{ key, fingerprint }` for every `try*`. Actor is the request user.

**Handler `handlePostDemoSeed`:**

```
if (!isDevActorAllowed(ctx.env)) return json({ error: 'not_found' }, 404); // belt
body = await ctx.request.json()
if !body.orgId || !body.propertyId → 400 { error: 'invalid_body' }
validateTenantId both; catch → 400 invalid_tenant_id
property = await getProperty(env, propertyId); if !property → 404 { error: 'not_found' }
if property.orgId !== orgId → 400 { error: 'org_property_mismatch' }
denied = await requirePermission(env, orgId, propertyId, actor.userId, 'property:provision')
if denied return denied
resolved = await resolvePropertyFromRegistry(...)
orgStub = resolveOrgStub(...)
return json(await runDemoSeed({ env, actor: { kind:'user', userId }, orgId, propertyId, propertyName: property.name, timeZone: property.timeZone }), 200)
```

On OrgDO / PropertyDO transport failure → existing 503 fail-closed JSON (copy `isPropertyDoTransportFailure` / `isOrgDoTransportFailure` pattern from other handlers). Do not queue.

**V1_HTTP_ROUTE_AUDIT append:**

```ts
{ id: 'post_demo_seed', scope: 'dev' },
```

**V1_ROUTES append (last entry, after get_guest_stays):**

```ts
{
  scope: 'dev',
  method: 'POST',
  pattern: /^\/v1\/admin\/demo-seed$/,
  handler: handlePostDemoSeed,
},
```

**Forbidden this commit:** catalog ids, schema, SPA, `client-core`, README (Task 4), starting the Vite app, night audit, folio posts, `CLASS_DENYLIST`.

- [x] **Step 1: Write the failing register + HTTP tests**

In `register.test.ts`, **inside the existing test** that already pins `[124]`–`[126]` and `COMMAND_CATALOG` length 77 (~606), append:

```ts
expect(V1_HTTP_ROUTE_AUDIT[126]?.id).toBe('get_guest_stays');
expect(V1_HTTP_ROUTE_AUDIT[127]?.id).toBe('post_demo_seed');
expect(V1_HTTP_ROUTE_AUDIT[127]).toMatchObject({ scope: 'dev' });
expect('commandId' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
expect('permission' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
expect('entitlement' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
expect('degradedRead' in (V1_HTTP_ROUTE_AUDIT[127] ?? {})).toBe(false);
expect(COMMAND_CATALOG.find((c) => c.id === 'demo.seed')).toBeUndefined();
```

Keep `expect(COMMAND_CATALOG).toHaveLength(77)` and `AUDIT_WRITER_COMMAND_IDS.size === 52` unchanged.

In `demo-seed.spec.ts` (new), helpers: `postOrg` / `postProperty` / `patchPropertyName` / `postRoomType` / `postDemoSeed` / `devHeaders(actor)`. Provision **random** ids. Default actor `user_owner`.

Cover spec §12.4–12.12:

4. `gatedEnv = { ...env, HOSPAI_ALLOW_DEV_ACTOR: undefined }` (see `migration-sweep.spec.ts` ~159). `POST /v1/admin/demo-seed` with `x-dev-actor: user_owner` → **404** `{ error: 'not_found' }`.
5. Flags on. Provision as `user_owner`. `org.ensureMember(staff, 'staff')` (staff lacks `property:provision`). Seed as staff → **403** `{ error: 'forbidden', permission: 'property:provision' }`. Seed `{ orgId, propertyId: 'prop_missing' }` → **404**. Seed `{ orgId: 'org_other', propertyId }` where property belongs to the provisioned org → **400** `{ error: 'org_property_mismatch' }`. Empty body → **400** `invalid_body`.
6. Provision random org/property (`America/Los_Angeles`, `USD`). `POST /v1/admin/demo-seed` as owner. `GET /room-types` names include `King Deluxe`, `Twin`, `Suite`. `GET /rooms` codes are the 20 human codes (sort and compare).
7. `today` from the seed JSON. `GET /rate-days?fromDate=today&toDate=today+6&ratePlanId=BAR` — every type × night has `amountMinor` 28900 / 21900 / 42900 (integer). No float.
8. `GET /front-desk/summary?date=today`: `inHouse === 8`, `arrivals === 4`, `departuresDue === 3`. `GET /front-desk/arrivals?date=today` includes `gst_amira_hassan` with `roomId` null and three assigned arrivals. `GET /front-desk/in-house` length 8.
9. `GET /front-desk/tape?fromDate=today&toDate=today+6`: unassigned block for Amira’s reservation; assigned blocks on 101–107 / 201–204 / 301–302. Tape JSON has **no** `displayName`. `POST /guests/batch` `{ guestRefs: [...] }` returns `Amira Hassan` etc. `GET /guests/gst_amira_hassan` profile.displayName is `Amira Hassan`.
10. Second `POST /v1/admin/demo-seed` → 200 `alreadySeeded: true`. Create one extra confirmed reservation (free King Deluxe night, new guest) between calls; third seed still 200; extra reservation `GET` still 200.
11. Fresh property named `Demo Hotel`. `POST /room-types` `{ roomTypeId: 'rt_king', code: 'KNG', name: 'King', roomCount: 10, ... }`. `PATCH` name to `The Meridian Seattle` (script step 4). Seed. Type `rt_king` name `King Deluxe`, code `KDX`. `GET` property name `The Meridian Seattle`.
12. After seed, `GET /availability?fromDate=today&toDate=today+1` (no roomTypeId, DO branch). Pick King Deluxe with `free >= 1`. `POST /guests` + `POST /reservations` confirmed walk-in → 201.

Use `addIsoDate` from the fixture (or a local copy) for `today+6`. Fixture dates: `check:pms-core-test-dates` — do not hardcode `2026-08-13` as a load-bearing stay date in HTTP tests; use `body.today` from the seed response.

- [x] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/demo-seed.spec.ts
```

Expected: FAIL — `[127]` undefined; route 404 for allowed actor.

- [x] **Step 3: Implement audit + handler + orchestrator**

Append audit + `V1_ROUTES` together. Implement `runDemoSeed` as specified. Import `GUEST_EXISTS` / `fingerprintPayload` / `validateTenantId` from `@hospai/contracts`. Import `getProperty` / `resolvePropertyFromRegistry` / `requirePermission` / `isDevActorAllowed` from existing pms-core modules.

`tryAddRoomType` existence: catch / inspect `ok: false` error string. Do not raw-`INSERT` reservations.

Re-read `ariVersion` before **each** reservation create if a previous create bumped it (or read once per stay). A stale `quoteAriVersion` → 409 `no_availability`. Simplest: call `readAvailabilityRange` immediately before each `tryCreateReservation`.

- [x] **Step 4: Build contracts and re-run**

```bash
pnpm --filter @hospai/contracts build
pnpm check:permissions
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/pms-core exec vitest run test/demo-seed.spec.ts test/demo-seed-horizon.spec.ts
```

Expected: all PASS. `check:permissions` prints `128 HTTP routes` (127 + 1) or whatever the new length is (previous 127 entries, now 128).

- [x] **Step 5: Commit**

```bash
git add packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/register.test.ts \
  apps/pms-core/src/demo-seed.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/demo-seed.spec.ts
git commit -m "$(cat <<'EOF'
feat(pms-core): local-only demo hotel seed route

EOF
)"
```

---

### Task 3: `pnpm demo:seed` Node script

**Spec:** §3.2, §4, §7, §12.14.

**Files:**
- Create: `scripts/demo-seed.mjs`
- Modify: `package.json` — add `"demo:seed": "node scripts/demo-seed.mjs"` next to the other root scripts
- Test: manual / process smoke in this task (no Worker in CI)

**Interfaces (CLI):**

```
node scripts/demo-seed.mjs [--base-url http://127.0.0.1:8787] [--actor user_owner]
```

Parse args with a 20-line loop (no extra dependency). Defaults: `http://127.0.0.1:8787`, `user_owner`.

Constants **must match** `demo-seed-fixture.ts` / spec §4 (duplicate the six strings; do not import Worker TS from the root script):

```
ORG_ID=org_demo
ORG_NAME=Harborlight Hospitality
PROPERTY_ID=prop_demo
PROPERTY_NAME=The Meridian Seattle
TIME_ZONE=America/Los_Angeles
CURRENCY=USD
```

Sequence (spec §3.2):

1. `GET ${baseUrl}/` or `GET ${baseUrl}/v1/orgs` — if `fetch` throws / `ECONNREFUSED`, print `Start the Worker first: pnpm --filter @hospai/pms-core dev` and `process.exit(1)`. A 401/404/405 from a live Worker is **success** for the health check (Worker is up).
2. `POST /v1/orgs` `{ orgId, name }` + `content-type: application/json` + `x-dev-actor`. Status **201** or **409** with `{ error: 'org_exists' }` → continue. Anything else → print body, exit 1.
3. `POST /v1/orgs/${ORG_ID}/properties` `{ propertyId, name: PROPERTY_NAME, timeZone: TIME_ZONE, currency: CURRENCY }`. Status **201** → continue. **409** `jurisdiction_conflict` / `tenant_not_active` → exit 1. Other non-201 → exit 1.
4. `GET /v1/properties/${PROPERTY_ID}`. If `property.name !== PROPERTY_NAME`, `PATCH` `{ name: PROPERTY_NAME, idempotencyKey: 'demo-seed:v1:property-name' }`. Non-200 → exit 1.
5. `POST /v1/admin/demo-seed` `{ orgId, propertyId }`. Non-200 → print body, exit 1.
6. Print:

```
The Meridian Seattle
rooms: 20
board: 8 in-house / 4 arrivals / 3 due out
today: <today>
Wipe + re-seed: stop pms-core, delete apps/pms-core/.wrangler/state, restart, pnpm demo:seed
```

Use the JSON `propertyName` / `board` / `today` / `rooms`. Exit 0.

Do **not** start wrangler or Vite. Do **not** implement `--wipe`. Do **not** change `.env.example` ids.

- [x] **Step 1: Write the script + package.json script**

Shebang `#!/usr/bin/env node`. ESM (`import` — root `package.json` already `"type": "module"`).

- [x] **Step 2: Smoke — Worker down**

```bash
node scripts/demo-seed.mjs --base-url http://127.0.0.1:1
```

Expected: non-zero exit; stdout/stderr contains `pnpm --filter @hospai/pms-core dev`; does **not** print `The Meridian Seattle` as a success line.

- [x] **Step 3: Commit**

```bash
git add scripts/demo-seed.mjs package.json
git commit -m "$(cat <<'EOF'
feat: add pnpm demo:seed for the local demo hotel

EOF
)"
```

Documented manual check (not a CI gate this chunk): with `pms-core` `dev` running on a wiped persist, `pnpm demo:seed` exits 0 and prints the Meridian summary. Run it when you have the Worker; do not block the commit on it.

---

### Task 4: README + DEMO-READY ticks

**Spec:** §8, §9, Amends.

**Files:**
- Modify: `README.md` — “### 3 — Bootstrap tenant”
- Modify: `DEMO-READY.md` — tick every P0-1 checkbox (lines 59–72)
- Modify: `docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md` — one sentence under **Amends** that the README meeting path is this command (optional if README already states it)

**Forbidden:** `ARCHITECTURE.md` rewrite. SPA files. P0-2/P0-3/P0-4/P0-5 copy.

- [x] **Step 1: Rewrite README step 3**

Replace the current “Bootstrap tenant (once per local DO/D1 store)” **meeting path** with:

```markdown
### 3 — Seed the demo hotel (once per local DO/D1 store)

Worker must already be running (step 2, terminal A).

```bash
pnpm demo:seed
```

This provisions **Harborlight Hospitality** / **The Meridian Seattle** (`org_demo` / `prop_demo` — same ids as `apps/web-pms/.env.example`): ~20 rooms, BAR rates, and today’s board (8 in-house, 4 arrivals, 3 due out). Re-run is safe (idempotent).

If a dry run left the hotel dirty, wipe local persist and seed again:

1. Stop `pnpm --filter @hospai/pms-core dev`
2. Delete `apps/pms-core/.wrangler/state`
3. Start the Worker again
4. `pnpm demo:seed`

Do not run org purge for this.

#### Developer bootstrap (empty hotel)

Engineers who want a blank property can still curl org → property → one room type. A prior curl plus `pnpm demo:seed` heals `rt_king` to **King Deluxe** and PATCHes the property name. A messy mix of leftover types is a wipe (above).
```

Keep the three existing curl blocks **under** that developer subheading (same JSON as today). Keep steps 1 (env files) and 2 (start servers). Do not tell the meeting to curl.

- [x] **Step 2: Tick DEMO-READY P0-1**

Change the eight `- [ ]` under `### P0-1. One-command demo hotel` to `- [x]`. Add one sentence after the P0-1 list: `Closed 2026-08-13 by [demo tenant seed](docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md).`

- [x] **Step 3: Commit**

```bash
git add README.md DEMO-READY.md docs/superpowers/specs/2026-08-13-demo-tenant-seed-design.md
git commit -m "$(cat <<'EOF'
docs: point local runbook at pnpm demo:seed

EOF
)"
```

Omit the spec file if you skip the optional Amends sentence.

---

### Task 5: CI / checks job

**Spec:** §2, §12.1–3, §12.13, §12.15, §15.

- [x] **Step 1: Hygiene pins**

```bash
pnpm --filter @hospai/do-runtime build
pnpm generate:ddl
git diff --exit-code -- migrations/do-property migrations/do-org packages/do-runtime
git diff --exit-code -- tooling/eslint-plugin-hospai/src/class-denylist.ts
```

Expected: empty diffs. `PROPERTY_SCHEMA_HEAD === 25`. `ORG_SCHEMA_HEAD === 7`. `NIGHT_AUDIT_STEPS.length === 7`. `COMMAND_CATALOG.length === 77`. `AUDIT_WRITER_COMMAND_IDS.size === 52`. `[126]=get_guest_stays`; `[127]=post_demo_seed`. `CLASS_DENYLIST` untouched. No `demo.seed` catalog id.

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

### Task 6: Tick living plan checkboxes

**Last commit.** Docs only. Tick `- [x]` on Tasks 1–6 steps in **this** file. Do not backfill historical plans. Do not mix typecheck or code fixes.

- [x] **Step 1: Mark checkboxes**
- [x] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-demo-tenant-seed.md
git commit -m "$(cat <<'EOF'
docs: tick demo tenant seed plan checkboxes after merge

EOF
)"
```

---

## Spec §15 acceptance / reviewer checklist (copied; implementation must satisfy)

- [ ] Verified-current-state table matches the tree (route **127**, catalog **77**, property head **25**, org head **7**, no new commands, BAR already seeded as a plan, tape already composes names, `commitSoldNightsSync` cannot book pre-horizon nights).
- [ ] Normative invariants include integer money, append-only folio, schema freeze, no PropertyDO→OrgDO, unchanged provision HTTP, local-only 404 gate, no new `export class`.
- [ ] Command / shape decision is explicit: Node script + one `scope: 'dev'` Worker route; not shell-only; not a catalog command; not a provision-body flag.
- [ ] Exact command `pnpm demo:seed`, script `scripts/demo-seed.mjs`, route `POST /v1/admin/demo-seed`.
- [ ] Idempotency (stable ids / 409-as-success / skip check-in) and wipe (`apps/pms-core/.wrangler/state`) are both specified.
- [ ] Seeded data is tabulated: org, property, 3 types, 20 rooms, BAR cells, 14 named guests, 14 stays, board 8/4/3 + one unassigned.
- [ ] Scope-out names P0-2, P0-3, P0-4, P0-5, UI-beyond-data, production, provision API changes, new DO tables.
- [ ] Folded leftovers named (spec §10). Deferred leftovers named (spec §11).
- [ ] Acceptance tests spec §12 green.
- [ ] `[127]` only; `[126]` / `[0]` / `[2]` unmoved. Catalog **77**; no `demo.seed`; audit writers **52**; `PLATFORM_GAPS` [].
- [ ] No PropertyDO / OrgDO migration; purge list unchanged; `NIGHT_AUDIT_STEPS` 7; no new `export class`.
- [ ] Past nights via `ensurePastAvailabilityDays` + `assertUnsafeLocal`. No night audit. No `VITE_DEMO_DATE`.
- [ ] Script uses existing provision HTTP; 201/409 org; 201 existing property; PATCH name; then admin seed.
- [ ] README meeting path is `pnpm demo:seed`; three-curl is developer-only. DEMO-READY P0-1 ticked.
- [ ] No SPA source changes. No folio charges / shift / Clerk / chrome.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Fixture tables §5.1–§5.5; `buildDemoSeedPlan` | 1 |
| `ensurePastAvailabilityDays` / `assertUnsafeLocal` / no business_date bump | 1 |
| Route **127** `post_demo_seed` + `V1_ROUTES` zip | 2 |
| Catalog 77 / no `demo.seed` / writers 52 | 2 |
| Gates 404 / 403 / 400 | 2 |
| Orchestrator uses existing `try*` ; PropertyDO ↛ OrgDO | 2 |
| Board 8/4/3 + Amira unassigned; named guests; BAR integers | 2 |
| Heal `rt_king` / idempotent re-run / walk-in still free | 2 |
| `pnpm demo:seed` + `scripts/demo-seed.mjs` | 3 |
| Worker-down fail-fast | 3 |
| README + wipe + developer curls | 4 |
| DEMO-READY P0-1 ticks | 4 |
| Full CI, ddl no-op, schema heads, no new class | 5 |
| Plan checkboxes | 6 |
| P0-2 / P0-3 / P0-4 / P0-5 / UI / provision API / new tables | all (forbidden) |
