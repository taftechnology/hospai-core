# Audit Phase D — close the error channel (D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **I'm using the writing-plans skill to create the implementation plan.**
>
> **Status:** Draft (plan writer, 2026-08-15)
>
> **Spec/plan writers do not commit.** Implementers commit per task. Work on `main`. No push.

**Goal:** Close audit **D1** — replace untyped `error: string` DO RPC catch-alls with closed `CommandError`, add **36** wire constants (+ relocate `NIGHT_AUDIT_HALTED`), fix `CONFIG_CLASS_NOT_DOMAIN`, unify **`not_member` → 404** (9 sites), and exhaustively type six dispatch status mappers. **One head moves:** `idempotency.ts` `export const` count **120 → 157**.

**Architecture:** Contracts-first TDD; PropertyDO in five vertical slices (config → inventory/rooms → reservations/folio → night-audit/provisional → payments) keeping `pnpm typecheck` green per commit; then OrgDO → OrgEntitlementDO → `v1-dispatch` mappers (separate commit — do **not** batch DO + dispatch). Compile errors are the primary type-level test; HTTP behaviour tests red-first for the two mandated status deltas (`not_member`, config domain class).

**Tech Stack:** `@hospai/contracts`, Cloudflare Workers Durable Objects (`property-do.ts`, `org-do.ts`, `org-entitlement-do.ts`), `v1-dispatch.ts`, vitest + `vitest-pool-workers`, root `pnpm test:local`.

**Spec:** `docs/superpowers/specs/2026-08-15-audit-phase-d-error-channel-design.md` (Locks 1–5 normative).

---

## Frozen heads (state which move)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — no new commands |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** |
| `V1_HTTP_ROUTE_AUDIT` | `[143] get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**; `[3] AUTO_TRANSFER` | unchanged |
| `idempotency.ts` `export const` count | **120** | **157** — **+36** net-new + `NIGHT_AUDIT_HALTED` relocated from `property-do.ts` |

Tree verified 2026-08-15. **No DDL** this phase — `pnpm generate:ddl && pnpm check:ddl` is confirm-only in final verify.

---

## Sequencing gate (read before starting)

Phases **A**, **B**, and **C** **must** be landed — local suite is trustworthy (`pnpm test:local`).

| After this plan | Do not start |
|---|---|
| Lock 1 — `CommandError` + **36** constants + compile-time rejection | Phase **F** refactors (requires D1) |
| Lock 2 — DO signature catch-all removal + `e.message` mappers | Phase **E+** user-facing error copy |
| Lock 3 — `CONFIG_CLASS_NOT_DOMAIN` + `configUndeclared()` | `registry.ts` catch-all typing |
| Lock 4 — **9** `not_member` → **404** sites | Clerk lookup wire constants in `CommandError` |
| Lock 5 — six exhaustive `(error: CommandError) => number` mappers | Purging `CLOSE_FAILED` / `REOPEN_FAILED` |
| All §Verification commands green | Edge rate limiting; `gatePermission` / auth semantics changes |

**TDD order:** Task 1 (contracts) → Tasks 2–6 (PropertyDO slices) → Task 7 (OrgDO) → Task 8 (OrgEntitlementDO) → Task 9 (dispatch mappers + behaviour tests red-first) → Task 10 (final cleanup + full gates).

**Do not** batch DO + dispatch in one commit.

---

## Open decisions (locked — do not re-litigate)

### D1 — Lock 1: Closed `CommandError` union + wire constants (spec §2 Lock 1)

**Locked:** Add `packages/contracts/src/command-error.ts` with explicit `COMMAND_ERROR_CODES` registry + `as const satisfies readonly CommandError[]` so drift fails compile. Export `CommandError`, `isCommandError`, `configUndeclared`, `UNDECLARED_CONFIG_PREFIX`. Re-export from `packages/contracts/src/index.ts`.

**Union members (normative):** all `idempotency.ts` wire const values + `FORBIDDEN` + `ENTITLEMENT_REQUIRED` + `ENTITLEMENT_UNAVAILABLE` + `LIMIT_EXCEEDED` + eight `money.ts` wire codes + `` `undeclared:${string}` `` template.

**Relocate** `NIGHT_AUDIT_HALTED` from `property-do.ts:1194` → `idempotency.ts` night-audit section. Delete PropertyDO export; import from `@hospai/contracts`.

**Add 36 new constants** to `idempotency.ts` (grouped — implementer may reorder within file but must not rename wire values):

| Group | Constants |
|---|---|
| Core / membership | `ORG_ID_UNSET`, `NOT_MEMBER`, `SCOPE_MISMATCH`, `ORG_UNREACHABLE`, `BULK_NOT_ADMITTED`, `UNKNOWN_COMMAND`, `INTERNAL_ERROR`, `TENANT_NOT_ACTIVE` |
| Night audit | `NIGHT_AUDIT_STEP_NOT_FAILED`, `NIGHT_AUDIT_NOT_DUE`, `NIGHT_AUDIT_WORKFLOW_EXISTS`, `NIGHT_AUDIT_HALTED` (relocated) |
| Validation | `INVALID_STATUS`, `INVALID_BUSINESS_DATE`, `INVALID_ASSIGNEE_REF`, `INVALID_DATE`, `GUEST_REF_REQUIRED`, `INVALID_STAY_RANGE`, `INVALID_WINDOW`, `INVALID_DATE_RANGE` |
| Promo / payments | `INVALID_PROMO_CODE`, `INVALID_PROMO_WINDOW`, `INVALID_PROMO_KIND_FIELD`, `PROMO_ID_EXISTS`, `INVALID_VOID_REASON`, `PSP_ADAPTER_FAILED`, `VALIDATION_ERROR`, `PAYMENT_INSERT_FAILED` |
| Org / crypto | `INVALID_ROLE`, `ALREADY_MEMBER`, `LAST_OWNER`, `PROPERTY_REF_NOT_FOUND`, `DECRYPT_UNRESOLVED`, `KEY_SHRED_FAILED` |
| Config | `CONFIG_CLASS_NOT_DOMAIN` |
| Infra throws | `REPORTS_R2_UNBOUND`, `INVOICE_COUNTER_RACE` |

**Deferred (do NOT add):** `CLOSE_FAILED`, `REOPEN_FAILED`, Clerk lookup codes, test-only throw strings (`simulated_internal_bug`, etc.) — map those to `INTERNAL_ERROR` in catch mappers.

**Compile-time test** — `packages/do-runtime/src/command-error.compile-time.ts` (mirror `idempotency.compile-time.ts` inclusion in package typecheck):

```ts
import type { CommandError } from '@hospai/contracts';

