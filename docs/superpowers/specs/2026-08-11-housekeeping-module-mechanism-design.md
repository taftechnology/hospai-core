# Housekeeping Module Mechanism

**Date:** 2026-08-11  
**Status:** Accepted — implementation-ready  
**Sources:** ARCHITECTURE.md §3 (RPC-shaped contracts), §4.8 (staff PII / purge), §5 (module anatomy + config terminology), §11 (layout, lint rules, `pms.housekeeping`), §14 (Phase 2 gated-module premise), §16.3 rule 4 (record prototype divergence); [rooms & housekeeping vertical](./2026-08-05-rooms-housekeeping-vertical-design.md); [front-desk SPA shell](./2026-08-07-front-desk-spa-shell-design.md) (explicitly deferred module `ui` composition); [degraded-mode server](./2026-08-04-degraded-mode-server-design.md)

**Implementation order:** (1) kernel contract + gates + JSX/export spike → (2) characterization tests for provisional outbox extras, then extract existing backend → (3) read-only SPA board on `ui.manifest` → (4) catalog notes + self-tests in CI + README / `defineConfig` cleanup.

---

## 1. Context & Motivation

§11 plans sixteen `modules/pms/*` modules. Four exist today; all four contain only `src/domain/` (~620 lines of pure functions). There is no `module.manifest.ts` anywhere, and `packages/kernel`'s `defineModule` has zero call sites. Meanwhile `property-do.ts` holds the bulk of what §5 assigns to modules.

Phase 2's premise (§14: build the channel manager as a strictly gated module with zero special cases) is currently unfalsifiable — there is no mechanism to hack or fix. Every vertical added to `property-do.ts` before the shape exists is a vertical that must be extracted later. The §11 lint rules and structured-cloneable checks are live; what is missing is the shape they enforce against.

**Vehicle:** `pms.housekeeping` — next in Phase 1 build order (front desk → housekeeping → night audit), backend ~80% done, low entanglement with availability/money ledgers, and it exercises nearly every manifest field (events, permissions, UI). Housekeeping is preferred over reservations/folio because a mistake in module shape and a mistake in domain would be harder to separate there.

§5 is implementable inside a DO: the "Terminology, because this bites" paragraph defines `application/` as including "code running inside a DO, alarm, Queue consumer, or Workflow." The DO method stays thin and delegates; only `domain/` is the pure zero-I/O layer.

### 1.1 Scope in

1. **`packages/contracts` + `packages/kernel`** — module-facing types (`ModuleManifest`, `ModuleTxnCtx`, `SyncUseCase`, …) live in **contracts** so modules never import kernel. Kernel keeps zod `defineModule` + static `MODULE_REGISTRY` (validates on registration). Wire-or-delete dead `defineConfig`.
2. **`modules/pms/housekeeping`** — §5 anatomy **minus `jobs/`** (none this chunk): `domain/`, `application/`, `infrastructure/`, `api/`, `events/`, `ui/` + server and UI manifests under `src/` (see §3.1).
3. **Thin PropertyDO for these commands only** (RPC signatures preserved for `REPLAY_DISPATCH`):
   - `rooms.update_status` → `tryUpdateRoomStatus`
   - `rooms.bulk_update_status` → `tryBulkUpdateRoomStatus`
   - `housekeeping.assign` → `tryAssignHousekeeping`
   - **`readHousekeepingAssignments` moves** into the module as a sync read over bare `sql` (thin DO delegation). **`listRooms` stays in the DO** — `room` is inventory-owned (`schema.tables`); permission `housekeeping:read` on `get_rooms` does not transfer ownership (same rule as write-set ≠ ownership). Moving it now would double-move when inventory extracts. Board still calls `get_rooms` unchanged. **No new read routes.**
   - **`tryAssignRoom` / `reservations.assign_room` stays in reservations** — housekeeping touches `room` for **status** only
   - **`rooms.create` / `rooms.update` stay put** — inventory's surface per §11; not moved this chunk
