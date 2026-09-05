# Bounded bulk, JSON parse, idempotency hardening (R0.8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer, 2026-09-05)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **N3**, **X1**, **P5**, **N10**, **Q11**, **N2**, **S6**, **Q3** — cap INTERACTIVE bulk arrays at HTTP + RPC; shared JSON parse helper (`400 invalid_json`); command-scoped fingerprints `{ commandId, payload }`; user-scoped idempotency storage keys; catalog lane honesty for three commands; virtual room type constituent identity.

**Architecture:** Characterization tests land **first** and must fail on current `main`. Task 2 adds caps, catalog lane corrections, and `parseRequestJson`. Task 3 adds `commandFingerprint`, required-`actor` `runIdempotent`, and Q3 sort fix. Task 4 runs full CI and ticks **R0.8**. No schema migration, new catalog commands, HTTP routes, or SPA — pins frozen except three lane field edits.

**Tech Stack:** Cloudflare Workers + PropertyDO / OrgDO (`apps/pms-core`), `@hospai/contracts`, `@hospai/do-runtime`, vitest + `cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-bounded-bulk-idempotency-json-design.md` (Status: Approved — normative).

---

## Frozen heads (must not move except lane fields)

| Pin | Value | This vertical |
|---|---|---|
| `COMMAND_CATALOG` length | **89** | **89** — lane-only edits on 3 rows |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | **144** — unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `ORG_SCHEMA_HEAD` | **9** | **9** — unchanged |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |

Tree verified 2026-09-05 per spec. Lane field edits on `rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run` are **required** (Q11) and do not change catalog length.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **Rates bulk cap** | `updates.length` ≤ **500** at HTTP (`handlePostRatesBulk`) and RPC (`tryBulkUpdateRates`). |
| **Rooms bulk cap** | `updates.length` ≤ **200** at HTTP (`handlePostRoomsBulkStatus`) and RPC (`tryBulkUpdateRoomStatus`). |
| **Folio split cap** | `splits.length` ≤ **20** at HTTP (`handlePostFolioSplit`) and RPC (`trySplitFolioLine`). |
| **Roster kinds cap** | `kinds.length` ≤ **16** at HTTP (`handlePostRoster`, `handlePatchRoster` when `kinds` present) and OrgDO roster RPC. |
| **Over cap** | **422** `{ ok: false, error: 'limit_exceeded' }` (`LIMIT_EXCEEDED` from `entitlements.ts`). Existing `commandErrorHttpStatus` table — no fifth mapper. |
| **Q11 lanes** | `rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run`: catalog `lane: 'INTERACTIVE'`. Runtime stays `touchInteractive()`. **No** chunking / `bulkDeadline()`. **`COMMAND_CATALOG.length` stays 89.** |
| **JSON helper** | One module (`parseRequestJson`). Read `request.text()`; **no** `Content-Type` gate. Malformed non-empty JSON → **400** `{ error: 'invalid_json' }`. Empty body → `null`; handler → **`invalid_body`** per existing contract. `index.ts` SyntaxError safety net stays. `readOptionalJsonBody`: malformed non-empty JSON → **400**, not swallow. |
| **Header-only status routes** | `handlePostReservationStatusAction` (no-show, cancel-check-in, etc.) uses `requireIdempotencyHeader` only — **no** `request.json()`. Task 2 **must not** wrap those handlers with `parseRequestJson` (empty body → `invalid_body`). Only replace existing `(await ctx.request.json())` sites. Keep `readOptionalJsonBody` for check-in/out. T7 no-show request has **no JSON body**. |
| **N2 fingerprint** | `commandFingerprint(commandId, commandPayload)` in `@hospai/contracts`; replaces direct `fingerprintPayload(commandPayload)` on **all** idempotent HTTP → DO paths. |
| **Six-route alias** | `reservations.cancel`, `reservations.no_show`, `reservations.cancel_check_in`, `reservations.confirm` (body without `ratePlanId`), `reservations.check_in` / `reservations.check_out` when optional fields omitted — must not share fingerprint across different `commandId`. |
| **S6 scope** | **Required** `actor` param on `runIdempotent`; storage key always `scopeIdempotencyKey(actor, idem.key)`. User: `${userId}:${clientKey}`. System: `system:${clientKey}`. Every PropertyDO / OrgDO call site passes `actor`. Client `idem.key` and D1 provisional row stay **unprefixed**. |
| **Q3** | Sort `constituentRoomTypeIds` **once** at HTTP handler; fingerprint and `commandPayload` / `tryAddRoomType` / `tryUpdateRoomType` use that **same** sorted array. |
| **TDD** | Task 1 tests must **fail on current `main`**. Do **not** invert tests to encode today's bugs. |
| **Verify** | `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local`. pms-core is **8 shards**. **Never put `--` before `--shard`**. Unsharded `pnpm test` on pms-core is unsafe. |

**Out of scope:** Playwright; PropertyDO extraction; real BULK chunking; guest batch cap (already 50); R0.9 replay permission; zod-per-route; push; `--no-verify`.

---

## Sequencing gate

```
Task 1 (red tests, tests-only commit)
→ Task 2 (caps + catalog INTERACTIVE + parseRequestJson)
→ Task 3 (commandFingerprint + Q3 + required-actor runIdempotent)
→ Task 4 (full CI + tick R0.8 in docs/roadmap.md)
```

