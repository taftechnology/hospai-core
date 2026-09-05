# Bounded bulk, JSON parse, idempotency hardening (R0.8)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 8](../../audit/2026-09-04-full-codebase-audit.md) (**N3**, **X1**, **P5**, **N10**, **Q11**, **N2**, **S6**, **Q3**); [AGENTS.md §1 idempotency / §3 bounded input](../../../AGENTS.md); `packages/contracts/src/idempotency.ts` (`fingerprintPayload`, `IDEM_KEY_REUSED`); `apps/pms-core/src/command-envelope.ts`; `apps/pms-core/src/v1-dispatch.ts` (bulk handlers, roster `kinds`, reservation fingerprints); `apps/pms-core/src/property-do.ts` (`tryBulkUpdateRates` ~14148, `tryBulkUpdateRoomStatus` ~7114, `trySplitFolioLine` ~15418); `packages/contracts/src/commands/catalog.ts` (`rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run` lane rows); `packages/do-runtime/src/idempotency.ts` (`runIdempotent`); `apps/pms-core/src/index.ts` (bodiless 500 on JSON throw).

**Closes:** Audit **N3** (`rates.bulk_update` uncapped), **X1** (`rooms.bulk_update_status` uncapped), **P5** (`folio.split` + roster `kinds` uncapped), **N10** (blind `request.json()` → 500), **Q11** (catalog BULK/BACKGROUND vs `touchInteractive()`), **N2** (payload-only fingerprints alias distinct commands), **S6** (idempotency key per-property not per-user), **Q3** (virtual type constituents sorted for fingerprint but unsorted to DO). **Roadmap:** **R0.8**. **Requires:** rate plans bulk, rooms bulk status, folio split, roster, virtual room types shipped. **Does not** advance R0.9 (replay permission), R1.7 DOW bulk UI (UI only — must respect caps), Playwright, PropertyDO extraction, real BULK chunking / `bulkDeadline()`.

---

## Executive summary

Four INTERACTIVE bulk paths accept **uncapped** request arrays today (`rates.bulk_update` `updates`, `rooms.bulk_update_status` `updates`, `folio.split_charge` `splits`, roster `kinds` on create/patch). Malformed JSON on ~82 mutating handlers throws through `index.ts` as a **500**. Idempotency fingerprints hash **payload only**, so the same client key on `/cancel` then `/no-show` replays the first command’s cached 200. Idempotency rows are keyed **per property DO** with the raw client key — operator B can replay operator A’s success. Virtual room types sort `constituentRoomTypeIds` for the fingerprint but send the **unsorted** body array to `tryAddRoomType` / `tryUpdateRoomType`, forking semantics under key reuse.

This spec locks **HTTP + RPC array caps** (same numbers), a **shared JSON parse helper** (`400 invalid_json`), **command-scoped fingerprints** `{ commandId, payload }` at one helper, **user-scoped idempotency keys** at the `runIdempotent` boundary, **catalog lane honesty** (three commands → **INTERACTIVE** until chunking exists), and **Q3 payload/fingerprint identity** for virtual constituents. **No new catalog commands.** **Catalog length stays 89** (lane field edits only). **Tests land first** and must fail on current `main`.

---

## Locked product call