function _rejectBogus(): void {
  const bogus = 'totally_made_up' as string;
  // @ts-expect-error not assignable to CommandError
  const _bad: CommandError = bogus;
}
void _rejectBogus;
```

**Const count pin:** after Task 1, `rg -c '^export const' packages/contracts/src/idempotency.ts` **must equal 157**.

### D2 — Lock 2: Replace DO RPC `error: string` catch-alls (spec §2 Lock 2)

**Locked:** On PropertyDO (**78** signatures per spec; grep may show **79** — fix all), OrgDO (**19**), OrgEntitlementDO (**1**):

```diff
- | { ok: false; error: string }
+ | { ok: false; error: CommandError }
```

Per-command unions stay specific; trailing `| string` / catch-all **deleted**. Replace bare literals (`'org_id_unset'`, `'not_member'`, …) with imported constants.

**`e.message` passthrough (~70 PropertyDO catch blocks):** route through `mapPropertyCommandError(e)` extending the existing reservation precondition mapper at `property-do.ts:1134+` (`mapReservationPreconditionError`). Pattern:

```ts
} catch (e) {
  const mapped = mapPropertyCommandError(e);
  if (mapped) return mapped;
  return { ok: false, error: INTERNAL_ERROR };
}
```

`mapPropertyCommandError` must map every `throw new Error('snake_case')` in spec §2.1c plus existing `instanceof` branches. **Never** return `e.message` directly. Unmapped → `INTERNAL_ERROR` (**500** at dispatch, not **422**).

OrgDO: add `mapOrgCommandError(e)` with org-specific throw codes (`key_shred_failed`, etc.).

### D3 — Lock 3: `CONFIG_CLASS_NOT_DOMAIN` structured error (spec §2 Lock 3)

**Locked:** Replace English sentence at `tryPutDomainConfig` (`property-do.ts:5120`):

```diff
- return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
+ return { ok: false, error: CONFIG_CLASS_NOT_DOMAIN, gotClass: entry.class };
```

Return type includes `gotClass: string` on that branch only. HTTP body stays `{ error: 'config_class_not_domain' }` — do not echo `gotClass` unless handler already forwards full result (today it does not).

Undeclared keys: `configUndeclared(key)` — wire unchanged `` `undeclared:${key}` ``.

Dispatch `mapConfigErrorStatus` (`v1-dispatch.ts:438–445`):

```diff
- if (error.startsWith('undeclared:') || error.startsWith('Only DOMAIN config')) return 400;
+ if (error.startsWith(UNDECLARED_CONFIG_PREFIX) || error === CONFIG_CLASS_NOT_DOMAIN) return 400;
```

### D4 — Lock 4: `not_member` → **404** everywhere (spec §2 Lock 4)

**Locked decision comment** at top of `mapGuestCommandErrorStatus` (or shared helper):

> `not_member` means the actor has no effective role on the org/property scope. Matches `requirePermission` (**404** `not_found`) and the dispatch majority. Downstream DO `not_member` after edge gating is **404**, not **500**.

**Change these 9 sites** from `internal_error` / **500** → **404** `not_found`:

| Line (approx) | Handler |
|---|---|
| 946 | `handlePostRoomTypes` |
| 1022 | `handlePutRoomType` |
| 1076 | `handleDeleteRoomType` |
| 1130 | `handleDeleteRoom` |
| 6325 | `handlePostNightAuditRun` |
| 6408 | `handlePostNightAuditRetry` |
| 6454 | `handlePostNightAuditResolveHalt` |
| 6501 | `handlePostProvisionalExceptionResolve` |
| 6533 | `mapExceptionWriterError` |

Pattern:

```diff
- if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
+ if (result.error === NOT_MEMBER) return json({ error: 'not_found' }, 404);
```

Existing mappers already map `not_member` → **404** — convert literals to `NOT_MEMBER` constant only.

### D5 — Lock 5: Exhaustive status mappers (spec §2 Lock 5)

Retype all six functions in `v1-dispatch.ts`:

- `mapAddRoomTypeErrorStatus`
- `mapReservationCommandErrorStatus`
- `mapGuestCommandErrorStatus`
- `mapRosterCommandErrorStatus`
- `mapConfigErrorStatus`
- `mapPaymentCommandErrorStatus`

Signature: `(error: CommandError): number`. Use `switch` with **`default: { const _exhaustive: never = error; return _exhaustive; }`** on the final mapper in any chain.

**Internal-invariant class → 500** (must not fall through to **422**): `ORG_ID_UNSET`, `PROPERTY_ID_UNSET`, `BUSINESS_DATE_UNSET`, `TIMEZONE_UNSET`, `INTERNAL_ERROR`.

**Preserve all other status integers** byte-identical except Lock 3 + Lock 4 deltas.

### D6 — CI discipline (normative — all tasks)

**Locked:** `pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — **no `--` before `--shard`**. Workerd 503 → retry that shard once. Never `|| true`. Prefer `pnpm test:local`. Per-file: `pnpm --filter @hospai/pms-core exec vitest run <file>`. **No DDL** this phase — `generate:ddl` / `check:ddl` confirm-only.

