# Structured-cloneable boundary lint (Phase 0 — serializable-contract enforcement)

**Date:** 2026-07-28  
**Status:** Approved for implementation (rev 3 — signed off)  
**Sources:** ARCHITECTURE.md §3, §11 (lint rule 6), §14 first bullet; `eslint-plugin-hospai`; [structured clone algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structuredclone)

## Purpose

Close the last Phase 0 enforcement gap: **§11 rule 6** — *"No module-boundary type that is not structured-cloneable (§3)."*

Module exports and DO RPC signatures cross serialization boundaries. Values that **throw `DataCloneError`** under structured clone, or **clone with silent prototype loss**, are not safe on the **module-export** surface. DO RPC uses **Workers RPC**, which is a superset of structured clone — the forbidden lists differ (see **Two surfaces**).

This slice is **syntactic only** for v1 — no `parserOptions.project`, no type-checker.

## What structured clone actually does

**Do not conflate “bad boundary type” with “throws on clone.”** Many types clone successfully but are still wrong at a module boundary for other reasons (see optional date rule below).

| Type | Clone result |
|---|---|
| `Date`, `Map`, `Set`, `RegExp`, `Error`, `BigInt`, typed arrays | **OK** — explicitly supported |
| `Function`, arrow functions | **`DataCloneError`** under bare structured clone |
| `WeakMap`, `WeakSet` | **`DataCloneError`** |
| `Symbol`, `Proxy` | **`DataCloneError`** |
| Class instance (`new Foo()`) | **OK but prototype lost** — arrives as plain `Object`; methods undefined |
| Getter on object | **OK** — value snapshot; accessor lost (not detectable syntactically) |

The repo already proves `Date` across DO RPC: `ensureBusinessDateIfAbsent` and `ensureNightAuditSchedule` take `instant: Date`; provisioning tests pass `new Date()` through stub calls — **271 tests green**. Those signatures are **not** violations and must not be “fixed” as part of this slice.

**`DurableObjectStub`:** Workers RPC passes stubs by design; **not** forbidden on DO RPC signatures. Bare `structuredClone` of stubs fails — that constraint applies to **Workflow step payloads** (`night-audit-workflow.ts` re-resolves stubs inside `step.do`), not DO RPC. Do not flag stubs without a separate, verified rule scoped to Workflow steps.

## Two surfaces — different serialization contracts

**Do not apply one forbidden list to both surfaces.** Workers RPC is a superset of structured clone: it passes **functions as proxies** and **stubs** by design.

```ts
// events-queue.spec.ts — callback passed across a DO stub RPC; 271 tests green
return stub.flushOutbox(async (batch) => { … });
```

`public flushOutbox(deliver?: (batch: OutboxRow[]) => Promise<void>)` uses a **`TSFunctionType`** (callback parameter), not a `Function` type reference. A rule that only matches the identifier `Function` misses real callback shapes — and flagging `TSFunctionType` on DO RPC would be wrong (rev-1 mistake in miniature).

| Surface | Contract | Hard-failure identifiers | Class types | Callback `TSFunctionType` |
|---|---|---|---|---|
| `modules/**/src/index.ts` exports | Structured clone (future service-binding extraction) | `Function`, `WeakMap`, `WeakSet`, `Symbol`, `Proxy` | Denylist + same-file `class` | **Forbidden** in exported types |
| DO RPC method signatures (`PropertyDO`, `OrgDO`, `OrgEntitlementDO`) | Workers RPC | `WeakMap`, `WeakSet`, `Symbol`, `Proxy` only | Denylist + same-file `class` | **Allowed** — proxies by design |

**Normative:** the rule receives a `surface` from the file path predicate and applies the matching column. Message `hardNonCloneable` cites structured clone on module exports and Workers RPC limits on DO signatures where applicable.

