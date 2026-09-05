# HTTP error contracts (R0.10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **Q1**, **Q2**, **Q6**, **Q7**, **Q8**, **Q9**, **Q10** — one `commandErrorHttpStatus` table (`entitlement_required` → **402**, `not_member` → **404** `{ error: 'not_found' }`); shared `finishPropertyDoInvoke` epilogue for ~72 `invokePropertyDo` handlers; guest GET decrypt miss → **422** not **500**; membership mutators typed catch → `internal_error` not blanket **403**.

**Architecture:** Characterization tests land **first** and must fail on current `main` for T1–T7, T10–T12. Task 2 adds `command-error-http.ts` (merged table + `commandFailureResponse`) and `finish-property-do-invoke.ts`, migrates all PropertyDO handlers, deletes four parallel mappers. Task 3 fixes OrgDO `readGuest` Result path and membership `catch` blocks; updates `handleGetGuest`. Task 4 runs full CI and ticks **R0.10** only. No schema migration, new catalog commands, HTTP routes, or SPA — pins frozen.

**Tech Stack:** Cloudflare Workers + PropertyDO / OrgDO (`apps/pms-core`), `@hospai/contracts`, vitest + `cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-http-error-contracts-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged (dispatch logic only) |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. Error-table consolidation is dispatch-only — no route audit length change.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **Single table** | Exactly **one** `commandErrorHttpStatus` in `apps/pms-core/src/command-error-http.ts`. Delete `mapReservationCommandErrorStatus`, `mapGuestCommandErrorStatus`, `mapPersonEntityCommandErrorStatus`, `mapConfigErrorStatus`, `mapConfigConcreteCommandErrorStatus`, `mapPaymentCommandErrorStatus`, `mapCommandErrorStatus`, `mapRosterCommandErrorStatus` after migration. No fifth mapper. |
| **Q1 entitlement** | `ENTITLEMENT_REQUIRED` → **402** everywhere the table is used. `gateEntitlement` unchanged: `{ error, feature }` at **402**. DO-sourced entitlement on property routes: `{ error: 'entitlement_required', feature: 'pms.core' }` at **402**. `ENTITLEMENT_UNAVAILABLE` → **503** (unchanged). Never **422** or **503** for `entitlement_required`. |
| **Q2 not_member** | `NOT_MEMBER` / `'not_member'` → HTTP **404**, body `{ error: 'not_found' }` on property command paths. Table returns **404** for status lookup; epilogue **must** emit `not_found` wire key (gate convention). Never **422** on reservation writes. |
| **Q8/Q9/Q10 envelopes** | Command failures `{ ok: false, error }` (+ existing structured fields). Gates bare `{ error }`. Auth gate may keep `{ error, message? }`. Entitlement gate keeps `{ error, feature }` **402**. No third envelope. |
| **Q6 decrypt** | `readGuest` returns Result — **no throw** on `DECRYPT_UNRESOLVED`. GET **422** `{ ok: false, error: 'decrypt_unresolved' }`. Batch unchanged: per-row inside **200**. No **500** for decrypt miss alone. |
| **Q7 membership** | Replace four blanket `catch { return { ok: false, error: 'forbidden' } }` on `setOrgMember`, `removeOrgMember`, `setPropertyMember`, `removePropertyMember` with typed `mapOrgCommandError(e)` then `INTERNAL_ERROR`. Storage/SQL bugs must not become **403**. |
| **finishPropertyDoInvoke** | New helper; **72** `invoked.kind === 'response'` call sites in `v1-dispatch.ts` migrate to shared epilogue. Reservation family **must** use helper so Q2 cannot regress. Handler-specific structured errors stay in `onFailure`. |
| **Mapper deletion** | Delete parallel mappers after all call sites migrate — prefer delete in Task 2 if grep is clean. Thin wrappers that delegate to the one table are acceptable only until the last site moves. |
| **Route/command ids** | **No** renames. `handle*` / `try*` / route ids / command ids frozen. |
| **TDD** | Task 1 tests must **fail on current `main`** for T1–T7, T10–T12. Do **not** invert tests to encode today's bugs. |
| **Verify** | `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. **Never put `--` before `--shard`**. Unsharded `pnpm test` on pms-core is unsafe. |
| **Pins / roadmap** | No pin bump in Tasks 1–3. Tick **R0.10** only in Task 4. |

