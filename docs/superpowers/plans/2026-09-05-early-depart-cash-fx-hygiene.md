# Early departure, cash/FX hygiene, architecture write-down (R0.14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Approved (reviewer)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **L6**, **L9**, **L10**, **L11**, **L13**, **B3**, **Q12**, **Q16**, **Q21**, **Q22** (mechanical only), **N13**, **N14** — named **`reservations.early_depart`** command + Folio clerk path; shift expected cash and unattributed overlay in **ledger currency / business date**; partial FX refund via **`allocate` LAST**; far-future OOO **reject** (`ooo_beyond_horizon`); `freeAvailability` single import; reservation PATCH **`noPost`**; `FRONT_DESK_LIST_SELECT` extract; architecture/docs write-down — **without** releasing `sold` in `tryCheckOut`, auto-chain checkout, Playwright, Redis, PropertyDO extraction, schema migration, N11 sweep, X4 invite collapse, or blocking `pnpm audit` CI.

**Architecture:** Task 1 lands **red** L6 characterization tests (checkout sold invariant + early-depart contract). Task 2 implements L6 end-to-end (DO `tryEarlyDepart`, catalog **90**, route **145**, client, Folio SPA) and bumps pins in the **same commit**. Tasks 3–5 are independent money/OOO/hygiene/docs slices on frozen schema **34/9**. Task 6 runs full CI and ticks **R0.14** + **R3.4** only. **`tryCheckOut` must not gain `releaseSoldNightsSync`.**

**Tech Stack:** Cloudflare Workers + PropertyDO (`apps/pms-core`), `@hospai/contracts` catalog/routes, `@hospai/money` `allocate`, `@hospai/client-core`, React SPA (`apps/web-pms` / `FolioScreen`), vitest (pms-core **8 shards** local).

**Spec:** `docs/superpowers/specs/2026-09-05-early-depart-cash-fx-hygiene-design.md` (Status: Approved — normative).

---

## Frozen heads