**TDD:** Task 1 commits tests-only (red on `main` for T1–T8, T10, T11, T12; **T9 already green** — Task 3 regression guard). Task 2 makes cap / lane / JSON tests green. Task 3 makes idempotency / scope / Q3 tests green (T9 must stay **201** replay). Task 4 runs full CI + `pnpm test:local` and ticks roadmap **R0.8** only in Task 4.

---

## Task 1 — Failing characterization tests (tests-only commit)

**Files:**
- Create: `apps/pms-core/test/bounded-bulk-idempotency.spec.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: `packages/contracts/src/idempotency.test.ts`

**Interfaces:** none (tests only). Import `commandFingerprint`, cap constants, and `LIMIT_EXCEEDED` from `@hospai/contracts` after Task 2/3 add them — **Task 1 may reference symbols that do not exist yet**; implementer accepts compile failure until production lands, or stubs minimal exports in Task 2 Step 0 before running vitest. **Preferred:** write tests against final import paths; run focused vitest after Task 2 Step 0 for cap/lane/JSON cases and after Task 3 Step 0 for fingerprint/scope cases.

Use existing helpers: `provisionedPropertyStub`, `provisionedOrg`, `idemFor`, `TEST_OWNER_ACTOR`, `addCalendarDays` from `date-helpers.ts`. HTTP tests follow `rate-plans-routes.spec.ts` / `roster-routes.spec.ts` (`worker.fetch`, `x-dev-actor`, `ensurePlatformSchema`).

### Step 1 — New file: `bounded-bulk-idempotency.spec.ts` (T1–T10)

Create `apps/pms-core/test/bounded-bulk-idempotency.spec.ts`:

```ts
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IDEM_KEY_REUSED,
  LIMIT_EXCEEDED,
  RATES_BULK_UPDATE_MAX,
  ROOMS_BULK_STATUS_MAX,
  FOLIO_SPLIT_MAX,
  ROSTER_KINDS_MAX,
  commandFingerprint,
} from '@hospai/contracts';
import worker from '../src/index.js';
import {
  ensurePlatformSchema,
  resetPlatformSchemaGate,
  setKillSwitch,
} from '../src/registry.js';
import { idemFor, provisionedPropertyStub, TEST_OWNER_ACTOR } from './fixtures';
import { addCalendarDays } from './date-helpers.js';

const ACTOR_A = 'user_idem_a';
const ACTOR_B = 'user_idem_b';

async function postOrgMalformed(actor: string) {
  return worker.fetch(
    new Request('http://localhost/v1/orgs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test',
        'x-dev-actor': actor,
      },
      body: '{',
    }),
    env,
  );
}

async function postRatesBulkHttp(
  propertyId: string,
  actor: string,
  updates: Array<{
    roomTypeId: string;
    stayDate: string;
    amountMinor: number;
    currency: string;
  }>,
  idempotencyKey: string,
) {
  return worker.fetch(
    new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rates/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
      body: JSON.stringify({ updates, idempotencyKey }),
    }),
    env,
  );
}

function rateCells(count: number, stayDate: string) {
  return Array.from({ length: count }, (_, i) => ({
    roomTypeId: 'rt_king',
    stayDate,
    amountMinor: 10_000 + i,
    currency: 'USD',
  }));
}