**Out of scope:** Playwright; PropertyDO extraction; SPA `classifiedUserMessage` (R0.11); new wire codes; org membership route body `{ error: 'not_member' }` on `/v1/orgs/.../members` (unchanged); push; `--no-verify`.

---

## Sequencing gate

```
Task 1 (red tests, tests-only commit)
→ Task 2 (commandErrorHttpStatus + finishPropertyDoInvoke; Q1/Q2/Q8–Q10)
→ Task 3 (Q6 readGuest GET + Q7 typed membership catch)
→ Task 4 (full CI + tick R0.10)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T7, T10–T12; existing room-type/night-audit **404** cases stay green). Task 2 makes T1–T6, T11–T12 green and deletes mappers. Task 3 makes T7–T10 green and updates `guests.spec.ts`. Task 4 runs full CI + ticks roadmap **R0.10** only.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Modify: `apps/pms-core/test/error-channel-d1.spec.ts`
- Create: `apps/pms-core/test/http-error-contracts.spec.ts`
- Modify: `apps/pms-core/test/guests.spec.ts` (expectations only — still throws on `main`)

**Interfaces:** none (tests only). `commandErrorHttpStatus` does not exist until Task 2 — T11/T12 import it and may fail compile until Task 2 Step 0 lands; run focused vitest after Task 2 for those imports.

Use existing helpers from `error-channel-d1.spec.ts`: `provisionHotel`, `mockRouteCommandError`, `postRoomType`, `putDomainConfig`, `postReservation`, `createGuest`, `addDays`. Pattern for mocking: `vi.spyOn(invokePropertyDoModule, 'invokePropertyDo')` returns `{ kind: 'ok', result: { ok: false, error } }` when `opts.routeId` matches.

### Step 1 — Extend `mockRouteCommandError` in `error-channel-d1.spec.ts`

Add imports and widen the mock helper (keep existing tests unchanged):

```ts
import {
  CONFIG_CLASS_NOT_DOMAIN,
  ENTITLEMENT_REQUIRED,
  NO_AVAILABILITY,
  NOT_MEMBER,
} from '@hospai/contracts';

/** Mock invokePropertyDo for a route so worker.fetch hits dispatch error handling. */
function mockRouteCommandError(
  routeId: string,
  error: typeof NOT_MEMBER | typeof NO_AVAILABILITY | typeof ENTITLEMENT_REQUIRED,
) {
  const original = invokePropertyDoModule.invokePropertyDo;
  return vi.spyOn(invokePropertyDoModule, 'invokePropertyDo').mockImplementation(async (opts) => {
    if (opts.routeId === routeId) {
      return { kind: 'ok', result: { ok: false, error } };
    }
    return original(opts);
  });
}
```

Add HTTP helpers at top of file (after existing helpers):

```ts
async function postReservationCancel(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-cancel-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function postReservationConfirm(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/confirm`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-confirm-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function postReservationHold(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/hold`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({ idempotencyKey: `idem-hold-${crypto.randomUUID()}` }),
      },
    ),
    env,
  );
}