| Pin | Start (Task 1) | After Task 2 | Tasks 3–6 |
|---|---|---|---|
| `COMMAND_CATALOG` length | **89** | **90** — append `reservations.early_depart` | **90** — frozen |
| `V1_HTTP_ROUTE_AUDIT` | length **144**; `[143].id === 'get_city_ledger_statement'` | length **145**; **`[144].id === 'post_reservation_early_depart'`** | **145** — frozen |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **64** — add `reservations.early_depart` | **64** — frozen |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration | **34** |
| `ORG_SCHEMA_HEAD` | **9** | **9** | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` | **8** — unchanged | **8** |
| `check:*` count | **17** (includes `check:resolve-property-prefetch`) | **17** — verify only | **17** — no new scripts |

Tree verified 2026-09-05 per spec (`register.test.ts`, `migrate.test.ts`). Only Task 2 bumps catalog/route/audit-writer pins.

---

## Locked behaviour (do not re-litigate)

| Lock | Decision |
|---|---|
| **L6 command** | `reservations.early_depart` — **not** a silent `tryCheckOut` change. Catalog: `lane: INTERACTIVE`, `degraded: FAIL_CLOSED`, `idempotent: true`, `entitlement: pms.core`, events: `reservation.modified`, `availability.changed`. **No** `reservation.status_changed`. Status stays **`checked_in`**. |
| **L6 HTTP** | `post_reservation_early_depart`, `POST /v1/properties/:propertyId/reservations/:reservationId/early-depart`, `permission: reservations:write`, `entitlement: pms.core`. Append **after** `post_reservation_check_out` in `V1_ROUTES` / audit. |
| **L6 inventory** | Stay nights `[arrival, departure)`. New `departure_date = readBusinessDateSync()`. Release `sold` for `[businessDate, oldDeparture)` via existing **`releaseSoldNightsSync`**. Guest remains `checked_in`. |
| **L6 gates** | Only when `status === 'checked_in'` **and** `departureDate > businessDate`. Else `not_early_departable` → **422** via `commandErrorHttpStatus`. |
| **L6 idempotency** | Same as check-out: header **`x-idempotency-key`** via `requireIdempotencyHeader`. Empty/absent JSON body OK (`readOptionalJsonBody`). Payload hashed **and** sent to DO is **`{ reservationId }` only**. DO resolves `businessDate` inside `transactionSync`. **Do not** use JSON `idempotencyKey` for this route. |
| **L6 HTTP handler** | `resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`. Mirror `handlePostReservationCheckOut` invoke/finish pattern. |
| **L6 SPA** | Folio **Early depart** when `departureDate > businessDate` and `checked_in`. `ConfirmDialog` (`.app-modal`). Success: invalidate **`['folio', propertyId, reservationId]`**, **`['board']` prefix**, tape via **`['front-desk-tape', propertyId, from, to]`** when range context known. **Do not** chain checkout. Keep U17 checkout warning. |
| **tryCheckOut** | **Forbidden:** add `releaseSoldNightsSync` or any sold release. Diff must show **no** inventory release in checkout path. |
| **L9** | `computeShiftExpectedCashSync`: sum **`folio_line.ledger_amount_minor`** (join PAYMENT line), not `payment.amount_minor`. Sign: verify against `cashiering.spec.ts` (payment lines negative — use `ABS` or consistent negation). |
| **L10** | `countUnattributedCashForBusinessDateSync`: filter by **`folio_line.business_date`**, not `date(created_at/1000,'unixepoch')`. |
| **L11** | Replace `Math.round(refundTxn * ledgerRatio)`. When `leftoverTxn > 0`: **`allocate(remainingLedger, [refundTxn, leftoverTxn], { policy: 'LAST' })[0]`**. When `leftoverTxn === 0`: **`ledgerRefundMinor = remainingLedger`** (all remaining ledger). **Do not** `allocate(refundTxn, [ledger])`. |
| **L13** | Pre-check nights in `[start, return)` (release path: skip). Missing `availability_day` row → **`ooo_beyond_horizon`** (422). Remove silent `if (d > horizonEnd) continue` on add path. **Do not** auto-extend horizon. |
| **Q12** | Import `freeAvailability` from `@hospai/contracts` in **`event-consumer.ts`** and **`v1-dispatch.ts`** `handleGetAvailability` fallback only. Delete inlines. |
| **B3** | Optional `noPost?: boolean` on **`patch_reservation`** body + fingerprint + `commandPayload`. **Not** `handlePatchGuest`. |
| **N14 availability** | `handleGetAvailability` → **`resolvePropertyContext` + `assertTenantActive`**. `handleGetProperty` / `handleGetRegistryProperty` keep current paths with **comment why** tenant-active skipped. |
| **N13** | Extend `events-queue.spec.ts` (preferred) with post-drain DLQ depth **0** assertion. |
| **N14 audit CI** | Document `pnpm audit --audit-level high` gap (9 high on 2026-09-05 tree). **No** blocking CI job this vertical. |
| **Docs** | ARCHITECTURE §11 amendments; AGENTS Q16 idempotency pointer; Q21 comment fixes; supply-chain footnote. |
| **Q22** | Delete dead exports only if grep shows **zero production importers**. `.ui-stack` rename only if mechanical. **Do not** delete `@hospai/temporal-utils` or change `@hospai/observability` test echo. |
| **X4 / N11** | **Do not touch** invite files. Outbox TTL sweep out of scope. |
| **Shards** | Local `pnpm test:local` → **8** shards. **Never put `--` before `--shard`.** |
| **Roadmap** | Tick **R0.14** and **R3.4** together in **Task 6 only**. |

**Out of scope:** Auto-chain checkout after early depart; auto-extend availability horizon; guest PATCH `noPost`; Playwright; Redis; PropertyDO split; schema migration; blocking supply-chain CI; delete `@hospai/temporal-utils`.

---

## Sequencing gate

```
Task 1 (L6 characterization tests — red)
→ Task 2 (L6 command + catalog 90 + HTTP 145 + client + Folio SPA)
→ Task 3 (L9 + L10 cashier SQL)
→ Task 4 (L11 FX allocate + L13 OOO horizon)
→ Task 5 (Q12, B3, FRONT_DESK_LIST_SELECT, N13, N14, Q21, ARCHITECTURE/AGENTS/Q16, Q22 if mechanical)
→ Task 6 (full CI + tick R0.14 and R3.4)
```

**TDD:** Task 1 commits tests-only (must **fail** on current `main` — `tryEarlyDepart` / route do not exist). Task 2 makes L6 green and bumps pins. Tasks 3–5 extend existing spec files with characterization tests where noted. Task 6 verifies full tree + roadmap only.

---

## File map (spec §14 — implementers touch these)

| File | Task | Change |
|---|---|---|
| `apps/pms-core/test/reservations-early-depart.spec.ts` | 1, 2 | **New** — L6 characterization + HTTP |
| `apps/pms-core/src/property-do.ts` | 2, 3, 4, 5 | `tryEarlyDepart`; L9/L10 SQL; L11 allocate; L13 horizon; `FRONT_DESK_LIST_SELECT` |
| `packages/contracts/src/commands/catalog.ts` | 2 | Append `reservations.early_depart` |
| `packages/contracts/src/v1-http-routes.ts` | 2 | Append `post_reservation_early_depart` after check-out |
| `packages/contracts/src/commands/audit-writers.ts` | 2 | Add `reservations.early_depart` |
| `packages/contracts/src/register.test.ts` | 2 | Pins **90** / **145** / audit writer **64** |
| `packages/contracts/src/idempotency.ts` (or wire-errors module) | 2 | `NOT_EARLY_DEPARTABLE = 'not_early_departable'` |
| `apps/pms-core/src/command-error-http-status.ts` (or shared mapper) | 2, 4 | Map `not_early_departable` → 422; `ooo_beyond_horizon` → 422 |
| `apps/pms-core/src/v1-dispatch.ts` | 2, 5 | `handlePostReservationEarlyDepart`; B3 `noPost`; Q12 import; N14 availability |
| `apps/pms-core/src/property-do.ts` (PropertyDO stub wiring) | 2 | Route RPC to `tryEarlyDepart` if separate dispatch table |
| `packages/client-core/src/api.ts` | 2 | `earlyDepart(propertyId, reservationId, opId)` — header key like `checkOut` |
| `packages/client-core/test/api-folio.test.ts` (or new) | 2 | Client sends `x-idempotency-key`; empty body OK |
| `apps/web-pms/src/screens/FolioScreen.tsx` | 2 | Early depart action + invalidation |
| `apps/web-pms/src/screens/FolioScreen.test.tsx` | 2 | Button visible; confirm; invalidate keys |
| `apps/pms-core/test/cashiering.spec.ts` | 3 | L9 ledger expected cash; L10 business-date unattributed |
| `apps/pms-core/test/folio-fx-payments.spec.ts` | 4 | L11 partial FX allocate invariant |
| `apps/pms-core/test/rooms-ooo.spec.ts` | 4 | L13 `ooo_beyond_horizon` |
| `apps/pms-core/src/event-consumer.ts` | 5 | Q12 `freeAvailability` import |
| `apps/pms-core/test/events-queue.spec.ts` | 5 | N13 DLQ depth assertion |
| `ARCHITECTURE.md` | 5 | §11 amendments; temporal-utils note; audit gap footnote |
| `AGENTS.md` | 5 | Q16 idempotency table pointer; supply-chain gap note |
| `packages/contracts/src/idempotency.ts` | 5 | Q21 comment fix |
| `packages/do-runtime/src/property-migrations.ts` | 5 | Q21 header comment |
| `docs/roadmap.md` | 6 | Tick **R0.14** + **R3.4** |

**Not touched:** `tryCheckOut` inventory path; invite/X4 files; `@hospai/temporal-utils` deletion; new `check:*` scripts; `PROPERTY_SCHEMA_HEAD` migration.

---

## Task 1 — L6 characterization tests (red, tests-only)

**Files:**
- Create: `apps/pms-core/test/reservations-early-depart.spec.ts`

**Interfaces (future — tests call DO directly or HTTP once handler exists; use `stub.tryEarlyDepart` / route id placeholders that Task 2 implements):**

```typescript
// DO (Task 2)
tryEarlyDepart(actor, { reservationId }, idem)
// HTTP (Task 2)
POST .../early-depart + x-idempotency-key; body optional empty
```

These tests **must fail on current `main`** (`tryEarlyDepart` missing; route absent).

### Step 1 — Fixture: 3-night stay, check in, sold on all nights

Use existing reservation lifecycle helpers (`book` → `confirm` → assign → `tryCheckIn` or HTTP equivalents). Assert `availability_day.sold >= 1` for each stay night.

- [ ] Fixture helper documented in spec file header

### Step 2 — Scenario: checkout alone does not release remaining sold

After check-in with `departureDate > businessDate`:

1. Call `tryCheckOut` (or assert it would succeed only after early depart in later scenario — here **without** early depart, either checkout blocked by balance or succeeds but **sold unchanged** on nights `[businessDate+1, oldDeparture)` per spec).

**Lock:** Assert **`sold` unchanged** on future nights when checkout runs without prior early depart (characterization of ARCHITECTURE §7.1 — today checkout does not release; test encodes desired invariant).

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-early-depart.spec.ts -t "checkout does not release"
```