### D7 — Reviewer workflow

**Locked:** Spec/plan writers do **not** commit. Implementers commit per task. Living plan checkboxes: tick **Task 10 only** at implementation time. No push.

---

## Global constraints

- **Heads table above** — only `idempotency.ts` const count moves **120 → 157** (Task 1).
- **Runtime HTTP status changes** limited to Lock 3 + Lock 4 — all other mappings byte-identical.
- **Slice commits** — keep `pnpm typecheck` green at each PropertyDO boundary.
- **TDD:** compile-time rejection (Task 1); behaviour specs red-first in Task 9 before dispatch green.

### Scope out (forbidden across all tasks)

- Phase **E/F/G/H**; **E1** discarded client messages
- `gatePermission` / auth semantics; degraded replay permission actor
- `registry.ts` platform helper catch-alls (**9** signatures — separate follow-up)
- Clerk lookup codes (`clerk_unreachable`, `no_such_user`, `email_ambiguous`)
- Purge `CLOSE_FAILED` / `REOPEN_FAILED`
- HTTP-only edge codes (`invalid_body`, `unauthenticated`, …) — **not** `CommandError`
- Transport / invoke wrapper codes (`property_unreachable`, `degraded`, …)
- Edge rate limiting; schema migrations; catalog/route changes; push

---

## File map

| File | Role | Task |
|---|---|---|
| `packages/contracts/src/command-error.ts` | **New** — `CommandError`, registry, `configUndeclared`, `isCommandError` | 1 |
| `packages/contracts/src/idempotency.ts` | **+36** constants; receive `NIGHT_AUDIT_HALTED` | 1 |
| `packages/contracts/src/index.ts` | Re-export `command-error.js` | 1 |
| `packages/contracts/src/idempotency.test.ts` | Optional const-count / new wire smoke | 1 |
| `packages/do-runtime/src/command-error.compile-time.ts` | **New** — bogus code rejected | 1 |
| `apps/pms-core/src/property-do.ts` | Lock 2 slices + Lock 3 + `mapPropertyCommandError`; remove local `NIGHT_AUDIT_HALTED` | 2–6, 10 |
| `apps/pms-core/test/property-do.spec.ts` | Lock 3 — `config_class_not_domain` assertion | 2 |
| `apps/pms-core/src/org-do.ts` | Lock 2 — **19** signatures + `mapOrgCommandError` | 7 |
| `apps/pms-core/src/org-entitlement-do.ts` | Lock 2 — **1** signature | 8 |
| `apps/pms-core/src/v1-dispatch.ts` | Locks 4–5 — mappers, constants, **9** `not_member` sites | 9 |
| `apps/pms-core/test/error-channel-d1.spec.ts` | **New** — Lock 4 HTTP behaviour + Lock 3 mapper path | 9 |
| `docs/superpowers/specs/2026-08-15-audit-phase-d-error-channel-design.md` | Tick §8 checklist | 10 |
| `docs/superpowers/plans/2026-08-15-audit-phase-d-error-channel.md` | Task 10 checkboxes (this file) | 10 |

**Not touched:** `COMMAND_CATALOG`, `V1_HTTP_ROUTE_AUDIT`, `AUDIT_WRITER_COMMAND_IDS`, `NIGHT_AUDIT_STEPS`, `PROPERTY_SCHEMA_HEAD`, `registry.ts`, `gatePermission`, auth.

---

## Spec §1.5 / §4 / §8 → task map

| Spec item | Task |
|---|---|
| Lock 1 — `CommandError` + **36** constants + relocation | 1 |
| §4.1 compile-time rejection | 1 |
| Lock 2 — PropertyDO **78** signatures + `e.message` mappers | 2–6 |
| Lock 3 — `CONFIG_CLASS_NOT_DOMAIN` + `configUndeclared()` | 2 (+ dispatch mapper in 9) |
| Lock 2 — OrgDO **19** + OrgEntitlementDO **1** | 7–8 |
| Lock 4 — **9** `not_member` → **404** | 9 |
| Lock 5 — six exhaustive mappers | 9 |
| §4.2 behaviour regression | 2, 9 |
| §4.3 / §5 full gates | 10 |
| §1.6 scope out | forbidden all |
| §8 checklist | 10 |

---

### Task 1: Contracts — `CommandError` + wire constants + compile-time test

**Spec:** Lock 1, §4.1, §5 item 1.