async function postFolioLine(propertyId: string, actor: string, reservationId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/folio/lines`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          chargeCode: 'ROOM',
          amountMinor: 10000,
          idempotencyKey: `idem-folio-${crypto.randomUUID()}`,
        }),
      },
    ),
    env,
  );
}
```

### Step 2 — Append reservation / entitlement cases to `error-channel-d1.spec.ts` (T1–T6)

Add inside `describe('D1 error channel behaviour', …)` before the closing `});`:

```ts
  // T1 — reservation cancel not_member (today 422 via mapReservationCommandErrorStatus)
  it('T1: POST reservation cancel with not_member → 404 not_found', async () => {
    const actor = 'user_d1_cancel_nm';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('post_reservation_cancel', NOT_MEMBER);
    const res = await postReservationCancel(propertyId, actor, 'res_cancel_nm');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  // T2
  it('T2: POST reservation confirm with not_member → 404 not_found', async () => {
    const actor = 'user_d1_confirm_nm';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('post_reservation_confirm', NOT_MEMBER);
    const res = await postReservationConfirm(propertyId, actor, 'res_confirm_nm');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  // T3
  it('T3: POST reservation hold with not_member → 404 not_found', async () => {
    const actor = 'user_d1_hold_nm';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('post_reservation_hold', NOT_MEMBER);
    const res = await postReservationHold(propertyId, actor, 'res_hold_nm');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  // T4 — folio line (routeId post_folio_lines, command folio.add_item)
  it('T4: POST folio line with not_member → 404 not_found', async () => {
    const actor = 'user_d1_folio_nm';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('post_folio_lines', NOT_MEMBER);
    const res = await postFolioLine(propertyId, actor, 'res_folio_nm');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  // T5 — entitlement_required on reservation path (today 422)
  it('T5: POST reservation cancel with entitlement_required → 402 + feature', async () => {
    const actor = 'user_d1_cancel_ent';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('post_reservation_cancel', ENTITLEMENT_REQUIRED);
    const res = await postReservationCancel(propertyId, actor, 'res_cancel_ent');
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: ENTITLEMENT_REQUIRED, feature: 'pms.core' });
  });

  // T6 — config PUT entitlement (today 503 via mapConfigErrorStatus)
  it('T6: PUT domain config with entitlement_required → 402 + feature', async () => {
    const actor = 'user_d1_cfg_ent';
    const { propertyId } = await provisionHotel(actor);
    mockRouteCommandError('put_domain_config', ENTITLEMENT_REQUIRED);
    const res = await putDomainConfig(propertyId, actor, {
      key: 'pms.domain.same_day_cutoff',
      value: '14:00',
      reason: 'ops',
      idempotencyKey: `idem-cfg-ent-${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: ENTITLEMENT_REQUIRED, feature: 'pms.core' });
  });
```

**Note:** If `put_domain_config` route id differs, grep `v1-dispatch.ts` for the `routeId` on the domain config PUT handler and use that exact string in the mock.

### Step 3 — Create `apps/pms-core/test/http-error-contracts.spec.ts` (T7–T12)

```ts
import { env } from 'cloudflare:test';
import {
  DECRYPT_UNRESOLVED,
  ENTITLEMENT_REQUIRED,
  INTERNAL_ERROR,
  NOT_MEMBER,
} from '@hospai/contracts';
import { resolveOrgStub } from '@hospai/tenant-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import type { OrgDO } from '../src/org-do.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { createGuest, idemFor, provisionedOrg, TEST_OWNER_ACTOR } from './guest-helpers.js';

// T11/T12 — lands in Task 2; import fails until command-error-http.ts exists
import { commandErrorHttpStatus } from '../src/command-error-http.js';

async function postOrg(orgId: string, actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ orgId, name: 'HTTP Error Org' }),
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
        name: 'HTTP Error Hotel',
        timeZone: 'UTC',
        currency: 'USD',
      }),
    }),
    env,
  );
}

async function provisionHttpHotel(actor: string) {
  const orgId = `org_hec_${crypto.randomUUID()}`;
  const propertyId = `prop_hec_${crypto.randomUUID()}`;
  expect((await postOrg(orgId, actor)).status).toBe(201);
  expect((await postProperty(orgId, propertyId, actor)).status).toBe(201);
  const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<OrgDO>;
  await org.ensureMetaOrgId(orgId);
  return { orgId, propertyId, org };
}

async function getGuestHttp(propertyId: string, actor: string, guestId: string) {
  return worker.fetch(
    new Request(
      `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/${encodeURIComponent(guestId)}`,
      { method: 'GET', headers: { 'x-dev-actor': actor } },
    ),
    env,
  );
}

async function postGuestsBatch(propertyId: string, actor: string, refs: string[]) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/guests/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ refs }),
    }),
    env,
  );
}