4. **`assignee_ref` pin** — opaque stable staff id matching `^staff_[A-Za-z0-9_-]+$`; non-empty + format validated at the boundary; display names and raw Clerk `user_…` rejected. Roster owns creation/pseudonymization later. Pre-launch: migrate test fixtures `hk_*` → `staff_*` (no production backfill).
5. **Housekeeping SPA board** — via `ui.manifest` → SPA registry → `NAV_ENTRIES` concatenation; nav gated on `housekeeping:read`. **Read-only board + room-status mutations**; assign affordance deferred (no roster / no `staff_…` identity source yet — see §4.2).
6. **Gates** — `Sync<T>` compile-time contract; write-set check (`declared ⊇ actual`, overlap allowed); read-path files write-free; no identity on reads; manifest/`moduleId` pairing; wire existing `--self-test`s into CI; README test-count refresh.
7. **Catalog notes** — membership `staff.*` vs roster `housekeeping.staff_*` family distinction + §4.8 no-delete constraint; no resolution of what `staff_delete` becomes; id rename deferred to roster spec.

### 1.2 Scope out

- Extracting other verticals from `property-do.ts`
- Cross-store purge Workflow (§4.8) — needs `lifecycle.onPurge` consumers; natural *next* chunk
- Housekeeping **roster** (`housekeeping.staff_*`, Staff-class PII, key-scope wiring) and the SPA assign picker
- Moving `rooms.create` / `rooms.update`
- Visual identity (§16.4), `tools/module-scaffolder`
- Renaming `housekeeping.staff_*` command ids (still cheap while unrouted)

### 1.3 Sequencing (risk order)

1. Kernel contract + registry + gates + **JSX/export spike** (placeholder component proving `@hospai/pms-housekeeping/ui` resolves in Vite without dragging server manifest / React into the Worker graph).
2. **Characterization tests** for provisional outbox extras on the three moved commands (against pre-extraction code), then extract backend into the module; keep green including degraded replay.
3. SPA board on the `ui.manifest` surface (read-only + room status).
4. Catalog notes + CI self-tests + README / `defineConfig`.

### 1.4 Acceptance (mechanism proven when all hold)

- A second module can be registered without editing `packages/kernel` internals (only the hand registry list).
- Housekeeping board renders from the SPA registry; nav entry gated on `housekeeping:read`.
- The three DO RPC entrypoints remain callable from `REPLAY_DISPATCH` with unchanged signatures; existing rooms/housekeeping + degraded-mode tests stay green; **net-new** provisional-extras assertions on those three paths stay green through extraction.
- `property-do.ts` net line delta is negative for the moved methods (body → thin preamble + module call).

---

## 2. Module execution contract

### 2.1 Hybrid C — extend the existing idiom

`SqlStorageLike` is a structural interface in `do-runtime`, already implemented by test doubles (`MemorySql`, etc.). Platform-import lint binds only `domain/`; §5 sanctions DO calls in `infrastructure/`.

`do-runtime` is already ~80% of hybrid C: `runIdempotent(sql, idem, fn)`, outbox helpers, `AlarmScheduler`, `LaneGuard` are free functions over a structural handle. C extends that idiom. Full per-table ports (B) would leave SQL in `property-do.ts` and invent ownership disputes over shared tables (`room`). Raw injection without binding (naive A) would not pre-bind outbox/provisional extras.

### 2.2 Command-plane vs use-case (hard split)

**PropertyDO preamble (outside `transactionSync`):**

- `assertRpcAvailable`, `lanes.touchInteractive()`
- `getOrgIdSync` / `getPropertyIdSync` (fail closed if unset)
- `await gatePermission(...)` (and entitlement gates when applicable)
- Input shape / format checks before opening a txn (status enum, `businessDate` format, **`assignee_ref` format**)

**Still DO-owned inside `transactionSync(() => runIdempotent(...))`:**

- `runIdempotent` itself
- `assertProvisionalBusinessDateOpen(provisional)` — degraded replay / command plane, not domain

**Module never receives:** `ActorContext`, `IdempotencyKey`, `ProvisionalContext`, the DO stub/`this`, or any async handle into OrgDO/KV.

### 2.3 Write path — sync use case + txn-scoped context

`ModuleTxnCtx` is constructed **only inside** `transactionSync(() => runIdempotent(...))`, so it cannot exist outside the transaction:

```ts
// packages/contracts — module-facing; ModuleSql is structural (matches do-runtime SqlStorageLike)
type ModuleTxnCtx = {
  sql: ModuleSql;
  /** Pre-bound: this sql handle, property outbox source, and provisional extras merged into payload. */
  appendOutbox: (evt: ModuleOutboxEventInput) => void;
  orgId: string;
  propertyId: string;
};
```