**Current tree:** all four `modules/**/src/index.ts` barrels are **pure re-exports** — no inline type declarations — and bare re-exports are excluded ("cloneability is the exporter's contract"). The module-export column therefore has **nothing inspectable today**; Phase 0 enforcement is the **DO RPC surface** (~30 public methods). The module-export half is scaffolding for when a barrel declares a type inline; **v2 re-export following** (resolve `from './domain/…'`, inspect the named declaration — same filesystem helper as import-resolving class detection) closes the gap without widening the predicate.

## Two failure modes (within each surface)

### 1. Hard failures

- **Module exports:** `Function`, `WeakMap`, `WeakSet`, `Symbol`, `Proxy` — direct `TSTypeReference` / `TSTypeQuery` name match; plus **`TSFunctionType`** in exported type positions (callbacks in DTOs).
- **DO RPC:** `WeakMap`, `WeakSet`, `Symbol`, `Proxy` only — **not** `Function`, **not** `TSFunctionType` on parameters/returns.

### 2. Silent corruption — class prototype loss

**Centre of gravity for this rule.** `new PiiVault()` clones as a plain object; methods and `instanceof` are gone. ARCHITECTURE §3 lists this alongside hard failures.

`import type { PiiVault }` and `import type { OutboxRow }` are **syntactically identical** — PascalCase, type-only import, indistinguishable in the importing file. A PascalCase heuristic flags every interface, alias, and enum (`CurrencyCode`, `IdempotencyKey`, `Jurisdiction`, `OutboxRow`, `GuestProfile`, `InventoryRow`, …) and produces false positives on correct code. **Do not use PascalCase heuristics.**

## Class detection — v1 denylist + drift check

**v1 (ship in Phase 0):** explicit **`CLASS_DENYLIST`** constant in `eslint-plugin-hospai` — the set of all `export class` names in the repo. Flag `TSTypeReference` when the identifier is:

1. in **`CLASS_DENYLIST`**, or
2. a **`class` declaration** in the same file (local non-exported classes)

**Drift check** (same pattern as `check:entitlements`): script or vitest test greps `^export class (\w+)` across the repo and **fails CI** if any exported class name is missing from `CLASS_DENYLIST`. New class → update denylist deliberately.

Initial denylist (repo snapshot 2026-07-28):  
`AlarmScheduler`, `EntitlementDoCache`, `EntitlementRequiredError`, `EntitlementResolutionError`, `IdempotencyKeyReused`, `InvalidFxRateError`, `InvalidMoneyError`, `InvalidTenantIdError`, `InvalidTimeZoneError`, `JurisdictionMismatchError`, `JurisdictionUnavailableError`, `KeyNotFoundError`, `KeyShreddedError`, `LaneGuard`, `LedgerAmountMismatchError`, `MigrationSweepWorkflow`, `NightAuditWorkflow`, `OrgDO`, `OrgEntitlementDO`, `OutboxPayloadTooLargeError`, `PiiVault`, `PropertyDO`, `SecretConfigRejectedError`, `SqlKeyStore`, `UndeclaredConfigError`, `CurrencyMismatchError`.

**Expected hits on current tree:** **zero** — DO RPC signatures use plain aliases (`OutboxRow`, `IdempotencyKey`, `Jurisdiction`, …), not denylisted class types; module barrels have no inspectable declarations (see **Two surfaces**). Rule lands green on the DO surface.

**v2 (follow-on):** resolve import source (filesystem, no type-checker — same pattern as import/no-unresolved) and flag when the target file contains `export class <Name>`. Accurate for imports; replaces manual denylist maintenance.

## Optional separate rule — not cloneability

Calendar **dates** in **module wire types** should be ISO strings / epoch ms with explicit property timezone — a **serialization convention**, not cloneability. That is **`no-date-in-boundary-types`**, with its own message, because *"Date is not structured-cloneable"* is **factually false** and will erode trust in the plugin.

| Rule | Rationale | Phase 0? |
|---|---|---|
| `no-non-cloneable-boundary-types` | §3 / §11 rule 6 — surface-aware hard failures + class prototype loss | **Yes — closes Phase 0** |
| `no-date-in-boundary-types` | Temporal wire convention | **Optional, separate slice** |