1. **Caps (HTTP and RPC, same numbers):** `rates.bulk_update` **500** updates; `rooms.bulk_update_status` **200** updates; `folio.split_charge` **20** splits; roster `kinds` **16** on create/patch. Over cap → **422** `{ ok: false, error: 'limit_exceeded' }` (wire code `limit_exceeded` from `packages/contracts/src/entitlements.ts`). Re-assert inside `tryBulkUpdateRates`, `tryBulkUpdateRoomStatus`, `trySplitFolioLine`, and OrgDO roster `try*`.
2. **Q11:** Change catalog `lane` for `rates.bulk_update`, `rooms.bulk_update_status`, and `night_audit.run` to **INTERACTIVE** to match `touchInteractive()` runtime. **Do not** implement chunking or call `bulkDeadline()` this slice.
3. **N10:** Shared JSON parse helper → **400** `{ error: 'invalid_json' }` on **malformed** body only. **Must not** reject requests solely because `Content-Type` is missing or not `application/json` (today `request.json()` does not require that header). Empty body → `null` sentinel; handler returns **`invalid_body`** where that is today’s contract. Minimum: `POST /v1/orgs` with body `{` is **400**, not 500. Roll helper through mutating `/v1` handlers; do not invent a third JSON parser.
4. **N2:** Fingerprint `SHA-256(canonicalJson({ commandId, payload }))` via a **single** `commandFingerprint(commandId, payload)` helper. Same `Idempotency-Key` on `/cancel` then `/no-show` → **409** `{ ok: false, error: 'idempotency_key_reused' }`, not 200 echoing cancel. Include check-in/out when optionals omitted (alias surface is **six** reservation routes, not four).
5. **S6:** **Require** `actor` on every `runIdempotent` call; storage key is always `scopeIdempotencyKey(actor, idem.key)` so operator B cannot replay A’s cached 200. Optional `scope?` is forbidden — a forgotten call site must not compile. Client-visible `idem.key` unchanged.
6. **Q3:** Sort `constituentRoomTypeIds` **once** at the HTTP handler; fingerprint and `commandPayload` / `tryAddRoomType` / `tryUpdateRoomType` use that **same** sorted array.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Rates bulk cap** | `updates.length` ≤ **500** at HTTP (`handlePostRatesBulk`) and RPC (`tryBulkUpdateRates`). |
| **Rooms bulk cap** | `updates.length` ≤ **200** at HTTP (`handlePostRoomsBulkStatus`) and RPC (`tryBulkUpdateRoomStatus`). |
| **Folio split cap** | `splits.length` ≤ **20** at HTTP (`handlePostFolioSplit`) and RPC (`trySplitFolioLine`). |
| **Roster kinds cap** | `kinds.length` ≤ **16** at HTTP (`handlePostRoster`, `handlePatchRoster` when `kinds` present) and OrgDO roster RPC. |
| **Over cap** | **422** `limit_exceeded` (`LIMIT_EXCEEDED`). Existing `commandErrorHttpStatus` table — no fifth mapper. |
| **Q11 lanes** | `rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run`: catalog `lane: 'INTERACTIVE'`. Runtime stays `touchInteractive()`. **No** chunking. **`COMMAND_CATALOG.length` stays 89.** |
| **JSON helper** | One module (`parseRequestJson`). Read `request.text()`; **no** `Content-Type` gate (missing or non-`application/json` must not → **400** `invalid_json`). Malformed non-empty JSON → **400** `invalid_json`. Empty body → `null`; handler → **`invalid_body`** per existing contract. `index.ts` SyntaxError safety net stays. `readOptionalJsonBody`: malformed non-empty JSON → **400**, not swallow. No zod-per-route this slice. |
| **N2 fingerprint** | `commandFingerprint(commandId, commandPayload)` in `@hospai/contracts`; replaces direct `fingerprintPayload(commandPayload)` on **all** idempotent HTTP → DO paths. |
| **Six-route alias** | `reservations.cancel`, `reservations.no_show`, `reservations.cancel_check_in`, `reservations.confirm` (body without `ratePlanId`), `reservations.check_in` / `reservations.check_out` when optional fields omitted — must not share fingerprint across different `commandId`. |
| **S6 scope** | **Required** `actor` param on `runIdempotent`; storage key always `scopeIdempotencyKey(actor, idem.key)`. User: `${userId}:${clientKey}`. System: `system:${clientKey}` (night audit / workflow). Every PropertyDO / OrgDO call site passes `actor`. Client `idem.key` and D1 provisional row stay **unprefixed**. |
| **Q3** | Sorted constituents in **both** fingerprint input and DO payload for virtual create/update. |
| **Tests first** | Characterization specs fail on `main` before production edits. |
| **Out** | Playwright; PropertyDO extraction; real BULK chunking; guest batch cap (already 50 — unchanged). |

---

## 1. Problem / evidence

### 1.1 N3 / X1 / P5 — uncapped INTERACTIVE arrays (medium / high)

**Rates bulk** — HTTP accepts any `updates.length`; DO loops all rows in one `transactionSync`:

```5889:5918:apps/pms-core/src/v1-dispatch.ts
  const body = (await ctx.request.json()) as {
    updates: Array<{ ... }>;
    idempotencyKey: string;
  };
  if (!Array.isArray(body.updates) || body.updates.length === 0 || !body.idempotencyKey) {
    return json({ error: 'invalid_body' }, 400);
  }
  // no upper bound
  const normalized = body.updates.map(...).sort(...);
```