Expected on `main`: **FAIL** once early-depart path needed for honest inventory — or pass checkout sold assertion while `tryEarlyDepart` test fails (see Step 3).

### Step 3 — Scenario: `tryEarlyDepart` shortens stay and releases sold

```typescript
// After check-in:
const result = await stub.tryEarlyDepart(actor, { reservationId }, idem);
expect(result).toEqual({ ok: true, reservationId });
// departure_date === businessDate; status === 'checked_in'
// sold released on [businessDate, oldDeparture)
```

Expected: **FAIL** — method missing.

### Step 4 — Scenario: checkout after early depart succeeds

After Step 3 succeeds (Task 2): `tryCheckOut` → `status === 'checked_out'`.

Expected on `main`: **FAIL** (blocked on Step 3).

### Step 5 — Idempotency replay

Same `{ reservationId }` fingerprint + same `x-idempotency-key` → cached success; **`sold` not double-decremented**.

Expected: **FAIL** until Task 2.

### Step 6 — `not_early_departable` gates

| Case | Expected |
|---|---|
| `status !== 'checked_in'` | `{ ok: false, error: 'not_early_departable' }` |
| `departure_date <= businessDate` | same |

Expected: **FAIL** until Task 2.

### Step 7 — Task 1 verification

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-early-depart.spec.ts
```

- [ ] Suite runs; **at least** early-depart / HTTP cases **FAIL** on `main`
- [ ] **No production code** in this commit
- [ ] Pin assertions still **89** / **144** (no catalog changes)

### Step 8 — Commit (implementer)

```bash
git add apps/pms-core/test/reservations-early-depart.spec.ts
git commit -m "test: R0.14 L6 early-depart characterization (red)"
```

---

## Task 2 — L6 command, catalog 90, HTTP 145, client, Folio SPA

**Files:**
- Modify: `apps/pms-core/src/property-do.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts`
- Modify: `packages/contracts/src/commands/catalog.ts`
- Modify: `packages/contracts/src/v1-http-routes.ts`
- Modify: `packages/contracts/src/commands/audit-writers.ts`
- Modify: `packages/contracts/src/register.test.ts`
- Modify: wire-error exports + HTTP status mapper
- Modify: `packages/client-core/src/api.ts`
- Modify: `packages/client-core/test/api-folio.test.ts` (or add test file)
- Modify: `apps/web-pms/src/screens/FolioScreen.tsx`
- Modify: `apps/web-pms/src/screens/FolioScreen.test.tsx`
- Modify: `apps/pms-core/test/reservations-early-depart.spec.ts` (HTTP case)

**Interfaces:**

| Layer | Contract |
|---|---|
| Command | `reservations.early_depart` |
| DO | `tryEarlyDepart(actor, { reservationId }, idem)` |
| HTTP | `post_reservation_early_depart` — `requireIdempotencyHeader`; payload `{ reservationId }` |
| Client | `api.earlyDepart(propertyId, reservationId, opId)` — **`x-idempotency-key`** only |

### Step 1 — Wire code + HTTP status

Add `NOT_EARLY_DEPARTABLE = 'not_early_departable'` to contracts exports. Map to **422** in `commandErrorHttpStatus`.

- [ ] No duplicate error keys

### Step 2 — Catalog entry

Append to `catalog.ts` (after `reservations.check_out` block):

```typescript
{
  id: 'reservations.early_depart',
  prototypeAction: null,
  lane: 'INTERACTIVE',
  degraded: 'FAIL_CLOSED',
  idempotent: true,
  events: ['reservation.modified', 'availability.changed'],
  permission: 'reservations:write',
  entitlement: 'pms.core',
},
```

- [ ] Lane matches runtime `touchInteractive()` (not `QUEUE_PROVISIONAL`)

### Step 3 — HTTP route + audit writer

In `v1-http-routes.ts`, insert **immediately after** `post_reservation_check_out`:

```typescript
{
  id: 'post_reservation_early_depart',
  scope: 'property',
  permission: 'reservations:write',
  commandId: 'reservations.early_depart',
},
```

Add `'reservations.early_depart'` to `AUDIT_WRITER_COMMAND_IDS`.

Update `register.test.ts`:

- `expect(COMMAND_CATALOG).toHaveLength(90)`
- `expect(V1_HTTP_ROUTE_AUDIT).toHaveLength(145)`
- `expect(V1_HTTP_ROUTE_AUDIT[144]?.id).toBe('post_reservation_early_depart')`
- `expect(AUDIT_WRITER_COMMAND_IDS.size).toBe(64)`

Run:

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm check:permissions
```