**Files:**
- Create: `packages/contracts/src/command-error.ts`
- Create: `packages/do-runtime/src/command-error.compile-time.ts`
- Modify: `packages/contracts/src/idempotency.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify (optional): `packages/contracts/src/idempotency.test.ts`

**Interfaces:**
- Produces: closed `CommandError` type; **36** new `export const` entries; `NIGHT_AUDIT_HALTED` in `idempotency.ts`
- Frozen head: `idempotency.ts` `export const` **120 → 157**

**Forbidden this commit:** PropertyDO / OrgDO / dispatch edits (will not typecheck until later tasks — contracts package alone must typecheck).

- [ ] **Step 1: Add `command-error.ts`**

Implement `COMMAND_ERROR_CODES` registry pattern, `MONEY_WIRE_CODES` from `money.ts`, permission/entitlement imports, `` `undeclared:${string}` `` member, helpers:

```typescript
export const UNDECLARED_CONFIG_PREFIX = 'undeclared:' as const;
export function configUndeclared(key: string): `undeclared:${string}` {
  return `${UNDECLARED_CONFIG_PREFIX}${key}`;
}
export function isCommandError(value: string): value is CommandError { /* … */ }
```

- [ ] **Step 2: Extend `idempotency.ts`**

Add all **36** constants from spec §2.1c table + `NIGHT_AUDIT_HALTED` in night-audit section. Do **not** add deferred purge/clerk codes.

- [ ] **Step 3: Re-export from `index.ts`**

```typescript
export * from './command-error.js';
```

- [ ] **Step 4: Add compile-time rejection test**

Create `packages/do-runtime/src/command-error.compile-time.ts` (verbatim spec §4.1). Ensure package `tsconfig` includes `*.compile-time.ts` files the same way as `idempotency.compile-time.ts` (picked up by `pnpm typecheck` today).

- [ ] **Step 5: Verify contracts + compile-time — must be green**

```bash
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
pnpm --filter @hospai/contracts typecheck
pnpm --filter @hospai/do-runtime typecheck
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 157
```

Expected: **PASS**; const count **157**.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/command-error.ts \
  packages/contracts/src/idempotency.ts \
  packages/contracts/src/index.ts \
  packages/contracts/src/idempotency.test.ts \
  packages/do-runtime/src/command-error.compile-time.ts
git commit -m "$(cat <<'EOF'
feat(contracts): add CommandError union and D1 wire constants

Close the DO error channel foundation: 36 new idempotency wire codes,
relocate NIGHT_AUDIT_HALTED, and compile-time rejection for bogus codes.
EOF
)"
```

---

### Task 2: PropertyDO — config slice (Lock 2 + Lock 3)

**Spec:** Lock 2 (config vertical), Lock 3, §4.2 config row.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryPutDomainConfig` (~5102), introduce `mapPropertyCommandError` adjacent to `mapReservationPreconditionError` (~1134), any config-only helpers in this slice
- Modify: `apps/pms-core/test/property-do.spec.ts` — domain-class rejection (~74–82)

**Interfaces:**
- Produces: `CONFIG_CLASS_NOT_DOMAIN` + `gotClass`; `configUndeclared(key)` returns; `mapPropertyCommandError` scaffold with throw-code mappings from spec §2.1c
- Frozen heads unchanged

**Forbidden this commit:** inventory/reservation/payment `try*` signatures; dispatch; OrgDO.

- [ ] **Step 1: Write failing config spec (red)**

Extend `property-do.spec.ts` DOMAIN rejection test:

```typescript
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toBe('config_class_not_domain');
      expect('gotClass' in rejected && rejected.gotClass).toBeTruthy();
    }
```

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/property-do.spec.ts -t "stores DOMAIN config"
```

Expected: **FAIL** — still English sentence or missing `gotClass`.

- [ ] **Step 2: Apply Lock 3 + config slice Lock 2**

1. Import `CommandError`, new constants, `configUndeclared`, `CONFIG_CLASS_NOT_DOMAIN`, `INTERNAL_ERROR`, etc. from `@hospai/contracts`.
2. Add `mapPropertyCommandError(e: unknown)` — delegate to existing `mapReservationPreconditionError` + map `Error.message` snake_case codes from spec §2.1c; test-only throws → `INTERNAL_ERROR`.
3. Retype `tryPutDomainConfig` — remove `| { ok: false; error: string }`; use `CommandError` + structured `CONFIG_CLASS_NOT_DOMAIN` branch; `configUndeclared(key)` for undeclared keys; `'org_id_unset'` → `ORG_ID_UNSET`.
4. Fix any other **config-only** `try*` / helpers touched by typecheck in this slice only.

- [ ] **Step 3: Verify — must be green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/property-do.spec.ts -t "stores DOMAIN config"
```

Expected: **PASS**.

- [ ] **Step 4: Commit**

```bash
git add apps/pms-core/src/property-do.ts apps/pms-core/test/property-do.spec.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type PropertyDO config errors as CommandError

Replace English config sentence with CONFIG_CLASS_NOT_DOMAIN, introduce
mapPropertyCommandError, and close config RPC catch-alls.
EOF
)"
```

---

### Task 3: PropertyDO — inventory / rooms slice

**Spec:** Lock 2 (inventory vertical).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryAddRoomType` (~5550) through `tryAssignHousekeeping` (~7251)

**Method range (grep `async try` — read file first):**

