# Kill-switch, replay permission, degraded transport, R2 terminal fail (R0.9)

**Tree verified 2026-09-05:** `COMMAND_CATALOG` length **89**, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `ORG_SCHEMA_HEAD === 9`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`. Pins match `packages/contracts/src/register.test.ts` and `packages/do-runtime/src/migrate.test.ts` on current `main`.

**Date:** 2026-09-05  
**Status:** Approved (reviewer)  
**Sources:** [Full codebase audit — Vertical 9](../../audit/2026-09-04-full-codebase-audit.md) (**S4**, **X2**, **N7**, **X3**); [AGENTS.md §1 kill-switch / replay / degraded / R2](../../../AGENTS.md); `apps/pms-core/src/v1-dispatch.ts` (`dispatchV1` kill-switch gate ~9087–9107; `post_org_cancel` / `post_org_purge` ~8177–8190); `apps/pms-core/src/pending-commands-consumer.ts` (user replay actor ~103); `apps/pms-core/src/property-do.ts` (`gatePermission` system short-circuit ~1777; `tryCheckIn` gate-before-`runIdempotent` ~9455); `apps/pms-core/src/property-do-transport.ts` + `org-do-transport.ts` (duplicate allowlists); `apps/pms-core/src/index.ts` (events consumer missing-R2 retry loop ~169–171); [2026-08-04-degraded-mode-server-design.md](./2026-08-04-degraded-mode-server-design.md); [2026-07-28-entitlements-killswitch-design.md](./2026-07-28-entitlements-killswitch-design.md); [2026-08-12-event-log-r2-design.md](./2026-08-12-event-log-r2-design.md); [2026-08-12-purge-workflow-design.md](./2026-08-12-purge-workflow-design.md).

**Closes:** Audit **S4** (kill-switch skipped on cancel/purge), **X2** (provisional replay skips permission / false exceptions on dedupe), **N7** (degraded allowlist gaps + duplicate modules), **X3** (missing `EVENT_LOG_R2` retries forever). **Roadmap:** **R0.9**. **Requires:** R0.8 replay actor storage-key alignment (consumer already passes `{ kind: 'user', userId }`). **Does not** advance Vertical 10 error-table sweep, N13 DLQ noise, Playwright, PropertyDO extraction, schema bump, or new catalog commands.

---

## Executive summary

Four safety gaps remain in the operational apparatus:

1. **S4:** `checkKillSwitch` runs only when `entitlementForRoute(route)` is non-null. `post_org_cancel` and `post_org_purge` have **no** `entitlement` and **no** `commandId`, so org cancel/purge stay live during `kill:pms.core` while every entitled desk route is shed.
2. **X2:** R0.8 changed the pending-commands consumer to invoke replay as the **original user** (`pending-commands-consumer.ts:103`), but `gatePermission` still short-circuits `{ kind: 'system' }` (`property-do.ts:1777`, `org-do.ts:787`). That is correct for night-audit alarms, wrong if any replay path still passes `system`. The remaining hole is **ordering**: `gatePermission` runs **before** `runIdempotent` on every `try*` with a `provisional` arg, so a duplicate delivery after successful apply + offboarded operator hits `not_member` **before** dedupe — test **6b** in `degraded-mode.spec.ts` is the regression canary. First replay **after** offboard (never applied) must land in `provisional_exception`, not mutate.
3. **N7:** Property and Org transport classifiers are copy-pasted (`property-do-transport.ts`, `org-do-transport.ts`) with only the test sentinel string differing. Both omit Cloudflare overload / eviction / storage-internal / cannot-resolve shapes. Test sentinels live in the production allowlist unconditionally.
4. **X3:** When `EVENT_LOG_R2` is unbound, the events queue consumer calls `msg.retry()` on every survivor (`index.ts:169–171`) with no terminal path — infinite retry in local/test misconfigs. Distinct from **N13** (DLQ depth noise **with** R2 present).

This spec locks explicit kill-switch on cancel/purge, **dedupe-first replay permission** for all `QUEUE_PROVISIONAL` `try*` methods, one shared transport module with extended allowlist + unsafe-local test sentinel, and **ack-without-retry** (terminal) when R2 is missing. **Tests land first** and must fail on current `main` where the hole remains.

---

## Locked product call

1. **S4 — cancel/purge kill-switch:** After auth, before tenant resolution, `dispatchV1` checks `checkKillSwitch(env, 'pms.core')` when `route.id === 'post_org_cancel' || route.id === 'post_org_purge'`. Active → **503** empty body (same as entitled routes today). **Do not** add `entitlement: 'pms.core'` to those route defs. **Do not** fold cancel/purge into generic `entitlementForRoute` just to reuse the existing ternary.
2. **S4 — membership stays up:** Org/property membership routes (`create_org_member`, `create_property_member`, …) remain **without** `entitlement` and **without** kill-switch — operators can add staff during an outage.
3. **X2 — replay permission:** Pending-commands consumer and exception-workbench retry continue passing `{ kind: 'user', userId: provisional.actor.userId }`. Every `try*` that accepts optional `provisional?: ProvisionalContext` and is reachable from `REPLAY_DISPATCH` must **dedupe-first, then permission**: sync idempotency cache probe → if hit return cached `{ ok, … }` without `gatePermission`; on miss `await gatePermission(actor, …)` with the **user** actor; then `runIdempotent`. Revoked/offboarded operator on **first** replay → `{ ok: false, error: 'not_member' | FORBIDDEN }` → consumer writes `provisional_exception`, **no mutation**.
4. **X2 — system actor preserved:** `gatePermission` **keeps** `if (actor.kind === 'system') return null` for night-audit alarm handlers, workflow steps, and other true system jobs. **Remove** stale `REPLAY_ACTOR` references in comments/docs; no `REPLAY_ACTOR` constant in production code.
5. **N7 — one module:** Single `do-transport-failure.ts` (name locked below) owns shared substring allowlist + `isDoTransportFailure()`. `property-do-transport.ts` and `org-do-transport.ts` become thin re-exports (`isPropertyDoTransportFailure` / `isOrgDoTransportFailure` delegate to shared helper with DO-kind-specific test sentinel). Extend allowlist with overload, eviction, storage-internal, cannot-resolve fragments (table in §2.4). Test sentinel strings are included in matching **only** when `env.HOSPAI_UNSAFE_LOCAL === '1'` (or caller passes `includeTestSentinel: true` in vitest).
6. **X3 — missing R2:** When `!hasEventLogR2(env)`, log `event_log.r2_unbound` once per batch, **`msg.ack()`** every survivor (no `retry()`), skip projection. Misconfigured env loses events but cannot wedge the queue. **Out of scope:** N13 DLQ cleanup when R2 **is** bound.

### Reviewer locks (normative)

| Lock | Decision |
|---|---|
| **Cancel/purge kill-switch** | Explicit `checkKillSwitch(env, 'pms.core')` on route ids `post_org_cancel`, `post_org_purge` only. **503** empty body. No route `entitlement` field. |
| **Membership during kill-switch** | No kill-switch on org/property member routes (no `entitlement` today — unchanged). |
| **Kill-switch HTTP** | Match existing entitled-route behaviour (**503**, empty body). No fifth status mapper. |
| **Replay actor** | User actor from envelope on queue consumer + exception retry. System actor only for true system callers. |
| **Dedupe before permission** | When `provisional != null`: `readIdempotentCacheSync(sql, idem, actor)` **before** `await gatePermission`. Cache hit → return parsed response immediately. |
| **First replay after revoke** | `not_member` / `FORBIDDEN` → exception row; reservation/folio/room state unchanged. |
| **Duplicate after apply + revoke** | Idempotency cache hit → success replay; **zero** new exception rows (preserves degraded-mode test **6b**). |
| **Shared transport module** | One file; Property + Org re-export wrappers. Table-driven allowlist test per substring. |
| **Test sentinel** | `PropertyDO transport blocked for test…` / Org twin **not** in production allowlist; merged only under `HOSPAI_UNSAFE_LOCAL=1`. `setTransportBlockedForTest` stays `assertUnsafeLocal`-gated. |
| **Missing R2** | Ack terminal — **no** infinite `retry()`. Structured log `event_log.r2_unbound`. |
| **Tests first** | Characterization specs fail on `main` before production edits. |
| **Pins** | No catalog length change; no schema bump; no new commands. |
| **Out** | Playwright; PropertyDO extraction; N13; entitlement table sweep (V10). |

---

## 1. Problem / evidence

### 1.1 S4 — kill-switch skipped on cancel/purge (medium)

`dispatchV1` only schedules kill-switch when a route carries entitlement:

```9087:9107:apps/pms-core/src/v1-dispatch.ts
  const feature = entitlementForRoute(route);
  const killSwitchPromise =
    feature != null ? checkKillSwitch(env, feature) : Promise.resolve(false);
  // ...
  if (feature && (await killSwitchPromise)) {
    return new Response(null, { status: 503 });
  }
