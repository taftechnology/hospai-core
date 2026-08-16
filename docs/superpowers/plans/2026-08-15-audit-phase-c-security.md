# Audit Phase C — security hardening (C1–C4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close four audit Phase **C** security gaps — **C4** unsafe-local gate on `reconcileHorizonForTest`, **C3** stop JWT echo in WS 101 subprotocol, **C1** degraded replay operator attribution (schema + audit path), **C2** front-office WebSocket re-auth + **50**-socket cap. **One head moves:** `PROPERTY_SCHEMA_HEAD` **33 → 34**.

**Architecture:** Smallest-first TDD order **C4 → C3 → C1 → C2**; one commit per item. C1 threads `ProvisionalContext.auditUserId` from consumer through existing replay invoke wiring — permission actor stays `REPLAY_ACTOR`. C2 adds async full gate on accept/subscribe and sync cache peek on broadcast interval. C3 selects constant `'front-office'` subprotocol when offered. C4 is a one-line `assertUnsafeLocal` guard.

**Tech Stack:** Cloudflare Workers Durable Object (`property-do.ts`), `@hospai/contracts`, `@hospai/entitlement-client`, `@hospai/do-runtime` migrations, vitest + `vitest-pool-workers`, root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-c-security-design.md` (Locks 1–4 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — no new commands |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **34** — C1 `provisional_exception.actor_user_id` only |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |

Tree verified 2026-08-15. After Task 3: `pnpm generate:ddl && pnpm check:ddl` must be clean; new file `migrations/do-property/0034_provisional_exception_actor.sql`.

---

## Sequencing gate (read before starting)

Phase **B** (business-logic defects) **must** be landed — local suite is the long-pole verifier after Phase A + B.

| After this plan | Do not start |
|---|---|
| C4 `assertUnsafeLocal` on `reconcileHorizonForTest` (Lock 4) | Changing replay **permission** actor (`REPLAY_ACTOR` / `gatePermission`) |
| C3 constant WS subprotocol + client offer (Lock 3) | **C5** per-org blind-index HKDF + backfill |
| C1 attribution column + audit path (Lock 1) | **D1** closed error-union refactor |
| C2 re-auth + socket cap (Lock 2) | Edge **rate limiting**; HTTP exposure of `actor_user_id` on exception lists |
| All §Verification commands green | Phase **E+** audit items |

**TDD order:** Task 1 (C4 one line) → Task 2 (C3 test red → server + client green) → Task 3 (C1 test red → migration + attribution green) → Task 4 (C2 test red → re-auth + cap green → full verify).

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: C1 degraded replay operator attribution (spec §2 Lock 1)

**Locked:** Three additive changes. **Do not** pass envelope user as permission actor. **Do not** add live `gatePermission` on replay.

| Concern | Actor passed to `try*` / `gatePermission` | Actor written to `audit_log` / `provisional_exception` / logs |
|---|---|---|
| Live HTTP | `{ kind: 'user', userId }` | same user |
| Queue replay (after C1) | `{ kind: 'system', reason: 'queue_replay' }` (**unchanged**) | **`provisional.actor.userId`** |

#### 1a — Migration `provisional_exception.actor_user_id`

Confirm table is PropertyDO-scoped: `provisional_exception` created in migration **v9** (`property-migrations.ts` ~260–270). New migration **v34**:

```ts
export const PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT`,
] as const;
```

Append to `PROPERTY_MIGRATIONS` as `{ version: 34, name: 'provisional_exception_actor', statements: PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS }`. Regenerate `migrations/do-property/0034_provisional_exception_actor.sql` via `pnpm generate:ddl`.

**`recordProvisionalException`** (`property-do.ts` ~2691–2711) — extend INSERT:

```ts
`INSERT OR IGNORE INTO provisional_exception (
  exception_id, idempotency_key, command_type, payload,
  issued_at, business_date, reason, detail, created_at, actor_user_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
// ...
cmd.actor.userId,
```

Existing rows keep `actor_user_id IS NULL` (historical gap accepted).

#### 1b — Structured logs

**`pending-commands-consumer.ts`** — add `actorUserId: provisional.actor.userId` to:

| Location | Event |
|---|---|
| ~106–111 | `degraded.replayed` |
| ~125–131 | `degraded.exception` |

Also add to early `degraded.exception` branches (~46–51, ~58–64, ~72–77) when `provisional` is in scope.

#### 1c — Audit actor vs permission actor on replay

**Contracts** — extend `ProvisionalContext` (`packages/contracts/src/provisional-command.ts` ~32–35):

```ts
export type ProvisionalContext = {
  issuedAt: string;
  businessDate: string;
  /** Admission-time operator — audit rows only; permission actor stays REPLAY_ACTOR. */
  auditUserId?: string;
};
```

**Consumer** (`pending-commands-consumer.ts` ~92–95):

```ts
const provisionalCtx: ProvisionalContext = {
  issuedAt: provisional.issuedAt,
  businessDate: provisional.businessDate,
  auditUserId: provisional.actor.userId,
};
```

**PropertyDO** — add helper next to `auditActorSync` (`property-do.ts` ~2543–2545):

```ts
/** Permission actor may be system; audit attributes admission operator when replaying. */
private auditActorForCommandSync(actor: ActorContext, provisional?: ProvisionalContext): string {
  if (provisional?.auditUserId) return provisional.auditUserId;
  return this.auditActorSync(actor);
}
```

In every **REPLAY_DISPATCH** target `try*` method, replace **`appendAuditLogSync` `actor:`** from `this.auditActorSync(actor)` to `this.auditActorForCommandSync(actor, provisional)`. **Grep** `auditActorSync(actor)` inside each method body — do not rely solely on spec line numbers:

| Command id | Method | Approx audit line |
|---|---|---|
| `reservations.check_in` | `tryCheckIn` | ~9437–9438 |
| `reservations.check_out` | `tryCheckOut` | ~9600 |
| `reservations.cancel_check_in` | `tryCancelCheckIn` | ~9882 |
| `reservations.update_status` | `tryUpdateFrontOffice` | ~10005 |
| `folio.add_item` | `tryAddFolioLine` | ~14894 |
| `rooms.update_status` | `tryUpdateRoomStatus` | ~6947 |
| `rooms.bulk_update_status` | `tryBulkUpdateRoomStatus` | ~7027 |
| `housekeeping.assign` | `tryAssignHousekeeping` | ~7277 |

**Leave unchanged:** all `gatePermission(actor, …)` calls; `REPLAY_ACTOR` in consumer ~19; `replay-dispatch.ts` invoke signatures.

### D2 — Lock 2: C2 front-office WebSocket re-auth + cap (spec §2 Lock 2)

#### 2a — Constants (PropertyDO, near front-office types ~274)

```ts
const FRONT_OFFICE_MAX_SOCKETS = 50;
const FRONT_OFFICE_REAUTH_INTERVAL_MS = 30_000;
const FRONT_OFFICE_WS_CLOSE_POLICY = 4403; // private use — "policy violation"
const FRONT_OFFICE_WS_CLOSE_REASON = 'policy_violation';
```

#### 2b — Attachment shape

```ts
type FrontOfficeAttachment = {
  propertyId: string;
  userId: string;
  fromDate: string | null;
  toDate: string | null;
  authCheckedAt: number; // ms — last successful full async gate
};
```

#### 2c — Sync cache peek helpers (`@hospai/entitlement-client`)

**`PermissionDoCache.peekEffectiveRole(userId, propertyId): OrgRole | null`** — return cached role if entry exists and `now - cachedAt < MAX_AGE_MS`; else `null`.

**`EntitlementDoCache.peekEntitled(orgId, featureKey): boolean | null`** — return `true`/`false` from cached snapshot if fresh; else `null`. Use existing `require()` / `EntitlementRequiredError` semantics on cached snap.

#### 2d — Async full gate (accept + subscribe)

**`private async assertFrontOfficeStreamAuthorized(userId: string): Promise<{ ok: true } | { ok: false }>`**:

1. Reject empty `userId`.
2. `gatePermission({ kind: 'user', userId }, 'reservations:read')`.
3. `gateCoreEntitlement(orgId)` — `pms.core`.
4. On success `{ ok: true }`.

**`fetch`** (~10787–10821) — reorder **before** `acceptWebSocket`:

1. Read `userId` from `x-hospai-ws-actor`.
2. If `this.ctx.getWebSockets('front-office').length >= FRONT_OFFICE_MAX_SOCKETS` → **503** `json({ error: 'front_office_stream_capacity' })`.
3. `const gate = await this.assertFrontOfficeStreamAuthorized(userId)`; if `!gate.ok` → **403** `json({ error: 'forbidden' })`.
4. Then `acceptWebSocket`, attachment includes `authCheckedAt: Date.now()`.

**`webSocketMessage` subscribe branch** (~10838–10853) — **before** updating window / sending snapshot:

```ts
const userId = prev.userId ?? '';
const gate = await this.assertFrontOfficeStreamAuthorized(userId);
if (!gate.ok) {
  ws.close(FRONT_OFFICE_WS_CLOSE_POLICY, FRONT_OFFICE_WS_CLOSE_REASON);
  return;
}
// serializeAttachment with authCheckedAt: Date.now()
```

#### 2e — Sync re-auth during broadcast

**`private peekFrontOfficeStreamAuthorizedSync(userId: string): boolean`**:

1. Empty `userId` → `false`.
2. `orgId` / `propertyId` from sync getters; missing → `false`.
3. `role = permissionCache.peekEffectiveRole(userId, propertyId)`; if `!role` or `!ROLE_GRANTS[role].includes('reservations:read')` → `false`.
4. `entitled = entitlementCache.peekEntitled(orgId, 'pms.core')`; if `entitled !== true` → `false`.
5. Else `true`.

**`broadcastFrontOffice`** (~10868–10890) — at top of per-socket loop, **before** window overlap / `ws.send`:

```ts
const now = Date.now();
if (now - (att.authCheckedAt ?? 0) >= FRONT_OFFICE_REAUTH_INTERVAL_MS) {
  if (!this.peekFrontOfficeStreamAuthorizedSync(att.userId)) {
    ws.close(FRONT_OFFICE_WS_CLOSE_POLICY, FRONT_OFFICE_WS_CLOSE_REASON);
    continue;
  }
  ws.serializeAttachment({ ...att, authCheckedAt: now });
}
```

**Do not** add edge rate limiting. **`v1-dispatch.ts` `handleGetFrontOfficeStream`** (~5417–5437) unchanged.

### D3 — Lock 3: C3 stop echoing JWT in 101 (spec §2 Lock 3)

#### 3a — Server (`property-do.ts` ~10818–10820)

```ts
const offered = request.headers.get('Sec-WebSocket-Protocol');
if (offered?.split(',').map((s) => s.trim()).includes('front-office')) {
  headers.set('Sec-WebSocket-Protocol', 'front-office');
}
```

Never echo `hospai.clerk.*` or raw multi-value header.

#### 3b — Client (`apps/web-pms/src/shell/front-office-auth-protocol.ts`)

```ts
if (opts.useDevActor) return [`hospai.dev-actor.${opts.devActor}`, 'front-office'];
if (opts.clerkToken) return [`hospai.clerk.${opts.clerkToken}`, 'front-office'];
return undefined;
```

#### 3c — Tests

Update `front-desk-stream.spec.ts` ~337 — expect `'front-office'`, not full dev-actor protocol string. Assert response header must **not** contain `hospai.clerk.`.

### D4 — Lock 4: C4 gate `reconcileHorizonForTest` (spec §2 Lock 4)

**`property-do.ts` ~2891** — first statement:

```ts
this.assertUnsafeLocal('reconcileHorizonForTest');
```

**Verify:** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts` green (`HOSPAI_UNSAFE_LOCAL=1` in bindings).

### D5 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local`. Per-file verification: `pnpm --filter @hospai/pms-core exec vitest run <file>`. After migration changes: `pnpm generate:ddl && pnpm check:ddl`.

### D6 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 4 only** at implementation time. No push.

---

## Global constraints

- **Heads table above** — only `PROPERTY_SCHEMA_HEAD` moves **33 → 34** (Task 3).
- **Four security fixes + tests** — no C5, D1, edge rate limiting, replay permission changes.
- **Phase B green prerequisite** — use `pnpm test:local` for long-pole verification (Task 4).
- **TDD per item** — failing test first where feasible, then lock, then green on that file before commit.

### Scope out (forbidden across all tasks)

- **C5** per-org blind-index key — **deferred to its own vertical.** Key derivation lives in OrgDO (`org-do.ts:263–272`, `HOSPAI_ORG_MASTER_KEY` → `guest_blind_index` in `org-do.ts`); mixing `orgId` into HKDF `info` invalidates every existing `guest_blind_index` row and requires a cross-org backfill. Audit explicitly says "schedule as its own slice" (`2026-08-15-full-codebase-audit.md:341`). Does **not** move `PROPERTY_SCHEMA_HEAD` in isolation from the crypto migration.
- **D1** closed error-union refactor, Phase **B** items, Phase **E+**
- Changing degraded-replay **permission** behaviour (system actor / `gatePermission` short-circuit)
- Edge **rate limiting** (`api.rate_limit_rpm`, Phase 3) — C2's in-DO socket cap is in scope; do not add Worker-level rate limits here
- `pending_command_open` actor column (D1 / platform scope; deleted on ack)
- Exposing `actor_user_id` on HTTP exception-list responses (optional follow-up; column + insert is in scope)

---

## File map

| File | Role | Task |
|---|---|---|
| `apps/pms-core/src/property-do.ts` | C4: `reconcileHorizonForTest` guard ~2891 | 1 |
| `apps/pms-core/test/night-audit.spec.ts` | C4 regression (no new test) | 1 |
| `apps/pms-core/test/front-desk-stream.spec.ts` | C3 subprotocol + no-JWT-echo assertions ~331–337 | 2 |
| `apps/pms-core/src/property-do.ts` | C3: select `'front-office'` ~10818–10820 | 2 |
| `apps/web-pms/src/shell/front-office-auth-protocol.ts` | C3: append `'front-office'` to protocol lists | 2 |
| `packages/do-runtime/src/property-migrations.ts` | C1: v34 `actor_user_id` ALTER + export | 3 |
| `migrations/do-property/0034_provisional_exception_actor.sql` | C1: generated DDL | 3 |
| `packages/do-runtime/src/migrate.test.ts` | C1: v34 migration + head **34** tests | 3 |
| `packages/contracts/src/provisional-command.ts` | C1: `ProvisionalContext.auditUserId` | 3 |
| `apps/pms-core/src/pending-commands-consumer.ts` | C1: `auditUserId` ctx + `actorUserId` logs | 3 |
| `apps/pms-core/src/property-do.ts` | C1: `auditActorForCommandSync`, INSERT, 8 audit sites; optional `readProvisionalExceptionActorUserIdForTest` | 3 |
| `apps/pms-core/test/degraded-mode.spec.ts` | C1 attribution specs §3.1 | 3 |
| `packages/entitlement-client/src/permission-cache.ts` | C2: `peekEffectiveRole` | 4 |
| `packages/entitlement-client/src/index.ts` | C2: `EntitlementDoCache.peekEntitled` | 4 |
| `packages/entitlement-client/src/index.test.ts` | C2: peek helper unit tests (optional but recommended) | 4 |
| `apps/pms-core/src/property-do.ts` | C2: attachment, constants, gates, fetch reorder, subscribe re-gate, broadcast peek | 4 |
| `apps/pms-core/test/front-desk-stream.spec.ts` | C2 revoke→close + cap 503 specs §3.2 | 4 |
| `docs/superpowers/specs/2026-08-15-audit-phase-c-security-design.md` | Tick §8 checklist | 4 |
| `docs/superpowers/plans/2026-08-15-audit-phase-c-security.md` | Task 4 checkboxes (this file) | 4 |

**Not touched:** `COMMAND_CATALOG`, `V1_HTTP_ROUTE_AUDIT`, `AUDIT_WRITER_COMMAND_IDS`, `NIGHT_AUDIT_STEPS`, `replay-dispatch.ts` invoke wiring, `v1-dispatch.ts` front-office HTTP gate, C5 / OrgDO blind-index, D1.

---

## Spec §1.5 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 4 — C4 `assertUnsafeLocal` | 1 |
| §3.4 / §4 #6 — `night-audit.spec.ts` regression | 1 |
| Lock 3 — C3 subprotocol server + client | 2 |
| §3.3 / §4 #5 — subprotocol + no JWT echo test | 2 |
| Lock 1 — C1 migration + attribution + logs | 3 |
| §3.1 / §4 #1–2 — degraded-mode attribution specs | 3 |
| Lock 2 — C2 re-auth + cap + peek helpers | 4 |
| §3.2 / §4 #3–4 — front-desk-stream re-auth + cap specs | 4 |
| §4 #7–8 — full suite + gates + DDL | 4 |
| §1.6 scope out | forbidden all |
| §8 checklist | 4 |

---

### Task 1: C4 — gate `reconcileHorizonForTest`

**Spec:** Lock 4, §3.4, §4 #6.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` (~2891)

**Interfaces:**
- Produces: `this.assertUnsafeLocal('reconcileHorizonForTest');` as **first statement** in `reconcileHorizonForTest`
- Frozen heads unchanged

**Forbidden this commit:** C1/C2/C3 product code; test file changes (regression only).

- [ ] **Step 1: Apply Lock 4**

In `reconcileHorizonForTest` (`property-do.ts` — **read method; spec cites ~2891**):

```typescript
  async reconcileHorizonForTest(
    businessDate: string,
  ): Promise<{ insertedCount: number; fromDate: string; toDate: string }> {
    this.assertUnsafeLocal('reconcileHorizonForTest');
    return reconcileHorizon(
      this.ctx.storage.sql,
      businessDate,
      this.materializedOversellAllowanceSync(),
    );
  }
```

- [ ] **Step 2: Verify regression — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts
```

Expected: **PASS** (existing `HOSPAI_UNSAFE_LOCAL=1` bindings).

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): gate reconcileHorizonForTest with assertUnsafeLocal

Aligns the sole ungated PropertyDO *ForTest helper with the unsafe-local
defense-in-depth pattern used by all other test mutation entry points.
EOF
)"
```

---

### Task 2: C3 — stop JWT echo in WS 101 subprotocol (TDD)

**Spec:** Lock 3, §3.3, §4 #5.

**Files:**
- Modify: `apps/pms-core/test/front-desk-stream.spec.ts` (~331–337)
- Modify: `apps/pms-core/src/property-do.ts` (~10818–10820)
- Modify: `apps/web-pms/src/shell/front-office-auth-protocol.ts`

**Interfaces:**
- Produces: server selects `'front-office'` when offered; client appends `'front-office'` to every protocol list
- Frozen heads unchanged

**Forbidden this commit:** C1/C2 code; entitlement-client changes.

- [ ] **Step 1: Update failing C3 spec (red)**

Replace / extend the test at `front-desk-stream.spec.ts` ~331–337. Client protocol list must include `'front-office'` (mirrors post–client-change behaviour):

```typescript
  it('dev-actor via Sec-WebSocket-Protocol selects front-office; no JWT echo', async () => {
    const actor = 'user_stream_6';
    const { propertyId } = await provisionHotel(actor);
    const proto = `hospai.dev-actor.${actor}, front-office`;
    const viaProto = await upgradeStream(propertyId, { 'Sec-WebSocket-Protocol': proto });
    expect(viaProto.status).toBe(101);
    const selected = viaProto.headers.get('Sec-WebSocket-Protocol');
    expect(selected).toBe('front-office');
    expect(selected).not.toMatch(/hospai\.clerk\./);
    expect(selected).not.toMatch(/hospai\.dev-actor\./);
    viaProto.webSocket?.accept();
    viaProto.webSocket?.close(1000, 'done');

    const flagsOff = {
      ...env,
      HOSPAI_ALLOW_DEV_ACTOR: undefined,
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: undefined,
    };
    const deniedProto = await upgradeStream(propertyId, { 'Sec-WebSocket-Protocol': proto }, '', flagsOff);
    expect(deniedProto.status).toBe(401);

    const viaQuery = await worker.fetch(
      new Request(streamUrl(propertyId, `?actor=${actor}`), {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      }),
      env,
    );
    expect(viaQuery.status).toBe(401);
  });
```

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "dev-actor via Sec-WebSocket-Protocol"
```

Expected: **FAIL** — pre-fix echoes full protocol string.

- [ ] **Step 2: Apply Lock 3 server**

Replace echo at `property-do.ts` ~10818–10820 (**read `fetch` WS handler first**):

```typescript
    const headers = new Headers();
    const offered = request.headers.get('Sec-WebSocket-Protocol');
    if (offered?.split(',').map((s) => s.trim()).includes('front-office')) {
      headers.set('Sec-WebSocket-Protocol', 'front-office');
    }
    return new Response(null, { status: 101, webSocket: client, headers });
```

- [ ] **Step 3: Apply Lock 3 client**

`apps/web-pms/src/shell/front-office-auth-protocol.ts`:

```typescript
export function frontOfficeAuthProtocol(opts: {
  useDevActor: boolean;
  devActor: string;
  clerkToken: string | null;
}): string[] | undefined {
  if (opts.useDevActor) return [`hospai.dev-actor.${opts.devActor}`, 'front-office'];
  if (opts.clerkToken) return [`hospai.clerk.${opts.clerkToken}`, 'front-office'];
  return undefined;
}
```

- [ ] **Step 4: Re-run spec — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "dev-actor via Sec-WebSocket-Protocol"
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/test/front-desk-stream.spec.ts \
  apps/pms-core/src/property-do.ts \
  apps/web-pms/src/shell/front-office-auth-protocol.ts
git commit -m "$(cat <<'EOF'
fix(pms-core,web-pms): select front-office WS subprotocol without JWT echo

Server responds with constant front-office when offered; client appends it
alongside auth subprotocol. Stops bearer tokens appearing in 101 headers.
EOF
)"
```

---

### Task 3: C1 — degraded replay operator attribution (TDD)

**Spec:** Lock 1, §3.1, §4 #1–2, §4 #7 (DDL).

**Files:**
- Modify: `packages/do-runtime/src/property-migrations.ts` (v34)
- Generate: `migrations/do-property/0034_provisional_exception_actor.sql`
- Modify: `packages/do-runtime/src/migrate.test.ts` (v34 + head **34**)
- Modify: `packages/contracts/src/provisional-command.ts`
- Modify: `apps/pms-core/src/pending-commands-consumer.ts`
- Modify: `apps/pms-core/src/property-do.ts` (helper, INSERT, 8 audit sites, optional test SQL helper)
- Modify: `apps/pms-core/test/degraded-mode.spec.ts`

**Interfaces:**
- Produces: `PROPERTY_SCHEMA_HEAD` **34**; `auditUserId` on replay ctx; `actor_user_id` column populated on exception INSERT; audit rows attribute admission operator on replay
- Permission path unchanged: `REPLAY_ACTOR` + system `gatePermission` short-circuit

**Forbidden this commit:** C2 re-auth/cap; HTTP exception-list `actor_user_id` exposure; replay permission actor change.

- [ ] **Step 1: Write failing C1 specs (red)**

Add to `apps/pms-core/test/degraded-mode.spec.ts` (reuse `provisionHotel`, `assignCleanRoom`, `dispatchPendingBatch`, `mockQueueSendCapture`):

```typescript
describe('degraded replay attribution (C1)', () => {
  it('successful replay writes admission operator to audit_log, not system:queue_replay', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_ok', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_c1_ok', 'rm_c1_ok', '401');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_c1_ok', 'idem-c1-ok')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);
    await dispatchPendingBatch(sent);

    const audit = await stub.listAuditLog({ kind: 'user', userId: actor }, { reservationId: 'res_c1_ok' });
    expect(audit.ok).toBe(true);
    const checkInRow = audit.rows.find((r) => r.commandId === 'reservations.check_in');
    expect(checkInRow?.actor).toBe('user_alice');
    expect(checkInRow?.actor).not.toBe('system:queue_replay');
  });

  it('failed replay persists actor_user_id on provisional_exception row', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_fail', arrival, departure, guestRef)).status).toBe(201);
    // No room assign → replay check-in fails ROOM_REQUIRED

    const msg: PendingCommandMessage = {
      v: 1,
      enqueuedAt: new Date().toISOString(),
      provisional: {
        idempotencyKey: 'idem-c1-fail',
        requestFingerprint: (await idemFor('idem-c1-fail', { reservationId: 'res_c1_fail' })).fingerprint,
        propertyId,
        orgId: '',
        issuedAt: new Date().toISOString(),
        businessDate: arrival,
        actor: { userId: actor },
        command: { type: 'reservations.check_in', payload: { reservationId: 'res_c1_fail' } },
        routeId: 'post_reservation_check_in',
      },
    };
    msg.provisional.orgId = (await resolvePropertyFromRegistry(env, propertyId))!.property.orgId;

    await dispatchPendingBatch([msg]);
    expect(await stub.countProvisionalExceptions()).toBe(1);

    const actorUserId = await stub.readProvisionalExceptionActorUserIdForTest('idem-c1-fail');
    expect(actorUserId).toBe('user_alice');
  });

  it('degraded.replayed log includes actorUserId', async () => {
    const actor = 'user_alice';
    const { propertyId, arrival, stub, guestRef } = await provisionHotel(actor);
    const departure = addDays(arrival, 2);
    expect((await postReservation(propertyId, actor, 'res_c1_log', arrival, departure, guestRef)).status).toBe(201);
    await assignCleanRoom(stub, actor, 'res_c1_log', 'rm_c1_log', '402');

    const sent: PendingCommandMessage[] = [];
    mockQueueSendCapture(sent);
    await stub.setTransportBlockedForTest(true);
    expect((await postCheckIn(propertyId, actor, 'res_c1_log', 'idem-c1-log')).status).toBe(202);
    await stub.setTransportBlockedForTest(false);

    const logSpy = vi.spyOn(await import('@hospai/observability'), 'logInfo');
    await dispatchPendingBatch(sent);
    expect(logSpy.mock.calls.some(([, fields]) => (fields as { actorUserId?: string }).actorUserId === 'user_alice')).toBe(true);
    logSpy.mockRestore();
  });
});
```

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts -t "degraded replay attribution"
```

Expected: **FAIL** — audit actor `system:queue_replay`; no `actor_user_id` column / helper.

- [ ] **Step 2: Apply migration v34**

**`packages/do-runtime/src/property-migrations.ts`** — add export + registry entry:

```typescript
export const PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT`,
] as const;

export const PROVISIONAL_EXCEPTION_ACTOR_V34_SQL =
  PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS.join(';\n\n') + ';\n';
```

Append to `PROPERTY_MIGRATIONS`:

```typescript
  {
    version: 34,
    name: 'provisional_exception_actor',
    statements: PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS,
  },
```

Regenerate + verify:

```bash
pnpm generate:ddl && pnpm check:ddl
```

Update `packages/do-runtime/src/migrate.test.ts`:
- Extend "applies property migrations through version **34**" (was 33)
- Add `property schema head is 34 after provisional_exception_actor` test mirroring v33 pattern
- Add `migrations/do-property/0034_provisional_exception_actor.sql matches PROVISIONAL_EXCEPTION_ACTOR_V34_SQL`

- [ ] **Step 3: Apply Lock 1 contracts + consumer + property-do**

**`packages/contracts/src/provisional-command.ts`** — add `auditUserId?: string` to `ProvisionalContext` (verbatim D1 §1c).

**`pending-commands-consumer.ts`** — set `auditUserId: provisional.actor.userId` on `provisionalCtx`; add `actorUserId` to all `degraded.replayed` / `degraded.exception` log objects where `provisional` is in scope.

**`property-do.ts`**:
1. Add `auditActorForCommandSync` verbatim (D1 §1c) next to `auditActorSync`.
2. Extend `recordProvisionalException` INSERT with `actor_user_id` + `cmd.actor.userId` bind (D1 §1a).
3. Replace `actor: this.auditActorSync(actor)` → `actor: this.auditActorForCommandSync(actor, provisional)` in **8** replay `try*` audit writes (grep per method — see D1 table).
4. Add test-only SQL reader (**not HTTP exposure**):

```typescript
  async readProvisionalExceptionActorUserIdForTest(idempotencyKey: string): Promise<string | null> {
    this.assertUnsafeLocal('readProvisionalExceptionActorUserIdForTest');
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT actor_user_id FROM provisional_exception WHERE idempotency_key = ? LIMIT 1`,
        idempotencyKey,
      )
      .toArray() as Array<{ actor_user_id: string | null }>;
    return rows[0]?.actor_user_id ?? null;
  }