**Keep** existing `instant: Date` on provisioning DO methods.

## Scope — rule 1: `no-non-cloneable-boundary-types`

**In**

- ESLint rule in `eslint-plugin-hospai` with path-derived `surface`
- Enable in `recommended` + root `eslint.config.js` (**seventh** §11 rule)
- **Target files:**
  1. `modules/**/src/index.ts` → `module export`
  2. `apps/pms-core/src/property-do.ts` → `DO RPC signature`
  3. `apps/pms-core/src/org-do.ts` → `DO RPC signature`
  4. `apps/pms-core/src/org-entitlement-do.ts` → `DO RPC signature`
- **Target AST nodes:** exported type declarations; public DO method signatures (params + return)
- **Exclusions:** `private` / `#`; `*ForTest`; bare `export type { X } from '…'`
- **`CLASS_DENYLIST` + drift check** in CI (`pnpm check:class-denylist` or equivalent alongside plugin tests)
- Vitest: valid fixtures using `OutboxRow` / `IdempotencyKey`; invalid fixtures using `WeakMap` and a denylisted class name
- Plugin tests: exact-match **seven** rule keys

**Out**

- `Date`, `Map`, `Set`, `RegExp`, `Error` on either surface
- `DurableObjectStub` / stub types on DO RPC
- PascalCase / import heuristics
- Churn on `ensureBusinessDateIfAbsent` / `ensureNightAuditSchedule`
- Type-checker, alias following, outbox payload lint

## Scope — rule 2: `no-date-in-boundary-types` (optional)

Separate slice. Module export surface only unless product explicitly scopes DO wire DTOs later. **Not required for Phase 0 exit.**

## Rule behaviour — rule 1 (normative)

```ts
// modules/pms/foo/src/index.ts — ERROR (module): WeakMap
export type Cache = { m: WeakMap<string, string> };

// modules/pms/foo/src/index.ts — ERROR (module): denylisted class
import type { PiiVault } from '@hospai/crypto-shredding';
export type GuestStore = { vault: PiiVault };

// modules/pms/foo/src/index.ts — OK: plain alias types
export type { OutboxRow } from '@hospai/do-runtime';
export type Row = { code: CurrencyCode; idem: IdempotencyKey };

// property-do.ts — OK (DO RPC): callback parameter — Workers RPC proxy
async flushOutbox(deliver?: (batch: OutboxRow[]) => Promise<void>): Promise<…>

// property-do.ts — OK (DO RPC): clock instant
async ensureNightAuditSchedule(timeZone: string, instant: Date): Promise<void>

// property-do.ts — OK: alias types in signatures
async tryAddRoomType(…, idem: IdempotencyKey): Promise<…>
```

**Message ids:**

- `hardNonCloneable` — `"{{typeName}} is not serializable on {{surface}} ({{contract}})."` — `contract` ∈ `structured clone` | `Workers RPC`
- `classType` — `"Class type {{typeName}} loses its prototype when cloned; use a plain serializable shape on {{surface}} (ARCHITECTURE §3)."`

## Verification

1. Plugin unit tests — module vs DO surface cases; denylist class vs plain alias.
2. **Drift check** — grep `export class` ⊆ `CLASS_DENYLIST`.
3. **`pnpm lint`** — clean on full monorepo; no changes to provisioning `Date` params or `flushOutbox` callbacks.
4. Seven rules exact-match in plugin export test.

## Follow-on (not Phase 0)

- **v2:** resolve import → `export class` in target file; **follow bare re-exports one level** from module barrels into `domain/` declarations (same filesystem helper — build once)
- **`no-date-in-boundary-types`** optional convention rule
- Outbox payload lint; getter/setter note remains documentation-only

**Phase 0 exits when rule 1 + class denylist drift check ship and CI is green.** Day-one enforcement is the DO RPC surface; module barrels are scaffolding until v2 re-export following lands.