```

`post_org_cancel` and `post_org_purge` are org-scoped routes with `permission` only — no `entitlement`, no `commandId`:

```8177:8190:apps/pms-core/src/v1-dispatch.ts
  {
    id: 'post_org_cancel',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/cancel$/,
    permission: 'org:cancel',
    handler: handlePostOrgCancel,
  },
  {
    id: 'post_org_purge',
    scope: 'org',
    method: 'POST',
    pattern: /^\/v1\/orgs\/([^/]+)\/purge$/,
    permission: 'org:purge',
    handler: handlePostOrgPurge,
  },
```

During `kill:pms.core`, desk mutations return **503** but cancel/purge still run — contradicts AGENTS.md (“Must block **org cancel and purge**”).

Membership routes (`create_org_member`, `create_property_member`, …) also lack entitlement — **intentionally** left unblocked so staff can be added mid-incident.

### 1.2 X2 — replay permission vs dedupe ordering (medium)

**R0.8 partial fix:** consumer invokes with user actor:

```103:111:apps/pms-core/src/pending-commands-consumer.ts
      const replayActor: ActorContext = { kind: 'user', userId: provisional.actor.userId };

      const result = await dispatch.invoke(
        resolved.stub,
        replayActor,
        provisional.command.payload,
        { key: provisional.idempotencyKey, fingerprint: provisional.requestFingerprint },
        provisionalCtx,
      );