**No `businessDate` on the ctx.** Catalog `housekeeping.assign` uses client `businessDate` as the scheduling target — deliberately unbounded vs the DO open business date (format-validated only). Putting the open date on the ctx beside `input.businessDate` invites silent wrong-day writes. The current implementation never reads the open business date for assign; provisional gating stays DO-side via `assertProvisionalBusinessDateOpen`. When a future command genuinely needs the open date, add it as **`openBusinessDate`** — a name that cannot be misread.

**`appendOutbox` must augment the payload**, not merely route:

```ts
appendOutbox: (evt) =>
  this.appendPropertyOutbox({
    ...evt,
    payload: { ...evt.payload, ...this.statusChangeOutboxExtras(provisional) },
  })
```

Today each moved mutation spreads `...this.statusChangeOutboxExtras(provisional)` (`issuedAt`, `replayedAt`, `provisional: true`). The module correctly never sees `ProvisionalContext`; the binder must preserve those markers or degraded-mode observability regresses silently.

**Hoist the binder into one private helper** — do not construct `ModuleTxnCtx` inline at each call site. The provisional-extras merge is the silently droppable binding §4.1 exists to protect; writing it three times is how the second and third copies drift:

```ts
private moduleTxnCtx(
  orgId: string,
  propertyId: string,
  provisional?: ProvisionalContext,
): ModuleTxnCtx {
  return {
    sql: this.ctx.storage.sql,
    appendOutbox: (evt) =>
      this.appendPropertyOutbox({
        ...evt,
        payload: { ...evt.payload, ...this.statusChangeOutboxExtras(provisional) },
      }),
    orgId,
    propertyId,
  };
}
```

Illustrative DO shape (three mutations share the helper):

```ts
return this.ctx.storage.transactionSync(() =>
  runIdempotent(this.ctx.storage.sql, idem, () => {
    this.assertProvisionalBusinessDateOpen(provisional);
    return assignHousekeeping(this.moduleTxnCtx(orgId, propertyId, provisional), input);
  }),
);
```

### 2.4 Sync contract — compile error, not a check script

`runIdempotent`'s `execute: () => T` currently accepts `async` callbacks: `T` becomes `Promise<X>`, typechecks clean, then `JSON.stringify(result)` on a Promise stores `"{}"` in the idempotency row — replay returns `{}` and the mutation escapes the transaction.

```ts
// packages/contracts — single home (kernel, do-runtime, and modules all depend on contracts;
// modules must not depend on kernel — that would cycle with MODULE_REGISTRY)
type Sync<T> = T extends PromiseLike<unknown> ? never : T;
```

Apply `Sync<T>` to `runIdempotent`'s execute argument and to contracts' `SyncUseCase` / `SyncRead` types. Prefer the constraint on the **argument** so the error surfaces at the call site.

**One contract, two failure modes:**

| Kind | Failure if async |
|---|---|
| Writes | Atomicity / idempotent `"{}"` poison (`MUST NOT await` inside `runIdempotent`) |
| Reads | Torn read — awaiting between `exec` calls yields the DO I/O gate and lets a mutation interleave |

Follow the existing compile-time harness pattern in [`packages/money/src/compile-time.ts`](../../../packages/money/src/compile-time.ts) (`// @ts-expect-error`, covered by `pnpm typecheck`).

### 2.5 Read path

- Signature: `(sql: SqlStorageLike, filters) => Sync<Out>`
- **No `orgId` / `propertyId` on reads.** No `property_id` / `org_id` column exists in PropertyDO tables — the DO *is* the tenancy boundary. Identity belongs on outbound events (Queue payloads) where tenancy is no longer implicit. A read context carrying identity would tempt filters that cannot work or stamps that belong to the caller.
- **No new read surface this chunk.** Board composes client-side from existing `get_rooms` and `get_housekeeping_assignments` (both `housekeeping:read`, both `FAIL_CLOSED`). A joined read would add route + `degradedRead` + check bindings; defer unless SPA later proves the need.
- Module owns the body of **`readHousekeepingAssignments`** only. `listRooms` stays in the DO (see §1.1).

### 2.6 Schema adopt-as-is; write-set ≠ ownership