`tryAddRoomType`, `tryUpdateRoomType`, `tryDeleteRoomType`, `tryDeleteRoom`, `tryCreateRoom`, `tryUpdateRoom`, `trySetOooRange`, `tryUpdateRoomStatus`, `tryBulkUpdateRoomStatus`, `tryAssignRoom`, `tryAssignHousekeeping`

**Forbidden this commit:** reservation/folio/payment/night-audit methods; dispatch.

- [ ] **Step 1: Replace catch-alls + literals in inventory slice**

For each method in range: delete trailing `| { ok: false; error: string }`; use per-command unions with `CommandError` members; replace string literals; route catches through `mapPropertyCommandError`.

- [ ] **Step 2: Verify — must be green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/property-setup-reads.spec.ts test/rooms-ooo.spec.ts test/virtual-reads.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type inventory and room RPC errors as CommandError

Close error:string catch-alls on room-type and room command paths; route
catch blocks through mapPropertyCommandError with INTERNAL_ERROR fallback.
EOF
)"
```

---

### Task 4: PropertyDO — reservations / folio slice

**Spec:** Lock 2 (reservations vertical).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryCreateReservation` (~7953) through `tryTransferCharge` (~15506) **plus** pricing/catalog `try*` in between: restrictions, promos, rate plans, charge codes, routing, tax, FX, rate days

**Forbidden this commit:** night-audit/provisional; payments; dispatch.

- [ ] **Step 1: Replace catch-alls + literals in reservations/folio slice**

Extend `mapPropertyCommandError` for reservation/folio throw codes (`invalid_stay_range`, `invalid_promo_code`, `invoice_counter_race`, …). Grep `e instanceof Error ? e.message` within line range ~7953–15506.

- [ ] **Step 2: Verify — must be green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/reservations.spec.ts test/reservations-lifecycle.spec.ts test/folio-windows.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type reservation and folio RPC errors as CommandError

Close error:string catch-alls on booking and folio command paths; extend
mapPropertyCommandError for domain throw codes in this vertical.
EOF
)"
```

---

### Task 5: PropertyDO — night-audit / provisional slice

**Spec:** Lock 2 (night-audit vertical).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryResolveProvisionalException` (~4293) through `tryStartNightAudit` (~5024)

**Methods:** `tryResolveProvisionalException`, `tryRetryProvisionalException`, `tryAssignProvisionalException`, `tryAddExceptionNote`, `tryRetryAuditStep`, `tryResolveHalt`, `tryStartNightAudit`

Import `NIGHT_AUDIT_HALTED` from `@hospai/contracts` (remove local const usage but keep export until Task 10 if other PropertyDO symbols still re-export — prefer import-only in this task).

**Forbidden this commit:** payments slice; dispatch.

- [ ] **Step 1: Replace catch-alls + literals in night-audit slice**

Use `NIGHT_AUDIT_STEP_NOT_FAILED`, `NIGHT_AUDIT_NOT_DUE`, `NIGHT_AUDIT_HALTED`, `NOT_MEMBER`, etc. Remove `| string` from `tryStartNightAudit` union (~5029 today includes `string`).

- [ ] **Step 2: Verify — must be green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/night-audit.spec.ts test/degraded-mode.spec.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type night-audit and provisional RPC errors

Close error:string catch-alls on audit and provisional exception commands;
use contracts wire constants including relocated NIGHT_AUDIT_HALTED.
EOF
)"
```

---

### Task 6: PropertyDO — payments / city-ledger slice

**Spec:** Lock 2 (payments vertical).

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — `tryAuthorizePayment` (~16236) through `tryGenerateCityLedgerStatement` (~19903) and any remaining `try*` with `error: string` catch-alls

**Forbidden this commit:** dispatch; OrgDO. **Must leave zero** `| { ok: false; error: string }` on PropertyDO when done — grep verify.

- [ ] **Step 1: Replace catch-alls + literals in payments slice**

Map `psp_adapter_failed`, `payment_insert_failed`, `validation_error`, `reports_r2_unbound`, city-ledger throws, shift/cash/invoice methods.

- [ ] **Step 2: Verify PropertyDO surface clean — must be green**

```bash
pnpm typecheck
! rg '\| \{ ok: false; error: string \}' apps/pms-core/src/property-do.ts
pnpm --filter @hospai/pms-core exec vitest run test/reservations-check-out.spec.ts test/auth-hold-lapse.spec.ts
```

Expected: **PASS**; grep returns no matches.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/property-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type payment and city-ledger RPC errors as CommandError

Complete PropertyDO D1 slice: close remaining error:string catch-alls on
payment, invoice, shift, and city-ledger command paths.
EOF
)"
```

---

### Task 7: OrgDO — membership / guest / roster RPC signatures

**Spec:** Lock 2 (OrgDO **19** signatures).

**Files:**
- Modify: `apps/pms-core/src/org-do.ts`

**Forbidden this commit:** dispatch; PropertyDO.

- [ ] **Step 1: Add `mapOrgCommandError` + retype all OrgDO `try*` returns**

Replace literals: `not_member` → `NOT_MEMBER`, `scope_mismatch` → `SCOPE_MISMATCH`, `invalid_role`, `already_member`, `last_owner`, `property_ref_not_found`, `decrypt_unresolved`, `key_shred_failed`, `bulk_not_admitted`, etc. Route catches through mapper; unmapped → `INTERNAL_ERROR`.

- [ ] **Step 2: Verify — must be green**

