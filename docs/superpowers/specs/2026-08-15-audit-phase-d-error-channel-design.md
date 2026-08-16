# Audit Phase D — close the error channel (D1)

**Tree verified 2026-08-15:** `COMMAND_CATALOG` length **89**, `AUDIT_WRITER_COMMAND_IDS.size === 63`, `V1_HTTP_ROUTE_AUDIT` length **144** (`[143].id === 'get_city_ledger_statement'`), `PROPERTY_SCHEMA_HEAD === 34`, `NIGHT_AUDIT_STEPS` length **8**, `[3] === 'AUTO_TRANSFER'`, `idempotency.ts` `export const` count **120**. Phases **A** (test signal), **B** (business logic), and **C** (security) are landed on `main`.

**Date:** 2026-08-15  
**Status:** Draft (spec writer)  
**Sources:** [Full codebase audit — remediation plan](../../audit/2026-08-15-full-codebase-audit.md) Phase **D** item **D1** (`:359–402`); [Ground rules](../../audit/2026-08-15-full-codebase-audit.md) (`:20–33`); [Do not fix](../../audit/2026-08-15-full-codebase-audit.md#do-not-fix--deliberate-decisions) (`:751–766`); `packages/contracts/src/idempotency.ts`; `apps/pms-core/src/v1-dispatch.ts` (`map*ErrorStatus`, `:419–445`, `:6058–6083`); `apps/pms-core/src/property-do.ts` (`tryPutDomainConfig`, `:5118–5120`; catch-all signatures); `packages/do-runtime/src/idempotency.compile-time.ts`.

**Closes:** Audit **D1** (untyped error channel — prerequisite for Phase **F**). **Requires:** Phases **A/B/C** green. **Does not** advance Phase **E+**, **F** refactors, **G/H**, edge rate limiting, or `gatePermission` / auth semantics changes.

---

## Executive summary

**D1** is the highest-leverage change in the audit remediation plan. Today ~**120** wire-code constants live in `packages/contracts`, but **79** `try*` return signatures on `PropertyDO` (plus catch-alls on `OrgDO` / `OrgEntitlementDO`) end with `| { ok: false; error: string }`, collapsing every per-command union to `string`. Constants and literals are mixed in dispatch mappers; `not_member` maps to both **404** and **500**; an English sentence is used as a wire code; and six status mappers fall through to **422** for unknown internal failures.

This spec locks a five-step fix **in audit order**: (1) closed `CommandError` union + **36** new wire constants (+ `NIGHT_AUDIT_HALTED` relocated from `property-do.ts`); (2) replace all `error: string` catch-alls on DO RPC signatures; (3) replace the English-sentence config code with `CONFIG_CLASS_NOT_DOMAIN` + structured `gotClass`; (4) unify **`not_member` → 404** everywhere (9 call sites currently → 500); (5) exhaustively type the six mappers with `(error: CommandError) => number` and a `never` default. **No catalog/route/schema/night-audit head moves.** Expected `idempotency.ts` `export const` count after land: **120 → 157**.

---

## 1. Context & motivation

### 1.1 Problem statement (audit symptoms a–d)

| Symptom | Evidence | Consequence |
|---|---|---|
| **(a) Constants + literals mixed** | `v1-dispatch.ts:422–424` — `FORBIDDEN \|\| 'scope_mismatch'`; `'org_id_unset'` (**72** literal returns in `property-do.ts`, no constant) | No exhaustiveness; refactors miss sites |
| **(b) Same code → two statuses** | `'not_member'` → **404** in **58** mapper/handler sites; → **500** `internal_error` in **9** sites (room-type/room CRUD + night-audit + provisional-exception writers) | Clients see inconsistent semantics; no recorded principle |
| **(c) English sentence as wire code** | `property-do.ts:5120` — `` `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` ``; matched `v1-dispatch.ts:439` via `startsWith('Only DOMAIN config')` | Rewording flips **400→422**; leaks internal class names |
| **(d) Mappers take `string`** | Six functions `mapAddRoomTypeErrorStatus`, `mapReservationCommandErrorStatus`, `mapGuestCommandErrorStatus`, `mapRosterCommandErrorStatus`, `mapConfigErrorStatus`, `mapPaymentCommandErrorStatus` | Unmapped internal codes (e.g. `org_id_unset` class → **500**) silently become **422** |

### 1.2 Catch-all signature surface (verified)

| File | `\| { ok: false; error: string }` count | Notes |
|---|---|---|
| `apps/pms-core/src/property-do.ts` | **78** | All `try*` + a few internal helpers (`tryPutDomainConfig`, purge hooks, etc.) |
| `apps/pms-core/src/org-do.ts` | **19** | Guest / roster / membership RPC |
| `apps/pms-core/src/org-entitlement-do.ts` | **1** | Meter RPC |
| `apps/pms-core/src/registry.ts` | **9** | Platform registry — **out of scope** (not DO command channel; separate follow-up) |

Additionally **~70** `try*` catch blocks in `property-do.ts` return `{ ok: false, error: e instanceof Error ? e.message : String(e) }`, re-introducing untyped strings from `throw new Error('…')` paths. D1 replaces these with typed domain mappers (extend the existing `mapReservationCommandError`-style helper at `:1134+`).

### 1.3 Dependency note

**D1 must land before Phase F.** Phase F's large refactors assume compiler-enforced error codes and exhaustive status maps. Phases **A/B/C** are done — local suite is trustworthy (`pnpm test:local`).

**Safe implementation order** (manage compile-error surface):

1. **Contracts** — new constants, `CommandError` type, re-exports, compile-time rejection test.
2. **PropertyDO** — one vertical slice at a time (config → inventory/rooms → reservations/folio → night-audit/provisional → payments). Replace catch-alls + `e.message` passthrough per slice; keep `pnpm typecheck` green between slices.
3. **OrgDO** — membership / guest / roster RPC signatures.
4. **OrgEntitlementDO** — single signature.
5. **v1-dispatch.ts** — exhaustive mappers + `not_member` unification + import constant replacements.
6. **Final** — remove `NIGHT_AUDIT_HALTED` duplicate export from `property-do.ts`; full gate run.

Do **not** batch DO + dispatch in one commit — the compile surface is the audit checklist.

### 1.4 Heads (frozen — this chunk moves none except error const count)

| Head | Current | This chunk |
|---|---|---|
| `COMMAND_CATALOG` | length **89** | **89** — unchanged |
| `AUDIT_WRITER_COMMAND_IDS.size` | **63** | **63** — unchanged |
| `V1_HTTP_ROUTE_AUDIT` | length **144**, tail `get_city_ledger_statement` | unchanged |
| `PROPERTY_SCHEMA_HEAD` | **34** | **34** — no migration |
| `NIGHT_AUDIT_STEPS` | length **8**, `[3] === 'AUTO_TRANSFER'` | **8** — unchanged |
| `idempotency.ts` `export const` count | **120** | **157** — **+36** net-new wire constants + `NIGHT_AUDIT_HALTED` **relocated** from `property-do.ts` (see §2.1b). Purge `CLOSE_FAILED`/`REOPEN_FAILED` **deferred** (§2.1c). |

### 1.5 Scope in

1. Closed **`CommandError`** union in `packages/contracts` (Lock 1).
2. Replace **all** DO RPC `| { ok: false; error: string }` catch-alls on the three DOs (Lock 2).
3. **`CONFIG_CLASS_NOT_DOMAIN`** structured error (Lock 3).
4. **`not_member` → 404** unification (Lock 4).
5. Six exhaustive status mappers (Lock 5).
6. Compile-time rejection test mirroring `idempotency.compile-time.ts` (§6).
7. Replace **`e.message` passthrough** in `property-do.ts` / `org-do.ts` catch blocks with typed mappers (Lock 2 extension).

### 1.6 Scope out (normative)

- **Runtime behaviour / HTTP statuses** — change **only** the two audit-mandated deltas: **`not_member` → 404** (9 sites → 500 today) and **`CONFIG_CLASS_NOT_DOMAIN`** wire shape (replacing English sentence). All other status mappings must remain **byte-identical** for the same code.
- Phase **E/F/G/H** items (including **E1** discarded client messages).
- **`gatePermission` / auth** semantics — do not change permission checks or fail-closed replay bypass ([degraded-mode spec](./2026-08-04-degraded-mode-server-design.md) `:325–335`).
- **New error codes** beyond literals required today — no speculative codes.
- **`registry.ts` platform helpers** — separate typing pass; not blocking D1.
- **HTTP-only validation codes** (`invalid_body`, `invalid_query`, `unauthenticated`, …) — remain plain strings on the edge; **not** members of `CommandError`.
- **Transport / invoke wrapper codes** (`property_unreachable`, `queue_unavailable`, `catalog_misconfigured`, `degraded` envelopes) — remain outside `CommandError`.
- Edge rate limiting, schema migrations, catalog/route changes.
- Push.

---

## 2. Locked decisions (verbatim — do not deviate)

### Lock 1 — Closed `CommandError` union (`packages/contracts`)

#### 1a — New module + type

Add `packages/contracts/src/command-error.ts`:

```ts
/** Wire code returned in `{ ok: false, error }` from DO RPC (`try*`) methods. */
export type CommandError =
  | typeof import('./idempotency.js')[keyof typeof import('./idempotency.js')] // const values via mapped type — implementer picks clean pattern
  | typeof FORBIDDEN
  | typeof ENTITLEMENT_REQUIRED
  | typeof ENTITLEMENT_UNAVAILABLE
  | typeof LIMIT_EXCEEDED
  | (typeof MONEY_WIRE_CODES)[number] // re-use money.ts exports
  | `undeclared:${string}`; // wire-compatible; see Lock 3b
```

**Implementer note:** Prefer an explicit union of `typeof FOO` members generated from a single `COMMAND_ERROR_CODES` const array + `as const satisfies readonly CommandError[]` so adding a constant without updating the array is a compile error. Export `CommandError` and `isCommandError(value: string): value is CommandError` for dispatch guards.

Re-export from `packages/contracts/src/index.ts`.

#### 1b — Relocate `NIGHT_AUDIT_HALTED`

Move from `apps/pms-core/src/property-do.ts:1194`:

```ts
export const NIGHT_AUDIT_HALTED = 'night_audit_halted' as const;
```

→ `packages/contracts/src/idempotency.ts` (night-audit wire codes section). Update imports in `property-do.ts`, `v1-dispatch.ts`, tests. **Delete** the `property-do.ts` export — import from `@hospai/contracts`.

#### 1c — Complete inventory of **NEW** constants (36 + relocation)

Add to `packages/contracts/src/idempotency.ts` (grouped by domain). **Every** literal below currently appears in DO RPC paths or `throw new Error('…')` catch passthroughs without a constant.

| # | Constant | Wire value | Primary source |
|---|---|---|---|
| 1 | `ORG_ID_UNSET` | `org_id_unset` | `property-do.ts` (**72** returns), `org-do.ts` |
| 2 | `NOT_MEMBER` | `not_member` | `property-do.ts:1772`, `org-do.ts`, mappers |
| 3 | `SCOPE_MISMATCH` | `scope_mismatch` | `org-do.ts:735`, mappers |
| 4 | `ORG_UNREACHABLE` | `org_unreachable` | `property-do.ts:1787`, invoke/degraded |
| 5 | `BULK_NOT_ADMITTED` | `bulk_not_admitted` | `property-do.ts:2381`, `org-do.ts:543` |
| 6 | `UNKNOWN_COMMAND` | `unknown_command` | `property-do.ts:4474` |
| 7 | `INTERNAL_ERROR` | `internal_error` | `property-do.ts:4490`, dispatch fallbacks |
| 8 | `NIGHT_AUDIT_STEP_NOT_FAILED` | `night_audit_step_not_failed` | `property-do.ts:4750` |
| 9 | `NIGHT_AUDIT_NOT_DUE` | `night_audit_not_due` | `property-do.ts:5050` |
| 10 | `NIGHT_AUDIT_WORKFLOW_EXISTS` | `night_audit_workflow_exists` | `night-audit-http.ts:30` |
| 11 | `INVALID_STATUS` | `invalid_status` | `property-do.ts:6954`, `:8022` throw |
| 12 | `INVALID_BUSINESS_DATE` | `invalid_business_date` | `property-do.ts:7286` |
| 13 | `INVALID_ASSIGNEE_REF` | `invalid_assignee_ref` | `property-do.ts:7289` |
| 14 | `INVALID_DATE` | `invalid_date` | `property-do.ts:7997` |
| 15 | `GUEST_REF_REQUIRED` | `guest_ref_required` | `property-do.ts:8000` |
| 16 | `INVALID_STAY_RANGE` | `invalid_stay_range` | `property-do.ts:8003` |
| 17 | `INVALID_WINDOW` | `invalid_window` | `property-do.ts:10631` |
| 18 | `INVALID_PROMO_CODE` | `invalid_promo_code` | `property-do.ts:11668`, throw `:11545` |
| 19 | `INVALID_PROMO_WINDOW` | `invalid_promo_window` | `property-do.ts:11674`, throw `:11795` |
| 20 | `INVALID_VOID_REASON` | `invalid_void_reason` | `property-do.ts:18635` |
| 21 | `PSP_ADAPTER_FAILED` | `psp_adapter_failed` | `property-do.ts:16344+` |
| 22 | `VALIDATION_ERROR` | `validation_error` | `property-do.ts:19525+` |
| 23 | `INVALID_ROLE` | `invalid_role` | `org-do.ts:846` |
| 24 | `ALREADY_MEMBER` | `already_member` | `org-do.ts:871` |
| 25 | `LAST_OWNER` | `last_owner` | `org-do.ts:922` |
| 26 | `PROPERTY_REF_NOT_FOUND` | `property_ref_not_found` | `org-do.ts:1356` |
| 27 | `DECRYPT_UNRESOLVED` | `decrypt_unresolved` | `org-do.ts:444` |
| 28 | `CONFIG_CLASS_NOT_DOMAIN` | `config_class_not_domain` | replaces English sentence (Lock 3) |
| 29 | `INVALID_DATE_RANGE` | `invalid_date_range` | throw `property-do.ts:1663` |
| 30 | `REPORTS_R2_UNBOUND` | `reports_r2_unbound` | throw `property-do.ts:3679` |
| 31 | `INVOICE_COUNTER_RACE` | `invoice_counter_race` | throw `property-do.ts:3946` |
| 32 | `INVALID_PROMO_KIND_FIELD` | `invalid_promo_kind_field` | throw `property-do.ts:11803` |
| 33 | `PROMO_ID_EXISTS` | `promo_id_exists` | throw `property-do.ts:11683` |
| 34 | `PAYMENT_INSERT_FAILED` | `payment_insert_failed` | throw `property-do.ts:16322` |
| 35 | `KEY_SHRED_FAILED` | `key_shred_failed` | throw `org-do.ts:1602` |
| 36 | `TENANT_NOT_ACTIVE` | `tenant_not_active` | `registry.ts:66` (surfaced via org/property resolution in DO-adjacent paths) |
| 37 | `DOMAIN_ERROR` | `domain_error` | `property-do.ts` provisional retry-failure fallback + `pending-commands-consumer.ts:127` — persisted as `provisional_exception.reason`; **added during implementation** (spec inventory miss) |

**Deferred (do NOT add in D1):** `CLOSE_FAILED` / `REOPEN_FAILED` (`purge-certificate.ts:157`, `:180`) — **locked: defer.** Purge-certificate is not a DO `try*` RPC, so it is outside the 78-signature command channel D1 closes. Typing it is a registry follow-up. The const count below is therefore **+36 new + 1 relocation = 157**, not 159.

**Parametric undeclared config (Lock 3b):** Do **not** add a new wire value. Keep `` `undeclared:${string}` `` as a `CommandError` member. Add helper:

```ts
export const UNDECLARED_CONFIG_PREFIX = 'undeclared:' as const;
export function configUndeclared(key: string): `undeclared:${string}` {
  return `${UNDECLARED_CONFIG_PREFIX}${key}`;
}
```

Replace `` `undeclared:${key}` `` returns with `configUndeclared(key)`.

**Test-only throws** (`simulated_internal_bug`, `audit_append_fault_for_test`, `simulated_post_room_charges_failure`) — map to `INTERNAL_ERROR` in catch mappers; remain behind `assertUnsafeLocal`. **Do not** add wire constants for test-only strings.

**Clerk lookup codes** (`clerk_unreachable`, `no_such_user`, `email_ambiguous`) — used in `clerk-lookup.ts` / membership invite HTTP, **not** DO `try*` returns today. **Out of scope** for `CommandError`; add in a membership-vertical follow-up if OrgDO RPC starts returning them.

#### 1d — Expected const count

| Metric | Before | After |
|---|---|---|
| `idempotency.ts` `export const` | **120** | **158** (**+36** new + `NIGHT_AUDIT_HALTED` relocated + `DOMAIN_ERROR` added during implementation §2.1c #37; purge codes deferred) |
| `CommandError` union members | — | **~176** (120 idempotency + 8 money + 4 permission/entitlement + 36 new + `NIGHT_AUDIT_HALTED` + template `` `undeclared:${string}` ``) |

---

### Lock 2 — Replace `| { ok: false; error: string }` on DO RPC signatures

On **PropertyDO**, **OrgDO**, **OrgEntitlementDO**:

```diff
- | { ok: false; error: string }
+ | { ok: false; error: CommandError }
```

**Per-command unions stay** — e.g. `| { ok: false; error: typeof NOT_FOUND | typeof FORBIDDEN | typeof ORG_ID_UNSET }` — but the trailing `| string` / `| { ok: false; error: string }` catch-all **must be deleted**.

Replace every bare string literal return with the matching constant import from `@hospai/contracts`.

**`e.message` passthrough (~70 sites):** In each `catch`, route through a typed mapper:

```ts
} catch (e) {
  const mapped = mapPropertyCommandError(e); // extends reservation mapper pattern :1134+
  if (mapped) return mapped;
  return { ok: false, error: INTERNAL_ERROR };
}
```

`mapPropertyCommandError` must handle all `throw new Error('snake_case')` codes in §2.1c plus domain `instanceof` errors already mapped at `:1134+`. **Never** return `e.message` directly once D1 lands.

Expect a **large compile-error surface** — that surface **is** the audit. Fix every error; do not widen back to `string`.

---

### Lock 3 — `CONFIG_CLASS_NOT_DOMAIN` structured error

#### 3a — PropertyDO return shape

Replace `property-do.ts:5120`:

```diff
- return { ok: false, error: `Only DOMAIN config may be stored in PropertyDO (got ${entry.class})` };
+ return { ok: false, error: CONFIG_CLASS_NOT_DOMAIN, gotClass: entry.class };
```

Return type becomes:

```ts
| { ok: false; error: typeof CONFIG_CLASS_NOT_DOMAIN; gotClass: string }
```

**Wire JSON:** `{ "ok": false, "error": "config_class_not_domain", "gotClass": "PLATFORM" }` — clients see snake_case code; internal class name moves to structured field (optional in logs; may omit from HTTP body if dispatch strips — **dispatch must not echo raw `gotClass` to clients unless already echoing error payload verbatim**; today handlers return `result.error` string only, so **`gotClass` is DO-internal unless handler forwards full result** — preserve current behaviour: HTTP body `{ error: 'config_class_not_domain' }` only).

#### 3b — Undeclared config prefix (no wire change)

Keep `` `undeclared:${key}` `` wire value via `configUndeclared(key)`. Typed; no English sentence.

#### 3c — Dispatch mapper

Replace `v1-dispatch.ts:439`:

```diff
- if (error.startsWith('undeclared:') || error.startsWith('Only DOMAIN config')) return 400;
+ if (error.startsWith(UNDECLARED_CONFIG_PREFIX) || error === CONFIG_CLASS_NOT_DOMAIN) return 400;
```

Delete `startsWith('Only DOMAIN config')` permanently.

---

### Lock 4 — `not_member` → **404** everywhere (locked)

**Decision (record in code comment at top of `mapGuestCommandErrorStatus` or shared `mapMembershipErrorStatus`):**

> `not_member` means the actor has no effective role on the org/property scope. This matches `requirePermission` (`auth.ts:115` → **404** `not_found`) and the **58-site** dispatch majority. **`requirePermission` already cleared membership** on routes that call `gatePermission` first; a downstream DO `not_member` is treated as **404**, not **500**, because the client cannot remediate a stale membership view without re-authing.

**Change these 9 sites** from `internal_error` / **500** → **404** `not_found`:

| File | Line | Handler |
|---|---|---|
| `v1-dispatch.ts` | 946 | `handlePostRoomTypes` |
| `v1-dispatch.ts` | 1022 | `handlePutRoomType` |
| `v1-dispatch.ts` | 1076 | `handleDeleteRoomType` |
| `v1-dispatch.ts` | 1130 | `handleDeleteRoom` |
| `v1-dispatch.ts` | 6325 | `handlePostNightAuditRun` |
| `v1-dispatch.ts` | 6408 | `handlePostNightAuditRetry` |
| `v1-dispatch.ts` | 6454 | `handlePostNightAuditResolveHalt` |
| `v1-dispatch.ts` | 6501 | `handlePostProvisionalExceptionResolve` |
| `v1-dispatch.ts` | 6533 | `mapExceptionWriterError` (retry / assign / note) |

Pattern:

```diff
- if (result.error === 'not_member') return json({ error: 'internal_error' }, 500);
+ if (result.error === NOT_MEMBER) return json({ error: 'not_found' }, 404);
```

All mappers (`mapGuestCommandErrorStatus`, `mapRosterCommandErrorStatus`, `mapConfigErrorStatus`, `mapReservationCommandErrorStatus`, `mapPaymentCommandErrorStatus`) already map `not_member` → **404** — leave unchanged; ensure they use `NOT_MEMBER` constant.

---

### Lock 5 — Exhaustive status mappers

Retype all six functions in `v1-dispatch.ts`:

```ts
function mapReservationCommandErrorStatus(error: CommandError): number {
  switch (error) {
    case IDEM_KEY_REUSED:
    case ALREADY_CANCELLED:
    // … every CommandError that this mapper handles …
      return 409;
    // …
    case ORG_ID_UNSET:
    case BUSINESS_DATE_UNSET:
      return 500;
    default:
      return mapAddRoomTypeErrorStatus(error); // chain mappers OR flatten into one switch
  }
}
```

**Requirement:** The **final** default in the mapper chain must be:

```ts
default: {
  const _exhaustive: never = error;
  return _exhaustive;
}
```

Adding a new `CommandError` without a status mapping **must fail `pnpm typecheck`**.

Preserve **existing status integers** for every code — exhaustive switch is a refactor of control flow, not a semantics change (except Lock 4 and Lock 3).

**Internal-invariant class → 500** (must not fall through to 422):

| Code | Status |
|---|---|
| `ORG_ID_UNSET` | **500** |
| `PROPERTY_ID_UNSET` | **500** |
| `BUSINESS_DATE_UNSET` | **500** |
| `TIMEZONE_UNSET` | **500** (where mapped) |
| `INTERNAL_ERROR` | **500** |
| `INVOICE_R2_UNBOUND` / `CITY_LEDGER_R2_UNBOUND` / `REPORTS_R2_UNBOUND` | **503** (unchanged) |

---

## 3. File map

| File | Change |
|---|---|
| `packages/contracts/src/command-error.ts` | **New** — `CommandError` type, `configUndeclared`, `isCommandError`, const registry |
| `packages/contracts/src/idempotency.ts` | **+37** constants; receive `NIGHT_AUDIT_HALTED` |
| `packages/contracts/src/index.ts` | Re-export `command-error.js` |
| `packages/do-runtime/src/command-error.compile-time.ts` | **New** — compile-time rejection test |
| `apps/pms-core/src/property-do.ts` | 78 signature catch-alls; literal → const; `CONFIG_CLASS_NOT_DOMAIN`; `e.message` mappers; remove local `NIGHT_AUDIT_HALTED` export |
| `apps/pms-core/src/org-do.ts` | 19 signature catch-alls; literal → const |
| `apps/pms-core/src/org-entitlement-do.ts` | 1 signature catch-all |
| `apps/pms-core/src/v1-dispatch.ts` | Six exhaustive mappers; `NOT_MEMBER` unification; const imports; `mapConfigErrorStatus` Lock 3 |
| `apps/pms-core/test/*.spec.ts` | Update assertions: `not_member` room/audit routes expect **404**; config domain error expects `config_class_not_domain` |

**Not touched:** `COMMAND_CATALOG`, `V1_HTTP_ROUTE_AUDIT`, `AUDIT_WRITER_COMMAND_IDS`, `NIGHT_AUDIT_STEPS`, `PROPERTY_SCHEMA_HEAD`, `registry.ts` (follow-up), `gatePermission`, auth.

---

## 4. Test plan

### 4.1 Compile-time (required)

Add `packages/do-runtime/src/command-error.compile-time.ts`:

```ts
import type { CommandError } from '@hospai/contracts';

function _rejectBogus(): void {
  const bogus = 'totally_made_up' as string;
  // @ts-expect-error not assignable to CommandError
  const _bad: CommandError = bogus;
}
void _rejectBogus;
```

Mirror inclusion in `tsconfig` the same way as `idempotency.compile-time.ts`.

### 4.2 Behaviour regression (required)

| Test | Assert |
|---|---|
| Room type POST/PUT/DELETE + room DELETE with mocked `not_member` | **404** `{ error: 'not_found' }` (was **500**) |
| Night-audit run / retry / resolve-halt with mocked `not_member` | **404** (was **500**) |
| Provisional resolve / retry / assign / note with mocked `not_member` | **404** via `mapExceptionWriterError` (was **500**) |
| `tryPutDomainConfig` non-DOMAIN class | `{ error: 'config_class_not_domain' }` + **400** via mapper (not English sentence) |
| Undeclared config key | **400**; wire still `undeclared:<key>` |
| Known business error (e.g. `NO_AVAILABILITY`) | Same status as before D1 |

### 4.3 Gates (required — all 14 `check:*` + local suite)

```bash
pnpm typecheck
pnpm build
pnpm check:forbidden-bodies
pnpm check:degraded
pnpm test:local
# … all other check:* gates from audit ground rules §4
```

---

## 5. Verification checklist (implementer)

- [ ] `CommandError` union closed; **36** new constants landed (+ `NIGHT_AUDIT_HALTED` relocated); count **157** in `idempotency.ts`
- [ ] Zero `\| { ok: false; error: string }` on PropertyDO / OrgDO / OrgEntitlementDO RPC signatures
- [ ] Zero bare `'org_id_unset'` / `'not_member'` / `'scope_mismatch'` literals in DO + dispatch mapper paths
- [ ] `CONFIG_CLASS_NOT_DOMAIN` replaces English sentence; mapper uses constant equality
- [ ] `` `undeclared:${string}` `` typed via `configUndeclared()`; wire unchanged
- [ ] **9** `not_member` → **500** sites changed to **404**; comment documents decision
- [ ] Six mappers exhaustive with `never` default
- [ ] `command-error.compile-time.ts` rejects bogus code
- [ ] `pnpm typecheck && pnpm build` clean
- [ ] All **14** `check:*` + `pnpm test:local` green

---

## 6. Open decisions / locked

| Question | Resolution |
|---|---|
| `not_member` → 404 or 500? | **404** everywhere (Lock 4) — **locked** |
| English config sentence? | **`CONFIG_CLASS_NOT_DOMAIN`** + `gotClass` field (Lock 3) — **locked** |
| `undeclared:${key}` wire change? | **No** — template literal type + helper (Lock 3b) — **locked** |
| Purge `close_failed` / `reopen_failed` in D1? | **Defer** — purge-certificate is not a DO `try*` RPC; registry follow-up. Count locked at **157** |
| Clerk lookup codes in union? | **Defer** — not DO `try*` returns today |
| `registry.ts` catch-alls? | **Defer** — not blocking Phase F |
| Implementation order? | Contracts → PropertyDO slices → OrgDO → OrgEntitlementDO → dispatch — **locked** |

---

## 7. Gaps closed this chunk

| # | Gap | Closed by |
|---|---|---|
| 1 | Untyped `error: string` catch-all collapses unions (D1a) | `CommandError` + signature replacement |
| 2 | Constants mixed with literals (D1b) | All literals → constants |
| 3 | English sentence wire code (D1c) | `CONFIG_CLASS_NOT_DOMAIN` |
| 4 | `not_member` dual status (D1d) | Unified **404** |
| 5 | Non-exhaustive mappers (D1e) | `switch` + `never` default |

**Still open (explicit):**

| Item | Owner |
|---|---|
| Phase **F** refactors | After D1 lands |
| Phase **E+** user-facing errors | Phase E |
| `registry.ts` typing | Optional follow-up |
| Clerk lookup wire constants | Membership vertical |

---

## 8. Implementation checklist (reviewer §8)

- [ ] Lock 1: `command-error.ts` + **36** new constants + `NIGHT_AUDIT_HALTED` relocation
- [ ] Lock 2: PropertyDO **78** + OrgDO **19** + OrgEntitlementDO **1** signature updates; `e.message` mappers
- [ ] Lock 3: `CONFIG_CLASS_NOT_DOMAIN` + `configUndeclared()` + mapper fix
- [ ] Lock 4: **9** `not_member` sites → **404** + decision comment
- [ ] Lock 5: Six exhaustive mappers
- [ ] Compile-time test + behaviour specs
- [ ] Full gate suite green

---

## 9. Tree conflicts with reviewer locks

**No structural head moves.** Only **`idempotency.ts` `export const` count** grows **120 → 157**.

| Head | Moves? | Why |
|---|---|---|
| `COMMAND_CATALOG` | **No** | No new commands |
| `AUDIT_WRITER_COMMAND_IDS.size` | **No** | No new audit writer ids |
| `V1_HTTP_ROUTE_AUDIT` | **No** | No route changes |
| `PROPERTY_SCHEMA_HEAD` | **No** | No migration |
| `NIGHT_AUDIT_STEPS` | **No** | No step changes |
| `idempotency.ts` const count | **Yes — 120 → 157** | D1 wire-code constants only |

---

## 10. Risks & ambiguities (for product owner review)

| Risk | Mitigation |
|---|---|
| Large compile-error surface (~100+ files) | Slice by DO vertical; contracts first |
| **`not_member` 404** changes 9 routes from **500** → **404** | Intended behaviour change per audit; update tests |
| **`config_class_not_domain`** changes wire string clients may have parsed | Old string was a bug (English sentence); document in changelog |
| **`e.message` catch blocks** may hide unknown throws | Default unmapped → `INTERNAL_ERROR` (**500**), not **422** |
| Purge/clerk/registry codes borderline | Explicitly deferred; do not block D1 |
| `gotClass` field visibility on HTTP | Spec preserves "error string only" response shape unless handler already forwards full result |