- Tables `room` and `housekeeping_assignment` stay **unprefixed**. Manifest `schema.prefix` applies to **new** modules only. No rename migration (freeze / `check:ddl`).
- **`schema.tables`** (what this module's migrations own): `['housekeeping_assignment']` — `room` is inventory's.
- **`writes`** (what this module may write): `['room', 'housekeeping_assignment']` — status updates + assignments.
- Static check: **`declared ⊇ actual`** over `infrastructure/` write statements; **overlap allowed** (not exclusivity). Inventory will later also declare `room`. Do not build a runtime SQL-parsing executor.
- Read-path files: no `INSERT` / `UPDATE` / `DELETE` (static check).

### 2.7 `assignee_ref` enforcement

- Format: `^staff_[A-Za-z0-9_-]+$`
- Reject: empty, whitespace-only, display names, raw `user_…`, legacy `hk_…`
- Validate in DO preamble **and** re-assert in the sync use case (use case stays testable without a DO)
- Pin rationale: §4.8 keys Staff-class PII per **staff** identity (`KeyScope = 'staff'`), not per role. Prefix `hk_` would couple the ref to a role and force a rename when the roster lands. Choosing `staff_` now is cheap only while pre-launch (fixture-only churn) — record that assumption.

### 2.8 Lifecycle

- `lifecycle?: { onActivate?, onDeactivate?, onPurge? }` on the type; housekeeping **omits** it (no no-op handlers).
- Absence is meaningful for `pms.core` modules (always-on; cannot deactivate housekeeping without deactivating PMS). Modules with their own entitlement will require `onPurge` when the purge chunk lands — derive the requirement from `entitlement`, do not add a separate discriminator. Check script for that rule belongs in the purge chunk.

---

## 3. Manifests, registries, SPA

### 3.1 Why two files (do not collapse)

The bleed that matters is **UI → Worker**, not Worker → UI. Packages/modules are largely platform-import-free (`SqlStorageLike` is structural). But:

```ts
routes: [{ path: '/housekeeping/*', component: () => import('./ui/HousekeepingApp') }]
```

If `pms-core` imported a single manifest for permissions/lifecycle, **`.tsx` enters the Worker module graph** and wrangler must resolve JSX in a build that should not know React. `web-pms` (Vite) and `pms-core` (wrangler) are separate builds.

| File | Importers | Contents |
|---|---|---|
| `module.manifest.ts` | Worker registry (`packages/kernel`) | id, version, entitlement, requires, schema, publishes, subscribes, permissions, meters, writes, lifecycle? |
| `ui.manifest.ts` | SPA registry (`web-pms` only) | moduleId, nav, routes, settingsPanels?, dashboardWidgets? |

Same `moduleId`; check asserts pairing. This is one logical manifest split along a physical build boundary — not two sources of truth.

**Location:** both manifests live under **`src/`** (e.g. `src/module.manifest.ts`, `src/ui.manifest.ts`). §5's diagram shows them at package root, but existing module tsconfigs use `"rootDir": "src"` / `"include": ["src"]` — root-level files are not compiled and `dist/` would have nothing to import. Prefer moving under `src/` (local divergence from the diagram) over widening `rootDir` for every consumer. Pin export paths against the resulting `dist/` layout.

### 3.2 Worker registry (acyclic dependency graph)

Hand-maintained static list in `packages/kernel` — no codegen this chunk (revisit with `tools/module-scaffolder` once ~5 modules exist and the shape has stopped moving).

**Dependency direction (required):** `contracts → modules/pms/* → kernel → apps/pms-core`. Modules export a **plain** manifest object typed as `ModuleManifest` from contracts — they do **not** call `defineModule` and must **not** depend on `@hospai/kernel`. Kernel's registry imports those plain objects and runs each through `defineModule` at registration. That keeps `defineModule` live without a `kernel ⇄ module` cycle (which would break turbo `dependsOn: ["^build"]`).

```ts
// modules/pms/housekeeping/src/module.manifest.ts
import type { ModuleManifest } from '@hospai/contracts';
const manifest = { id: 'pms.housekeeping', /* … */ } as const satisfies ModuleManifest;
export default manifest;

// packages/kernel/src/registry.ts
import housekeeping from '@hospai/pms-housekeeping';
import { defineModule } from './define-module.js';
export const MODULE_REGISTRY = [defineModule(housekeeping)] as const;
```

Adding a second module = new package + one import/wrap line in the registry — no kernel internals edit. Package main/exports for `.` must resolve the **server** manifest only; UI is a separate `@hospai/pms-housekeeping/ui` subpath.

### 3.3 SPA registry — no `kernel` dependency

`web-pms` keeps `client-core` + `contracts` + workspace dep on `@hospai/pms-housekeeping` for the **UI export only**. It does **not** depend on `@hospai/kernel`.

- Package `exports`: `@hospai/pms-housekeeping/ui` → UI manifest + components; server manifest not reachable from that subpath.
- React is a **`peerDependency` + `devDependency`** on the module (not a hard dependency) so `pms-core`'s import of the server manifest does not imply React.
- Shared nav/route contribution types live in **`contracts`** (or a type-only export) so SPA and check scripts agree.

`nav.ts` remains the **core** contribution. Core entries gain explicit **`order`**: Arrivals 10, In-house 20, Departures 30, Book 40, Staff 50. Housekeeping contributes `order: 25` (between In-house and Departures). Sort by `order` so undefined cannot scramble core nav.

### 3.4 SPA board

- **Read-only board** listing rooms + assignments for a selected `businessDate`, composed via react-query from `get_rooms` + `get_housekeeping_assignments`.
- **Room-status mutations** via existing routes (write path exercised through UI).
- **No assign affordance this chunk** — roster is out of scope, so no resolvable `staff_…` identity exists; free-text opaque ids would be developer-only UX. Server `housekeeping.assign` is still extracted (mechanism proof); picker waits for the roster chunk.
- Nav + route gate on `housekeeping:read`; writes server-gated on `housekeeping:write`. Gate-clean vs `check:web-pms-me-gating` (no `ROLE_GRANTS` / role-equality).

### 3.5 Step-1 spike (before board)

No module today has React/`jsx` configured. Spike during step 1: placeholder component rendering "housekeeping", `jsx: "react-jsx"`, peer React, exports subpath. Prove Vite resolves `@hospai/pms-housekeeping/ui` **without** pulling `module.manifest` into the browser graph, and that `pms-core` importing the server manifest does **not** resolve `.tsx`. Discovering this in step 3 would force a redesign of the split.

### 3.6 Remaining gates (scripts)

| Check | Asserts |
|---|---|
| `check:module-manifests` (new, `--self-test` from day one) | Every `modules/pms/*/src/module.manifest.ts` registered; schema valid; ui/server `moduleId` pairing; `writes` / `schema.tables` present as required; write-set `declared ⊇ actual`; read-path files write-free |
| CI | Run existing `--self-test` on scripts that have one; cover the new check |

**Not a script:** `Sync<T>` (compile-time).

### 3.7 Small folds

- `defineConfig`: delete if unused as a product API, or document as thin helper over `CONFIG_REGISTER` — pick one; no second config plane.
- README test count → measured count at land time.

---

## 4. Testing, catalog notes, risks

### 4.1 Degraded replay and provisional extras — characterization first

`REPLAY_DISPATCH` binds all three moved methods through `REPLAY_ACTOR` and `ProvisionalContext`. RPC signatures are load-bearing.

Existing degraded-mode tests (e.g. test 23 `housekeeping.assign`, test 22 room status) assert the **row landed** after `dispatchPendingBatch`; they **do not** inspect outbox payloads for `provisional` / `issuedAt` / `replayedAt`. Only `reservations.check_in` (test 2) asserts those markers today.

**Consequence:** if extraction drops the `statusChangeOutboxExtras` binding, every existing degraded-mode test stays green while observability silently regresses.

**Required:**

1. **Write characterization assertions before extraction** (first move of step 2) for all three moved commands — against pre-extraction code — that replayed outbox events carry `provisional`, `issuedAt`, and `replayedAt`. Then extract; those tests prove survival.
2. Keep existing degraded-mode + rooms/housekeeping tests green through extraction (real DO → real in-process module; do not mock the module away in DO tests).
3. Module-unit tests with `MemorySql` + captured `appendOutbox` for domain behavior.
4. At least one **DO integration assertion per moved mutation** remains mandatory for the binder (module unit tests cannot see DO-side provisional merging).

### 4.2 SPA assign deferred

No `staff_…` identity source exists until the roster chunk. Board this chunk: read-only + room-status mutations only. Still proves nav contribution, route resolution, permission gating, and the two-read compose path.

### 4.3 `assignee_ref` / fixtures

- Unit: reject `''`, `'Alice'`, `'user_abc'`, `'hk_alice'`; accept `staff_alice`.
- Update fixtures including degraded-mode `hk_deg` → `staff_deg` (and `hk_alice` / `hk_bob` in rooms specs).
- Server remains authoritative; when assign UI lands later, client validates the same regex.

### 4.4 Sync compile-time test

Add a `compile-time.ts` harness (money pattern) proving `runIdempotent` rejects `async` execute and that contracts' `SyncUseCase` rejects `Promise` returns.

### 4.5 Catalog notes (this chunk)

On the `housekeeping.staff_*` family (shared constant referenced by all four entries):

- Distinguish from membership `staff.*` (property access revocation is a legitimate delete; roster is Staff-class PII under a per-staff key — near-identical shape and the same `staff:write` permission make misreading natural).
- §4.8: staff exit is not deletion; identity is pseudonymized; employment record follows statutory retention — **constraint recorded**; resolution (what the command does, which fields pseudonymize, retention window) owned by the roster spec.
- Rename to e.g. `housekeeping.roster_*` deferred explicitly while still cheap (unrouted / unimplemented).

No implementation of those commands.

### 4.6 `check:module-manifests` self-test

Valid fixture passes; missing registry entry fails; ui/server `moduleId` mismatch fails; write-set under-declaration fails; read-path with `UPDATE` fails.

### 4.7 Risks

| Risk | Mitigation |
|---|---|
| Module shape wrong | Sequence: spike + extract backend before SPA board |
| Silent wrong-date via ctx business date | No `businessDate` on `ModuleTxnCtx`; future field named `openBusinessDate` |
| Provisional markers dropped on extraction | **Characterization tests before extract**; DO integration assert per mutation |
| Provisional markers unasserted today | Net-new coverage — do not treat "keep green" as sufficient |
| `assignee_ref` becomes display/user id | Format pin + fixture migration now |
| No assignee identity for SPA | Read-only board + status mutations; assign UI with roster |
| Nav scramble on merge | Explicit core `order` 10/20/30/40/50 |
| Manifest/build / JSX bleed | Manifests under `src/`; step-1 export spike; React peerDep |
| Sync contract bypassed | `Sync<T>` in contracts on `runIdempotent` + use-case types |
| Write-set treated as exclusive ownership | Check is `declared ⊇ actual`; `schema.tables` ≠ `writes` |

---

## 5. Decisions locked (index)

| Topic | Lock |
|---|---|
| DO ↔ module | Hybrid C: sync use case + txn-scoped ctx; command plane in DO |
| Reads | Bare `SqlStorageLike` + filters; no identity |
| Registry | Static hand-registered in kernel; modules export plain manifests; kernel wraps with `defineModule` |
| Dep graph | `contracts → modules → kernel → pms-core` (no module→kernel) |
| Manifest files | Split server / UI; both under `src/` |
| Lifecycle | Optional; housekeeping omits; purge check later derives from entitlement |
| Schema | Adopt unprefixed tables; prefix for new modules only |
| `schema.tables` vs `writes` | `['housekeeping_assignment']` vs `['room', 'housekeeping_assignment']` |
| `assignee_ref` | `staff_…`; fixtures migrated; roster out |
| SPA | ui.manifest board; read-only + room status; no assign UI |
| Sync enforcement | `Sync<T>` in contracts (compile-time), not a script |
| Moved commands | status ×2 + assign + `readHousekeepingAssignments`; `listRooms` stays; not create/update/assign_room |
| `moduleTxnCtx` helper | One private DO helper binds sql + provisional extras; three mutation call sites |

---

## 6. Follow-ons (explicit)

1. Cross-store purge Workflow + `onPurge` requirement check for non-`pms.core` modules.
2. Housekeeping roster / Staff-PII vertical (key scope wiring, permission split, assign picker, optional id rename).
3. Extract remaining verticals using the proven shape.
4. `tools/module-scaffolder` once ~5 modules stabilize the pattern.