- [ ] Permissions check picks up new route

### Step 4 — `tryEarlyDepart` in PropertyDO

Implement in `property-do.ts` (mirror `tryCheckOut` admission: `assertRpcAvailable`, `touchInteractive`, org/property gates, `runIdempotent`):

**Transaction steps (single `transactionSync`, no `await`):**

1. Load reservation row.
2. `businessDate = readBusinessDateSync()` — fail `business_date_unset` if missing.
3. Gate: `status === 'checked_in'` && `departure_date > businessDate` else `NOT_EARLY_DEPARTABLE`.
4. `oldDeparture = departure_date`; `nightsToRelease = enumerateDaysHalfOpen(businessDate, oldDeparture)`.
5. `releaseSoldNightsSync(room_type_id, nightsToRelease)`.
6. `UPDATE reservation SET departure_date = businessDate, updated_at = ?`.
7. Outbox: `reservation.modified` (before/after departure), `availability.changed` (match modify pattern).
8. **Do not** change `status`, `room_id`, folio, or call checkout.

**Idempotency:** Fingerprint object `{ reservationId }` only — same object passed to `runIdempotent` and returned on replay.

- [ ] **`tryCheckOut` diff untouched** (grep: no new `releaseSoldNightsSync` in checkout method)

### Step 5 — HTTP handler `handlePostReservationEarlyDepart`

