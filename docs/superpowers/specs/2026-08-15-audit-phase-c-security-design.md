# Audit Phase C — security hardening (C1–C4)

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **89**, `AUDIT_WRITER_COMMAND_IDS.size === 63`, `V1_HTTP_ROUTE_AUDIT[143].id === 'get_city_ledger_statement'`, `PROPERTY_SCHEMA_HEAD === 33`, `NIGHT_AUDIT_STEPS` length **8**. Phase B (business-logic defects) is in flight or landed — local suite trustworthy after Phase A.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [Full codebase audit — remediation plan](../../audit/2026-08-15-full-codebase-audit.md) Phase **C** items **C1**–**C4**; [Do not fix](../../audit/2026-08-15-full-codebase-audit.md#do-not-fix--deliberate-decisions) (degraded-replay system-actor row is normative for C1); appendix verification block; [Degraded-mode server design](./2026-08-04-degraded-mode-server-design.md) §7.1 permission decision (`:325–335`).

**Closes:** Audit **C1** (degraded replay attribution), **C2** (front-office WebSocket re-auth + cap), **C3** (Clerk JWT echoed in WS 101), **C4** (`reconcileHorizonForTest` ungated). **Defers:** **C5** (per-org blind-index key — own vertical). **Does not** advance **D1**, Phase **E+**, edge rate limiting, or the degraded-replay **permission** decision.

---

## Executive summary

Phase C closes four security gaps with minimal, additive changes. **C1** restores the audit anchor the degraded-mode spec promised (`actor.userId` at admission) without changing the deliberate system-actor permission bypass — new `provisional_exception.actor_user_id` column, structured-log fields, and a separate audit-actor path on replay. **C2** makes `FrontOfficeAttachment.userId` load-bearing: async full gate on accept/subscribe, sync cache-backed re-check on broadcast at a bounded interval, and a **50**-socket cap per PropertyDO. **C3** stops echoing bearer tokens in the 101 `Sec-WebSocket-Protocol` by selecting the constant `'front-office'` (client offers it alongside the auth subprotocol). **C4** adds the missing `assertUnsafeLocal` guard on the sole outlier test helper. **One head moves:** `PROPERTY_SCHEMA_HEAD` **33 → 34** (C1 migration only).

---

## 1. Context & motivation

### 1.1 Problem statement

| Item | Severity | Symptom | Root cause |
|---|---|---|---|
| **C1** | critical (compliance) | Every replayed provisional command attributes `system:queue_replay` in `audit_log` and omits the operator in logs/exceptions | `ProvisionalCommand.actor.userId` is populated at enqueue (`invoke-property-do.ts:58`) but never persisted; replay passes `REPLAY_ACTOR` (`pending-commands-consumer.ts:19`) to `try*` while `appendAuditLogSync` uses `auditActorSync(actor)` (`property-do.ts:2543–2544`, e.g. check-in **9437–9438**) |
| **C2** | high | Revoked/offboarded clerks keep streaming reservation deltas | `broadcastFrontOffice` (`property-do.ts:10868–10890`) filters by date window only; `FrontOfficeAttachment.userId` written at accept (**10806–10808**) and never read; no socket cap in `fetch` (**10787–10821**) |
| **C3** | medium | Clerk session JWT appears in WS response headers | `fetch` echoes raw `Sec-WebSocket-Protocol` header (**10819–10820**); client offers only `hospai.clerk.<JWT>` (`front-office-auth-protocol.ts:7`) |
| **C4** | low (defense-in-depth) | Test helper mutates `availability_day` without unsafe-local gate | `reconcileHorizonForTest` (**2891–2898**) lacks `assertUnsafeLocal`; all other PropertyDO `*ForTest` helpers gate (**1637+**, e.g. **2886**) |

### 1.2 C1 — permission vs attribution (locked; do not re-open)

The audit and [degraded-mode server design](./2026-08-04-degraded-mode-server-design.md) **deliberately** keep replay on a system actor that short-circuits `gatePermission` (`property-do.ts:1754`, consumer **19**, **99**). Reasons: dedupe-first + async `gatePermission` are mutually exclusive on the replay path (`degraded-mode-server-design.md:325–335`).

**C1 fixes only the compensating control:** "`userId` is the audit anchor" (`degraded-mode-server-design.md:162`). Authorization at admission stands; accountability at replay must record who acted.

| Concern | Actor passed to `try*` / `gatePermission` | Actor written to `audit_log` / `provisional_exception` / logs |
|---|---|---|
| Live HTTP | `{ kind: 'user', userId }` | same user |
| Queue replay (after C1) | `{ kind: 'system', reason: 'queue_replay' }` (**unchanged**) | **`provisional.actor.userId`** |

### 1.3 C2 — HTTP gate is sound; socket lifetime is not

`handleGetFrontOfficeStream` (`v1-dispatch.ts:5417–5437`) runs the full route gate (`reservations:read` + `pms.core`, route **`get_front_desk_stream`** at `v1-http-routes.ts:679–683`) and strips client actor headers before setting verified `x-hospai-ws-actor`. That gate runs **once** at upgrade. DO hibernation can keep sockets alive indefinitely with no re-check.

### 1.4 Heads (frozen except schema)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **33** | **34** — C1 adds `provisional_exception.actor_user_id` |
| `NIGHT_AUDIT_STEPS` | length **8** | **8** — unchanged |

After migration land: `pnpm generate:ddl && pnpm check:ddl` must be clean (new `migrations/do-property/0034_provisional_exception_actor.sql`).

### 1.5 Scope in

1. **C1** — attribution column, log fields, audit-actor threading on replay (Lock 1).
2. **C2** — re-auth on subscribe + broadcast interval, socket cap **50**, load-bearing `userId` (Lock 2).
3. **C3** — constant subprotocol in 101 + client offers `'front-office'` (Lock 3).
4. **C4** — `assertUnsafeLocal` on `reconcileHorizonForTest` (Lock 4).
5. **Tests** — one focused spec per item (§6).

### 1.6 Scope out (normative)

- **C5** per-org blind-index key — **deferred to its own vertical.** Key derivation lives in OrgDO (`org-do.ts:263–272`, `HOSPAI_ORG_MASTER_KEY` → `guest_blind_index` in `org-do.ts`); mixing `orgId` into HKDF `info` invalidates every existing `guest_blind_index` row and requires a cross-org backfill. Audit explicitly says "schedule as its own slice" (`2026-08-15-full-codebase-audit.md:341`). Does **not** move `PROPERTY_SCHEMA_HEAD` in isolation from the crypto migration.
- **D1** closed error-union refactor, Phase **B** items, Phase **E+**
- Changing degraded-replay **permission** behaviour (system actor / `gatePermission` short-circuit)
- Edge **rate limiting** (`api.rate_limit_rpm`, Phase 3) — C2's in-DO socket cap is in scope; do not add Worker-level rate limits here
- `pending_command_open` actor column (D1 / platform scope; deleted on ack)
- Exposing `actor_user_id` on HTTP exception-list responses (optional follow-up; column + insert is in scope)

---

## 2. Locked decisions (verbatim — do not deviate)

### Lock 1 — C1: degraded replay operator attribution

Three additive changes. **Do not** pass the envelope user as the permission actor. **Do not** add live `gatePermission` on replay.

#### 1a — Migration `provisional_exception.actor_user_id`

Confirm table is PropertyDO-scoped: `provisional_exception` is created in `property-migrations.ts` migration **v9** (`:260–270`, registry `:1207–1209`). New migration **v34**:

```ts
export const PROVISIONAL_EXCEPTION_ACTOR_V34_STATEMENTS = [
  `ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT`,
] as const;
```

Append to `PROPERTY_MIGRATIONS` as `{ version: 34, name: 'provisional_exception_actor', statements: ... }`. Regenerate `migrations/do-property/0034_provisional_exception_actor.sql` via `pnpm generate:ddl`.

**`recordProvisionalException`** (`property-do.ts:2691–2711`) — extend INSERT:

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

| Line | Event |
|---|---|
| **106–111** | `degraded.replayed` |
| **125–131** | `degraded.exception` |

Also add to early `degraded.exception` branches (**46–51**, **58–64**, **72–77**) for consistency when `provisional` is in scope.

#### 1c — Audit actor vs permission actor on replay

**Contracts** — extend `ProvisionalContext` (`packages/contracts/src/provisional-command.ts:32–35`):

```ts
export type ProvisionalContext = {
  issuedAt: string;
  businessDate: string;
  /** Admission-time operator — audit rows only; permission actor stays REPLAY_ACTOR. */
  auditUserId?: string;
};
```

**Consumer** (`pending-commands-consumer.ts:92–95`) — set on every replay dispatch:

```ts
const provisionalCtx: ProvisionalContext = {
  issuedAt: provisional.issuedAt,
  businessDate: provisional.businessDate,
  auditUserId: provisional.actor.userId,
};
```

**PropertyDO** — add helper next to `auditActorSync` (`property-do.ts:2543–2545`):

```ts
/** Permission actor may be system; audit attributes admission operator when replaying. */
private auditActorForCommandSync(actor: ActorContext, provisional?: ProvisionalContext): string {
  if (provisional?.auditUserId) return provisional.auditUserId;
  return this.auditActorSync(actor);
}
```

In every **`REPLAY_DISPATCH`** target `try*` method (`replay-dispatch.ts:78–163`), replace **`appendAuditLogSync` `actor:`** from `this.auditActorSync(actor)` to `this.auditActorForCommandSync(actor, provisional)`. Targets (8 methods):

| Command id | Method | Example audit line |
|---|---|---|
| `reservations.check_in` | `tryCheckIn` | **9437–9438** |
| `reservations.check_out` | `tryCheckOut` | grep `auditActorSync` in method |
| `reservations.cancel_check_in` | `tryCancelCheckIn` | same |
| `reservations.update_status` | `tryUpdateFrontOffice` | same |
| `folio.add_item` | `tryAddFolioLine` | same |
| `rooms.update_status` | `tryUpdateRoomStatus` | same |
| `rooms.bulk_update_status` | `tryBulkUpdateRoomStatus` | same |
| `housekeeping.assign` | `tryAssignHousekeeping` | same |

**Leave unchanged:** `gatePermission(actor, …)` calls; `REPLAY_ACTOR` in consumer **99**; `replay-dispatch.ts` invoke signatures (ctx already threads attribution).

**Enqueue path** (`invoke-property-do.ts:58`) — already sets `actor: { userId: opts.actorUserId }`; no change.

### Lock 2 — C2: front-office WebSocket re-auth + cap

#### 2a — Constants

```ts
const FRONT_OFFICE_MAX_SOCKETS = 50;
const FRONT_OFFICE_REAUTH_INTERVAL_MS = 30_000;
const FRONT_OFFICE_WS_CLOSE_POLICY = 4403; // private use — "policy violation"
const FRONT_OFFICE_WS_CLOSE_REASON = 'policy_violation';
```

Cap matches audit example (`2026-08-15-full-codebase-audit.md:297`). Re-auth interval is **half** `PermissionDoCache.MAX_AGE_MS` (`permission-cache.ts:15`) so broadcast checks see fresh cache entries before TTL expiry without per-frame OrgDO RPC.

#### 2b — Attachment shape

Extend `FrontOfficeAttachment` (`property-do.ts:274–279`):

```ts
type FrontOfficeAttachment = {
  propertyId: string;
  userId: string;
  fromDate: string | null;
  toDate: string | null;
  authCheckedAt: number; // ms — last successful full async gate
};
```

#### 2c — Sync cache peek helpers (new, `@hospai/entitlement-client`)

Add **read-only peek** methods — no OrgDO round trip:

**`PermissionDoCache.peekEffectiveRole(userId, propertyId): OrgRole | null`** — return cached role if entry exists and `now - cachedAt < MAX_AGE_MS`; else `null`.

**`EntitlementDoCache.peekEntitled(orgId, featureKey): boolean | null`** — return `true`/`false` from cached snapshot if fresh; else `null`.

These mirror existing async loaders (`permission-cache.ts:17–39`, `index.ts:121–128`) without mutating cache.

#### 2d — Async full gate (accept + subscribe)

Add **`private async assertFrontOfficeStreamAuthorized(userId: string): Promise<{ ok: true } | { ok: false }>`** on PropertyDO:

1. Reject empty `userId`.
2. `gatePermission({ kind: 'user', userId }, 'reservations:read')` — same permission as route **`get_front_desk_stream`**.
3. `gateCoreEntitlement(orgId)` — same entitlement as route (`pms.core`); kill-switch flows through entitlement path.
4. On success, return `{ ok: true }`.

**`fetch`** (`property-do.ts:10787–10821`) — reorder **before** `acceptWebSocket`:

1. Read `userId` from `x-hospai-ws-actor` (set by Worker at **5430**).
2. If `this.ctx.getWebSockets('front-office').length >= FRONT_OFFICE_MAX_SOCKETS`, return **503** `json({ error: 'front_office_stream_capacity' })` — do not accept.
3. `const gate = await this.assertFrontOfficeStreamAuthorized(userId)`; if `!gate.ok`, return **403** `json({ error: 'forbidden' })`.
4. Then `acceptWebSocket`, attachment includes `authCheckedAt: Date.now()`.

**`webSocketMessage` subscribe branch** (`property-do.ts:10838–10853`) — **before** updating window / sending snapshot:

```ts
const userId = prev.userId ?? '';
const gate = await this.assertFrontOfficeStreamAuthorized(userId);
if (!gate.ok) {
  ws.close(FRONT_OFFICE_WS_CLOSE_POLICY, FRONT_OFFICE_WS_CLOSE_REASON);
  return;
}
// serializeAttachment with authCheckedAt: Date.now()
```

#### 2e — Sync re-auth during broadcast (exact mechanism)

Add **`private peekFrontOfficeStreamAuthorizedSync(userId: string): boolean`**:

1. Empty `userId` → `false`.
2. `orgId` / `propertyId` from sync getters; missing → `false`.
3. `role = permissionCache.peekEffectiveRole(userId, propertyId)`; if `!role` or `!ROLE_GRANTS[role].includes('reservations:read')` → `false`.
4. `entitled = entitlementCache.peekEntitled(orgId, 'pms.core')`; if `entitled !== true` → `false` (treat stale/miss as deny on broadcast — strict).
5. Else `true`.

**`broadcastFrontOffice`** (`property-do.ts:10868–10890`) — at top of per-socket loop, **before** window overlap / `ws.send`:

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

This satisfies audit "re-resolve through the existing permission cache" on a **bounded interval during broadcast** without `await` inside the sync outbox/broadcast path. Revocation takes effect within **≤ interval + permission cache TTL** (worst case ~90s); tests drive immediate effect via `clearPermissionCacheForTest` + org membership removal + forced broadcast.

**Do not** add edge rate limiting. **Do not** delete `userId` from attachment — it becomes load-bearing (Lock 2b).

#### 2f — Worker path unchanged

`handleGetFrontOfficeStream` (`v1-dispatch.ts:5417–5437`) keeps initial HTTP gate + verified actor header. DO adds defense-in-depth for hibernated long-lived sockets.

### Lock 3 — C3: stop echoing JWT in 101

#### 3a — Server

**`property-do.ts:10818–10820`** — replace echo with RFC 6455 single selection:

```ts
const offered = request.headers.get('Sec-WebSocket-Protocol');
if (offered?.split(',').map((s) => s.trim()).includes('front-office')) {
  headers.set('Sec-WebSocket-Protocol', 'front-office');
}
```

If client does not offer `'front-office'`, omit response subprotocol (Clerk/dev paths **must** offer it after client change). **Never** echo `hospai.clerk.*` or raw multi-value header.

#### 3b — Client

**`apps/web-pms/src/shell/front-office-auth-protocol.ts`** — append `'front-office'` to every protocol list:

```ts
if (opts.useDevActor) return [`hospai.dev-actor.${opts.devActor}`, 'front-office'];
if (opts.clerkToken) return [`hospai.clerk.${opts.clerkToken}`, 'front-office'];
return undefined;
```

**`FrontOfficeLive.tsx`** uses this helper (**165–181**); no other client change required if helper is updated.

#### 3c — Tests

Update **`front-desk-stream.spec.ts:337`** — expect `'front-office'`, not full dev-actor protocol string. Add assertion: response header must **not** match `/\.(eyJ|session)/` or more simply **must not contain a `.`-separated JWT segment** (no substring matching `hospai.clerk.`).

### Lock 4 — C4: gate `reconcileHorizonForTest`

**`property-do.ts:2891`** — first statement:

```ts
this.assertUnsafeLocal('reconcileHorizonForTest');
```

**Verified:** PropertyDO defines **43** `assertUnsafeLocal`-gated helpers; `reconcileHorizonForTest` is the **sole** PropertyDO `*ForTest` outlier. (Audit counted **54** `*ForTest` across PropertyDO + OrgDO + OrgEntitlementDO; org helpers gate at `org-do.ts:389+`, `org-entitlement-do.ts:69`.)

**Verify:** `pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts` green (`HOSPAI_UNSAFE_LOCAL=1` in bindings).

---

## 3. Verification (normative)

Run after implementation (audit appendix + phase-specific):

```bash
pnpm generate:ddl && pnpm check:ddl   # C1 — must be clean
pnpm test:local
pnpm typecheck && pnpm build && pnpm lint
# all 14 check:* gates (audit appendix)
```

### 3.1 C1 — attribution

| # | Spec | Pass criteria |
|---|---|---|
| 1 | Enqueue provisional as `user_alice`, force successful replay | Latest `audit_log.actor === 'user_alice'`, **not** `system:queue_replay` |
| 2 | Same setup, force domain failure → `recordProvisionalException` | Row has `actor_user_id = 'user_alice'` |
| 3 | Log scrape / mock | `degraded.replayed` and `degraded.exception` include `actorUserId: 'user_alice'` |
| 4 | Permission unchanged | Replay still passes `REPLAY_ACTOR`; `gatePermission` not invoked for system actor on success path |

**Suggested file:** extend `apps/pms-core/test/degraded-mode.spec.ts` (existing queue/replay fixtures).

### 3.2 C2 — re-auth + cap

| # | Spec | Pass criteria |
|---|---|---|
| 1 | Open stream as member; revoke role in OrgDO; trigger `broadcastFrontOffice` (mutation outbox) | Socket gets **no further delta frames**; closed with code **4403** / reason **`policy_violation`** |
| 2 | Open **51** concurrent sockets (or loop until cap) | **51st** upgrade returns **503** `front_office_stream_capacity` |

**Suggested file:** extend `apps/pms-core/test/front-desk-stream.spec.ts` using `removePropertyMemberForTest` / `clearPermissionCacheForTest` patterns.

### 3.3 C3 — subprotocol

| # | Spec | Pass criteria |
|---|---|---|
| 1 | Upgrade with Clerk or dev-actor protocol list including `'front-office'` | 101 `Sec-WebSocket-Protocol === 'front-office'` |
| 2 | Same response | Header value contains **no** `.`-separated JWT segment (no `hospai.clerk.` echo) |
| 3 | Manual / `FrontOfficeLive.test.tsx` | Live board still connects and receives snapshot |

### 3.4 C4 — test helper gate

| # | Spec | Pass criteria |
|---|---|---|
| 1 | `night-audit.spec.ts` | Green with existing `HOSPAI_UNSAFE_LOCAL=1` bindings |

---

## 4. Test plan (implementer checklist)

| # | Item | File (suggested) |
|---|---|---|
| 1 | C1 successful replay audit actor | `degraded-mode.spec.ts` |
| 2 | C1 failing replay `actor_user_id` | `degraded-mode.spec.ts` |
| 3 | C2 revoke → broadcast closes socket | `front-desk-stream.spec.ts` |
| 4 | C2 socket cap 503 | `front-desk-stream.spec.ts` |
| 5 | C3 101 subprotocol + no JWT echo | `front-desk-stream.spec.ts` (+ update **331–337**) |
| 6 | C4 regression | `night-audit.spec.ts` (no new test — must stay green) |
| 7 | DDL | `pnpm generate:ddl && pnpm check:ddl` |
| 8 | Suite + gates | `pnpm test:local` + 14 `check:*` |

**TDD order:** C4 (one line) → C3 (server + client + test) → C1 migration + attribution → C2 re-auth + cap → full suite.

---

## 5. Rollback / migration notes

| Scenario | Action |
|---|---|
| C1 revert | Drop column migration not supported in prod without forward fix — prefer forward patch |
| C2 revert | Remove cap/re-auth; sockets return to pre-C behaviour |
| C3 revert | Restore header echo — **re-exposes JWT in responses** |
| C4 revert | Remove guard — test helper callable without unsafe local |
| Schema | **`PROPERTY_SCHEMA_HEAD` 34 → 33** only via revert commit of v34 migration |
| Catalog / routes | Unchanged |

---

## 6. File-level impact

| Area | Touch |
|---|---|
| `packages/do-runtime/src/property-migrations.ts` | v34 `actor_user_id` ALTER |
| `migrations/do-property/0034_provisional_exception_actor.sql` | generated |
| `packages/contracts/src/provisional-command.ts` | `ProvisionalContext.auditUserId` |
| `packages/entitlement-client/src/permission-cache.ts` | `peekEffectiveRole` |
| `packages/entitlement-client/src/index.ts` | `EntitlementDoCache.peekEntitled` |
| `apps/pms-core/src/pending-commands-consumer.ts` | `actorUserId` logs; `auditUserId` in ctx |
| `apps/pms-core/src/property-do.ts` | C1 helper + 8 audit call sites; C1 INSERT; C2 attachment/gate/peek/broadcast/fetch/subscribe; C3 subprotocol **10819–10820**; C4 **2891** |
| `apps/web-pms/src/shell/front-office-auth-protocol.ts` | offer `'front-office'` |
| `apps/pms-core/test/degraded-mode.spec.ts` | C1 |
| `apps/pms-core/test/front-desk-stream.spec.ts` | C2, C3 |
| `apps/pms-core/test/night-audit.spec.ts` | C4 regression |

**Not touched:** `COMMAND_CATALOG`, `V1_HTTP_ROUTE_AUDIT`, `AUDIT_WRITER_COMMAND_IDS`, `NIGHT_AUDIT_STEPS`, `replay-dispatch.ts` invoke wiring (beyond ctx field populated upstream), edge rate limiting, C5 / OrgDO blind-index, D1.

---

## 7. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Replay audit says `system:queue_replay` (C1) | `auditUserId` + column + logs |
| 2 | WS streams after revocation (C2) | Interval sync peek + subscribe re-gate |
| 3 | Unbounded WS fan-out (C2) | Cap **50** |
| 4 | JWT in 101 headers (C3) | Select `'front-office'` only |
| 5 | Ungated horizon test helper (C4) | `assertUnsafeLocal` |

**Still open (explicit):**

| Item | Owner |
|---|---|
| C5 per-org blind-index HKDF + backfill | Own vertical |
| D1 error union | Phase D |
| Edge rate limiting | Phase 3 entitlement |
| HTTP exposure of `actor_user_id` on exception APIs | Optional follow-up |

---

## 8. Implementation checklist

- [x] C1: migration v34 + DDL regenerate
- [x] C1: `recordProvisionalException` + log fields
- [x] C1: `ProvisionalContext.auditUserId` + `auditActorForCommandSync` + 8 `try*` audit sites
- [x] C2: peek helpers on entitlement-client caches
- [x] C2: `assertFrontOfficeStreamAuthorized` + fetch cap/gate + subscribe gate
- [x] C2: `broadcastFrontOffice` interval peek + close **4403**
- [x] C3: server select `'front-office'` + client protocol list
- [x] C4: `reconcileHorizonForTest` guard
- [x] Tests §4 + verify §3 green

---

## 9. Tree conflicts with reviewer locks

**One head moves:** `PROPERTY_SCHEMA_HEAD` **33 → 34** (C1 only). Catalog **89**, writers **63**, route tail `[143]`, night-audit steps **8** unchanged.

**Ambiguities resolved in this spec:**

| Question | Resolution |
|---|---|
| Change replay permission to user actor? | **No** — audit + degraded-mode spec normative; C1 attribution only |
| Where to thread audit user if not `gatePermission`? | **`ProvisionalContext.auditUserId`** + `auditActorForCommandSync` — permission actor stays `REPLAY_ACTOR` |
| Sync broadcast vs async `gatePermission`? | **Full async gate** on accept/subscribe; **sync cache peek** on broadcast interval (Lock 2e) |
| Socket cap value? | **50** per PropertyDO |
| Re-auth interval? | **30_000 ms** (half permission cache TTL) |
| WS close code? | **4403** + reason **`policy_violation`** |
| Client must offer `'front-office'`? | **Yes** — appended in `frontOfficeAuthProtocol`; server selects it in 101 |
| C5 in this chunk? | **Deferred** — HKDF + cross-org backfill risk |
| `listProvisionalExceptions` expose actor? | **Out of scope** — column populated on write |
| `replay-dispatch.ts` edits? | **None required** — consumer sets `auditUserId` on `ProvisionalContext` passed through existing `invoke` |

---

## 10. Exact code changes summary (for reviewer return)

### C1 — migration + consumer + property-do

| Location | Change |
|---|---|
| `property-migrations.ts` **v9 table ~260** | Confirms PropertyDO table — v34 adds column |
| `property-migrations.ts` **new v34** | `ALTER TABLE provisional_exception ADD COLUMN actor_user_id TEXT` |
| `pending-commands-consumer.ts` **19** | `REPLAY_ACTOR` — **unchanged** |
| `pending-commands-consumer.ts` **92–95** | Add `auditUserId: provisional.actor.userId` |
| `pending-commands-consumer.ts` **106, 125** | Add `actorUserId` to log objects |
| `provisional-command.ts` **32–35** | Add optional `auditUserId` |
| `property-do.ts` **2543–2545** | New `auditActorForCommandSync` |
| `property-do.ts` **2698–2710** | INSERT `actor_user_id` |
| `property-do.ts` **9437–9438** (+ 7 replay `try*` methods) | `auditActorForCommandSync(actor, provisional)` |
| `invoke-property-do.ts` **58** | Already sets `actor.userId` — no change |

### C2 — property-do + entitlement-client

| Location | Change |
|---|---|
| `property-do.ts` **274–279** | Attachment + `authCheckedAt` |
| `property-do.ts` **10787–10821** | Cap **503**, async gate **403**, then accept |
| `property-do.ts` **10838–10853** | Subscribe async re-gate |
| `property-do.ts` **10868–10890** | Interval sync peek; close **4403** |
| `permission-cache.ts` | `peekEffectiveRole` |
| `index.ts` (`EntitlementDoCache`) | `peekEntitled` |
| `v1-dispatch.ts` **5417–5437** | Unchanged (initial gate) |

### C3 — property-do + web-pms

| Location | Change |
|---|---|
| `property-do.ts` **10819–10820** | Select `'front-office'` if offered |
| `front-office-auth-protocol.ts` **6–8** | Append `'front-office'` to protocol arrays |
| `front-desk-stream.spec.ts` **337** | Expect `'front-office'` |

### C4 — property-do

| Location | Change |
|---|---|
| `property-do.ts` **2891** | `this.assertUnsafeLocal('reconcileHorizonForTest');` first line |

---

## 11. Which head moves and why

| Head | Moves? | Why |
|---|---|---|
| `PROPERTY_SCHEMA_HEAD` | **33 → 34** | C1: additive `provisional_exception.actor_user_id` column in PropertyDO migrations |
| `COMMAND_CATALOG` | **No** | No new commands |
| `AUDIT_WRITER_COMMAND_IDS.size` | **No** | No new audit writer ids |
| `V1_HTTP_ROUTE_AUDIT` | **No** | No route changes |
| `NIGHT_AUDIT_STEPS` | **No** | No night-audit step changes |