describe('HTTP error contracts (R0.10)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // T7 — GET decrypt miss (today 500 via readGuest throw + catch)
  it('T7: shredded key GET guest → 422 decrypt_unresolved not 500', async () => {
    const actor = 'user_hec_get_decrypt';
    const { propertyId, org } = await provisionHttpHotel(actor);
    const guestId = 'guest_hec_decrypt';
    const refs = await createGuest(org, propertyId, guestId, 'Live Guest', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const res = await getGuestHttp(propertyId, actor, guestId);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: DECRYPT_UNRESOLVED });
  });

  // T8 — batch unchanged
  it('T8: same guest batch → 200 per-row decrypt_unresolved', async () => {
    const actor = 'user_hec_batch_decrypt';
    const { propertyId, org } = await provisionHttpHotel(actor);
    const guestId = 'guest_hec_batch';
    const refs = await createGuest(org, propertyId, guestId, 'Live Guest', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const res = await postGuestsBatch(propertyId, actor, [guestId]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      guests: Record<string, { ok: boolean; guestId: string; error?: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.guests[guestId]).toEqual({
      ok: false,
      guestId,
      error: DECRYPT_UNRESOLVED,
    });
  });

  // T9 — DO direct readGuest Result, no throw
  it('T9: OrgDO readGuest returns decrypt_unresolved Result without throw', async () => {
    const org = await provisionedOrg(`org_hec_do_${crypto.randomUUID()}`);
    const propertyId = 'prop_hec_do';
    const guestId = 'guest_hec_do';
    const refs = await createGuest(org, propertyId, guestId, 'Live', TEST_OWNER_ACTOR);
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);

    const result = await org.readGuest(TEST_OWNER_ACTOR, propertyId, guestId);
    expect(result).toEqual({ ok: false, guestId, error: DECRYPT_UNRESOLVED });
  });

  // T10 — membership storage fault (today forbidden)
  it('T10: setOrgMember after member table drop → internal_error not forbidden', async () => {
    const org = await provisionedOrg(`org_hec_mem_${crypto.randomUUID()}`);
    await org.execSqlForTest(`DROP TABLE member`);
    const r = await org.setOrgMember(TEST_OWNER_ACTOR, {
      targetUserId: 'user_new_member',
      role: 'staff',
      mode: 'create',
    });
    expect(r).toEqual({ ok: false, error: INTERNAL_ERROR });
  });

  // T11 — table unit
  it('T11: commandErrorHttpStatus(entitlement_required) === 402', () => {
    expect(commandErrorHttpStatus(ENTITLEMENT_REQUIRED)).toBe(402);
  });

  // T12 — table unit
  it('T12: commandErrorHttpStatus(not_member) === 404', () => {
    expect(commandErrorHttpStatus(NOT_MEMBER)).toBe(404);
  });
});
```

### Step 4 — Update `guests.spec.ts` M4 expectation (still red until Task 3)

In `apps/pms-core/test/guests.spec.ts`, replace the throw expectation in `'M4 DO: shredded key without erased_at is an incident, not a tombstone'`:

```ts
  it('M4 DO: shredded key without erased_at is an incident, not a tombstone', async () => {
    const org = await provisionedOrg(`org-m4-${crypto.randomUUID()}`);
    const propertyId = 'prop_m4';
    const refs = await createGuest(org, propertyId, 'guest_m4', 'Live');
    expect(await org.testShredGuestKey(refs.piiKeyId)).toBe(true);
    expect(await org.readGuest(TEST_OWNER_ACTOR, propertyId, 'guest_m4')).toEqual({
      ok: false,
      guestId: 'guest_m4',
      error: 'decrypt_unresolved',
    });
  });
```

Also update `'listGuests omits decrypt_unresolved guests instead of 500'` — remove any `readGuest` throw expectation if present; list behaviour stays unchanged.

### Step 5 — Run focused tests; confirm red on `main`

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/error-channel-d1.spec.ts \
  test/http-error-contracts.spec.ts \
  test/guests.spec.ts
```

**Expected on current `main` before Task 2/3:**
- T1–T6: **FAIL** (cancel/confirm/hold/folio return **422** or wrong status for entitlement; cancel returns **422** for `not_member`)
- T7–T10: **FAIL** (GET returns **500**; `readGuest` throws; membership returns `forbidden`)
- T11–T12: compile error until `command-error-http.ts` exists (run after Task 2 Step 0)
- Existing room-type / night-audit **404** cases: **PASS** (regression guard T13)

### Step 6 — Commit (tests only)

```bash
git add apps/pms-core/test/error-channel-d1.spec.ts \
  apps/pms-core/test/http-error-contracts.spec.ts \
  apps/pms-core/test/guests.spec.ts
git commit -m "test(pms-core): red specs for HTTP error contracts R0.10"
```

---

## Task 2 — `commandErrorHttpStatus` + `finishPropertyDoInvoke` (Q1/Q2/Q8–Q10)