```

**Leave unchanged:** `REPLAY_ACTOR`; all `gatePermission(actor, …)`; `replay-dispatch.ts`.

- [ ] **Step 4: Re-run C1 specs + DDL — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts -t "degraded replay attribution"
pnpm generate:ddl && pnpm check:ddl
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "version 34|schema head is 34|provisional_exception_actor"
```

Expected: **PASS**; `PROPERTY_SCHEMA_HEAD === 34`.

- [ ] **Step 5: Commit**

```bash
git add packages/do-runtime/src/property-migrations.ts \
  migrations/do-property/0034_provisional_exception_actor.sql \
  packages/do-runtime/src/migrate.test.ts \
  packages/contracts/src/provisional-command.ts \
  apps/pms-core/src/pending-commands-consumer.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/degraded-mode.spec.ts
git commit -m "$(cat <<'EOF'
fix(pms-core): attribute degraded replay to admission operator

Add provisional_exception.actor_user_id, thread auditUserId through replay
context, and write operator id to audit_log while keeping system permission actor.
EOF
)"
```

---

### Task 4: C2 — front-office re-auth + cap + final verification

**Spec:** Lock 2, §3.2, §4 #3–8, §8 checklist.

**Files:**
- Modify: `packages/entitlement-client/src/permission-cache.ts`
- Modify: `packages/entitlement-client/src/index.ts`
- Modify: `packages/entitlement-client/src/index.test.ts` (peek unit tests — recommended)
- Modify: `apps/pms-core/src/property-do.ts` (C2 all touch points)
- Modify: `apps/pms-core/test/front-desk-stream.spec.ts`
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-c-security-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-c-security.md` — Task 4 checkboxes only

**Forbidden this commit:** C5, D1, edge rate limiting, HTTP `actor_user_id` on exception APIs.

- [ ] **Step 1: Write failing C2 specs (red)**

Add to `apps/pms-core/test/front-desk-stream.spec.ts`:

```typescript
  it('revoked member gets 4403 on broadcast after re-auth interval (C2)', async () => {
    const actor = 'user_stream_revoke';
    const { orgId, propertyId, A, guestRef } = await provisionHotel(actor);
    const toDate = addCalendarDays(A, 1);
    const res = await upgradeStream(propertyId, { 'x-dev-actor': actor });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();
    ws.send(JSON.stringify({ type: 'subscribe', fromDate: A, toDate }));
    expect((await waitJson(ws)).type).toBe('snapshot');

    const stub = (await resolvePropertyFromRegistry(env, propertyId))!.stub as DurableObjectStub<PropertyDO>;
    const org = resolveOrgStub(env.ORG_DO, { orgId }) as DurableObjectStub<import('../src/org-do.js').OrgDO>;
    await org.removePropertyMemberForTest(actor, propertyId);
    await stub.clearPermissionCacheForTest();

    // Backdate authCheckedAt so broadcast interval re-auth fires immediately
    await runInDurableObject(stub, (_instance, state) => {
      for (const ws of state.getWebSockets('front-office')) {
        const att = (ws.deserializeAttachment() ?? {}) as Record<string, unknown>;
        ws.serializeAttachment({ ...att, authCheckedAt: Date.now() - 31_000 });
      }
    });

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.addEventListener('close', (ev) => resolve({ code: ev.code, reason: ev.reason }), { once: true });
    });

    const created = await worker.fetch(
      new Request(`http://localhost/v1/properties/${encodeURIComponent(propertyId)}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dev-actor': actor },
        body: JSON.stringify({
          reservationId: `res_revoke_${crypto.randomUUID()}`,
          roomTypeId: 'rt_king',
          guestRef,
          arrivalDate: A,
          departureDate: addCalendarDays(A, 1),
          idempotencyKey: `idem-revoke-${crypto.randomUUID()}`,
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);

    const closed = await closePromise;
    expect(closed.code).toBe(4403);
    expect(closed.reason).toBe('policy_violation');
  });

  it('51st concurrent front-office socket returns 503 front_office_stream_capacity (C2)', async () => {
    const actor = 'user_stream_cap';
    const { propertyId } = await provisionHotel(actor);
    const headers = { 'x-dev-actor': actor };
    for (let i = 0; i < 50; i++) {
      const res = await upgradeStream(propertyId, headers);
      expect(res.status).toBe(101);
      res.webSocket?.accept();
    }
    const overflow = await upgradeStream(propertyId, headers);
    expect(overflow.status).toBe(503);
    expect(await overflow.json()).toMatchObject({ error: 'front_office_stream_capacity' });
  });
```

Add import: `resolveOrgStub` from `@hospai/tenant-router`.

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "4403|front_office_stream_capacity"
```

Expected: **FAIL** — no cap / no re-auth close.

- [ ] **Step 2: Apply peek helpers**

**`permission-cache.ts`**:

```typescript
  peekEffectiveRole(userId: string, propertyId: string): OrgRole | null {
    const key = `${userId}:${propertyId}`;
    const now = Date.now();
    const entry = this.cache.get(key);
    if (!entry || now - entry.cachedAt >= PermissionDoCache.MAX_AGE_MS) return null;
    return entry.role;
  }
```

**`EntitlementDoCache` in `index.ts`**:

```typescript
  peekEntitled(orgId: string, featureKey: FeatureKey): boolean | null {
    const now = Date.now();
    if (!this.snap || this.snap.orgId !== orgId || now - this.cachedAt >= EntitlementDoCache.MAX_AGE_MS) {
      return null;
    }
    try {
      require(this.snap, featureKey);
      return true;
    } catch (e) {
      if (e instanceof EntitlementRequiredError) return false;
      return null;
    }
  }
```

- [ ] **Step 3: Apply Lock 2 on PropertyDO**

1. Add constants (D2 §2a).
2. Extend `FrontOfficeAttachment` with `authCheckedAt` (D2 §2b).
3. Add `assertFrontOfficeStreamAuthorized` + `peekFrontOfficeStreamAuthorizedSync` (D2 §2d–2e).
4. **Reorder `fetch`** — cap → async gate → `acceptWebSocket` → attachment with `authCheckedAt: Date.now()` → snapshot (read current handler ~10787–10821; structure differs from spec citation).
5. **Subscribe branch** — async re-gate before window update (~10838–10853).
6. **`broadcastFrontOffice`** — interval peek + close **4403** (~10868–10890).

- [ ] **Step 4: Re-run C2 specs — must be green**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "4403|front_office_stream_capacity"
pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts
```

Expected: **PASS** (including C3 test from Task 2).

- [ ] **Step 5: Re-run Phase C test files**

```bash
pnpm --filter @hospai/pms-core exec vitest run \
  test/night-audit.spec.ts \
  test/degraded-mode.spec.ts \
  test/front-desk-stream.spec.ts
```

Expected: **PASS**.

- [ ] **Step 6: Full local test loop — long pole (spec §4 #7)**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [ ] **Step 7: All 14 `check:*` gates (spec §4 #8)**

```bash
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
```

Expected: all **PASS**.

- [ ] **Step 8: typecheck / build / lint (spec §3)**

```bash
pnpm typecheck
pnpm build
pnpm lint
pnpm generate:ddl && pnpm check:ddl
```

Expected: all **PASS**.

- [ ] **Step 9: Pin frozen heads (sanity — schema **34**, catalog **89**)**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
```

Expect: catalog **89**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 34`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`.

- [ ] **Step 10: Tick spec §8 checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-c-security-design.md` §8.

- [ ] **Step 11: Tick Task 4 checkboxes in this plan only**

Do **not** tick Task 1–3 checkboxes retroactively unless already done during implementation.

- [ ] **Step 12: Commit**

```bash
git add packages/entitlement-client/src/permission-cache.ts \
  packages/entitlement-client/src/index.ts \
  packages/entitlement-client/src/index.test.ts \
  apps/pms-core/src/property-do.ts \
  apps/pms-core/test/front-desk-stream.spec.ts \
  docs/superpowers/specs/2026-08-15-audit-phase-c-security-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-c-security.md
git commit -m "$(cat <<'EOF'
fix(pms-core): re-auth front-office WS streams and cap fan-out

Async gate on accept/subscribe, sync cache peek on broadcast interval,
50-socket cap per PropertyDO. Closes audit C2 without edge rate limits.
EOF
)"
```

**Stop.** Phase **C** security hardening (C1–C4) closed. **C5** / D1 / Phase E+ remain separate.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts` | Green — C4 | 1, 4 |
| 2 | `pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "Sec-WebSocket-Protocol"` | Green — C3 | 2, 4 |
| 3 | `pnpm --filter @hospai/pms-core exec vitest run test/degraded-mode.spec.ts -t "degraded replay attribution"` | Green — C1 | 3, 4 |
| 4 | `pnpm --filter @hospai/pms-core exec vitest run test/front-desk-stream.spec.ts -t "4403\|front_office_stream_capacity"` | Green — C2 | 4 |
| 5 | `pnpm generate:ddl && pnpm check:ddl` | Clean — v34 | 3, 4 |
| 6 | `pnpm test:local` | **Long pole** — 8 shards + non-pms-core green | 4 |
| 7 | All 14 `check:*` gates | Green | 4 |
| 8 | `pnpm typecheck` / `pnpm build` / `pnpm lint` | Green | 4 |
| 9 | Frozen heads pin commands | Catalog **89**, writers **63**, schema **34**, steps **8** | 4 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. Per-file: `pnpm --filter @hospai/pms-core exec vitest run <file>`. After migration changes: `pnpm generate:ddl && pnpm check:ddl`.

---

## Spec §8 reviewer checklist (Task 4 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| C1: migration v34 + DDL regenerate | 3 |
| C1: `recordProvisionalException` + log fields | 3 |
| C1: `ProvisionalContext.auditUserId` + `auditActorForCommandSync` + 8 audit sites | 3 |
| C2: peek helpers on entitlement-client caches | 4 |
| C2: `assertFrontOfficeStreamAuthorized` + fetch cap/gate + subscribe gate | 4 |
| C2: `broadcastFrontOffice` interval peek + close **4403** | 4 |
| C3: server select `'front-office'` + client protocol list | 2 |
| C4: `reconcileHorizonForTest` guard | 1 |
| Tests §4 + verify §3 green | 4 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in (C1–C4 + tests) | 1–4 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–4 | 1–4 |
| §4 test plan | 1–4 |
| §6 file map | 1–4 |
| §8 checklist | 4 |
| Frozen heads §1.4 | schema moves Task 3 only |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §9). One head moves: **33 → 34**.

---

## Approximate line numbers — read actual code first

Spec citations are tree-verified 2026-08-15 but **will drift**. Implementers **must grep / read** before editing:

| Area | Spec cites | Plan note |
|---|---|---|
| `reconcileHorizonForTest` | ~2891 | Method starts ~2891 today — confirm first line placement |
| WS subprotocol echo | ~10819–10820 | Inside `fetch` front-desk handler ~10787+ |
| `fetch` accept/gate order | ~10787–10821 | **Major reorder** — current code accepts socket **before** gate; read full handler |
| `webSocketMessage` subscribe | ~10838–10853 | Insert async re-gate before attachment update |
| `broadcastFrontOffice` | ~10868–10890 | Per-socket loop — insert interval peek at loop top |
| `recordProvisionalException` INSERT | ~2698–2710 | Extend column list + bind |
| `auditActorSync` helper | ~2543–2545 | Add `auditActorForCommandSync` adjacent |
| 8 replay audit sites | various ~6947–14894 | **Grep** `auditActorSync(actor)` inside each `try*` method listed in D1 |
| `pending-commands-consumer` logs | ~46–131 | Line numbers approximate — grep `degraded.replayed` / `degraded.exception` |
| `front-desk-stream.spec.ts` C3 test | ~337 | Replace existing dev-actor protocol test block |
| `gateCoreEntitlement` / `gatePermission` | ~1742–1772 | Reuse for `assertFrontOfficeStreamAuthorized` |

---

## Plan writer interpretations (flagged for reviewer)

1. **C1 `actor_user_id` test read:** added `readProvisionalExceptionActorUserIdForTest` (unsafe-local SQL) — HTTP list APIs stay out of scope per spec §1.6; test needs a non-HTTP read path.
2. **C2 broadcast-close test:** backdates `authCheckedAt` via `runInDurableObject` because `FRONT_OFFICE_REAUTH_INTERVAL_MS` is 30s — without backdate, revoke + immediate broadcast would not re-check.
3. **C2 cap test:** opens 50 accepted sockets then expects 51st **503** — may need `ws.accept()` on each; if flakes, accept + hold until loop completes.
4. **C3 test protocol string:** offers `hospai.dev-actor.${actor}, front-office` comma-separated (RFC 6455 list) to mirror client helper output order.
5. **migrate.test.ts:** Task 3 updates v34 expectations — Task 4 frozen-head pin expects **34** (not 33).
6. **Task 1 no new test:** C4 relies on existing `night-audit.spec.ts` regression per spec §3.4.