```bash
pnpm typecheck
! rg '\| \{ ok: false; error: string \}' apps/pms-core/src/org-do.ts
pnpm --filter @hospai/pms-core exec vitest run test/membership-org-do.spec.ts
```

Expected: **PASS**; zero catch-alls.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/org-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type OrgDO RPC errors as CommandError

Close 19 error:string catch-alls on guest, roster, and membership commands;
replace bare literals with contracts constants and typed catch mappers.
EOF
)"
```

---

### Task 8: OrgEntitlementDO — meter RPC signature

**Spec:** Lock 2 (OrgEntitlementDO **1** signature).

**Files:**
- Modify: `apps/pms-core/src/org-entitlement-do.ts`

**Forbidden this commit:** dispatch.

- [ ] **Step 1: Retype meter RPC return**

Replace `| { ok: false; error: string }` with `CommandError`; literals → constants.

- [ ] **Step 2: Verify — must be green**

```bash
pnpm typecheck
! rg '\| \{ ok: false; error: string \}' apps/pms-core/src/org-entitlement-do.ts
```

Expected: **PASS**.

- [ ] **Step 3: Commit**

```bash
git add apps/pms-core/src/org-entitlement-do.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): type OrgEntitlementDO meter RPC errors as CommandError

Close the sole error:string catch-all on entitlement meter commands.
EOF
)"
```

---

### Task 9: v1-dispatch — behaviour tests (red) + exhaustive mappers + Lock 4

**Spec:** Locks 4–5, §4.2, §4.3 partial.

**Files:**
- Create: `apps/pms-core/test/error-channel-d1.spec.ts`
- Modify: `apps/pms-core/src/v1-dispatch.ts` — six mappers (~292–445, ~6058–6083), **9** `not_member` handler sites, constant imports, remove `'scope_mismatch'` / `'org_id_unset'` literals in mapper paths

**Forbidden this commit:** `registry.ts`; auth changes.

- [ ] **Step 1: Write failing Lock 4 HTTP specs (red)**

Create `error-channel-d1.spec.ts` with mocked DO stubs or membership removal patterns (reuse `provisionHotel`, `resolveOrgStub`, `removePropertyMemberForTest` from existing tests). Minimum cases per spec §4.2:

```typescript
describe('D1 error channel behaviour', () => {
  it('POST room-types with not_member → 404 not_found (was 500)', async () => { /* mock stub.tryAddRoomType → { ok:false, error: NOT_MEMBER } */ });
  it('PUT room-type with not_member → 404', async () => { /* … */ });
  it('DELETE room-type with not_member → 404', async () => { /* … */ });
  it('DELETE room with not_member → 404', async () => { /* … */ });
  it('POST night-audit run with not_member → 404', async () => { /* … */ });
  it('POST night-audit retry with not_member → 404', async () => { /* … */ });
  it('POST night-audit resolve-halt with not_member → 404', async () => { /* … */ });
  it('POST provisional resolve with not_member → 404', async () => { /* … */ });
  it('provisional retry via mapExceptionWriterError with not_member → 404', async () => { /* … */ });
  it('config non-DOMAIN class → 400 config_class_not_domain via HTTP', async () => { /* PUT config or invoke path */ });
  it('undeclared config key → 400 undeclared:<key>', async () => { /* … */ });
  it('NO_AVAILABILITY status unchanged (409)', async () => { /* regression */ });
});
```

Run red:

```bash
pnpm --filter @hospai/pms-core exec vitest run test/error-channel-d1.spec.ts
```

Expected: **FAIL** on `not_member` cases (still **500**) and possibly config sentence.

- [ ] **Step 2: Apply Lock 4 — nine `not_member` sites**

Fix handlers at ~946, ~1022, ~1076, ~1130, ~6325, ~6408, ~6454, ~6501, `mapExceptionWriterError` ~6533. Add decision comment at `mapGuestCommandErrorStatus`.

- [ ] **Step 3: Apply Lock 5 — exhaustive mappers**

1. Import `CommandError`, `NOT_MEMBER`, `SCOPE_MISMATCH`, `ORG_ID_UNSET`, `CONFIG_CLASS_NOT_DOMAIN`, `UNDECLARED_CONFIG_PREFIX`, etc.
2. Retype all six mappers to `(error: CommandError): number`.
3. Convert existing `if` chains to `switch`; ensure internal-invariant codes → **500**; R2 unbound codes → **503** unchanged.
4. Final default: `const _exhaustive: never = error`.
5. Fix `mapConfigErrorStatus` Lock 3 (`CONFIG_CLASS_NOT_DOMAIN`, `UNDECLARED_CONFIG_PREFIX`).
6. Replace mapper literals `'not_member'`, `'scope_mismatch'`, `'org_id_unset'` with constants.

- [ ] **Step 4: Re-run behaviour specs — must be green**

```bash
pnpm typecheck
pnpm --filter @hospai/pms-core exec vitest run test/error-channel-d1.spec.ts
```

Expected: **PASS**.

- [ ] **Step 5: Commit**

```bash
git add apps/pms-core/src/v1-dispatch.ts apps/pms-core/test/error-channel-d1.spec.ts
git commit -m "$(cat <<'EOF'
refactor(pms-core): exhaustive CommandError status mappers and not_member 404