**Files:**
- Create: `apps/pms-core/src/command-error-http.ts`
- Create: `apps/pms-core/src/finish-property-do-invoke.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (~72 handler epilogues; delete mappers ~380–1002)
- Create (optional): `scripts/check-error-mapper-singleton.mjs`
- Modify: `package.json` (optional `check:error-mapper-singleton` script)

**Interfaces:**
- **Produces:** `commandErrorHttpStatus(error: CommandError): number`, `commandFailureResponse(err, permission, opts?): Response`, `finishPropertyDoInvoke(opts): Response`
- **Consumes:** `@hospai/contracts` wire constants; existing `json()` helper from `v1-dispatch.ts` (extract shared `json` to a tiny module or duplicate one-liner in new files to avoid circular imports — prefer importing from existing `invoke-property-do.ts` pattern)

### Step 0 — Create `command-error-http.ts`

Merge the four existing switches from `v1-dispatch.ts` (`mapReservationConcreteCommandErrorStatus`, `mapPersonEntityCommandErrorStatus`, `mapConfigConcreteCommandErrorStatus`, payment special cases) into **one** exhaustive function. **Only Q1/Q2 deltas:**

1. `ENTITLEMENT_REQUIRED` → **402** (was **422** in reservation/person-entity; was **503** in config)
2. `NOT_MEMBER` → **404** in table (was **422** in reservation switch)

Preserve all other status assignments byte-for-byte (409 conflicts, 404 not-found set, 503 R2 unbound, 501 `psp_unavailable`, 400 `CONFIG_CLASS_NOT_DOMAIN` / `undeclared:*` prefix guard).

```ts
// apps/pms-core/src/command-error-http.ts
import {
  ENTITLEMENT_REQUIRED,
  ENTITLEMENT_UNAVAILABLE,
  NOT_MEMBER,
  FORBIDDEN,
  SCOPE_MISMATCH,
  CONFIG_CLASS_NOT_DOMAIN,
  PSP_UNAVAILABLE,
  INTERNAL_ERROR,
  type CommandError,
  type ConcreteCommandError,
  type FeatureKey,
  type Permission,
} from '@hospai/contracts';

const UNDECLARED_CONFIG_PREFIX = 'undeclared:';

export function commandErrorHttpStatus(error: CommandError): number {
  if (error === CONFIG_CLASS_NOT_DOMAIN || error.startsWith(UNDECLARED_CONFIG_PREFIX)) {
    return 400;
  }
  return mapConcreteCommandErrorStatus(error as ConcreteCommandError);
}