Pattern from `handlePostReservationCheckOut` (~2294):

```typescript
async function handlePostReservationEarlyDepart(ctx: V1DispatchContext): Promise<Response> {
  const propertyId = decodeURIComponent(ctx.match[1]!);
  const reservationId = decodeURIComponent(ctx.match[2]!);
  ctx.observability.propertyId = propertyId;

  const idempotencyKey = requireIdempotencyHeader(ctx.request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const extra = await readOptionalJsonBody(ctx.request);
  if (extra instanceof Response) return extra;

  const resolvedCtx = await resolvePropertyContext(ctx, propertyId, ctx.tenantProperty);
  if (resolvedCtx instanceof Response) return resolvedCtx;

  const commandPayload = { reservationId };
  const fingerprint = await commandFingerprint('reservations.early_depart', commandPayload);
  const actor = { kind: 'user' as const, userId: ctx.actor.userId };
  const idem = { key: idempotencyKey, fingerprint };

  const invoked = await invokePropertyDo({
    ...commandEnvelope(ctx, resolvedCtx, {
      commandId: 'reservations.early_depart',
      routeId: 'post_reservation_early_depart',
      idempotencyKey,
      requestFingerprint: fingerprint,
      commandPayload,
    }),
    invoke: () => resolvedCtx.resolved.stub.tryEarlyDepart(actor, commandPayload, idem),
  });

  return finishPropertyDoInvoke({ invoked, permission: 'reservations:write', successStatus: 200, ... });
}
```

Wire in `V1_ROUTES` with path `POST .../reservations/:reservationId/early-depart`.

- [ ] Missing header → 400/422 per existing idempotency helper
- [ ] Empty body `{}` or no body → OK

### Step 6 — Client API

In `packages/client-core/src/api.ts`, add after `checkOut`:

```typescript
async earlyDepart(propertyId: string, reservationId: string, opId: string) {
  const idempotencyKey = stableKeyForOperation(opId, opts.keyStore);
  return getJson(
    `/v1/properties/${enc(propertyId)}/reservations/${enc(reservationId)}/early-depart`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({}),
    },
    { reservationId },
  );
},
```

Test: records `x-idempotency-key` header; `{ reservationId }` provisional context.

- [ ] **Do not** send JSON `idempotencyKey`

### Step 7 — Folio SPA

In `FolioScreen.tsx`:

**When shown:** `status === 'checked_in'` && `departureDate > businessDate` (same as U17 predicate).

**UX:**
- Secondary **Early depart** `Button` (not destructive).
- `ConfirmDialog` (`.app-modal`): explains shortening to business date; inventory released on remaining nights; guest stays in-house until checkout.
- Mutation: `api.earlyDepart(propertyId, reservationId, \`early-depart:${reservationId}\`)`.
- **On success:** invalidate `['folio', propertyId, reservationId]`, `['board']` prefix; if tape range in context, `['front-desk-tape', propertyId, from, to]`.
- **Do not** call checkout mutation.
- **Keep** U17 checkout `Alert` unchanged.

`FolioScreen.test.tsx`:
- Button visible when predicate true.
- Confirm triggers API mock.
- Assert `invalidateQueries` spy includes folio + board keys.

- [ ] `classifiedUserMessage` on failure; `Alert` for errors

### Step 8 — Complete Task 1 test file + HTTP case

Add HTTP integration case in `reservations-early-depart.spec.ts`:

- Tenant context via property URL
- `x-idempotency-key` required
- 422 on `not_early_departable`

Run Task 1 suite + targeted web-pms:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/reservations-early-depart.spec.ts
pnpm --filter @hospai/web-pms exec vitest run src/screens/FolioScreen.test.tsx -t "early depart"
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
```

- [ ] All L6 tests **green**
- [ ] Grep confirms **`tryCheckOut` has no `releaseSoldNightsSync`**

### Step 9 — Commit (implementer)

Single commit for Task 2 (catalog + route + DO + HTTP + client + SPA + pins):

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/test/reservations-early-depart.spec.ts \
  packages/contracts/src/commands/catalog.ts \
  packages/contracts/src/v1-http-routes.ts \
  packages/contracts/src/commands/audit-writers.ts \
  packages/contracts/src/register.test.ts \
  packages/client-core/src/api.ts \
  packages/client-core/test/ \
  apps/web-pms/src/screens/FolioScreen.tsx \
  apps/web-pms/src/screens/FolioScreen.test.tsx \
  # + wire error / status mapper files
git commit -m "feat: R0.14 L6 early-depart command, route, Folio action"
```

---

## Task 3 — L9 + L10 cashier SQL

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`computeShiftExpectedCashSync` ~16436, `countUnattributedCashForBusinessDateSync` ~16422)
- Modify: `apps/pms-core/test/cashiering.spec.ts`