```14172:14204:apps/pms-core/src/property-do.ts
    this.lanes.touchInteractive();
    // ...
        runIdempotent(this.ctx.storage.sql, idem, () => {
          const normalized = input.updates.map(...).sort(...);
          for (const cell of normalized) { /* write each */ }
```

**Rooms bulk** — same pattern (`handlePostRoomsBulkStatus` ~4004, `tryBulkUpdateRoomStatus` ~7114): no cap on `updates.length`.

**Folio split** — `handlePostFolioSplit` (~5947) requires `splits.length > 0` only; `trySplitFolioLine` (~15482) reduces splits with no max.

**Roster kinds** — create sorts kinds but never caps:

```2127:2136:apps/pms-core/src/v1-dispatch.ts
  const kinds = [...body.kinds].sort();
  const fingerprint = await fingerprintPayload({ profile, kinds });
  // ...
      { profile: { ...profile, displayName: body.displayName }, kinds },
```

Audit **P5**: a hostile or buggy client can POST thousands of rate cells or room rows in one INTERACTIVE txn — CPU/time abuse on PropertyDO.

### 1.2 Q11 — catalog lane lies (medium)

Catalog today:

| Command | Catalog `lane` | Runtime |
|---|---|---|
| `rates.bulk_update` | **BULK** | `touchInteractive()` (~14172) |
| `rooms.bulk_update_status` | **BULK** | `touchInteractive()` (~7132) |
| `night_audit.run` | **BACKGROUND** | `touchInteractive()` (night-audit path) |

`bulkDeadline()` is **never** called in production. LaneGuard and degraded-mode docs assume catalog truth — the mismatch hides missing chunking.

### 1.3 N10 — JSON parse → 500 (medium)

`index.ts` catch rethrows on handler failure (~74–83). Handlers use blind `(await ctx.request.json()) as T` (~80+ sites in `v1-dispatch.ts`). Truncated body `{` on `POST /v1/orgs` (~1188) throws `SyntaxError` → **500** with no JSON body.

`handlePostDemoSeed` (~1219) catches parse errors locally → `invalid_body` — inconsistent. Check-in/out use `readOptionalJsonBody` (~1032) which **swallows** parse errors → `null` (silent), not `invalid_json`.

### 1.4 N2 — payload-only fingerprint aliases commands (medium)

Cancel fingerprints payload only:

```2584:2599:apps/pms-core/src/v1-dispatch.ts
  const fingerprint = await fingerprintPayload({ reservationId });
  // commandId: 'reservations.cancel'
  // ...
      resolvedCtx.resolved.stub.tryCancelReservation(actor, commandPayload, {
        key: body.idempotencyKey,
        fingerprint,
      }),
```

No-show uses the same helper with `{ reservationId }` only:

```2863:2876:apps/pms-core/src/v1-dispatch.ts
  const fingerprint = await fingerprintPayload({ reservationId });
  // commandId varies: reservations.no_show | cancel_check_in | ...
```

Same client `Idempotency-Key` + same `reservationId` → **identical fingerprint** → second command replays first response (**409** required, today **200** echo).

**Six-route alias surface (audit):**

| Route | `commandId` | Payload when aliased |
|---|---|---|
| `post_reservation_cancel` | `reservations.cancel` | `{ reservationId }` |
| `post_reservation_no_show` | `reservations.no_show` | `{ reservationId }` |
| `post_reservation_cancel_check_in` | `reservations.cancel_check_in` | `{ reservationId }` |
| `post_reservation_confirm` | `reservations.confirm` | `{ reservationId }` when `ratePlanId` omitted |
| `post_reservation_check_in` | `reservations.check_in` | `{ reservationId }` when `roomId` / `overrideCleanliness` omitted |
| `post_reservation_check_out` | `reservations.check_out` | `{ reservationId }` when `overrideBalance` omitted |

Confirm **with** `ratePlanId`, check-in **with** `roomId`, etc. are **not** aliased — fingerprint includes those fields inside `payload`.

### 1.5 S6 — idempotency key not user-scoped (medium)

`runIdempotent` stores `idem.key` verbatim:

```29:44:packages/do-runtime/src/idempotency.ts
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, idem.key)
  // ...
  sql.exec(
    `INSERT INTO idempotency (key, request_fingerprint, response, created_at) VALUES (?, ?, ?, ?)`,
    idem.key,
```