function mapConcreteCommandErrorStatus(error: ConcreteCommandError): number {
  switch (error) {
    case ENTITLEMENT_REQUIRED:
      return 402;
    case ENTITLEMENT_UNAVAILABLE:
    /* … copy INVOICE_R2_UNBOUND, CITY_LEDGER_R2_UNBOUND, REPORTS_R2_UNBOUND → 503 … */
      return 503;
    case NOT_MEMBER:
    /* … copy NOT_FOUND, GUEST_NOT_FOUND, RATE_PLAN_NOT_FOUND, … → 404 … */
      return 404;
    case FORBIDDEN:
    case SCOPE_MISMATCH:
      return 403;
    case PSP_UNAVAILABLE:
      return 501;
    /* … copy entire reservation concrete switch from v1-dispatch.ts:385–568 EXCEPT:
         - remove ENTITLEMENT_REQUIRED and NOT_MEMBER from the 422 bucket (now 402/404 above)
         - keep DECRYPT_UNRESOLVED in 422 bucket for commandFailureResponse default path
    … */
    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function commandFailureResponse(
  err: CommandError,
  permission: Permission,
  opts?: { feature?: FeatureKey; headers?: HeadersInit },
): Response {
  if (err === NOT_MEMBER) {
    return Response.json({ error: 'not_found' }, { status: 404, headers: opts?.headers });
  }
  if (err === FORBIDDEN || err === SCOPE_MISMATCH) {
    return Response.json(
      { error: 'forbidden', permission },
      { status: 403, headers: opts?.headers },
    );
  }
  if (err === ENTITLEMENT_REQUIRED) {
    return Response.json(
      { error: ENTITLEMENT_REQUIRED, feature: opts?.feature ?? 'pms.core' },
      { status: 402, headers: opts?.headers },
    );
  }
  return Response.json(
    { ok: false, error: err },
    { status: commandErrorHttpStatus(err), headers: opts?.headers },
  );
}
```

**Implementer instruction:** Copy the full `case` lists from `mapReservationConcreteCommandErrorStatus` (~385–568), `mapPersonEntityCommandErrorStatus` (~577–760), and payment overrides (~972–1001) into one deduped switch. Run `pnpm typecheck` — the `never` default must compile (exhaustive `ConcreteCommandError`).

Replace `commandErrorResponse` body in `v1-dispatch.ts`:

```ts
function commandErrorResponse(err: CommandError, permission: Permission): Response {
  return commandFailureResponse(err, permission);
}
```

Replace `guestDirectoryErrorResponse` internals:

```ts
function guestDirectoryErrorResponse(err: string): Response {
  if (err === ENTITLEMENT_UNAVAILABLE) {
    return json({ error: ENTITLEMENT_UNAVAILABLE }, 503, GUEST_HEADERS);
  }
  return commandFailureResponse(err as CommandError, 'guests:read', { headers: GUEST_HEADERS });
}
```

Refactor `mapExceptionWriterError` to delegate authz rows to `commandFailureResponse` with `permission: 'night_audit:run'`, keeping the special `org_unreachable` **503** branch.

### Step 1 — Create `finish-property-do-invoke.ts`

```ts
import type { CommandError, FeatureKey, Permission } from '@hospai/contracts';
import { commandFailureResponse } from './command-error-http.js';

function json(data: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

type FinishPropertyDoOpts<T extends { ok: boolean }> = {
  invoked: { kind: 'response'; response: Response } | { kind: 'ok'; result: T };
  permission: Permission;
  feature?: FeatureKey;
  successStatus?: number;
  headers?: HeadersInit;
  onFailure?: (result: Extract<T, { ok: false }>) => Response | null;
};

export function finishPropertyDoInvoke<T extends { ok: boolean }>(
  opts: FinishPropertyDoOpts<T>,
): Response {
  if (opts.invoked.kind === 'response') return opts.invoked.response;
  const result = opts.invoked.result;
  if (result.ok) return json(result, opts.successStatus ?? 200, opts.headers);
  const custom = opts.onFailure?.(result as Extract<T, { ok: false }>);
  if (custom) return custom;
  const err = (result as { ok: false; error: CommandError }).error;
  return commandFailureResponse(err, opts.permission, {
    feature: opts.feature,
    headers: opts.headers,
  });
}
```

### Step 2 — Migrate reservation family first (T1–T3, T5 green)

Example — `handlePostReservationCancel` (~2620–2646) becomes:

```ts
  return finishPropertyDoInvoke({
    invoked,
    permission: 'reservations:write',
    onFailure: (result) => {
      if (result.error === NOT_FOUND) return json({ error: 'not_found' }, 404);
      if (result.error === LEDGER_INCONSISTENT) {
        return json(
          { ok: false, error: result.error, date: (result as { date: string }).date },
          409,
        );
      }
      return null;
    },
  });
```

Apply same pattern to: `handlePostReservationConfirm`, `handlePostReservationHold`, `handlePostReservationFrontOffice`, `handlePostReservationCheckIn`, `handlePostReservationCheckOut`, `handlePostReservationAssignRoom`, `handlePostReservations` (book), modify/cancel-check-in/no-show paths — grep `mapReservationCommandErrorStatus` and migrate each.

**Reservation family rule:** Every handler that today ends with `mapReservationCommandErrorStatus(err)` without an explicit `not_member` → `not_found` epilogue **must** use `finishPropertyDoInvoke`.

### Step 3 — Migrate remaining invokePropertyDo batches

Grep: `if (invoked.kind === 'response') return invoked.response;` (**72** hits). Migrate in order:

1. **Folio / payments** — `handlePostFolioLines`, void, split, transfer, window *, payment *, city-ledger * (replace `mapPaymentCommandErrorStatus` calls)
2. **Rates / inventory / rooms** — room-type CRUD (already correct behaviour; still migrate to helper for consistency)
3. **Night audit / provisional / config** — `handlePutDomainConfig` (T6), night-audit run/retry/resolve-halt, exception writers

For handlers with structured payloads, preserve `onFailure` hooks exactly:

```ts
// no_availability example
onFailure: (result) => {
  if (result.error === NO_AVAILABILITY) {
    return json(
      { ok: false, error: result.error, date: result.date, ariVersion: result.ariVersion },
      409,
    );
  }
  return null;
},
```

### Step 4 — Delete dead mappers from `v1-dispatch.ts`

Remove functions: `mapReservationCommandErrorStatus`, `mapReservationConcreteCommandErrorStatus`, `mapGuestCommandErrorStatus`, `mapPersonEntityCommandErrorStatus`, `mapRosterCommandErrorStatus`, `mapCommandErrorStatus`, `mapConfigErrorStatus`, `mapConfigConcreteCommandErrorStatus`, `mapPaymentCommandErrorStatus`, `mapAddRoomTypeErrorStatus` (inline into merged table if still needed).

Verify no references remain:

```bash
rg 'map(Reservation|Guest|PersonEntity|Config|Payment|Roster|Command)CommandErrorStatus' apps/pms-core/src
```

Expected: **no matches** (except optional comment in check script).

### Step 5 (optional) — Static guard `scripts/check-error-mapper-singleton.mjs`

```js
#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TARGET = join(ROOT, 'apps/pms-core/src/v1-dispatch.ts');
const src = readFileSync(TARGET, 'utf8');
const forbidden = [
  'mapReservationCommandErrorStatus',
  'mapGuestCommandErrorStatus',
  'mapPersonEntityCommandErrorStatus',
  'mapConfigErrorStatus',
  'mapPaymentCommandErrorStatus',
  'function mapCommandErrorStatus',
];
for (const name of forbidden) {
  if (src.includes(name)) {
    console.error(`Forbidden revived mapper: ${name} in v1-dispatch.ts`);
    process.exit(1);
  }
}
console.log('check-error-mapper-singleton: ok');
```

Add to root `package.json` scripts if desired: `"check:error-mapper-singleton": "node scripts/check-error-mapper-singleton.mjs"`. Not required for Task 2 gate but recommended.

### Step 6 — Run tests (T1–T6, T11–T12 green; T7–T10 still red)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/error-channel-d1.spec.ts \
  test/http-error-contracts.spec.ts
pnpm --filter @hospai/pms-core exec vitest run test/guests-routes.spec.ts
```

Regression: existing `error-channel-d1` room-type / night-audit **404** cases; `guests-routes` unentitled **402**.

### Step 7 — Commit

```bash
git add apps/pms-core/src/command-error-http.ts \
  apps/pms-core/src/finish-property-do-invoke.ts \
  apps/pms-core/src/v1-dispatch.ts \
  scripts/check-error-mapper-singleton.mjs \
  package.json
git commit -m "fix(pms-core): one commandErrorHttpStatus table and finishPropertyDoInvoke epilogue"
```

---

## Task 3 — Q6 `readGuest` + Q7 membership typed catch

**Files:**
- Modify: `apps/pms-core/src/org-do.ts` (`readGuest` ~2286–2320; membership catches ~1051, ~1135, ~1317, ~1384)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (`handleGetGuest` ~1972–2003)

**Interfaces:**
- **Consumes:** `commandFailureResponse`, `commandErrorHttpStatus` from Task 2
- **Produces:** `readGuest` union includes `{ ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }`

### Step 1 — Fix OrgDO `readGuest` (Q6)

Extend return type and replace throw (~2313–2320):

```ts
  async readGuest(
    actor: ActorContext,
    propertyId: string,
    guestId: string,
  ): Promise<
    | { ok: true; guestId: string; erased: false; profile: GuestProfile }
    | { ok: true; guestId: string; erased: true; profile: null }
    | { ok: false; error: typeof GUEST_NOT_FOUND }
    | { ok: false; guestId: string; error: typeof DECRYPT_UNRESOLVED }
    | { ok: false; error: typeof ENTITLEMENT_REQUIRED | typeof ENTITLEMENT_UNAVAILABLE }
    | { ok: false; error: typeof FORBIDDEN | typeof NOT_MEMBER | typeof SCOPE_MISMATCH }
    | { ok: false; error: typeof ORG_ID_UNSET }
  > {
    /* … permission + entitlement gates unchanged … */
    const entry = await this.readGuestEntry(guestId);
    if (entry.ok === false) {
      if (entry.error === GUEST_NOT_FOUND) return { ok: false, error: GUEST_NOT_FOUND };
      if (entry.error === DECRYPT_UNRESOLVED) {
        return { ok: false, guestId, error: DECRYPT_UNRESOLVED };
      }
    }
    return entry;
  }
```

Import `DECRYPT_UNRESOLVED` from `@hospai/contracts` if not already in scope.

### Step 2 — Fix `handleGetGuest` (Q6 HTTP)

Replace failure/catch path (~1983–2002):

```ts
  try {
    await org.ensureMetaOrgId(resolvedCtx.property.orgId);
    const result = await org.readGuest(actor, propertyId, guestId);
    if (!result.ok) {
      if ('guestId' in result && result.error === DECRYPT_UNRESOLVED) {
        logError(ctx.observability, { msg: 'guests.read.decrypt_incident', guestId: result.guestId });
        return commandFailureResponse(DECRYPT_UNRESOLVED, 'guests:read');
      }
      return commandErrorResponse(result.error, 'guests:read');
    }
    return json(result, 200);
  } catch (e) {
    if (isOrgDoTransportFailure(e, ctx.env)) {
      return degradedFailClosedReadResponse();
    }
    throw e;
  }
```

Remove the branch that maps decrypt throw → **500** `{ error: 'internal_error' }`.

### Step 3 — Fix membership typed catch (Q7)

At all four sites (`setOrgMember` ~1051, `removeOrgMember` ~1135, `setPropertyMember` ~1317, `removePropertyMember` ~1384), replace:

```ts
    } catch {
      return { ok: false, error: 'forbidden' };
    }
```

with:

```ts
    } catch (e) {
      const mapped = mapOrgCommandError(e);
      if (mapped) return mapped;
      return { ok: false, error: INTERNAL_ERROR };
    }
```

Import `INTERNAL_ERROR` from `@hospai/contracts`. **Do not** map unknown errors to `'forbidden'`.

### Step 4 — Run tests (T7–T10 green)

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/http-error-contracts.spec.ts \
  test/guests.spec.ts \
  test/membership-org-do.spec.ts
```

Existing membership rank/last-owner tests in `membership-org-do.spec.ts` must stay **green**.

### Step 5 — Commit

```bash
git add apps/pms-core/src/org-do.ts apps/pms-core/src/v1-dispatch.ts
git commit -m "fix(pms-core): guest decrypt Result on GET and typed membership catch"
```

---

## Task 4 — Full CI + tick R0.10

**Files:**
- Modify: `docs/roadmap.md` (tick **R0.10** only)

**Interfaces:** none (verification + docs tick)

### Step 1 — Focused regression sweep

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/error-channel-d1.spec.ts \
  test/http-error-contracts.spec.ts \
  test/guests.spec.ts \
  test/guests-routes.spec.ts \
  test/membership-org-do.spec.ts \
  test/entitlements.spec.ts
```

- [ ] All green

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

If Task 2 added `check:error-mapper-singleton`, run it here too.

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

### Step 5 — Tick roadmap R0.10

In `docs/roadmap.md` line ~186, change:

```markdown
- [ ] **R0.10** Audit V10 — Q1, Q2, Q6, Q7, Q8, Q9, Q10. ...
```

to:

```markdown
- [x] **R0.10** Audit V10 — Q1, Q2, Q6, Q7, Q8, Q9, Q10. ...
```

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "docs(roadmap): tick R0.10 HTTP error contracts"
```

---

## Self-review (plan author checklist)

| Spec requirement | Task |
|---|---|
| Q1 single table, entitlement → 402 | Task 2 |
| Q2 not_member → 404 not_found on property commands | Task 1 tests; Task 2 `finishPropertyDoInvoke` |
| Q6 decrypt GET 422, batch unchanged | Task 1 + 3 |
| Q7 membership typed catch | Task 1 T10; Task 3 |
| Q8 delete four mappers | Task 2 |
| Q9 two envelopes | Task 2 `commandFailureResponse` |
| Q10 ~72 shared epilogues | Task 2 |
| Pins unchanged | Task 4 confirmation |
| No Playwright / SPA / new routes | Out of scope |
| T1–T7, T10–T12 fail on main first | Task 1 |

**Placeholder scan:** no TBD/TODO/implement-later steps.

**Final CI task:** Task 4 copies full `ci.yml` checks + `pnpm test:local` — not a subset.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-05-http-error-contracts.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks
2. **Inline Execution** — execute tasks in one session using executing-plans with checkpoints

Which approach?