### Step 1 — L9 expected cash (ledger currency)

Replace `SUM(amount_minor)` with joined ledger sum:

```sql
SELECT COALESCE(SUM(ABS(fl.ledger_amount_minor)), 0) AS total
FROM payment p
JOIN folio_line fl ON fl.payment_id = p.payment_id AND fl.charge_code = 'PAYMENT'
WHERE p.shift_id = ?
  AND p.tender_type = 'CASH'
  AND p.status = 'captured'
```

Verify `opening_float + total` sign against existing tests — adjust negation if payment lines are negative.

- [ ] Foreign-currency or mixed FX cash fixture: expected cash uses **ledger** amount

### Step 2 — L10 unattributed business date

Replace UTC filter:

```sql
SELECT COUNT(*) AS n
FROM payment p
JOIN folio_line fl ON fl.payment_id = p.payment_id AND fl.charge_code = 'PAYMENT'
WHERE p.tender_type = 'CASH'
  AND p.status = 'captured'
  AND p.shift_id IS NULL
  AND fl.business_date = ?
```

**Test:** Post cash near UTC midnight; property business date D vs D+1 — count uses **line business_date**.

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/cashiering.spec.ts
```

- [ ] L9 + L10 cases green
- [ ] No pin changes

### Step 3 — Commit (implementer)

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/cashiering.spec.ts
git commit -m "fix: R0.14 L9/L10 shift cash ledger currency and business date"
```

---

## Task 4 — L11 FX allocate + L13 OOO horizon

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (`applyPaymentEventSync` ~16206 partial refund; `trySetOooRange` / `applyBlockedDeltaSync` ~6671–6805)
- Modify: `apps/pms-core/test/folio-fx-payments.spec.ts`
- Modify: `apps/pms-core/test/rooms-ooo.spec.ts`
- Modify: wire error + `commandErrorHttpStatus` for `ooo_beyond_horizon`

### Step 1 — L11 partial FX refund allocation

In partial refund branch, replace ratio round:

```typescript
import { allocate } from '@hospai/money';

const leftoverTxn = remainingTxn - refundTxn;
const ledgerRefundMinor =
  leftoverTxn === 0
    ? remainingLedger
    : allocate(remainingLedger, [refundTxn, leftoverTxn], { policy: 'LAST' })[0]!;
```

**Reviewer lock:** weights are **`[refundTxn, leftoverTxn]`** on **`remainingLedger`** — **not** `allocate(refundTxn, [ledger])`.

**Test:** Partial refund on mixed FX capture — sum of refund ledger legs + remainder equals capture ledger remaining; no off-by-one vs old `Math.round`.

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/folio-fx-payments.spec.ts
```

### Step 2 — L13 OOO beyond horizon

Add `OooBeyondHorizonError` / wire `ooo_beyond_horizon` → **422**.

In `trySetOooRange`, **before** `applyBlockedDeltaSync`:

```typescript
for (const d of newNights) {
  const row = /* availability_day exists for room_type_id + d */;
  if (!row) throw new OooBeyondHorizonError(d);
}
```

Remove add-path `if (d > horizonEnd) continue` — rejection replaces silent skip.

**Test:** OOO range past horizon → `{ ok: false, error: 'ooo_beyond_horizon' }`; no blocked delta on far nights.

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/rooms-ooo.spec.ts
```

- [ ] No horizon auto-extend code added

### Step 3 — Commit (implementer)

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/test/folio-fx-payments.spec.ts \
  apps/pms-core/test/rooms-ooo.spec.ts
git commit -m "fix: R0.14 L11 FX refund allocate LAST and L13 OOO horizon reject"
```

---

## Task 5 — Hygiene, docs, N13/N14, Q22 mechanical

**Files:**
- Modify: `apps/pms-core/src/event-consumer.ts` (Q12)
- Modify: `apps/pms-core/src/v1-dispatch.ts` (Q12 fallback, B3, N14 availability)
- Modify: `apps/pms-core/src/property-do.ts` (`FRONT_DESK_LIST_SELECT` only if not done earlier)
- Modify: `apps/pms-core/test/events-queue.spec.ts` (N13)
- Modify: `ARCHITECTURE.md`, `AGENTS.md`
- Modify: `packages/contracts/src/idempotency.ts`, `packages/do-runtime/src/property-migrations.ts` (Q21)
- Optional: dead export deletes; `.ui-stack` rename (Q22)

### Step 1 — Q12 `freeAvailability`

| File | Change |
|---|---|
| `event-consumer.ts` ~287 | `import { freeAvailability } from '@hospai/contracts'`; `free: freeAvailability(row)` |
| `v1-dispatch.ts` ~8272 | Same import; `free: row.free ?? freeAvailability(row)` |

Grep — no remaining inline `physical - blocked - held - sold + oversell` in these two files.

- [ ] Optional: assert inline === helper in existing availability test

### Step 2 — B3 reservation PATCH `noPost`

Extend `handlePatchReservation` (~1859):

- Body type: add `noPost?: boolean`
- Fingerprint + `commandPayload`: `...(body.noPost !== undefined ? { noPost: body.noPost } : {})`

**Test:** PATCH with `noPost: true` persists flag; fingerprint includes field.

**Out:** `handlePatchGuest` unchanged.

### Step 3 — `FRONT_DESK_LIST_SELECT` extract

In `property-do.ts`:

```typescript
const FRONT_DESK_LIST_SELECT = `reservation_id, room_type_id, guest_ref, arrival_date, departure_date, status, room_id,
  adults, children, front_office_comment, vip_flag, dnd_flag, confirm_by, rate_plan_id`;