```

**System short-circuit still exists** (required for night audit):

```1773:1777:apps/pms-core/src/property-do.ts
  private async gatePermission(
    actor: ActorContext,
    permission: Permission,
  ): Promise<{ ok: false; error: typeof FORBIDDEN | 'not_member' } | null> {
    if (actor.kind === 'system') return null;
```

**Ordering bug:** `tryCheckIn` (and all replay-eligible `try*`) call `gatePermission` **before** `runIdempotent`:

```9455:9460:apps/pms-core/src/property-do.ts
    const permDenied = await this.gatePermission(actor, 'reservations:write');
    if (permDenied) return permDenied;

    try {
      return this.ctx.storage.transactionSync(() =>
        runIdempotent(this.ctx.storage.sql, idem, () => {
```

So duplicate queue delivery after successful apply + revoked membership runs permission **before** dedupe — [degraded-mode spec §7.1](./2026-08-04-degraded-mode-server-design.md) predicted this. Test **6b** expects `countProvisionalExceptions() === 0` after second delivery; with user-actor + gate-first, second delivery would create a false `not_member` exception unless dedupe-first is implemented.

**Stale docs:** `packages/contracts/src/provisional-command.ts:35` still says “permission actor stays REPLAY_ACTOR”. Phase C audit spec locked that intentionally; **this vertical overturns it** for permission (audit attribution via `ProvisionalContext.auditUserId` stays).

**Replay-eligible commands** (`REPLAY_DISPATCH` + catalog `QUEUE_PROVISIONAL`):

| `command.type` | `try*` | Permission |
|---|---|---|
| `reservations.check_in` | `tryCheckIn` | `reservations:write` |
| `reservations.check_out` | `tryCheckOut` | `reservations:write` |
| `reservations.cancel_check_in` | `tryCancelCheckIn` | `reservations:write` |
| `reservations.update_status` | `tryUpdateFrontOffice` | `reservations:write` |
| `folio.add_item` | `tryAddFolioLine` | `folio:post` |
| `rooms.update_status` | `tryUpdateRoomStatus` | `housekeeping:write` |
| `rooms.bulk_update_status` | `tryBulkUpdateRoomStatus` | `housekeeping:write` |
| `housekeeping.assign` | `tryAssignHousekeeping` | `housekeeping:write` |

### 1.3 N7 — duplicate allowlists, missing Cloudflare strings (medium)

Two near-identical files differ only in test sentinel constant name/message prefix:

```9:16:apps/pms-core/src/property-do-transport.ts
export const PROPERTY_DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
];
```

Org twin is byte-identical except `ORG_DO_TRANSPORT_BLOCKED_MESSAGE`. Audit **N7** requires overload, eviction, storage internal, cannot-resolve — none present. Test sentinel is always in the production list (should be unsafe-local only).

Existing coverage: `degraded-mode.spec.ts` pins harness error to allowlist once; no table-driven per-string tests.

### 1.4 X3 — missing R2 infinite retry (medium)

```169:172:apps/pms-core/src/index.ts
    if (!hasEventLogR2(env) || !env.EVENT_LOG_R2) {
      for (const msg of survivors) msg.retry();
      return;
    }
```

Every batch redelivers forever when binding absent (common in partial test env). **N13** (DLQ noise with R2 **present**) is explicitly out of scope.

---

## 2. Locked behaviour

### 2.1 S4 — explicit cancel/purge kill-switch

Add a small helper or inline gate in `dispatchV1` **after** actor resolution, **before** tenant resolution (same position as entitlement kill-switch):

```ts
const KILL_SWITCH_LIFECYCLE_ROUTES = new Set(['post_org_cancel', 'post_org_purge'] as const);

// After dev/bootstrap early returns, alongside existing feature kill-switch:
if (
  (feature && (await killSwitchPromise)) ||
  (KILL_SWITCH_LIFECYCLE_ROUTES.has(route.id as typeof KILL_SWITCH_LIFECYCLE_ROUTES extends Set<infer T> ? T : never) &&
    (await checkKillSwitch(env, 'pms.core')))
) {
  return new Response(null, { status: 503 });
}
```

**Verification:** With `setKillSwitch(env, 'pms.core', true)`:

| Route | Expect |
|---|---|
| `POST …/cancel` | **503** empty; org status unchanged |
| `POST …/purge` | **503** empty; no workflow id returned |
| `POST …/members` (org or property) | **Not** 503 from kill-switch (may 403/404 on permission) |
| `POST …/properties` (entitled) | **503** empty (existing) |

### 2.2 X2 — dedupe-first replay permission

Add to `packages/do-runtime/src/idempotency.ts`:

```ts
/** Sync probe — same key/fingerprint rules as runIdempotent, no mutation. */
export function readIdempotentCacheSync<T>(
  sql: SqlStorageLike,
  idem: IdempotencyKey,
  actor: ActorContext,
): T | null {
  const storageKey = scopeIdempotencyKey(actor, idem.key);
  const prior = sql
    .exec(`SELECT request_fingerprint, response FROM idempotency WHERE key = ?`, storageKey)
    .toArray() as Array<{ request_fingerprint: string; response: string }>;
  if (prior.length === 0) return null;
  if (prior[0]!.request_fingerprint !== idem.fingerprint) {
    throw new IdempotencyKeyReused(idem.key);
  }
  return JSON.parse(prior[0]!.response) as T;
}
```

Add private helper on `PropertyDO` (pattern for every replay `try*`):

```ts
private replayPrecheckSync<T>(
  actor: ActorContext,
  idem: IdempotencyKey,
  provisional?: ProvisionalContext,
): T | null {
  if (!provisional) return null;
  return readIdempotentCacheSync<T>(this.ctx.storage.sql, idem, actor);
}
```

**Method body order** (replay-eligible `try*` only):

1. `this.lanes.touchInteractive()` (unchanged)
2. org/property preconditions — return-style, before idempotency
3. **`const cached = this.replayPrecheckSync<…>(actor, idem, provisional); if (cached !== null) return cached;`**
4. **`await gatePermission(actor, requiredPermission)`** — runs for user actor; system still short-circuits
5. entitlement / guest gates as today
6. `transactionSync(() => runIdempotent(…))` — dedupe inside remains (harmless second check)

**Consumer:** no change to actor wiring if already user-shaped. **Remove** any remaining `REPLAY_ACTOR` constant/import if found.

**Exception workbench retry** ([exception-queue-workbench spec](./2026-08-13-exception-queue-workbench-design.md)): already uses operator user actor — inherits dedupe-first automatically once `try*` updated.

**Contract comment:** Update `ProvisionalContext` JSDoc — permission re-check uses envelope `actor.userId`; `auditUserId` remains audit-only.

### 2.3 N7 — shared `do-transport-failure.ts`

New file: `apps/pms-core/src/do-transport-failure.ts`

```ts
/** Substrings matched against Error.message — intentionally brittle across workerd versions. */
export const DO_TRANSPORT_ALLOWLIST: readonly string[] = [
  'inputGateBroken',
  'Durable Object reset because its code was updated',
  'Network connection lost',
  'connection reset',
  'temporarily unavailable',
  // N7 extensions (substring — tune against real Cloudflare/workerd captures):
  'overloaded',
  'Durable Object is overloaded',
  'evicted',
  'object evicted',
  'Durable Object storage operation failed',
  'internal error in Durable Object storage',
  'cannot resolve Durable Object',
  'Could not resolve Durable Object',
];

export const PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE =
  'PropertyDO transport blocked for test (degraded-mode fault injection)' as const;
export const ORG_DO_TRANSPORT_BLOCKED_MESSAGE =
  'OrgDO transport blocked for test (degraded-mode fault injection)' as const;

export type DoTransportKind = 'property' | 'org';

export function isDoTransportFailure(
  error: unknown,
  opts?: { kind?: DoTransportKind; includeTestSentinel?: boolean },
): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  const list = opts?.includeTestSentinel
    ? [
        ...DO_TRANSPORT_ALLOWLIST,
        opts.kind === 'org'
          ? ORG_DO_TRANSPORT_BLOCKED_MESSAGE
          : PROPERTY_DO_TRANSPORT_BLOCKED_MESSAGE,
      ]
    : DO_TRANSPORT_ALLOWLIST;
  return list.some((fragment) => msg.includes(fragment));
}

export function isPropertyDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'property',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}

export function isOrgDoTransportFailure(
  error: unknown,
  env?: { HOSPAI_UNSAFE_LOCAL?: string },
): boolean {
  return isDoTransportFailure(error, {
    kind: 'org',
    includeTestSentinel: env?.HOSPAI_UNSAFE_LOCAL === '1',
  });
}
```

**Migration:**

- `property-do-transport.ts` / `org-do-transport.ts` re-export from shared module (keep paths stable for imports / `check:do-transport-guards`).
- Call sites that classify transport in production pass `env` where available (`invokePropertyDo`, `gateOrgRef`, consumer catch).
- `PropertyDO.setTransportBlockedForTest` / Org twin: unchanged except thrown message still matches sentinel when unsafe-local.

**Table-driven test** (`do-transport-failure.spec.ts`): one `it.each` row per allowlist fragment + negative control; include sentinel row gated on `includeTestSentinel: true`.

### 2.4 X3 — terminal handling when R2 unbound

Replace retry loop in `index.ts` queue handler:

```ts
if (!hasEventLogR2(env) || !env.EVENT_LOG_R2) {
  logWarn({ moduleId: 'pms.events' }, {
    msg: 'event_log.r2_unbound',
    survivorCount: survivors.length,
  });
  for (const msg of survivors) {
    msg.ack(); // terminal — do not retry forever
  }
  return;
}
```

**Semantics:** Events are **not** archived and **not** projected when binding missing — acceptable for misconfigured local/test. Production wrangler binds `EVENT_LOG_R2` ([event-log R2 spec §2](./2026-08-12-event-log-r2-design.md)).

**Not this slice:** partial R2 put failure (still per-group retry → DLQ per existing design).

---

## 3. Implementation steps

**Order: failing characterization tests on `main`, then production.**

### 3.1 Tests first (red on `main`)

**New `apps/pms-core/test/kill-switch-lifecycle.spec.ts`**

| Case | Assert |
|---|---|
| Kill-switch on → `POST …/cancel` | **503** empty; org not `closing` |
| Kill-switch on → `POST …/purge` | **503** empty |
| Kill-switch on → `POST …/members` (property) | **≠ 503** from kill-switch (e.g. 201/403/404) |

**Extend `apps/pms-core/test/degraded-mode.spec.ts`**

| Case | Assert |
|---|---|
| **X2a** First replay after offboard (never applied) | `provisional_exception` reason `not_member`; reservation still `confirmed` |
| **6b** (existing) | After successful apply + offboard + duplicate delivery | **Zero** exceptions (must stay green after fix) |
| **X2b** Folio `folio.add_item` replay after offboard | Same exception pattern; no folio line |

**New `apps/pms-core/test/do-transport-failure.spec.ts`**

| Case | Assert |
|---|---|
| `it.each(DO_TRANSPORT_ALLOWLIST)` | Synthetic `Error('prefix … fragment … suffix')` → `true` |
| Harness blocked message with `includeTestSentinel: false` | `false` |
| Harness blocked message with `includeTestSentinel: true` | `true` |
| `'simulated_internal_bug'` | `false` |

**New or extend `apps/pms-core/test/events-queue-r2-unbound.spec.ts`**

| Case | Assert |
|---|---|
| Env without `EVENT_LOG_R2`, one event message | Consumer acks; `retry()` **not** called; log contains `event_log.r2_unbound` |

Tests **S4**, **X2a**, transport new strings (until added), and **X3** must **fail on current `main`**.

### 3.2 Production (green tests)

1. **`dispatchV1` lifecycle kill-switch** (§2.1).
2. **`readIdempotentCacheSync` + `replayPrecheckSync`** on all eight replay `try*` methods (§2.2).
3. **`do-transport-failure.ts`** + re-export shims; wire `env` into classifiers; extend allowlist (§2.3).
4. **Events consumer terminal ack** when R2 missing (§2.4).
5. **Comment cleanup:** `provisional-command.ts`, any `REPLAY_ACTOR` leftovers in specs/code comments tied to permission path.

### 3.3 Pins / gates

| Pin | This vertical |
|---|---|
| `COMMAND_CATALOG` length | **89** (unchanged) |
| `V1_HTTP_ROUTE_AUDIT` | **144**; last `get_city_ledger_statement` |
| `PROPERTY_SCHEMA_HEAD` | **34** |
| `ORG_SCHEMA_HEAD` | **9** |
| `NIGHT_AUDIT_STEPS` | **8**; `[3] === 'AUTO_TRANSFER'` |

Full gate: `pnpm build && pnpm typecheck && pnpm lint && pnpm test:local` (8 shards; never `--` before `--shard`).

---

## 4. Test matrix

| # | File | Setup | Action | Expect (on fixed code) |
|---|---|---|---|---|
| T1 | `kill-switch-lifecycle.spec.ts` | Org + owner; `setKillSwitch(pms.core, true)` | `POST …/cancel` `{ action: 'close' }` | **503** empty; org status not `closing` |
| T2 | same | Kill-switch on | `POST …/purge` `{ confirm: true, orgId }` | **503** empty |
| T3 | same | Kill-switch on | `POST …/properties/…/members` add staff | **Not** kill-switch **503** |
| T4 | same | Kill-switch off | Cancel close succeeds | **200** (sanity) |
| T5 | `degraded-mode.spec.ts` | Queue check-in while blocked; offboard actor **before** first replay | `dispatchPendingBatch` once | Exception `not_member`; not checked in |
| T6 | `degraded-mode.spec.ts` | Apply once; offboard; duplicate msg (**6b**) | Second `dispatchPendingBatch` | **0** exceptions; idempotency dedupe |
| T7 | `degraded-mode.spec.ts` | Queue `folio.add_item`; offboard before replay | First replay | Exception; no folio line |
| T8 | `do-transport-failure.spec.ts` | — | `it.each` allowlist fragment | `isDoTransportFailure === true` |
| T9 | same | — | Blocked message, prod mode | `false` |
| T10 | same | — | Blocked message, `includeTestSentinel: true` | `true` |
| T11 | `events-queue-r2-unbound.spec.ts` | Strip `EVENT_LOG_R2` from env | Deliver one `DomainEventMessage` | Ack; no retry; log `event_log.r2_unbound` |
| T12 | `degraded-mode.spec.ts` | — | Existing transport harness pin | Still passes with unsafe-local sentinel |
| T13 | `entitlements.spec.ts` | — | Existing kill-switch on entitled route | Still **503** (no regression) |

Tests **T1–T3**, **T5**, **T8** (new strings until added), **T11** must **fail on current `main`**.

---

## 5. Verify commands

```bash
pnpm --filter @hospai/do-runtime exec vitest run src/idempotency.test.ts

pnpm --filter @hospai/pms-core exec vitest run \
  test/kill-switch-lifecycle.spec.ts \
  test/degraded-mode.spec.ts \
  test/do-transport-failure.spec.ts \
  test/events-queue-r2-unbound.spec.ts
```

Full gate after implementation:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test:local
```

---

## 6. Files in scope

| File | Change |
|---|---|
| `apps/pms-core/src/v1-dispatch.ts` | S4 lifecycle kill-switch gate |
| `apps/pms-core/src/do-transport-failure.ts` | **New** — shared allowlist + classifiers |
| `apps/pms-core/src/property-do-transport.ts` | Re-export shim |
| `apps/pms-core/src/org-do-transport.ts` | Re-export shim |
| `apps/pms-core/src/invoke-property-do.ts` | Pass `env` to `isPropertyDoTransportFailure` |
| `apps/pms-core/src/property-do.ts` | `replayPrecheckSync` on replay `try*`; `gateOrgRef` env pass-through if needed |
| `apps/pms-core/src/org-do.ts` | Org transport classifier env pass-through |
| `apps/pms-core/src/index.ts` | X3 terminal ack when R2 missing |
| `packages/do-runtime/src/idempotency.ts` | `readIdempotentCacheSync` |
| `packages/contracts/src/provisional-command.ts` | JSDoc — permission uses user actor on replay |
| `apps/pms-core/test/kill-switch-lifecycle.spec.ts` | **New** — T1–T4 |
| `apps/pms-core/test/degraded-mode.spec.ts` | X2a, X2b; keep 6b green |
| `apps/pms-core/test/do-transport-failure.spec.ts` | **New** — T8–T10 |
| `apps/pms-core/test/events-queue-r2-unbound.spec.ts` | **New** — T11 |
| `scripts/do-transport-guards-check.mjs` | Import path unchanged if shims preserve exports |

**Not in scope:** `apps/web-pms`; wrangler binding changes; `COMMAND_CATALOG`; schema migrations; Playwright.

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

No new dispatched command. No route audit length change (kill-switch is dispatch logic only).

---

## 8. Out of scope

- **N13** — DLQ depth / noise when `EVENT_LOG_R2` **is** bound (Vertical 14 hygiene)
- **Vertical 10** — `commandErrorHttpStatus` sweep, `entitlement_required` → 402 everywhere
- Roster routes during kill-switch (roster carries `pms.core` entitlement today — unchanged; not membership)
- Kill-switch on night-audit **alarm** handlers ([entitlements spec deferred hazard](./2026-07-28-entitlements-killswitch-design.md))
- Real Cloudflare overload **simulation** in vitest (synthetic `Error.message` substrings only)
- Playwright / staging smoke changes
- PropertyDO extraction
- Exception workbench UX (data path inherits X2 fix only)

---

## 9. Success criteria

1. `kill:pms.core` active → cancel and purge return **503** empty; membership POST does **not** (**S4**).
2. First replay after operator offboard → `provisional_exception`, no mutation (**X2**).
3. Duplicate replay after successful apply + offboard → idempotency cache hit, **no** false exception (**6b** / **X2**).
4. Night-audit / system callers still bypass `gatePermission` via `system` actor.
5. One shared transport module; table-driven tests per allowlist string; test sentinel unsafe-local only (**N7**).
6. Missing `EVENT_LOG_R2` → ack terminal, no infinite retry (**X3**).
7. Pins unchanged; `pnpm test:local` green.

---

## 10. Relationship to prior specs

- [2026-07-28-entitlements-killswitch-design.md](./2026-07-28-entitlements-killswitch-design.md) — kill-switch KV model; this slice adds **lifecycle route exception** without folding cancel/purge into entitlement.
- [2026-08-04-degraded-mode-server-design.md](./2026-08-04-degraded-mode-server-design.md) — provisional queue + replay rules; §7.1 rejected user-actor replay for dedupe conflict — **this spec implements rejected alternative (b)** (`readIdempotentCacheSync` before `gatePermission`) now that R0.8 uses user actor + user-scoped idempotency keys.
- [2026-08-12-purge-workflow-design.md](./2026-08-12-purge-workflow-design.md) — cancel/purge HTTP; S4 ensures kill-switch blocks workflow start during incident.
- [2026-08-12-event-log-r2-design.md](./2026-08-12-event-log-r2-design.md) — R2 write path; X3 covers **unbound** binding only.
- [2026-08-15-audit-phase-c-security-design.md](./2026-08-15-audit-phase-c-security-design.md) — C1 audit attribution via `auditUserId`; **overturns** C1 lock “permission actor stays REPLAY_ACTOR” for X2.
- [2026-09-05-bounded-bulk-idempotency-json-design.md](./2026-09-05-bounded-bulk-idempotency-json-design.md) — R0.8 user-scoped idempotency keys (S6); prerequisite for dedupe-first replay permission.

---

## 11. Error reference

| Condition | HTTP / wire | Body |
|---|---|---|
| Kill-switch active (entitled route or cancel/purge) | **503** | empty body |
| Replay permission denied | DO `{ ok: false, error: 'not_member' \| FORBIDDEN }` | consumer → `provisional_exception` |
| Idempotency cache hit on replay | DO `{ ok: true, … }` (cached) | no exception |
| Missing `EVENT_LOG_R2` at consumer | — | `event_log.r2_unbound` log; message **acked** |

Domain failures continue `{ ok: false, error }`; gates continue bare `{ error }` — no third envelope.