Type six dispatch error mappers with never-default switches; unify nine
not_member handlers to 404; fix config mapper for CONFIG_CLASS_NOT_DOMAIN.
EOF
)"
```

---

### Task 10: Final cleanup + full verification

**Spec:** §1.3 step 6, §4.3, §5, §8 checklist.

**Files:**
- Modify: `apps/pms-core/src/property-do.ts` — delete duplicate `export const NIGHT_AUDIT_HALTED` (~1194); ensure imports from `@hospai/contracts` everywhere
- Modify: any files still importing `NIGHT_AUDIT_HALTED` from `property-do.js` → `@hospai/contracts`
- Modify: `docs/superpowers/specs/2026-08-15-audit-phase-d-error-channel-design.md` — tick §8
- Modify: `docs/superpowers/plans/2026-08-15-audit-phase-d-error-channel.md` — Task 10 checkboxes only

**Forbidden this commit:** new features; scope-out items.

- [ ] **Step 1: Remove duplicate `NIGHT_AUDIT_HALTED` export from PropertyDO**

Grep consumers:

```bash
rg "NIGHT_AUDIT_HALTED" apps/pms-core --glob '!property-do.ts'
```

Update imports to `@hospai/contracts`. Delete `export const NIGHT_AUDIT_HALTED` from `property-do.ts`.

- [ ] **Step 2: Repo-wide literal grep — must be clean**

```bash
! rg "'org_id_unset'|'not_member'|'scope_mismatch'" apps/pms-core/src/property-do.ts apps/pms-core/src/org-do.ts apps/pms-core/src/v1-dispatch.ts
! rg '\| \{ ok: false; error: string \}' apps/pms-core/src/property-do.ts apps/pms-core/src/org-do.ts apps/pms-core/src/org-entitlement-do.ts
! rg "Only DOMAIN config" apps/pms-core
```

Expected: no matches in DO + dispatch mapper paths (tests may still assert wire strings).

- [ ] **Step 3: typecheck / build / lint**

```bash
pnpm typecheck
pnpm build
pnpm lint
```

Expected: all **PASS**.

- [ ] **Step 4: All 14 `check:*` gates**

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

Expected: all **PASS** (`check:ddl` no-op confirm — no migration).

- [ ] **Step 5: Full local test loop — long pole**

```bash
pnpm test:local
```

Expected: non-pms-core turbo tests + all **8** pms-core shards green. Workerd 503 → retry shard once.

- [ ] **Step 6: Pin frozen heads**

```bash
pnpm --filter @hospai/contracts exec vitest run src/register.test.ts -t "night-audit HTTP routes|PLATFORM_GAPS"
pnpm --filter @hospai/do-runtime exec vitest run src/migrate.test.ts -t "schema head constants"
test "$(rg -c '^export const' packages/contracts/src/idempotency.ts)" -eq 157
```

Expect: catalog **89**; writers **63**; `[143]=get_city_ledger_statement`; `PROPERTY_SCHEMA_HEAD === 34`; `NIGHT_AUDIT_STEPS` length **8**, `[3] AUTO_TRANSFER`; idempotency consts **157**.

- [ ] **Step 7: Re-run D1 behaviour + compile-time tests**

```bash
pnpm --filter @hospai/pms-core exec vitest run test/error-channel-d1.spec.ts test/property-do.spec.ts
pnpm --filter @hospai/do-runtime typecheck
pnpm --filter @hospai/contracts exec vitest run src/idempotency.test.ts
```

Expected: **PASS**.

- [ ] **Step 8: Tick spec §5 implementer checklist + spec §8 reviewer checklist**

Tick every item in `docs/superpowers/specs/2026-08-15-audit-phase-d-error-channel-design.md` §5 and §8.

- [ ] **Step 9: Tick Task 10 checkboxes in this plan only**

Do **not** retroactively tick Tasks 1–9 unless already done during implementation.

- [ ] **Step 10: Commit**

```bash
git add apps/pms-core/src/property-do.ts \
  apps/pms-core/src/v1-dispatch.ts \
  docs/superpowers/specs/2026-08-15-audit-phase-d-error-channel-design.md \
  docs/superpowers/plans/2026-08-15-audit-phase-d-error-channel.md
git commit -m "$(cat <<'EOF'
chore(pms-core): finalize D1 error channel cleanup and verification