```

Replace duplicated SELECT strings in:

- `listArrivals` (~10421)
- `listDepartures` (~10486)
- `listInHouse` (~10557)
- `selectFrontDeskReservationSync` (~11193)
- Reservation search exact match (~10611)

Mechanical only — **no column changes**.

### Step 4 — N13 DLQ depth assertion

Extend `apps/pms-core/test/events-queue.spec.ts` (~295 area):

After successful drain flow, assert DLQ depth **0** (or mock binding list length 0). Match existing harness patterns.

Run:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
```

### Step 5 — N14 tenant-active + comments

| Handler | Action |
|---|---|
| `handleGetAvailability` (~8160) | **`resolvePropertyContext(ctx, propertyId, ctx.tenantProperty)`** before DO/KV; fail closed inactive tenant |
| `handleGetProperty` (~759) | Add comment: bootstrap/degraded partial — tenant-active intentionally skipped |
| `handleGetRegistryProperty` (~788) | Comment: global registry lookup — no property DO sync |

Add characterization test if harness exists for inactive tenant → 402/403/404 per existing table.

### Step 6 — Q21 comment fixes

| Location | Fix |
|---|---|
| `packages/contracts/src/idempotency.ts` ~197 | Revise “never call from DO” — prefer `commandFingerprint` at HTTP; DO may use `fingerprintPayload` for nested payloads |
| `packages/do-runtime/src/property-migrations.ts` ~1 | “Historical Phase 0 freeze-gate statements; PROPERTY_SCHEMA_HEAD = 34” |

### Step 7 — ARCHITECTURE §11 + AGENTS Q16 + supply-chain note

**ARCHITECTURE.md §11:**

- Remove/strike `apps/edge/` fiction — routing in `apps/pms-core` worker.
- **`modules/pms/*/domain` may import `@hospai/contracts`**.
- PropertyDO stays until named extract trigger.
- `@hospai/temporal-utils`: unused — next date slice imports or deletes.
- Footnote: `pnpm audit --audit-level high` **red** (9 high, 2026-09-05) — deferred blocking CI.

**AGENTS.md:**

- One-line pointer under §1 idempotency to Q16 table (include **`post_reservation_early_depart`** → header **`x-idempotency-key`**).
- §5 footnote: supply-chain gate deferred until audit clean.

Embed Q16 table (representative routes) in spec is normative — AGENTS gets pointer only.

### Step 8 — Q22 mechanical (optional in same commit)

```bash
rg 'mapCommandEntitlement|mergeContext|killKvKey|generatePiiKeyId' --glob '*.{ts,tsx}' -l
```

Delete exports only with **zero production importers**.

SPA `.stack` → `.ui-stack` only if single-file mechanical; else document deferral in commit message.

**Do not:** delete `@hospai/temporal-utils`; change `@hospai/observability` test echo; touch invite/X4 files.

### Step 9 — Task 5 verification

```bash
pnpm build && pnpm typecheck && pnpm lint
pnpm --filter @hospai/pms-core exec vitest run test/events-queue.spec.ts
# spot-check B3 / availability if dedicated tests added
```

- [ ] Pins still **90** / **145** / schema **34** / **9**
- [ ] **17** `check:*` scripts unchanged

### Step 10 — Commit (implementer)

One commit (or split docs vs code if reviewer prefers two commits within Task 5):

```bash
git add apps/pms-core/src/event-consumer.ts \
  apps/pms-core/src/v1-dispatch.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/events-queue.spec.ts \
  ARCHITECTURE.md AGENTS.md \
  packages/contracts/src/idempotency.ts \
  packages/do-runtime/src/property-migrations.ts
git commit -m "chore: R0.14 hygiene freeAvailability, noPost, docs, N13/N14"
```

---

## Task 6 — Full CI + tick R0.14 and R3.4

**Files:**
- Modify: `docs/roadmap.md` only (unless Task 6 fixes accidental regressions)

### Step 1 — Full verification

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

**Shard command shape (never `--` before `--shard`):**