describe('bounded bulk + idempotency + JSON (R0.8)', () => {
  beforeEach(async () => {
    resetPlatformSchemaGate();
    await ensurePlatformSchema(env.PLATFORM_DB);
    await setKillSwitch(env, 'pms.core', false);
  });

  afterEach(async () => {
    await setKillSwitch(env, 'pms.core', false);
  });

  // T1 — rates bulk HTTP over cap
  it('T1: rates bulk 501 updates → HTTP 422 limit_exceeded', async () => {
    const { stub, orgId: _orgId } = await provisionedPropertyStub(`bb-${crypto.randomUUID()}`, 'UTC', 'USD');
    const propertyId = (await stub.readMetaPropertyId())!;
    const stayDate = (await stub.readBusinessDate())!;
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-king', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );

    const res = await postRatesBulkHttp(
      propertyId,
      ACTOR_A,
      rateCells(RATES_BULK_UPDATE_MAX + 1, stayDate),
      `idem-rates-${crypto.randomUUID()}`,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T2 — rates bulk RPC over cap
  it('T2: tryBulkUpdateRates 501 updates → RPC limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-rpc-rates-${crypto.randomUUID()}`, 'UTC', 'USD');
    const stayDate = (await stub.readBusinessDate())!;
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-king-rpc', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const payload = { updates: rateCells(RATES_BULK_UPDATE_MAX + 1, stayDate) };
    const result = await stub.tryBulkUpdateRates(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('bulk-rpc', payload),
    );
    expect(result).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T3 — rooms bulk HTTP over cap
  it('T3: rooms bulk 201 updates → HTTP 422 limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-rooms-${crypto.randomUUID()}`, 'UTC', 'USD');
    const propertyId = (await stub.readMetaPropertyId())!;
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-rooms', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    for (let i = 0; i < 3; i++) {
      const room = { roomId: `room_${i}`, roomTypeId: 'rt_king', code: `${100 + i}` };
      expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor(`room-${i}`, room))).toMatchObject({ ok: true });
    }
    const updates = Array.from({ length: ROOMS_BULK_STATUS_MAX + 1 }, (_, i) => ({
      roomId: `room_${i % 3}`,
      status: 'clean',
    }));
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/rooms/bulk-status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
        body: JSON.stringify({ updates, idempotencyKey: `idem-rooms-${crypto.randomUUID()}` }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T4 — rooms bulk RPC over cap
  it('T4: tryBulkUpdateRoomStatus 201 updates → RPC limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-rpc-rooms-${crypto.randomUUID()}`, 'UTC', 'USD');
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-rpc-rooms', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const room = { roomId: 'room_1', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('room-1', room))).toMatchObject({ ok: true });
    const payload = {
      updates: Array.from({ length: ROOMS_BULK_STATUS_MAX + 1 }, () => ({
        roomId: 'room_1',
        status: 'clean',
      })),
    };
    const result = await stub.tryBulkUpdateRoomStatus(
      TEST_OWNER_ACTOR,
      payload,
      await idemFor('bulk-rooms-rpc', payload),
    );
    expect(result).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T5 — folio split HTTP + RPC over cap
  it('T5: folio split 21 splits → HTTP + RPC limit_exceeded', async () => {
    const { stub } = await provisionedPropertyStub(`bb-split-${crypto.randomUUID()}`, 'UTC', 'USD');
    const propertyId = (await stub.readMetaPropertyId())!;
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = 'res_split_cap';
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-split', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 1),
    });
    const sourceId = `${reservationId}:room`;
    const line = { folioLineId: sourceId, reservationId, chargeCode: 'ROOM', amountMinor: 100_000 };
    expect(await stub.tryAddFolioLine(TEST_OWNER_ACTOR, line, await idemFor('line', line))).toMatchObject({ ok: true });

    const splits = Array.from({ length: FOLIO_SPLIT_MAX + 1 }, (_, i) => ({
      folioLineId: `split_${i}`,
      amountMinor: 100,
    }));
    const rpcPayload = { sourceFolioLineId: sourceId, splits };
    expect(
      await stub.trySplitFolioLine(TEST_OWNER_ACTOR, rpcPayload, await idemFor('split-rpc', rpcPayload)),
    ).toEqual({ ok: false, error: LIMIT_EXCEEDED });

    const httpRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/folio/lines/${encodeURIComponent(sourceId)}/split`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
          body: JSON.stringify({ splits, idempotencyKey: `idem-split-${crypto.randomUUID()}` }),
        },
      ),
      env,
    );
    expect(httpRes.status).toBe(422);
    expect(await httpRes.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T6 — roster create 17× housekeeper kinds → HTTP 422 (cap before kind validation)
  it('T6: roster POST 17 kinds → HTTP 422 limit_exceeded', async () => {
    const orgId = `org_bb_roster_${crypto.randomUUID()}`;
    const propertyId = `prop_bb_roster_${crypto.randomUUID()}`;
    expect(
      (
        await worker.fetch(
          new Request('http://localhost/v1/orgs', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
            body: JSON.stringify({ orgId, name: 'BB Roster Org' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await worker.fetch(
          new Request(`http://localhost/v1/orgs/${encodeURIComponent(orgId)}/properties`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
            body: JSON.stringify({ propertyId, name: 'BB Hotel', timeZone: 'UTC', currency: 'USD' }),
          }),
          env,
        )
      ).status,
    ).toBe(201);

    const kinds = Array.from({ length: ROSTER_KINDS_MAX + 1 }, () => 'housekeeper');
    const res = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
        body: JSON.stringify({
          displayName: 'Over kinds',
          kinds,
          idempotencyKey: `idem-roster-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: LIMIT_EXCEEDED });
  });

  // T7 — cancel then no-show same key → 409
  it('T7: cancel then no-show same Idempotency-Key → 409 idempotency_key_reused', async () => {
    const { stub } = await provisionedPropertyStub(`bb-cancel-ns-${crypto.randomUUID()}`, 'UTC', 'USD');
    const propertyId = (await stub.readMetaPropertyId())!;
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = 'res_cancel_ns';
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-cn', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      status: 'confirmed',
    });

    const sharedKey = `shared-key-${crypto.randomUUID()}`;
    const cancelRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/cancel`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-dev-actor': ACTOR_A,
            'x-idempotency-key': sharedKey,
          },
          body: JSON.stringify({ idempotencyKey: sharedKey }),
        },
      ),
      env,
    );
    expect(cancelRes.status).toBe(200);

    const noShowRes = await worker.fetch(
      new Request(
        `http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations/${encodeURIComponent(reservationId)}/no-show`,
        {
          method: 'POST',
          headers: {
            'x-dev-actor': ACTOR_A,
            'x-idempotency-key': sharedKey,
          },
        },
      ),
      env,
    );
    expect(noShowRes.status).toBe(409);
    expect(await noShowRes.json()).toEqual({ ok: false, error: IDEM_KEY_REUSED });
    expect(await stub.getReservationStatus(reservationId)).toBe('cancelled');
  });

  // T8 — user A check-in key K; user B same key → fresh execution (not A's cache)
  it('T8: user A check-in key K success; user B same key → not A cached 200', async () => {
    const { stub } = await provisionedPropertyStub(`bb-scope-${crypto.randomUUID()}`, 'UTC', 'USD');
    const arrival = (await stub.readBusinessDate())!;
    const reservationId = 'res_scope';
    await stub.tryAddRoomType(
      TEST_OWNER_ACTOR,
      { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 },
      await idemFor('rt-scope', { roomTypeId: 'rt_king', code: 'KING', name: 'King', roomCount: 5, maxOccupancy: 2, maxAdults: 2 }),
    );
    const room = { roomId: 'room_scope', roomTypeId: 'rt_king', code: '101' };
    expect(await stub.tryCreateRoom(TEST_OWNER_ACTOR, room, await idemFor('room-scope', room))).toMatchObject({ ok: true });
    await stub.trySetRoomStatus(TEST_OWNER_ACTOR, { roomId: 'room_scope', status: 'clean' }, await idemFor('clean', { roomId: 'room_scope', status: 'clean' }));
    await stub.insertReservationForTest({
      reservationId,
      roomTypeId: 'rt_king',
      guestRef: 'g1',
      piiKeyId: 'p1',
      arrivalDate: arrival,
      departureDate: addCalendarDays(arrival, 2),
      status: 'confirmed',
    });
    await stub.tryAssignRoom(
      TEST_OWNER_ACTOR,
      { reservationId, roomId: 'room_scope' },
      await idemFor('assign', { reservationId, roomId: 'room_scope' }),
    );

    const clientKey = `K-${crypto.randomUUID()}`;
    const payload = { reservationId };
    const fp = await commandFingerprint('reservations.check_in', payload);
    const idem = { key: clientKey, fingerprint: fp };
    const actorA = { kind: 'user' as const, userId: ACTOR_A };
    const actorB = { kind: 'user' as const, userId: ACTOR_B };

    expect(await stub.tryCheckIn(actorA, payload, idem)).toMatchObject({ ok: true });
    // B reuses A's client key — must execute (e.g. already checked in), not replay A's body blindly
    const second = await stub.tryCheckIn(actorB, payload, idem);
    expect(second.ok).toBe(false);
    expect(second).not.toEqual({ ok: true });
  });

  // T9 — Q3 at HTTP: same idempotencyKey, permuted constituents → replay; one mapping
  it('T9: virtual type same key, permuted constituents → HTTP replay; one mapping row', async () => {
    const { stub } = await provisionedPropertyStub(`bb-vrt-${crypto.randomUUID()}`, 'UTC', 'USD');
    const propertyId = (await stub.readMetaPropertyId())!;
    for (const rt of ['rt_a', 'rt_b'] as const) {
      const input = {
        roomTypeId: rt,
        code: rt.toUpperCase(),
        name: rt,
        roomCount: 5,
        maxOccupancy: 2,
        maxAdults: 2,
      };
      expect(await stub.tryAddRoomType(TEST_OWNER_ACTOR, input, await idemFor(`seed-${rt}`, input))).toMatchObject({ ok: true });
    }

    const clientKey = `vrt-key-${crypto.randomUUID()}`;
    const postVirtual = (constituentRoomTypeIds: string[]) =>
      worker.fetch(
        new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/room-types`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-actor': ACTOR_A },
          body: JSON.stringify({
            roomTypeId: 'rt_vrt',
            code: 'VRT',
            name: 'Virtual',
            kind: 'virtual',
            maxOccupancy: 2,
            maxAdults: 2,
            constituentRoomTypeIds,
            idempotencyKey: clientKey,
          }),
        }),
        env,
      );

    const first = await postVirtual(['rt_a', 'rt_b']);
    expect(first.status).toBe(201);

    const replay = await postVirtual(['rt_b', 'rt_a']);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ ok: true, roomTypeId: 'rt_vrt' });

    const rows = stub.execSqlForTest(
      `SELECT physical_room_type_id FROM room_type_constituent WHERE virtual_room_type_id = ? ORDER BY physical_room_type_id`,
      'rt_vrt',
    ) as Array<{ physical_room_type_id: string }>;
    expect(rows.map((r) => r.physical_room_type_id)).toEqual(['rt_a', 'rt_b']);
  });

  // T10 — malformed JSON on POST /v1/orgs
  it('T10: POST /v1/orgs body `{` → 400 invalid_json (not 500)', async () => {
    const res = await postOrgMalformed(ACTOR_A);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });
});
```

**Red on `main`:**
- T1–T5: no caps → **200** or success today
- T6: **17× `housekeeper` succeeds today** (Set-deduped to one kind) — not `invalid_kinds`
- T7: cancel then no-show same key → **200** replay today
- T8: B receives A's cached **200** today
- T9: **already green on `main`** (handler sorts `fpInput` today) — **Task 3 regression guard**. After `commandFingerprint(commandId, commandPayload)` it must still replay **201** (`handlePostRoomTypes` always `return json(result, 201)` on ok, including idempotent replay — see `promo-codes.spec.ts` / `reservations-routes.spec.ts`). If Task 3 fingerprints unsorted `commandPayload`, T9 becomes **409** — that is the Q3 failure. Do **not** change create status from 201 to 200 to satisfy a 200-assert.
- T10: `{` → **500** today

### Step 2 — Catalog lane test in `register.test.ts` (T11)

Add after existing catalog length assertion (~line 751):

```ts
  it('bulk array commands and night_audit.run declare INTERACTIVE lane (Q11)', () => {
    for (const id of ['rates.bulk_update', 'rooms.bulk_update_status', 'night_audit.run'] as const) {
      expect(COMMAND_CATALOG.find((c) => c.id === id)?.lane).toBe('INTERACTIVE');
    }
  });
```

**Red on `main`:** three commands still `BULK` / `BACKGROUND`.

### Step 3 — `commandFingerprint` unit test in `idempotency.test.ts` (T12)

Add import `commandFingerprint` and new describe block:

```ts
describe('commandFingerprint (N2)', () => {
  it('T12: cancel vs no-show same reservationId → different digests', async () => {
    const reservationId = 'res_alias_test';
    const cancel = await commandFingerprint('reservations.cancel', { reservationId });
    const noShow = await commandFingerprint('reservations.no_show', { reservationId });
    expect(cancel).not.toBe(noShow);
    expect(cancel).toMatch(/^[a-f0-9]{64}$/);
  });

  it('includes commandId — payload-only hash differs', async () => {
    const payload = { reservationId: 'res_x' };
    const withCommand = await commandFingerprint('reservations.cancel', payload);
    const payloadOnly = await fingerprintPayload(payload);
    expect(withCommand).not.toBe(payloadOnly);
  });
});
```

**Red on `main`:** `commandFingerprint` export missing.

### Step 4 — Run vitest; confirm red

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts src/register.test.ts

pnpm --filter @hospai/pms-core exec vitest run test/bounded-bulk-idempotency.spec.ts
```

- [ ] T1–T8, T10 fail on `main` (or fail compile until Task 2/3 exports exist — run after stubs if needed)
- [ ] T9 **already green on `main`** — keep passing through Task 3 (regression guard for Q3 / **201** replay)
- [ ] T11 fails on `main` (lane mismatch)
- [ ] T12 fails on `main` (`commandFingerprint` missing)
- [ ] Do **not** change production code in this task

### Step 5 — Commit (tests only)

```bash
git add \
  apps/pms-core/test/bounded-bulk-idempotency.spec.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/contracts/src/register.test.ts
git commit -m "$(cat <<'EOF'
test: bounded bulk, JSON parse, idempotency characterization (red)

Add T1–T12 specs for R0.8 caps, lane honesty, commandFingerprint,
user-scoped idempotency, Q3 constituents, and invalid_json. Fail on main.
EOF
)"
```

---

## Task 2 — Caps, catalog INTERACTIVE, `parseRequestJson`

**Files:**
- Create: `packages/contracts/src/request-limits.ts`
- Modify: `packages/contracts/src/commands/catalog.ts` (3 lane fields)
- Modify: `packages/contracts/src/index.ts` (re-export limits)
- Create: `apps/pms-core/src/parse-request-json.ts`
- Modify: `apps/pms-core/src/index.ts` (SyntaxError → 400 safety net)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (HTTP caps, `parseRequestJson` migration, `readOptionalJsonBody`)
- Modify: `apps/pms-core/src/property-do.ts` (RPC caps in `tryBulkUpdateRates`, `tryBulkUpdateRoomStatus`, `trySplitFolioLine`)
- Modify: `apps/pms-core/src/org-do.ts` (roster kinds cap in `tryCreateRoster`, `tryUpdateRoster`)

**Interfaces:**

```ts
// packages/contracts/src/request-limits.ts
export const RATES_BULK_UPDATE_MAX = 500 as const;
export const ROOMS_BULK_STATUS_MAX = 200 as const;
export const FOLIO_SPLIT_MAX = 20 as const;
export const ROSTER_KINDS_MAX = 16 as const;

// apps/pms-core/src/parse-request-json.ts
/** Malformed JSON → Response 400 invalid_json. Empty body → null. No Content-Type gate. */
export async function parseRequestJson(request: Request): Promise<unknown | Response | null>;
```

### Step 0 — Contracts: `request-limits.ts` + re-export

Create `packages/contracts/src/request-limits.ts` per spec §2.1. Add `export * from './request-limits.js'` to `packages/contracts/src/index.ts`.

- [ ] Constants match locked caps exactly

### Step 1 — Catalog lane correction (Q11)

In `packages/contracts/src/commands/catalog.ts`, change **lane only**:

| `id` | `lane` (before → after) |
|---|---|
| `rates.bulk_update` | `BULK` → **`INTERACTIVE`** |
| `rooms.bulk_update_status` | `BULK` → **`INTERACTIVE`** |
| `night_audit.run` | `BACKGROUND` → **`INTERACTIVE`** |

- [ ] **`COMMAND_CATALOG.length` remains 89** — no add/remove rows
- [ ] T11 (`register.test.ts`) green after this step

### Step 2 — HTTP array caps

In `v1-dispatch.ts`, import `LIMIT_EXCEEDED` and cap constants. **Before** fingerprint / DO invoke:

```ts
if (body.updates.length > RATES_BULK_UPDATE_MAX) {
  return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
}
```

Apply at:
- `handlePostRatesBulk` — `updates.length > RATES_BULK_UPDATE_MAX`
- `handlePostRoomsBulkStatus` — `updates.length > ROOMS_BULK_STATUS_MAX`
- `handlePostFolioSplit` — `splits.length > FOLIO_SPLIT_MAX`
- `handlePostRoster` — `kinds.length > ROSTER_KINDS_MAX` **before** kind validation (`PHASE1_ROSTER_KINDS` / `invalid_kinds`)
- `handlePatchRoster` — when `body.kinds !== undefined`, same cap (length check before kind validation)

- [ ] Empty-array contracts unchanged (`invalid_body` where today)
- [ ] T1, T3, T5 (HTTP), T6 green

### Step 3 — RPC array caps

**PropertyDO** — early return before `transactionSync`:

```ts
if (input.updates.length > RATES_BULK_UPDATE_MAX) {
  return { ok: false, error: LIMIT_EXCEEDED };
}
```

Locations:
- `tryBulkUpdateRates` (~14148)
- `tryBulkUpdateRoomStatus` (~7114)
- `trySplitFolioLine` (~15418) — `input.splits.length > FOLIO_SPLIT_MAX`

**OrgDO** — in `tryCreateRoster` / `tryUpdateRoster` before mutation:

```ts
if (input.kinds.length > ROSTER_KINDS_MAX) {
  return { ok: false, error: LIMIT_EXCEEDED };
}
```

- [ ] T2, T4, T5 (RPC) green

### Step 4 — `parseRequestJson` + index safety net

Create `apps/pms-core/src/parse-request-json.ts` per spec §2.3:

```ts
export async function parseRequestJson(
  request: Request,
): Promise<unknown | Response | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
}
```

In `apps/pms-core/src/index.ts` catch block (~74–83), before rethrow:

```ts
} catch (e) {
  if (e instanceof SyntaxError) {
    const response = applySecurityHeaders(json({ error: 'invalid_json' }, 400), request);
    logHttpRequest(ctx, request, 400, started);
    return response;
  }
  // existing log + throw
}
```

- [ ] **No Content-Type gate** in helper or `readOptionalJsonBody`
- [ ] T10 green (minimum acceptance)

### Step 5 — Migrate mutating handlers to `parseRequestJson`

Replace `(await ctx.request.json()) as T` **only where that pattern exists today** in mutating `/v1` handlers in `v1-dispatch.ts`:

```ts
const raw = await parseRequestJson(ctx.request);
if (raw instanceof Response) return raw;
if (raw === null) return json({ error: 'invalid_body' }, 400);
const body = raw as ExpectedType;
```

**Do not** wrap header-only status routes (`handlePostReservationStatusAction` — no-show, cancel-check-in, etc.): they use `requireIdempotencyHeader` and never call `request.json()`. T7 no-show has **no JSON body**; wrapping with `parseRequestJson` + empty → `invalid_body` would break them.

**Start with** `handlePostOrgs` (~1187) — T10 target.

**Fix `readOptionalJsonBody`** (~1032):

```ts
async function readOptionalJsonBody(request: Request): Promise<Record<string, unknown> | null | Response> {
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
}
```

Update check-in/out callers to propagate `Response` from `readOptionalJsonBody`.

- [ ] Reads with no body unchanged
- [ ] Malformed non-empty JSON on check-in/out → **400** `invalid_json`, not silent `null`

### Step 6 — Focused test run (Task 2 scope)

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts

pnpm --filter @hospai/pms-core exec vitest run test/bounded-bulk-idempotency.spec.ts
```

- [ ] T1–T6, T10, T11 green
- [ ] T7–T8 still red (Task 3); T9 already green (must stay **201** replay after Task 3)
- [ ] T12 still red until Task 3 Step 1

```bash
pnpm typecheck
```

### Step 7 — Commit

```bash
git add \
  packages/contracts/src/request-limits.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/commands/catalog.ts \
  apps/pms-core/src/parse-request-json.ts \
  apps/pms-core/src/index.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/org-do.ts
git commit -m "$(cat <<'EOF'
fix: cap bulk arrays, honest catalog lanes, parseRequestJson (R0.8)

Enforce HTTP+RPC limits (500/200/20/16); Q11 INTERACTIVE lanes;
shared JSON parse → 400 invalid_json; index SyntaxError safety net.
EOF
)"
```

---

## Task 3 — `commandFingerprint`, Q3, required-`actor` `runIdempotent`

**Files:**
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/idempotency.test.ts` (T12 already added — green after export)
- Modify: `packages/do-runtime/src/idempotency.ts`
- Modify: `packages/do-runtime/src/outbox-idempotency.test.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` (fingerprints + Q3 virtual sort)
- Modify: `apps/pms-core/src/property-do.ts` (`runIdempotent(..., actor)` every call site)
- Modify: `apps/pms-core/src/org-do.ts` (`runIdempotent(..., actor)` every call site)
- Modify: `apps/pms-core/test/fixtures.ts` (`idemFor` / command simulation)

**Interfaces:**

```ts
// packages/contracts/src/idempotency.ts
export async function commandFingerprint(
  commandId: string,
  payload: unknown,
): Promise<string>;

// packages/do-runtime/src/idempotency.ts
export function scopeIdempotencyKey(
  actor: { kind: 'user'; userId: string } | { kind: 'system'; reason?: string },
  clientKey: string,
): string;

export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => Sync<T>,
  actor: ActorContext, // REQUIRED — no optional scope?
): T;
```

### Step 0 — `commandFingerprint` in contracts

Add to `packages/contracts/src/idempotency.ts`:

```ts
/** Idempotency fingerprint for a catalog command + the exact payload sent to try*. */
export async function commandFingerprint(
  commandId: string,
  payload: unknown,
): Promise<string> {
  return fingerprintPayload({ commandId, payload });
}
```

- [ ] Re-exported via `index.ts` (already `export * from './idempotency.js'`)
- [ ] T12 green

### Step 1 — Replace handler fingerprint calls (N2)

In `v1-dispatch.ts`, **grep** `fingerprintPayload(` and replace every idempotent command path with:

```ts
const fingerprint = await commandFingerprint(opts.commandId, commandPayload);
```

where `commandPayload` is the **exact object** passed to `try*`.

**Six-route alias surface** — must include `commandId` in fingerprint:
- `handlePostReservationCancel` → `commandFingerprint('reservations.cancel', { reservationId })`
- `handlePostReservationNoShow` / shared no-show helper → `reservations.no_show` | `reservations.cancel_check_in`
- `handlePostReservationConfirm` → include `ratePlanId` in payload when present
- check-in/out → include `roomId` / `overrideCleanliness` / `overrideBalance` when present

**Bulk paths** (Task 2 caps already landed):
- `handlePostRatesBulk` → `commandFingerprint('rates.bulk_update', commandPayload)`
- `handlePostRoomsBulkStatus` → `commandFingerprint('rooms.bulk_update_status', commandPayload)`
- `handlePostFolioSplit` → `commandFingerprint('folio.split_charge', commandPayload)`
- Roster → `commandFingerprint('roster.add' | 'roster.update', …)`

Keep `fingerprintPayload` for non-command hashes (config KV, provision meta) — do not wrap those in `commandFingerprint`.

- [ ] T7 green after cancel/no-show fix

### Step 2 — Q3 virtual room type constituent identity

**Create (`handlePostRoomTypes`):** when `kind === 'virtual'`:

```ts
const sortedConstituents = [...body.constituentRoomTypeIds!].sort((a, b) => a.localeCompare(b));
// fpInput and commandPayload both use sortedConstituents (same reference)
const commandPayload = { /* … */, constituentRoomTypeIds: sortedConstituents };
const fingerprint = await commandFingerprint('inventory.add_room_type', commandPayload);
```

**Update (`handlePutRoomType`):** when `body.constituentRoomTypeIds !== undefined`:

```ts
const sortedConstituents = [...body.constituentRoomTypeIds].sort((a, b) => a.localeCompare(b));
const commandPayload = { /* … */, constituentRoomTypeIds: sortedConstituents };
const fingerprint = await commandFingerprint('inventory.update_room_type', commandPayload);
```

- [ ] T9 green — HTTP POST permuted constituents replays **201** (same as create; `handlePostRoomTypes` always 201 on ok); one canonical `room_type_constituent` row. Regression guard: unsorted `commandPayload` fingerprint → **409**, not a 200/201 mismatch fix.

### Step 3 — `scopeIdempotencyKey` + required-`actor` `runIdempotent` (S6)

In `packages/do-runtime/src/idempotency.ts`:

```ts
import type { ActorContext } from '@hospai/contracts';

export function scopeIdempotencyKey(
  actor: ActorContext,
  clientKey: string,
): string {
  if (actor.kind === 'user') return `${actor.userId}:${clientKey}`;
  return `system:${clientKey}`;
}

export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => Sync<T>,
  actor: ActorContext,
): T {
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  // SELECT/INSERT use storageKey; idem.fingerprint unchanged
}
```

**Call-site sweep:** grep `runIdempotent(` in:
- `apps/pms-core/src/property-do.ts` (~68 sites)
- `apps/pms-core/src/org-do.ts` (~8 sites)
- `packages/do-runtime/src/outbox-idempotency.test.ts`
- any pms-core test helpers invoking `runIdempotent` directly

Pass the same `actor` already in scope for each `try*`:

```ts
runIdempotent(this.ctx.storage.sql, idem, () => { /* … */ }, actor);
```

- [ ] Forgotten call site **fails compile** (required 4th param)
- [ ] Client-visible `idem.key` unchanged; D1 provisional rows unchanged
- [ ] T8 green

### Step 4 — Unit tests for scope keys

Add to `packages/do-runtime/src/outbox-idempotency.test.ts`:

```ts
import { scopeIdempotencyKey, runIdempotent } from './idempotency.js';

describe('scopeIdempotencyKey (S6)', () => {
  it('user keys are prefixed with userId', () => {
    expect(scopeIdempotencyKey({ kind: 'user', userId: 'u1' }, 'K')).toBe('u1:K');
    expect(scopeIdempotencyKey({ kind: 'user', userId: 'u2' }, 'K')).toBe('u2:K');
  });

  it('system keys use system: prefix', () => {
    expect(scopeIdempotencyKey({ kind: 'system', reason: 'night_audit' }, 'K')).toBe('system:K');
  });

  it('same client key, different users → independent idempotency rows', () => {
    const sql = new OutboxMemorySql();
    const idem = { key: 'shared', fingerprint: 'fp1' };
    runIdempotent(sql, idem, () => ({ ok: true, who: 'A' }), { kind: 'user', userId: 'user_a' });
    let runs = 0;
    const second = runIdempotent(
      sql,
      idem,
      () => {
        runs += 1;
        return { ok: true, who: 'B' };
      },
      { kind: 'user', userId: 'user_b' },
    );
    expect(second).toEqual({ ok: true, who: 'B' });
    expect(runs).toBe(1);
  });
});
```

Update existing `runIdempotent` calls in same file to pass a test actor.

### Step 5 — Update `fixtures.ts` for command idempotency tests

Migrate command-simulation helpers to fingerprint with `commandId`:

```ts
import { commandFingerprint } from '@hospai/contracts';

export async function idemForCommand(commandId: string, key: string, payload: unknown) {
  return { key, fingerprint: await commandFingerprint(commandId, payload) };
}
```

Keep `idemFor` for non-command paths (provision meta, config). **Grep** test files that call `try*` after this vertical — update to `idemForCommand` where DO now expects command-scoped fingerprints. Run full pms-core shards after bulk update.

- [ ] Existing specs green (no inverted bug expectations)

### Step 6 — Focused test run (Task 3 scope)

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts

pnpm --filter @hospai/do-runtime exec vitest run src/outbox-idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run test/bounded-bulk-idempotency.spec.ts
```

- [ ] T1–T12 green
- [ ] `property-do.spec.ts` fingerprint conflict test still green (uses payload-only config path)

```bash
pnpm typecheck
```

### Step 7 — Commit

```bash
git add \
  packages/contracts/src/idempotency.ts \
  packages/do-runtime/src/idempotency.ts \
  packages/do-runtime/src/outbox-idempotency.test.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/src/org-do.ts \
  apps/pms-core/test/fixtures.ts
git commit -m "$(cat <<'EOF'
fix: command-scoped fingerprints and user-scoped idempotency (R0.8)

Add commandFingerprint; require actor on runIdempotent with scoped storage
keys; Q3 virtual constituent sort identity (N2/S6/Q3).
EOF
)"
```

---

## Task 4 — Full CI + tick R0.8

**Files:** `docs/roadmap.md` (R0.8 checkbox only)

### Step 1 — Named vitest files (slice)

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts src/register.test.ts

pnpm --filter @hospai/do-runtime exec vitest run src/outbox-idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run test/bounded-bulk-idempotency.spec.ts
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

### Step 5 — Tick roadmap R0.8

In `docs/roadmap.md` line ~184, change:

```markdown
- [ ] **R0.8** Audit V8 — N3, X1, P5, N10, Q11, N2, S6, Q3. ...
```

to:

```markdown
- [x] **R0.8** Audit V8 — N3, X1, P5, N10, Q11, N2, S6, Q3. ...
```

**Do not tick R0.8 before this task.**

### Step 6 — Commit

```bash
git add docs/roadmap.md
git commit -m "$(cat <<'EOF'
chore: tick R0.8 after bounded bulk + idempotency hardening

Full CI checks and pms-core shards green; audit N3/X1/P5/N10/Q11/N2/S6/Q3 closed.
EOF
)"
```

---

## Test matrix (spec §4 — mapped to tasks)

| # | File | Task | Expect on fixed code | Red on `main`? |
|---|---|---|---|---|
| T1 | `bounded-bulk-idempotency.spec.ts` | 1–2 | Rates bulk **501** → **422** `limit_exceeded` | Yes |
| T2 | same | 1–2 | `tryBulkUpdateRates` **501** → RPC **422** | Yes |
| T3 | same | 1–2 | Rooms bulk **201** → **422** HTTP | Yes |
| T4 | same | 1–2 | `tryBulkUpdateRoomStatus` **201** → RPC **422** | Yes |
| T5 | same | 1–2 | Folio split **21** → **422** HTTP + RPC | Yes |
| T6 | same | 1–2 | Roster POST **17× `housekeeper`** → **422** HTTP | Yes |
| T7 | same | 1–3 | Cancel then no-show same key → **409** `idempotency_key_reused` | Yes |
| T8 | same | 1–3 | User B same key as A → not A's cached **200** | Yes |
| T9 | same | 1–3 | HTTP POST virtual `[a,b]` then `[b,a]` same key → **201** replay; one mapping | No (green on `main`; Task 3 regression guard) |
| T10 | same | 1–2 | `POST /v1/orgs` body `{` → **400** `invalid_json` | Yes |
| T11 | `register.test.ts` | 1–2 | Three commands **INTERACTIVE** | Yes |
| T12 | `idempotency.test.ts` | 1–3 | `commandFingerprint` cancel ≠ no-show | Yes |

---

## Success criteria (spec §9)

1. Rates bulk **501** → **422** at HTTP and RPC (**N3**).
2. Rooms bulk **201** → **422** at HTTP and RPC (**X1**).
3. Folio split **21** and roster **17** kinds → **422** (**P5**).
4. Catalog lanes for `rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run` are **INTERACTIVE** (**Q11**).
5. Malformed JSON on `POST /v1/orgs` → **400** `invalid_json`, not 500 (**N10**).
6. Same key cancel → no-show → **409** `idempotency_key_reused` (**N2**).
7. Operator B cannot replay operator A's idempotency cache (**S6**).
8. Virtual room type: sorted constituents in fingerprint **and** DO payload (**Q3**).
9. Pins unchanged except allowed lane fields; **`COMMAND_CATALOG.length === 89`**.
10. `pnpm test:local` green.

---

## Plan vs codebase notes (reviewer)

| Item | Notes |
|---|---|
| `commandFingerprint` / cap constants not on `main` | Task 1 tests import them; compile fails until Task 2/3 Step 0 — acceptable for tests-only commit. |
| `runIdempotent` 3-arg today | Task 3 adds required `actor` — grep all call sites in property-do + org-do + do-runtime tests. |
| ~80+ `request.json()` sites | Task 2 Step 5 migrates mutating handlers; reads unchanged. |
| `idemFor` payload-only | Task 3 adds `idemForCommand`; bulk-update tests calling `try*` directly may need migration. |
| T8 assertion | Second user gets domain failure (already checked in), not replay of A's `{ ok: true }` — adjust message if check-in error code differs, but **must not** equal A's success replay. |
| T6 roster kinds | OrgDO `PHASE1_ROSTER_KINDS = ['housekeeper']` only — use **17× `housekeeper`**, not invented kind strings; HTTP cap check **before** `invalid_kinds`. |
| T9 Q3 | HTTP-only (`POST /room-types`); same `idempotencyKey`, permuted `constituentRoomTypeIds` — not direct `tryAddRoomType` with divergent fingerprints. Replay status **201** (not 200). Already green on `main`; fails Task 3 if `commandFingerprint` uses unsorted `commandPayload` → **409**. |
| Header-only status routes | `handlePostReservationStatusAction` — no `parseRequestJson`; T7 no-show has no body. Task 2 replaces `(await ctx.request.json())` sites only. |
| Optional `lane-guard.spec.ts` | Document-only regression that three commands still use `touchInteractive()` — not required for R0.8 tick. |
| Guest batch cap **50** | Unchanged — out of scope. |