Remove duplicate NIGHT_AUDIT_HALTED export from PropertyDO; confirm zero
DO error:string catch-alls and full gate suite green for audit Phase D.
EOF
)"
```

**Stop.** Audit **D1** closed. Phase **F** may proceed. `registry.ts` typing remains optional follow-up.

---

## Verification (plan-level summary)

| # | Command / assertion | Expectation | Task |
|---|---|---|---|
| 1 | `rg -c '^export const' packages/contracts/src/idempotency.ts` | **157** | 1, 10 |
| 2 | `pnpm --filter @hospai/do-runtime typecheck` | compile-time rejection | 1, 10 |
| 3 | `pnpm --filter @hospai/pms-core exec vitest run test/property-do.spec.ts -t "stores DOMAIN config"` | `config_class_not_domain` | 2, 10 |
| 4 | `! rg 'error: string' apps/pms-core/src/property-do.ts` (catch-all pattern) | zero on PropertyDO | 6, 10 |
| 5 | `! rg 'error: string' apps/pms-core/src/org-do.ts` | zero on OrgDO | 7, 10 |
| 6 | `pnpm --filter @hospai/pms-core exec vitest run test/error-channel-d1.spec.ts` | **404** `not_member`; config **400** | 9, 10 |
| 7 | `pnpm test:local` | **Long pole** — 8 shards green | 10 |
| 8 | All 14 `check:*` gates | Green | 10 |
| 9 | `pnpm typecheck` / `pnpm build` / `pnpm lint` | Green | 10 |
| 10 | Frozen heads pin | catalog **89**, writers **63**, routes **144**, schema **34**, steps **8**, consts **157** | 10 |

---

## CI discipline (verbatim — implementers)

`pnpm --filter @hospai/pms-core exec vitest run --shard=N/8` — no `--` before `--shard`. Workerd 503 → retry once. Never `|| true`. Prefer `pnpm test:local`. Per-file: `pnpm --filter @hospai/pms-core exec vitest run <file>`. After migration changes: `pnpm generate:ddl && pnpm check:ddl`.

---

## Spec §8 reviewer checklist (Task 10 ticks spec file when CI is green)

| §8 item | Satisfied by |
|---|---|
| Lock 1: `command-error.ts` + **36** constants + `NIGHT_AUDIT_HALTED` relocation | 1 |
| Lock 2: PropertyDO **78** + OrgDO **19** + OrgEntitlementDO **1** + `e.message` mappers | 2–8 |
| Lock 3: `CONFIG_CLASS_NOT_DOMAIN` + `configUndeclared()` + mapper fix | 2, 9 |
| Lock 4: **9** `not_member` sites → **404** + decision comment | 9 |
| Lock 5: Six exhaustive mappers | 9 |
| Compile-time test + behaviour specs | 1, 2, 9 |
| Full gate suite green | 10 |

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| §1.5 scope in | 1–10 |
| §1.6 scope out | forbidden all |
| §2 Locks 1–5 | 1–9 |
| §3 file map | 1–10 |
| §4 test plan | 1–10 |
| §5 verification checklist | 10 |
| §8 checklist | 10 |
| Frozen heads §1.4 / §9 | const count Task 1 only |

**Gaps:** None — spec scope fully mapped.

**Tree conflicts:** None (spec §9). One head moves: idempotency consts **120 → 157**.

---

## Approximate line numbers — read actual code first

Spec citations are tree-verified 2026-08-15 but **will drift**. Implementers **must grep / read** before editing:

| Area | Spec cites | Plan note |
|---|---|---|
| `mapReservationPreconditionError` | ~1134+ | Extend into `mapPropertyCommandError` |
| `NIGHT_AUDIT_HALTED` export | ~1194 | Remove in Task 10; import from contracts Task 5+ |
| Night-audit / provisional `try*` | ~4293–5024 | Task 5 — file order before config method |
| `tryPutDomainConfig` | ~5102–5120 | Task 2 — Lock 3 |
| Inventory `try*` range | ~5550–7251 | Task 3 |
| Reservations / folio `try*` | ~7953–15506 | Task 4 |
| Payments / city ledger `try*` | ~16236–19903 | Task 6 |
| Six dispatch mappers | ~292–445, ~6058–6083 | Task 9 |
| **9** `not_member` → **500** sites | ~946–6533 | Task 9 — grep `not_member.*internal_error` |
| OrgDO `try*` | ~1328+ | Task 7 |
| OrgEntitlementDO meter | ~34 | Task 8 |

---

## Plan writer interpretations (flagged for reviewer)

1. **`idempotency.ts` const count:** spec pins **120 → 157**; raw `rg '^export const'` on current tree may differ (wire consts end ~line 152 before helper functions). Implementers follow spec pin (**157** after Task 1) — if baseline ≠ 120, note delta in commit message but do not change target **157**.
2. **PropertyDO catch-all count:** grep shows **79** `error: string` signatures vs spec **78** — fix **all** matches; do not leave one untyped.
3. **`mapPropertyCommandError` naming:** spec uses this name; existing helper at ~1134 is `mapReservationPreconditionError` — extend/rename per slice without duplicating logic.
4. **Mapper structure:** spec allows chained mappers (`mapPaymentCommandErrorStatus` → `mapReservationCommandErrorStatus`) **if** final chain ends with `never` default — implementer may flatten into one switch per mapper if clearer.
5. **Consolidated behaviour test file:** `error-channel-d1.spec.ts` is new (not in spec file map verbatim) to keep Lock 4 cases in one red-first suite; may split across existing specs if implementer prefers, but all §4.2 rows must be covered.
6. **`TENANT_NOT_ACTIVE`:** constant added per spec §2.1c (#36) though primary source is `registry.ts` — constant only in D1; registry typing deferred.
7. **Task 10 cleanup commit:** may be empty of logic beyond `NIGHT_AUDIT_HALTED` export removal if Task 5 already switched imports — still run full gates and tick checklists in this task.
8. **`DOMAIN_ERROR` addition (reviewer-locked, supersedes the 157 pin):** the spec's §2.1c inventory missed the `domain_error` fallback wire value (persisted as `provisional_exception.reason` in `property-do.ts` retry-failure and `pending-commands-consumer.ts:127`). Rather than leave an unchecked `as CommandError` cast, `DOMAIN_ERROR = 'domain_error'` was added during Task 5 review. **Final `idempotency.ts` `export const` count is 158, not 157** (36 spec constants + `NIGHT_AUDIT_HALTED` relocation + `DOMAIN_ERROR`). Wherever this plan or the spec says **157**, read **158**. The compile-time/test pins were updated accordingly.