PropertyDO is **per property**, not per user. Two clerks sharing a property can reuse the same client key and receive each other’s cached mutation result.

### 1.6 Q3 — virtual constituents sorted for hash, unsorted to DO (high)

Create virtual room type — fingerprint uses sorted ids; payload does not:

```1463:1485:apps/pms-core/src/v1-dispatch.ts
          constituentRoomTypeIds: [...body.constituentRoomTypeIds!].sort((a, b) => a.localeCompare(b)),
        }
  // ...
          constituentRoomTypeIds: body.constituentRoomTypeIds,
```

Update path (~1551–1564): same bug — sort in `payload` for fingerprint, raw `body.constituentRoomTypeIds` in `commandPayload`.

Same idempotency key + permuted constituent order → fingerprint matches sorted order → **replay** returns first write’s response, but a **different** semantic mapping could have been intended; worse, a partial replay path could apply unsorted order on first write. **Locked fix:** one sorted array reference for fingerprint **and** DO input.

---

## 2. Locked behaviour

### 2.1 Array caps — shared constants

Add to `packages/contracts/src/request-limits.ts` (new):

```ts
export const RATES_BULK_UPDATE_MAX = 500 as const;
export const ROOMS_BULK_STATUS_MAX = 200 as const;
export const FOLIO_SPLIT_MAX = 20 as const;
export const ROSTER_KINDS_MAX = 16 as const;
```

Re-export from `@hospai/contracts` index. **Same numbers** at HTTP validation and inside `try*` before mutation.

**HTTP pattern** (all four):

```ts
if (arr.length > CAP) return json({ ok: false, error: LIMIT_EXCEEDED }, 422);
```

Use `LIMIT_EXCEEDED` from `entitlements.ts` (already in `commandErrorHttpStatus` → **422**).

**RPC pattern** — early return inside `try*` (before `transactionSync`):

```ts
if (input.updates.length > RATES_BULK_UPDATE_MAX) {
  return { ok: false, error: LIMIT_EXCEEDED };
}
```

**Empty arrays:** unchanged — rates/rooms bulk still require `length > 0` at HTTP (`invalid_body`); split requires `splits.length > 0`; roster create still requires non-empty `kinds`.

**SPA / client:** first-party bulk UIs already below caps; R1.7 DOW fill must chunk client-side to ≤ **500** cells per request (document in R1.7 — not this slice’s UI work).

### 2.2 Q11 — catalog lane correction

In `packages/contracts/src/commands/catalog.ts`, same commit:

| `id` | `lane` (before → after) |
|---|---|
| `rates.bulk_update` | `BULK` → **`INTERACTIVE`** |
| `rooms.bulk_update_status` | `BULK` → **`INTERACTIVE`** |
| `night_audit.run` | `BACKGROUND` → **`INTERACTIVE`** |

Add/update catalog test in `register.test.ts`:

```ts
it('bulk array commands and night_audit.run declare INTERACTIVE lane (Q11)', () => {
  for (const id of ['rates.bulk_update', 'rooms.bulk_update_status', 'night_audit.run'] as const) {
    expect(requireCatalogEntry(id).lane).toBe('INTERACTIVE');
  }
});
```

**Forbidden this slice:** `touchBulk()`, `bulkDeadline()`, splitting bulk into multiple catalog commands, changing `COMMAND_CATALOG.length`.

### 2.3 N10 — `parseRequestJson`

New `apps/pms-core/src/parse-request-json.ts`:

```ts
/** Malformed JSON → Response 400 invalid_json. Empty body → null (handler invalid_body). No Content-Type gate. */
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

**Content-Type (reviewer lock):** `parseRequestJson` **must not** return **400** solely because `Content-Type` is absent or is not `application/json`. Today’s `request.json()` does not require that header; adding a gate would expand N10 into a new **400** class and can break first-party clients and tests that omit it. Only **malformed** non-empty JSON → **400** `invalid_json`.

**Wire code:** literal `'invalid_json'` (HTTP gate only — **not** added to DO command-error union).

**Migration order:**

1. **Safety net:** In `apps/pms-core/src/index.ts`, catch `SyntaxError` from `handleV1` and return **400** `{ error: 'invalid_json' }` (stops `{` → 500 even before handler migration).
2. **Mutating handlers:** Replace `(await ctx.request.json()) as T` with:
   ```ts
   const raw = await parseRequestJson(ctx.request);
   if (raw instanceof Response) return raw;
   if (raw === null) return json({ error: 'invalid_body' }, 400); // existing empty-body contract
   const body = raw as T; // existing field validation unchanged
   ```
   Handlers that today treat empty body differently keep that branch after the `null` check.
3. **`readOptionalJsonBody`:** On check-in/out, if body is non-empty but malformed → **400** `invalid_json` (stop swallowing parse errors). **Do not** add a `Content-Type` requirement here either.
4. **Reads with no body:** unchanged.

**Minimum acceptance test:** `POST /v1/orgs` with body `{` → **400** `invalid_json`.

**Out of scope:** zod per route; changing non-JSON endpoints.

### 2.4 N2 — `commandFingerprint`

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

**Single construction site:** every HTTP handler that today calls `fingerprintPayload(...)` for an idempotent DO invoke **must** call `commandFingerprint(opts.commandId, commandPayload)` where `commandPayload` is the **exact object** passed to `try*`.

**Tests and fixtures:** migrate `idemFor` / direct `fingerprintPayload` in idempotency tests to `commandFingerprint` when simulating command idempotency (keep `fingerprintPayload` for non-command hashes e.g. config KV).

**Replay / provisional:** `pending-commands-consumer.ts` stores `requestFingerprint` from the original HTTP envelope — after migration, stored fingerprint already includes `commandId`. **No** D1 migration; replays re-use stored fingerprint as today.

**409 mapping:** unchanged — `IDEM_KEY_REUSED` → **409** in existing mappers.

### 2.5 S6 — user-scoped storage keys

Add to `packages/do-runtime/src/idempotency.ts`:

```ts
export function scopeIdempotencyKey(
  actor: { kind: 'user'; userId: string } | { kind: 'system'; reason?: string },
  clientKey: string,
): string {
  if (actor.kind === 'user') return `${actor.userId}:${clientKey}`;
  return `system:${clientKey}`;
}
```

Change **`runIdempotent`** signature — **required** `actor` (reviewer lock; optional `scope?` forbidden):

```ts
export function runIdempotent<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  execute: () => Sync<T>,
  actor: ActorContext,
): T {
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  // use storageKey for SELECT/INSERT; idem.fingerprint unchanged
}
```

**Call sites:** every PropertyDO / OrgDO `runIdempotent(..., idem, execute, actor)` passes the same `actor` already in scope for the `try*`. `idem.key` remains the **client** key for audit logs and provisional rows. A forgotten call site must **fail to compile**, not silently use unprefixed `idem.key`.

**System actor:** night-audit and workflow paths use `system:${clientKey}` — prevents user/system cross-replay on the same client key.

**Not this slice:** replay permission re-check (**X2**, R0.9).

### 2.6 Q3 — virtual room type constituent identity

**Create (`handlePostRoomTypes`):** after validation, when `kind === 'virtual'`:

```ts
const sortedConstituents = [...body.constituentRoomTypeIds!].sort((a, b) => a.localeCompare(b));
// fpInput.constituentRoomTypeIds = sortedConstituents
// commandPayload.constituentRoomTypeIds = sortedConstituents  (same reference)
```

**Update (`handlePutRoomType`):** when `body.constituentRoomTypeIds !== undefined`:

```ts
const sortedConstituents = [...body.constituentRoomTypeIds].sort((a, b) => a.localeCompare(b));
payload.constituentRoomTypeIds = sortedConstituents;
commandPayload.constituentRoomTypeIds = sortedConstituents;
```

Fingerprint via `commandFingerprint('inventory.add_room_type' | 'inventory.update_room_type', commandPayload)`.

**DO:** `validateVirtualConstituentsSync` may still sort internally — HTTP order is already canonical.

---

## 3. Implementation steps

**Order: failing characterization tests on `main`, then production.**

### 3.1 Tests first (red on `main`)

**New `apps/pms-core/test/bounded-bulk-idempotency.spec.ts`**

| Case | Assert |
|---|---|
| Rates bulk `501` updates | HTTP **422** `limit_exceeded`; stub `tryBulkUpdateRates` with `501` → `{ ok: false, error: 'limit_exceeded' }` |
| Rooms bulk `201` updates | HTTP + RPC **422** |
| Folio split `21` splits | HTTP + RPC **422** |
| Roster create `17` kinds | HTTP **422** |
| Cancel then no-show, same header key | Second **409** `idempotency_key_reused` |
| User A check-in key `K`, user B same key | B gets fresh execution (not A’s cached body) — e.g. B fails `not_found` while A succeeded |
| Virtual create: same key, constituents `[a,b]` vs `[b,a]` | Second call **409** or identical success replay — **no** second distinct mapping row |
| `POST /v1/orgs` body `{` | **400** `invalid_json` |

**Update `packages/contracts/src/register.test.ts`**

- Catalog lane test (§2.2) — fails until catalog edit.

**Update `packages/contracts/src/idempotency.test.ts`**

- `commandFingerprint('reservations.cancel', { reservationId })` ≠ `commandFingerprint('reservations.no_show', { reservationId })`.

**Optional `apps/pms-core/test/lane-guard.spec.ts`**

- Document-only: no `touchBulk` regression for the three commands (lane metadata).

### 3.2 Production (green tests)

1. **`request-limits.ts`** + caps at HTTP + RPC (§2.1).
2. **Catalog lane** edits (§2.2).
3. **`parseRequestJson`** + index safety net + handler migration (§2.3).
4. **`commandFingerprint`** + replace handler fingerprint calls (§2.4).
5. **`scopeIdempotencyKey` / required-`actor` `runIdempotent`** (§2.5).
6. **Virtual room type handler fix** (§2.6).

### 3.3 Pins / gates

| Pin | This vertical |
|---|---|
| `COMMAND_CATALOG` length | **89** (lane-only edits) |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | **8**; `[3] === 'AUTO_TRANSFER'` |

Full gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` (8 shards; never `--` before `--shard`).

---

## 4. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `bounded-bulk-idempotency.spec.ts` | Seeded property | POST rates bulk with **501** cells | **422** `limit_exceeded` |
| T2 | same | Stub / HTTP | `tryBulkUpdateRates` **501** | **422** RPC |
| T3 | same | POST rooms bulk **201** | **422** HTTP |
| T4 | same | `tryBulkUpdateRoomStatus` **201** | **422** RPC |
| T5 | same | Folio split **21** | **422** HTTP + RPC |
| T6 | same | Roster POST **17** kinds | **422** HTTP |
| T7 | same | Cancel reservation key `K` | No-show same key | **409** `idempotency_key_reused` |
| T8 | same | User A check-in key `K` success | User B check-in key `K` | B not A’s cached 200 |
| T9 | same | Virtual type key `K`, `[rt_a, rt_b]` | Retry `[rt_b, rt_a]` | Replay/409; one mapping |
| T10 | same | — | `POST /v1/orgs` body `{` | **400** `invalid_json` |
| T11 | `register.test.ts` | — | Lane assertion | Three commands **INTERACTIVE** |
| T12 | `idempotency.test.ts` | — | `commandFingerprint` cancel vs no-show | Different digests |

Tests **T1–T10** must **fail on current `main`**.

---

## 5. Verify commands

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts src/register.test.ts

pnpm --filter @hospai/pms-core exec vitest run \
  test/bounded-bulk-idempotency.spec.ts
```

Full gate after implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

---

## 6. Files in scope

| File | Change |
|---|---|
| `packages/contracts/src/request-limits.ts` | **New** — cap constants |
| `packages/contracts/src/idempotency.ts` | `commandFingerprint` |
| `packages/contracts/src/idempotency.test.ts` | Fingerprint + command scope tests |
| `packages/contracts/src/commands/catalog.ts` | Q11 lane → INTERACTIVE (3 rows) |
| `packages/contracts/src/register.test.ts` | Lane assertion |
| `packages/contracts/src/index.ts` | Re-export limits + `commandFingerprint` |
| `packages/do-runtime/src/idempotency.ts` | `scopeIdempotencyKey`; `runIdempotent` requires `actor` |
| `packages/do-runtime/src/outbox-idempotency.test.ts` | Scope key unit tests |
| `apps/pms-core/src/parse-request-json.ts` | **New** — JSON helper |
| `apps/pms-core/src/index.ts` | SyntaxError → 400 safety net |
| `apps/pms-core/src/v1-dispatch.ts` | Caps, `parseRequestJson`, `commandFingerprint`, Q3 sort |
| `apps/pms-core/src/property-do.ts` | RPC caps; `runIdempotent(..., actor)` at every call site |
| `apps/pms-core/src/org-do.ts` | Roster RPC kinds cap; `runIdempotent(..., actor)` at every call site |
| `apps/pms-core/test/bounded-bulk-idempotency.spec.ts` | **New** — T1–T10 |
| `apps/pms-core/test/fixtures.ts` | `idemFor` → `commandFingerprint` where applicable |
| `apps/pms-core/test/virtual-room-types.spec.ts` | Q3 constituent order case (if not covered in new spec) |

**Not in scope:** `apps/web-pms` (SPA already chunks guest batch); `scripts/smoke-staging.mjs`; new HTTP routes; schema migrations; Playwright.

---

## 7. Pin freeze

This vertical **must not** change:

| Pin | Value |
|---|---|
| `COMMAND_CATALOG` length | **89** |
| `V1_HTTP_ROUTE_AUDIT` | **144** routes; last id `get_city_ledger_statement` (index 143) |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` |

Lane field edits on three existing catalog rows are **required** (Q11) and do not change catalog length.

No new dispatched command.

---

## 8. Out of scope

- Real BULK chunking, `touchBulk()`, `bulkDeadline()` (**future** vertical when chunking exists)
- **X2** provisional replay permission re-check (R0.9)
- **Q16** public API idempotency header/body documentation sweep
- **N11** idempotency/outbox retention sweep
- Guest batch cap **50** (already enforced — [desk freshness spec](./2026-09-05-desk-freshness-tape-cache-design.md))
- R1.7 DOW bulk UI (must respect **500** cap when built)
- Extracting PropertyDO
- Playwright / Cypress e2e
- zod-per-route validation

---

## 9. Success criteria

1. Rates bulk **501** → **422** at HTTP and RPC (**N3**).
2. Rooms bulk **201** → **422** at HTTP and RPC (**X1**).
3. Folio split **21** and roster **17** kinds → **422** (**P5**).
4. Catalog lanes for `rates.bulk_update`, `rooms.bulk_update_status`, `night_audit.run` are **INTERACTIVE** (**Q11**).
5. Malformed JSON on `POST /v1/orgs` → **400** `invalid_json`, not 500 (**N10**).
6. Same key cancel → no-show → **409** `idempotency_key_reused` (**N2**).
7. Operator B cannot replay operator A’s idempotency cache (**S6**).
8. Virtual room type: sorted constituents in fingerprint **and** DO payload (**Q3**).
9. Pins unchanged except allowed lane fields; **`COMMAND_CATALOG.length === 89`**.
10. `pnpm test:local` green.

---

## 10. Relationship to prior specs

- [2026-08-05-rate-plans-vertical-design.md](./2026-08-05-rate-plans-vertical-design.md) — `rates.bulk_update` normalize-before-sort; this slice adds **cap** only.
- [2026-08-05-rooms-housekeeping-vertical-design.md](./2026-08-05-rooms-housekeeping-vertical-design.md) — bulk room status; this slice adds **cap** + lane honesty.
- [2026-08-14-virtual-room-types-design.md](./2026-08-14-virtual-room-types-design.md) — constituent sort for fingerprint; this slice **closes Q3** (same array to DO).
- [2026-09-05-night-audit-clock-room-charges-design.md](./2026-09-05-night-audit-clock-room-charges-design.md) — explicitly **out of scope** for Q11; **this spec** owns catalog lane fix for `night_audit.run`.
- [2026-07-27-idempotency-outbox-design.md](./2026-07-27-idempotency-outbox-design.md) — `runIdempotent` shape; this slice adds **actor scope** at storage key only.

---

## 11. Error reference

| Condition | HTTP | Body |
|---|---|---|
| Array over cap | **422** | `{ ok: false, error: 'limit_exceeded' }` |
| Malformed JSON | **400** | `{ error: 'invalid_json' }` |
| Idempotency key reused, different fingerprint | **409** | `{ ok: false, error: 'idempotency_key_reused' }` |
| Empty bulk array / missing key | **400** | `{ error: 'invalid_body' }` (unchanged) |

Domain failures continue `{ ok: false, error }`; gates continue bare `{ error }` — no third envelope.