```bash
pnpm --filter @hospai/pms-core exec vitest run --shard=1/8
# ... through --shard=8/8
```

Or root `pnpm test:local` (orchestrates 8 shards).

Also run spot checks:

```bash
pnpm check:permissions
pnpm check:resolve-property-prefetch
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts
```

- [ ] All green

### Step 2 — Pin confirmation

| Pin | Expected |
|---|---|
| `COMMAND_CATALOG` | length **90**; id `reservations.early_depart` |
| `V1_HTTP_ROUTE_AUDIT` | length **145**; `[144].id === 'post_reservation_early_depart'` |
| `AUDIT_WRITER_COMMAND_IDS` | size **64** |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] === 'AUTO_TRANSFER'` |
| `check:*` | count **17** |

### Step 3 — Reviewer grep guards

```bash
rg 'releaseSoldNightsSync' apps/pms-core/src/property-do.ts
# Must NOT appear inside tryCheckOut body
rg 'Math\.round\(refundTxn \* ledgerRatio\)' apps/pms-core/src/property-do.ts
# Must be zero after L11
rg 'date\(created_at / 1000' apps/pms-core/src/property-do.ts
# Must not remain in countUnattributedCashForBusinessDateSync
rg 'if \(d > horizonEnd\) continue' apps/pms-core/src/property-do.ts
# Must be zero on OOO add path after L13
```

- [ ] `tryCheckOut` has **no** sold release
- [ ] L6 uses **`x-idempotency-key`**; fingerprint `{ reservationId }` only

### Step 4 — Tick roadmap R0.14 + R3.4

In `docs/roadmap.md`:

```markdown
- [x] **R0.14** Audit V14 — L6, L9–L11, L13, N13, N14, Q12–Q22 (B3 `noPost` HTTP). named early-departure command; cash/FX/OOO; `freeAvailability` single import; architecture write-down.
```

```markdown
- [x] **R3.4** Early-departure command
```

**Do not** tick N11, X4, R1.16, or other items.

### Step 5 — Commit (implementer)

```bash
git add docs/roadmap.md
git commit -m "docs: tick R0.14 and R3.4 early-depart cash FX hygiene"
```

If full CI required fixes, land fixes in separate commit(s) **before** roadmap tick; do not tick on red tree.

---

## Manual verify (owner / demo path)

1. Book **3-night** stay → check in → open Folio → confirm **Early depart** visible; U17 warning still on checkout when departure > business date.
2. **Early depart** → departure shortens to business date; board/tape refresh; guest still **in house**.
3. **Checkout** → success; `sold` released only on consumed nights (not via checkout silent release).
4. Open shift → post **foreign-currency cash** → expected cash matches **ledger** denomination.
5. Post **unattributed cash** on business date D → shift close overlay counts on **D**, not UTC day.
6. Set OOO range **beyond availability horizon** → clerk sees **`ooo_beyond_horizon`** error, not silent partial block.

---

## Success criteria (spec §15 reviewer checklist)

1. **L6:** `COMMAND_CATALOG.length === 90`; `reservations.early_depart` shipped; route `[144] === post_reservation_early_depart`; Folio action; **`x-idempotency-key`**; payload `{ reservationId }` only.
2. **Inventory:** `tryCheckOut` **no** `releaseSoldNightsSync`; early depart releases `[businessDate, oldDeparture)`.
3. **L9/L10:** SQL uses `ledger_amount_minor` / `folio_line.business_date`.
4. **L11:** `allocate` LAST on **`remainingLedger`**; last slice takes all remaining ledger.
5. **L13:** `ooo_beyond_horizon`; no silent horizon skip.
6. **Q12:** `freeAvailability` imported in both sites.
7. **B3:** `patch_reservation` passes `noPost` when present.
8. **SPA:** Early depart + U17 coexist; no auto checkout.
9. **N14:** `get_property_availability` uses `resolvePropertyContext`.
10. **N13:** DLQ depth test added.
11. **Docs:** ARCHITECTURE §11, AGENTS Q16 pointer, audit gap documented — **not** blocking CI.
12. **Pins:** catalog **90**, routes **145**, audit writers **64**, schema **34/9**, night audit **8**, check scripts **17**.
13. `pnpm test:local` green (8 shards, no `--` before `--shard`).

---

## PR note template

- **L6:** New desk procedure — early depart shortens stay on business date without checkout; pins **90/145**.
- **Cash/FX:** Shift math honest for mixed currency; partial refunds use `allocate` LAST.
- **OOO:** Far-future ranges reject instead of silent skip.
- **Hygiene:** `freeAvailability`, `noPost` HTTP, docs — no schema migration.
- **Verify:** `pnpm test:local`; manual Folio early-depart → checkout path.
- **Out:** N11 sweep, X4 invites, `temporal-utils` deletion, blocking `pnpm audit` CI.
